import concurrent.futures
import os
import threading
import time
from types import SimpleNamespace

import pytest
from sqlalchemy import select
from sqlalchemy.dialects import postgresql

from app import cache
from app.models import EventRecord
from app.services.poll_queries import event_type_filter, resume_cursor, stream_head, _generation_key

WID = '11111111-1111-4111-8111-111111111111'


@pytest.fixture
def redis_memory(monkeypatch):
    store = {}
    locks = {}
    guard = threading.Lock()

    def get(key):
        entry = store.get(key)
        return entry[0] if entry and entry[1] > time.monotonic() else None

    def put(key, value, ttl_seconds):
        store[key] = (value, time.monotonic() + ttl_seconds)

    class Client:
        def lock(self, key, **kw):
            with guard:
                lock = locks.setdefault(key, threading.Lock())
            return SimpleNamespace(acquire=lambda: lock.acquire(timeout=kw['blocking_timeout']), release=lock.release)

    monkeypatch.setattr(cache, 'get_bytes', get)
    monkeypatch.setattr(cache, 'set_bytes', put)
    monkeypatch.setattr(cache, '_lazy_client', lambda: Client())
    return store


def add(db, id='a', timestamp=10, **kw):
    row = EventRecord(id=id, timestamp=timestamp, network_id=kw.pop('network_id', WID),
                      source='openagents:bot', target=kw.pop('target', 'channel/a'),
                      type=kw.pop('type', 'workspace.message.posted'), payload={}, **kw)
    db.add(row)
    db.commit()
    return row


def test_concurrent_identical_fills_compute_once(redis_memory):
    calls = []
    start = threading.Barrier(6)
    def compute():
        calls.append(True)
        time.sleep(.03)
        return {'events': ['one']}
    def request(_):
        start.wait()
        return cache.json_singleflight('same', 1, compute)
    with concurrent.futures.ThreadPoolExecutor(6) as pool:
        assert list(pool.map(request, range(6))) == [{'events': ['one']}] * 6
    assert len(calls) == 1


def test_errors_not_cached_and_lock_released(redis_memory):
    def fail():
        raise ValueError('failed query')
    with pytest.raises(ValueError):
        cache.json_singleflight('key', 1, fail)
    assert cache.json_singleflight('key', 1, lambda: 42) == 42
    assert cache.json_singleflight('key', 1, fail) == 42


def test_null_cached_and_http_errors_not_cached(redis_memory):
    assert cache.json_singleflight('empty', 1, lambda: None) is None
    assert cache.json_singleflight('empty', 1, lambda: 42) is None
    marker = object()
    assert cache.json_singleflight('error', 1, lambda: marker, lambda v: isinstance(v, dict)) is marker
    assert 'error' not in redis_memory


def test_redis_down_and_lock_timeout_fall_through(monkeypatch):
    monkeypatch.setattr(cache, 'get_bytes', lambda k: None)
    monkeypatch.setattr(cache, 'set_bytes', lambda *a: None)
    monkeypatch.setattr(cache, '_lazy_client', lambda: None)
    assert cache.json_singleflight('x', 1, lambda: 42) == 42
    monkeypatch.setattr(cache, '_lazy_client', lambda: SimpleNamespace(lock=lambda *a, **kw:
        SimpleNamespace(acquire=lambda: False)))
    assert cache.json_singleflight('x', 1, lambda: 43) == 43


def test_cached_head_invalidated_on_insert_edit_delete_but_not_flush(db, redis_memory):
    add(db)
    assert stream_head(db, WID, 'workspace.message.posted')['id'] == 'a'
    db.add(EventRecord(id='b', network_id=WID, source='x', target='channel/a',
                       type='workspace.message.posted', timestamp=20))
    db.flush()
    assert stream_head(db, WID, 'workspace.message.posted')['id'] == 'a'
    db.commit()
    assert stream_head(db, WID, 'workspace.message.posted')['id'] == 'b'
    b = db.get(EventRecord, 'b'); b.type = 'other'; db.commit()
    assert stream_head(db, WID, 'workspace.message.posted')['id'] == 'a'
    db.delete(db.get(EventRecord, 'a')); db.commit()
    assert stream_head(db, WID, 'workspace.message.posted') is None


def test_rollback_and_nested_commit(db, redis_memory):
    add(db)
    generation = cache.get_bytes(_generation_key(WID))
    row = db.get(EventRecord, 'a'); row.timestamp = 20; db.flush(); db.rollback()
    assert cache.get_bytes(_generation_key(WID)) == generation
    with db.begin_nested():
        row = db.get(EventRecord, 'a'); row.timestamp = 30; db.flush()
    assert cache.get_bytes(_generation_key(WID)) == generation
    db.commit()
    assert cache.get_bytes(_generation_key(WID)) != generation


def test_old_fill_cannot_poison_generation_after_commit(redis_memory):
    calls = []
    def execute(query):
        calls.append(True)
        if len(calls) == 1:
            cache.set_bytes(_generation_key(WID), b'new-generation', 60)
        row = SimpleNamespace(id='old' if len(calls) == 1 else 'new', timestamp=len(calls))
        return SimpleNamespace(first=lambda: row)
    db = SimpleNamespace(execute=execute)
    assert stream_head(db, WID, 'workspace.message.posted')['id'] == 'old'
    assert stream_head(db, WID, 'workspace.message.posted')['id'] == 'new'
    assert len(calls) == 2


def test_head_scope_and_legacy_subtypes(db, redis_memory):
    add(db, 'a', 10)
    add(db, 'b', 20, target='channel/b', type='workspace.message.posted.extra')
    add(db, 'c', 30, type='workspace.agent.control')
    assert stream_head(db, WID, 'workspace.message.posted')['id'] == 'b'
    assert stream_head(db, WID, 'workspace.message.posted', channel='a')['id'] == 'a'
    assert stream_head(db, WID, 'workspace.agent.control')['id'] == 'c'
    assert stream_head(db, WID, 'workspace.tool_result') is None
    assert stream_head(db, '22222222-2222-4222-8222-222222222222', None) is None


@pytest.mark.parametrize('head,newest,incoming,expected', [
    ({'id':'old','timestamp':1}, {'id':'new','timestamp':2}, None, 'new'),
    ({'id':'old','timestamp':1}, None, {'id':'incoming','timestamp':2}, 'incoming'),
    ({'id':'head','timestamp':3}, {'id':'new','timestamp':2}, None, 'head'),
    ({'id':'head','timestamp':2}, {'id':'new','timestamp':2}, None, 'new'),
    (None, None, {'id':'incoming','timestamp':2}, 'incoming'),
    (None, None, None, None),
])
def test_cursor_never_regresses(head, newest, incoming, expected):
    assert resume_cursor(head, newest, incoming) == expected


@pytest.mark.parametrize('prefix', ['workspace.message.posted', 'workspace.agent.control',
                                  'workspace.tool_result', 'custom.prefix', "x' OR TRUE --"])
def test_prefix_filter_preserves_semantics_and_parameter_safety(db, prefix):
    for i, typ in enumerate(['workspace.message.posted', 'workspace.message.posted.extra',
                             'workspace.agent.control', 'workspace.tool_result', 'workspace.toolXresult', 'custom.prefix.extra']):
        add(db, str(i), i, type=typ)
    old = select(EventRecord.id).where(EventRecord.type.startswith(prefix)).order_by(EventRecord.id)
    new = select(EventRecord.id).where(event_type_filter(prefix)).order_by(EventRecord.id)
    assert db.execute(old).all() == db.execute(new).all()
    compiled = new.compile(dialect=postgresql.dialect())
    if prefix.startswith("x'"):
        assert prefix not in str(compiled)


def test_arrival_after_head_snapshot_does_not_regress_cursor(client, workspace, db, monkeypatch):
    add(db, 'old', 10, network_id=workspace['id'])
    def old_head(*args):
        # Simulate an event committed after the captured stream head but before
        # the message SELECT. It must be returned and become the resume cursor.
        add(db, 'arrived', 20, network_id=workspace['id'], metadata_={'target_agents':['alpha']})
        return {'id':'old', 'timestamp':10}
    monkeypatch.setattr('app.routers.events.stream_head', old_head)
    response = client.get('/v1/events', params={'network':workspace['id'], 'after':'old',
        'target_agents':'alpha', 'type':'workspace.message.posted'},
        headers={'X-Workspace-Token':workspace['token']})
    data = response.json()['data']
    assert [e['id'] for e in data['events']] == ['arrived']
    assert data['next_cursor'] == 'arrived'


@pytest.mark.skipif(os.getenv('OPENAGENTS_TEST_ISOLATED_REDIS') != '1', reason='requires disposable Redis')
def test_real_redis_lock_and_expiration():
    import uuid
    key = 'test:poll-singleflight:' + uuid.uuid4().hex
    calls = []
    barrier = threading.Barrier(8)
    def compute():
        calls.append(True)
        time.sleep(.03)
        return {'events': ['one']}
    def request(_):
        barrier.wait()
        return cache.json_singleflight(key, .15, compute)
    try:
        with concurrent.futures.ThreadPoolExecutor(8) as pool:
            assert list(pool.map(request, range(8))) == [{'events':['one']}] * 8
        assert len(calls) == 1
        time.sleep(.2)
        assert cache.json_singleflight(key, .15, compute) == {'events':['one']}
        assert len(calls) == 2
    finally:
        cache.delete_key(key)
