# -*- coding: utf-8 -*-
"""
Account-level endpoints for the signed-in end user (Google or Apple identity).

DELETE /v1/account    Permanently delete the calling user's account data.

This exists to satisfy App Store Review Guideline 5.1.1(v), which requires apps
that support account creation to let users initiate account deletion from inside
the app. Auth is the user's identity bearer token (Authorization: Bearer <id>)
— NOT a workspace token — because deletion spans every workspace the user
touched, so it can't be scoped to a single workspace's token.

Scope of deletion: the user is identified only by email (the app has no
app-managed credential; identity is delegated to Google / Apple). We purge every
row keyed to that email — workspace collaborator memberships, channel human
memberships, and registered device push tokens — across all workspaces. We do
NOT delete whole workspaces the user created, since those may hold other
collaborators' data; their `creator_email` is left intact.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, Header
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.access import provision_workspace, reconcile_memberships, resolve_current_user
from app.database import get_db
from app.firebase_auth import verify_identity_token
from app.models import (
    ChannelHumanMember,
    DeviceToken,
    Workspace,
    WorkspaceCollaborator,
    WorkspaceMembership,
)
from app.response import ResponseCode, json_response, success_response
from app.routers.network import _extract_bearer

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["Account"])


def _authed_email(authorization: Optional[str]) -> Optional[str]:
    """Resolve the calling user's normalized email from the identity bearer,
    or None if absent/invalid."""
    bearer = _extract_bearer(authorization)
    if not bearer:
        return None
    email = verify_identity_token(bearer)
    return email.strip().lower() if email else None


@router.get("/account/workspaces")
def list_account_workspaces(
    db: Session = Depends(get_db),
    authorization: Optional[str] = Header(None),
):
    """List the signed-in user's workspaces — the Membership Home (v1.0).

    Side effects (idempotent): resolves/creates the User row for the verified
    identity, reconciles any pre-v1.0 email-keyed access (creator_email +
    collaborator rows) into first-class WorkspaceMembership rows, and — for a
    brand-new user with no memberships — auto-provisions an empty workspace they
    own (Overleaf-style first run). This is why a GET writes.

    Each entry includes the workspace's shared access token (`token`) so the
    client can connect directly; the caller is a verified member, which is
    exactly who is entitled to that token.
    """
    user = resolve_current_user(db, authorization)
    if not user:
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid identity token")

    # Migration bridge: pull legacy email-keyed access into memberships.
    reconcile_memberships(db, user)

    # Brand-new user (no access anywhere) → give them an empty workspace to own.
    has_membership = db.execute(
        select(WorkspaceMembership.workspace_id)
        .where(WorkspaceMembership.user_id == user.id)
        .limit(1)
    ).first()
    if not has_membership:
        provision_workspace(db, user)

    db.commit()

    rows = db.execute(
        select(Workspace, WorkspaceMembership.role)
        .join(WorkspaceMembership, WorkspaceMembership.workspace_id == Workspace.id)
        .where(
            WorkspaceMembership.user_id == user.id,
            Workspace.status != "deleted",
        )
        .order_by(Workspace.last_activity_at.desc())
    ).all()

    results = [
        {
            "workspaceId": str(ws.id),
            "name": ws.name,
            "slug": ws.slug,
            # Shared workspace access token (password_hash stores the raw token,
            # compared by equality in app.access.verify_workspace_access). May be
            # null for an open workspace with no token set. Withheld from viewers
            # so they open the workspace bearer-only (read access) and can't use
            # the token to bypass the read-only role.
            "token": None if role == "viewer" else ws.password_hash,
            "role": role,
            "lastActivityAt": ws.last_activity_at.isoformat() if ws.last_activity_at else None,
        }
        for ws, role in rows
    ]

    return success_response(results)


@router.delete("/account")
def delete_account(
    db: Session = Depends(get_db),
    authorization: Optional[str] = Header(None),
):
    """Delete all data belonging to the calling user.

    Identifies the user from the verified identity token's email, then removes
    every email-keyed row across all workspaces. Idempotent: a second call (or a
    user with no stored data) succeeds with zero deletions.
    """
    bearer = _extract_bearer(authorization)
    if not bearer:
        return json_response(ResponseCode.UNAUTHORIZED, "Missing identity token")

    email = verify_identity_token(bearer)
    if not email:
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid identity token")

    email_lower = email.strip().lower()

    collaborators_deleted = db.query(WorkspaceCollaborator).filter(
        WorkspaceCollaborator.email == email_lower
    ).delete(synchronize_session=False)

    channel_memberships_deleted = db.query(ChannelHumanMember).filter(
        ChannelHumanMember.user_email == email_lower
    ).delete(synchronize_session=False)

    devices_deleted = db.query(DeviceToken).filter(
        DeviceToken.user_email == email_lower
    ).delete(synchronize_session=False)

    db.commit()

    logger.info(
        "account: deleted account for %s (collaborators=%s channel_members=%s devices=%s)",
        email_lower, collaborators_deleted, channel_memberships_deleted, devices_deleted,
    )

    return success_response({
        "email": email_lower,
        "deleted": {
            "collaborators": collaborators_deleted,
            "channel_memberships": channel_memberships_deleted,
            "devices": devices_deleted,
        },
    })
