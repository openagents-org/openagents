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
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Header, Query
from pydantic import BaseModel, Field
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
    icon: Optional[str] = Field(default=None, max_length=32)
    visibility: Optional[str] = None
    participants_can_invite: Optional[bool] = None
    members_can_add_agents: Optional[bool] = None
    owner_email: Optional[str] = None


def channel_access_summary(db: Session, ch: Channel) -> dict:
    return {
        "name": ch.name,
        "title": ch.title or ch.name,
        "icon": ch.icon,
        "visibility": normalize_visibility(ch.visibility, "public") or "public",
        "owner_email": _norm(ch.owner_email),
        "participants_can_invite": bool(ch.participants_can_invite),
        "members_can_add_agents": bool(ch.members_can_add_agents),
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
    from app.services.access_model import can_manage_thread_settings
    manage = can_manage_thread_settings(db, ctx.viewer, ch)
    from app.services.personal_assistant import is_personal_channel, require_shareable_channel
    if is_personal_channel(db, ch) and (
        body.visibility is not None or body.owner_email is not None
        or body.participants_can_invite is not None or body.members_can_add_agents is not None
    ):
        require_shareable_channel(db, ch)
    changed = {}

    if 'icon' in body.model_fields_set:
        if not ctx.viewer.is_human or not owner:
            return json_response(ResponseCode.FORBIDDEN, 'Only the thread owner can change its icon')
        icon = body.icon.strip() if body.icon else None
        if icon and any(ord(c) < 32 for c in icon):
            return json_response(ResponseCode.BAD_REQUEST, 'Invalid thread icon')
        ch.icon = icon or None
        changed['icon'] = ch.icon

    if body.visibility is not None:
        vis = normalize_visibility(body.visibility)
        if vis not in ("private", "public"):
            return json_response(ResponseCode.BAD_REQUEST, "visibility must be 'private' or 'public'")
        if not manage:
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
        if not manage:
            return json_response(ResponseCode.FORBIDDEN, "Only the thread's owner or an admin can change this switch")
        if bool(body.participants_can_invite) != bool(ch.participants_can_invite):
            ch.participants_can_invite = bool(body.participants_can_invite)
            changed["participants_can_invite"] = ch.participants_can_invite

    if body.members_can_add_agents is not None:
        if not manage:
            return json_response(ResponseCode.FORBIDDEN, "Only the thread's owner or an admin can change this switch")
        if body.members_can_add_agents != ch.members_can_add_agents:
            ch.members_can_add_agents = body.members_can_add_agents
            changed["members_can_add_agents"] = ch.members_can_add_agents

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


class ThreadAgentSharingPatch(BaseModel):
    network: str
    enabled: Optional[bool] = None
    mode: Optional[Literal["no", "yes", "approval"]] = None


@router.patch("/channels/{channel}/my-agent-sharing")
def update_my_agent_sharing(
    channel: str,
    body: ThreadAgentSharingPatch,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    from app.models import ChannelAgentSharing
    ctx, err = _load(db, body.network, x_workspace_token, authorization)
    if err:
        return err
    ch = _get_channel(db, ctx, channel)
    if ch is None:
        return json_response(ResponseCode.NOT_FOUND, "Thread not found")
    if ctx.viewer.kind != "human" or not ctx.viewer.email:
        return json_response(ResponseCode.FORBIDDEN, "Sign in to manage sharing of your agents")
    if ctx.viewer.email not in channel_participant_emails(db, ch):
        return json_response(ResponseCode.FORBIDDEN, "Join this thread before sharing your agents")
    setting = db.get(ChannelAgentSharing, (ch.id, ctx.viewer.email))
    if setting is None:
        setting = ChannelAgentSharing(channel_id=ch.id, owner_email=ctx.viewer.email)
        db.add(setting)
    if body.mode is None and body.enabled is None:
        return json_response(ResponseCode.BAD_REQUEST, "Choose no, yes, or approval")
    setting.mode = body.mode or ("yes" if body.enabled else "no")
    setting.enabled = setting.mode == "yes"
    db.commit()
    return success_response({"enabled": setting.enabled, "mode": setting.mode})


class AgentSharingRequest(BaseModel):
    network: str


@router.post("/channels/{channel}/agents/{agent}/thread-access-requests")
def request_thread_agent_access(channel: str, agent: str, body: AgentSharingRequest,
    db: Session = Depends(get_db), x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None)):
    from app.config import config
    if not config.THREAD_AGENT_ACCESS_ENABLED:
        return json_response(ResponseCode.FORBIDDEN, "Thread access requests are not enabled yet")
    return _request_agent_sharing(channel, agent, body, db, x_workspace_token, authorization, thread_only=True)


@router.post("/channels/{channel}/agents/{agent}/sharing-requests")
def request_agent_sharing(channel: str, agent: str, body: AgentSharingRequest,
    db: Session = Depends(get_db), x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None)):
    return _request_agent_sharing(channel, agent, body, db, x_workspace_token, authorization)


def _request_agent_sharing(channel, agent, body, db, x_workspace_token, authorization, *, thread_only=False):
    from app.models import WorkspaceMember, ChannelMember
    from app.services import agent_sharing_requests, approvals
    from app.services.thread_agent_requests import request_access
    ctx, err = _load(db, body.network, x_workspace_token, authorization)
    if err:
        return err
    if ctx.viewer.kind != "human" or not ctx.viewer.email:
        return json_response(ResponseCode.FORBIDDEN, "Sign in to request agent sharing")
    ch = _get_channel(db, ctx, channel)
    if ch is None or not can_view_channel(db, ctx.wid, ctx.viewer, ch):
        return json_response(ResponseCode.NOT_FOUND, "Thread not found")
    # Serialize requests for this agent, including concurrent double clicks.
    member = db.execute(select(WorkspaceMember).where(WorkspaceMember.workspace_id == ctx.wid,
        WorkspaceMember.agent_name == agent).with_for_update()).scalar_one_or_none()
    people = channel_participant_emails(db, ch)
    owner = _norm(member.owner_email) if member else None
    if (not member or member.status == "removed" or not owner or ch.service_id
            or ctx.viewer.email not in people or owner not in people
            or not _is_workspace_member(db, ctx.workspace, ctx.viewer.email)
            or not db.get(ChannelMember, (ch.id, agent))):
        return json_response(ResponseCode.FORBIDDEN, "Join a thread with this agent and its owner to request sharing")
    if request_access(db, ctx.wid, ch, member, ctx.viewer.email) != "no":
        return json_response(ResponseCode.BAD_REQUEST, "You already have access to this agent in this thread")
    names = _display_names(db, [ctx.viewer.email])
    request = agent_sharing_requests.create_request(db, ctx.workspace, ch, member,
        ctx.viewer.email, names.get(ctx.viewer.email) or ctx.viewer.email, thread_only=thread_only)
    db.commit()
    return success_response(approvals.serialize_with_owner(db, request))


class ArtifactReference(BaseModel):
    kind: Literal["file", "knowledge", "browser"]
    id: str


class ThreadArtifactPatch(BaseModel):
    network: str
    artifact: Optional[ArtifactReference] = None


def _readable_artifact(db, ctx, reference):
    from app.models import FileRecord, KnowledgeEntry, BrowserTab
    from app.services.access_model import can_read_file, can_read_knowledge
    if not reference or reference.get("kind") not in ("file", "knowledge", "browser"):
        return False
    kind = reference["kind"]
    model = {"file": FileRecord, "knowledge": KnowledgeEntry, "browser": BrowserTab}[kind]
    row = db.get(model, reference.get("id"))
    if row is None or str(row.workspace_id) != ctx.wid or row.status != "active":
        return False
    if kind == "file":
        return can_read_file(db, ctx.wid, ctx.viewer, row)
    if kind == "knowledge":
        return can_read_knowledge(db, ctx.wid, ctx.viewer, row)
    # Browser tabs use workspace access, as their existing read/live-view routes do.
    return True


def _artifact_summary(db, ctx, channel):
    readable = _readable_artifact(db, ctx, channel.pinned_artifact)
    return {"artifact": channel.pinned_artifact if readable else None,
            "unavailable": bool(channel.pinned_artifact) and not readable,
            "can_pin": ctx.viewer.kind == "human" and is_channel_owner(ctx, channel)}


@router.get("/channels/{channel}/artifact")
def get_thread_artifact(channel: str, network: str = Query(...), db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None), authorization: Optional[str] = Header(None)):
    ctx, err = _load(db, network, x_workspace_token, authorization)
    if err:
        return err
    ch = _get_channel(db, ctx, channel)
    if ch is None or not can_view_channel(db, ctx.wid, ctx.viewer, ch):
        return json_response(ResponseCode.NOT_FOUND, "Thread not found")
    return success_response(_artifact_summary(db, ctx, ch))


@router.patch("/channels/{channel}/artifact")
def pin_thread_artifact(channel: str, body: ThreadArtifactPatch, db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None), authorization: Optional[str] = Header(None)):
    ctx, err = _load(db, body.network, x_workspace_token, authorization)
    if err:
        return err
    ch = db.execute(select(Channel).where(Channel.workspace_id == ctx.wid, Channel.name == channel,
        Channel.status != "deleted").with_for_update()).scalar_one_or_none()
    if ch is None or not can_view_channel(db, ctx.wid, ctx.viewer, ch):
        return json_response(ResponseCode.NOT_FOUND, "Thread not found")
    if ctx.viewer.kind != "human" or not is_channel_owner(ctx, ch):
        return json_response(ResponseCode.FORBIDDEN, "Only the thread owner can pin its default artifact")
    reference = body.artifact.model_dump() if body.artifact else None
    if reference and not _readable_artifact(db, ctx, reference):
        return json_response(ResponseCode.NOT_FOUND, "Artifact is unavailable or you do not have access")
    ch.pinned_artifact = reference
    db.commit()
    return success_response(_artifact_summary(db, ctx, ch))


class ThreadLinkRequest(BaseModel):
    network: str
    session_id: str


def _direct_link_key(ctx, value):
    from app.routers.events import _dm_addresses, _dm_viewer_scope
    if not value.startswith('dm:'):
        return None
    pair = value[3:].split(',')
    if any(p.lower() == 'human:system' for p in pair):
        return None
    if len(pair) != 2 or any(not (p.startswith('human:') or p.startswith('openagents:')) or not p.split(':', 1)[1] for p in pair):
        return None
    # Apply the same participant/legacy visibility rule as direct-message reads.
    if _dm_viewer_scope(ctx.viewer):
        mine = _dm_addresses(ctx.viewer) or []
        has_person = any(p.startswith('human:') and '@' in p for p in pair)
        if has_person and not any(p in mine for p in pair):
            return None
    return 'dm:' + ','.join(sorted(pair))


@router.post('/thread-links')
def get_thread_link(body: ThreadLinkRequest, db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None), authorization: Optional[str] = Header(None)):
    from app.models import DirectThreadLink
    from sqlalchemy.exc import IntegrityError
    ctx, err = _load(db, body.network, x_workspace_token, authorization)
    if err:
        return err
    if not body.session_id.startswith('dm:'):
        channel = _get_channel(db, ctx, body.session_id)
        if channel is None or not can_view_channel(db, ctx.wid, ctx.viewer, channel):
            return json_response(ResponseCode.NOT_FOUND, 'Thread not found')
        return success_response({'id': str(channel.id), 'session_id': channel.name})
    key = _direct_link_key(ctx, body.session_id)
    if key is None:
        return json_response(ResponseCode.NOT_FOUND, 'Thread not found')
    query = select(DirectThreadLink).where(DirectThreadLink.workspace_id == ctx.wid, DirectThreadLink.session_key == key)
    link = db.execute(query).scalar_one_or_none()
    if link is None:
        link = DirectThreadLink(workspace_id=ctx.wid, session_key=key)
        try:
            with db.begin_nested():
                db.add(link)
                db.flush()
        except IntegrityError:
            link = db.execute(query).scalar_one()
        db.commit()
    return success_response({'id': str(link.id), 'session_id': key})


@router.get('/thread-links/{thread_id}')
def resolve_thread_link(thread_id: str, network: str = Query(...), db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None), authorization: Optional[str] = Header(None)):
    from uuid import UUID
    from app.models import DirectThreadLink
    ctx, err = _load(db, network, x_workspace_token, authorization)
    if err:
        return err
    try:
        thread_id = str(UUID(thread_id))
    except ValueError:
        return json_response(ResponseCode.NOT_FOUND, 'Thread not found')
    channel = db.execute(select(Channel).where(Channel.id == thread_id, Channel.workspace_id == ctx.wid, Channel.status != 'deleted')).scalar_one_or_none()
    if channel is not None and can_view_channel(db, ctx.wid, ctx.viewer, channel):
        return success_response({'id': thread_id, 'session_id': channel.name})
    link = db.execute(select(DirectThreadLink).where(DirectThreadLink.id == thread_id, DirectThreadLink.workspace_id == ctx.wid)).scalar_one_or_none()
    if link is not None and _direct_link_key(ctx, link.session_key):
        return success_response({'id': thread_id, 'session_id': link.session_key})
    return json_response(ResponseCode.NOT_FOUND, 'Thread not found')


class DirectPreferencePatch(BaseModel):
    network: str
    pinned: Optional[bool] = None
    starred: Optional[bool] = None


@router.patch('/thread-links/{thread_id}/preferences')
def update_direct_preferences(thread_id: str, body: DirectPreferencePatch, db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None), authorization: Optional[str] = Header(None)):
    from uuid import UUID
    from app.models import DirectThreadLink, DirectThreadPreference
    from sqlalchemy.exc import IntegrityError
    ctx, err = _load(db, body.network, x_workspace_token, authorization)
    if err:
        return err
    if not ctx.viewer.is_human or not ctx.viewer.email:
        return json_response(ResponseCode.FORBIDDEN, 'Sign in to save personal preferences')
    try:
        thread_id = str(UUID(thread_id))
    except ValueError:
        return json_response(ResponseCode.NOT_FOUND, 'Thread not found')
    link = db.execute(select(DirectThreadLink).where(DirectThreadLink.id == thread_id, DirectThreadLink.workspace_id == ctx.wid)).scalar_one_or_none()
    if link is None or not _direct_link_key(ctx, link.session_key):
        return json_response(ResponseCode.NOT_FOUND, 'Thread not found')
    key = {'thread_id': thread_id, 'user_email': ctx.viewer.email}
    pref = db.get(DirectThreadPreference, key)
    if pref is None:
        try:
            with db.begin_nested():
                pref = DirectThreadPreference(**key)
                db.add(pref)
                db.flush()
        except IntegrityError:
            pref = db.get(DirectThreadPreference, key)
    if body.pinned is not None:
        pref.pinned = body.pinned
    if body.starred is not None:
        pref.starred = body.starred
    db.commit()
    return success_response({'pinned': pref.pinned, 'starred': pref.starred})


class ThreadAgentInstructions(BaseModel):
    network: str
    instructions: str = Field(default='', max_length=8000)
    review_after: Optional[str] = Field(default=None, max_length=200)


@router.put('/channels/{channel}/agents/{agent}/collaboration')
def save_thread_agent_instructions(channel: str, agent: str, body: ThreadAgentInstructions,
    db: Session = Depends(get_db), x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None)):
    from app.config import config
    from app.models import WorkspaceMember, ChannelMember
    from app.services import thread_collaboration
    from app.services.access_model import can_manage_thread_settings
    if not config.THREAD_COLLABORATION_ENABLED:
        return json_response(ResponseCode.FORBIDDEN, 'Thread collaboration settings are not enabled yet')
    ctx, err = _load(db, body.network, x_workspace_token, authorization)
    if err:
        return err
    ch = _get_channel(db, ctx, channel)
    if not ch or not can_view_channel(db, ctx.wid, ctx.viewer, ch):
        return json_response(ResponseCode.NOT_FOUND, 'Thread not found')
    ch = db.execute(select(Channel).where(Channel.id == ch.id).with_for_update()).scalar_one()
    member = db.execute(select(WorkspaceMember).where(WorkspaceMember.workspace_id == ctx.wid,
        WorkspaceMember.agent_name == agent, WorkspaceMember.status != 'removed')).scalar_one_or_none()
    if (ctx.viewer.kind != 'human' or not member or ch.service_id
            or ctx.viewer.email not in channel_participant_emails(db, ch)
            or not db.get(ChannelMember, (ch.id, agent))
            or not (can_manage_thread_settings(db, ctx.viewer, ch) or _norm(member.owner_email) == ctx.viewer.email)):
        return json_response(ResponseCode.FORBIDDEN, 'Only the thread manager or agent owner can edit this role')
    if body.review_after and (body.review_after == agent or not db.get(ChannelMember, (ch.id, body.review_after))):
        return json_response(ResponseCode.BAD_REQUEST, 'Choose another agent in this thread to review')
    values = thread_collaboration.save(db, ctx.wid, ch.name, agent, body.instructions.strip(), body.review_after, ctx.viewer.email)
    db.commit()
    return success_response({'agents': values})


@router.delete('/channels/{channel}/agents/{agent}/access/{email}')
def revoke_thread_agent_access(channel: str, agent: str, email: str, network: str = Query(...),
    db: Session = Depends(get_db), x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None)):
    from app.models import WorkspaceMember
    from app.services.access_model import revoke_grants
    ctx, err = _load(db, network, x_workspace_token, authorization)
    if err:
        return err
    ch = _get_channel(db, ctx, channel)
    member = db.execute(select(WorkspaceMember).where(WorkspaceMember.workspace_id == ctx.wid,
        WorkspaceMember.agent_name == agent)).scalar_one_or_none()
    if not ch or not member or not can_view_channel(db, ctx.wid, ctx.viewer, ch):
        return json_response(ResponseCode.NOT_FOUND, 'Thread or agent not found')
    if not ctx.viewer.is_human or _norm(member.owner_email) != ctx.viewer.email:
        return json_response(ResponseCode.FORBIDDEN, 'Only the agent owner can revoke this access')
    revoke_grants(db, ctx.wid, resource_kind='thread_agent', resource_id=f'{ch.id}:{agent}',
        grantee_kind='human', grantee_id=_norm(email), by=ctx.viewer.email)
    db.commit()
    return success_response({'revoked': True})
