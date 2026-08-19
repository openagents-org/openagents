# -*- coding: utf-8 -*-
"""
ONM Network endpoints — agent lifecycle and discovery.

These endpoints are convenience wrappers that translate REST calls into
ONM events and push them through the mod pipeline.

POST /v1/join         → network.agent.join event
POST /v1/leave        → network.agent.leave event
POST /v1/heartbeat    → network.ping event
GET  /v1/discover     Discover agents, channels, resources
GET  /v1/profile      Network profile metadata
"""

import asyncio
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import config
from app.database import get_db
from app.models import Channel, Workspace, WorkspaceMember
from app.pipeline_factory import pipeline
from app.response import ResponseCode, json_response, success_response
from openagents.core.onm_events import Event
from openagents.core.onm_mods import EventRejected, PipelineContext

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["Network"])

AGENT_TIMEOUT = timedelta(seconds=config.AGENT_TIMEOUT_SECONDS)


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class JoinRequest(BaseModel):
    agent_name: str
    token: str                         # workspace token
    network: Optional[str] = None      # workspace ID or slug
    agent_type: Optional[str] = None   # "claude", "openclaw", etc.
    server_host: Optional[str] = None  # hostname/IP where agent runs
    working_dir: Optional[str] = None  # working directory on the server

class LeaveRequest(BaseModel):
    agent_name: str
    network: str

class RemoveRequest(BaseModel):
    agent_name: str
    network: str

class HeartbeatRequest(BaseModel):
    agent_name: str
    network: str
    session_id: Optional[str] = None  # issued by /v1/join; mismatch → session_revoked

class ComposingRequest(BaseModel):
    network: str
    channel: str

class TokenResolveRequest(BaseModel):
    token: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_UUID_RE = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.I)


def _workspace_filter(identifier: str):
    """Build a SQLAlchemy filter for Workspace by ID (UUID) or slug.

    Non-UUID strings are only matched against slug to avoid PostgreSQL
    cast errors on the UUID id column.
    """
    if _UUID_RE.match(identifier):
        return (Workspace.id == identifier) | (Workspace.slug == identifier)
    return Workspace.slug == identifier


def _resolve_workspace(db: Session, network: str) -> Optional[Workspace]:
    """Resolve workspace by ID or slug."""
    return db.execute(
        select(Workspace).where(_workspace_filter(network))
    ).scalar_one_or_none()


def _extract_bearer(authorization: Optional[str]) -> Optional[str]:
    """Extract bearer token from Authorization header."""
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return None


def _verify_workspace_access(workspace, token: Optional[str], authorization: Optional[str]) -> bool:
    """Check if the caller has access to a workspace.

    Thin wrapper over the single source of truth in app.access — kept here so
    the many routers importing this name don't have to change. See
    app.access.verify_workspace_access for the rule order (token → member
    identity → grandfathered open workspace).
    """
    from app.access import verify_workspace_access
    return verify_workspace_access(workspace, token, authorization)


async def _emit_event(event: Event, workspace, db: Session, token: str = None):
    """Push an event through the mod pipeline. Returns None on rejection."""
    context = PipelineContext(
        network_id=str(workspace.id),
        agent_address=event.source,
        db=db,
        workspace=workspace,
        token=token,
    )
    try:
        result = await pipeline.process(event, context)
    except EventRejected:
        return None
    db.commit()
    return result


def _emit_event_blocking(event: Event, workspace, db: Session, token: str = None):
    """Sync variant of _emit_event for `def` (threadpool) handlers.

    The pipeline is async-shaped but everything inside it is synchronous
    I/O — sync SQLAlchemy, the sync OpenAI/Anthropic router clients, sync
    Redis publish — so when an async handler awaited it, all of that ran ON
    the uvicorn event loop. A 2s pool-checkout wait or a multi-second LLM
    routing call froze the whole worker (even /health and CORS preflights).
    Running it under asyncio.run() inside a threadpool handler keeps those
    waits in a thread. Safe because no mod touches the outer loop (no
    create_task / get_running_loop / loop-bound clients).
    """
    return asyncio.run(_emit_event(event, workspace, db, token=token))


# ---------------------------------------------------------------------------
# POST /v1/join
# ---------------------------------------------------------------------------

@router.post("/join")
def join_network(
    body: JoinRequest,
    db: Session = Depends(get_db),
):
    """Agent requests to join a network (workspace)."""
    if body.network:
        workspace = _resolve_workspace(db, body.network)
    else:
        # Token-only join: resolve workspace from token
        workspace = db.execute(
            select(Workspace).where(
                Workspace.password_hash == body.token,
                Workspace.status != "deleted",
            )
        ).scalar_one_or_none()
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")

    payload = {"agent_name": body.agent_name}
    if body.agent_type:
        payload["agent_type"] = body.agent_type
    if body.server_host:
        payload["server_host"] = body.server_host
    if body.working_dir:
        payload["working_dir"] = body.working_dir

    event = Event(
        type="network.agent.join",
        source=f"openagents:{body.agent_name}",
        target="core",
        payload=payload,
    )

    result = _emit_event_blocking(event, workspace, db, token=body.token)
    if result is None:
        # The join handler runs AFTER AuthMod, so validation problems are only
        # reported to authenticated callers — it stamps the reason on the
        # event before rejecting (see workspace_mod._handle_agent_join).
        if event.metadata.get("reject_reason") in ("display_name_conflict", "invalid_agent_name"):
            return json_response(
                ResponseCode.BAD_REQUEST,
                event.metadata.get("reject_detail") or "Invalid agent name",
            )
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid network token")

    return success_response({
        "network_id": str(workspace.id),
        "agent_name": body.agent_name,
        "role": result.metadata.get("role", "member"),
        "status": "online",
        "session_id": result.metadata.get("session_id"),
    })


# ---------------------------------------------------------------------------
# POST /v1/leave
# ---------------------------------------------------------------------------

@router.post("/leave")
def leave_network(
    body: LeaveRequest,
    db: Session = Depends(get_db),
):
    """Agent announces departure from a network."""
    workspace = _resolve_workspace(db, body.network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")

    event = Event(
        type="network.agent.leave",
        source=f"openagents:{body.agent_name}",
        target="core",
        payload={
            "agent_name": body.agent_name,
        },
    )

    # Pass workspace token since leave doesn't carry one — already authenticated by knowing the network
    result = _emit_event_blocking(event, workspace, db, token=workspace.password_hash)
    if result is None:
        return json_response(ResponseCode.NOT_FOUND, "Agent not in network")

    return success_response({"agent_name": body.agent_name, "status": "offline"})


# ---------------------------------------------------------------------------
# POST /v1/remove — Remove agent from network
# ---------------------------------------------------------------------------

@router.post("/remove")
def remove_agent(
    body: RemoveRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Remove an agent from a network (workspace). Reassigns master if needed."""
    workspace = _resolve_workspace(db, body.network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")

    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    event = Event(
        type="network.agent.remove",
        source="human:user",
        target="core",
        payload={
            "agent_name": body.agent_name,
        },
    )

    result = _emit_event_blocking(event, workspace, db, token=workspace.password_hash)
    if result is None:
        return json_response(ResponseCode.NOT_FOUND, "Agent not in network")

    resp = {"agent_name": body.agent_name, "status": "removed"}
    if result.metadata.get("new_master"):
        resp["new_master"] = result.metadata["new_master"]
    return success_response(resp)


# ---------------------------------------------------------------------------
# POST /v1/heartbeat
# ---------------------------------------------------------------------------

@router.post("/heartbeat")
def heartbeat(
    body: HeartbeatRequest,
    db: Session = Depends(get_db),
):
    """Agent presence heartbeat."""
    workspace = _resolve_workspace(db, body.network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")

    event = Event(
        type="network.ping",
        source=f"openagents:{body.agent_name}",
        target="core",
        payload={
            "agent_name": body.agent_name,
            "session_id": body.session_id,
        },
    )

    result = _emit_event_blocking(event, workspace, db, token=workspace.password_hash)
    if result is None:
        return json_response(ResponseCode.NOT_FOUND, "Agent not in network")

    if result.metadata.get("session_error") == "session_revoked":
        # Another client has since joined as this agent; tell the caller
        # to stop its adapter for this agent.
        return json_response(
            ResponseCode.UNAUTHORIZED,
            "session_revoked: another client is now running as this agent",
        )

    return success_response({"agent_name": body.agent_name, "status": "online"})


# ---------------------------------------------------------------------------
# POST /v1/composing
# ---------------------------------------------------------------------------

@router.post("/composing")
def composing_signal(
    body: ComposingRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Record that a user is actively typing in a channel."""
    workspace = _resolve_workspace(db, body.network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")

    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    from app.composing import set_composing
    set_composing(str(workspace.id), body.channel)
    return success_response({"status": "ok"})


# ---------------------------------------------------------------------------
# POST /v1/token/resolve
# ---------------------------------------------------------------------------

@router.post("/token/resolve")
def resolve_token(
    body: TokenResolveRequest,
    db: Session = Depends(get_db),
):
    """Resolve a workspace token to workspace info."""
    workspace = db.execute(
        select(Workspace).where(
            Workspace.password_hash == body.token,
            Workspace.status != "deleted",
        )
    ).scalar_one_or_none()
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Invalid or expired token")

    return success_response({
        "workspace_id": str(workspace.id),
        "slug": workspace.slug,
        "name": workspace.name,
        "endpoint": config.WORKSPACE_ENDPOINT if hasattr(config, 'WORKSPACE_ENDPOINT') else None,
    })


# ---------------------------------------------------------------------------
# GET /v1/discover — discovery doesn't go through the pipeline
# ---------------------------------------------------------------------------

@router.get("/discover")
def discover(
    network: str = Query(..., description="Network (workspace) ID"),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Discover agents, channels, and resources in a network."""
    workspace = _resolve_workspace(db, network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")

    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    now = datetime.now(timezone.utc)

    # Hide removed agents — removal is a soft-delete (status='removed') so a
    # re-add can reactivate them. Offline members are intentionally kept: the
    # mobile clients key the "connect an agent" prompt off membership, not
    # online status. (issue #347)
    members = db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.status != "removed",
        )
    ).scalars().all()

    agents = []
    for m in members:
        status = m.status
        is_cloud = (m.agent_type or "").startswith("cloud:")
        if not is_cloud and m.last_heartbeat:
            heartbeat = m.last_heartbeat
            if heartbeat.tzinfo is None:
                heartbeat = heartbeat.replace(tzinfo=timezone.utc)
            if (now - heartbeat) > AGENT_TIMEOUT:
                status = "offline"
        agents.append({
            "address": f"openagents:{m.agent_name}",
            "display_name": m.display_name,
            "role": m.role,
            "status": status,
            "agent_type": m.agent_type,
            "builtin": (m.agent_type or "") == "cloud:openagents",
            "server_host": m.server_host,
            "working_dir": m.working_dir,
            "description": m.description,
            "enabled_skills": m.enabled_skills,
            "last_heartbeat_at": m.last_heartbeat.isoformat() if m.last_heartbeat else None,
            "joined_at": m.joined_at.isoformat() if m.joined_at else None,
        })

    channels_rows = db.execute(
        select(Channel).where(
            Channel.workspace_id == workspace.id,
            Channel.status != "deleted",
        )
    ).scalars().all()

    channels = []
    for c in channels_rows:
        target_key = f"channel/{c.name}"
        created_at_ts = int(c.created_at.timestamp() * 1000) if c.created_at else None
        channels.append({
            "address": target_key,
            "title": c.title,
            "master": c.master_agent,
            "orchestration_mode": c.orchestration_mode or "dynamic",
            "orchestration_instruction": c.orchestration_instruction,
            "workflow_id": c.workflow_id,
            "participants": [p.agent_name for p in (c.participants or [])],
            "created_at": created_at_ts,
            "last_event_at": c.last_event_at,
            "status": c.status or "active",
            "starred": bool(c.starred) if c.starred is not None else False,
        })

    return success_response({
        "agents": agents,
        "channels": channels,
        "mods": ["mod/auth", "mod/workspace", "mod/persistence"],
        "resources": [],
    })


# ---------------------------------------------------------------------------
# GET /v1/profile
# ---------------------------------------------------------------------------

@router.get("/profile")
def network_profile(
    network: str = Query(..., description="Network (workspace) ID"),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Return the network profile (metadata, transports, capabilities)."""
    workspace = _resolve_workspace(db, network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")

    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    online_count = len(db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.status == "online",
        )
    ).scalars().all())

    return success_response({
        "id": str(workspace.id),
        "slug": workspace.slug,
        "name": workspace.name,
        "access": {
            "policy": "token",
            "min_verification": 0,
        },
        "status": workspace.status,
        "capabilities": [
            "workspace.message",
            "network.channel",
            "network.agent",
        ],
        "agents_online": online_count,
    })


# ── Agent catalog (supported client types) ──────────────────────────────
# Single source of truth: per-agent JSON files under /registry, served by
# app.services.agent_registry. (The old hand-maintained _AGENT_CATALOG list
# is gone — edit the registry files instead.)


@router.get("/agent-catalog")
def agent_catalog():
    """List supported agent client types (summaries, featured first)."""
    from app.services import agent_registry
    return success_response(agent_registry.list_agents())


@router.get("/agent-catalog/{agent_type}")
def agent_catalog_detail(agent_type: str):
    """Full detail for one agent type — logo, per-OS install/uninstall,
    readiness, and the (resolved) list of supported models."""
    from app.services import agent_registry
    entry = agent_registry.get_agent(agent_type)
    if entry is None:
        return json_response(ResponseCode.NOT_FOUND, "Unknown agent type")
    return success_response(entry)


@router.get("/agent-catalog/{agent_type}/logo")
def agent_catalog_logo(agent_type: str):
    """The agent type's logo as an SVG — served from /registry/icons so the
    catalog is self-contained (no dependency on the frontend's static assets).
    Falls back to a generic icon for types without their own artwork."""
    from fastapi.responses import FileResponse

    from app.services import agent_registry
    path = agent_registry.logo_path(agent_type)
    if path is None:
        return json_response(ResponseCode.NOT_FOUND, "Unknown agent type")
    return FileResponse(
        path,
        media_type="image/svg+xml",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@router.get("/agent-registry")
def agent_registry_full():
    """Full agent registry for the launcher (agn / desktop app).

    Returns every registry entry with all runtime fields (install, adapter,
    launch, check_ready, env_config, resolve_env) and models resolved — the
    same shape as the launcher's bundled registry.json, so the launcher can
    fetch this instead of the legacy endpoint.openagents.org registry.
    """
    from app.services import agent_registry
    return success_response(agent_registry.full_registry())
