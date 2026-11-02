"""Caches on the hottest read paths stay exact and person-scoped."""
import re
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import event

from app import cache
from app.models import Channel, ChannelHumanMember, EventRecord
from app.services.access_model import Principal, thread_shared_agent_names
from tests.test_people_messaging import people, quiet_side_effects, _as  # noqa: F401


@pytest.fixture
def memory_cache(monkeypatch, db):
    state = SimpleNamespace(store={}, queries=[])

    def capture(conn, cursor, statement, *args):
        state.queries.append(statement)

    monkeypatch.setattr(cache, 'get_bytes', lambda key: state.store.get(key))
    monkeypatch.setattr(cache, 'set_bytes', lambda key, value, ttl: state.store.__setitem__(key, value))
    monkeypatch.setattr(cache, 'delete_key', lambda key: state.store.pop(key, None))
    monkeypatch.setattr(cache, '_lazy_client', lambda: None)
    event.listen(db.bind, 'before_cursor_execute', capture)
    yield state
    event.remove(db.bind, 'before_cursor_execute', capture)


def add_event(db, workspace, source, target, timestamp, visibility='direct', content='hello'):
    db.add(EventRecord(id=str(uuid4()), network_id=workspace['id'], source=source, target=target,
                       timestamp=timestamp, type='workspace.message.posted', visibility=visibility,
                       payload={'content': content}))
    db.commit()


def conversations(client, workspace, who):
    response = client.get('/v1/events/conversations', params={'network': workspace['id']},
                          headers=_as(who, workspace))
    assert response.status_code == 200
    return response.json()['data']['conversations']


def aggregates(state):
    return [q for q in state.queries if 'msg_count' in q]


def test_dm_summary_is_reused_until_a_direct_message_changes(client, db, workspace, people, memory_cache):
    me = 'human:adam@acme.test'
    add_event(db, workspace, me, 'openagents:mine', 100)
    assert conversations(client, workspace, 'adam')[0]['message_count'] == 1

    memory_cache.queries.clear()
    add_event(db, workspace, 'openagents:mine', 'channel/general', 150, visibility='channel')
    assert conversations(client, workspace, 'adam')[0]['message_count'] == 1
    assert aggregates(memory_cache) == [], 'channel traffic must not invalidate DM summaries'

    add_event(db, workspace, 'openagents:mine', me, 200, content='newer')
    result = conversations(client, workspace, 'adam')
    assert aggregates(memory_cache), 'a new DM recomputes the summary'
    assert result[0]['message_count'] == 2
    assert result[0]['last_message']['content'] == 'newer'


def test_dm_summary_cache_is_per_person(client, db, workspace, people, memory_cache):
    add_event(db, workspace, 'human:adam@acme.test', 'openagents:mine', 100, content='adam chat')
    add_event(db, workspace, 'human:mia@acme.test', 'openagents:hers', 200, content='mia chat')
    assert [c['last_message']['content'] for c in conversations(client, workspace, 'adam')] == ['adam chat']
    assert [c['last_message']['content'] for c in conversations(client, workspace, 'mia')] == ['mia chat']


def poll(client, workspace, who):
    response = client.get('/v1/events', params={'network': workspace['id']}, headers=_as(who, workspace))
    assert response.status_code == 200
    return [e['payload']['content'] for e in response.json()['data']['events']]


def test_poll_with_hidden_threads_is_cached_per_view(client, db, workspace, people, memory_cache):
    db.add(Channel(workspace_id=workspace['id'], name='mia-private', visibility='private',
                   owner_email='mia@acme.test'))
    db.commit()
    add_event(db, workspace, 'human:mia@acme.test', 'channel/mia-private', 100, 'channel', 'secret')
    add_event(db, workspace, 'human:adam@acme.test', 'channel/general', 200, 'channel', 'public')

    assert poll(client, workspace, 'adam') == ['public']
    memory_cache.queries.clear()
    assert poll(client, workspace, 'adam') == ['public']
    assert not [q for q in memory_cache.queries if re.search(r'\bFROM events\b', q)], 'served from cache'

    # Another view never receives the cached page, and vice versa.
    assert poll(client, workspace, 'mia') == ['secret', 'public']
    assert poll(client, workspace, 'adam') == ['public']

    # Access changes without an event write still take effect immediately.
    channel = db.query(Channel).filter_by(workspace_id=workspace['id'], name='mia-private').one()
    db.add(ChannelHumanMember(channel_id=channel.id, user_email='adam@acme.test'))
    db.commit()
    assert poll(client, workspace, 'adam') == ['secret', 'public']


def test_agent_sharing_lookup_skips_the_join_without_opt_ins(db, workspace, people, memory_cache):
    principal = Principal('human', email='adam@acme.test', workspace_id=workspace['id'])
    assert thread_shared_agent_names(db, workspace['id'], principal) == set()
    joins = [q for q in memory_cache.queries if 'channel_human_members' in q and 'channel_agent_sharing' in q]
    assert joins == []


def test_dm_summary_never_reuses_an_entry_after_the_generation_key_is_lost(
        client, db, workspace, people, memory_cache):
    # A summary cached before the workspace's first DM write...
    db.execute(EventRecord.__table__.insert().values(
        id=str(uuid4()), network_id=workspace['id'], source='human:adam@acme.test', target='openagents:mine',
        timestamp=100, type='workspace.message.posted', visibility='direct', payload={'content': 'first'}))
    db.commit()
    assert conversations(client, workspace, 'adam')[0]['message_count'] == 1
    # ...must not become current again when a later generation is evicted.
    add_event(db, workspace, 'openagents:mine', 'human:adam@acme.test', 200, content='later')
    for key in [k for k in memory_cache.store if k.startswith('v1events:dm-generation:')]:
        del memory_cache.store[key]
    assert conversations(client, workspace, 'adam')[0]['message_count'] == 2
