# -*- coding: utf-8 -*-
"""
Channel human members management — add/remove humans to channels.

POST   /v1/channels/{cid}/members/humans           Add human member
DELETE /v1/channels/{cid}/members/humans/{email}    Remove human member
GET    /v1/channels/{cid}/members                  Get all members (agent + human)
PATCH  /v1/channels/{cid}/members/humans/{email}/read  Update read position
"""

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Channel, ChannelHumanMember, ChannelMember, Workspace
from app.response import ResponseCode, json_response, success_response

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/channels", tags=["Channel Members"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_channel_with_access(db: Session, channel_id: str, token: str) -> Optional[Channel]:
    """Fetch channel and verify workspace-level access."""
    channel = db.execute(
        select(Channel).where(Channel.id == channel_id)
    ).scalar_one_or_none()
    if not channel:
        return None
    ws = db.execute(
        select(Workspace).where(Workspace.id == channel.workspace_id)
    ).scalar_one_or_none()
    if not ws:
        return None
    if ws.password_hash and token != ws.password_hash:
        return None
    return channel


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class AddHumanMemberRequest(BaseModel):
    user_email: str
    role: str = "member"  # admin | member | viewer


class UpdateReadPositionRequest(BaseModel):
    last_read_event_id: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/{channel_id}/members/humans")
def add_human_member(
    channel_id: str,
    body: AddHumanMemberRequest,
    token: str = Header(alias="x-workspace-token", default=""),
    db: Session = Depends(get_db),
):
    channel = _get_channel_with_access(db, channel_id, token)
    if not channel:
        return json_response(ResponseCode.NOT_FOUND, "Channel not found or unauthorized")

    # Check existing
    existing = db.execute(
        select(ChannelHumanMember).where(
            ChannelHumanMember.channel_id == channel_id,
            ChannelHumanMember.user_email == body.user_email.lower(),
        )
    ).scalar_one_or_none()
    if existing:
        return json_response(ResponseCode.CONFLICT, "User is already a member of this channel")

    member = ChannelHumanMember(
        channel_id=channel_id,
        user_email=body.user_email.lower(),
        role=body.role,
    )
    db.add(member)
    db.commit()

    return success_response({
        "channelId": channel_id,
        "email": member.user_email,
        "role": member.role,
    })


@router.delete("/{channel_id}/members/humans/{email}")
def remove_human_member(
    channel_id: str,
    email: str,
    token: str = Header(alias="x-workspace-token", default=""),
    db: Session = Depends(get_db),
):
    channel = _get_channel_with_access(db, channel_id, token)
    if not channel:
        return json_response(ResponseCode.NOT_FOUND, "Channel not found or unauthorized")

    member = db.execute(
        select(ChannelHumanMember).where(
            ChannelHumanMember.channel_id == channel_id,
            ChannelHumanMember.user_email == email.lower(),
        )
    ).scalar_one_or_none()
    if not member:
        return json_response(ResponseCode.NOT_FOUND, "Human member not found")

    db.delete(member)
    db.commit()

    return success_response({"removed": email.lower()})


@router.get("/{channel_id}/members")
def get_all_members(
    channel_id: str,
    token: str = Header(alias="x-workspace-token", default=""),
    db: Session = Depends(get_db),
):
    channel = _get_channel_with_access(db, channel_id, token)
    if not channel:
        return json_response(ResponseCode.NOT_FOUND, "Channel not found or unauthorized")

    # Agent members
    agent_members = db.execute(
        select(ChannelMember).where(ChannelMember.channel_id == channel_id)
    ).scalars().all()

    # Human members
    human_members = db.execute(
        select(ChannelHumanMember).where(ChannelHumanMember.channel_id == channel_id)
    ).scalars().all()

    return success_response({
        "agents": [{"agentName": m.agent_name} for m in agent_members],
        "humans": [{
            "email": m.user_email,
            "role": m.role,
            "lastReadEventId": m.last_read_event_id,
            "joinedAt": m.joined_at.isoformat() if m.joined_at else None,
        } for m in human_members],
    })


@router.patch("/{channel_id}/members/humans/{email}/read")
def update_read_position(
    channel_id: str,
    email: str,
    body: UpdateReadPositionRequest,
    token: str = Header(alias="x-workspace-token", default=""),
    db: Session = Depends(get_db),
):
    channel = _get_channel_with_access(db, channel_id, token)
    if not channel:
        return json_response(ResponseCode.NOT_FOUND, "Channel not found or unauthorized")

    member = db.execute(
        select(ChannelHumanMember).where(
            ChannelHumanMember.channel_id == channel_id,
            ChannelHumanMember.user_email == email.lower(),
        )
    ).scalar_one_or_none()
    if not member:
        return json_response(ResponseCode.NOT_FOUND, "Human member not found")

    member.last_read_event_id = body.last_read_event_id
    db.commit()

    return success_response({"email": email.lower(), "lastReadEventId": body.last_read_event_id})
