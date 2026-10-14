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
