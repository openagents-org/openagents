"""Final-answer retry receipts must not route or notify twice."""
import uuid
import pytest
from unittest.mock import patch
from sqlalchemy import select
from app.models import EventRecord, WorkspaceMember


@pytest.fixture(autouse=True)
def no_external_agent_invocation(monkeypatch):
    # Keep routing assertions in-process; cloud execution opens its own live DB.
    async def ignore(*args, **kwargs):
        pass
    monkeypatch.setattr('app.services.cloud_agent.invoke_cloud_agents', ignore)


def message(workspace, **changes):
    return {
        'type': 'workspace.message.posted', 'source': 'openagents:agent-alpha',
        'target': 'channel/' + workspace['channel']['name'],
        'payload': {'content': 'Complete answer', 'message_type': 'chat'},
        'metadata': {'status_kind': 'completed', 'target_agents': ['__no_response__']},
        'network': workspace['id'], 'idempotency_key': str(uuid.uuid4()), **changes,
    }


def test_retry_returns_original_receipt_without_side_effects(client, workspace, db):
    body = message(workspace)
    headers = {'X-Workspace-Token': workspace['token']}
    with patch('app.services.push.fanout_for_event') as push:
        first = client.post('/v1/events', json=body, headers=headers)
        second = client.post('/v1/events', json=body, headers=headers)
    assert first.status_code == second.status_code == 200
    assert first.json()['data'] == second.json()['data']
    assert push.call_count == 1
    records = db.execute(select(EventRecord).where(EventRecord.id == first.json()['data']['id'])).scalars().all()
    assert len(records) == 1


def test_changed_payload_or_target_cannot_reuse_key(client, workspace):
    body = message(workspace)
    headers = {'X-Workspace-Token': workspace['token']}
    assert client.post('/v1/events', json=body, headers=headers).status_code == 200
    changed = {**body, 'payload': {'content': 'different'}}
    assert client.post('/v1/events', json=changed, headers=headers).status_code == 409
    changed = {**body, 'target': 'channel/another-channel'}
    assert client.post('/v1/events', json=changed, headers=headers).status_code == 409


def test_retry_requires_authentication(client, workspace):
    body = message(workspace)
    assert client.post('/v1/events', json=body, headers={'X-Workspace-Token': workspace['token']}).status_code == 200
    assert client.post('/v1/events', json=body, headers={'X-Workspace-Token': 'invalid'}).status_code == 401


def test_new_session_can_recover_receipt_but_revoked_session_cannot(client, workspace, db):
    member = db.get(WorkspaceMember, (workspace['id'], 'agent-alpha'))
    if member is None:
        member = WorkspaceMember(workspace_id=workspace['id'], agent_name='agent-alpha', agent_type='claude')
        db.add(member)
    member.session_id = 'old-session'; db.commit()
    body = message(workspace)
    body['metadata']['session_id'] = 'old-session'
    headers = {'X-Workspace-Token': workspace['token']}
    first = client.post('/v1/events', json=body, headers=headers)
    assert first.status_code == 200
    db.refresh(member); member.session_id = 'new-session'; db.commit()
    assert client.post('/v1/events', json=body, headers=headers).status_code == 401
    body['metadata']['session_id'] = 'new-session'
    second = client.post('/v1/events', json=body, headers=headers)
    assert second.status_code == 200
    assert second.json()['data']['id'] == first.json()['data']['id']


def test_key_scoped_to_sender_and_unkeyed_messages_remain_distinct(client, workspace):
    body = message(workspace)
    headers = {'X-Workspace-Token': workspace['token']}
    first = client.post('/v1/events', json=body, headers=headers).json()['data']['id']
    body['source'] = 'openagents:agent-beta'
    second = client.post('/v1/events', json=body, headers=headers).json()['data']['id']
    assert first != second
    del body['idempotency_key']
    third = client.post('/v1/events', json=body, headers=headers).json()['data']['id']
    fourth = client.post('/v1/events', json=body, headers=headers).json()['data']['id']
    assert third != fourth


def test_capability_and_invalid_key(client, workspace):
    assert client.get('/v1/events/delivery-capabilities').json()['data']['idempotent_messages'] is True
    body = message(workspace, idempotency_key='not-a-uuid')
    assert client.post('/v1/events', json=body, headers={'X-Workspace-Token': workspace['token']}).status_code == 422
