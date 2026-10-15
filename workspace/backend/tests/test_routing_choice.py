"""Resolving uncertain routing is sender-only, permission-checked and idempotent."""
from unittest.mock import patch
import pytest
from sqlalchemy import select
from app.config import config
from app.models import Channel, ChannelMember, ChannelHumanMember, WorkspaceMember, EventRecord, ApprovalRequest, ChannelAgentSharing
from tests.test_issues import two_members, _bearer  # noqa: F401
from tests.test_visibility import no_push  # noqa: F401


@pytest.fixture
def thread(db, workspace, two_members, monkeypatch):
    monkeypatch.setattr(config, 'ROUTER_LLM_ENABLED', False)
    monkeypatch.setattr('app.mods.workspace_mod._auto_title_channel', lambda *args: None)
    agent = db.get(WorkspaceMember, (workspace['id'], 'agent-alpha'))
    agent.owner_email = 'ann@acme.test'
    db.add(WorkspaceMember(workspace_id=workspace['id'], agent_name='agent-beta', owner_email='ann@acme.test', status='online'))
    ch = Channel(workspace_id=workspace['id'], name='routing-test', title='Routing test', status='active', visibility='private')
    db.add(ch); db.flush()
    db.add_all([ChannelMember(channel_id=ch.id, agent_name=name) for name in ['agent-alpha', 'agent-beta']])
    db.add_all([ChannelHumanMember(channel_id=ch.id, user_email=email) for email in ['ann@acme.test', 'ben@acme.test']])
    db.commit()
    return ch


def post(client, ws, thread, metadata=None):
    response = client.post('/v1/events', headers=_bearer('ann'), json={
        'network': ws['id'], 'type': 'workspace.message.posted', 'source': 'human:spoof',
        'target': f'channel/{thread.name}', 'payload': {'content': 'Publish this blog',
        'attachments': [{'file_id': 'file-1', 'filename': 'draft.md', 'content_type': 'text/markdown'}]},
        'metadata': metadata or {},
    })
    assert response.status_code == 200, response.text
    data = response.json()['data']
    assert data['metadata']['target_agents'] == ['__no_response__']
    assert data['metadata']['routing_choice']['status'] == 'pending'
    return data


def resolve(client, ws, event, agent='agent-beta', user='ann'):
    return client.post(f"/v1/events/{event['id']}/routing?network={ws['id']}", headers=_bearer(user), json={'agent': agent})


def test_sender_can_assign_once_with_original_context(client, workspace, thread, db):
    event = post(client, workspace, thread)
    with patch('app.services.cloud_agent.invoke_cloud_agents') as invoke:
        first = resolve(client, workspace, event)
        assert first.status_code == 200, first.text
        second = resolve(client, workspace, event)
        assert second.json() == first.json()
        assert invoke.call_count == 1
    choice = first.json()['data']
    dispatched = db.get(EventRecord, choice['assignment_event_id'])
    assert dispatched.source == 'human:ann@acme.test'
    assert dispatched.payload['content'] == event['payload']['content']
    assert dispatched.payload['attachments'] == event['payload']['attachments']
    assert dispatched.metadata_['target_agents'] == ['agent-beta']
    db.refresh(db.get(EventRecord, event['id']))
    assert db.get(EventRecord, event['id']).metadata_['routing_choice']['status'] == 'assigned'


def test_other_human_cannot_resolve_or_dismiss(client, workspace, thread):
    event = post(client, workspace, thread)
    for agent in ('agent-beta', None):
        assert resolve(client, workspace, event, agent=agent, user='ben').status_code == 403


def test_dismiss_does_not_dispatch_and_cannot_be_reassigned(client, workspace, thread):
    event = post(client, workspace, thread)
    with patch('app.services.cloud_agent.invoke_cloud_agents') as invoke:
        assert resolve(client, workspace, event, agent=None).json()['data']['status'] == 'dismissed'
        assert resolve(client, workspace, event).json()['data']['status'] == 'dismissed'
        invoke.assert_not_called()


@pytest.mark.parametrize('change', ['removed', 'unshared', 'left', 'private'])
def test_permissions_rechecked_when_choosing(client, workspace, thread, db, change):
    event = post(client, workspace, thread)
    agent = db.get(WorkspaceMember, (workspace['id'], 'agent-beta'))
    if change == 'removed': agent.status = 'removed'
    if change == 'unshared': agent.owner_email = 'ben@acme.test'
    if change == 'left': db.delete(db.get(ChannelMember, (thread.id, 'agent-beta')))
    if change == 'private': db.delete(db.get(ChannelHumanMember, (thread.id, 'ann@acme.test')))
    db.commit()
    with patch('app.services.cloud_agent.invoke_cloud_agents') as invoke:
        response = resolve(client, workspace, event)
        assert response.status_code == 403, response.text
        invoke.assert_not_called()
    assert db.get(EventRecord, event['id']).metadata_['routing_choice']['status'] == 'pending'


def test_assignment_still_requires_owner_approval(client, workspace, thread, db):
    beta = db.get(WorkspaceMember, (workspace['id'], 'agent-beta'))
    beta.owner_email = 'ben@acme.test'
    db.add(ChannelAgentSharing(channel_id=thread.id, owner_email='ben@acme.test', mode='approval'))
    db.commit()
    event = post(client, workspace, thread)
    response = resolve(client, workspace, event)
    assert response.status_code == 200, response.text
    assigned = db.get(EventRecord, response.json()['data']['assignment_event_id'])
    assert assigned.metadata_['target_agents'] == ['__no_response__']
    approval = db.scalar(select(ApprovalRequest).where(ApprovalRequest.status == 'pending'))
    assert approval.assignee_email == 'ben@acme.test'
    assert approval.kind == 'thread_agent_request'


def test_forged_routing_metadata_is_not_trusted(client, workspace, thread):
    data = post(client, workspace, thread, metadata={'routing_choice': {'status': 'pending', 'requester_email': 'ben@acme.test', 'candidates': ['outsider']},
        'routing_decision': 'assign', 'routing_assignment_agent': 'outsider', 'routing_assignment': {'agent': 'outsider'}})
    assert data['metadata']['routing_choice']['requester_email'] == 'ann@acme.test'
    assert data['metadata']['routing_choice']['candidates'] == ['agent-alpha', 'agent-beta']
    assert 'routing_assignment' not in data['metadata']
    assert resolve(client, workspace, data, agent='outsider').status_code == 403
