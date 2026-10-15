"""Thread settings enforce membership controls beyond the UI."""
from sqlalchemy import select, update
from app.models import Channel, WorkspaceMember
from tests.test_visibility import _bearer, _create_thread, people, no_push  # noqa: F401
from tests.test_groups_grants import _patch_thread


def event(client, ws, user, action, source='human:user'):
    return client.post('/v1/events', headers=_bearer(user, ws), json={
        'network': ws['id'], 'type': f'network.channel.{action}',
        'source': source, 'target': 'channel/settings-test',
        'payload': {'channel': 'settings-test', 'agent_name': 'agent-alpha'},
    })


def setup_thread(client, workspace, db):
    from app.models import WorkspaceMembership, User
    user = db.execute(select(User).where(User.email == 'vic@acme.test')).scalar_one()
    db.execute(update(WorkspaceMembership).where(WorkspaceMembership.workspace_id == workspace['id'], WorkspaceMembership.user_id == user.id).values(role='member'))
    db.commit()
    _create_thread(client, workspace, name='settings-test', by='mia', visibility='public')
    assert client.post('/v1/channels/settings-test/participants', headers=_bearer('mia', workspace),
                       json={'network': workspace['id'], 'email': 'vic@acme.test'}).status_code == 200
    agent = db.execute(select(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace['id'],
                                                   WorkspaceMember.agent_name == 'agent-alpha')).scalar_one()
    agent.owner_email = 'vic@acme.test'
    db.commit()
    assert client.post('/v1/channels/settings-test/join', headers=_bearer('adam', workspace),
                       json={'network': workspace['id']}).status_code == 200


def test_agent_switch_enforced_and_admin_override(client, workspace, people, db):
    setup_thread(client, workspace, db)
    mia, vic = _bearer('mia', workspace), _bearer('vic', workspace)
    assert _patch_thread(client, workspace, vic, 'settings-test', members_can_add_agents=False).status_code == 403
    response = _patch_thread(client, workspace, mia, 'settings-test', members_can_add_agents=False)
    assert response.status_code == 200 and response.json()['data']['members_can_add_agents'] is False
    assert event(client, workspace, 'adam', 'leave').status_code == 200
    db.expire_all()
    assert db.execute(select(Channel).where(Channel.name == 'settings-test')).scalar_one().master_agent is None
    assert event(client, workspace, 'vic', 'join').status_code == 403
    # A signed-in member cannot bypass the switch by claiming an agent source.
    assert event(client, workspace, 'vic', 'join', source='openagents:agent-alpha').status_code == 403
    assert event(client, workspace, 'adam', 'join').status_code == 200
    assert event(client, workspace, 'vic', 'leave').status_code == 200  # own agent
    assert _patch_thread(client, workspace, mia, 'settings-test', members_can_add_agents=True).status_code == 200
    assert event(client, workspace, 'vic', 'join').status_code == 200
    participants = client.get(f"/v1/channels/settings-test/participants?network={workspace['id']}", headers=mia).json()['data']
    assert participants['members_can_add_agents'] is True
    assert any(a['agent_name'] == 'agent-alpha' for a in participants['agents'])


def test_nonparticipant_cannot_add_agent_or_remove_others(client, workspace, people, db):
    setup_thread(client, workspace, db)
    # Make vic a non-owner of the agent, and remove them from the roster.
    agent = db.execute(select(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace['id'],
                                                   WorkspaceMember.agent_name == 'agent-alpha')).scalar_one()
    agent.owner_email = 'mia@acme.test'
    db.commit()
    assert event(client, workspace, 'vic', 'leave').status_code == 403
    endpoint = f"/v1/channels/settings-test/participants/vic@acme.test?network={workspace['id']}"
    assert client.delete(endpoint, headers=_bearer('adam', workspace)).status_code == 200
    assert event(client, workspace, 'adam', 'leave').status_code == 200
    assert event(client, workspace, 'vic', 'join').status_code == 403


def test_invite_people_permission_does_not_allow_removing_others(client, workspace, people, db):
    setup_thread(client, workspace, db)
    assert _patch_thread(client, workspace, _bearer('mia', workspace), 'settings-test', participants_can_invite=True).status_code == 200
    assert client.post('/v1/channels/settings-test/participants', headers=_bearer('mia', workspace),
                       json={'network': workspace['id'], 'email': 'adam@acme.test'}).status_code == 200
    endpoint = f"/v1/channels/settings-test/participants/adam@acme.test?network={workspace['id']}"
    assert client.delete(endpoint, headers=_bearer('vic', workspace)).status_code == 403
    assert client.delete(endpoint, headers=_bearer('mia', workspace)).status_code == 200


def test_agent_itself_cannot_bypass_disabled_switch(client, workspace, people, db):
    setup_thread(client, workspace, db)
    assert event(client, workspace, 'adam', 'leave').status_code == 200
    assert _patch_thread(client, workspace, _bearer('mia', workspace), 'settings-test', members_can_add_agents=False).status_code == 200
    result = client.post('/v1/events', headers={'X-Workspace-Token': workspace['token']}, json={
        'network': workspace['id'], 'type': 'network.channel.join', 'source': 'openagents:agent-alpha',
        'target': 'channel/settings-test', 'payload': {'channel': 'settings-test', 'agent_name': 'agent-alpha'},
    })
    assert result.status_code == 403


def test_personal_agent_sharing_tracks_thread_roster(client, workspace, people, db):
    from tests.test_visibility import _revoke_everyone, _discover
    from tests.test_groups_grants import _explain
    setup_thread(client, workspace, db)
    agent = db.execute(select(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace['id'],
                                                   WorkspaceMember.agent_name == 'agent-alpha')).scalar_one()
    agent.owner_email = 'mia@acme.test'
    db.commit()
    mia, vic, adam = [_bearer(name, workspace) for name in ('mia', 'vic', 'adam')]
    _revoke_everyone(client, workspace, 'agent-alpha', mia)
    endpoint = '/v1/channels/settings-test/my-agent-sharing'
    def toggle(headers, enabled):
        return client.patch(endpoint, headers=headers, json={'network': workspace['id'], 'enabled': enabled})
    assert 'agent-alpha' not in _discover(client, workspace, vic)[1]
    assert client.delete(f"/v1/channels/settings-test/participants/adam@acme.test?network={workspace['id']}", headers=adam).status_code == 200
    assert toggle(adam, True).status_code == 403  # not in this thread
    assert toggle(mia, True).status_code == 200
    assert 'agent-alpha' in _discover(client, workspace, vic)[1]
    assert _explain(client, workspace, vic, 'agent', 'agent-alpha', 'act')['allowed'] is True
    assert _explain(client, workspace, vic, 'agent', 'agent-alpha', 'share')['allowed'] is False
    assert _explain(client, workspace, adam, 'agent', 'agent-alpha', 'act')['allowed'] is False
    roster = client.get(f"/v1/channels/settings-test/participants?network={workspace['id']}", headers=mia).json()['data']
    assert roster['sharing_my_agents'] is True and roster['own_agent_count'] == 1
    assert toggle(mia, False).status_code == 200
    assert 'agent-alpha' not in _discover(client, workspace, vic)[1]
    # Another person's setting never changes the agent owner's choice.
    assert toggle(vic, True).status_code == 200
    assert _explain(client, workspace, vic, 'agent', 'agent-alpha', 'act')['allowed'] is False
    assert toggle(mia, True).status_code == 200
    assert client.delete(f"/v1/channels/settings-test/participants/vic@acme.test?network={workspace['id']}", headers=mia).status_code == 200
    assert _explain(client, workspace, vic, 'agent', 'agent-alpha', 'act')['allowed'] is False
    assert client.post('/v1/channels/settings-test/participants', headers=mia,
                       json={'network': workspace['id'], 'email': 'vic@acme.test'}).status_code == 200
    assert _explain(client, workspace, vic, 'agent', 'agent-alpha', 'act')['allowed'] is True
    assert event(client, workspace, 'mia', 'leave').status_code == 200
    assert _explain(client, workspace, vic, 'agent', 'agent-alpha', 'act')['allowed'] is False


def test_thread_settings_require_owner_or_joined_admin(client, workspace, people, db):
    _create_thread(client, workspace, name='settings-test', by='mia', visibility='public')
    url = f"/v1/workspaces/{workspace['id']}/channels/settings-test"
    roster_url = f"/v1/channels/settings-test/participants?network={workspace['id']}"
    for user in ('vic', 'adam'):
        headers = _bearer(user, workspace)
        roster = client.get(roster_url, headers=headers).json()['data']
        assert not roster['can_manage'] and not roster['can_add_people'] and not roster['can_add_agents']
        for update in ({'orchestration_mode': 'dynamic'}, {'response_mode': 'passive'},
                       {'visibility': 'private'}, {'workflow_id': 'unknown'},
                       {'orchestration_instruction': 'do something'}, {'title': 'hijacked'}):
            assert client.patch(url, headers=headers, json=update).status_code == 403
        assert _patch_thread(client, workspace, headers, 'settings-test', visibility='private').status_code == 403
        assert client.post('/v1/channels/settings-test/participants', headers=headers,
                           json={'network': workspace['id'], 'email': 'vic@acme.test'}).status_code == 403
    # Membership alone does not grant ownership-level controls.
    assert client.post('/v1/channels/settings-test/join', headers=_bearer('vic', workspace),
                       json={'network': workspace['id']}).status_code == 200
    assert client.patch(url, headers=_bearer('vic', workspace), json={'response_mode': 'passive'}).status_code == 403
    # Workspace admins join before using in-thread management controls.
    assert client.post('/v1/channels/settings-test/join', headers=_bearer('adam', workspace),
                       json={'network': workspace['id']}).status_code == 200
    assert client.patch(url, headers=_bearer('adam', workspace), json={'response_mode': 'passive'}).status_code == 200
    assert client.patch(url, headers=_bearer('mia', workspace), json={'response_mode': 'proactive'}).status_code == 200
    assert client.patch(url, headers=_bearer('mia', workspace), json={'orchestration_mode': 'master'}).status_code == 400
    assert client.patch(url, headers=_bearer('mia', workspace), json={'master_agent': 'agent-alpha'}).status_code == 400


def test_expired_identity_cannot_fall_back_to_workspace_token(client, workspace, people, db):
    from app.services.access_model import resolve_principal
    from app.models import Workspace
    headers = {'X-Workspace-Token': workspace['token'], 'Authorization': 'Bearer invalid-session'}
    url = f"/v1/workspaces/{workspace['id']}/channels/{workspace['channel']['name']}"
    assert client.patch(url, headers=headers, json={'response_mode': 'passive'}).status_code == 401
    principal = resolve_principal(db, db.get(Workspace, workspace['id']), workspace['token'], headers['Authorization'])
    assert not principal.machine and not principal.email
