# -*- coding: utf-8 -*-
"""
Workspace management endpoints — CRUD for the workspace itself.

These are NOT part of the ONM spec — they manage the product layer
(creating networks, listing user's workspaces, updating settings).

POST   /v1/workspaces              Create a new workspace
GET    /v1/workspaces              List workspaces
GET    /v1/workspaces/{id}         Get workspace details
PATCH  /v1/workspaces/{id}         Update workspace settings
DELETE /v1/workspaces/{id}         Delete workspace
"""

import logging
import secrets
from datetime import datetime, timezone, timedelta
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import config
from app.database import get_db
from app.models import (
    Channel,
    ChannelMember,
    Workspace,
    WorkspaceMember,
)
from app.response import ResponseCode, json_response, success_response
from app.routers.network import _workspace_filter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/workspaces", tags=["Workspaces"])

AGENT_TIMEOUT = timedelta(seconds=config.AGENT_TIMEOUT_SECONDS)


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


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class WorkspaceCreateRequest(BaseModel):
    name: str
    agent_name: str                    # The creating agent (becomes master)
    agent_type: Optional[str] = None   # "claude", "openclaw", etc.
    creator_email: Optional[str] = None

class ChannelUpdateRequest(BaseModel):
    title: Optional[str] = None
    status: Optional[str] = None
    starred: Optional[bool] = None
    auto_title: bool = False  # When True, title update is from auto-titling (don't mark as manually set)

class WorkspaceUpdateRequest(BaseModel):
    name: Optional[str] = None
    settings: Optional[dict] = None
    status: Optional[str] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _format_workspace(ws: Workspace, members: list, now: datetime) -> dict:
    agents = []
    for m in members:
        status = m.status
        if m.last_heartbeat:
            # Ensure timezone-aware comparison (SQLite stores naive datetimes)
            heartbeat = m.last_heartbeat
            if heartbeat.tzinfo is None:
                heartbeat = heartbeat.replace(tzinfo=timezone.utc)
            if (now - heartbeat) > AGENT_TIMEOUT:
                status = "offline"
        agents.append({
            "agentName": m.agent_name,
            "role": m.role,
            "agentType": m.agent_type,
            "status": status,
            "lastHeartbeatAt": m.last_heartbeat.isoformat() if m.last_heartbeat else None,
            "joinedAt": m.joined_at.isoformat() if m.joined_at else None,
        })

    return {
        "workspaceId": str(ws.id),
        "slug": ws.slug,
        "name": ws.name,
        "creatorEmail": ws.creator_email,
        "settings": ws.settings or {},
        "status": ws.status,
        "createdAt": ws.created_at.isoformat() if ws.created_at else None,
        "lastActivityAt": ws.last_activity_at.isoformat() if ws.last_activity_at else None,
        "agents": agents,
    }


def _format_channel(ch: Channel) -> dict:
    return {
        "channelId": str(ch.id),
        "workspaceId": str(ch.workspace_id),
        "name": ch.name,
        "title": ch.title,
        "titleManuallySet": bool(ch.title_manually_set),
        "createdBy": ch.created_by,
        "masterAgent": ch.master_agent,
        "resumeFrom": ch.resume_from,
        "status": ch.status,
        "starred": bool(ch.starred),
        "participants": [p.agent_name for p in (ch.participants or [])],
        "createdAt": ch.created_at.isoformat() if ch.created_at else None,
    }


# ---------------------------------------------------------------------------
# POST /v1/workspaces — Create workspace
# ---------------------------------------------------------------------------

@router.post("")
async def create_workspace(
    body: WorkspaceCreateRequest,
    db: Session = Depends(get_db),
):
    """Create a new workspace (= ONM network)."""
    # Generate slug and token
    slug = secrets.token_hex(4)
    token = secrets.token_urlsafe(32)

    now = datetime.now(timezone.utc)

    workspace = Workspace(
        slug=slug,
        name=body.name,
        creator_email=body.creator_email,
        password_hash=token,
        settings={},
        status="active",
    )
    db.add(workspace)
    db.flush()

    # Add the creating agent as master member
    member = WorkspaceMember(
        workspace_id=workspace.id,
        agent_name=body.agent_name,
        role="master",
        agent_type=body.agent_type,
        status="online",
        last_heartbeat=now,
    )
    db.add(member)

    # Create default channel (Session 1)
    channel = Channel(
        workspace_id=workspace.id,
        name=f"session-{secrets.token_hex(4)}",
        title="Session 1",
        created_by=body.agent_name,
        master_agent=body.agent_name,
        status="active",
    )
    db.add(channel)
    db.flush()

    # Add master to default channel
    participant = ChannelMember(
        channel_id=channel.id,
        agent_name=body.agent_name,
    )
    db.add(participant)

    db.commit()
    db.refresh(workspace)

    return success_response({
        "workspaceId": str(workspace.id),
        "slug": workspace.slug,
        "name": workspace.name,
        "token": token,
        "channel": _format_channel(channel),
    })


# ---------------------------------------------------------------------------
# GET /v1/workspaces — List workspaces
# ---------------------------------------------------------------------------

@router.get("")
async def list_workspaces(
    creator_email: Optional[str] = Query(None),
    agent_name: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """List workspaces, optionally filtered by creator or agent membership."""
    query = select(Workspace).where(Workspace.status != "deleted")

    if creator_email:
        query = query.where(Workspace.creator_email == creator_email)

    if agent_name:
        query = query.join(WorkspaceMember).where(
            WorkspaceMember.agent_name == agent_name
        )

    workspaces = db.execute(query.order_by(Workspace.last_activity_at.desc())).scalars().all()
    now = datetime.now(timezone.utc)

    results = []
    for ws in workspaces:
        members = db.execute(
            select(WorkspaceMember).where(WorkspaceMember.workspace_id == ws.id)
        ).scalars().all()
        results.append(_format_workspace(ws, members, now))

    return success_response(results)


# ---------------------------------------------------------------------------
# GET /v1/workspaces/{workspace_id} — Get workspace
# ---------------------------------------------------------------------------

@router.get("/{workspace_id}")
async def get_workspace(
    workspace_id: str,
    db: Session = Depends(get_db),
):
    """Get workspace details by ID or slug."""
    workspace = db.execute(
        select(Workspace).where(_workspace_filter(workspace_id))
    ).scalar_one_or_none()

    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")

    members = db.execute(
        select(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace.id)
    ).scalars().all()

    now = datetime.now(timezone.utc)
    return success_response(_format_workspace(workspace, members, now))


# ---------------------------------------------------------------------------
# PATCH /v1/workspaces/{workspace_id} — Update workspace
# ---------------------------------------------------------------------------

@router.patch("/{workspace_id}")
async def update_workspace(
    workspace_id: str,
    body: WorkspaceUpdateRequest,
    db: Session = Depends(get_db),
):
    """Update workspace name, settings, or status."""
    workspace = db.execute(
        select(Workspace).where(_workspace_filter(workspace_id))
    ).scalar_one_or_none()

    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")

    if body.name is not None:
        workspace.name = body.name
    if body.settings is not None:
        workspace.settings = body.settings
    if body.status is not None:
        workspace.status = body.status

    db.commit()
    db.refresh(workspace)

    members = db.execute(
        select(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace.id)
    ).scalars().all()

    now = datetime.now(timezone.utc)
    return success_response(_format_workspace(workspace, members, now))


# ---------------------------------------------------------------------------
# POST /v1/workspaces/{workspace_id}/claim — Claim workspace ownership
# ---------------------------------------------------------------------------

@router.post("/{workspace_id}/claim")
async def claim_workspace(
    workspace_id: str,
    db: Session = Depends(get_db),
    authorization: Optional[str] = Header(None),
):
    """
    Claim ownership of a workspace.

    Requires a valid Firebase bearer token. Sets creator_email on the workspace
    so the user can access it without a workspace token.
    """
    bearer = _extract_bearer(authorization)
    if not bearer:
        return json_response(ResponseCode.UNAUTHORIZED, "Bearer token required")

    from app.firebase_auth import verify_firebase_token
    email = verify_firebase_token(bearer)
    if not email:
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid or expired token")

    workspace = db.execute(
        select(Workspace).where(_workspace_filter(workspace_id))
    ).scalar_one_or_none()

    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")

    if workspace.creator_email and workspace.creator_email != email:
        return json_response(ResponseCode.FORBIDDEN, "Workspace already claimed by another user")

    workspace.creator_email = email
    db.commit()
    db.refresh(workspace)

    members = db.execute(
        select(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace.id)
    ).scalars().all()

    now = datetime.now(timezone.utc)
    return success_response(_format_workspace(workspace, members, now))


# ---------------------------------------------------------------------------
# POST /v1/workspaces/{workspace_id}/rotate-token
# ---------------------------------------------------------------------------

@router.post("/{workspace_id}/rotate-token")
async def rotate_token(
    workspace_id: str,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Rotate the workspace token. Old token immediately stops working.

    Requires either the current workspace token or Firebase bearer auth
    from the workspace owner.
    """
    workspace = db.execute(
        select(Workspace).where(_workspace_filter(workspace_id))
    ).scalar_one_or_none()

    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")

    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    new_token = secrets.token_urlsafe(32)
    workspace.password_hash = new_token
    db.commit()

    return success_response({
        "workspace_id": str(workspace.id),
        "token": new_token,
    })


# ---------------------------------------------------------------------------
# DELETE /v1/workspaces/{workspace_id}/members/{agent_name}
# ---------------------------------------------------------------------------

@router.delete("/{workspace_id}/members/{agent_name}")
async def remove_member(
    workspace_id: str,
    agent_name: str,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Remove an agent from a workspace."""
    workspace = db.execute(
        select(Workspace).where(_workspace_filter(workspace_id))
    ).scalar_one_or_none()

    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")

    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    member = db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.agent_name == agent_name,
        )
    ).scalar_one_or_none()

    if not member:
        return json_response(ResponseCode.NOT_FOUND, "Member not found")

    db.delete(member)
    db.commit()

    return success_response({"agent_name": agent_name, "removed": True})


# ---------------------------------------------------------------------------
# GET /v1/workspaces/{workspace_id}/channels/{channel_name}
# ---------------------------------------------------------------------------

@router.get("/{workspace_id}/channels/{channel_name}")
async def get_channel(
    workspace_id: str,
    channel_name: str,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Get channel details."""
    workspace = db.execute(
        select(Workspace).where(_workspace_filter(workspace_id))
    ).scalar_one_or_none()
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    channel = db.execute(
        select(Channel).where(
            Channel.workspace_id == workspace.id,
            Channel.name == channel_name,
        )
    ).scalar_one_or_none()
    if not channel:
        return json_response(ResponseCode.NOT_FOUND, "Channel not found")

    return success_response(_format_channel(channel))


# ---------------------------------------------------------------------------
# PATCH /v1/workspaces/{workspace_id}/channels/{channel_name}
# ---------------------------------------------------------------------------

@router.patch("/{workspace_id}/channels/{channel_name}")
async def update_channel(
    workspace_id: str,
    channel_name: str,
    body: ChannelUpdateRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Update channel title or status."""
    workspace = db.execute(
        select(Workspace).where(_workspace_filter(workspace_id))
    ).scalar_one_or_none()
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    channel = db.execute(
        select(Channel).where(
            Channel.workspace_id == workspace.id,
            Channel.name == channel_name,
        )
    ).scalar_one_or_none()
    if not channel:
        return json_response(ResponseCode.NOT_FOUND, "Channel not found")

    if body.title is not None:
        channel.title = body.title
        if not body.auto_title:
            channel.title_manually_set = True
    if body.status is not None:
        channel.status = body.status
    if body.starred is not None:
        channel.starred = body.starred

    db.commit()
    db.refresh(channel)
    return success_response(_format_channel(channel))


# ---------------------------------------------------------------------------
# DELETE /v1/workspaces/{workspace_id} — Delete workspace
# ---------------------------------------------------------------------------

@router.delete("/{workspace_id}")
async def delete_workspace(
    workspace_id: str,
    db: Session = Depends(get_db),
):
    """Soft-delete a workspace (set status to 'deleted')."""
    workspace = db.execute(
        select(Workspace).where(_workspace_filter(workspace_id))
    ).scalar_one_or_none()

    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")

    workspace.status = "deleted"
    db.commit()

    return success_response({"workspaceId": str(workspace.id), "status": "deleted"})
