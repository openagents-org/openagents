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
from app.models import Workspace, WorkspaceInvite, WorkspaceMembership
from app.response import ResponseCode, json_response, success_response

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/invites", tags=["Invites"])


def _mask_email(email: str) -> str:
    """r***@example.com — enough for 'is this invite meant for me?'."""
    local, _, domain = email.partition("@")
    if not domain:
        return "***"
    return f"{local[:1]}***@{domain}"


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
        "invitedBy": invite.created_by,
        "invitedEmail": _mask_email(invite.email) if invite.email else None,
        "expiresAt": invite.expires_at.isoformat() if invite.expires_at else None,
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

    invite.accepted_at = datetime.now(timezone.utc)
    invite.accepted_by = user.email
    db.commit()

    logger.info(
        "invite: %s accepted by %s for workspace %s (role %s)",
        invite.id, user.email, workspace.slug, membership.role,
    )
    return success_response({
        "workspaceId": workspace.id,
        "slug": workspace.slug,
        "workspaceName": workspace.name,
        "role": membership.role,
    })
