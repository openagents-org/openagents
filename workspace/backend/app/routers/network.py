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
    """Check if the caller has access to a workspace via token, bearer owner, or collaborator."""
    if not workspace.password_hash:
        return True
    if token and token == workspace.password_hash:
        return True
    bearer = _extract_bearer(authorization)
    if bearer:
        from app.firebase_auth import verify_firebase_token
        email = verify_firebase_token(bearer)
        if email:
            email_lower = email.lower()
            # Owner check
            if workspace.creator_email and email_lower == workspace.creator_email.lower():
                return True
            # Collaborator check (loaded via selectin)
            if any(c.email == email_lower for c in (workspace.collaborators or [])):
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

    result = await _emit_event(event, workspace, db, token=body.token)
    if result is None:
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
            "session_id": body.session_id,
        },
    )

    result = await _emit_event(event, workspace, db, token=workspace.password_hash)
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
async def composing_signal(
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
async def network_profile(
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

# Static catalog mirroring the SDK plugin_registry.  Kept in sync manually;
# the source of truth is sdk/src/openagents/client/plugin_registry.py.

_AGENT_CATALOG = [
    {
        "name": "claude",
        "label": "Claude Code",
        "description": "Anthropic's Claude Code CLI",
        "install_command": "curl -fsSL https://claude.ai/install.sh | bash",
        "homepage": "https://claude.ai",
        "tags": ["coding", "anthropic", "cli"],
        "builtin": True,
    },
    {
        "name": "codex",
        "label": "OpenAI Codex CLI",
        "description": "OpenAI's Codex CLI agent for the terminal",
        "install_command": "npm install -g @openai/codex",
        "homepage": "https://github.com/openai/codex",
        "tags": ["coding", "openai", "cli"],
        "builtin": True,
    },
    {
        "name": "gemini",
        "label": "Gemini CLI",
        "description": "Google's open-source AI agent for the command line",
        "install_command": "npm install -g @google/gemini-cli",
        "homepage": "https://github.com/google-gemini/gemini-cli",
        "tags": ["coding", "google", "open-source", "cli"],
        "builtin": False,
    },
    {
        "name": "openclaw",
        "label": "OpenClaw",
        "description": "Open-source agent client powered by Anthropic",
        "install_command": "npm install -g openclaw@latest",
        "homepage": "https://github.com/qwibitai/openclaw",
        "tags": ["coding", "open-source", "cli"],
        "builtin": True,
    },
    {
        "name": "amp",
        "label": "Amp (Sourcegraph)",
        "description": "Sourcegraph's AI coding agent for CLI and VS Code",
        "install_command": "curl -fsSL https://ampcode.com/install.sh | bash",
        "homepage": "https://ampcode.com",
        "tags": ["coding", "sourcegraph", "cli", "vscode"],
        "builtin": False,
    },
    {
        "name": "aider",
        "label": "Aider",
        "description": "AI pair programming in your terminal",
        "install_command": "pip install aider-chat",
        "homepage": "https://aider.chat",
        "tags": ["coding", "pair-programming", "open-source"],
        "builtin": False,
    },
    {
        "name": "goose",
        "label": "Goose",
        "description": "An open-source AI developer agent by Block",
        "install_command": "pip install goose-ai",
        "homepage": "https://github.com/block/goose",
        "tags": ["coding", "developer", "open-source"],
        "builtin": False,
    },
    {
        "name": "cline",
        "label": "Cline",
        "description": "Autonomous coding agent for VS Code",
        "install_command": "npm install -g cline",
        "homepage": "https://github.com/cline/cline",
        "tags": ["coding", "vscode", "autonomous"],
        "builtin": False,
    },
    {
        "name": "copilot",
        "label": "GitHub Copilot CLI",
        "description": "GitHub Copilot coding agent for the terminal",
        "install_command": "npm install -g @github/copilot",
        "homepage": "https://github.com/features/copilot",
        "tags": ["coding", "github", "cli"],
        "builtin": False,
    },
    {
        "name": "opencode",
        "label": "OpenCode",
        "description": "Open-source terminal-native AI coding agent",
        "install_command": "npm install -g opencode-ai@latest",
        "homepage": "https://opencode.ai",
        "tags": ["coding", "open-source", "cli", "terminal"],
        "builtin": False,
    },
    {
        "name": "nanoclaw",
        "label": "NanoClaw",
        "description": "Lightweight containerized coding agent built on Claude Agent SDK",
        "install_command": "docker pull qwibitai/nanoclaw",
        "homepage": "https://github.com/qwibitai/nanoclaw",
        "tags": ["coding", "container", "lightweight", "open-source"],
        "builtin": False,
    },
]


@router.get("/agent-catalog")
async def agent_catalog():
    """Return the catalog of supported agent client types."""
    return success_response(_AGENT_CATALOG)
