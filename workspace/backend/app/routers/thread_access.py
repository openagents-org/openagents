# -*- coding: utf-8 -*-
"""Thread ownership & access (permission model v1.1, spec §4).

    PATCH /v1/channels/{name} {network, visibility?, participants_can_invite?, owner_email?}
          visibility / switch: owner or admin (machine ok)
          owner_email: owner (hand over) or admin (forced transfer) — audited as
          event `network.channel.transfer`
    POST  /v1/channels/{name}/join {network}      public threads: self-join
    GET   /v1/admin/private-threads?network=      admin: METADATA of private threads

`visibility` accepts 'private' | 'public' and the legacy alias 'workspace'
(→ 'public'); responses always say 'public'.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, Header, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Channel, ChannelHumanMember, EventRecord
from app.response import ResponseCode, json_response, success_response
from app.routers.network import _emit_event_blocking
from app.routers.sharing import (
    _Ctx,
    _actor_name,
    _actor_source,
    _display_names,
    _get_channel,
    _is_workspace_member,
    _load,
    _norm,
    _valid_email,
)
from app.services.access_model import (
    add_channel_participant,
    can_view_channel,
    channel_participant_emails,
    normalize_visibility,
)
from app.services.notify import notify
from openagents.core.onm_events import Event

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["thread-access"])


class ThreadAccessPatch(BaseModel):
    network: str
    visibility: Optional[str] = None
    participants_can_invite: Optional[bool] = None
    owner_email: Optional[str] = None


def channel_access_summary(db: Session, ch: Channel) -> dict:
    return {
        "name": ch.name,
        "title": ch.title or ch.name,
        "visibility": normalize_visibility(ch.visibility, "public") or "public",
        "owner_email": _norm(ch.owner_email),
        "participants_can_invite": bool(ch.participants_can_invite),
        "director_email": _norm(ch.director_email),
        "participant_count": len(channel_participant_emails(db, ch)),
    }


def is_channel_owner(ctx: _Ctx, ch: Channel) -> bool:
    owner = _norm(ch.owner_email)
    if not owner:
        return False
    if ctx.viewer.is_agent:
        return ctx.viewer.owner_email == owner
    return bool(ctx.viewer.email) and ctx.viewer.email == owner


@router.patch("/channels/{channel}")
def update_thread_access(
    channel: str,
    body: ThreadAccessPatch,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    ctx, err = _load(db, body.network, x_workspace_token, authorization)
    if err:
        return err
    ch = _get_channel(db, ctx, channel)
    if ch is None:
        return json_response(ResponseCode.NOT_FOUND, "Thread not found")
    can_read = can_view_channel(db, ctx.wid, ctx.viewer, ch)
    if not can_read and not ctx.is_admin:
        return json_response(ResponseCode.NOT_FOUND, "Thread not found")
    owner = is_channel_owner(ctx, ch)
    is_admin = ctx.is_admin
    changed = {}

    if body.visibility is not None:
        vis = normalize_visibility(body.visibility)
        if vis not in ("private", "public"):
            return json_response(ResponseCode.BAD_REQUEST, "visibility must be 'private' or 'public'")
        if not (owner or is_admin):
            return json_response(ResponseCode.FORBIDDEN, "Only the thread's owner or an admin can change its visibility")
        if vis != (normalize_visibility(ch.visibility, "public") or "public"):
            ch.visibility = vis
            changed["visibility"] = vis
            if vis == "private":
                # Whoever locks it must not lock themselves out; the owner stays in.
                if ctx.viewer.email:
                    add_channel_participant(db, ch, ctx.viewer.email)
                if _norm(ch.owner_email):
                    add_channel_participant(db, ch, ch.owner_email)

    if body.participants_can_invite is not None:
        if not (owner or is_admin):
            return json_response(ResponseCode.FORBIDDEN, "Only the thread's owner or an admin can change this switch")
        if bool(body.participants_can_invite) != bool(ch.participants_can_invite):
            ch.participants_can_invite = bool(body.participants_can_invite)
            changed["participants_can_invite"] = ch.participants_can_invite

    if body.owner_email is not None:
        new_owner = _norm(body.owner_email)
        if not _valid_email(new_owner):
            return json_response(ResponseCode.BAD_REQUEST, "owner_email must be a valid email")
        if not (owner or is_admin):
            return json_response(ResponseCode.FORBIDDEN, "Only the thread's owner can hand it over; an admin can force a transfer")
        if not _is_workspace_member(db, ctx.workspace, new_owner):
            return json_response(ResponseCode.BAD_REQUEST, "The new owner must be a member of this workspace")
        previous = _norm(ch.owner_email)
        if new_owner != previous:
            ch.owner_email = new_owner
            add_channel_participant(db, ch, new_owner)
            changed["owner_email"] = new_owner
            forced = not owner
            db.flush()
            evt = Event(
                type="network.channel.transfer",
                source=_actor_source(ctx),
                target=f"channel/{ch.name}",
                payload={
                    "channel": ch.name,
                    "from": previous,
                    "to": new_owner,
                    "by": ctx.viewer.email or ctx.viewer.label,
                    "forced": forced,
                },
                metadata={"sender_email": ctx.viewer.email} if ctx.viewer.email else {},
            )
            try:
                _emit_event_blocking(evt, ctx.workspace, db, token=ctx.workspace.password_hash)
            except Exception:
                logger.warning("thread_access: transfer event failed for %s", ch.name, exc_info=True)
            if new_owner != ctx.viewer.email:
                notify(
                    db, ctx.wid,
                    source=_actor_source(ctx),
                    title=f"{_actor_name(db, ctx)} made you the owner of {ch.title or ch.name}",
                    message="You now control who can see this thread.",
                    recipient_email=new_owner,
                    kind="share",
                    channel_name=ch.name,
                    action_ref=f"channel:{ch.name}",
                )
            logger.info("thread_access: %s transferred %s from %s to %s (forced=%s)",
                        ctx.viewer.email or ctx.viewer.label, ch.name, previous, new_owner, forced)

    db.commit()
    return success_response({**channel_access_summary(db, ch), "changed": changed})


@router.post("/channels/{channel}/join")
def join_thread(
    channel: str,
    body: dict,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Self-join a public thread (adds a channel_human_members row)."""
    network = (body or {}).get("network") if isinstance(body, dict) else None
    if not network:
        return json_response(ResponseCode.BAD_REQUEST, "network is required")
    ctx, err = _load(db, network, x_workspace_token, authorization)
    if err:
        return err
    if not ctx.viewer.email:
        return json_response(ResponseCode.BAD_REQUEST, "Joining a thread needs a signed-in person")
    ch = _get_channel(db, ctx, channel)
    if ch is None:
        return json_response(ResponseCode.NOT_FOUND, "Thread not found")
    if (normalize_visibility(ch.visibility, "public") or "public") != "public":
        if ctx.viewer.email in channel_participant_emails(db, ch):
            return success_response({"joined": True, "already_participant": True, "channel": ch.name})
        return json_response(ResponseCode.FORBIDDEN, "This thread is private — ask its owner to add you")
    added = add_channel_participant(db, ch, ctx.viewer.email)
    db.commit()
    return success_response({"joined": True, "already_participant": not added, "channel": ch.name})


@router.get("/admin/private-threads")
def admin_private_threads(
    network: str = Query(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Metadata only (never content) of every private thread, for admins:
    who owns it, how many people are in it, how much is there, when it last
    moved — enough to transfer an orphaned thread."""
    ctx, err = _load(db, network, x_workspace_token, authorization)
    if err:
        return err
    if not ctx.is_admin:
        return json_response(ResponseCode.FORBIDDEN, "Only an admin can list private threads")
    channels = db.execute(
        select(Channel).where(
            Channel.workspace_id == ctx.workspace.id,
            Channel.visibility == "private",
            Channel.status != "deleted",
        ).order_by(Channel.last_event_at.desc().nullslast(), Channel.created_at.desc())
    ).scalars().all()
    if not channels:
        return success_response({"threads": []})
    ids = [c.id for c in channels]
    participant_counts = dict(db.execute(
        select(ChannelHumanMember.channel_id, func.count()).where(ChannelHumanMember.channel_id.in_(ids))
        .group_by(ChannelHumanMember.channel_id)
    ).all())
    targets = [f"channel/{c.name}" for c in channels]
    message_counts = dict(db.execute(
        select(EventRecord.target, func.count()).where(
            EventRecord.network_id == ctx.workspace.id,
            EventRecord.type == "workspace.message.posted",
            EventRecord.target.in_(targets),
        ).group_by(EventRecord.target)
    ).all())
    owner_names = _display_names(db, [_norm(c.owner_email) for c in channels if c.owner_email])
    threads = []
    for c in channels:
        owner = _norm(c.owner_email)
        threads.append({
            "name": c.name,
            "title": c.title or c.name,
            "owner_email": owner,
            "owner_display_name": owner_names.get(owner) if owner else None,
            "participants_can_invite": bool(c.participants_can_invite),
            "participant_count": int(participant_counts.get(c.id, 0)),
            "agent_count": len([p for p in (c.participants or []) if p.agent_name != "__no_response__"]),
            "message_count": int(message_counts.get(f"channel/{c.name}", 0)),
            "last_activity_at": c.last_event_at,
            "created_at": c.created_at.isoformat() if c.created_at else None,
            "created_by": c.created_by,
        })
    return success_response({"threads": threads})
