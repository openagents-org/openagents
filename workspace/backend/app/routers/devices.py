# -*- coding: utf-8 -*-
"""
Device registration endpoints for mobile push notifications.

POST   /v1/devices/register    Upsert an FCM token for the calling workspace
DELETE /v1/devices/register    Forget an FCM token (called on logout / uninstall)

Both iOS and Android register the same way: the token is an FCM registration
token, not a raw APNs device token, and `services/fcm_client.py` is the only
sender. Registrations may carry the user's notification switches (`prefs`),
which the fan-out honors before it sends.

Auth: `X-Workspace-Token` header (or a Firebase bearer for workspace
owners/collaborators) — reuses the existing `_verify_workspace_access`
helper from `routers/network.py`.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import DeviceToken, Workspace
from app.response import ResponseCode, json_response, success_response
from app.routers.network import _verify_workspace_access, _workspace_filter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["Devices"])


class RegisterDeviceRequest(BaseModel):
    network: str
    fcm_token: str
    device_type: str = "ios"
    bundle_id: Optional[str] = None
    # Google email of the signed-in user. Optional for back-compat with
    # older clients; required for @-mention push targeting to scope
    # notifications to "just bary's devices" instead of fanning out to
    # the whole workspace.
    user_email: Optional[str] = None
    # Notification switches from the device's Notifications screen:
    # {approvals, mentions, agentErrors, taskCompletions, allMessages,
    # quietHours}. Optional — omitting it on a re-register keeps whatever
    # was stored, and a device that never sends prefs gets everything.
    prefs: Optional[dict] = None


class DeregisterDeviceRequest(BaseModel):
    network: str
    fcm_token: str


@router.post("/devices/register")
def register_device(
    body: RegisterDeviceRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Upsert a device's FCM token for this workspace.

    Idempotent: re-registering the same `(workspace_id, fcm_token)` pair
    bumps `last_seen_at` and updates `bundle_id` / `device_type` / `prefs`
    if they drifted, but doesn't create a duplicate row. Fields the client
    omits are left as they were — an older build that doesn't know about
    `prefs` must not wipe switches a newer one stored.
    """
    workspace = db.execute(
        select(Workspace).where(_workspace_filter(body.network))
    ).scalar_one_or_none()
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Workspace access denied")

    existing = db.execute(
        select(DeviceToken).where(
            DeviceToken.workspace_id == str(workspace.id),
            DeviceToken.fcm_token == body.fcm_token,
        )
    ).scalar_one_or_none()

    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)

    normalized_email = (body.user_email or "").strip().lower() or None

    if existing:
        existing.last_seen_at = now
        existing.device_type = body.device_type
        if body.bundle_id is not None:
            existing.bundle_id = body.bundle_id
        if normalized_email is not None:
            existing.user_email = normalized_email
        if body.prefs is not None:
            existing.prefs = body.prefs
        device_id = existing.id
    else:
        token = DeviceToken(
            workspace_id=str(workspace.id),
            fcm_token=body.fcm_token,
            device_type=body.device_type,
            bundle_id=body.bundle_id,
            user_email=normalized_email,
            prefs=body.prefs,
            created_at=now,
            last_seen_at=now,
        )
        db.add(token)
        db.flush()
        device_id = token.id

    db.commit()
    logger.info(
        "devices: registered %s token for workspace=%s (id=%s)",
        body.device_type, workspace.id, device_id,
    )
    return success_response({"id": device_id})


@router.delete("/devices/register")
def deregister_device(
    body: DeregisterDeviceRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Remove an FCM token from this workspace. Idempotent (no-op if absent)."""
    workspace = db.execute(
        select(Workspace).where(_workspace_filter(body.network))
    ).scalar_one_or_none()
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Workspace access denied")

    deleted = db.query(DeviceToken).filter(
        DeviceToken.workspace_id == str(workspace.id),
        DeviceToken.fcm_token == body.fcm_token,
    ).delete()
    db.commit()
    return success_response({"deleted": deleted})
