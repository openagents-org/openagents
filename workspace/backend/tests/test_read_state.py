# -*- coding: utf-8 -*-
"""Read markers are stored per person and shared by all of their devices."""

import json
import uuid
from datetime import datetime, timezone

import pytest
from app.models import EventRecord, NotificationRecord, ReadMarker
from app.services.unread_window import UNREAD_WINDOW_MS

from tests.test_people_messaging import (  # noqa: F401  (fixtures)
    ADAM,
    MIA,
    _as,
    _thread,
    _tok,
    people,
    pushes,
    quiet_side_effects,
)

NOW = UNREAD_WINDOW_MS + 100_000  # server clock (ms); unread cutoff is 100_000


@pytest.fixture(autouse=True)
def frozen_clock(monkeypatch):
    monkeypatch.setattr('app.services.unread_window.time', lambda: NOW / 1000)
    monkeypatch.setattr('app.services.read_state.time', lambda: NOW / 1000)


@pytest.fixture
def published(monkeypatch):
    from app import cache
    out = []
    monkeypatch.setattr(cache, 'publish_event', lambda ch, data: out.append((ch, json.loads(data))))
    return out


def _message(db, workspace, target, source, timestamp, visibility='channel'):
    db.add(EventRecord(id=str(uuid.uuid4()), network_id=workspace['id'], target=target, source=source,
                       type='workspace.message.posted', timestamp=timestamp, visibility=visibility,
                       payload={'content': 'hello', 'message_type': 'chat'}, metadata_={}))
    db.commit()


def _mark(client, workspace, who, markers, headers=None):
    r = client.post('/v1/read-state', json={'network': workspace['id'], 'markers': markers},
                    headers=headers or _as(who, workspace))
    assert r.status_code == 200, r.text
    return r.json()['data']


def _discover_channel(client, workspace, who, name, read_at=None):
    params = {'network': workspace['id']}
    if read_at is not None:
        params['read_at'] = json.dumps(read_at)
    r = client.get('/v1/discover', params=params, headers=_as(who, workspace))
    assert r.status_code == 200, r.text
    return next(c for c in r.json()['data']['channels'] if c['address'] == f'channel/{name}')


def test_read_on_one_device_is_seen_by_the_others(client, workspace, people, db, published):
    name = workspace['channel']['name']
    for ts in (200_000, 300_000, 400_000):
        _message(db, workspace, f'channel/{name}', 'openagents:agent-alpha', ts)
    # The phone still holds an old local marker and sends it.
    assert _discover_channel(client, workspace, 'adam', name, {name: 150_000})['unread_count'] == 3
    # Desktop reads the thread up to the second message.
    data = _mark(client, workspace, 'adam', {name: 300_000})
    assert data == {'markers': {name: 300_000}, 'updated': [name], 'persisted': True}
    # The phone's next poll (same stale local marker) uses the newer stored one.
    phone = _discover_channel(client, workspace, 'adam', name, {name: 150_000})
    assert (phone['read_at'], phone['unread_count']) == (300_000, 1)
    # A client that sends nothing gets the stored marker too.
    fresh = _discover_channel(client, workspace, 'adam', name)
    assert (fresh['read_at'], fresh['unread_count']) == (300_000, 1)
    # A newer local marker still wins for that device (older clients unchanged).
    assert _discover_channel(client, workspace, 'adam', name, {name: 400_000})['unread_count'] == 0
    # Markers are per person: mia's view is untouched.
    assert 'read_at' not in _discover_channel(client, workspace, 'mia', name)


def test_markers_only_move_forward_and_never_into_the_future(client, workspace, people, db, published):
    name = workspace['channel']['name']
    _mark(client, workspace, 'adam', {name: 300_000})
    data = _mark(client, workspace, 'adam', {name: 200_000})
    assert data['markers'] == {name: 300_000} and data['updated'] == []
    data = _mark(client, workspace, 'adam', {name: NOW + 60_000})
    assert data['markers'] == {name: NOW}
    other = 'dm:human:adam@acme.test,openagents:agent-alpha'
    assert _mark(client, workspace, 'adam', {other: None})['markers'] == {other: NOW}
    r = client.get('/v1/read-state', params={'network': workspace['id']}, headers=_as('adam', workspace))
    body = r.json()['data']
    assert body['markers'] == {name: NOW, other: NOW} and body['persisted'] is True
    r = client.get('/v1/read-state', params={'network': workspace['id'], 'since': NOW}, headers=_as('adam', workspace))
    assert r.json()['data']['markers'] == {}
    assert db.query(ReadMarker).filter_by(user_email=MIA).count() == 0


def test_dm_unread_counts_follow_the_stored_marker(client, workspace, people, db, published):
    me, agent = f'human:{ADAM}', 'openagents:agent-alpha'
    session = f'dm:{me},{agent}'
    for ts in (200_000, 300_000):
        _message(db, workspace, me, agent, ts, visibility='direct')
    _mark(client, workspace, 'adam', {session: 200_000})
    r = client.get('/v1/events/conversations', params={'network': workspace['id']}, headers=_as('adam', workspace))
    row = next(c for c in r.json()['data']['conversations'] if c['agents'] == [me, agent])
    assert (row['read_at'], row['unread_count']) == (200_000, 1)
    r = client.get('/v1/events/conversations', params={'network': workspace['id'], 'read_at': json.dumps({session: 100_000})},
                   headers=_as('adam', workspace))
    row = next(c for c in r.json()['data']['conversations'] if c['agents'] == [me, agent])
    assert (row['read_at'], row['unread_count']) == (200_000, 1)


def test_reading_clears_signals_up_to_the_marker_only(client, workspace, people, db, published):
    name = workspace['channel']['name']
    for nid, at in (('older', 150_000), ('newer', 350_000)):
        db.add(NotificationRecord(id=nid, workspace_id=workspace['id'], created_by=f'human:{MIA}', title='t',
                                  message='m', kind='mention', recipient_email=ADAM, channel_name=name,
                                  created_at=datetime.fromtimestamp(at / 1000, timezone.utc)))
    db.commit()
    _mark(client, workspace, 'adam', {name: 300_000})
    db.expire_all()
    assert db.get(NotificationRecord, 'older').is_read is True
    assert db.get(NotificationRecord, 'newer').is_read is False


def test_change_is_published_for_the_readers_other_devices(client, workspace, people, db, published):
    name = workspace['channel']['name']
    _mark(client, workspace, 'adam', {name: 300_000})
    _mark(client, workspace, 'adam', {name: 250_000})  # no change, no event
    assert len(published) == 1
    channel, event = published[0]
    assert channel == f"ws:{workspace['id']}:events"
    assert event['type'] == 'workspace.read_state.updated'
    assert event['target'] == event['source'] == f'human:{ADAM}'
    assert event['payload'] == {'channel': name, 'session_id': name, 'read_at': 300_000, 'user_email': ADAM}


def _stream_types(client, workspace, monkeypatch, events, headers=None, params=''):
    import app.routers.events as events_mod
    from app import cache

    from tests.conftest import TestingSessionLocal

    async def fake_subscribe(_channel):
        for event in events:
            yield json.dumps(event).encode()

    monkeypatch.setattr(events_mod, 'SessionLocal', TestingSessionLocal)
    monkeypatch.setattr(cache, 'subscribe_events', fake_subscribe)
    r = client.get(f"/v1/events/stream?network={workspace['id']}{params}", headers=headers or {})
    assert r.status_code == 200, r.text
    return [json.loads(line[6:])['type'] for line in r.text.splitlines() if line.startswith('data: ')]


def test_stream_delivers_read_state_only_to_its_owner(client, workspace, people, monkeypatch):
    from app.services.read_state import read_state_event
    events = [read_state_event(workspace['id'], ADAM, 'general', 300_000)]
    kind = 'workspace.read_state.updated'
    assert _stream_types(client, workspace, monkeypatch, events, _as('adam', workspace)) == [kind]
    assert _stream_types(client, workspace, monkeypatch, events,
                         params=f"&token={workspace['token']}&access_token=adam") == [kind]
    assert _stream_types(client, workspace, monkeypatch, events, _as('mia', workspace)) == []
    assert _stream_types(client, workspace, monkeypatch, events, _tok(workspace)) == []


def test_hidden_threads_and_token_only_callers_store_nothing(client, workspace, people, db, published):
    _thread(client, workspace, name='secret', by='mia', visibility='private')
    assert _mark(client, workspace, 'adam', {'secret': 300_000}) == {'markers': {}, 'updated': [], 'persisted': True}
    data = _mark(client, workspace, None, {workspace['channel']['name']: 300_000}, headers=_tok(workspace))
    assert data['persisted'] is False
    assert db.query(ReadMarker).count() == 0
    assert not [e for _, e in published if e['type'] == 'workspace.read_state.updated']


@pytest.mark.parametrize('markers', [{}, [], {'t': -1}, {'t': True}, {'t': 'x'}, {'dm:only-one': 1}, {'': 1}])
def test_invalid_updates_rejected(client, workspace, people, markers):
    r = client.post('/v1/read-state', json={'network': workspace['id'], 'markers': markers}, headers=_as('adam', workspace))
    assert r.status_code in (400, 422), r.text
