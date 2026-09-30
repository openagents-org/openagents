# -*- coding: utf-8 -*-
"""
Conversation sharing endpoints — public snapshot links.

POST   /v1/shares                  Create a share snapshot
GET    /v1/shares                  List shares for a workspace
GET    /v1/shares/public/{token}   View a shared snapshot (no auth)
DELETE /v1/shares/{share_id}       Soft-delete a share
"""

import logging
import secrets
from typing import Optional

from fastapi import APIRouter, Depends, Header, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Channel, EventRecord, ShareSnapshot, Workspace
from app.response import ResponseCode, json_response, success_response
from app.routers.network import (
    _resolve_workspace,
    _verify_workspace_access,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["Shares"])

# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class CreateShareRequest(BaseModel):
    network: str
    channel: str
    created_by: Optional[str] = "human:user"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _serialize_snapshot(s: ShareSnapshot) -> dict:
    return {
        "id": s.id,
        "workspace_id": str(s.workspace_id),
        "channel_name": s.channel_name,
        "title": s.title,
        "share_token": s.share_token,
        "message_count": s.message_count,
        "status": s.status,
        "created_at": s.created_at.isoformat() if s.created_at else None,
    }


def _extract_bearer(authorization: Optional[str]) -> Optional[str]:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return None


# ---------------------------------------------------------------------------
# POST /v1/shares — create a snapshot
# ---------------------------------------------------------------------------

@router.post("/shares")
async def create_share(
    body: CreateShareRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace = _resolve_workspace(db, body.network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")

    bearer = _extract_bearer(authorization)
    if not _verify_workspace_access(workspace, x_workspace_token, bearer):
        return json_response(ResponseCode.UNAUTHORIZED, "Unauthorized")

    # v1.1: only someone who can read the thread may snapshot it.
    from app.services.visibility import can_view_channel_name, resolve_viewer
    _viewer = resolve_viewer(db, workspace, x_workspace_token, authorization)
    if _viewer.is_human and not can_view_channel_name(db, str(workspace.id), _viewer, body.channel):
        return json_response(ResponseCode.FORBIDDEN, "No access to this thread")

    channel_target = f"channel/{body.channel}"
    events = db.execute(
        select(EventRecord)
        .where(
            EventRecord.network_id == str(workspace.id),
            EventRecord.target == channel_target,
            EventRecord.type == "workspace.message.posted",
        )
        .order_by(EventRecord.timestamp.asc())
    ).scalars().all()

    # Filter to chat messages only (exclude status, thinking, todos, loading)
    chat_messages = []
    for ev in events:
        payload = ev.payload or {}
        msg_type = payload.get("message_type", "chat")
        if msg_type != "chat":
            continue
        chat_messages.append({
            "sender_name": payload.get("sender_name", ev.source),
            "sender_type": "human" if ev.source.startswith("human:") else "agent",
            "content": payload.get("content", ""),
            "created_at": ev.created_at.isoformat() if ev.created_at else None,
        })

    if not chat_messages:
        return json_response(ResponseCode.BAD_REQUEST, "No chat messages found in this channel")

    # Resolve thread title
    channel = db.execute(
        select(Channel).where(
            Channel.workspace_id == str(workspace.id),
            Channel.name == body.channel,
        )
    ).scalar_one_or_none()
    title = channel.title if channel and channel.title else body.channel

    share_token = secrets.token_urlsafe(9)

    snapshot = ShareSnapshot(
        workspace_id=str(workspace.id),
        channel_name=body.channel,
        title=title,
        created_by=body.created_by or "human:user",
        snapshot_data=chat_messages,
        share_token=share_token,
        message_count=len(chat_messages),
    )
    db.add(snapshot)
    db.commit()
    db.refresh(snapshot)

    result = _serialize_snapshot(snapshot)
    return success_response(result)


# ---------------------------------------------------------------------------
# GET /v1/shares/public/{share_token} — public, no auth
# ---------------------------------------------------------------------------

@router.get("/shares/public/{share_token}")
async def get_public_share(
    share_token: str,
    db: Session = Depends(get_db),
):
    snapshot = db.execute(
        select(ShareSnapshot).where(
            ShareSnapshot.share_token == share_token,
            ShareSnapshot.status == "active",
        )
    ).scalar_one_or_none()

    if not snapshot:
        return json_response(ResponseCode.NOT_FOUND, "Share not found")

    return success_response({
        "id": snapshot.id,
        "title": snapshot.title,
        "messages": snapshot.snapshot_data,
        "message_count": snapshot.message_count,
        "created_at": snapshot.created_at.isoformat() if snapshot.created_at else None,
    })


# ---------------------------------------------------------------------------
# GET /v1/shares — list shares for workspace
# ---------------------------------------------------------------------------

@router.get("/shares")
async def list_shares(
    network: str = Query(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace = _resolve_workspace(db, network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")

    bearer = _extract_bearer(authorization)
    if not _verify_workspace_access(workspace, x_workspace_token, bearer):
        return json_response(ResponseCode.UNAUTHORIZED, "Unauthorized")

    snapshots = db.execute(
        select(ShareSnapshot)
        .where(
            ShareSnapshot.workspace_id == str(workspace.id),
            ShareSnapshot.status == "active",
        )
        .order_by(ShareSnapshot.created_at.desc())
    ).scalars().all()

    return success_response([_serialize_snapshot(s) for s in snapshots])


# ---------------------------------------------------------------------------
# DELETE /v1/shares/{share_id} — soft-delete
# ---------------------------------------------------------------------------

@router.delete("/shares/{share_id}")
async def delete_share(
    share_id: str,
    network: str = Query(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace = _resolve_workspace(db, network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")

    bearer = _extract_bearer(authorization)
    if not _verify_workspace_access(workspace, x_workspace_token, bearer):
        return json_response(ResponseCode.UNAUTHORIZED, "Unauthorized")

    snapshot = db.execute(
        select(ShareSnapshot).where(
            ShareSnapshot.id == share_id,
            ShareSnapshot.workspace_id == str(workspace.id),
        )
    ).scalar_one_or_none()

    if not snapshot:
        return json_response(ResponseCode.NOT_FOUND, "Share not found")

    snapshot.status = "deleted"
    db.commit()

    return success_response({"id": share_id, "status": "deleted"})
