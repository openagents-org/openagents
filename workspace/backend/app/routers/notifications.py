# -*- coding: utf-8 -*-
"""
Notification endpoints — workspace inbox for agent-to-human notifications.

POST   /v1/notifications              Create a notification (and push it)
GET    /v1/notifications              List notifications
GET    /v1/notifications/{id}         Read one notification
PATCH  /v1/notifications/{id}/read    Mark a notification as read
PATCH  /v1/notifications/read-all     Mark all notifications as read
DELETE /v1/notifications/{id}         Dismiss a notification
"""

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, Path, Query
from pydantic import BaseModel
from sqlalchemy import or_, func, select, update
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import NotificationRecord, Workspace
from app.response import ResponseCode, json_response, success_response
from app.routers.network import _resolve_workspace, _verify_workspace_access
from app.services.notify import notify

logger = logging.getLogger(__name__)

# These handlers use synchronous SQLAlchemy sessions. Keep them as `def` so
# connection-pool waits run in FastAPI's threadpool, never on the event loop.
router = APIRouter(prefix="/v1", tags=["Notifications"])

VALID_PRIORITIES = {"low", "normal", "high"}


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class CreateNotificationRequest(BaseModel):
    network: str
    source: str
    title: str
    message: str
    priority: Optional[str] = "normal"
    channel: Optional[str] = None
    thread_id: Optional[str] = None
    link_url: Optional[str] = None
    # Which switch on the phone's Notifications screen can mute the push, and
    # nothing else — the inbox record is filed either way. Free-form to match
    # the client (`PushReason`): a value this backend has never heard of is
    # still delivered, it simply passes the preference gate unfiltered.
    # Defaults to `task_completed`, i.e. the Task Completions switch.
    reason: Optional[str] = None
    # Set false for something worth finding later but not worth interrupting
    # anyone for.
    push: Optional[bool] = True


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _serialize_notification(n: NotificationRecord) -> dict:
    return {
        "id": n.id,
        "title": n.title,
        "message": n.message,
        "priority": n.priority,
        "is_read": n.is_read,
        "created_by": n.created_by,
        "channel_name": n.channel_name,
        "thread_id": n.thread_id,
        "link_url": n.link_url,
        "status": n.status,
        # v1.1 — what the row is about, so the inbox can render it as an
        # actionable card: `kind` (approval | help | proposal | ...), the id
        # of the thing to act on, and the person it is addressed to (None =
        # the whole workspace).
        "kind": n.kind,
        "action_ref": n.action_ref,
        "recipient_email": n.recipient_email,
        "created_at": n.created_at.isoformat() if n.created_at else None,
        "read_at": n.read_at.isoformat() if n.read_at else None,
    }


# ---------------------------------------------------------------------------
# POST /v1/notifications
# ---------------------------------------------------------------------------

@router.post("/notifications")
def create_notification(
    body: CreateNotificationRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Create a notification in the workspace inbox."""
    workspace = _resolve_workspace(db, body.network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    priority = body.priority or "normal"
    if priority not in VALID_PRIORITIES:
        return json_response(
            ResponseCode.BAD_REQUEST,
            f"priority must be one of: {', '.join(sorted(VALID_PRIORITIES))}",
        )

    notification = notify(
        db,
        str(workspace.id),
        source=body.source,
        title=body.title,
        message=body.message,
        priority=priority,
        channel_name=body.channel,
        thread_id=body.thread_id,
        link_url=body.link_url,
        reason=body.reason,
        push=body.push is not False,
    )
    db.commit()

    return success_response(_serialize_notification(notification))


# ---------------------------------------------------------------------------
# GET /v1/notifications
# ---------------------------------------------------------------------------

# DM / @mention signals (services/people_notify) are personal unread markers,
# not inbox items: the web app turns them into desktop notifications and
# unread highlights (Slack-style). The inbox list and its unread count leave
# them out unless a caller asks for them with `kinds=`.
SIGNAL_KINDS = ("dm", "mention")


@router.get("/notifications")
def list_notifications(
    network: str = Query(...),
    status: Optional[str] = Query("active"),
    is_read: Optional[bool] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    kinds: Optional[str] = Query(None, description="Comma-separated kinds, e.g. dm,mention (signals)"),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """List notifications for the workspace (the inbox), or — with
    `kinds=dm,mention` — the caller's own DM / mention signals."""
    workspace = _resolve_workspace(db, network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    ws_id = str(workspace.id)

    # v1.1: a person sees workspace-wide rows plus rows addressed to them,
    # never rows about threads they cannot read. Machines see everything.
    from sqlalchemy import or_
    from app.services.visibility import hidden_channel_names, resolve_viewer
    viewer = resolve_viewer(db, workspace, x_workspace_token, authorization)
    person_filters = []
    if viewer.is_human:
        person_filters.append(or_(
            NotificationRecord.recipient_email.is_(None),
            NotificationRecord.recipient_email == (viewer.email or ""),
        ))
        hidden = hidden_channel_names(db, ws_id, viewer)
        if hidden:
            person_filters.append(or_(
                NotificationRecord.channel_name.is_(None),
                NotificationRecord.channel_name.notin_(list(hidden)),
            ))

    wanted_kinds = [k.strip().lower() for k in (kinds or "").split(",") if k.strip()]
    if wanted_kinds:
        if any(k in SIGNAL_KINDS for k in wanted_kinds):
            # Signals are personal: only rows addressed to the signed-in caller.
            if not (viewer.is_human and viewer.email):
                return success_response({"notifications": [], "unread_count": 0})
            person_filters.append(NotificationRecord.recipient_email == viewer.email)
        person_filters.append(NotificationRecord.kind.in_(wanted_kinds))
    else:
        person_filters.append(or_(
            NotificationRecord.kind.is_(None),
            NotificationRecord.kind.notin_(SIGNAL_KINDS),
        ))

    query = select(NotificationRecord).where(
        NotificationRecord.workspace_id == ws_id,
        *person_filters,
    )
    if status:
        query = query.where(NotificationRecord.status == status)
    if is_read is not None:
        query = query.where(NotificationRecord.is_read == is_read)

    query = query.order_by(NotificationRecord.created_at.desc())
    query = query.offset(offset).limit(limit)
    rows = db.execute(query).scalars().all()

    unread_count = db.execute(
        select(func.count(NotificationRecord.id)).where(
            NotificationRecord.workspace_id == ws_id,
            NotificationRecord.status == "active",
            NotificationRecord.is_read == False,  # noqa: E712
            *person_filters,
        )
    ).scalar() or 0

    return success_response({
        "notifications": [_serialize_notification(n) for n in rows],
        "unread_count": unread_count,
    })


# ---------------------------------------------------------------------------
# GET /v1/notifications/{id}
# ---------------------------------------------------------------------------

@router.get("/notifications/{notification_id}")
def get_notification(
    notification_id: str = Path(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Read one notification.

    Exists for the case where the id is all the client has: a push carries
    `data.notification_id` and nothing else, so a phone opening a tapped
    notification from cold has no list to find it in. Takes no `network` —
    like the read/dismiss endpoints, the workspace is resolved from the row and
    then checked, so a caller cannot use this to probe another workspace's ids.
    """
    notification = db.execute(
        select(NotificationRecord).where(NotificationRecord.id == notification_id)
    ).scalar_one_or_none()
    if not notification:
        return json_response(ResponseCode.NOT_FOUND, "Notification not found")

    workspace = db.execute(
        select(Workspace).where(Workspace.id == notification.workspace_id)
    ).scalar_one_or_none()
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    return success_response(_serialize_notification(notification))


# ---------------------------------------------------------------------------
# PATCH /v1/notifications/{id}/read
# ---------------------------------------------------------------------------

@router.patch("/notifications/{notification_id}/read")
def mark_notification_read(
    notification_id: str = Path(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Mark a single notification as read."""
    notification = db.execute(
        select(NotificationRecord).where(NotificationRecord.id == notification_id)
    ).scalar_one_or_none()
    if not notification:
        return json_response(ResponseCode.NOT_FOUND, "Notification not found")

    workspace = db.execute(
        select(Workspace).where(Workspace.id == notification.workspace_id)
    ).scalar_one_or_none()
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    notification.is_read = True
    notification.read_at = datetime.now(timezone.utc)
    db.commit()

    return success_response({"id": notification.id, "is_read": True})


# ---------------------------------------------------------------------------
# PATCH /v1/notifications/read-all
# ---------------------------------------------------------------------------

@router.patch("/notifications/read-all")
def mark_all_notifications_read(
    network: str = Query(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Mark all active notifications as read."""
    workspace = _resolve_workspace(db, network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    now = datetime.now(timezone.utc)
    result = db.execute(
        update(NotificationRecord)
        .where(
            NotificationRecord.workspace_id == str(workspace.id),
            NotificationRecord.is_read == False,  # noqa: E712
            NotificationRecord.status == "active",
            or_(NotificationRecord.kind.is_(None), NotificationRecord.kind.notin_(SIGNAL_KINDS)),
        )
        .values(is_read=True, read_at=now)
        .returning(NotificationRecord.id)
    ).fetchall()
    db.commit()

    return success_response({"updated_count": len(result)})


# ---------------------------------------------------------------------------
# PATCH /v1/notifications/read-channel — opening a thread / DM clears its
# DM and mention signals for the caller.
# ---------------------------------------------------------------------------

@router.patch("/notifications/read-channel")
def mark_channel_signals_read(
    network: str = Query(...),
    channel: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace = _resolve_workspace(db, network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")
    from app.services.visibility import resolve_viewer
    viewer = resolve_viewer(db, workspace, x_workspace_token, authorization)
    if not (viewer.is_human and viewer.email):
        return success_response({"marked": 0})
    now = datetime.now(timezone.utc)
    result = db.execute(
        update(NotificationRecord)
        .where(
            NotificationRecord.workspace_id == str(workspace.id),
            NotificationRecord.recipient_email == viewer.email,
            NotificationRecord.channel_name == channel,
            NotificationRecord.kind.in_(SIGNAL_KINDS),
            NotificationRecord.is_read == False,  # noqa: E712
        )
        .values(is_read=True, read_at=now)
        .returning(NotificationRecord.id)
    ).fetchall()
    db.commit()
    return success_response({"marked": len(result)})


# ---------------------------------------------------------------------------
# DELETE /v1/notifications/{id}
# ---------------------------------------------------------------------------

@router.delete("/notifications/{notification_id}")
def dismiss_notification(
    notification_id: str = Path(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Dismiss a notification (soft delete)."""
    notification = db.execute(
        select(NotificationRecord).where(NotificationRecord.id == notification_id)
    ).scalar_one_or_none()
    if not notification:
        return json_response(ResponseCode.NOT_FOUND, "Notification not found")

    workspace = db.execute(
        select(Workspace).where(Workspace.id == notification.workspace_id)
    ).scalar_one_or_none()
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    notification.status = "dismissed"
    db.commit()

    return success_response({"id": notification.id, "status": "dismissed"})
