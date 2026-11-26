"""DM_SUMMARY_TABLE read switch and the backfill (SQLite; the trigger itself
is covered against PostgreSQL in test_dm_pair_summary_postgres.py)."""
import logging
import time
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import event

from app import cache
from app.database import engine as app_engine  # noqa: F401  (models registered)
from app.models import DmPairSummary, EventRecord
from app.services import dm_pair_summary, dm_summary
from app.services.poll_queries import dm_generation, dm_rewrite_generation


@pytest.fixture
def memory_cache(monkeypatch, db):
    state = SimpleNamespace(store={}, aggregates=[])
    monkeypatch.setattr(cache, 'get_bytes', lambda key: state.store.get(key))
    monkeypatch.setattr(cache, 'set_bytes', lambda key, value, ttl: state.store.__setitem__(key, value))
    monkeypatch.setattr(cache, 'delete_key', lambda key: state.store.pop(key, None))
    monkeypatch.setattr(cache, '_lazy_client', lambda: None)
    monkeypatch.setattr(dm_pair_summary, '_backfilled', {})

    def capture(conn, cursor, statement, *args):
        if 'count(*)' in statement.lower():
            state.aggregates.append(statement)
    event.listen(db.bind, 'before_cursor_execute', capture)
    yield state
    event.remove(db.bind, 'before_cursor_execute', capture)


def dm(db, workspace, source, target, ts):
    db.add(EventRecord(id=str(uuid4()), network_id=workspace['id'], source=source, target=target, timestamp=ts,
                       type='workspace.message.posted', visibility='direct', payload={'content': 'x'}))
    db.commit()


def pairs(db, workspace):
    return dm_summary.workspace_pairs(db, workspace['id'], dm_generation(workspace['id']),
                                      dm_rewrite_generation(workspace['id']))


def seed(db, workspace):
    now = int(time.time() * 1000)
    dm(db, workspace, 'openagents:alpha', 'openagents:beta', now - 900_000)
    dm(db, workspace, 'openagents:beta', 'openagents:alpha', now - 800_000)
    dm(db, workspace, 'human:adam@acme.test', 'openagents:alpha', now - 700_000)
    dm(db, workspace, 'human:system', 'openagents:alpha', now - 600_000)   # never counted


def test_backfill_matches_the_aggregate_and_runs_once(db, workspace, memory_cache):
    seed(db, workspace)
    expected = pairs(db, workspace)
    first = dm_pair_summary.backfill_workspace(db.bind, workspace['id'])
    assert first['pairs'] == 2
    assert dm_pair_summary.read_pairs(db, workspace['id']) == expected
    assert dm_pair_summary.backfill_workspace(db.bind, workspace['id'])['skipped'] == 'already backfilled'
    assert dm_pair_summary.read_pairs(db, workspace['id']) == expected


def test_off_by_default_even_when_backfilled(db, workspace, memory_cache, monkeypatch):
    monkeypatch.delenv('DM_SUMMARY_TABLE', raising=False)
    seed(db, workspace)
    dm_pair_summary.backfill_workspace(db.bind, workspace['id'])
    db.query(DmPairSummary).update({DmPairSummary.msg_count: 99})   # would show if read
    db.commit()
    assert all(n < 99 for _, n in pairs(db, workspace).values())


def test_on_serves_backfilled_workspaces_from_the_table_without_history_scans(db, workspace, memory_cache, monkeypatch):
    monkeypatch.setenv('DM_SUMMARY_TABLE', 'on')
    seed(db, workspace)
    expected = pairs(db, workspace)                 # not backfilled yet: existing path
    assert memory_cache.aggregates
    dm_pair_summary.backfill_workspace(db.bind, workspace['id'])
    memory_cache.aggregates.clear()
    memory_cache.store.clear()                      # no cached base: the old path would rescan
    assert pairs(db, workspace) == expected
    assert memory_cache.aggregates == [], 'served from the table'


def test_shadow_serves_the_existing_path_and_logs_differences(db, workspace, memory_cache, monkeypatch, caplog):
    monkeypatch.setenv('DM_SUMMARY_TABLE', 'shadow')
    monkeypatch.setattr(dm_pair_summary, 'SHADOW_SAMPLE', 1.0)
    seed(db, workspace)
    dm_pair_summary.backfill_workspace(db.bind, workspace['id'])
    expected = pairs(db, workspace)
    db.query(DmPairSummary).update({DmPairSummary.msg_count: 99})
    db.commit()
    memory_cache.store.clear()
    with caplog.at_level(logging.WARNING, logger='app.services.dm_pair_summary'):
        assert pairs(db, workspace) == expected
    assert 'shadow mismatch' in caplog.text
