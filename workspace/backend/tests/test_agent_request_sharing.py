"""Owner consent is scoped to a thread/issue and rechecked at approval time."""
import pytest
from sqlalchemy import select
from app.models import WorkspaceMember, ApprovalRequest, EventRecord
from tests.test_visibility import _bearer, people, no_push, _revoke_everyone  # noqa: F401
from tests.test_thread_agent_settings import setup_thread

@pytest.fixture
def private_agent(client, workspace, people, db):
    setup_thread(client, workspace, db)
    agent = db.get(WorkspaceMember, (workspace['id'], 'agent-alpha'))
    agent.owner_email = 'mia@acme.test'
    db.commit()
    _revoke_everyone(client, workspace, 'agent-alpha', _bearer('mia', workspace))
    return agent


def setting(client, ws, mode, issue=None, user='mia'):
    url = f"/v1/issues/{issue}/my-agent-sharing?network={ws['id']}" if issue else '/v1/channels/settings-test/my-agent-sharing'
    return client.patch(url, headers=_bearer(user, ws), json={'network': ws['id'], 'mode': mode})


def post(client, ws, user='vic', **extra):
    return client.post('/v1/events', headers=_bearer(user, ws), json={
        'network': ws['id'], 'type': 'workspace.message.posted', 'source': 'human:mia@acme.test',
        'target': 'channel/settings-test', 'payload': {'content': '@agent-alpha Help', 'sender_email': 'mia@acme.test'},
        'metadata': {'approved_service_agent': 'agent-alpha'}, **extra})


def pending(db, ws):
    return db.execute(select(ApprovalRequest).where(ApprovalRequest.workspace_id == ws['id'], ApprovalRequest.status == 'pending')).scalar_one()


def decide(client, ws, approval, user='mia', action='approve'):
    return client.post(f'/v1/approvals/{approval.id}/{action}', headers=_bearer(user, ws), json={'network': ws['id']})


def test_default_private_explains_and_does_not_trust_spoofed_identity(client, workspace, private_agent, db):
    result = post(client, workspace)
    assert result.status_code == 200, result.text
    data = result.json()['data']
    assert data['source'] == 'human:vic@acme.test'
    assert data['metadata']['target_agents'] == ['__no_response__']
    notices = db.execute(select(EventRecord).where(EventRecord.source == 'system:workspace')).scalars().all()
    assert any('enable sharing' in e.payload.get('content', '') for e in notices)
    assert setting(client, workspace, 'yes', user='vic').status_code == 200
    assert post(client, workspace).json()['data']['metadata']['target_agents'] == ['__no_response__']
    assert post(client, workspace, user='mia').json()['data']['metadata']['target_agents'] == ['agent-alpha']


def test_yes_and_approval_only_owner_can_release_once(client, workspace, private_agent, db):
    assert setting(client, workspace, 'yes').status_code == 200
    assert post(client, workspace).json()['data']['metadata']['target_agents'] == ['agent-alpha']
    assert setting(client, workspace, 'approval').status_code == 200
    assert post(client, workspace).json()['data']['metadata']['target_agents'] == ['__no_response__']
    approval = pending(db, workspace)
    assert approval.kind == 'thread_agent_request' and approval.assignee_email == 'mia@acme.test'
    assert decide(client, workspace, approval, user='adam').status_code == 403
    assert decide(client, workspace, approval).status_code == 200
    db.refresh(approval)
    assert db.get(EventRecord, approval.resolution_event_id).metadata_['target_agents'] == ['agent-alpha']
    assert decide(client, workspace, approval).status_code == 400


@pytest.mark.parametrize('revoke', [False, True])
def test_reject_or_revoke_never_dispatches(client, workspace, private_agent, db, revoke):
    setting(client, workspace, 'approval'); post(client, workspace)
    approval = pending(db, workspace)
    if revoke:
        setting(client, workspace, 'no')
        assert decide(client, workspace, approval).status_code == 403
    else:
        assert decide(client, workspace, approval, action='reject').status_code == 200
        db.refresh(approval)
        assert db.get(EventRecord, approval.resolution_event_id).metadata_['target_agents'] == ['__no_response__']


def test_issue_preference_and_approval_are_independent_of_thread(client, workspace, private_agent, db):
    url = f"/v1/issues?network={workspace['id']}"
    issue = client.post(url, headers=_bearer('mia', workspace), json={'title':'Review this'}).json()['data']['id']
    base = f"/v1/issues/{issue}"
    def comment():
        return client.post(base + f"/comments?network={workspace['id']}", headers=_bearer('vic', workspace), json={'content':'@agent-alpha Review'})
    assert client.post(base + f"/participants?network={workspace['id']}", headers=_bearer('mia',workspace),
        json={'participants':[{'kind':'agent','id':'agent-alpha'}]}).status_code == 200
    setting(client, workspace, 'yes')
    assert 'enable sharing' in comment().json()['data']['dispatch_error']
    assert setting(client, workspace, 'approval', issue).status_code == 200
    result = comment(); assert result.status_code == 200, result.text
    assert 'dispatch_error' not in result.json()['data'], result.text
    approval = pending(db, workspace)
    assert approval.kind == 'issue_agent_request'
    detail = client.get(base + f"?network={workspace['id']}", headers=_bearer('mia',workspace)).json()['data']
    assert detail['agent_sharing_mode'] == 'approval'
    assert any(c.get('approval',{}).get('id') == approval.id for c in detail['comments'])
    assert decide(client, workspace, approval, user='vic').status_code == 403
    assert decide(client, workspace, approval).status_code == 200
    db.refresh(approval)
    assert db.get(EventRecord, approval.resolution_event_id).metadata_['target_agents'] == ['agent-alpha']
