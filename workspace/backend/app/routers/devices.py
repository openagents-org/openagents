# -*- coding: utf-8 -*-
"""
Device registration endpoints for mobile push notifications.

POST   /v1/devices/register    Upsert an FCM token for the calling workspace
DELETE /v1/devices/register    Forget an FCM token (called on logout / uninstall)
POST   /v1/devices/test-push   Send one push to one device, for diagnosis

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


class TestPushRequest(BaseModel):
    network: str
    # Required, and deliberately so. Scoping the send by `user_email` would
    # wake every device that person owns, and scoping by workspace would
    # wake the whole team — neither is what "send me a test push" means.
    # The caller names the one device it wants woken: its own.
    fcm_token: str
    # Tags the `data` payload exactly as the real fan-out would, so the
    # client-side tap handling can be exercised per reason. Free-form
    # rather than an enum, matching `PushReason` on the client: a value
    # this backend has never heard of is still a deliverable notification.
    reason: str = "task_completed"
    # Goes out as `data.channel`, which is what the app turns into a route
    # on tap. Leave it empty to exercise the other branch — the
    # notification that names no thread and so opens the app where it was.
    channel: Optional[str] = None
    title: Optional[str] = None
    body: Optional[str] = None


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


@router.post("/devices/test-push")
def test_push(
    body: TestPushRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Send one push to one device and report, in detail, what happened.

    Exists because "the notification didn't arrive" has six or seven
    distinct causes spread across three systems, and the ordinary path
    (post an event → `push.fanout_for_event`) silently collapses most of
    them into "nothing happened": an unconfigured deployment, a device
    that was never registered, a `prefs` switch left off, and a message
    `_should_push` declined all look identical from the outside. This
    endpoint answers each of those questions separately in its response
    body, so one button tap in the app localizes the fault.

    What it deliberately does *not* do is reimplement the fan-out. It
    skips `_should_push` (the caller has already decided they want a
    push) and it skips the `prefs` gate — but it *reports* what the
    prefs gate would have done, which is the diagnostic half of it. A
    test push that got suppressed by a switch the user forgot they
    flipped would be exactly as uninformative as the silence it is
    meant to explain.

    Not a spam vector despite sending on request: it needs workspace
    credentials, and the token must already be registered *in that
    workspace*, so the set of devices it can reach is the set the caller
    could already reach by posting a message. An unregistered token is
    refused rather than forwarded to FCM.
    """
    workspace = db.execute(
        select(Workspace).where(_workspace_filter(body.network))
    ).scalar_one_or_none()
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Workspace access denied")

    device = db.execute(
        select(DeviceToken).where(
            DeviceToken.workspace_id == str(workspace.id),
            DeviceToken.fcm_token == body.fcm_token,
        )
    ).scalar_one_or_none()
    if not device:
        # The common first-run failure, and worth its own message: the app
        # asked for a test push before `POST /v1/devices/register` had
        # succeeded, which on iOS usually means the APNs token hadn't
        # landed yet when the app started up.
        return json_response(
            ResponseCode.NOT_FOUND,
            "This device is not registered in this workspace — register it "
            "first (POST /v1/devices/register), then retry.",
        )

    from app.services.fcm_client import PushAlert, _messaging_ready, send_push
    from app.services.push import _prefs_allow

    # Asked before sending so the answer is reported even when the send
    # is a no-op: `send_push` returns ([], []) both for "not configured"
    # and for "nothing to send", and telling those apart is most of the
    # point of this endpoint.
    configured = _messaging_ready()

    reason = (body.reason or "task_completed").strip() or "task_completed"
    channel = (body.channel or "").strip()

    alert = PushAlert(
        title=body.title or "Test notification",
        body=body.body or f"Test push (reason={reason}) from the backend.",
        thread_id=channel or None,
    )
    # Same shape as `push._build_data_payload`, so a tap goes through the
    # client's real routing code rather than a special case.
    data = {
        "reason": reason,
        "channel": channel,
        "event_id": "test-push",
        "event_type": "devices.test_push",
        "source": "system:test-push",
    }

    sent, dead = send_push([device.fcm_token], alert, data)

    if dead:
        # FCM has told us this registration is gone for good. Drop it for
        # the same reason the fan-out does, or every later push to this
        # workspace keeps paying for a token that can never be delivered.
        db.query(DeviceToken).filter(
            DeviceToken.workspace_id == str(workspace.id),
            DeviceToken.fcm_token == device.fcm_token,
        ).delete()
        db.commit()

    logger.info(
        "devices: test push workspace=%s reason=%s sent=%d dead=%d configured=%s",
        workspace.id, reason, len(sent), len(dead), configured,
    )

    return success_response({
        # False here is the whole answer: FIREBASE_CREDENTIALS_JSON is
        # unset or unusable on this deployment, and no push of any kind
        # has ever left it.
        "configured": configured,
        "sent": len(sent) > 0,
        # True means the token was rejected permanently and has just been
        # deleted — re-register (restart the app) and try again.
        "token_dead": len(dead) > 0,
        "device_type": device.device_type,
        # Null means this device is invisible to `mention` and `chat`
        # pushes in the real fan-out, whatever this test says: both scope
        # their `device_tokens` query by email.
        "user_email": device.user_email,
        # What the real fan-out would have done with this reason. False
        # means a switch on the Notifications screen is off, and an
        # ordinary push for this reason would never have been sent even
        # though this test one was.
        "prefs_would_allow": _prefs_allow(device.prefs, reason),
        "reason": reason,
        "channel": channel or None,
    })
