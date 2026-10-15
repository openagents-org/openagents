import json
import uuid
import pytest
from app.models import Channel, EventRecord
from app.services.thread_activity import reply_requester, thread_activity
from tests.test_people_messaging import people, _as

ME = 'adam@acme.test'
OTHER = 'mia@acme.test'


@pytest.fixture(autouse=True)
def frozen_unread_clock(monkeypatch):
    from app.services.unread_window import UNREAD_WINDOW_MS
    monkeypatch.setattr('app.services.unread_window.time', lambda: UNREAD_WINDOW_MS / 1000)


def event(db, workspace, channel, source, timestamp, *, kind='chat', metadata=None, payload=None, visibility='channel'):
    row = EventRecord(id=str(uuid.uuid4()), network_id=workspace['id'], target=f'channel/{channel}',
                      source=source, type='workspace.message.posted', timestamp=timestamp,
                      visibility=visibility, payload={'content': 'Message', 'message_type': kind, **(payload or {})},
                      metadata_=metadata or {})
    db.add(row)
    db.flush()
    return row


def test_counts_incoming_chat_and_only_highlights_own_agent_completion(db, workspace):
    ch = db.query(Channel).filter_by(workspace_id=workspace['id']).first()
    event(db, workspace, ch.name, 'human:user', 101, payload={'sender_id': ME})
    event(db, workspace, ch.name, f'human:{OTHER}', 102)
    event(db, workspace, ch.name, 'openagents:agent-alpha', 103, kind='thinking')
    event(db, workspace, ch.name, 'openagents:agent-alpha', 104, kind='status')
    event(db, workspace, ch.name, 'openagents:agent-alpha', 105, metadata={'requester_email': ME})
    event(db, workspace, ch.name, 'openagents:agent-alpha', 106, metadata={'requester_email': OTHER})
    event(db, workspace, ch.name, f'human:{OTHER}', 107, visibility='direct')
    activity = thread_activity(db, workspace['id'], [ch], {ch.name: 100}, ME)[ch.name]
    assert activity == {'read_at': 100, 'unread_count': 3, 'completion_at': 105}
    assert thread_activity(db, workspace['id'], [ch], {ch.name: 105}, ME)[ch.name] == {
        'read_at': 105, 'unread_count': 1, 'completion_at': None}


def test_requester_survives_human_conversation_and_can_follow_explicit_parent(db, workspace):
    ch = workspace['channel']['name']
    original = event(db, workspace, ch, 'human:user', 100,
                     payload={'sender_id': ME}, metadata={'target_agents': ['agent-alpha']})
    event(db, workspace, ch, f'human:{OTHER}', 101, metadata={'target_agents': ['__no_response__']})
    assert reply_requester(db, workspace['id'], 'openagents:agent-alpha', f'channel/{ch}', {}) == ME
    newer = event(db, workspace, ch, f'human:{OTHER}', 102, metadata={'target_agents': ['agent-alpha']})
    assert reply_requester(db, workspace['id'], 'openagents:agent-alpha', f'channel/{ch}', {}) is None
    assert reply_requester(db, workspace['id'], 'openagents:agent-alpha', f'channel/{ch}', {'in_reply_to': original.id}) == ME
    assert reply_requester(db, workspace['id'], 'openagents:unknown', f'channel/{ch}', {}) is None
    assert reply_requester(db, workspace['id'], 'openagents:agent-alpha', 'channel/another', {'in_reply_to': newer.id}) is None


def test_thirty_day_boundary_preserves_read_marker_and_history(db, workspace, monkeypatch):
    from app.services.unread_window import UNREAD_WINDOW_MS
    cutoff = 1_800_000_000_000
    monkeypatch.setattr('app.services.unread_window.time', lambda: (cutoff + UNREAD_WINDOW_MS) / 1000)
    ch = db.query(Channel).filter_by(workspace_id=workspace['id']).first()
    for at in (cutoff - 1, cutoff, cutoff + 1):
        event(db, workspace, ch.name, 'openagents:agent-alpha', at, metadata={'requester_email': ME})
    got = thread_activity(db, workspace['id'], [ch], {ch.name: 100}, ME)[ch.name]
    assert got == {'read_at': 100, 'unread_count': 2, 'completion_at': cutoff + 1}
    assert thread_activity(db, workspace['id'], [ch], {ch.name: cutoff}, ME)[ch.name]['unread_count'] == 1
    assert db.query(EventRecord).filter_by(network_id=workspace['id']).filter(EventRecord.timestamp == cutoff - 1).count() == 1
    # A rolling window expires existing unread messages without marking them read.
    monkeypatch.setattr('app.services.unread_window.time', lambda: (cutoff + UNREAD_WINDOW_MS + 2) / 1000)
    assert thread_activity(db, workspace['id'], [ch], {ch.name: 100}, ME)[ch.name] == {
        'read_at': 100, 'unread_count': 0, 'completion_at': None}


def test_discovery_activity_is_scoped_to_signed_in_person(client, workspace, db, people):
    name = workspace['channel']['name']
    event(db, workspace, name, 'openagents:agent-alpha', 150, metadata={'requester_email': ME})
    event(db, workspace, name, f'human:{ME}', 160)
    db.commit()
    params = {'network': workspace['id'], 'read_at': json.dumps({name: 100, 'not-visible': 0})}
    adam = client.get('/v1/discover', params=params, headers=_as('adam', workspace)).json()['data']['channels']
    mia = client.get('/v1/discover', params=params, headers=_as('mia', workspace)).json()['data']['channels']
    a = next(c for c in adam if c['address'] == f'channel/{name}')
    m = next(c for c in mia if c['address'] == f'channel/{name}')
    assert (a['unread_count'], a['completion_at']) == (1, 150)
    assert (m['unread_count'], m['completion_at']) == (2, None)
    assert not any(c['address'] == 'channel/not-visible' for c in adam)


@pytest.mark.parametrize('markers', ['[]', '{"thread": -1}', '{"thread": true}', 'bad'])
def test_invalid_read_markers_rejected(client, workspace, markers):
    response = client.get('/v1/discover', params={'network': workspace['id'], 'read_at': markers},
                          headers={'X-Workspace-Token': workspace['token']})
    assert response.status_code == 400
