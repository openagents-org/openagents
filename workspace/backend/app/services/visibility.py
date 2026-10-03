# -*- coding: utf-8 -*-
"""
Per-person visibility for threads and agents — compatibility façade.

Since the permission model (v1.1, migration 055) the rule lives in
``app/services/access_model.py``: owner ∪ grants (human | agent | security
group) ∪ public, with agents inheriting their owner's access and machine
callers without an agent identity keeping legacy full access. This module
keeps the M1 names and signatures so routers written against it keep working:

  * ``Viewer`` is now a ``Principal`` (``Viewer(machine, email)`` still works).
  * ``resolve_viewer`` resolves humans, identified agents (X-Agent-Name) and
    legacy machines.
  * The hidden-set helpers return *hidden* sets so hot paths can skip the
    filter when there is nothing to hide.
"""

from __future__ import annotations

from typing import Optional, Set, Union

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Channel, Workspace
from app.services import access_model as _am
from app.services.access_model import (  # noqa: F401  (re-exported)
    Principal,
    add_channel_participant,
    caller_email,
    can_use_agent,
    can_view_channel,
    channel_participant_emails,
    granted_agent_names,
    grantee_emails,
    hidden_agent_names,
    hidden_channel_names,
    is_agent_owner,
    remove_channel_participant,
)


def _norm(email: Optional[str]) -> Optional[str]:
    e = (email or "").strip().lower()
    return e or None


def is_machine_caller(workspace: Workspace, token: Optional[str]) -> bool:
    """True when the caller presented the workspace token (agents/daemons)."""
    return bool(token) and bool(workspace.password_hash) and token == workspace.password_hash


class Viewer(Principal):
    """Resolved caller for visibility decisions (M1 constructor kept)."""

    __slots__ = ()

    def __init__(self, machine: bool, email: Optional[str], **kw):
        super().__init__("machine" if machine else "human", email=email, **kw)


def resolve_viewer(db: Session, workspace: Union[Workspace, str, None], token: Optional[str],
                   authorization: Optional[str], agent_name: Optional[str] = None) -> Principal:
    """A signed-in person is a person even when the client also sends the
    workspace token (the web app does). Token-only callers are machines —
    or the agent named by X-Agent-Name / `agent_name`. Neither → an
    anonymous visitor on an open workspace."""
    return _am.resolve_principal(db, workspace, token, authorization, agent_name=agent_name)


# ---------------------------------------------------------------------------
# Threads
# ---------------------------------------------------------------------------

def can_view_channel_name(db: Session, workspace_id: str, viewer: Principal, channel_name: Optional[str]) -> bool:
    """Name-based variant; unknown channels are visible (nothing to protect)."""
    if viewer.machine or not channel_name:
        return True
    ch = db.execute(
        select(Channel).where(Channel.workspace_id == workspace_id, Channel.name == channel_name)
    ).scalar_one_or_none()
    if ch is None:
        return True
    return can_view_channel(db, workspace_id, viewer, ch)


def hidden_channel_targets(db: Session, workspace_id: str, viewer: Principal) -> Set[str]:
    return {f"channel/{n}" for n in hidden_channel_names(db, workspace_id, viewer)}


__all__ = [
    "Principal", "Viewer", "resolve_viewer", "is_machine_caller", "caller_email",
    "hidden_channel_names", "can_view_channel", "can_view_channel_name", "hidden_channel_targets",
    "channel_participant_emails", "add_channel_participant", "remove_channel_participant",
    "grantee_emails", "granted_agent_names", "can_use_agent", "hidden_agent_names", "is_agent_owner",
]
