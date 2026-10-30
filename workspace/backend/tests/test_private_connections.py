"""Private connections must not transfer with re-pairing or expose host controls."""
import pytest
from sqlalchemy import select
from app.models import Node, NodePairingCode, WorkspaceMember, ResourceGrant, SecurityGroup, SecurityGroupMember
from tests.test_visibility import people, no_push, _bearer, _tok


def pair(client, ws, who='mia', key='one-physical-device'):
    minted = client.post(f"/v1/workspaces/{ws['id']}/pairing-codes", headers=_bearer(who, ws))
    assert minted.status_code == 200, minted.text
    response = client.post('/v1/devices/redeem', json={'code': minted.json()['data']['code'], 'node_key': key, 'hostname': 'my-computer'})
    assert response.status_code == 200, response.text
    return response.json()['data']


def join(client, ws, connection, name='private-agent'):
    return client.post('/v1/join', json={'network': ws['id'], 'agent_name': name, 'token': connection['token']})


def discover(client, ws, who):
    return client.get(f"/v1/discover?network={ws['id']}", headers=_bearer(who, ws)).json()['data']['agents']


def test_pairing_requires_a_human_member(client, workspace, people):
    for headers in ({}, _tok(workspace), _bearer('vic', workspace)):
        assert client.post(f"/v1/workspaces/{workspace['id']}/pairing-codes", headers=headers).status_code == 403
    assert pair(client, workspace)['ownerEmail'] == 'mia@acme.test'


def test_same_device_connections_are_private_and_independent(client, workspace, people):
    mine = pair(client, workspace)
    theirs = pair(client, workspace, 'adam')
    assert mine['nodeId'] != theirs['nodeId']
    assert mine['token'] != theirs['token']
    again = pair(client, workspace)
    assert again['nodeId'] == mine['nodeId'] and again['token'] == mine['token']
    for who, connection in [('mia', mine), ('adam', theirs)]:
        for prefix in ('devices', 'nodes'):
            rows = client.get(f"/v1/{prefix}?network={workspace['id']}", headers=_bearer(who, workspace)).json()['data']
            assert [r['nodeId'] for r in rows] == [connection['nodeId']]
    assert client.get(f"/v1/devices?network={workspace['id']}", headers=_bearer('vic', workspace)).json()['data'] == []
    assert client.get(f"/v1/devices?network={workspace['id']}", headers=_tok(workspace)).json()['data'] == []


def test_controls_history_and_heartbeat_are_connection_private(client, workspace, people):
    mine = pair(client, workspace)
    other = pair(client, workspace, 'adam')
    route = f"/v1/devices/{mine['nodeId']}"
    body = {'action': 'detect_runtimes'}
    for headers in (_bearer('adam', workspace), _bearer('vic', workspace), _tok(workspace), {'X-Workspace-Token': other['token']}):
        assert client.post(route+'/commands', headers=headers, json=body).status_code == 403
        assert client.get(route+'/commands', headers=headers).status_code == 403
        assert client.delete(route, headers=headers).status_code == 403
        assert client.post('/v1/devices/heartbeat', headers=headers, json={'node_id': mine['nodeId']}).status_code == 401
    assert client.post(route+'/commands', headers=_bearer('mia', workspace), json=body).status_code == 200
    assert client.post('/v1/devices/heartbeat', headers={'X-Workspace-Token': mine['token']}, json={'node_id': mine['nodeId']}).status_code == 200
    assert client.delete(route, headers=_bearer('mia', workspace)).status_code == 200
    assert client.get(f"/v1/devices?network={workspace['id']}", headers=_bearer('adam', workspace)).json()['data'][0]['nodeId'] == other['nodeId']


def test_agent_inherits_owner_stays_private_and_cannot_be_taken_over(client, workspace, people, db):
    mine = pair(client, workspace)
    other = pair(client, workspace, 'adam')
    assert join(client, workspace, mine).status_code == 200
    db.expire_all()
    agent = db.get(WorkspaceMember, (workspace['id'], 'private-agent'))
    assert agent.owner_email == 'mia@acme.test' and agent.node_id == mine['nodeId']
    assert agent.visibility == 'personal'
    assert not db.execute(select(ResourceGrant).where(ResourceGrant.resource_id == 'private-agent')).scalars().all()
    assert any(a['address'] == 'openagents:private-agent' for a in discover(client, workspace, 'mia'))
    assert not any(a['address'] == 'openagents:private-agent' for a in discover(client, workspace, 'adam'))
    assert join(client, workspace, other).status_code == 401
    assert join(client, workspace, {'token': workspace['token']}).status_code == 401
    route = f"/v1/workspaces/{workspace['id']}/members/private-agent"
    assert client.patch(route, headers=_bearer('adam', workspace), json={'description': 'hijack'}).status_code == 403
    assert client.patch(route, headers=_bearer('mia', workspace), json={'owner_email': 'adam@acme.test'}).status_code == 400
    assert client.post(f"/v1/devices/{other['nodeId']}/commands", headers=_bearer('adam', workspace), json={'action': 'stop_agent', 'args': {'name': 'private-agent'}}).status_code == 403
    # Even raw events cannot forge another connection's identity.
    response = client.post('/v1/events', headers={'X-Workspace-Token': other['token']}, json={
        'network': workspace['id'], 'type': 'network.agent.join', 'source': 'openagents:forged', 'target': 'core',
        'payload': {'agent_name': 'forged', 'node_id': mine['nodeId']}})
    assert response.status_code == 200
    db.expire_all()
    assert db.get(WorkspaceMember, (workspace['id'], 'forged')).owner_email == 'adam@acme.test'


def test_only_owner_can_share_with_people_or_groups(client, workspace, people, db):
    mine = pair(client, workspace)
    assert join(client, workspace, mine).status_code == 200
    group = SecurityGroup(workspace_id=workspace['id'], slug='reviewers', name='Reviewers', kind='custom', created_by='mia@acme.test')
    db.add(group); db.flush()
    db.add(SecurityGroupMember(group_id=group.id, principal_kind='human', principal_id='adam@acme.test'))
    db.commit()
    for kind, identifier in [('human', 'adam@acme.test'), ('group', group.id)]:
        body = {'network': workspace['id'], 'resource_kind': 'agent', 'resource_id': 'private-agent', 'grantee_kind': kind, 'grantee_id': identifier, 'rights': ['act']}
        assert client.post('/v1/grants', headers=_bearer('adam', workspace), json=body).status_code == 403
        result = client.post('/v1/grants', headers=_bearer('mia', workspace), json=body)
        assert result.status_code == 200, result.text
    shared = next(a for a in discover(client, workspace, 'adam') if a['address'] == 'openagents:private-agent')
    assert shared.get('node_id') is None and shared.get('server_host') is None
    assert shared.get('working_dir') is None and shared.get('runtime_name') is None
    # A share exposes the agent, never the owner's machine.
    assert client.get(f"/v1/devices?network={workspace['id']}", headers=_bearer('adam', workspace)).json()['data'] == []


def test_disconnecting_preserves_agent_ownership(client, workspace, people, db):
    mine = pair(client, workspace)
    assert join(client, workspace, mine).status_code == 200
    assert client.delete(f"/v1/devices/{mine['nodeId']}", headers=_bearer('mia', workspace)).status_code == 200
    db.expire_all()
    agent = db.get(WorkspaceMember, (workspace['id'], 'private-agent'))
    assert agent.node_id is None and agent.owner_email == 'mia@acme.test'
    route = f"/v1/workspaces/{workspace['id']}/members/private-agent"
    assert client.patch(route, headers=_bearer('adam', workspace), json={'owner_email': 'adam@acme.test'}).status_code == 403
    assert client.delete(route, headers=_bearer('adam', workspace)).status_code == 403
    assert client.patch(route, headers=_bearer('mia', workspace), json={'description': 'Still mine'}).status_code == 200
