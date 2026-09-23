# -*- coding: utf-8 -*-
"""The scheduler must survive a database that stores datetimes without a zone.

SQLite has no timestamptz, so a dev database used to hand back naive values
while `_fire_due` compared them against an aware `datetime.now(timezone.utc)`.
The routines' atomic claim raised TypeError every cycle and the timer loop
swallowed it, so no routine ever fired locally. (Timers survived — they fire
earlier in the same pass and set status on the loaded row instead of running a
criteria UPDATE — which is why the failure looked routine-specific.) The API
also serialized those naive values without an offset, which browsers read as
local time, so a routine created a minute ago showed up as overdue.
"""

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.models import Channel, EventRecord, RoutineRecord, TimerRecord, Workspace


def _headers(workspace):
    return {"X-Workspace-Token": workspace["token"]}


def _due_routine(db, workspace, minutes_overdue=1):
    workspace_id = workspace["id"]
    db.add(Channel(
        workspace_id=workspace_id, name="routines:agent-alpha", title="agent-alpha",
        master_agent="agent-alpha", created_by="system:routine", status="active",
    ))
    routine = RoutineRecord(
        id=str(uuid.uuid4()), workspace_id=workspace_id,
        channel_name="routines:agent-alpha", created_by="agent-alpha",
        name="Send the report", message="send it",
        schedule_interval_minutes=3,
        next_fires_at=datetime.now(timezone.utc) - timedelta(minutes=minutes_overdue),
        status="active",
    )
    db.add(routine)
    db.commit()
    return routine.id


def _run_fire_due(monkeypatch, session_factory):
    """Run the scheduler's firing pass against the test database."""
    import app.database as database
    from app.main import _fire_due

    monkeypatch.setattr(database, "SessionLocal", session_factory)
    asyncio.run(_fire_due())


class TestStoredDatetimesKeepTheirZone:
    def test_loaded_value_is_aware(self, client, workspace, db):
        routine_id = _due_routine(db, workspace)
        loaded = db.execute(
            select(RoutineRecord).where(RoutineRecord.id == routine_id)
        ).scalar_one()
        assert loaded.next_fires_at.tzinfo is not None, "naive value would break every UTC comparison"

    def test_api_serializes_an_offset(self, client, workspace):
        resp = client.post("/v1/routines", json={
            "name": "probe", "message": "ping", "network": workspace["id"],
            "channel": workspace["channel"]["name"], "source": "openagents:agent-alpha",
            "interval_minutes": 3,
        }, headers=_headers(workspace))
        next_fires_at = resp.json()["data"]["next_fires_at"]
        # Without an offset a browser parses this as local time, so a routine
        # three minutes out reads as hours overdue east of UTC.
        assert next_fires_at.endswith("+00:00"), next_fires_at


class TestFireDue:
    def test_a_due_routine_actually_fires(self, client, workspace, db, monkeypatch):
        from tests.conftest import TestingSessionLocal

        routine_id = _due_routine(db, workspace)
        _run_fire_due(monkeypatch, TestingSessionLocal)

        db.expire_all()
        routine = db.execute(
            select(RoutineRecord).where(RoutineRecord.id == routine_id)
        ).scalar_one()
        assert routine.last_fired_at is not None, "routine never fired"
        assert routine.next_fires_at > datetime.now(timezone.utc), "schedule was not advanced"

        fired = db.execute(
            select(EventRecord).where(EventRecord.source == "system:routine")
        ).scalars().all()
        assert len(fired) == 1

    def test_a_due_timer_actually_fires(self, client, workspace, db, monkeypatch):
        from tests.conftest import TestingSessionLocal

        timer = TimerRecord(
            id=str(uuid.uuid4()), workspace_id=workspace["id"],
            channel_name=workspace["channel"]["name"], created_by="openagents:agent-alpha",
            message="wake up", delay_seconds=60,
            fires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
            status="active",
        )
        db.add(timer)
        db.commit()

        _run_fire_due(monkeypatch, TestingSessionLocal)

        db.expire_all()
        refreshed = db.execute(
            select(TimerRecord).where(TimerRecord.id == timer.id)
        ).scalar_one()
        assert refreshed.status == "fired"
