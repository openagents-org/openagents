# -*- coding: utf-8 -*-
"""Public invitation endpoints — the invitee's side of workspace invites.

GET  /v1/invites/{token}         Peek at an invite (workspace name, role, status)
POST /v1/invites/{token}/accept  Join the workspace (requires a signed-in identity)

The invite token is the only secret involved; the workspace machine token is
never exposed here. Accepting requires a verified identity bearer — for
email-bound invites the signed-in email must match the invited address.
Invites are created/managed by owners/admins in app/routers/workspaces.py.
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.access import ROLE_RANK, resolve_current_user
from app.database import get_db
from app.models import (
    AgentGrant,
    Channel,
    KanbanTask,
    User,
    Workspace,
    WorkspaceInvite,
    WorkspaceMember,
    WorkspaceMembership,
)
from app.response import ResponseCode, json_response, success_response

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/invites", tags=["Invites"])


def _mask_email(email: str) -> str:
    """r***@example.com — enough for 'is this invite meant for me?'."""
    local, _, domain = email.partition("@")
    if not domain:
        return "***"
    return f"{local[:1]}***@{domain}"


def _inviter_name(db: Session, created_by: str | None) -> str | None:
    """Public display name for the inviter — never their email address.

    The peek endpoint is unauthenticated, so the raw address must not leak to
    whoever holds the link. Prefer the User's display name; fall back to the
    email's local part ("raphael" from raphael@example.com)."""
    if not created_by:
        return None
    user = db.execute(select(User).where(User.email == created_by)).scalar_one_or_none()
    if user is not None and user.display_name:
        return user.display_name
    return created_by.partition("@")[0]


def _load(db: Session, token: str):
    invite = db.execute(
        select(WorkspaceInvite).where(WorkspaceInvite.token == token)
    ).scalar_one_or_none()
    if invite is None:
        return None, None
    workspace = db.execute(
        select(Workspace).where(Workspace.id == invite.workspace_id)
    ).scalar_one_or_none()
    return invite, workspace


def _load_channel(db: Session, workspace: Workspace, name: str | None):
    if not name:
        return None
    return db.execute(
        select(Channel).where(
            Channel.workspace_id == workspace.id,
            Channel.name == name,
            Channel.status != "deleted",
        )
    ).scalar_one_or_none()


def _load_task(db: Session, workspace: Workspace, task_id: str | None):
    if not task_id:
        return None
    return db.execute(
        select(KanbanTask).where(
            KanbanTask.workspace_id == workspace.id,
            KanbanTask.id == task_id,
        )
    ).scalar_one_or_none()


def _target_title(db: Session, workspace: Workspace, invite: WorkspaceInvite) -> str | None:
    """Human label for the invite's target (v1.1): the thread's title, the
    agent's display name, or the task's title. None when there is no target
    or it no longer exists."""
    kind, target_id = invite.target_kind, invite.target_id
    if not kind or not target_id:
        return None
    if kind == "channel":
        ch = _load_channel(db, workspace, target_id)
        return (ch.title or ch.name) if ch is not None else None
    if kind == "agent":
        m = db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace.id,
                WorkspaceMember.agent_name == target_id,
                WorkspaceMember.status != "removed",
            )
        ).scalar_one_or_none()
        return (m.display_name or m.agent_name) if m is not None else None
    if kind == "task":
        task = _load_task(db, workspace, target_id)
        return task.title if task is not None else None
    return None


def _apply_target(db: Session, workspace: Workspace, invite: WorkspaceInvite, user: User) -> str | None:
    """Grant what the invite was about (v1.1) and return where to land.

    channel → thread ACL row, redirect to the thread
    agent   → AgentGrant from the inviter, redirect to the agent
    task    → thread ACL row on the task's thread (when it has one)
    Idempotent; nothing here touches the workspace role."""
    from app.services.visibility import add_channel_participant

    kind, target_id = invite.target_kind, invite.target_id
    if not kind or not target_id:
        return None
    email = (user.email or "").strip().lower()
    if kind == "channel":
        ch = _load_channel(db, workspace, target_id)
        if ch is None:
            return None
        add_channel_participant(db, ch, email)
        return f"#?thread={ch.name}"
    if kind == "agent":
        from app.services.access_model import create_grant
        create_grant(
            db, str(workspace.id), resource_kind="agent", resource_id=target_id, grantee_kind="human",
            grantee_id=email, rights=["read", "act"], granted_by=invite.created_by, note=invite.note,
        )
        return f"#?agent={target_id}"
    if kind == "task":
        task = _load_task(db, workspace, target_id)
        if task is None or not task.channel_name:
            return None
        ch = _load_channel(db, workspace, task.channel_name)
        if ch is None:
            return None
        add_channel_participant(db, ch, email)
        return f"#?thread={ch.name}"
    return None


def _status(invite: WorkspaceInvite) -> str:
    if invite.revoked_at is not None:
        return "revoked"
    if invite.email and invite.accepted_at is not None:
        return "accepted"
    expires = invite.expires_at
    if expires is not None and expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires is not None and expires < datetime.now(timezone.utc):
        return "expired"
    return "pending"


@router.get("/{token}")
def get_invite(token: str, db: Session = Depends(get_db)):
    """Public peek so the accept page can render before login. Reveals only
    the workspace name, the offered role and (masked) who it's bound to."""
    invite, workspace = _load(db, token)
    if invite is None or workspace is None or workspace.status == "deleted":
        return json_response(ResponseCode.NOT_FOUND, "Invite not found")
    return success_response({
        "workspaceName": workspace.name,
        "role": invite.role,
        "status": _status(invite),
        "invitedBy": _inviter_name(db, invite.created_by),
        "invitedEmail": _mask_email(invite.email) if invite.email else None,
        "expiresAt": invite.expires_at.isoformat() if invite.expires_at else None,
        # v1.1: what the invite is about, so the accept page can say
        # "Mia shared @deploy-bot with you" instead of just the workspace.
        "target_kind": invite.target_kind,
        "target_id": invite.target_id,
        "note": invite.note,
        "target_title": _target_title(db, workspace, invite),
    })


@router.post("/{token}/accept")
def accept_invite(
    token: str,
    db: Session = Depends(get_db),
    authorization: str = Header(None),
):
    """Join the invite's workspace as the signed-in user.

    Email-bound invites require the signed-in email to match and are consumed
    on first accept; open links stay valid until expiry/revocation. An
    existing higher role is never downgraded. Returns the workspace slug so
    the frontend can land the new member in the workspace (bearer access —
    no token in the URL)."""
    invite, workspace = _load(db, token)
    if invite is None or workspace is None or workspace.status == "deleted":
        return json_response(ResponseCode.NOT_FOUND, "Invite not found")

    status = _status(invite)
    if status != "pending":
        return json_response(ResponseCode.BAD_REQUEST, f"This invite is {status}")

    user = resolve_current_user(db, authorization)
    if user is None:
        return json_response(ResponseCode.UNAUTHORIZED, "Sign in to accept this invite")

    if invite.email and user.email != invite.email:
        return json_response(
            ResponseCode.FORBIDDEN,
            "This invite was issued for a different email address",
        )

    membership = db.execute(
        select(WorkspaceMembership).where(
            WorkspaceMembership.workspace_id == workspace.id,
            WorkspaceMembership.user_id == user.id,
        )
    ).scalar_one_or_none()
    if membership is None:
        membership = WorkspaceMembership(
            workspace_id=workspace.id, user_id=user.id, role=invite.role,
        )
        db.add(membership)
    elif ROLE_RANK.get(invite.role, -1) > ROLE_RANK.get(membership.role, -1):
        membership.role = invite.role

    # Membership must exist before the target is applied: a thread ACL row or
    # an agent grant for someone who is not a member would be dead weight.
    db.flush()
    redirect = _apply_target(db, workspace, invite, user)

    invite.accepted_at = datetime.now(timezone.utc)
    invite.accepted_by = user.email
    db.commit()

    logger.info(
        "invite: %s accepted by %s for workspace %s (role %s, target %s:%s)",
        invite.id, user.email, workspace.slug, membership.role,
        invite.target_kind, invite.target_id,
    )
    return success_response({
        "workspaceId": workspace.id,
        "slug": workspace.slug,
        "workspaceName": workspace.name,
        "role": membership.role,
        "target_kind": invite.target_kind,
        "target_id": invite.target_id,
        "redirect": redirect,
    })
