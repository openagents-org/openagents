"""Incremental, workspace-wide DM totals stay exact for every viewer."""
import random
import time
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import event

from app import cache
from app.models import EventRecord
from app.routers.events import _dm_privacy_clause
from app.services import dm_summary
from app.services.conversation_queries import conversation_pairs_query
from app.services.poll_queries import dm_generation, dm_rewrite_generation
from tests.test_people_messaging import people, quiet_side_effects, _as  # noqa: F401


@pytest.fixture
def memory_cache(monkeypatch, db):
    state = SimpleNamespace(store={}, queries=[], now=time.time())
    monkeypatch.setattr(cache, 'get_bytes', lambda key: state.store.get(key))
    monkeypatch.setattr(cache, 'set_bytes', lambda key, value, ttl: state.store.__setitem__(key, value))
    monkeypatch.setattr(cache, 'delete_key', lambda key: state.store.pop(key, None))
    monkeypatch.setattr(cache, '_lazy_client', lambda: None)
    monkeypatch.setattr(dm_summary.time, 'time', lambda: state.now)

    def capture(conn, cursor, statement, *args):
        if 'msg_count' in statement:
            state.queries.append(statement)
    event.listen(db.bind, 'before_cursor_execute', capture)
    yield state
    event.remove(db.bind, 'before_cursor_execute', capture)


ADDRESSES = ['human:adam@acme.test', 'human:mia@acme.test', 'human:user',
             'openagents:alpha', 'openagents:beta', 'openagents:gamma']


def dm(db, workspace, source, target, ts, message_type='chat'):
    row = EventRecord(id=str(uuid4()), network_id=workspace['id'], source=source, target=target, timestamp=ts,
                      type='workspace.message.posted', visibility='direct',
                      payload={'content': 'x', 'message_type': message_type})
    db.add(row)
    db.commit()
    return row


def totals(db, workspace, state):
    return dm_summary.workspace_pairs(db, workspace['id'], dm_generation(workspace['id']),
                                      dm_rewrite_generation(workspace['id']))


def expected(db, workspace, mine, agent=None, limit=50):
    filters = [_dm_privacy_clause(mine)] if mine is not None else []
    return [dict(r._mapping) for r in db.execute(conversation_pairs_query(workspace['id'], limit, agent, filters))]


def test_matches_the_per_viewer_aggregate_for_every_viewer(db, workspace, memory_cache):
    rng = random.Random(7)
    now_ms = int(memory_cache.now * 1000)
    for i in range(120):
        a, b = rng.sample(ADDRESSES, 2)
        dm(db, workspace, a, b, now_ms - rng.randint(0, 600_000))
    pairs = totals(db, workspace, memory_cache)
    for mine in (None, [], ['human:adam@acme.test'], ['openagents:alpha', 'human:mia@acme.test']):
        for agent in (None, 'openagents:beta'):
            for limit in (3, 50):
                got = dm_summary.visible_pairs(pairs, mine, agent, limit)
                assert got == expected(db, workspace, mine, agent, limit), (mine, agent, limit)


def test_new_dms_only_aggregate_the_delta(db, workspace, memory_cache):
    now_ms = int(memory_cache.now * 1000)
    dm(db, workspace, 'openagents:alpha', 'openagents:beta', now_ms - 300_000)   # in the base
    assert totals(db, workspace, memory_cache)[('openagents:alpha', 'openagents:beta')] == [now_ms - 300_000, 1]
    memory_cache.queries.clear()

    for i in range(3):
        dm(db, workspace, 'openagents:beta', 'openagents:alpha', now_ms + i)
    memory_cache.now += dm_summary.MERGED_MAX_STALE_SECONDS + 1
    assert totals(db, workspace, memory_cache)[('openagents:alpha', 'openagents:beta')] == [now_ms + 2, 4]
    assert len(memory_cache.queries) == 1, 'only the small delta is aggregated; the base is reused'


def test_one_computation_serves_every_viewer(client, db, workspace, memory_cache, people):
    now_ms = int(memory_cache.now * 1000)
    dm(db, workspace, 'openagents:alpha', 'openagents:beta', now_ms)
    for who in ('adam', 'mia', 'vic'):
        assert client.get('/v1/events/conversations', params={'network': workspace['id']},
                          headers=_as(who, workspace)).status_code == 200
    assert len(memory_cache.queries) == 2, 'base + delta once, not per viewer'


def test_deleted_dm_rebuilds_the_base(db, workspace, memory_cache):
    now_ms = int(memory_cache.now * 1000)
    keep = dm(db, workspace, 'openagents:alpha', 'openagents:beta', now_ms - 300_000)
    gone = dm(db, workspace, 'openagents:alpha', 'openagents:beta', now_ms - 200_000)
    assert totals(db, workspace, memory_cache)[('openagents:alpha', 'openagents:beta')][1] == 2
    db.delete(gone)
    db.commit()
    memory_cache.now += dm_summary.MERGED_MAX_STALE_SECONDS + 1
    assert totals(db, workspace, memory_cache)[('openagents:alpha', 'openagents:beta')] == [keep.timestamp, 1]


def test_status_and_thinking_dms_are_counted_like_the_aggregate(db, workspace, memory_cache):
    now_ms = int(memory_cache.now * 1000)
    dm(db, workspace, 'openagents:alpha', 'openagents:beta', now_ms, 'status')
    assert dm_summary.visible_pairs(totals(db, workspace, memory_cache), None, None, 50) == expected(db, workspace, None)


def test_a_late_row_older_than_the_base_is_picked_up_by_the_next_rebuild(db, workspace, memory_cache):
    now_ms = int(memory_cache.now * 1000)
    dm(db, workspace, 'openagents:alpha', 'openagents:beta', now_ms - 300_000)
    totals(db, workspace, memory_cache)
    dm(db, workspace, 'openagents:alpha', 'openagents:beta', now_ms - 400_000)   # committed late, old timestamp
    memory_cache.now += dm_summary.BASE_MAX_AGE_SECONDS + 1
    assert totals(db, workspace, memory_cache)[('openagents:alpha', 'openagents:beta')][1] == 2


def test_redis_down_still_returns_exact_totals(db, workspace, monkeypatch):
    monkeypatch.setattr(cache, 'get_bytes', lambda key: None)
    monkeypatch.setattr(cache, 'set_bytes', lambda *a, **k: None)
    monkeypatch.setattr(cache, '_lazy_client', lambda: None)
    now_ms = int(time.time() * 1000)
    dm(db, workspace, 'openagents:alpha', 'openagents:beta', now_ms)
    dm(db, workspace, 'openagents:alpha', 'openagents:beta', now_ms - 900_000)
    pairs = dm_summary.workspace_pairs(db, workspace['id'], dm_generation(workspace['id']), dm_rewrite_generation(workspace['id']))
    assert pairs[('openagents:alpha', 'openagents:beta')] == [now_ms, 2]


class FakeLock:
    held = set()

    def __init__(self, name):
        self.name = name

    def acquire(self, blocking=True, blocking_timeout=None):
        if self.name in FakeLock.held:
            return False
        FakeLock.held.add(self.name)
        return True

    def release(self):
        FakeLock.held.discard(self.name)


def test_aged_base_is_served_while_another_worker_rebuilds_it(db, workspace, memory_cache, monkeypatch):
    FakeLock.held = set()
    monkeypatch.setattr(cache, '_lazy_client', lambda: SimpleNamespace(lock=lambda name, **kw: FakeLock(name)))
    now_ms = int(memory_cache.now * 1000)
    dm(db, workspace, 'openagents:alpha', 'openagents:beta', now_ms - 600_000)
    assert totals(db, workspace, memory_cache)[('openagents:alpha', 'openagents:beta')][1] == 1

    # The base ages out while another worker holds the rebuild lock.
    memory_cache.now += dm_summary.BASE_MAX_AGE_SECONDS + 1
    dm(db, workspace, 'openagents:beta', 'openagents:alpha', int(memory_cache.now * 1000))
    FakeLock.held.add(dm_summary._key('base', workspace['id']) + ':rebuild')
    memory_cache.queries.clear()
    result = totals(db, workspace, memory_cache)
    assert result[('openagents:alpha', 'openagents:beta')][1] == 2, 'old base + delta stays exact'
    assert not [q for q in memory_cache.queries if '<=' in q.split('GROUP BY')[0].split('timestamp')[-1][:4]], \
        'no full rebuild while another worker is rebuilding'

    # Once the lock is free, the next request rebuilds.
    FakeLock.held.clear()
    memory_cache.now += dm_summary.MERGED_MAX_STALE_SECONDS + 1
    dm(db, workspace, 'openagents:alpha', 'openagents:beta', int(memory_cache.now * 1000))
    assert totals(db, workspace, memory_cache)[('openagents:alpha', 'openagents:beta')][1] == 3
    import json
    base = json.loads(memory_cache.store[dm_summary._key('base', workspace['id'])])
    assert base['built_at'] == memory_cache.now


def test_base_is_cached_long_and_merged_short(db, workspace, memory_cache, monkeypatch):
    ttls = {}
    monkeypatch.setattr(cache, 'set_bytes', lambda key, value, ttl: (memory_cache.store.__setitem__(key, value), ttls.__setitem__(key, ttl)))
    dm(db, workspace, 'openagents:alpha', 'openagents:beta', int(memory_cache.now * 1000) - 600_000)
    totals(db, workspace, memory_cache)
    base_key = dm_summary._key('base', workspace['id'])
    merged_key = dm_summary._key('merged', workspace['id'])
    assert ttls[base_key] == dm_summary.BASE_TTL_SECONDS > dm_summary.BASE_MAX_AGE_SECONDS
    assert ttls[merged_key] == dm_summary.TTL_SECONDS


def test_cold_history_contender_returns_immediately_without_a_duplicate_scan(db, workspace, memory_cache, monkeypatch):
    waits = []
    class RecordingLock(FakeLock):
        def acquire(self, blocking=True, blocking_timeout=None):
            if self.name == dm_summary._key('base', workspace['id']) + ':rebuild':
                waits.append((blocking, blocking_timeout))
            return super().acquire(blocking, blocking_timeout)
    FakeLock.held = {dm_summary._key('base', workspace['id']) + ':rebuild'}
    monkeypatch.setattr(cache, '_lazy_client', lambda: SimpleNamespace(lock=lambda name, **kw: RecordingLock(name)))
    try:
        with pytest.raises(dm_summary.SummaryWarmingError):
            totals(db, workspace, memory_cache)
        assert not memory_cache.queries
        assert waits == [(False, None)], 'no wait while an authenticated request owns a DB connection'
    finally:
        FakeLock.held.clear()


def test_another_workspaces_history_rebuild_does_not_start_another_scan(db, workspace, memory_cache, monkeypatch):
    FakeLock.held = set()
    monkeypatch.setattr(cache, '_lazy_client', lambda: SimpleNamespace(lock=lambda name, **kw: FakeLock(name)))
    now_ms = int(memory_cache.now * 1000)
    dm(db, workspace, 'openagents:alpha', 'openagents:beta', now_ms - 300_000)
    totals(db, workspace, memory_cache)
    memory_cache.now += dm_summary.BASE_MAX_AGE_SECONDS + 1
    dm(db, workspace, 'openagents:beta', 'openagents:alpha', int(memory_cache.now * 1000))
    FakeLock.held.add(dm_summary.GLOBAL_REBUILD_KEY + ':rebuild')
    memory_cache.queries.clear()
    try:
        assert totals(db, workspace, memory_cache)[('openagents:alpha', 'openagents:beta')][1] == 2
        assert len(memory_cache.queries) == 1, 'only delta; no competing full-history read'
        assert FakeLock.held == {dm_summary.GLOBAL_REBUILD_KEY + ':rebuild'}
    finally:
        FakeLock.held.clear()


def test_cold_history_while_another_workspace_rebuilds_is_retryable(client, db, workspace, memory_cache, monkeypatch):
    FakeLock.held = {dm_summary.GLOBAL_REBUILD_KEY + ':rebuild'}
    monkeypatch.setattr(cache, '_lazy_client', lambda: SimpleNamespace(lock=lambda name, **kw: FakeLock(name)))
    try:
        response = client.get('/v1/events/conversations', params={'network': workspace['id']},
                              headers={'X-Workspace-Token': workspace['token']})
        assert response.status_code == 503
        assert response.headers['retry-after'] == '5'
        assert not memory_cache.queries
        assert FakeLock.held == {dm_summary.GLOBAL_REBUILD_KEY + ':rebuild'}
    finally:
        FakeLock.held.clear()
    response = client.get('/v1/events/conversations', params={'network': workspace['id']},
                          headers={'X-Workspace-Token': workspace['token']})
    assert response.status_code == 200


def test_new_messages_stay_fresh_without_ten_minute_history_rescans(db, workspace, memory_cache):
    now_ms = int(memory_cache.now * 1000)
    dm(db, workspace, 'openagents:alpha', 'openagents:beta', now_ms - 300_000)
    totals(db, workspace, memory_cache)
    memory_cache.now += 900
    latest = int(memory_cache.now * 1000)
    dm(db, workspace, 'openagents:beta', 'openagents:alpha', latest)
    memory_cache.queries.clear()
    assert totals(db, workspace, memory_cache)[('openagents:alpha', 'openagents:beta')] == [latest, 2]
    assert len(memory_cache.queries) == 1
