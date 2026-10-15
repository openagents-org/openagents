"""Service audiences never grant general access to their backing agent."""
import pytest
from sqlalchemy import select, delete
from app.models import AgentService, WorkspaceMember, ResourceGrant, EventRecord, Channel, ApprovalRequest
from tests.test_visibility import people, no_push, _bearer

@pytest.fixture
def owner(workspace, db, people):
    agent = db.get(WorkspaceMember, (workspace['id'], 'agent-alpha'))
    agent.owner_email = 'mia@acme.test'
    db.execute(delete(ResourceGrant).where(ResourceGrant.resource_kind == 'agent'))
    db.commit()


def path(ws, suffix=''):
    return f"/v1/services{suffix}?network={ws['id']}"


def make(client, ws, name='Review', **kwargs):
    response = client.post(path(ws), headers=_bearer('mia'), json=dict(agent_name='agent-alpha', name=name, instructions=f'Only {name}', **kwargs))
    assert response.status_code == 200, response.text
    return response.json()['data']


def share(client, ws, sid, who='adam'):
    response = client.post('/v1/grants', headers=_bearer('mia'), json=dict(network=ws['id'],resource_kind='service',resource_id=sid,grantee_kind='human',grantee_id=f'{who}@acme.test',rights=['act']))
    assert response.status_code == 200, response.text
    return response.json()['data']['id']


def test_separate_audiences_and_private_agent(client, workspace, db, owner):
    review = make(client,workspace)
    deploy = make(client,workspace,'Deploy')
    share(client,workspace,review['id'])
    assert [s['id'] for s in client.get(path(workspace),headers=_bearer('adam')).json()['data']] == [review['id']]
    assert 'instructions' not in client.get(path(workspace),headers=_bearer('adam')).json()['data'][0]
    assert len(client.get(path(workspace),headers=_bearer('mia')).json()['data']) == 2
    discovery=client.get(f"/v1/discover?network={workspace['id']}",headers=_bearer('adam')).json()['data']
    assert not any(a['address']=='openagents:agent-alpha' for a in discovery['agents'])
    forged = client.post('/v1/events', headers=_bearer('adam'), json=dict(network=workspace['id'],type='network.channel.create',source='human:user',target='core',payload={'name':'stolen','participants':['agent-alpha']}))
    assert forged.status_code == 403
    denied=client.post(path(workspace,f"/{deploy['id']}/requests"),headers=_bearer('adam'),json={'content':'Do it'})
    assert denied.status_code == 403
    result=client.post(path(workspace,f"/{review['id']}/requests"),headers=_bearer('adam'),json={'content':'Check code'})
    assert result.status_code == 200, result.text
    channel=result.json()['data']['channel']
    event=db.execute(select(EventRecord).where(EventRecord.target==f'channel/{channel}',EventRecord.type=='workspace.message.posted')).scalar_one()
    assert event.metadata_['target_agents'] == ['agent-alpha']
    context=client.get(f"/v1/agents/agent-alpha/shared-context?network={workspace['id']}&channel={channel}&requester_email=adam@acme.test",headers={'X-Workspace-Token':workspace['token']})
    assert context.status_code == 200,context.text
    assert context.json()['data']['shared_instructions']=='Only Review'
    assert client.patch(path(workspace,f"/{review['id']}"),headers=_bearer('adam'),json={'agent_name':'agent-alpha','name':'Hijack'}).status_code == 403


def test_revocation_and_service_specific_approval(client, workspace, db, owner):
    service=make(client,workspace,request_approver_email='mia@acme.test')
    grant=share(client,workspace,service['id'])
    result=client.post(path(workspace,f"/{service['id']}/requests"),headers=_bearer('adam'),json={'content':'Check code'})
    assert result.status_code==200,result.text
    approval=db.execute(select(ApprovalRequest).where(ApprovalRequest.kind=='service_request')).scalar_one()
    assert approval.assignee_email=='mia@acme.test'
    event=db.get(EventRecord,approval.policy_requirements['trigger_event_id'])
    assert event.metadata_['target_agents']==['__no_response__']
    assert client.delete(f"/v1/grants/{grant}?network={workspace['id']}",headers=_bearer('mia')).status_code==200
    assert client.post(path(workspace,f"/{service['id']}/requests"),headers=_bearer('adam'),json={'content':'Retry'}).status_code==403
    response=client.post(f"/v1/approvals/{approval.id}/approve",headers=_bearer('mia'),json={'network':workspace['id']})
    assert response.status_code==403,response.text
