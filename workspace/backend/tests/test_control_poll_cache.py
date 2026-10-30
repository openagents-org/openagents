"""Behavior across the connector's two-second idle control-poll interval."""
from types import SimpleNamespace

import pytest
from sqlalchemy import event

from app import cache
from app.models import EventRecord, Node

CONTROL = 'workspace.agent.control'
TARGET = 'openagents:agent-alpha'


@pytest.fixture
def clock_cache(monkeypatch, db):
    clock = SimpleNamespace(now=0.0, store={}, event_queries=[])

    def get(key):
        entry = clock.store.get(key)
        return entry[0] if entry and entry[1] > clock.now else None

    def put(key, value, ttl_seconds):
        clock.store[key] = (value, clock.now + ttl_seconds)

    def capture(conn, cursor, statement, *args):
        if 'FROM events' in statement:
            clock.event_queries.append(statement)

    monkeypatch.setattr(cache, 'get_bytes', get)
    monkeypatch.setattr(cache, 'set_bytes', put)
    monkeypatch.setattr(cache, 'delete_key', lambda key: clock.store.pop(key, None))
    monkeypatch.setattr(cache, '_lazy_client', lambda: None)
    event.listen(db.bind, 'before_cursor_execute', capture)
    yield clock
    event.remove(db.bind, 'before_cursor_execute', capture)


def add_control(db, workspace, id='control-1', timestamp=1):
    db.add(EventRecord(id=id, network_id=workspace['id'], type=CONTROL,
                       source=TARGET, target=TARGET, timestamp=timestamp,
                       payload={'action': 'stop'}))
    db.commit()


def poll(client, workspace, **params):
    response = client.get('/v1/events', params={
        'network': workspace['id'], 'type': CONTROL, 'target': TARGET, **params,
    }, headers={'X-Workspace-Token': workspace['token']})
    assert response.status_code == 200
    return response.json()['data']


@pytest.mark.parametrize('with_cursor', [False, True])
def test_empty_control_poll_reused_across_idle_intervals_and_expires(
        client, workspace, db, clock_cache, with_cursor):
    params = {}
    if with_cursor:
        add_control(db, workspace)
        params['after'] = 'control-1'
    assert poll(client, workspace, **params)['events'] == []
    for at in (2.1, 4.2, 6.3, 8.4):
        clock_cache.now = at
        clock_cache.event_queries.clear()
        assert poll(client, workspace, **params)['events'] == []
        assert clock_cache.event_queries == []
    clock_cache.now = 10.1
    assert poll(client, workspace, **params)['events'] == []
    assert clock_cache.event_queries  # TTL remains bounded; no sliding extension.


@pytest.mark.parametrize('with_cursor', [False, True])
def test_posted_command_invalidates_extended_empty_cache(
        client, workspace, db, clock_cache, with_cursor):
    params = {}
    if with_cursor:
        add_control(db, workspace)
        params['after'] = 'control-1'
    assert poll(client, workspace, **params)['events'] == []
    clock_cache.now = 2.1
    posted = client.post('/v1/events', json={
        'network': workspace['id'], 'type': CONTROL, 'source': TARGET,
        'target': TARGET, 'payload': {'action': 'stop'},
    }, headers={'X-Workspace-Token': workspace['token']})
    assert posted.status_code == 200
    assert [e['id'] for e in poll(client, workspace, **params)['events']] == [posted.json()['data']['id']]


@pytest.mark.parametrize('kind', ['nonempty_control', 'empty_message', 'empty_broad_prefix'])
def test_other_poll_results_keep_short_ttl(client, workspace, db, clock_cache, kind):
    params = {}
    if kind == 'nonempty_control':
        add_control(db, workspace)
    elif kind == 'empty_message':
        params['type'] = 'workspace.message.posted'
    else:
        params['type'] = 'workspace.agent'
    first = poll(client, workspace, **params)
    clock_cache.now = 2.1
    clock_cache.event_queries.clear()
    assert poll(client, workspace, **params) == first
    assert clock_cache.event_queries


def test_at_head_cache_also_survives_idle_interval(client, workspace, db, clock_cache):
    add_control(db, workspace)
    assert poll(client, workspace, after='control-1')['events'] == []
    # Simulate an exact-page eviction: the at-head cache must still avoid SQL.
    for key in list(clock_cache.store):
        if key.startswith('v1events:full:'):
            clock_cache.store.pop(key)
    clock_cache.now = 2.1
    clock_cache.event_queries.clear()
    assert poll(client, workspace, after='control-1')['events'] == []
    assert clock_cache.event_queries == []


def test_device_revocation_checked_before_extended_cache(client, workspace, db, clock_cache):
    node = Node(workspace_id=workspace['id'], node_key='cache-test', token='device-secret')
    db.add(node)
    db.commit()
    params = {'network': workspace['id'], 'type': CONTROL, 'target': TARGET}
    headers = {'X-Workspace-Token': 'device-secret'}
    assert client.get('/v1/events', params=params, headers=headers).status_code == 200
    clock_cache.now = 2.1
    node.token = 'rotated-secret'
    db.commit()
    assert client.get('/v1/events', params=params, headers=headers).status_code == 401


@pytest.mark.parametrize('at_head', [False, True])
def test_composing_changes_without_event_commit_remain_visible(
        client, workspace, db, clock_cache, at_head):
    from app.composing import set_composing
    params = {}
    if at_head:
        add_control(db, workspace)
        params['after'] = 'control-1'
    assert 'composing' not in poll(client, workspace, **params)
    if at_head:
        for key in list(clock_cache.store):
            if key.startswith('v1events:full:'):
                clock_cache.store.pop(key)
    clock_cache.now = 2.1
    set_composing(workspace['id'], 'general')
    clock_cache.event_queries.clear()
    assert poll(client, workspace, **params)['composing'] is True
    cache.delete_key('composing:' + workspace['id'])
    clock_cache.now = 4.2
    assert 'composing' not in poll(client, workspace, **params)
    assert clock_cache.event_queries == []


def test_empty_bounded_page_does_not_poison_forward_head(client, workspace, db, clock_cache):
    add_control(db, workspace, 'control-1', 1)
    add_control(db, workspace, 'control-2', 2)
    assert poll(client, workspace, after='control-1', before='control-2')['events'] == []
    clock_cache.now = 2.1
    assert [e['id'] for e in poll(client, workspace, after='control-1')['events']] == ['control-2']
