"""Direct agent sharing requires explicit consent from its current owner."""
import pytest
from sqlalchemy import select
from app.models import ApprovalRequest, ResourceGrant, EventRecord, Channel, ChannelHumanMember
from tests.test_visibility import people, no_push, _bearer  # noqa: F401
from tests.test_agent_request_sharing import private_agent, decide, setting  # noqa: F401


def request(client, ws, user='vic', channel='settings-test'):
    return client.post(f'/v1/channels/{channel}/agents/agent-alpha/sharing-requests',
        headers=_bearer(user, ws), json={'network': ws['id']})


def test_owner_only_deduplicated_one_person_one_agent(client, workspace, private_agent, db):
    first = request(client, workspace)
    assert first.status_code == 200, first.text
    assert request(client, workspace).json()['data']['id'] == first.json()['data']['id']
    approval = db.get(ApprovalRequest, first.json()['data']['id'])
    assert approval.assignee_email == 'mia@acme.test'
    assert decide(client, workspace, approval, user='adam').status_code == 403
    assert decide(client, workspace, approval, user='vic').status_code == 403
    assert decide(client, workspace, approval).status_code == 200
    grant = db.execute(select(ResourceGrant).where(ResourceGrant.resource_kind == 'agent',
        ResourceGrant.grantee_id == 'vic@acme.test', ResourceGrant.revoked_at.is_(None))).scalar_one()
    assert grant.resource_id == 'agent-alpha' and sorted(grant.rights) == ['act', 'read']
    db.refresh(approval)
    assert db.get(EventRecord, approval.resolution_event_id).metadata_['target_agents'] == ['__no_response__']
    assert request(client, workspace).status_code == 400
    data=client.get(f"/v1/channels/settings-test/participants?network={workspace['id']}",headers=_bearer('vic',workspace)).json()['data']
    assert next(a for a in data['agents'] if a['agent_name']=='agent-alpha')['request_access']=='yes'


@pytest.mark.parametrize('change', ['reject', 'owner', 'membership'])
def test_rejection_or_changed_identity_never_grants(client, workspace, private_agent, db, change):
    result=request(client, workspace)
    assert result.status_code==200, result.text
    approval=db.get(ApprovalRequest,result.json()['data']['id'])
    if change=='owner':
        private_agent.owner_email='adam@acme.test'
        db.commit()
    if change=='membership':
        channel=db.execute(select(Channel).where(Channel.name=='settings-test')).scalar_one()
        db.delete(db.get(ChannelHumanMember,(channel.id,'vic@acme.test')))
        db.commit()
    response=decide(client,workspace,approval,action='reject' if change=='reject' else 'approve')
    assert response.status_code==(200 if change=='reject' else 403),response.text
    assert not db.execute(select(ResourceGrant).where(ResourceGrant.grantee_id=='vic@acme.test', ResourceGrant.revoked_at.is_(None))).scalars().all()


def test_existing_access_and_nonmembers_cannot_request(client,workspace,private_agent,db):
    assert request(client,workspace,user='mia').status_code==400
    assert request(client,workspace,channel='missing').status_code==404
    response=client.post('/v1/channels/settings-test/agents/agent-alpha/sharing-requests',headers={'X-Workspace-Token':workspace['token']},json={'network':workspace['id']})
    assert response.status_code==403
    setting(client,workspace,'approval')
    assert request(client,workspace).status_code==400
    data=client.get(f"/v1/channels/settings-test/participants?network={workspace['id']}",headers=_bearer('vic',workspace)).json()['data']
    assert next(a for a in data['agents'] if a['agent_name']=='agent-alpha')['request_access']=='approval'


def test_thread_access_never_grants_direct_or_other_thread_access(client, workspace, private_agent, db, monkeypatch):
    from app.config import config
    monkeypatch.setattr(config, "THREAD_AGENT_ACCESS_ENABLED", True)
    from app.models import ChannelMember
    from app.services.thread_agent_requests import request_access
    from app.services.access_model import Principal, explain, resource_for_agent
    endpoint = '/v1/channels/settings-test/agents/agent-alpha/thread-access-requests'
    first = client.post(endpoint, headers=_bearer('vic', workspace), json={'network': workspace['id']})
    assert first.status_code == 200, first.text
    assert client.post(endpoint, headers=_bearer('vic', workspace), json={'network': workspace['id']}).json()['data']['id'] == first.json()['data']['id']
    approval = db.get(ApprovalRequest, first.json()['data']['id'])
    assert approval.kind == 'thread_agent_access_request'
    assert decide(client, workspace, approval, user='vic').status_code == 403
    assert decide(client, workspace, approval).status_code == 200
    ch = db.execute(select(Channel).where(Channel.name == 'settings-test')).scalar_one()
    assert request_access(db, workspace['id'], ch, private_agent, 'vic@acme.test') == 'yes'
    assert not explain(db, Principal('human', email='vic@acme.test', workspace_id=workspace['id']), resource_for_agent(private_agent), 'act', workspace['id'], include_thread_sharing=False).allowed
    other = Channel(workspace_id=workspace['id'], name='other-review-thread')
    db.add(other); db.flush()
    db.add_all([ChannelHumanMember(channel_id=other.id, user_email=email) for email in ['vic@acme.test', 'mia@acme.test']])
    db.add(ChannelMember(channel_id=other.id, agent_name=private_agent.agent_name)); db.flush()
    assert request_access(db, workspace['id'], other, private_agent, 'vic@acme.test') == 'no'
    endpoint = f'/v1/channels/{ch.name}/agents/agent-alpha/access/vic@acme.test?network={workspace["id"]}'
    assert client.delete(endpoint, headers=_bearer('vic', workspace)).status_code == 403
    assert client.delete(endpoint, headers=_bearer('mia', workspace)).status_code == 200
    assert request_access(db, workspace['id'], ch, private_agent, 'vic@acme.test') == 'no'
    private_agent.owner_email = 'adam@acme.test'; db.flush()
    assert request_access(db, workspace['id'], ch, private_agent, 'vic@acme.test') == 'no'
