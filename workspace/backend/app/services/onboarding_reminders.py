# -*- coding: utf-8 -*-
"""Onboarding reminder emails — nudge owners of fresh, never-connected workspaces.

A workspace is "stalled" when it was created with enforced login but no
computer (Node) has ever been paired — the user signed up (typically on
mobile) and never finished the desktop step. We remind the OWNER twice:

  * 24h after creation  → settings["onboard_reminder_24h"]
  * 72h after creation  → settings["onboard_reminder_72h"] (only after the
                          24h one was sent)

and never again. Sent-state lives in `Workspace.settings` (JSON), so there is
no extra table; the settings key doubles as the idempotency marker across
replicas and restarts.

Invoked from the periodic maintenance path in app/main.py with a short-lived
session. Every send is best-effort (`send_email` never raises).
"""

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import exists, select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.config import config
from app.models import Node, User, Workspace, WorkspaceMembership
from app.services.email import email_configured, send_onboarding_reminder

logger = logging.getLogger(__name__)

# Hard floor: never remind workspaces created before this feature shipped,
# so enabling it doesn't blast every pre-existing dormant workspace.
ONBOARDING_REMINDER_CUTOFF = datetime(2026, 8, 28, tzinfo=timezone.utc)

# Stop looking at workspaces older than this — after two ignored reminders
# (or a long-dormant row) there is nothing more to send.
REMINDER_WINDOW_DAYS = 14

KEY_24H = "onboard_reminder_24h"
KEY_72H = "onboard_reminder_72h"


def _aware(dt: datetime | None) -> datetime | None:
    """Normalize DB datetimes (naive in SQLite tests) to UTC-aware."""
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _owner_email(db: Session, workspace_id: str) -> str | None:
    return db.execute(
        select(User.email)
        .join(WorkspaceMembership, WorkspaceMembership.user_id == User.id)
        .where(
            WorkspaceMembership.workspace_id == workspace_id,
            WorkspaceMembership.role == "owner",
        )
        .limit(1)
    ).scalar_one_or_none()


def run_onboarding_reminders(db: Session) -> int:
    """Send due 24h/72h reminders; returns the number of emails sent."""
    if not email_configured():
        return 0

    now = datetime.now(timezone.utc)
    window_start = max(now - timedelta(days=REMINDER_WINDOW_DAYS), ONBOARDING_REMINDER_CUTOFF)
    window_end = now - timedelta(hours=24)
    if window_end <= window_start:
        return 0

    # Candidates: recent enforced-login workspaces that never paired a Node.
    # The settings-key / stage checks happen in Python — this set is tiny
    # (workspaces < 14 days old with zero nodes).
    candidates = db.execute(
        select(Workspace).where(
            Workspace.require_login == True,  # noqa: E712
            Workspace.status != "deleted",
            Workspace.created_at >= window_start,
            Workspace.created_at <= window_end,
            ~exists(select(Node.id).where(Node.workspace_id == Workspace.id)),
        )
    ).scalars().all()

    sent = 0
    for ws in candidates:
        created_at = _aware(ws.created_at)
        if created_at is None or created_at < ONBOARDING_REMINDER_CUTOFF:
            continue

        settings = dict(ws.settings or {})
        if KEY_24H not in settings:
            stage = "24h"  # created_at <= now-24h is guaranteed by the query
        elif KEY_72H not in settings and created_at < now - timedelta(hours=72):
            stage = "72h"
        else:
            continue  # both sent (or 72h not due yet) — never a third

        try:
            owner_email = _owner_email(db, ws.id)
            if owner_email:
                link = f"{config.FRONTEND_BASE_URL}/{ws.slug}"
                if send_onboarding_reminder(owner_email, ws.name, link, stage):
                    sent += 1

            # Mark the stage even when the send failed or there is no owner:
            # retrying a broken send every 5 minutes risks double-emailing far
            # more than one lost nudge costs. Reassign + flag so the JSON
            # column change is persisted.
            settings[KEY_24H if stage == "24h" else KEY_72H] = now.isoformat()
            ws.settings = settings
            flag_modified(ws, "settings")
            db.commit()
        except Exception:
            db.rollback()
            logger.exception("onboarding reminders: failed for workspace %s", ws.id)

    if sent:
        logger.info("onboarding reminders: sent %d email(s)", sent)
    return sent
