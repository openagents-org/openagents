"""Back off a routine whose agent keeps failing.

A routine fires on its schedule whatever the last run did. When the agent
cannot work at all — usage limit hit, CLI broken, signed out — every fire
comes back as the same error: a 10-minute routine posted ~150 identical
"usage limit" errors a day into its channel, and kept spending whatever quota
was left on retries that could not succeed.

After ``BACKOFF_AFTER`` failed runs in a row the scheduler now waits longer
before firing into that channel again (30 min, doubling, capped at 6 h), and
the first run that succeeds puts it straight back on schedule. The routine is
never paused: a usage limit resets by itself, and the routine should resume
without anyone noticing it had stopped.

Runs are judged per routine channel, which is per agent — when the agent is
what fails, every routine it owns fails alike.
"""
from __future__ import annotations

from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import EventRecord

BACKOFF_AFTER = 2
BACKOFF_BASE_MS = 30 * 60 * 1000
BACKOFF_MAX_MS = 6 * 60 * 60 * 1000
# Enough history to reach the cap: 2 failures → 30 min, … 6 → 6 h.
LOOKBACK_FIRES = 8

_FAILED_STATUS_KINDS = frozenset({"failed", "error", "errored"})


def _status_kind(event: EventRecord) -> str:
    for container in (event.payload, event.metadata_):
        if isinstance(container, dict) and container.get("status_kind"):
            return str(container["status_kind"]).strip().lower()
    return ""


def _run_outcome(replies: list[EventRecord]) -> Optional[str]:
    """'ok', 'failed', or None for a run with no answer yet."""
    answers = []
    for r in replies:
        payload = r.payload if isinstance(r.payload, dict) else {}
        msg_type = payload.get("message_type") or "chat"
        if msg_type in ("chat", "error"):
            answers.append((msg_type, _status_kind(r)))
    if not answers:
        return None
    if all(t == "error" or kind in _FAILED_STATUS_KINDS for t, kind in answers):
        return "failed"
    return "ok"


def consecutive_failed_runs(
    db: Session, workspace_id: str, channel_name: str, agent_name: str,
) -> tuple[int, Optional[int]]:
    """Failed runs in a row, newest first, and the latest fire's timestamp (ms).

    Counting stops at the first run that succeeded or has not answered yet —
    an unanswered run may still be working, and is not a failure.
    """
    target = f"channel/{channel_name}"
    fires = db.execute(
        select(EventRecord.timestamp)
        .where(
            EventRecord.network_id == workspace_id,
            EventRecord.target == target,
            EventRecord.type == "workspace.message.posted",
            EventRecord.source == "system:routine",
        )
        .order_by(EventRecord.timestamp.desc())
        .limit(LOOKBACK_FIRES)
    ).scalars().all()
    if not fires:
        return 0, None

    replies = db.execute(
        select(EventRecord)
        .where(
            EventRecord.network_id == workspace_id,
            EventRecord.target == target,
            EventRecord.type == "workspace.message.posted",
            EventRecord.source == f"openagents:{agent_name}",
            EventRecord.timestamp > fires[-1],
        )
        .order_by(EventRecord.timestamp.asc())
    ).scalars().all()

    failures = 0
    for i, fired_at in enumerate(fires):
        until = fires[i - 1] if i > 0 else None
        window = [
            r for r in replies
            if r.timestamp > fired_at and (until is None or r.timestamp <= until)
        ]
        if _run_outcome(window) != "failed":
            break
        failures += 1
    return failures, fires[0]


def backoff_wait_ms(failures: int) -> int:
    """How long after the last fire the next may go out; 0 = on schedule."""
    if failures < BACKOFF_AFTER:
        return 0
    return min(BACKOFF_BASE_MS * 2 ** (failures - BACKOFF_AFTER), BACKOFF_MAX_MS)
