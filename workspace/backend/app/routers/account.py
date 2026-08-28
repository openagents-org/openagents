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
from pydantic import BaseModel, ConfigDict, Field
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


# ---------------------------------------------------------------------------
# Profile — the signed-in user's cross-workspace identity card
# ---------------------------------------------------------------------------

# Generous cap for a data:image/... avatar: a 256px JPEG is ~10-40KB; base64
# adds ~33%. Anything bigger means the client skipped its downscaling step.
MAX_AVATAR_URL_LENGTH = 200_000


class ProfileUpdateRequest(BaseModel):
    # Accept both the wire name ("welcomeSeen") and the field name.
    model_config = ConfigDict(populate_by_name=True)

    display_name: Optional[str] = Field(default=None, max_length=120)
    # "" clears the avatar; None leaves it untouched.
    avatar_url: Optional[str] = None
    # First-run welcome dismissed on this account; None leaves it untouched.
    welcome_seen: Optional[bool] = Field(default=None, alias="welcomeSeen")


def _profile_row(user) -> dict:
    return {
        "email": user.email,
        "displayName": user.display_name,
        "avatarUrl": user.avatar_url,
        "welcomeSeen": bool(user.welcome_seen),
    }


@router.get("/account/profile")
def get_profile(
    db: Session = Depends(get_db),
    authorization: Optional[str] = Header(None),
):
    """The signed-in user's profile (name + avatar), shared across workspaces."""
    user = resolve_current_user(db, authorization)
    if not user:
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid identity token")
    db.commit()  # persist the lazily created/refreshed User row
    return success_response(_profile_row(user))


@router.patch("/account/profile")
def update_profile(
    body: ProfileUpdateRequest,
    db: Session = Depends(get_db),
    authorization: Optional[str] = Header(None),
):
    """Update display name and/or avatar. Omitted fields are left untouched;
    an empty-string avatar_url clears the picture."""
    user = resolve_current_user(db, authorization)
    if not user:
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid identity token")

    if body.display_name is not None:
        name = body.display_name.strip()
        if not name:
            return json_response(ResponseCode.BAD_REQUEST, "Display name cannot be empty")
        user.display_name = name

    if body.avatar_url is not None:
        avatar = body.avatar_url.strip()
        if not avatar:
            user.avatar_url = None
        else:
            if not (avatar.startswith("https://") or avatar.startswith("data:image/")):
                return json_response(
                    ResponseCode.BAD_REQUEST,
                    "Avatar must be an https:// URL or a data:image/... URL",
                )
            if len(avatar) > MAX_AVATAR_URL_LENGTH:
                return json_response(ResponseCode.BAD_REQUEST, "Avatar image is too large")
            user.avatar_url = avatar

    if body.welcome_seen is not None:
        user.welcome_seen = body.welcome_seen

    db.commit()
    return success_response(_profile_row(user))


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
