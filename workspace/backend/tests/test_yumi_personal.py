"""Yumi is available personally, never as a shared group participant."""
import asyncio
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models import Channel, ChannelHumanMember, ChannelMember, CloudAgentConfig, ResourceGrant, WorkspaceMember
from app.services import access_model as am
from app.services import personal_assistant as pa
from tests.test_yumi import yumi_enabled, quiet_background, _create_workspace, _hdr, _make_thread, _post


@pytest.fixture
def personal(client, db, yumi_enabled):
    data = _create_workspace(client)
    ch = Channel(workspace_id=data['workspaceId'], name='personal-yumi', owner_email='test@example.com',
                 visibility='public', status='active', master_agent='yumi')
    db.add(ch)
    db.flush()
    db.add(ChannelMember(channel_id=ch.id, agent_name='yumi'))
    db.add(ChannelHumanMember(channel_id=ch.id, user_email='test@example.com'))
    db.commit()
    return data, ch


@pytest.mark.parametrize('payload', [
    {'participants': ['yumi']}, {'participants': ['yumi', 'agent-alpha']},
    {'participants': ['agent-alpha'], 'master': 'yumi'},
])
def test_cannot_create_thread_with_yumi(client, db, yumi_enabled, payload):
    data = _create_workspace(client)
    response = client.post('/v1/events', headers=_hdr(data), json={
        'network': data['workspaceId'], 'type': 'network.channel.create',
        'source': 'human:test@example.com', 'target': 'core', 'payload': payload,
    })
    assert response.status_code >= 400
    assert 'personal assistant' in response.text


def test_cannot_add_yumi_or_another_agent_to_personal(client, db, personal):
    data, ch = personal
    group = _make_thread(client, data, 'Team', ['agent-alpha'])
    for channel, agent in [(group, 'yumi'), (ch.name, 'agent-alpha')]:
        response = client.post('/v1/events', headers=_hdr(data), json={
            'network': data['workspaceId'], 'type': 'network.channel.join',
            'source': 'human:test@example.com', 'target': 'core',
            'payload': {'channel': channel, 'agent_name': agent},
        })
        assert response.status_code >= 400
        assert 'personal assistant' in response.text


def test_personal_history_owner_only_despite_legacy_public_and_grants(db, personal):
    data, ch = personal
    wid = data['workspaceId']
    db.add(ResourceGrant(workspace_id=wid, resource_kind='channel', resource_id=ch.name,
        grantee_kind='human', grantee_id='other@example.com', rights=['read', 'act']))
    db.add(ChannelHumanMember(channel_id=ch.id, user_email='other@example.com'))
    db.commit()
    owner = am.Principal('human', email='test@example.com', workspace_id=wid)
    other = am.Principal('human', email='other@example.com', role='admin', workspace_id=wid)
    assert am.can_view_channel(db, wid, owner, ch)
    assert not am.can_view_channel(db, wid, other, ch)
    assert ch.name in am.hidden_channel_names(db, wid, other)
    assert ch.name not in am.hidden_channel_names(db, wid, owner)
    assert not am.can_manage(db, owner, am.resource_for_channel(ch))


@pytest.mark.parametrize('kind', ['agent', 'channel'])
def test_grants_cannot_share_yumi_or_personal_history(db, personal, kind):
    data, ch = personal
    with pytest.raises(HTTPException) as error:
        am.create_grant(db, data['workspaceId'], resource_kind=kind,
                       resource_id='yumi' if kind == 'agent' else ch.name,
                       grantee_kind='human', grantee_id='other@example.com')
    assert error.value.status_code == 403


def test_personal_invite_and_visibility_endpoints_blocked(client, personal):
    data, ch = personal
    headers = _hdr(data)
    response = client.post(f'/v1/channels/{ch.name}/participants', headers=headers,
        json={'network': data['workspaceId'], 'email': 'other@example.com'})
    assert response.status_code == 403
    for patch in [{'visibility': 'public'}, {'participants_can_invite': True},
                  {'members_can_add_agents': True}, {'owner_email': 'other@example.com'}]:
        response = client.patch(f'/v1/channels/{ch.name}', headers=headers,
                               json={'network': data['workspaceId'], **patch})
        assert response.status_code == 403
    response = client.patch(f"/v1/workspaces/{data['workspaceId']}/channels/{ch.name}",
                            headers=headers, json={'visibility': 'public'})
    assert response.status_code == 403
    response = client.get(f'/v1/channels/{ch.name}/participants', headers=headers,
                          params={'network': data['workspaceId']})
    assert response.status_code == 200
    assert not response.json()['data']['can_add_people']
    assert not response.json()['data']['can_add_agents']


def test_legacy_group_yumi_hidden_and_cannot_run(client, db, personal, monkeypatch, quiet_background):
    from app.services import cloud_agent
    data, _ = personal
    group = _make_thread(client, data, 'Team', ['agent-alpha'])
    ch = db.execute(select(Channel).where(Channel.workspace_id == data['workspaceId'], Channel.name == group)).scalar_one()
    db.add(ChannelMember(channel_id=ch.id, agent_name='yumi'))
    db.commit()
    assert not pa.is_personal_channel(db, ch)
    assert 'yumi' not in _post(client, data, group, 'human:test@example.com', '@yumi help')
    response = client.get('/v1/discover', headers=_hdr(data), params={'network': data['workspaceId']})
    row = next(c for c in response.json()['data']['channels'] if c['address'] == f'channel/{group}')
    assert row['participants'] == ['agent-alpha']
    response = client.get(f'/v1/channels/{group}/participants', headers=_hdr(data), params={'network': data['workspaceId']})
    assert [a['agent_name'] for a in response.json()['data']['agents']] == ['agent-alpha']
    cfg = db.execute(select(CloudAgentConfig).where(CloudAgentConfig.workspace_id == data['workspaceId'], CloudAgentConfig.agent_name == 'yumi')).scalar_one()
    invoke = AsyncMock()
    monkeypatch.setattr(cloud_agent, '_invoke_assistant_agent', invoke)
    asyncio.run(cloud_agent._invoke_single(db, data['workspaceId'], {'source': 'human:test@example.com', 'target': f'channel/{group}'}, cfg, 0))
    invoke.assert_not_awaited()
    asyncio.run(cloud_agent._invoke_single(db, data['workspaceId'], {'source': 'human:test@example.com', 'target': 'openagents:yumi'}, cfg, 0))
    invoke.assert_awaited_once()


def test_user_agent_named_yumi_unchanged(client, db):
    data = _create_workspace(client)
    db.add(WorkspaceMember(workspace_id=data['workspaceId'], agent_name='yumi', agent_type='claude', status='online'))
    db.commit()
    assert not pa.is_yumi(db, data['workspaceId'], 'yumi')
    assert _make_thread(client, data, 'Ordinary agent', ['yumi', 'agent-alpha'])


def test_cannot_copy_personal_context_into_team_thread(client, personal):
    data, ch = personal
    response = client.post('/v1/events', headers=_hdr(data), json={
        'network': data['workspaceId'], 'type': 'network.channel.create',
        'source': 'human:test@example.com', 'target': 'core',
        'payload': {'participants': ['agent-alpha'], 'resume_from': ch.name},
    })
    assert response.status_code >= 400
    assert 'personal assistant' in response.text


def test_cannot_remove_yumi_then_share_personal_thread(client, personal):
    data, ch = personal
    response = client.post('/v1/events', headers=_hdr(data), json={
        'network': data['workspaceId'], 'type': 'network.channel.leave',
        'source': 'human:test@example.com', 'target': 'core',
        'payload': {'channel': ch.name, 'agent_name': 'yumi'},
    })
    assert response.status_code >= 400
    assert 'personal assistant' in response.text


def test_personal_mentions_do_not_invite_other_agents(client, db, personal, quiet_background):
    data, ch = personal
    targets = _post(client, data, ch.name, 'human:test@example.com', '@agent-alpha please help', sender_email='test@example.com')
    assert targets == ['yumi']
    members = list(db.execute(select(ChannelMember.agent_name).where(ChannelMember.channel_id == ch.id)).scalars())
    assert members == ['yumi']


def test_personal_conversation_cannot_be_snapshotted(client, db, personal):
    from app.models import ShareSnapshot
    data, ch = personal
    response = client.post('/v1/shares', headers=_hdr(data), json={
        'network': data['workspaceId'], 'channel': ch.name,
    })
    assert response.status_code == 403
    db.add(ShareSnapshot(workspace_id=data['workspaceId'], channel_name=ch.name,
        created_by='human:test@example.com', snapshot_data=[{'content': 'personal history'}],
        share_token='old-personal-snapshot', message_count=1))
    db.commit()
    response = client.get('/v1/shares/public/old-personal-snapshot')
    assert response.status_code == 404
    assert 'personal history' not in response.text
