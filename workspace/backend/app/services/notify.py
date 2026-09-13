# -*- coding: utf-8 -*-
"""
Inbox notifications — one call that both files the record and wakes the phone.

Every producer here had already decided that a person needs to know something:
a Kanban card blocked on human input, a workflow step waiting on a decision, an
agent saying so explicitly through `POST /v1/notifications`. Until this module
existed each of them wrote a `NotificationRecord` and stopped, so the message
only ever arrived if the user happened to open the app and look — the one
condition under which they did not need telling.

`notify()` is deliberately the only way in. Four call sites wrote those records
before, and adding "…and also push" to each of them guarantees the fifth one
forgets; making the insert and the push the same call means a producer cannot
file a notification that silently never leaves the database.

## Ordering

The push is fired from an `after_commit` hook rather than inline, because the
record's own transaction may still roll back — a notification that reaches the
phone for a card whose move was rolled back is worse than a late one. If the
caller never commits, nothing is sent.

## Failure

Best-effort throughout: a send that fails is logged and dropped. Nothing here
may break the work that produced the notification — the card still moves, the
workflow still advances.
"""

import logging
import threading

from sqlalchemy import event as sa_event

from app.database import SessionLocal
from app.models import NotificationRecord

logger = logging.getLogger(__name__)

# Which push reason an inbox notification travels under, and so which switch on
# the mobile Notifications screen can mute it (see `push._REASON_PREF_KEY`).
#
# "approval" is the one that was defined on both sides and never produced: the
# client has shipped the switch since the first push release, and these two
# states — a card that cannot proceed, a workflow step waiting on a person —
# are exactly what it was reserved for.
REASON_APPROVAL = "approval"
REASON_TASK_COMPLETED = "task_completed"
REASON_ERROR = "error"

_DEFAULT_REASON = REASON_TASK_COMPLETED


def notify(
    db,
    workspace_id: str,
    *,
    source: str,
    title: str,
    message: str,
    priority: str = "normal",
    channel_name: str | None = None,
    thread_id: str | None = None,
    link_url: str | None = None,
    reason: str | None = None,
    push: bool = True,
) -> NotificationRecord:
    """File an inbox notification and (unless `push=False`) send it.

    Returns the flushed record so callers can read its id. The caller owns the
    transaction — this does not commit.

    `push=False` is for notifications that belong in the inbox but do not
    justify a phone buzzing: see the campaign credits grant, which is worth
    finding later and not worth interrupting anyone for.
    """
    record = NotificationRecord(
        workspace_id=str(workspace_id),
        created_by=source,
        title=title,
        message=message,
        priority=priority or "normal",
        channel_name=channel_name,
        thread_id=thread_id,
        link_url=link_url,
    )
    db.add(record)
    # Needed before the hook is armed: the id is what the phone uses to open
    # this exact notification, and it does not exist until the INSERT lands.
    db.flush()

    if not push:
        return record

    # Plain values, captured now. The hook runs after the session has
    # committed, at which point touching the ORM object could re-query on a
    # session the caller may already have closed.
    snapshot = {
        "id": record.id,
        "workspace_id": str(workspace_id),
        "title": title,
        "message": message,
        "priority": record.priority,
        "channel_name": channel_name or "",
        "source": source,
        "reason": reason or _reason_for(priority),
    }
    sa_event.listen(
        db,
        "after_commit",
        lambda _session: _dispatch(snapshot),
        once=True,
    )
    return record


def _reason_for(priority: str) -> str:
    """The push reason for a notification whose producer did not name one.

    High priority does *not* map to `approval`: that switch is labelled
    "Approval Requests" on the phone, and routing every urgent-ish agent
    message through it would mean a user who muted approvals stops hearing
    about errors too. Producers that really are asking for a decision pass
    `reason=REASON_APPROVAL` explicitly.
    """
    return _DEFAULT_REASON


def _dispatch(snapshot: dict) -> None:
    """Hand the send to a daemon thread.

    A thread rather than FastAPI's BackgroundTasks because most callers are
    pipeline mods and services with no request object to hang a task on. The
    thread opens its own session (the caller's may be closed by now) and the
    FCM client is synchronous, so nothing here can block an event loop.
    """
    try:
        threading.Thread(
            target=_send,
            args=(snapshot,),
            name="notify-push",
            daemon=True,
        ).start()
    except Exception as e:  # pragma: no cover — thread spawn failure
        logger.warning("notify: could not spawn push thread: %s", e)


def _send(snapshot: dict) -> None:
    from app.services.push import fanout_for_notification

    try:
        if not _record_exists(snapshot.get("id")):
            # The `after_commit` hook is armed `once=True` but SQLAlchemy does
            # not disarm it on rollback: if the caller rolled this INSERT back
            # and later committed unrelated work in the same session, the hook
            # still fires. Re-checking against the database is what makes the
            # push follow the record rather than the listener — and it also
            # covers a notification dismissed between commit and this thread
            # starting. A phone must never receive a tap that 404s.
            logger.info(
                "notify: skipped push for notification=%s — record not present",
                snapshot.get("id"),
            )
            return
        fanout_for_notification(snapshot)
    except Exception as e:
        logger.warning(
            "notify: push failed for notification=%s: %s", snapshot.get("id"), e,
        )


def _record_exists(notification_id) -> bool:
    """Whether the committed row is really there, read on a fresh session."""
    if not notification_id:
        return False
    from sqlalchemy import select

    db = SessionLocal()
    try:
        return db.execute(
            select(NotificationRecord.id).where(NotificationRecord.id == notification_id)
        ).first() is not None
    finally:
        db.close()
