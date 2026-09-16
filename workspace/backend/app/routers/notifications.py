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
from sqlalchemy import func, select, update
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

@router.get("/notifications")
def list_notifications(
    network: str = Query(...),
    status: Optional[str] = Query("active"),
    is_read: Optional[bool] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """List notifications for the workspace."""
    workspace = _resolve_workspace(db, network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    ws_id = str(workspace.id)

    query = select(NotificationRecord).where(
        NotificationRecord.workspace_id == ws_id,
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
        )
        .values(is_read=True, read_at=now)
        .returning(NotificationRecord.id)
    ).fetchall()
    db.commit()

    return success_response({"updated_count": len(result)})


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
