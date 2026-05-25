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
from app.routers import browser, devices, events, files, network, routines, timers, todos, workspaces

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def _timer_loop():
    """Background loop that fires due timers and expires stale todos."""
    from datetime import timedelta
    from sqlalchemy import select, update
    from app.database import SessionLocal
    from app.models import RoutineRecord, TimerRecord, TodoRecord, Workspace
    from app.pipeline_factory import pipeline
    from openagents.core.onm_events import Event
    from openagents.core.onm_mods import PipelineContext

    while True:
        try:
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

                # ── Auto-archive stale threads (no activity for 30 days) ──
                from app.models import Channel
                stale_thread_cutoff = int((now - timedelta(days=30)).timestamp() * 1000)
                archived = db.execute(
                    update(Channel)
                    .where(
                        Channel.status == "active",
                        Channel.starred == False,  # noqa: E712
                        Channel.last_event_at != None,  # noqa: E711
                        Channel.last_event_at < stale_thread_cutoff,
                        ~Channel.name.startswith("routine:"),
                        ~Channel.name.startswith("routines:"),
                    )
                    .values(status="archived")
                    .returning(Channel.id)
                ).fetchall()
                if archived:
                    logger.info("Auto-archived %d stale thread(s)", len(archived))

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
                    ctx = PipelineContext(
                        network_id=str(workspace.id),
                        agent_address=routine.created_by,
                        db=db,
                        workspace=workspace,
                        token=workspace.password_hash,
                    )
                    try:
                        if routine.context:
                            context_event = Event(
                                type="workspace.message.posted",
                                source="system:routine",
                                target=f"channel/{routine.channel_name}",
                                payload={
                                    "content": f"**Routine Context for \"{routine.name}\"**\n\n{routine.context}",
                                    "message_type": "chat",
                                },
                                metadata={"target_agents": [agent_name]},
                            )
                            await pipeline.process(context_event, ctx)

                        trigger_event = Event(
                            type="workspace.message.posted",
                            source="system:routine",
                            target=f"channel/{routine.channel_name}",
                            payload={
                                "content": f"Routine \"{routine.name}\" fired: {routine.message}",
                                "message_type": "chat",
                            },
                            metadata={"target_agents": [agent_name]},
                        )
                        await pipeline.process(trigger_event, ctx)
                    except Exception:
                        logger.exception("Routine fire failed for %s", routine.id)

                    routine.last_fired_at = now
                    from app.routers.routines import _compute_next_fires_at
                    routine.next_fires_at = _compute_next_fires_at(
                        routine.schedule_hour,
                        routine.schedule_minute,
                        routine.schedule_days,
                        routine.schedule_interval_minutes,
                    )

                db.commit()
            finally:
                db.close()
        except Exception:
            logger.exception("Timer loop error")
        await asyncio.sleep(10)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Auto-create tables for SQLite (dev mode) — production uses Alembic.
    from app.database import engine, Base, _is_sqlite
    if _is_sqlite:
        from app import models  # noqa: F401 — ensure all models are registered
        Base.metadata.create_all(bind=engine)
        logger.info("SQLite: auto-created tables")

    timer_task = asyncio.create_task(_timer_loop())
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

# Routers
app.include_router(browser.router)
app.include_router(devices.router)
app.include_router(events.router)
app.include_router(files.router)
app.include_router(network.router)
app.include_router(routines.router)
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
