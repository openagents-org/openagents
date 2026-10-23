"""A task must not reach a gated service until its selected reviewer approves."""
import pytest
from sqlalchemy import select
from app.models import ApprovalRequest, EventRecord, WorkspaceMember
from tests.test_approvals import people as approval_people, _bearer, _chan, _tok
from tests.test_escalation import no_background

@pytest.fixture
def people(approval_people, workspace, db):
    # Management belongs to the agent owner, not the workspace admin role.
    member = db.get(WorkspaceMember, (workspace['id'], 'agent-alpha'))
    member.owner_email = 'adam@acme.test'
    from app.models import ResourceGrant
    db.add(ResourceGrant(workspace_id=workspace['id'], resource_kind='agent', resource_id='agent-alpha',
        grantee_kind='human', grantee_id='olivia@acme.test', rights=['read', 'act'], granted_by='adam@acme.test'))
    db.commit()
    return approval_people

@pytest.fixture
def configured(client, workspace, people, db):
    response = client.patch(f"/v1/workspaces/{workspace['id']}/members/agent-alpha",
        headers=_bearer('adam'), json={'request_approver_email': 'mia@acme.test'})
    assert response.status_code == 200, response.text
    return db.execute(select(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace['id'],
        WorkspaceMember.agent_name == 'agent-alpha')).scalar_one()


def send(client, workspace, *, dm=False, metadata=None):
    return client.post('/v1/events', headers=_bearer('olivia'), json={
        'network': workspace['id'], 'type': 'workspace.message.posted', 'source': 'human:olivia@acme.test',
        'target': 'openagents:agent-alpha' if dm else f'channel/{_chan(workspace)}',
        'visibility': 'direct' if dm else 'channel',
        'payload': {'content': '@agent-alpha Run the report', 'sender_type': 'human'},
        'metadata': metadata or {},
    })


def request(db, workspace):
    return db.execute(select(ApprovalRequest).where(ApprovalRequest.workspace_id == workspace['id'],
        ApprovalRequest.kind == 'service_request')).scalar_one()


@pytest.mark.parametrize('dm', [False, True])
def test_waits_then_releases_exact_request_once(client, workspace, db, configured, dm):
    response = send(client, workspace, dm=dm, metadata={'approved_service_agent': 'agent-alpha'})
    assert response.status_code == 200, response.text
    a = request(db, workspace)
    assert a.status == 'pending'
    original = db.get(EventRecord, a.policy_requirements['trigger_event_id'])
    assert original.metadata_['target_agents'] == ['__no_response__']
    assert a.assignee_email == 'mia@acme.test'
    denied = client.post(f'/v1/approvals/{a.id}/approve', headers=_bearer('olivia'), json={'network': workspace['id']})
    assert denied.status_code == 403
    approved = client.post(f'/v1/approvals/{a.id}/approve', headers=_bearer('mia'), json={'network': workspace['id']})
    assert approved.status_code == 200, approved.text
    db.expire_all()
    replay = db.get(EventRecord, a.resolution_event_id)
    assert replay.metadata_['target_agents'] == ['agent-alpha']
    assert replay.target == original.target and replay.source == original.source
    assert replay.visibility == original.visibility
    assert 'Run the report' in replay.payload['content']
    assert len(db.execute(select(ApprovalRequest).where(ApprovalRequest.kind == 'service_request')).scalars().all()) == 1
    repeat = client.post(f'/v1/approvals/{a.id}/approve', headers=_bearer('mia'), json={'network': workspace['id']})
    assert repeat.status_code == 400


def test_reject_does_not_dispatch_and_new_request_needs_approval(client, workspace, db, configured):
    assert send(client, workspace).status_code == 200
    a = request(db, workspace)
    rejected = client.post(f'/v1/approvals/{a.id}/reject', headers=_bearer('mia'), json={'network': workspace['id']})
    assert rejected.status_code == 200, rejected.text
    db.expire_all()
    result = db.get(EventRecord, a.resolution_event_id)
    assert result.metadata_['target_agents'] == ['__no_response__']
    assert result.payload['message_type'] == 'approval'
    assert send(client, workspace).status_code == 200
    rows = db.execute(select(ApprovalRequest).where(ApprovalRequest.kind == 'service_request')).scalars().all()
    assert sorted(r.status for r in rows) == ['pending', 'rejected']


def test_config_permissions_and_invalid_reviewers(client, workspace, db, people):
    url = f"/v1/workspaces/{workspace['id']}/members/agent-alpha"
    for headers in [_bearer('mia'), _tok(workspace)]:
        assert client.patch(url, headers=headers, json={'request_approver_email': 'mia@acme.test'}).status_code == 403
    for email in ['vic@acme.test', 'absent@acme.test']:
        assert client.patch(url, headers=_bearer('adam'), json={'request_approver_email': email}).status_code == 400
    assert client.patch(url, headers=_bearer('adam'), json={'request_approver_email': 'MIA@acme.test'}).status_code == 200
    profile = client.get(f"/v1/agents/agent-alpha/profile?network={workspace['id']}", headers=_bearer('adam')).json()['data']
    assert profile['request_approver_email'] == 'mia@acme.test'
    assert client.patch(url, headers=_bearer('adam'), json={'request_approver_email': ''}).status_code == 200
    assert send(client, workspace).status_code == 200
    assert not db.execute(select(ApprovalRequest).where(ApprovalRequest.kind == 'service_request')).scalars().all()


def test_cloud_dispatch_waits_for_review(client, workspace, db, configured, monkeypatch):
    from unittest.mock import Mock
    import app.services.cloud_agent as cloud
    invoke = Mock()
    monkeypatch.setattr(cloud, 'invoke_cloud_agents', invoke)
    assert send(client, workspace).status_code == 200
    assert invoke.call_args.args[1]['metadata']['target_agents'] == ['__no_response__']
    a = request(db, workspace)
    result = client.post(f'/v1/approvals/{a.id}/approve', headers=_bearer('mia'), json={'network': workspace['id']})
    assert result.status_code == 200, result.text
    assert invoke.call_args.args[1]['metadata']['target_agents'] == ['agent-alpha']
    assert invoke.call_count == 2
