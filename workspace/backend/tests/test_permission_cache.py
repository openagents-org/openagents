"""Cached visibility/role results always reflect committed permission changes."""
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import text, update

from app import cache
from app.models import Channel, ChannelHumanMember, EventRecord, User, WorkspaceMember, WorkspaceMembership
import app.services.access_model as access_model
from app.services.access_model import Principal, hidden_channel_names
from tests.test_people_messaging import people, quiet_side_effects, _as  # noqa: F401


@pytest.fixture
def memory_cache(monkeypatch):
    store = {}
    monkeypatch.setattr(cache, 'get_bytes', lambda key: store.get(key))
    monkeypatch.setattr(cache, 'set_bytes', lambda key, value, ttl: store.__setitem__(key, value))
    monkeypatch.setattr(cache, 'delete_key', lambda key: store.pop(key, None))
    monkeypatch.setattr(cache, '_lazy_client', lambda: None)
    return store


@pytest.fixture
def computed(monkeypatch):
    """Counts real (uncached) hidden-thread computations."""
    calls = SimpleNamespace(n=0)
    real = access_model._hidden_channel_names

    def counting(*args, **kwargs):
        calls.n += 1
        return real(*args, **kwargs)
    monkeypatch.setattr(access_model, '_hidden_channel_names', counting)
    return calls


@pytest.fixture
def private(db, workspace):
    db.add(Channel(workspace_id=workspace['id'], name='mia-private', visibility='private', owner_email='mia@acme.test'))
    db.commit()
    db.add(EventRecord(id=str(uuid4()), network_id=workspace['id'], source='human:mia@acme.test',
                       target='channel/mia-private', timestamp=100, type='workspace.message.posted',
                       visibility='channel', payload={'content': 'secret'}))
    db.add(EventRecord(id=str(uuid4()), network_id=workspace['id'], source='human:adam@acme.test',
                       target='channel/general', timestamp=200, type='workspace.message.posted',
                       visibility='channel', payload={'content': 'public'}))
    db.commit()
    return db.query(Channel).filter_by(workspace_id=workspace['id'], name='mia-private').one()


def poll(client, workspace, who):
    response = client.get('/v1/events', params={'network': workspace['id']}, headers=_as(who, workspace))
    assert response.status_code == 200
    return [e['payload']['content'] for e in response.json()['data']['events']]


def adam(workspace):
    return Principal('human', email='adam@acme.test', role='admin', workspace_id=workspace['id'])


def test_hidden_threads_are_computed_once_until_permissions_change(
        client, db, workspace, people, memory_cache, computed, private):
    assert poll(client, workspace, 'adam') == ['public']
    first = computed.n
    for _ in range(3):
        assert poll(client, workspace, 'adam') == ['public']
    assert computed.n == first, 'served from the permission cache'


def test_grant_and_revoke_take_effect_immediately(client, db, workspace, people, memory_cache, private):
    assert poll(client, workspace, 'adam') == ['public']
    member = ChannelHumanMember(channel_id=private.id, user_email='adam@acme.test')
    db.add(member)
    db.commit()
    assert poll(client, workspace, 'adam') == ['secret', 'public']
    db.delete(member)
    db.commit()
    assert poll(client, workspace, 'adam') == ['public']


def test_privacy_toggle_takes_effect_immediately(client, db, workspace, people, memory_cache, private):
    assert poll(client, workspace, 'adam') == ['public']
    private.visibility = 'public'
    db.commit()
    assert poll(client, workspace, 'adam') == ['secret', 'public']
    private.visibility = 'private'
    db.commit()
    assert poll(client, workspace, 'adam') == ['public']


def test_bulk_visibility_update_and_raw_sql_writes_invalidate(db, workspace, people, memory_cache, private):
    assert hidden_channel_names(db, workspace['id'], adam(workspace)) == {'mia-private'}
    db.execute(update(Channel).where(Channel.id == private.id).values(visibility='public'))
    db.commit()
    assert hidden_channel_names(db, workspace['id'], adam(workspace)) == set()
    db.execute(text("UPDATE channels SET visibility = 'private' WHERE name = 'mia-private'"))
    db.commit()
    assert hidden_channel_names(db, workspace['id'], adam(workspace)) == {'mia-private'}


def test_presence_and_activity_writes_keep_the_cache(db, workspace, people, memory_cache, computed, private):
    hidden_channel_names(db, workspace['id'], adam(workspace))
    first = computed.n
    member = db.query(WorkspaceMember).filter_by(workspace_id=workspace['id']).first()
    member.status = 'offline'
    db.commit()
    member.status = 'online'
    db.commit()
    db.execute(update(Channel).where(Channel.id == private.id).values(last_event_at=999))
    db.commit()
    hidden_channel_names(db, workspace['id'], adam(workspace))
    assert computed.n == first


def test_uncommitted_writes_bypass_the_cache(db, workspace, people, memory_cache, private):
    assert hidden_channel_names(db, workspace['id'], adam(workspace)) == {'mia-private'}
    db.add(ChannelHumanMember(channel_id=private.id, user_email='adam@acme.test'))
    db.flush()
    assert hidden_channel_names(db, workspace['id'], adam(workspace)) == set()
    db.rollback()
    assert hidden_channel_names(db, workspace['id'], adam(workspace)) == {'mia-private'}


def test_lost_generation_never_serves_an_old_answer(db, workspace, people, memory_cache, private):
    assert hidden_channel_names(db, workspace['id'], adam(workspace)) == {'mia-private'}
    db.add(ChannelHumanMember(channel_id=private.id, user_email='adam@acme.test'))
    db.commit()
    for key in [k for k in memory_cache if k.startswith('perm-generation:')]:
        del memory_cache[key]
    assert hidden_channel_names(db, workspace['id'], adam(workspace)) == set()


def test_role_changes_take_effect_immediately(client, db, workspace, people, memory_cache):
    from app.access import resolve_user_role
    from app.models import Workspace
    ws = db.get(Workspace, workspace['id'])
    assert resolve_user_role(db, ws, 'Bearer mia') == 'member'
    user = db.query(User).filter_by(email='mia@acme.test').one()
    membership = db.query(WorkspaceMembership).filter_by(workspace_id=workspace['id'], user_id=user.id).one()
    membership.role = 'admin'
    db.commit()
    assert resolve_user_role(db, ws, 'Bearer mia') == 'admin'
    db.delete(membership)
    db.commit()
    assert resolve_user_role(db, ws, 'Bearer mia') is None
