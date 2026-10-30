"""Reply citations and recalls stay within the authenticated conversation."""
from unittest.mock import patch
from sqlalchemy import select
from app.models import EventRecord, Channel, ChannelHumanMember
from tests.test_routing_choice import thread, two_members, no_push, post, resolve  # noqa: F401
from tests.test_issues import _bearer


def send(client, ws, target, content='reply', reply_to=None, user='ann', metadata=None):
    return client.post('/v1/events', headers=_bearer(user), json={
        'network': ws['id'], 'type': 'workspace.message.posted', 'source': 'human:spoof',
        'target': target, 'payload': {'content': content, 'sender_name': user.title(),
            **({'reply_to': reply_to} if reply_to else {})}, 'metadata': metadata or {},
    })


def recall(client, ws, event, user='ann'):
    return client.post(f"/v1/events/{event['id']}/recall?network={ws['id']}", headers=_bearer(user))


def test_reply_uses_stored_excerpt_not_forged_snapshot(client, workspace, thread):
    original = send(client, workspace, f'channel/{thread.name}', 'Original words').json()['data']
    response = send(client, workspace, original['target'], reply_to=original['id'], user='ben',
        metadata={'reply_to': {'content': 'forged quote'}})
    assert response.status_code == 200, response.text
    quoted = response.json()['data']['metadata']['reply_to']
    assert quoted['message_id'] == original['id']
    assert quoted['sender_name'] == 'Ann'
    assert quoted['content'] == 'Original words'
    assert quoted['thread_id'] == thread.id


def test_reply_cannot_copy_from_another_private_thread(client, workspace, thread, db):
    original = post(client, workspace, thread)
    other = Channel(workspace_id=workspace['id'], name='other', status='active', visibility='private')
    db.add(other); db.flush()
    db.add(ChannelHumanMember(channel_id=other.id, user_email='ben@acme.test')); db.commit()
    response = send(client, workspace, 'channel/other', reply_to=original['id'], user='ben')
    assert response.status_code >= 400, response.text


def test_dm_reply_allows_reverse_direction_but_not_another_pair(client, workspace, thread):
    original = send(client, workspace, 'human:ben@acme.test', 'A direct message').json()['data']
    reply = send(client, workspace, 'human:ann@acme.test', reply_to=original['id'], user='ben')
    assert reply.status_code == 200, reply.text
    assert reply.json()['data']['metadata']['reply_to']['thread_id'] == 'dm:human:ann@acme.test,human:ben@acme.test'
    denied = send(client, workspace, 'human:someone@acme.test', reply_to=original['id'])
    assert denied.status_code >= 400


def test_recall_is_sender_only_idempotent_and_redacts_citations(client, workspace, thread, db):
    original = post(client, workspace, thread)
    reply = send(client, workspace, original['target'], reply_to=original['id'], user='ben').json()['data']
    assert recall(client, workspace, original, user='ben').status_code == 403
    with patch('app.services.cloud_agent.invoke_cloud_agents') as invoke:
        response = recall(client, workspace, original)
        assert response.status_code == 200, response.text
        assert recall(client, workspace, original).json() == response.json()
        invoke.assert_not_called()
    db.expire_all()
    stored = db.get(EventRecord, original['id'])
    assert stored.payload['content'] == ''
    assert 'attachments' not in stored.payload
    assert stored.metadata_['recalled']
    quote = db.get(EventRecord, reply['id']).metadata_['reply_to']
    assert quote['content'] == '' and quote['recalled']
    notices = db.scalars(select(EventRecord).where(EventRecord.type == 'workspace.message.recalled')).all()
    assert len(notices) == 1
    assert notices[0].metadata_['target_agents'] == ['__no_response__']
    # A pending routing choice cannot start work after recall.
    with patch('app.services.cloud_agent.invoke_cloud_agents') as invoke:
        assert resolve(client, workspace, original).json()['data']['status'] == 'dismissed'
        invoke.assert_not_called()


def test_assigned_messages_cannot_be_recalled(client, workspace, thread):
    original = post(client, workspace, thread)
    with patch('app.services.cloud_agent.invoke_cloud_agents'):
        assigned = resolve(client, workspace, original).json()['data']
    assert recall(client, workspace, original).status_code == 409
    assert recall(client, workspace, {'id': assigned['assignment_event_id']}).status_code == 409


def test_recall_control_events_cannot_be_forged(client, workspace, thread):
    response = client.post('/v1/events', headers=_bearer('ann'), json={
        'network': workspace['id'], 'type': 'workspace.message.recalled', 'source': 'human:ann@acme.test',
        'target': f'channel/{thread.name}', 'payload': {'recalled_message_id': 'someone-elses-message'},
    })
    assert response.status_code == 403


def test_pending_owner_approval_cannot_be_recalled_as_human_chat(client, workspace, thread, db):
    from app.models import WorkspaceMember, ChannelAgentSharing
    beta = db.get(WorkspaceMember, (workspace['id'], 'agent-beta'))
    beta.owner_email = 'ben@acme.test'
    db.add(ChannelAgentSharing(channel_id=thread.id, owner_email='ben@acme.test', mode='approval'))
    db.commit()
    original = send(client, workspace, f'channel/{thread.name}', '@agent-beta please help').json()['data']
    assert original['metadata']['target_agents'] == ['__no_response__']
    assert recall(client, workspace, original).status_code == 409


def test_recall_notice_reaches_incremental_pollers(client, workspace, thread):
    original = post(client, workspace, thread)
    assert recall(client, workspace, original).status_code == 200
    response = client.get('/v1/events', headers=_bearer('ben'), params={
        'network': workspace['id'], 'channel': thread.name, 'type': 'workspace.message', 'after': original['id'],
    })
    assert response.status_code == 200, response.text
    rows = response.json()['data']['events']
    assert any(row['type'] == 'workspace.message.recalled' and row['payload']['recalled_message_id'] == original['id'] for row in rows)
