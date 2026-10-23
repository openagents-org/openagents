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
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import OperationalError, SQLAlchemyError, TimeoutError as PoolTimeoutError

from app.config import config
from app.routers import web_projects, reactions, agent_services, account, agent_profile, app_version, approvals, auth, briefs, browser, campaign, pilot, cloud_agents, devices, events, feedback, fetch, files, grants, groups, integrations, invites, issues, knowledge, model_access, network, nodes, notifications, onboarding, routines, search, shares, sharing, tasks, thread_access, timers, todos, watches, workflows, workspaces

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# Background timer-loop cadence. Time-sensitive firing (timers/routines)
# runs every cycle; the heavy maintenance scans run far less often so they
# never hold a pooled DB connection — or block the event loop — every 10s.
TIMER_LOOP_INTERVAL_SECONDS = 10
MAINTENANCE_EVERY_N_CYCLES = 30  # ~5 minutes

# A routine whose previous fire hasn't produced an answer within this window
# is treated as stuck (e.g. crashed adapter) and allowed to re-fire so the
# routine can recover, rather than being skipped forever.
ROUTINE_STUCK_MS = 30 * 60 * 1000  # 30 minutes


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


def _run_onboarding_reminders():
    """Send due onboarding reminder emails (24h/72h after workspace creation).

    Same dispatch shape as ``_run_maintenance``: synchronous DB work in its
    own short-lived session, invoked via ``asyncio.to_thread`` on the
    maintenance cadence. Fully self-contained — any failure is logged and
    must never disturb the timer loop.
    """
    from app.database import SessionLocal
    from app.services.onboarding_reminders import run_onboarding_reminders

    db = SessionLocal()
    try:
        run_onboarding_reminders(db)
    except Exception:
        logger.exception("Onboarding reminders failed")
    finally:
        db.close()


async def _fire_due():
    # Like send_event, the pipeline is async-shaped but performs synchronous
    # DB work. Give it a private thread/loop so pool waits cannot stop response
    # cleanup (which is what returns other requests' connections to the pool).
    await asyncio.to_thread(_fire_due_blocking)


def _fire_due_blocking():
    asyncio.run(_fire_due_in_thread())


async def _fire_due_in_thread():
    """Fire due timers and routines.

    Runs every loop cycle. Opens one short-lived session that is committed
    and closed within the cycle, so it never holds a pooled connection across
    the sleep interval. The coroutine runs on a private worker-thread loop,
    including when no timer is due: even checking out a connection can block.
    """
    from sqlalchemy import select, update
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

        # Materialize fields now — the per-routine commit below would otherwise
        # expire these ORM rows and force a re-query on every iteration.
        pending_routines = [
            {
                "id": r.id,
                "channel_name": r.channel_name,
                "name": r.name,
                "message": r.message,
                "context": r.context,
                "created_by": r.created_by,
                "workspace_id": r.workspace_id,
                "next_fire": _compute_next_fires_at(
                    r.schedule_hour,
                    r.schedule_minute,
                    r.schedule_days,
                    r.schedule_interval_minutes,
                ),
            }
            for r in due_routines
        ]

        now_ms = int(now.timestamp() * 1000)
        for rt in pending_routines:
            routine_id = rt["id"]
            channel_name = rt["channel_name"]
            r_name = rt["name"]
            r_message = rt["message"]
            r_context = rt["context"]
            created_by = rt["created_by"]
            workspace_id = rt["workspace_id"]
            next_fire = rt["next_fire"]

            # ── Atomically claim this tick so only one replica fires it ──
            #
            # The backend runs multiple replicas, each with its own scheduler
            # loop. Without a claim, every replica sees the same due routine
            # (next_fires_at <= now) and fires it, double-posting the routine
            # context into the channel. This conditional UPDATE advances
            # next_fires_at only while the row is still due, so under Postgres
            # READ COMMITTED exactly one replica's UPDATE matches a row — the
            # losers block on the row lock, then re-check the predicate after
            # the winner commits, see a future time, and match nothing. We fire
            # only if we claimed a row; committing straight away releases the
            # lock so a losing replica isn't stalled for the whole cycle.
            #
            # synchronize_session=False: the default re-evaluates this WHERE in
            # Python against the rows loaded above, which is wasted work (the
            # commit below expires them anyway) and makes the claim depend on
            # how the driver hands datetimes back — on a database that returns
            # them naive, `next_fires_at <= now` raised TypeError and no
            # routine ever fired.
            claimed = db.execute(
                update(RoutineRecord)
                .where(
                    RoutineRecord.id == routine_id,
                    RoutineRecord.status == "active",
                    RoutineRecord.next_fires_at <= now,
                )
                .values(next_fires_at=next_fire)
                .execution_options(synchronize_session=False)
            )
            db.commit()
            if claimed.rowcount == 0:
                continue  # another replica already claimed this tick

            workspace = db.execute(
                select(Workspace).where(Workspace.id == workspace_id)
            ).scalar_one_or_none()
            if not workspace:
                continue
            agent_name = created_by.replace("openagents:", "")

            # Skip if the previous run of this routine is still in progress.
            #
            # A routine fires into the agent's dedicated routine channel and the
            # agent works the task as a single turn, ending with a final `chat`
            # answer. Firing again before that answer lands makes the adapter
            # queue the new fire behind the running one, and on a short interval
            # a long-running task snowballs into a backlog of duplicate runs.
            #
            # So: find the most recent fire in this channel and, if the agent
            # hasn't posted a `chat` reply since, skip this tick — the claim
            # above already advanced the schedule, so the next due tick
            # re-checks. A run that produces no answer within ROUTINE_STUCK_MS
            # (crashed adapter, etc.) is allowed to re-fire so it can recover.
            last_fire = db.execute(
                select(EventRecord)
                .where(
                    EventRecord.network_id == workspace.id,
                    EventRecord.target == f"channel/{channel_name}",
                    EventRecord.type == "workspace.message.posted",
                    EventRecord.source == "system:routine",
                )
                .order_by(EventRecord.timestamp.desc())
                .limit(1)
            ).scalar_one_or_none()
            if last_fire is not None:
                answered = db.execute(
                    select(EventRecord.id)
                    .where(
                        EventRecord.network_id == workspace.id,
                        EventRecord.target == f"channel/{channel_name}",
                        EventRecord.type == "workspace.message.posted",
                        EventRecord.source == f"openagents:{agent_name}",
                        EventRecord.timestamp > last_fire.timestamp,
                        EventRecord.payload["message_type"].astext == "chat",
                    )
                    .limit(1)
                ).scalar_one_or_none()
                run_age_ms = now_ms - int(last_fire.timestamp or 0)
                if answered is None and run_age_ms < ROUTINE_STUCK_MS:
                    # Previous run still working — skip (schedule already advanced).
                    continue

            ctx = PipelineContext(
                network_id=str(workspace.id),
                agent_address=created_by,
                db=db,
                workspace=workspace,
                token=workspace.password_hash,
            )
            try:
                content = f"Routine \"{r_name}\" fired: {r_message}"
                if r_context:
                    content = f"**Routine Context for \"{r_name}\"**\n\n{r_context}\n\n---\n\n{content}"

                fire_event = Event(
                    type="workspace.message.posted",
                    source="system:routine",
                    target=f"channel/{channel_name}",
                    payload={
                        "content": content,
                        "message_type": "chat",
                    },
                    metadata={"target_agents": [agent_name]},
                )
                await pipeline.process(fire_event, ctx)
            except Exception:
                logger.exception("Routine fire failed for %s", routine_id)

            # Record the actual fire time (schedule already advanced by the claim).
            db.execute(
                update(RoutineRecord)
                .where(RoutineRecord.id == routine_id)
                .values(last_fired_at=now)
            )
            db.commit()

        # ── Expire due agent watches (one final wake-up for silent ones) ──
        try:
            from app.services.watches import expire_due
            await expire_due(db, now)
        except Exception:
            logger.exception("Watch expiry failed")

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
    from app.browser_maintenance import sweep_browser_tabs

    cycle = 0
    browser_sweep_task = None
    while True:
        try:
            await _fire_due()
            cycle += 1
            if cycle % MAINTENANCE_EVERY_N_CYCLES == 0:
                await asyncio.to_thread(_run_maintenance)
                await asyncio.to_thread(_run_onboarding_reminders)
                # Browser sweep is async (BF HTTP calls) and self-contained;
                # run it as its own task so slow BF responses never delay
                # timer firing. Overlap guard: skip if the last one is
                # still running.
                if browser_sweep_task is None or browser_sweep_task.done():
                    browser_sweep_task = asyncio.create_task(sweep_browser_tabs())
        except Exception:
            logger.exception("Timer loop error")
        await asyncio.sleep(TIMER_LOOP_INTERVAL_SECONDS)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("LIFESPAN: starting")

    # Align the threadpool with the DB pool. Synchronous handlers and explicitly
    # offloaded DB phases share this limiter. The per-worker connection pool holds
    # pool_size+max_overflow connections (40+8, see app/database.py). If the
    # threadpool admitted more concurrent DB requests than there are
    # connections, the excess would wait pool_timeout=2s then raise QueuePool
    # TimeoutError (500s). Capping tokens at exactly the pool capacity makes
    # bursts queue for a THREAD (cheap, unbounded wait) instead of stampeding
    # the pool. Background tasks can also use connections, so this is not a
    # guarantee against pool exhaustion. Env-overridable for ops.
    import anyio.to_thread
    tokens = int(os.environ.get("THREADPOOL_TOKENS", "48"))
    anyio.to_thread.current_default_thread_limiter().total_tokens = tokens
    logger.info("LIFESPAN: threadpool capped at %d tokens (= DB pool capacity)", tokens)

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

    background_tasks = []
    # Additional HTTP replicas can share the database/cache without adding
    # schedulers. At least one deployment must retain background jobs.
    if os.environ.get("BACKGROUND_JOBS_ENABLED", "true").strip().lower() in ("1", "true", "yes"):
        logger.info("LIFESPAN: creating background tasks")
        background_tasks.append(asyncio.create_task(_timer_loop()))
        from app.browser_maintenance import sweep_browser_tabs
        background_tasks.append(asyncio.create_task(sweep_browser_tabs()))
    else:
        logger.info("LIFESPAN: background jobs disabled on this replica")

    logger.info("LIFESPAN: yielding (startup complete)")
    try:
        yield
    finally:
        for task in background_tasks:
            task.cancel()
        await asyncio.gather(*background_tasks, return_exceptions=True)
        # Shutdown: close Playwright browser
        from app.browser import BrowserManager
        await BrowserManager.get().shutdown()


app = FastAPI(
    title="OpenAgents Workspace",
    description="Managed agent collaboration environment built on the OpenAgents Network Model",
    version="0.1.0",
    lifespan=lifespan,
)

@app.exception_handler(PoolTimeoutError)
@app.exception_handler(OperationalError)
async def database_unavailable(request: Request, exc: Exception):
    # A handled response passes through CORS. Unhandled DB failures otherwise
    # become opaque "Failed to fetch" errors in cross-origin browser clients.
    logger.warning("Database unavailable for %s (%s)", request.url.path, type(exc).__name__)
    return JSONResponse(
        status_code=503,
        content={"code": 503, "message": "Workspace database is temporarily unavailable. Please retry.", "data": None},
        headers={"Retry-After": "5", "Cache-Control": "no-store"},
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


class NoTransformCompressionHeadersMiddleware:
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

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        async def send_with_cache_policy(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                if not any(k.lower() == b"cache-control" for k, _ in headers):
                    headers.append((b"cache-control", b"private, no-transform, max-age=0"))
                    message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_with_cache_policy)


app.add_middleware(NoTransformCompressionHeadersMiddleware)


class UserAgentLogMiddleware:
    """Log User-Agent on every POST so we can tell which client (iPhone
    URLSession vs Mac vs Chrome) is calling each mutating endpoint.
    GETs are excluded because /v1/events polling would drown the logs.
    Temporary: paired with the validation logger to chase a missing
    /v1/devices/register call from the iPhone.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] != "POST":
            return await self.app(scope, receive, send)
        user_agent = next((v.decode("latin-1") for k, v in scope.get("headers", [])
                           if k.lower() == b"user-agent"), "<none>")

        async def send_with_log(message):
            if message["type"] == "http.response.start":
                logger.info("POST %s ua=%s status=%s", scope["path"], user_agent, message["status"])
            await send(message)

        await self.app(scope, receive, send_with_log)


app.add_middleware(UserAgentLogMiddleware)


class AgentIdentityMiddleware:
    """Pure-ASGI: stash the agent identity of a machine call (header
    `X-Agent-Name`, else `source=openagents:<name>` in the query string) in a
    ContextVar so access_model.resolve_principal can pick it up without every
    router growing a new parameter. A human bearer always wins over it."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        from urllib.parse import parse_qs

        from app.services.access_model import (
            agent_name_from_request,
            reset_request_agent_name,
            set_request_agent_name,
        )
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
        query = {}
        try:
            raw = scope.get("query_string") or b""
            if b"source=" in raw:
                query = {k: v[0] for k, v in parse_qs(raw.decode("utf-8", errors="replace")).items() if v}
        except Exception:
            query = {}
        token = set_request_agent_name(agent_name_from_request(headers, query))
        try:
            return await self.app(scope, receive, send)
        finally:
            reset_request_agent_name(token)


app.add_middleware(AgentIdentityMiddleware)


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
app.include_router(reactions.router)
app.include_router(agent_services.router)
app.include_router(account.router)
app.include_router(app_version.router)
app.include_router(approvals.router)
app.include_router(sharing.router)
app.include_router(groups.router)
app.include_router(grants.router)
app.include_router(thread_access.router)
app.include_router(agent_profile.router)
app.include_router(briefs.router)
app.include_router(auth.router)
app.include_router(campaign.router)
app.include_router(pilot.router)
app.include_router(browser.router)
app.include_router(cloud_agents.router)
app.include_router(devices.router)
app.include_router(events.router)
app.include_router(feedback.router)
app.include_router(fetch.router)
app.include_router(files.router)
app.include_router(web_projects.router)
app.include_router(integrations.router)
app.include_router(invites.router)
app.include_router(knowledge.router)
app.include_router(model_access.router)
app.include_router(network.router)
app.include_router(nodes.router)
app.include_router(nodes.devices_router)  # /v1/devices/* alias — must stay after devices.router
app.include_router(notifications.router)
app.include_router(onboarding.router)
app.include_router(routines.router)
app.include_router(search.router)
app.include_router(shares.router)
app.include_router(issues.router)
app.include_router(tasks.router)
app.include_router(todos.router)
app.include_router(workflows.router)
app.include_router(timers.router)
app.include_router(watches.router)
app.include_router(workspaces.router)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/ready")
def readiness():
    """Readiness uses this worker's real connection pool; /health is liveness."""
    from app.database import engine

    try:
        with engine.connect() as connection:
            if engine.dialect.name == "postgresql":
                connection.execute(text("SET LOCAL statement_timeout = '1000ms'"))
            connection.execute(text("SELECT 1"))
    except SQLAlchemyError:
        return JSONResponse(
            status_code=503,
            content={"status": "unavailable", "database": "unavailable"},
            headers={"Cache-Control": "no-store"},
        )
    return JSONResponse(
        content={"status": "ok", "database": "ok"},
        headers={"Cache-Control": "no-store"},
    )


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
