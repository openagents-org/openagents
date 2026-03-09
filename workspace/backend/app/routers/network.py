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

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from sqlalchemy import func

from app.config import config
from app.database import get_db
from app.models import Channel, EventRecord, Workspace, WorkspaceMember
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

class LeaveRequest(BaseModel):
    agent_name: str
    network: str

class RemoveRequest(BaseModel):
    agent_name: str
    network: str

class HeartbeatRequest(BaseModel):
    agent_name: str
    network: str

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
    """Check if the caller has access to a workspace via token or bearer auth."""
    if not workspace.password_hash:
        return True
    if token and token == workspace.password_hash:
        return True
    bearer = _extract_bearer(authorization)
    if bearer:
        from app.firebase_auth import verify_firebase_token
        email = verify_firebase_token(bearer)
        if email and workspace.creator_email and email == workspace.creator_email:
            return True
    return False


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


# ---------------------------------------------------------------------------
# POST /v1/join
# ---------------------------------------------------------------------------

@router.post("/join")
async def join_network(
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

    event = Event(
        type="network.agent.join",
        source=f"openagents:{body.agent_name}",
        target="core",
        payload=payload,
    )

    result = await _emit_event(event, workspace, db, token=body.token)
    if result is None:
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid network token")

    return success_response({
        "network_id": str(workspace.id),
        "agent_name": body.agent_name,
        "role": result.metadata.get("role", "member"),
        "status": "online",
    })


# ---------------------------------------------------------------------------
# POST /v1/leave
# ---------------------------------------------------------------------------

@router.post("/leave")
async def leave_network(
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
    result = await _emit_event(event, workspace, db, token=workspace.password_hash)
    if result is None:
        return json_response(ResponseCode.NOT_FOUND, "Agent not in network")

    return success_response({"agent_name": body.agent_name, "status": "offline"})


# ---------------------------------------------------------------------------
# POST /v1/remove — Remove agent from network
# ---------------------------------------------------------------------------

@router.post("/remove")
async def remove_agent(
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

    result = await _emit_event(event, workspace, db, token=workspace.password_hash)
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
async def heartbeat(
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
        },
    )

    result = await _emit_event(event, workspace, db, token=workspace.password_hash)
    if result is None:
        return json_response(ResponseCode.NOT_FOUND, "Agent not in network")

    return success_response({"agent_name": body.agent_name, "status": "online"})


# ---------------------------------------------------------------------------
# POST /v1/token/resolve
# ---------------------------------------------------------------------------

@router.post("/token/resolve")
async def resolve_token(
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
async def discover(
    network: str = Query(..., description="Network (workspace) ID"),
    db: Session = Depends(get_db),
):
    """Discover agents, channels, and resources in a network."""
    workspace = _resolve_workspace(db, network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")

    now = datetime.now(timezone.utc)

    members = db.execute(
        select(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace.id)
    ).scalars().all()

    agents = []
    for m in members:
        status = m.status
        if m.last_heartbeat:
            heartbeat = m.last_heartbeat
            if heartbeat.tzinfo is None:
                heartbeat = heartbeat.replace(tzinfo=timezone.utc)
            if (now - heartbeat) > AGENT_TIMEOUT:
                status = "offline"
        agents.append({
            "address": f"openagents:{m.agent_name}",
            "role": m.role,
            "status": status,
            "agent_type": m.agent_type,
        })

    channels_rows = db.execute(
        select(Channel).where(
            Channel.workspace_id == workspace.id,
            Channel.status != "deleted",
        )
    ).scalars().all()

    # Get last event timestamp per channel
    last_event_subq = db.execute(
        select(
            EventRecord.target,
            func.max(EventRecord.timestamp).label("last_ts"),
        ).where(
            EventRecord.network_id == workspace.id,
            EventRecord.type.startswith("workspace.message"),
        ).group_by(EventRecord.target)
    ).all()
    last_event_map = {row.target: row.last_ts for row in last_event_subq}

    channels = []
    for c in channels_rows:
        target_key = f"channel/{c.name}"
        last_ts = last_event_map.get(target_key)
        created_at_ts = int(c.created_at.timestamp() * 1000) if c.created_at else None
        channels.append({
            "address": target_key,
            "title": c.title,
            "master": c.master_agent,
            "participants": [p.agent_name for p in (c.participants or [])],
            "created_at": created_at_ts,
            "last_event_at": last_ts,
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
async def network_profile(
    network: str = Query(..., description="Network (workspace) ID"),
    db: Session = Depends(get_db),
):
    """Return the network profile (metadata, transports, capabilities)."""
    workspace = _resolve_workspace(db, network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")

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
