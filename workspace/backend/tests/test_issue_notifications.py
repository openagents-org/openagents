"""Issue results notify the requester, without broadcasting or double delivery."""
from unittest.mock import patch

import pytest
from sqlalchemy import select

from app.models import Channel, EventRecord, Issue, IssueThread, NotificationRecord, User, WorkspaceMembership
from app.services.issue_notifications import notify_issue_completion


@pytest.fixture
def completion(db, workspace):
    user = User(email='requester@acme.test', display_name='Requester')
    db.add(user)
    db.flush()
    db.add(WorkspaceMembership(workspace_id=workspace['id'], user_id=user.id, role='member'))
    channel = Channel(workspace_id=workspace['id'], name='issue-work', visibility='public')
    issue = Issue(workspace_id=workspace['id'], title='Fix onboarding', created_by='human:other@acme.test')
    db.add_all([channel, issue])
    db.flush()
    db.add(IssueThread(issue_id=issue.id, channel_id=channel.id))
    reply = EventRecord(id='reply-1', network_id=workspace['id'], type='workspace.message.posted',
                        source='openagents:agent-alpha', target='channel/issue-work', timestamp=1000,
                        payload={'content': 'Fixed the issue.', 'message_type': 'chat'},
                        metadata_={'requester_email': 'Requester@acme.test'})
    db.add(reply)
    db.commit()
    return issue, channel, reply


def event(reply):
    return {'id': reply.id, 'type': reply.type, 'source': reply.source}


def test_addressed_idempotent_completion(db, workspace, completion):
    issue, channel, reply = completion
    with patch('app.services.notify._dispatch') as push:
        assert notify_issue_completion(db, workspace['id'], event(reply))
        db.commit()
        assert notify_issue_completion(db, workspace['id'], event(reply))
        db.commit()
    notifications = db.scalars(select(NotificationRecord)).all()
    assert len(notifications) == 1
    n = notifications[0]
    assert n.recipient_email == 'requester@acme.test'
    assert n.kind == 'issue_completed'
    assert n.link_url == f"/{workspace['slug']}/issues/{issue.id}"
    assert n.channel_name == channel.name
    push.assert_called_once()
    assert push.call_args.args[0]['recipient_email'] == 'requester@acme.test'
    assert db.get(Issue, issue.id).status == 'open'


@pytest.mark.parametrize('mode', ['thinking', 'tool', 'failed', 'no_requester', 'not_member', 'private', 'unlinked', 'wrong_workspace'])
def test_no_false_completions_or_private_leaks(db, workspace, completion, mode):
    issue, channel, reply = completion
    handled = mode in {'no_requester', 'not_member', 'private'}
    if mode == 'thinking': reply.payload = {'message_type': 'thinking', 'content': 'Thinking'}
    if mode == 'tool': reply.payload = {'content': 'Bash › cat file'}
    if mode == 'failed': reply.metadata_ = {**reply.metadata_, 'status_kind': 'failed'}
    if mode == 'no_requester': reply.metadata_ = {}
    if mode == 'not_member': reply.metadata_ = {'requester_email': 'stranger@acme.test'}
    if mode == 'private':
        channel.visibility = 'private'
        channel.owner_email = 'other@acme.test'
    if mode == 'unlinked': db.delete(db.get(IssueThread, (issue.id, channel.id)))
    if mode == 'wrong_workspace': reply.network_id = '00000000-0000-0000-0000-000000000000'
    db.commit()
    with patch('app.services.notify._dispatch') as push:
        # Caller-provided requester metadata must not override persisted attribution.
        assert notify_issue_completion(db, workspace['id'], {**event(reply), 'metadata': {'requester_email': 'requester@acme.test'}}) == handled
        db.commit()
    assert db.scalars(select(NotificationRecord)).all() == []
    push.assert_not_called()


def test_fanout_uses_addressed_notification_instead_of_generic_broadcast(db, workspace, completion):
    from app.services.push import _fanout_impl
    _, _, reply = completion
    with patch('app.services.push.SessionLocal', return_value=db), patch('app.services.push._workspace_agent_names') as broadcast, patch('app.services.notify._dispatch'):
        _fanout_impl(workspace['id'], event(reply))
        broadcast.assert_not_called()
    assert len(db.scalars(select(NotificationRecord)).all()) == 1


def test_issue_request_routes_completion_to_requester_through_event_pipeline(client, db, workspace):
    from unittest.mock import AsyncMock
    from tests.test_issues import create, request_work, headers
    from app.services.push import _fanout_impl
    from tests.conftest import TestingSessionLocal
    user = User(email='requester@acme.test', display_name='Requester')
    db.add(user)
    db.flush()
    db.add(WorkspaceMembership(workspace_id=workspace['id'], user_id=user.id, role='member'))
    db.commit()
    with patch('app.services.cloud_agent.invoke_cloud_agents', new_callable=AsyncMock):
        issue = create(client, workspace, source='human:owner@acme.test')
        response = request_work(client, workspace, issue, source='human:requester@acme.test')
    channel_name = response.json()['data']['channel_name']
    request = db.scalar(select(EventRecord).where(EventRecord.target == f'channel/{channel_name}', EventRecord.type == 'workspace.message.posted'))
    with patch('app.services.push.fanout_for_event') as fanout, patch('app.services.cloud_agent.invoke_cloud_agents', new_callable=AsyncMock):
        result = client.post('/v1/events', headers=headers(workspace), json={
            'network': workspace['id'], 'type': 'workspace.message.posted',
            'source': 'openagents:agent-alpha', 'target': f'channel/{channel_name}',
            'payload': {'content': 'Completed the fix.', 'message_type': 'chat'},
            'metadata': {'in_reply_to': request.id, 'requester_email': 'spoofed@acme.test'},
        })
    assert result.status_code == 200, result.text
    with patch('app.services.push.SessionLocal', TestingSessionLocal), patch('app.services.notify._dispatch'):
        _fanout_impl(*fanout.call_args.args)
    notification = db.scalar(select(NotificationRecord).where(NotificationRecord.kind == 'issue_completed'))
    assert notification.recipient_email == 'requester@acme.test'
    assert notification.link_url.endswith('/issues/' + issue['id'])
