# -*- coding: utf-8 -*-
"""Sharing (v1.1 M2) — thread participants, agent grants, directory, pins, requests.

The explicit sharing actions on top of M1's visibility model
(app/services/visibility.py):

  Thread participants (the ACL of a private thread, the roster of any thread)
    GET    /v1/channels/{channel}/participants
    POST   /v1/channels/{channel}/participants        {network, email, note?}
    DELETE /v1/channels/{channel}/participants/{email}
    GET    /v1/channels/{channel}/share-preview        what an invitee will see

  Agent directory + grants (who may use a personal specialist)
    GET    /v1/agents/directory
    GET    /v1/agents/{agent}/grants
    POST   /v1/agents/{agent}/grants                   {network, email, note?}
    DELETE /v1/agents/{agent}/grants/{email}

  Pins and "start another request with this specialist"
    GET    /v1/agents/pins
    POST   /v1/agents/{agent}/pin  /  DELETE
    POST   /v1/agents/{agent}/requests                 {network, content, title?}

Permission model: machines (token-only callers) are fully trusted. A person
may manage a thread's participants when they are an admin/owner or a
participant themselves; a person may manage an agent's grants when they are
an admin/owner or the agent's owner. Sharing with someone who is not yet a
workspace member turns into a targeted WorkspaceInvite (target_kind/target_id)
so accepting the invite lands them on the thread or agent that motivated it
(see app/routers/invites.py).

Registered in app/main.py up front so milestone branches never touch main.py.
"""

import logging
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Dict, Iterable, List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Header, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.access import resolve_user_role, role_at_least, verify_workspace_access
from app.config import config
from app.database import get_db
from app.models import (
    AgentGrant,
    AgentPin,
    Channel,
    ChannelHumanMember,
    ChannelMember,
    EventRecord,
    FileRecord,
    User,
    Workspace,
    WorkspaceCollaborator,
    WorkspaceInvite,
    WorkspaceMember,
    WorkspaceMembership,
)
from app.response import ResponseCode, json_response, success_response
from app.routers.network import (
    _emit_event_blocking,
    _resolve_workspace,
    agent_runtime_fields,
    effective_agent_status,
    runtime_status_by_node,
)
from app.services.notify import notify
from app.services.visibility import (
    Viewer,
    add_channel_participant,
    can_use_agent,
    can_view_channel,
    channel_participant_emails,
    hidden_agent_names,
    is_agent_owner,
    remove_channel_participant,
    resolve_viewer,
)
from openagents.core.onm_events import Event

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["sharing"])

_KNOWLEDGE_REF_RE = re.compile(r"@knowledge:([A-Za-z0-9][A-Za-z0-9_\-]*)")
_RECENT_REQUESTS_LIMIT = 5


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------

class ShareToEmailRequest(BaseModel):
    network: str
    email: str
    note: Optional[str] = None


class AgentRequestCreate(BaseModel):
    network: str
    content: str
    title: Optional[str] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _norm(email: Optional[str]) -> Optional[str]:
    e = (email or "").strip().lower()
    return e or None


def _valid_email(email: Optional[str]) -> bool:
    if not email:
        return False
    parts = email.split("@")
    return len(parts) == 2 and all(parts) and not any(c.isspace() for c in email)


class _Ctx:
    """Resolved caller for one request: workspace, viewer, effective role."""

    __slots__ = ("workspace", "viewer", "role")

    def __init__(self, workspace: Workspace, viewer: Viewer, role: Optional[str]):
        self.workspace = workspace
        self.viewer = viewer
        self.role = role

    @property
    def wid(self) -> str:
        return str(self.workspace.id)

    @property
    def is_admin(self) -> bool:
        return self.viewer.machine or role_at_least(self.role, "admin")


def _load(db: Session, network: str, token: Optional[str], authorization: Optional[str]):
    """→ (ctx, None) or (None, error_response)."""
    workspace = _resolve_workspace(db, network) if network else None
    if workspace is None or workspace.status == "deleted":
        return None, json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not verify_workspace_access(workspace, token, authorization, db=db):
        return None, json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")
    viewer = resolve_viewer(db, workspace, token, authorization)
    role = "owner" if viewer.machine else resolve_user_role(db, workspace, authorization)
    return _Ctx(workspace, viewer, role), None


def _get_channel(db: Session, ctx: _Ctx, name: str) -> Optional[Channel]:
    return db.execute(
        select(Channel).where(
            Channel.workspace_id == ctx.workspace.id,
            Channel.name == name,
            Channel.status != "deleted",
        )
    ).scalar_one_or_none()


def _get_agent(db: Session, ctx: _Ctx, name: str) -> Optional[WorkspaceMember]:
    return db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == ctx.workspace.id,
            WorkspaceMember.agent_name == name,
            WorkspaceMember.status != "removed",
        )
    ).scalar_one_or_none()


def _display_names(db: Session, emails: Iterable[str]) -> Dict[str, Optional[str]]:
    emails = [e for e in set(emails) if e]
    if not emails:
        return {}
    rows = db.execute(select(User.email, User.display_name).where(User.email.in_(emails))).all()
    return {email: name for email, name in rows}


def _actor_name(db: Session, ctx: _Ctx) -> str:
    """How the caller is named in notifications: display name → email → a
    neutral label for machine callers (the token does not say which agent)."""
    if ctx.viewer.email:
        return _display_names(db, [ctx.viewer.email]).get(ctx.viewer.email) or ctx.viewer.email
    return "A teammate"


def _actor_source(ctx: _Ctx) -> str:
    return f"human:{ctx.viewer.email}" if ctx.viewer.email else "system:sharing"


def _is_workspace_member(db: Session, workspace: Workspace, email: str) -> bool:
    """Same notion of membership as app.access.resolve_user_role: an explicit
    membership row, or the legacy creator/collaborator email match."""
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if user is not None:
        row = db.execute(
            select(WorkspaceMembership.role).where(
                WorkspaceMembership.workspace_id == workspace.id,
                WorkspaceMembership.user_id == user.id,
            )
        ).first()
        if row is not None:
            return True
    if _norm(workspace.creator_email) == email:
        return True
    collab = db.execute(
        select(WorkspaceCollaborator.email).where(
            WorkspaceCollaborator.workspace_id == workspace.id,
            WorkspaceCollaborator.email == email,
        )
    ).first()
    return collab is not None


def _invite_url(token: str) -> str:
    return f"{config.FRONTEND_BASE_URL}/invite/{token}"


def _create_target_invite(db: Session, ctx: _Ctx, *, email: str, target_kind: str,
                          target_id: str, note: Optional[str]) -> WorkspaceInvite:
    """A member-role invite that lands on the thread/agent being shared."""
    invite = WorkspaceInvite(
        workspace_id=ctx.workspace.id,
        token=secrets.token_urlsafe(32),
        email=email,
        role="member",
        created_by=ctx.viewer.email,
        expires_at=datetime.now(timezone.utc) + timedelta(days=config.INVITE_TTL_DAYS),
        target_kind=target_kind,
        target_id=target_id,
        note=(note or "").strip() or None,
    )
    db.add(invite)
    db.flush()
    return invite


def _send_invite_mail(db: Session, ctx: _Ctx, invite: WorkspaceInvite) -> bool:
    """Best-effort: same email the workspace-level invite sends (no-op without
    a provider). The link is always returned to the caller regardless."""
    try:
        from app.services.email import send_invite_email
        return send_invite_email(
            to=invite.email,
            workspace_name=ctx.workspace.name,
            role=invite.role,
            invite_url=_invite_url(invite.token),
            invited_by=_actor_name(db, ctx) if ctx.viewer.email else None,
        )
    except Exception:
        logger.warning("sharing: invite email failed for %s", invite.email, exc_info=True)
        return False


def _invited_response(db: Session, ctx: _Ctx, invite: WorkspaceInvite, flag: str) -> dict:
    return success_response({
        flag: False,
        "invited": True,
        "email": invite.email,
        "invite_token": invite.token,
        "invite_url": _invite_url(invite.token),
        "email_sent": _send_invite_mail(db, ctx, invite),
    })


def _can_manage_channel(db: Session, ctx: _Ctx, channel: Channel) -> bool:
    if ctx.is_admin:
        return True
    return bool(ctx.viewer.email) and ctx.viewer.email in channel_participant_emails(db, channel)


def _can_manage_agent(ctx: _Ctx, member: WorkspaceMember) -> bool:
    return ctx.is_admin or is_agent_owner(ctx.viewer, member)


def _channel_title(channel: Channel) -> str:
    return channel.title or channel.name


def _agent_label(member: WorkspaceMember) -> str:
    return f"@{member.agent_name}"


def _channel_messages(db: Session, ctx: _Ctx, channel: Channel) -> List[dict]:
    rows = db.execute(
        select(EventRecord.payload).where(
            EventRecord.network_id == ctx.workspace.id,
            EventRecord.type == "workspace.message.posted",
            EventRecord.target == f"channel/{channel.name}",
        )
    ).scalars().all()
    return [p for p in rows if isinstance(p, dict)]


# ---------------------------------------------------------------------------
# Thread participants
# ---------------------------------------------------------------------------

@router.get("/channels/{channel}/participants")
def list_participants(
    channel: str,
    network: str = Query(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Humans (the ACL) and agents in a thread. Visible to anyone who may
    view the thread."""
    ctx, err = _load(db, network, x_workspace_token, authorization)
    if err:
        return err
    ch = _get_channel(db, ctx, channel)
    if ch is None:
        return json_response(ResponseCode.NOT_FOUND, "Thread not found")
    if not can_view_channel(db, ctx.wid, ctx.viewer, ch):
        return json_response(ResponseCode.FORBIDDEN, "No access to this thread")

    human_rows = db.execute(
        select(ChannelHumanMember)
        .where(ChannelHumanMember.channel_id == ch.id)
        .order_by(ChannelHumanMember.joined_at.asc())
    ).scalars().all()
    names = _display_names(db, [h.user_email for h in human_rows])
    humans = [{
        "email": h.user_email,
        "display_name": names.get(h.user_email),
        "joined_at": h.joined_at.isoformat() if h.joined_at else None,
    } for h in human_rows]

    agent_names = [p.agent_name for p in (ch.participants or []) if p.agent_name != "__no_response__"]
    members = {}
    if agent_names:
        members = {
            m.agent_name: m for m in db.execute(
                select(WorkspaceMember).where(
                    WorkspaceMember.workspace_id == ctx.workspace.id,
                    WorkspaceMember.agent_name.in_(agent_names),
                )
            ).scalars().all()
        }
    agents = []
    for name in agent_names:
        m = members.get(name)
        agents.append({
            "agent_name": name,
            "display_name": m.display_name if m else None,
            "owner_email": m.owner_email if m else None,
            "visibility": (m.visibility or "team") if m else "team",
        })

    return success_response({
        "channel": ch.name,
        "visibility": ch.visibility or "workspace",
        "director_email": ch.director_email,
        "humans": humans,
        "agents": agents,
    })


@router.post("/channels/{channel}/participants")
def add_participant(
    channel: str,
    body: ShareToEmailRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Add a person to a thread. Non-members get a targeted invite instead."""
    ctx, err = _load(db, body.network, x_workspace_token, authorization)
    if err:
        return err
    ch = _get_channel(db, ctx, channel)
    if ch is None:
        return json_response(ResponseCode.NOT_FOUND, "Thread not found")
    if not _can_manage_channel(db, ctx, ch):
        return json_response(ResponseCode.FORBIDDEN, "Only a participant or an admin can add people to this thread")
    email = _norm(body.email)
    if not _valid_email(email):
        return json_response(ResponseCode.BAD_REQUEST, "A valid email is required")

    if not _is_workspace_member(db, ctx.workspace, email):
        invite = _create_target_invite(db, ctx, email=email, target_kind="channel", target_id=ch.name, note=body.note)
        db.commit()
        logger.info("sharing: %s invited %s to thread %s (invite %s)", ctx.viewer.email or "machine", email, ch.name, invite.id)
        return _invited_response(db, ctx, invite, "added")

    added = add_channel_participant(db, ch, email)
    if added:
        notify(
            db, ctx.wid,
            source=_actor_source(ctx),
            title=f"{_actor_name(db, ctx)} added you to {_channel_title(ch)}",
            message=(body.note or "").strip() or f"You can now read and post in “{_channel_title(ch)}”.",
            recipient_email=email,
            kind="share",
            channel_name=ch.name,
            action_ref=f"channel:{ch.name}",
        )
    db.commit()
    return success_response({"added": True, "email": email, "already_participant": not added})


@router.delete("/channels/{channel}/participants/{email}")
def remove_participant(
    channel: str,
    email: str,
    network: str = Query(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Remove a person from a thread. Anyone may remove themselves; a private
    thread keeps at least one human so it never becomes unreachable."""
    ctx, err = _load(db, network, x_workspace_token, authorization)
    if err:
        return err
    ch = _get_channel(db, ctx, channel)
    if ch is None:
        return json_response(ResponseCode.NOT_FOUND, "Thread not found")
    email = _norm(email)
    if not _valid_email(email):
        return json_response(ResponseCode.BAD_REQUEST, "A valid email is required")
    is_self = bool(ctx.viewer.email) and ctx.viewer.email == email
    if not is_self and not _can_manage_channel(db, ctx, ch):
        return json_response(ResponseCode.FORBIDDEN, "Only a participant or an admin can remove people from this thread")

    current = channel_participant_emails(db, ch)
    if email not in current:
        return json_response(ResponseCode.NOT_FOUND, "Not a participant of this thread")
    if (ch.visibility or "workspace") == "private" and current == {email}:
        return json_response(ResponseCode.BAD_REQUEST, "A private thread needs at least one participant — open it to the workspace or add someone first")

    remove_channel_participant(db, ch, email)
    db.commit()
    return success_response({"removed": True, "email": email})


@router.get("/channels/{channel}/share-preview")
def share_preview(
    channel: str,
    network: str = Query(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Exactly what becomes accessible to someone added to this thread."""
    ctx, err = _load(db, network, x_workspace_token, authorization)
    if err:
        return err
    ch = _get_channel(db, ctx, channel)
    if ch is None:
        return json_response(ResponseCode.NOT_FOUND, "Thread not found")
    if not can_view_channel(db, ctx.wid, ctx.viewer, ch):
        return json_response(ResponseCode.FORBIDDEN, "No access to this thread")

    messages = _channel_messages(db, ctx, ch)
    message_count = 0
    knowledge_refs: List[str] = []
    seen = set()
    for p in messages:
        if (p.get("message_type") or "chat") == "chat":
            message_count += 1
        content = p.get("content")
        if isinstance(content, str):
            for slug in _KNOWLEDGE_REF_RE.findall(content):
                if slug not in seen:
                    seen.add(slug)
                    knowledge_refs.append(slug)

    files = db.execute(
        select(FileRecord.id, FileRecord.filename).where(
            FileRecord.workspace_id == ctx.workspace.id,
            FileRecord.channel_name == ch.name,
            FileRecord.status == "active",
        ).order_by(FileRecord.created_at.asc())
    ).all()

    return success_response({
        "channel": ch.name,
        "title": _channel_title(ch),
        "visibility": ch.visibility or "workspace",
        "director_email": ch.director_email,
        "humans": sorted(channel_participant_emails(db, ch)),
        "agents": [p.agent_name for p in (ch.participants or []) if p.agent_name != "__no_response__"],
        "message_count": message_count,
        "files": [{"id": fid, "filename": fname} for fid, fname in files],
        "knowledge_refs": knowledge_refs,
        "snapshot_available": True,
    })


# ---------------------------------------------------------------------------
# Agent directory
# ---------------------------------------------------------------------------

def _recent_requests_by_agent(db: Session, ctx: _Ctx) -> Dict[str, List[dict]]:
    """Threads the viewer is in, per agent that is a participant — newest
    first, capped. Empty for machines (there is no "my")."""
    if not ctx.viewer.email:
        return {}
    rows = db.execute(
        select(ChannelMember.agent_name, Channel.name, Channel.title, Channel.last_event_at)
        .join(Channel, Channel.id == ChannelMember.channel_id)
        .join(ChannelHumanMember, ChannelHumanMember.channel_id == Channel.id)
        .where(
            Channel.workspace_id == ctx.workspace.id,
            Channel.status != "deleted",
            ChannelHumanMember.user_email == ctx.viewer.email,
        )
    ).all()
    rows.sort(key=lambda r: (r[3] or 0), reverse=True)
    out: Dict[str, List[dict]] = {}
    for agent_name, name, title, last_event_at in rows:
        bucket = out.setdefault(agent_name, [])
        if len(bucket) >= _RECENT_REQUESTS_LIMIT:
            continue
        bucket.append({"channel": name, "title": title or name, "last_event_at": last_event_at})
    return out


@router.get("/agents/directory")
def agent_directory(
    network: str = Query(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """The team's specialists: profile, owner, availability, sharing state,
    and the viewer's own recent requests with each."""
    ctx, err = _load(db, network, x_workspace_token, authorization)
    if err:
        return err
    now = datetime.now(timezone.utc)

    members = db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == ctx.workspace.id,
            WorkspaceMember.status != "removed",
        ).order_by(WorkspaceMember.agent_name.asc())
    ).scalars().all()
    hidden = hidden_agent_names(db, ctx.wid, ctx.viewer, members)
    runtime_by_id = runtime_status_by_node(db, ctx.workspace, now)
    owner_names = _display_names(db, [_norm(m.owner_email) for m in members if m.owner_email])

    pinned = set()
    if ctx.viewer.email:
        pinned = set(db.execute(
            select(AgentPin.agent_name).where(
                AgentPin.workspace_id == ctx.workspace.id,
                AgentPin.user_email == ctx.viewer.email,
            )
        ).scalars().all())

    grant_counts = dict(db.execute(
        select(AgentGrant.agent_name, func.count(AgentGrant.id)).where(
            AgentGrant.workspace_id == ctx.workspace.id,
            AgentGrant.revoked_at.is_(None),
        ).group_by(AgentGrant.agent_name)
    ).all())
    recent = _recent_requests_by_agent(db, ctx)

    agents = []
    for m in members:
        if m.agent_name in hidden:
            continue
        manage = _can_manage_agent(ctx, m)
        owner = _norm(m.owner_email)
        agents.append({
            "agent_name": m.agent_name,
            "display_name": m.display_name,
            "agent_type": m.agent_type,
            "owner_email": owner,
            "owner_display_name": owner_names.get(owner) if owner else None,
            "visibility": m.visibility or "team",
            "purpose": m.purpose,
            "example_requests": m.example_requests or [],
            "required_inputs": m.required_inputs,
            "cost_owner": m.cost_owner,
            "status": effective_agent_status(m, now),
            "presence_state": m.presence_state,
            "busy_channels": m.busy_channels or [],
            "queue_depth": m.queue_depth or 0,
            **agent_runtime_fields(m, runtime_by_id),
            "pinned": m.agent_name in pinned,
            "grant_count": int(grant_counts.get(m.agent_name, 0)) if manage else None,
            "can_manage": manage,
            "my_recent_requests": recent.get(m.agent_name, []),
        })
    return success_response({"agents": agents})


# ---------------------------------------------------------------------------
# Agent grants
# ---------------------------------------------------------------------------

def _active_grants(db: Session, ctx: _Ctx, agent: str, email: Optional[str] = None) -> List[AgentGrant]:
    q = select(AgentGrant).where(
        AgentGrant.workspace_id == ctx.workspace.id,
        AgentGrant.agent_name == agent,
        AgentGrant.revoked_at.is_(None),
    )
    if email:
        q = q.where(AgentGrant.grantee_email == email)
    return db.execute(q.order_by(AgentGrant.created_at.asc())).scalars().all()


@router.get("/agents/{agent}/grants")
def list_grants(
    agent: str,
    network: str = Query(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    ctx, err = _load(db, network, x_workspace_token, authorization)
    if err:
        return err
    member = _get_agent(db, ctx, agent)
    if member is None:
        return json_response(ResponseCode.NOT_FOUND, "Agent not found")
    if not _can_manage_agent(ctx, member):
        return json_response(ResponseCode.FORBIDDEN, "Only the agent's owner or an admin can see who it is shared with")
    grants = _active_grants(db, ctx, member.agent_name)
    names = _display_names(db, [g.grantee_email for g in grants])
    return success_response({"grants": [{
        "email": g.grantee_email,
        "display_name": names.get(g.grantee_email),
        "granted_by": g.granted_by,
        "note": g.note,
        "created_at": g.created_at.isoformat() if g.created_at else None,
    } for g in grants]})


@router.post("/agents/{agent}/grants")
def add_grant(
    agent: str,
    body: ShareToEmailRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Share an agent with a teammate. Idempotent; a revoked grant is
    re-activated by inserting a fresh row (history stays auditable)."""
    ctx, err = _load(db, body.network, x_workspace_token, authorization)
    if err:
        return err
    member = _get_agent(db, ctx, agent)
    if member is None:
        return json_response(ResponseCode.NOT_FOUND, "Agent not found")
    if not _can_manage_agent(ctx, member):
        return json_response(ResponseCode.FORBIDDEN, "Only the agent's owner or an admin can share it")
    email = _norm(body.email)
    if not _valid_email(email):
        return json_response(ResponseCode.BAD_REQUEST, "A valid email is required")

    if not _is_workspace_member(db, ctx.workspace, email):
        invite = _create_target_invite(db, ctx, email=email, target_kind="agent", target_id=member.agent_name, note=body.note)
        db.commit()
        logger.info("sharing: %s invited %s to agent %s (invite %s)", ctx.viewer.email or "machine", email, member.agent_name, invite.id)
        return _invited_response(db, ctx, invite, "granted")

    note = (body.note or "").strip() or None
    if _active_grants(db, ctx, member.agent_name, email):
        return success_response({"granted": True, "email": email, "already_granted": True})

    db.add(AgentGrant(
        workspace_id=ctx.workspace.id,
        agent_name=member.agent_name,
        grantee_email=email,
        granted_by=ctx.viewer.email,
        note=note,
    ))
    db.flush()
    notify(
        db, ctx.wid,
        source=_actor_source(ctx),
        title=f"{_actor_name(db, ctx)} shared {_agent_label(member)} with you",
        message=note or member.purpose or f"You can now start requests with {_agent_label(member)}.",
        recipient_email=email,
        kind="share",
        action_ref=f"agent:{member.agent_name}",
    )
    db.commit()
    return success_response({"granted": True, "email": email})


@router.delete("/agents/{agent}/grants/{email}")
def revoke_grant(
    agent: str,
    email: str,
    network: str = Query(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Revocation sticks: every active grant for the pair is stamped."""
    ctx, err = _load(db, network, x_workspace_token, authorization)
    if err:
        return err
    member = _get_agent(db, ctx, agent)
    if member is None:
        return json_response(ResponseCode.NOT_FOUND, "Agent not found")
    if not _can_manage_agent(ctx, member):
        return json_response(ResponseCode.FORBIDDEN, "Only the agent's owner or an admin can revoke access")
    email = _norm(email)
    now = datetime.now(timezone.utc)
    for g in _active_grants(db, ctx, member.agent_name, email):
        g.revoked_at = now
        g.revoked_by = ctx.viewer.email
    db.commit()
    return success_response({"revoked": True, "email": email})


# ---------------------------------------------------------------------------
# Pins
# ---------------------------------------------------------------------------

def _person_only(ctx: _Ctx):
    if not ctx.viewer.email:
        return json_response(ResponseCode.BAD_REQUEST, "This action needs a signed-in person")
    return None


@router.get("/agents/pins")
def list_pins(
    network: str = Query(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    ctx, err = _load(db, network, x_workspace_token, authorization)
    if err:
        return err
    err = _person_only(ctx)
    if err:
        return err
    names = db.execute(
        select(AgentPin.agent_name).where(
            AgentPin.workspace_id == ctx.workspace.id,
            AgentPin.user_email == ctx.viewer.email,
        ).order_by(AgentPin.created_at.asc())
    ).scalars().all()
    return success_response({"agents": list(names)})


@router.post("/agents/{agent}/pin")
def pin_agent(
    agent: str,
    network: str = Query(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    ctx, err = _load(db, network, x_workspace_token, authorization)
    if err:
        return err
    err = _person_only(ctx)
    if err:
        return err
    member = _get_agent(db, ctx, agent)
    if member is None:
        return json_response(ResponseCode.NOT_FOUND, "Agent not found")
    if not can_use_agent(db, ctx.wid, ctx.viewer, member):
        return json_response(ResponseCode.FORBIDDEN, "You do not have access to this agent")
    existing = db.execute(
        select(AgentPin).where(
            AgentPin.workspace_id == ctx.workspace.id,
            AgentPin.user_email == ctx.viewer.email,
            AgentPin.agent_name == member.agent_name,
        )
    ).scalar_one_or_none()
    if existing is None:
        db.add(AgentPin(workspace_id=ctx.workspace.id, user_email=ctx.viewer.email, agent_name=member.agent_name))
        db.commit()
    return success_response({"pinned": True, "agent_name": member.agent_name})


@router.delete("/agents/{agent}/pin")
def unpin_agent(
    agent: str,
    network: str = Query(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    ctx, err = _load(db, network, x_workspace_token, authorization)
    if err:
        return err
    err = _person_only(ctx)
    if err:
        return err
    existing = db.execute(
        select(AgentPin).where(
            AgentPin.workspace_id == ctx.workspace.id,
            AgentPin.user_email == ctx.viewer.email,
            AgentPin.agent_name == agent,
        )
    ).scalar_one_or_none()
    if existing is not None:
        db.delete(existing)
        db.commit()
    return success_response({"pinned": False, "agent_name": agent})


# ---------------------------------------------------------------------------
# "Start another request with this specialist"
# ---------------------------------------------------------------------------

def _request_title(title: Optional[str], content: str) -> str:
    t = (title or "").strip()
    if t:
        return t[:120]
    first_line = content.strip().split("\n")[0].strip()
    t = first_line[:60].rstrip()
    if len(first_line) > 60:
        t += "..."
    return t or "New request"


def _after_message_hooks(background_tasks: BackgroundTasks, workspace_id: str, result: Event) -> None:
    """The post-commit fan-out POST /v1/events performs for a posted message:
    device push, poll-cache invalidation, live stream publish, cloud-agent
    invocation and watchers. Imported lazily (as the events router does) so
    the same test stubs apply and no optional backend is touched at import."""
    snapshot = {
        "id": result.id,
        "type": result.type,
        "source": result.source,
        "target": result.target,
        "payload": result.payload,
        "metadata": result.metadata,
        "timestamp": result.timestamp,
    }
    from app.services.push import fanout_for_event
    background_tasks.add_task(fanout_for_event, workspace_id, snapshot)
    try:
        import json as _json

        from app import cache
        from app.routers.events import _invalidate_poll_cache
        _invalidate_poll_cache(workspace_id, result.type)
        cache.publish_event(
            f"ws:{workspace_id}:events",
            _json.dumps(snapshot, default=str, separators=(",", ":")).encode(),
        )
    except Exception:
        pass
    from app.services.cloud_agent import invoke_cloud_agents
    background_tasks.add_task(invoke_cloud_agents, workspace_id, snapshot)
    from app.services.watches import notify_watchers
    background_tasks.add_task(notify_watchers, workspace_id, snapshot)


@router.post("/agents/{agent}/requests")
def start_request(
    agent: str,
    body: AgentRequestCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Open a fresh private thread with one specialist and route the first
    message to it. Goes through the same pipeline the UI uses (channel.create
    → message.posted) so routing, ACL and titles behave identically."""
    ctx, err = _load(db, body.network, x_workspace_token, authorization)
    if err:
        return err
    err = _person_only(ctx)
    if err:
        return err
    content = (body.content or "").strip()
    if not content:
        return json_response(ResponseCode.BAD_REQUEST, "content is required")
    member = _get_agent(db, ctx, agent)
    if member is None:
        return json_response(ResponseCode.NOT_FOUND, "Agent not found")
    if not can_use_agent(db, ctx.wid, ctx.viewer, member):
        return json_response(ResponseCode.FORBIDDEN, "You do not have access to this agent")

    email = ctx.viewer.email
    source = f"human:{_actor_name(db, ctx)}"
    channel_name = f"session-{uuid.uuid4().hex[:8]}"
    title = _request_title(body.title, content)
    machine_token = ctx.workspace.password_hash

    create_evt = Event(
        type="network.channel.create",
        source=source,
        target="core",
        payload={
            "name": channel_name,
            "title": title,
            "visibility": "private",
            "participants": [member.agent_name],
            "human_participants": [email],
            "sender_email": email,
            "director_email": email,
        },
        metadata={"sender_email": email},
    )
    if _emit_event_blocking(create_evt, ctx.workspace, db, token=machine_token) is None:
        return json_response(ResponseCode.INTERNAL_ERROR, "Could not create the thread")

    mention = f"@{member.agent_name}"
    if not content.lower().startswith(mention.lower()):
        content = f"{mention} {content}"
    post_evt = Event(
        type="workspace.message.posted",
        source=source,
        target=f"channel/{channel_name}",
        payload={"content": content, "sender_email": email, "message_type": "chat"},
        metadata={"sender_email": email},
    )
    posted = _emit_event_blocking(post_evt, ctx.workspace, db, token=machine_token)
    if posted is None:
        return json_response(ResponseCode.INTERNAL_ERROR, "Thread created but the first message was rejected")

    ch = _get_channel(db, ctx, channel_name)
    if ch is not None and _norm(ch.director_email) != email:
        ch.director_email = email
        db.commit()

    _after_message_hooks(background_tasks, ctx.wid, posted)
    return success_response({
        "channel": channel_name,
        "title": (ch.title if ch is not None and ch.title else title),
        "agent_name": member.agent_name,
        "message_id": posted.id,
    })
