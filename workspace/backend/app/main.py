# -*- coding: utf-8 -*-
"""
OpenAgents Workspace Backend — FastAPI entry point.

A workspace is an ONM network with workspace-specific mods loaded.
"""

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import config
from app.routers import browser, cloud_agents, devices, events, files, knowledge, network, notifications, routines, shares, timers, todos, workspaces

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# Background timer-loop cadence. Time-sensitive firing (timers/routines)
# runs every cycle; the heavy maintenance scans run far less often so they
# never hold a pooled DB connection — or block the event loop — every 10s.
TIMER_LOOP_INTERVAL_SECONDS = 10
MAINTENANCE_EVERY_N_CYCLES = 30  # ~5 minutes


def _run_maintenance():
    """Expire stale todos/notifications and auto-archive stale threads.

    Pure synchronous DB work in a short-lived session. Invoked via
    ``asyncio.to_thread`` so these table scans run off the event loop and the
    connection is released the moment the sweep finishes. The archive scan is
    backed by ``idx_channels_status_last_event`` so it's an index lookup, not
    a full-table scan.
    """
    from datetime import timedelta
    from sqlalchemy import update
    from app.database import SessionLocal
    from app.models import Channel, NotificationRecord, TodoRecord

    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)

        # ── Expire stale todos (no update for 1 hour) ──
        stale_cutoff = now - timedelta(hours=1)
        expired = db.execute(
            update(TodoRecord)
            .where(
                TodoRecord.status.in_(["pending", "in_progress"]),
                TodoRecord.updated_at < stale_cutoff,
            )
            .values(status="cancelled", updated_at=now)
            .returning(TodoRecord.id)
        ).fetchall()
        if expired:
            logger.info("Expired %d stale todo(s)", len(expired))

        # ── Expire old notifications (older than 7 days) ──
        seven_days_ago = now - timedelta(days=7)
        expired_notifs = db.execute(
            update(NotificationRecord)
            .where(
                NotificationRecord.status == "active",
                NotificationRecord.created_at < seven_days_ago,
            )
            .values(status="expired")
            .returning(NotificationRecord.id)
        ).fetchall()
        if expired_notifs:
            logger.info("Expired %d old notification(s)", len(expired_notifs))

        # ── Auto-archive stale threads (no activity for 30 days) ──
        stale_thread_cutoff = int((now - timedelta(days=30)).timestamp() * 1000)
        archived = db.execute(
            update(Channel)
            .where(
                Channel.status == "active",
                Channel.starred == False,  # noqa: E712
                Channel.last_event_at != None,  # noqa: E711
                Channel.last_event_at < stale_thread_cutoff,
                ~Channel.name.startswith("routines:"),
            )
            .values(status="archived")
            .returning(Channel.id)
        ).fetchall()
        if archived:
            logger.info("Auto-archived %d stale thread(s)", len(archived))

        db.commit()
    finally:
        db.close()


async def _fire_due():
    """Fire due timers and routines.

    Runs every loop cycle. Opens one short-lived session that is committed
    and closed within the cycle, so it never holds a pooled connection across
    the sleep interval. ``pipeline.process`` is a coroutine (its mods are
    async), so firing runs on the event loop — but only when something is
    actually due, which is rare.
    """
    from sqlalchemy import select
    from app.database import SessionLocal
    from app.models import EventRecord, RoutineRecord, TimerRecord, Workspace
    from app.pipeline_factory import pipeline
    from app.routers.routines import _compute_next_fires_at
    from openagents.core.onm_events import Event
    from openagents.core.onm_mods import PipelineContext

    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)

        # ── Fire due timers ──
        due = db.execute(
            select(TimerRecord).where(
                TimerRecord.status == "active",
                TimerRecord.fires_at <= now,
            ).limit(50)
        ).scalars().all()

        for timer in due:
            timer.status = "fired"
            workspace = db.execute(
                select(Workspace).where(Workspace.id == timer.workspace_id)
            ).scalar_one_or_none()
            if not workspace:
                continue
            agent_name = timer.created_by.replace("openagents:", "")
            event = Event(
                type="workspace.message.posted",
                source="system:timer",
                target=f"channel/{timer.channel_name}",
                payload={
                    "content": f"⏰ Timer fired (set by @{agent_name}): {timer.message}",
                    "message_type": "chat",
                },
                metadata={"target_agents": [agent_name]},
            )
            ctx = PipelineContext(
                network_id=str(workspace.id),
                agent_address=timer.created_by,
                db=db,
                workspace=workspace,
                token=workspace.password_hash,
            )
            try:
                await pipeline.process(event, ctx)
            except Exception:
                logger.exception("Timer fire failed for %s", timer.id)

        # ── Fire due routines ──
        due_routines = db.execute(
            select(RoutineRecord).where(
                RoutineRecord.status == "active",
                RoutineRecord.next_fires_at <= now,
            ).limit(50)
        ).scalars().all()

        for routine in due_routines:
            workspace = db.execute(
                select(Workspace).where(Workspace.id == routine.workspace_id)
            ).scalar_one_or_none()
            if not workspace:
                continue
            agent_name = routine.created_by.replace("openagents:", "")

            # Skip if the agent hasn't responded to the previous fire yet
            last_msg = db.execute(
                select(EventRecord)
                .where(
                    EventRecord.network_id == workspace.id,
                    EventRecord.target == f"channel/{routine.channel_name}",
                    EventRecord.type == "workspace.message.posted",
                )
                .order_by(EventRecord.timestamp.desc())
                .limit(1)
            ).scalar_one_or_none()
            if last_msg and last_msg.source == "system:routine":
                # Previous fire still pending — skip, just advance schedule
                routine.next_fires_at = _compute_next_fires_at(
                    routine.schedule_hour,
                    routine.schedule_minute,
                    routine.schedule_days,
                    routine.schedule_interval_minutes,
                )
                continue

            ctx = PipelineContext(
                network_id=str(workspace.id),
                agent_address=routine.created_by,
                db=db,
                workspace=workspace,
                token=workspace.password_hash,
            )
            try:
                content = f"Routine \"{routine.name}\" fired: {routine.message}"
                if routine.context:
                    content = f"**Routine Context for \"{routine.name}\"**\n\n{routine.context}\n\n---\n\n{content}"

                fire_event = Event(
                    type="workspace.message.posted",
                    source="system:routine",
                    target=f"channel/{routine.channel_name}",
                    payload={
                        "content": content,
                        "message_type": "chat",
                    },
                    metadata={"target_agents": [agent_name]},
                )
                await pipeline.process(fire_event, ctx)
            except Exception:
                logger.exception("Routine fire failed for %s", routine.id)

            routine.last_fired_at = now
            routine.next_fires_at = _compute_next_fires_at(
                routine.schedule_hour,
                routine.schedule_minute,
                routine.schedule_days,
                routine.schedule_interval_minutes,
            )

        db.commit()
    finally:
        db.close()


async def _timer_loop():
    """Background loop: fire due timers/routines each cycle; run heavy
    maintenance (expiry/archival) every few minutes.

    Previously this did all of the above in one session held open for the
    whole run, every 10s — including unindexed table scans that grew with the
    data. On the event loop that froze the worker (even /health) and starved
    the 24-slot DB pool. Now the firing path uses a short-lived session and
    the heavy scans run off-loop via ``asyncio.to_thread``, far less often.
    """
    cycle = 0
    while True:
        try:
            await _fire_due()
            cycle += 1
            if cycle % MAINTENANCE_EVERY_N_CYCLES == 0:
                await asyncio.to_thread(_run_maintenance)
        except Exception:
            logger.exception("Timer loop error")
        await asyncio.sleep(TIMER_LOOP_INTERVAL_SECONDS)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("LIFESPAN: starting")
    # Auto-create tables for SQLite (dev mode) — production uses Alembic.
    try:
        from app.database import engine, Base, _is_sqlite
        logger.info("LIFESPAN: database imported, _is_sqlite=%s", _is_sqlite)
        if _is_sqlite:
            from app import models  # noqa: F401 — ensure all models are registered
            Base.metadata.create_all(bind=engine)
            logger.info("SQLite: auto-created tables")
    except Exception as e:
        logger.error("LIFESPAN: database import failed: %s", e)

    logger.info("LIFESPAN: creating timer task")
    timer_task = asyncio.create_task(_timer_loop())
    logger.info("LIFESPAN: yielding (startup complete)")
    yield
    timer_task.cancel()
    try:
        await timer_task
    except asyncio.CancelledError:
        pass
    # Shutdown: close Playwright browser
    from app.browser import BrowserManager
    await BrowserManager.get().shutdown()


app = FastAPI(
    title="OpenAgents Workspace",
    description="Managed agent collaboration environment built on the OpenAgents Network Model",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS — added FIRST so it's innermost in the stack. That way CORS
# headers (and OPTIONS preflight handling) are applied BEFORE gzip, so
# CORS-aware responses still work when compressed.
origins = [o.strip() for o in config.CORS_ORIGINS.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# GZip — Compresses all responses above `minimum_size` bytes when the
# client sends `Accept-Encoding: gzip`. Event polling responses are JSON
# and compress ~4-5x. Current egress is dominated by /v1/events poll
# bodies (~500GB/mo observed); gzip should cut that to ~100-130GB/mo.
# Level 6 is the standard tradeoff between CPU cost and ratio.
app.add_middleware(GZipMiddleware, minimum_size=1000, compresslevel=6)


class NoTransformCompressionHeadersMiddleware(BaseHTTPMiddleware):
    """Tell intermediate CDNs (Railway's Fastly layer) not to decompress
    our gzipped responses.

    Railway puts a Fastly CDN in front of the service by default. Without
    these headers the CDN was decompressing /v1/events responses at the
    edge, so clients received 21KB uncompressed JSON despite our origin
    sending 3.7KB gzipped bodies — ~5x egress waste.

    `no-transform` directs intermediaries not to modify the Content-Encoding
    (RFC 7234). `private` signals that the response is per-client (poll
    data is scoped by workspace token), so the CDN shouldn't cache and
    share across clients.
    """

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        # Don't override if the handler already set cache-control explicitly.
        if "cache-control" not in response.headers:
            response.headers["cache-control"] = "private, no-transform, max-age=0"
        return response


app.add_middleware(NoTransformCompressionHeadersMiddleware)


class UserAgentLogMiddleware(BaseHTTPMiddleware):
    """Log User-Agent on every POST so we can tell which client (iPhone
    URLSession vs Mac vs Chrome) is calling each mutating endpoint.
    GETs are excluded because /v1/events polling would drown the logs.
    Temporary: paired with the validation logger to chase a missing
    /v1/devices/register call from the iPhone.
    """

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        if request.method == "POST":
            logger.info(
                "POST %s ua=%s status=%s",
                request.url.path,
                request.headers.get("user-agent", "<none>"),
                response.status_code,
            )
        return response


app.add_middleware(UserAgentLogMiddleware)


# Log Pydantic validation failures with the offending body so we can
# debug client/server schema drift from CloudWatch instead of guessing
# from a bare 422. Triggered any time FastAPI rejects a request body
# before the route handler sees it.
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse as _ValidationJSONResponse


@app.exception_handler(RequestValidationError)
async def _log_validation_errors(request: Request, exc: RequestValidationError):
    try:
        body = await request.body()
        body_preview = body.decode("utf-8", errors="replace")[:1024]
    except Exception:
        body_preview = "<unreadable>"
    logger.warning(
        "validation 422 path=%s errors=%s body=%s",
        request.url.path, exc.errors(), body_preview,
    )
    return _ValidationJSONResponse(
        status_code=422, content={"detail": exc.errors()},
    )


# Routers
app.include_router(browser.router)
app.include_router(cloud_agents.router)
app.include_router(devices.router)
app.include_router(events.router)
app.include_router(files.router)
app.include_router(knowledge.router)
app.include_router(network.router)
app.include_router(notifications.router)
app.include_router(routines.router)
app.include_router(shares.router)
app.include_router(todos.router)
app.include_router(timers.router)
app.include_router(workspaces.router)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/.well-known/openagents.json")
async def network_manifest():
    """ONM network manifest — standard discovery endpoint."""
    base_url = os.environ.get(
        "WORKSPACE_ENDPOINT",
        f"http://{config.HOST}:{config.PORT}",
    )
    return {
        "onm_version": "1.0",
        "name": "OpenAgents Workspace",
        "transports": [
            {"type": "http", "url": f"{base_url}/v1"},
        ],
        "auth": {
            "methods": ["token"],
        },
        "capabilities": ["channels", "files", "events", "presence"],
        "mods": ["messaging", "file_storage", "browser"],
    }
