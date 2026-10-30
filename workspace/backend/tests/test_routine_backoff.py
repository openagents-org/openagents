"""A routine whose agent keeps failing backs off instead of firing every tick.

A 10-minute routine on an agent past its usage limit posted the same error
~150 times a day. After two failed runs in a row the scheduler now waits
30 min (doubling, capped at 6 h) before the next fire, and one good run puts
it back on schedule.
"""
import asyncio
import time
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.models import Channel, EventRecord, RoutineRecord
from app.services.routine_backoff import (
    BACKOFF_MAX_MS,
    backoff_wait_ms,
    consecutive_failed_runs,
)

CHANNEL = "routines:agent-alpha"
MIN = 60 * 1000


def _routine(db, workspace):
    workspace_id = workspace["id"]
    db.add(Channel(
        workspace_id=workspace_id, name=CHANNEL, title="agent-alpha",
        master_agent="agent-alpha", created_by="system:routine", status="active",
    ))
    routine = RoutineRecord(
        id=str(uuid.uuid4()), workspace_id=workspace_id,
        channel_name=CHANNEL, created_by="agent-alpha",
        name="Check inbox", message="check it",
        schedule_interval_minutes=10,
        next_fires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
        status="active",
    )
    db.add(routine)
    db.commit()
    return routine.id


def _event(db, workspace, source, ts, *, message_type="chat", status_kind=None):
    db.add(EventRecord(
        id=str(uuid.uuid4()), network_id=workspace["id"],
        type="workspace.message.posted", source=source, target=f"channel/{CHANNEL}",
        payload={"content": "x", "message_type": message_type},
        metadata_={"status_kind": status_kind} if status_kind else {},
        timestamp=ts,
    ))


def _runs(db, workspace, outcomes, *, last_fire_ago_ms=10 * MIN, spacing_ms=10 * MIN):
    """One fire per outcome, oldest first; 'failed' / 'ok' / None (no reply)."""
    now = int(time.time() * 1000)
    first = now - last_fire_ago_ms - spacing_ms * (len(outcomes) - 1)
    for i, outcome in enumerate(outcomes):
        fired = first + i * spacing_ms
        _event(db, workspace, "system:routine", fired)
        if outcome == "failed":
            _event(db, workspace, "openagents:agent-alpha", fired + 1000, status_kind="error")
        elif outcome == "ok":
            _event(db, workspace, "openagents:agent-alpha", fired + 1000, status_kind="completed")
    db.commit()


def _fires(db):
    return len(db.execute(
        select(EventRecord).where(EventRecord.source == "system:routine")
    ).scalars().all())


def _run_fire_due(monkeypatch):
    import app.database as database
    from app.main import _fire_due
    from tests.conftest import TestingSessionLocal

    monkeypatch.setattr(database, "SessionLocal", TestingSessionLocal)
    asyncio.run(_fire_due())


class TestBackoffWait:
    def test_on_schedule_until_two_failures(self):
        assert backoff_wait_ms(0) == 0
        assert backoff_wait_ms(1) == 0

    def test_doubles_from_thirty_minutes_and_caps(self):
        assert backoff_wait_ms(2) == 30 * MIN
        assert backoff_wait_ms(3) == 60 * MIN
        assert backoff_wait_ms(8) == BACKOFF_MAX_MS


class TestConsecutiveFailedRuns:
    def test_counts_back_to_the_last_good_run(self, workspace, db):
        _runs(db, workspace, ["failed", "ok", "failed", "failed", "failed"])
        failures, _ = consecutive_failed_runs(db, workspace["id"], CHANNEL, "agent-alpha")
        assert failures == 3

    def test_an_unanswered_run_is_not_a_failure(self, workspace, db):
        _runs(db, workspace, ["failed", "failed", None])
        failures, _ = consecutive_failed_runs(db, workspace["id"], CHANNEL, "agent-alpha")
        assert failures == 0

    def test_an_error_beside_a_real_answer_is_a_success(self, workspace, db):
        _runs(db, workspace, ["failed", "failed"])
        now = int(time.time() * 1000)
        _event(db, workspace, "openagents:agent-alpha", now - 5 * MIN)  # plain chat answer
        db.commit()
        failures, _ = consecutive_failed_runs(db, workspace["id"], CHANNEL, "agent-alpha")
        assert failures == 0


class TestFireDueBacksOff:
    def test_skips_a_tick_while_backing_off(self, client, workspace, db, monkeypatch):
        _routine(db, workspace)
        _runs(db, workspace, ["failed", "failed"], last_fire_ago_ms=10 * MIN)
        before = _fires(db)
        _run_fire_due(monkeypatch)
        db.expire_all()
        assert _fires(db) == before, "fired again inside the 30 min backoff"

    def test_fires_once_the_backoff_has_passed(self, client, workspace, db, monkeypatch):
        _routine(db, workspace)
        _runs(db, workspace, ["failed", "failed"], last_fire_ago_ms=31 * MIN)
        before = _fires(db)
        _run_fire_due(monkeypatch)
        db.expire_all()
        assert _fires(db) == before + 1

    def test_a_healthy_routine_fires_on_schedule(self, client, workspace, db, monkeypatch):
        _routine(db, workspace)
        _runs(db, workspace, ["failed", "ok"], last_fire_ago_ms=10 * MIN)
        before = _fires(db)
        _run_fire_due(monkeypatch)
        db.expire_all()
        assert _fires(db) == before + 1
