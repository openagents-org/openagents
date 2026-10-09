# -*- coding: utf-8 -*-
"""
Slack-like notifications for people: direct messages and @mentions.

Called from `POST /v1/events` right after a `workspace.message.posted` commit.
Two cases produce an inbox notification addressed to one person (and, through
`notify()`, a push scoped to that person's devices):

  * **DM to a person** — `visibility=direct`, target `human:<email>`. The
    notification's `channel_name` is the DM session id the frontend uses:
    ``"dm:" + ",".join(sorted([source, target]))``. Bursts collapse: another
    message from the same sender while an earlier DM notification is still
    unread (and under 10 minutes old) refreshes that row instead of adding one,
    and does not buzz the phone again.
  * **Mention in a thread** — target `channel/<name>`. Recipients are the
    union of `payload.mentioned_humans` (emails from the web composer),
    `@<email>` tokens and `@<key>` tokens (display-name slug / email local
    part, see `push._workspace_human_keys`). Only people who can view the
    thread are notified — a private thread never leaks to a non-participant.

Best-effort: every failure is logged and swallowed; the event is already
committed and must stay that way.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional, Set

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Channel, NotificationRecord, User, Workspace, WorkspaceCollaborator
from app.services.message_identity import human_sender_email

logger = logging.getLogger(__name__)

SNIPPET_MAX = 240
DM_COLLAPSE_WINDOW = timedelta(minutes=10)

_EMAIL_MENTION_RE = re.compile(r"@([A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)+)")


def dm_session_id(source: str, target: str) -> str:
    """The DM conversation id shared with the frontend."""
    return "dm:" + ",".join(sorted([source, target]))


def _norm(email) -> Optional[str]:
    e = (email or "").strip().lower() if isinstance(email, str) else ""
    return e or None


def _person_email(address: str) -> Optional[str]:
    """`human:<email>` → email; anything else (agents, `human:user`) → None."""
    if not isinstance(address, str) or not address.startswith("human:"):
        return None
    rest = _norm(address[len("human:"):])
    if rest and "@" in rest:
        return rest
    return None


def _snippet(content) -> str:
    text = str(content or "").strip()
    if len(text) > SNIPPET_MAX:
        text = text[: SNIPPET_MAX - 1] + "…"
    return text or "(no content)"


def _display_name(db: Session, workspace_id: str, email: str) -> Optional[str]:
    row = db.execute(
        select(WorkspaceCollaborator.display_name).where(
            WorkspaceCollaborator.workspace_id == workspace_id,
            WorkspaceCollaborator.email == email,
        )
    ).first()
    if row and row[0]:
        return row[0]
    row = db.execute(select(User.display_name).where(User.email == email)).first()
    if row and row[0]:
        return row[0]
    return None


def _sender_name(db: Session, workspace_id: str, event: dict, sender_email: Optional[str]) -> str:
    payload = event.get("payload") or {}
    name = payload.get("sender_name")
    if isinstance(name, str) and name.strip():
        return name.strip()
    if sender_email:
        return _display_name(db, workspace_id, sender_email) or sender_email
    source = str(event.get("source") or "")
    return source.split(":", 1)[1] if ":" in source else (source or "Someone")


def _is_member(db: Session, workspace: Workspace, email: str) -> bool:
    from app.services.access_model import role_for_email
    return role_for_email(db, workspace, email) is not None


def _human_principal(db: Session, workspace: Workspace, email: str):
    from app.services.access_model import Principal, role_for_email
    return Principal("human", email=email, role=role_for_email(db, workspace, email),
                     workspace_id=str(workspace.id))


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def notify_people_for_event(db: Session, workspace: Workspace, event: dict) -> int:
    """File DM / mention notifications for a committed message event.

    Uses the caller's session and commits it (the push is armed on commit).
    Returns how many notifications were filed or refreshed. Never raises.
    """
    try:
        if event.get("type") != "workspace.message.posted":
            return 0
        payload = event.get("payload") or {}
        msg_type = payload.get("message_type")
        if msg_type not in (None, "", "chat"):
            return 0
        target = str(event.get("target") or "")
        if event.get("visibility") == "direct" and target.startswith("human:"):
            n = _notify_dm(db, workspace, event)
        elif target.startswith("channel/"):
            n = _notify_mentions(db, workspace, event)
        else:
            return 0
        if n:
            db.commit()
        return n
    except Exception as e:
        logger.warning("people_notify: failed for event=%s: %s", event.get("id"), e)
        try:
            db.rollback()
        except Exception:
            pass
        return 0


def _sender_email_of(event: dict) -> Optional[str]:
    source = str(event.get("source") or "")
    email = _person_email(source)
    if email:
        return email
    if source.startswith("human:"):
        return human_sender_email(event.get("payload"), event.get("metadata"))
    return None


# ---------------------------------------------------------------------------
# Direct messages
# ---------------------------------------------------------------------------

def _notify_dm(db: Session, workspace: Workspace, event: dict) -> int:
    from app.services.notify import notify

    source = str(event.get("source") or "")
    target = str(event.get("target") or "")
    recipient = _person_email(target)
    if not recipient:
        return 0
    sender_email = _sender_email_of(event)
    if sender_email == recipient or source == target:
        return 0
    wid = str(workspace.id)
    if not _is_member(db, workspace, recipient):
        return 0

    payload = event.get("payload") or {}
    name = _sender_name(db, wid, event, sender_email)
    title = f"{name} sent you a message"
    message = _snippet(payload.get("content"))
    session = dm_session_id(source, target)

    # Burst collapse: refresh the still-unread notification from this sender.
    latest = db.execute(
        select(NotificationRecord)
        .where(
            NotificationRecord.workspace_id == wid,
            NotificationRecord.kind == "dm",
            NotificationRecord.recipient_email == recipient,
            NotificationRecord.created_by == source,
            NotificationRecord.is_read.is_(False),
            NotificationRecord.status == "active",
        )
        .order_by(NotificationRecord.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    now = datetime.now(timezone.utc)
    created = _aware(latest.created_at) if latest is not None else None
    if latest is not None and created is not None and now - created <= DM_COLLAPSE_WINDOW:
        latest.message = message
        latest.title = title
        latest.created_at = now
        latest.channel_name = session
        db.flush()
        return 1

    notify(
        db, wid,
        source=source,
        kind="dm",
        recipient_email=recipient,
        channel_name=session,
        title=title,
        message=message,
        reason="mention",
        push=True,
    )
    return 1


# ---------------------------------------------------------------------------
# Mentions in threads
# ---------------------------------------------------------------------------

def mentioned_people(db: Session, workspace_id: str, payload: dict) -> Set[str]:
    """Emails of people a message mentions (not yet filtered by access)."""
    from app.services.push import _extract_mentions, _workspace_human_keys

    out: Set[str] = set()
    raw = payload.get("mentioned_humans")
    if isinstance(raw, (list, tuple)):
        for item in raw:
            e = _norm(item)
            if e and "@" in e:
                out.add(e)
    content = str(payload.get("content") or "")
    if content:
        for m in _EMAIL_MENTION_RE.finditer(content):
            out.add(m.group(1).lower())
        if "@" in content:
            keys = _workspace_human_keys(db, workspace_id)
            for key in _extract_mentions(content):
                if key in keys:
                    out.add(keys[key])
    return out


def _notify_mentions(db: Session, workspace: Workspace, event: dict) -> int:
    from app.services.notify import notify
    from app.services.visibility import can_view_channel_name

    payload = event.get("payload") or {}
    wid = str(workspace.id)
    recipients = mentioned_people(db, wid, payload)
    sender_email = _sender_email_of(event)
    if sender_email:
        recipients.discard(sender_email)
    if not recipients:
        return 0

    channel_name = str(event.get("target") or "")[len("channel/"):]
    channel = db.execute(
        select(Channel).where(Channel.workspace_id == wid, Channel.name == channel_name)
    ).scalar_one_or_none()
    thread_title = (channel.title if channel is not None and channel.title else None) or channel_name
    name = _sender_name(db, wid, event, sender_email)
    message = _snippet(payload.get("content"))
    source = str(event.get("source") or "")

    count = 0
    for email in sorted(recipients):
        if not _is_member(db, workspace, email):
            continue
        if not can_view_channel_name(db, wid, _human_principal(db, workspace, email), channel_name):
            continue
        notify(
            db, wid,
            source=source,
            kind="mention",
            recipient_email=email,
            channel_name=channel_name,
            title=f"{name} mentioned you in {thread_title}",
            message=message,
            reason="mention",
            push=True,
        )
        count += 1
    return count


__all__ = ["notify_people_for_event", "dm_session_id", "mentioned_people"]
