# -*- coding: utf-8 -*-
"""
Per-person visibility for threads and agents (roadmap v1.1, M1).

Two boundaries, both enforced server-side wherever content is read or routed:

  * Private threads — `Channel.visibility == "private"`. The ACL is
    `channel_human_members` (who may read/post). Everything else stays
    "workspace" (every member), exactly today's behaviour.
  * Personal agents — `WorkspaceMember.visibility == "personal"`. Visible and
    usable only by `owner_email` and people holding a live `AgentGrant`.

Who is "the caller":
  * A machine credential (the workspace token) is fully trusted — it is what
    agents and daemons hold — so it sees everything. Isolation is between
    *people*.
  * A signed-in person is identified by their bearer email.
  * An anonymous human (open workspace, no bearer) sees only public content.

The helpers return *hidden* sets so callers on hot paths can skip the filter
entirely when there is nothing to hide (the common case on legacy workspaces).
"""

from __future__ import annotations

from typing import Iterable, Optional, Set

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AgentGrant, Channel, ChannelHumanMember, Workspace, WorkspaceMember


def _norm(email: Optional[str]) -> Optional[str]:
    e = (email or "").strip().lower()
    return e or None


def is_machine_caller(workspace: Workspace, token: Optional[str]) -> bool:
    """True when the caller presented the workspace token (agents/daemons)."""
    return bool(token) and bool(workspace.password_hash) and token == workspace.password_hash


def caller_email(db: Session, authorization: Optional[str]) -> Optional[str]:
    """The signed-in person's email from the bearer, or None."""
    if not authorization:
        return None
    from app.access import resolve_current_user
    try:
        user = resolve_current_user(db, authorization)
    except Exception:
        return None
    return _norm(user.email) if user else None


class Viewer:
    """Resolved caller for visibility decisions."""

    __slots__ = ("machine", "email")

    def __init__(self, machine: bool, email: Optional[str]):
        self.machine = machine
        self.email = email

    @property
    def is_human(self) -> bool:
        return not self.machine


def resolve_viewer(db: Session, workspace: Optional[Workspace], token: Optional[str], authorization: Optional[str]) -> Viewer:
    """A signed-in person is a person even when the client also sends the
    workspace token (the web app does). Token-only callers are machines.
    Neither → an anonymous visitor on an open workspace."""
    email = caller_email(db, authorization)
    if email:
        return Viewer(False, email)
    if token and (workspace is None or is_machine_caller(workspace, token)):
        return Viewer(True, None)
    return Viewer(False, None)


# ---------------------------------------------------------------------------
# Threads
# ---------------------------------------------------------------------------

def hidden_channel_names(db: Session, workspace_id: str, viewer: Viewer) -> Set[str]:
    """Names of private channels this viewer may NOT see. Empty for machines."""
    if viewer.machine:
        return set()
    private = db.execute(
        select(Channel.id, Channel.name).where(
            Channel.workspace_id == workspace_id,
            Channel.visibility == "private",
        )
    ).all()
    if not private:
        return set()
    allowed_ids: Set[str] = set()
    if viewer.email:
        allowed_ids = set(db.execute(
            select(ChannelHumanMember.channel_id).where(
                ChannelHumanMember.channel_id.in_([cid for cid, _ in private]),
                ChannelHumanMember.user_email == viewer.email,
            )
        ).scalars().all())
    return {name for cid, name in private if cid not in allowed_ids}


def can_view_channel(db: Session, workspace_id: str, viewer: Viewer, channel: Channel) -> bool:
    if viewer.machine or (channel.visibility or "workspace") != "private":
        return True
    if not viewer.email:
        return False
    row = db.execute(
        select(ChannelHumanMember.user_email).where(
            ChannelHumanMember.channel_id == channel.id,
            ChannelHumanMember.user_email == viewer.email,
        )
    ).first()
    return row is not None


def can_view_channel_name(db: Session, workspace_id: str, viewer: Viewer, channel_name: Optional[str]) -> bool:
    """Name-based variant; unknown channels are visible (nothing to protect)."""
    if viewer.machine or not channel_name:
        return True
    ch = db.execute(
        select(Channel).where(Channel.workspace_id == workspace_id, Channel.name == channel_name)
    ).scalar_one_or_none()
    if ch is None:
        return True
    return can_view_channel(db, workspace_id, viewer, ch)


def hidden_channel_targets(db: Session, workspace_id: str, viewer: Viewer) -> Set[str]:
    return {f"channel/{n}" for n in hidden_channel_names(db, workspace_id, viewer)}


def channel_participant_emails(db: Session, channel: Channel) -> Set[str]:
    return set(db.execute(
        select(ChannelHumanMember.user_email).where(ChannelHumanMember.channel_id == channel.id)
    ).scalars().all())


def add_channel_participant(db: Session, channel: Channel, email: str) -> bool:
    """Idempotently add a person to a thread's ACL. Returns True if added."""
    email = _norm(email)
    if not email:
        return False
    existing = db.execute(
        select(ChannelHumanMember).where(
            ChannelHumanMember.channel_id == channel.id,
            ChannelHumanMember.user_email == email,
        )
    ).scalar_one_or_none()
    if existing:
        return False
    db.add(ChannelHumanMember(channel_id=channel.id, user_email=email))
    db.flush()
    return True


def remove_channel_participant(db: Session, channel: Channel, email: str) -> bool:
    email = _norm(email)
    row = db.execute(
        select(ChannelHumanMember).where(
            ChannelHumanMember.channel_id == channel.id,
            ChannelHumanMember.user_email == email,
        )
    ).scalar_one_or_none()
    if not row:
        return False
    db.delete(row)
    db.flush()
    return True


# ---------------------------------------------------------------------------
# Agents
# ---------------------------------------------------------------------------

def grantee_emails(db: Session, workspace_id: str, agent_name: str) -> Set[str]:
    return set(db.execute(
        select(AgentGrant.grantee_email).where(
            AgentGrant.workspace_id == workspace_id,
            AgentGrant.agent_name == agent_name,
            AgentGrant.revoked_at.is_(None),
        )
    ).scalars().all())


def granted_agent_names(db: Session, workspace_id: str, email: Optional[str]) -> Set[str]:
    if not email:
        return set()
    return set(db.execute(
        select(AgentGrant.agent_name).where(
            AgentGrant.workspace_id == workspace_id,
            AgentGrant.grantee_email == email,
            AgentGrant.revoked_at.is_(None),
        )
    ).scalars().all())


def can_use_agent(db: Session, workspace_id: str, viewer: Viewer, member: WorkspaceMember) -> bool:
    """May this viewer see/mention/start requests with the agent?"""
    if viewer.machine or (member.visibility or "team") != "personal":
        return True
    if not viewer.email:
        return False
    if _norm(member.owner_email) == viewer.email:
        return True
    return viewer.email in grantee_emails(db, workspace_id, member.agent_name)


def hidden_agent_names(db: Session, workspace_id: str, viewer: Viewer,
                       members: Optional[Iterable[WorkspaceMember]] = None) -> Set[str]:
    """Personal agents this viewer may not see. Empty for machines."""
    if viewer.machine:
        return set()
    if members is None:
        members = db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.visibility == "personal",
            )
        ).scalars().all()
    personal = [m for m in members if (m.visibility or "team") == "personal"]
    if not personal:
        return set()
    granted = granted_agent_names(db, workspace_id, viewer.email)
    hidden = set()
    for m in personal:
        if viewer.email and (_norm(m.owner_email) == viewer.email or m.agent_name in granted):
            continue
        hidden.add(m.agent_name)
    return hidden


def is_agent_owner(viewer: Viewer, member: WorkspaceMember) -> bool:
    return bool(viewer.email) and _norm(member.owner_email) == viewer.email
