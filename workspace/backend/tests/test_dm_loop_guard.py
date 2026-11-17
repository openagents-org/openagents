"""Agent-to-agent DM reply loops stop waking the recipient; a person resets them."""
import time
from uuid import uuid4

import pytest

from app.models import EventRecord
from app.services.dm_loop_guard import should_quiet
from tests.test_people_messaging import people, quiet_side_effects  # noqa: F401

A, B = 'openagents:alpha', 'openagents:beta'


def add(db, workspace, source, target, ts, message_type='chat', target_agents=None, visibility='direct'):
    db.add(EventRecord(id=str(uuid4()), network_id=workspace['id'], source=source, target=target, timestamp=ts,
                       type='workspace.message.posted', visibility=visibility,
                       payload={'content': '收到。', 'message_type': message_type},
                       metadata_={'target_agents': target_agents} if target_agents else {}))
    db.commit()


def exchange(db, workspace, n, start=None):
    start = start or int(time.time() * 1000) - 100_000
    for i in range(n):
        src, dst = (A, B) if i % 2 == 0 else (B, A)
        add(db, workspace, src, dst, start + i * 1000)
        add(db, workspace, src, dst, start + i * 1000 + 1, 'status')   # queue notices don't count
    return start


def test_quiets_after_the_limit(db, workspace):
    exchange(db, workspace, 19)
    assert not should_quiet(db, workspace['id'], A, B, limit=20)
    exchange(db, workspace, 1, start=int(time.time() * 1000) - 50_000)
    assert should_quiet(db, workspace['id'], A, B, limit=20)


def test_a_person_messaging_either_agent_resets(db, workspace):
    start = exchange(db, workspace, 30)
    add(db, workspace, 'human:adam@acme.test', B, start + 25_000)            # DM to one of them
    assert not should_quiet(db, workspace['id'], A, B, limit=20)


def test_a_person_routing_an_agent_in_a_thread_resets(db, workspace):
    start = exchange(db, workspace, 30)
    add(db, workspace, 'human:adam@acme.test', 'channel/general', start + 25_000,
        target_agents=['alpha'], visibility='channel')
    assert not should_quiet(db, workspace['id'], A, B, limit=20)


def test_other_pairs_and_people_are_unaffected(db, workspace):
    exchange(db, workspace, 30)
    assert not should_quiet(db, workspace['id'], A, 'openagents:gamma', limit=20)
    assert not should_quiet(db, workspace['id'], 'human:adam@acme.test', A, limit=20)


def test_disabled_with_zero(db, workspace):
    exchange(db, workspace, 30)
    assert not should_quiet(db, workspace['id'], A, B, limit=0)


def test_end_to_end_the_looping_dm_is_stored_but_wakes_nobody(client, db, workspace, people, monkeypatch):
    from app.config import config
    monkeypatch.setattr(config, 'AGENT_DM_LOOP_LIMIT', 4)
    exchange(db, workspace, 4)

    response = client.post('/v1/events', json={
        'type': 'workspace.message.posted', 'source': A, 'target': B, 'network': workspace['id'],
        'payload': {'content': '收到。', 'message_type': 'chat'}, 'visibility': 'direct',
        'metadata': {'target_agents': ['beta']},
    }, headers={'X-Workspace-Token': workspace['token']})
    assert response.status_code == 200, response.text
    stored = db.get(EventRecord, response.json()['data']['id'])
    assert stored is not None, 'the message is still saved and visible'
    assert stored.metadata_['target_agents'] == ['__no_response__']
    assert stored.metadata_['loop_guard'] == 'agent_dm'

    # A person speaks to one of them: the next agent DM wakes the recipient again.
    add(db, workspace, 'human:adam@acme.test', A, int(time.time() * 1000))
    response = client.post('/v1/events', json={
        'type': 'workspace.message.posted', 'source': A, 'target': B, 'network': workspace['id'],
        'payload': {'content': 'on it', 'message_type': 'chat'}, 'visibility': 'direct',
        'metadata': {'target_agents': ['beta']},
    }, headers={'X-Workspace-Token': workspace['token']})
    stored = db.get(EventRecord, response.json()['data']['id'])
    assert stored.metadata_['target_agents'] == ['beta'] and 'loop_guard' not in stored.metadata_
