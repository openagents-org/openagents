"""Migration continuity without relaxing privacy on newly paired devices."""
import pytest
from sqlalchemy import select
from app.models import Node, Workspace, WorkspaceMember, WorkspaceMembership, User
from app.services.access_model import resolve_principal
from app.services.legacy_ownership import workspace_owner_email, inherit_unowned_resources
from tests.test_visibility import people, no_push, _bearer, _tok
from tests.test_private_connections import pair


@pytest.fixture
def legacy(db, workspace):
    ws = db.get(Workspace, workspace['id'])
    ws.creator_email = None
    ws.legacy_machine_access = True
    ws.require_login = False
    agent = db.get(WorkspaceMember, (ws.id, 'agent-alpha'))
    agent.owner_email = None
    node = Node(workspace_id=ws.id, node_key='old-device', token='old-device-credential',
                legacy_workspace_token=True, owner_email=None)
    db.add(node)
    db.flush()
    agent.node_id = node.id
    db.commit()
    return ws, node


@pytest.mark.parametrize('credential', ['shared', 'device'])
@pytest.mark.parametrize('duplicate_bearer', [False, True])
def test_ownerless_connection_rejoins_and_heartbeats(client, db, workspace, legacy, credential, duplicate_bearer):
    ws, node = legacy
    token = workspace['token'] if credential == 'shared' else node.token
    response = client.post('/v1/join', json={'network': ws.id, 'agent_name': 'agent-alpha', 'token': token})
    assert response.status_code == 200, response.text
    headers = {'X-Workspace-Token': token, 'X-Agent-Name': 'agent-alpha'}
    authorization = f'Bearer {token}' if duplicate_bearer else None
    if authorization:
        headers['Authorization'] = authorization
    assert client.post('/v1/devices/heartbeat', headers=headers, json={'node_id': node.id}).status_code == 200
    assert client.get(f'/v1/devices/{node.id}/commands', headers=headers).status_code == 200
    assert client.get(f'/v1/discover?network={ws.id}', headers=headers).status_code == 200
    assert client.get(f'/v1/events?network={ws.id}', headers=headers).status_code == 200
    db.expire_all()
    agent = db.get(WorkspaceMember, (ws.id, 'agent-alpha'))
    assert agent.node_id == node.id and agent.owner_email is None and agent.status == 'online'
    assert resolve_principal(db, ws, token, authorization, 'agent-alpha').machine


def test_owner_inheritance_preserves_explicit_device_owner(db, workspace, people):
    ws = db.get(Workspace, workspace['id'])
    assert workspace_owner_email(db, ws) == 'test@example.com'
    own = Node(workspace_id=ws.id, node_key='unowned')
    private = Node(workspace_id=ws.id, node_key='private', owner_email='mia@acme.test')
    db.add_all([own, private]); db.flush()
    agent = db.get(WorkspaceMember, (ws.id, 'agent-alpha'))
    agent.node_id = private.id
    agent.owner_email = None
    db.flush()
    inherit_unowned_resources(db, ws, workspace_owner_email(db, ws))
    db.flush(); db.expire_all()
    assert own.owner_email == 'test@example.com'
    assert private.owner_email == agent.owner_email == 'mia@acme.test'
    ws.creator_email = None
    assert workspace_owner_email(db, ws) is None  # an admin is not an owner
    mia = db.execute(select(User).where(User.email == 'mia@acme.test')).scalar_one()
    db.get(WorkspaceMembership, (ws.id, mia.id)).role = 'owner'
    db.flush()
    assert workspace_owner_email(db, ws) == 'mia@acme.test'


def test_join_without_device_inherits_workspace_owner(client, db, workspace):
    response = client.post('/v1/join', json={'network': workspace['id'], 'agent_name': 'legacy-cli', 'token': workspace['token']})
    assert response.status_code == 200, response.text
    assert db.get(WorkspaceMember, (workspace['id'], 'legacy-cli')).owner_email == 'test@example.com'


@pytest.mark.parametrize('headers', [{}, {'X-Workspace-Token': 'wrong'},
    {'Authorization': 'Bearer wrong', 'X-Workspace-Token': 'wrong'},
    {'Authorization': 'Bearer bad', 'X-Workspace-Token': 'old-device-credential'}])
def test_legacy_device_rejects_invalid_credentials(client, legacy, headers):
    _, node = legacy
    assert client.get(f'/v1/devices/{node.id}/commands', headers=headers).status_code in (401, 403)


@pytest.mark.parametrize('duplicate_bearer', [False, True])
def test_legacy_credentials_cannot_control_new_private_connections(client, workspace, legacy, people, duplicate_bearer):
    private = pair(client, workspace)
    for token in (workspace['token'], legacy[1].token):
        headers = {'X-Workspace-Token': token}
        if duplicate_bearer:
            headers['Authorization'] = f'Bearer {token}'
        assert client.post('/v1/devices/heartbeat', headers=headers,
                           json={'node_id': private['nodeId']}).status_code == 401


def test_new_ownerless_workspace_does_not_get_legacy_privileges(db, workspace):
    ws = db.get(Workspace, workspace['id'])
    ws.creator_email = None
    member = db.get(WorkspaceMember, (ws.id, 'agent-alpha'))
    member.owner_email = None
    db.flush()
    assert not ws.legacy_machine_access
    assert not resolve_principal(db, ws, workspace['token'], None, 'agent-alpha').machine


def test_legacy_principal_does_not_override_human_or_private_owner(db, workspace, legacy, people):
    ws, _ = legacy
    assert not resolve_principal(db, ws, workspace['token'], 'Bearer bad', 'agent-alpha').machine
    assert not resolve_principal(db, ws, workspace['token'], 'Bearer mia', 'agent-alpha').machine
    db.get(WorkspaceMember, (ws.id, 'agent-alpha')).owner_email = 'mia@acme.test'
    db.flush()
    principal = resolve_principal(db, ws, workspace['token'], None, 'agent-alpha')
    assert principal.is_agent and not principal.machine
    principal = resolve_principal(db, ws, workspace['token'], f"Bearer {workspace['token']}", 'agent-alpha')
    assert principal.is_agent and not principal.machine


@pytest.mark.parametrize('credential', [None, 'wrong', 'old-device-credential'])
def test_claim_requires_workspace_credential(client, workspace, legacy, people, credential):
    headers = _bearer('mia')
    if credential:
        headers['X-Workspace-Token'] = credential
    response = client.post(f"/v1/workspaces/{workspace['id']}/claim", headers=headers)
    assert response.status_code == 403, response.text


def test_claim_requires_signed_in_person(client, workspace, legacy, people):
    assert client.post(f"/v1/workspaces/{workspace['id']}/claim", headers=_tok(workspace)).status_code == 401
    assert client.post(f"/v1/workspaces/{workspace['id']}/claim", headers=_bearer('bad', workspace)).status_code == 401


def test_claim_inherits_resources_without_invalidating_old_credentials(client, db, workspace, legacy, people):
    ws, node = legacy
    preserved = Node(workspace_id=ws.id, node_key='someone-else', owner_email='adam@acme.test', token='other-device')
    db.add(preserved); db.commit()
    route = f'/v1/workspaces/{ws.id}/claim'
    response = client.post(route, headers=_bearer('mia', workspace))
    assert response.status_code == 200, response.text
    db.expire_all()
    assert ws.creator_email == node.owner_email == 'mia@acme.test'
    assert db.get(WorkspaceMember, (ws.id, 'agent-alpha')).owner_email == 'mia@acme.test'
    assert not ws.legacy_machine_access
    assert preserved.owner_email == 'adam@acme.test'
    for token in (workspace['token'], 'old-device-credential'):
        assert client.post('/v1/devices/heartbeat', headers={'X-Workspace-Token': token}, json={'node_id': node.id}).status_code == 200
        assert client.post('/v1/join', json={'network': ws.id, 'agent_name': 'agent-alpha', 'token': token}).status_code == 200
    assert client.post(route, headers=_bearer('mia')).status_code == 200
    assert client.post(route, headers=_bearer('adam', workspace)).status_code == 403


def test_open_legacy_workspace_runs_but_cannot_be_claimed_by_url(client, db, workspace, legacy, people):
    ws, _ = legacy
    ws.password_hash = None
    db.commit()
    assert resolve_principal(db, ws, None, None, 'agent-alpha').machine
    assert client.post(f'/v1/workspaces/{ws.id}/claim', headers=_bearer('mia')).status_code == 403


def test_workspace_token_does_not_cross_workspaces(client, db, workspace, legacy):
    other = Workspace(name='Other', password_hash='unrelated-token', legacy_machine_access=True)
    db.add(other); db.commit()
    assert not resolve_principal(db, other, workspace['token'], None, 'agent-alpha').machine
    assert not resolve_principal(db, other, workspace['token'], f"Bearer {workspace['token']}", 'agent-alpha').machine
    assert client.get(f'/v1/events?network={other.id}', headers={
        'X-Workspace-Token': workspace['token'], 'Authorization': f"Bearer {workspace['token']}"}).status_code == 401
    assert client.post('/v1/join', json={'network': other.id, 'agent_name': 'agent-alpha', 'token': workspace['token']}).status_code == 401
