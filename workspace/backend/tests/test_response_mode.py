"""Thread response policy: no implicit agent runs for human conversation."""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from app.config import config
from app.models import Channel, ChannelHumanMember, ChannelMember, WorkspaceCollaborator
from app.mods.workspace_mod import _conversation_targets, _handle_message_posted, _route_with_llm
from openagents.core.onm_mods import PipelineContext
from tests.test_llm_router import multi_agent_workspace as router_workspace, _make_event, _mock_anthropic_response, _run


@pytest.fixture
def multi_agent_workspace(router_workspace, db):
    # Routing fixtures use an identified owner now that agents are private by default.
    from app.models import WorkspaceMember
    ws = router_workspace['workspace']
    ws.creator_email = 'router-owner@example.com'
    for agent in db.query(WorkspaceMember).filter_by(workspace_id=ws.id):
        agent.owner_email = ws.creator_email
    db.flush()
    return router_workspace


@pytest.fixture(autouse=True)
def isolated_router(monkeypatch):
    # Tests never call a live model or title generator.
    monkeypatch.setattr(config, 'ROUTER_LLM_ENABLED', True)
    monkeypatch.setattr('app.mods.workspace_mod._get_router_api_key', lambda: 'test-key')
    monkeypatch.setattr('app.mods.workspace_mod._auto_title_channel', lambda *args: None)


def route(db, setup, content, source='human:user'):
    ws, ch = setup['workspace'], setup['channel']
    event = _make_event(source, f'channel/{ch.name}', content)
    if source.startswith('human:'):
        event.payload['sender_email'] = ws.creator_email
    ctx = PipelineContext(network_id=str(ws.id), agent_address=source, db=db, workspace=ws)
    return _run(_handle_message_posted(event, ctx)).metadata['target_agents']


@pytest.mark.parametrize('content,expected', [
    ('Sam, are you still there?', ['__no_response__']),
    ('Can you ask @agent-worker?', ['__no_response__']),
    ('@agent-worker please check', ['agent-worker']),
    ('  \n@agent-master hi', ['agent-master']),
    ('@agent-worker@example.com hello', ['__no_response__']),
    ('@agent-worker-extra hi', ['__no_response__']),
    ('`@agent-worker` is mentioned in the docs', ['__no_response__']),
    ('@sam@example.com can you review?', ['__no_response__']),
])
def test_passive_requires_leading_agent(db, multi_agent_workspace, content, expected):
    multi_agent_workspace['channel'].response_mode = 'passive'
    with patch('app.mods.workspace_mod._route_with_llm', new_callable=AsyncMock) as router:
        assert route(db, multi_agent_workspace, content) == expected
        router.assert_not_called()


def test_passive_agent_reply_does_not_start_a_loop(db, multi_agent_workspace):
    multi_agent_workspace['channel'].response_mode = 'passive'
    assert route(db, multi_agent_workspace, 'Done', 'openagents:agent-worker') == ['__no_response__']
    assert route(db, multi_agent_workspace, '@agent-master review this', 'openagents:agent-worker') == ['agent-master']
    assert route(db, multi_agent_workspace, '@agent-worker self', 'openagents:agent-worker') == ['__no_response__']


@pytest.mark.parametrize('decision,expected', [('stop', []), ('next:unknown', []), ('nonsense', []), ('next:agent-worker', ['agent-worker'])])
def test_proactive_model_decision_is_respected(db, multi_agent_workspace, decision, expected):
    ch, ws = multi_agent_workspace['channel'], multi_agent_workspace['workspace']
    db.add(ChannelHumanMember(channel_id=ch.id, user_email='sam@example.com'))
    db.add(WorkspaceCollaborator(workspace_id=ws.id, email='sam@example.com', display_name='Sam Weber'))
    db.flush()
    model = MagicMock()
    model.messages.create.return_value = _mock_anthropic_response(decision)
    event = _make_event('human:user', f'channel/{ch.name}', 'Sam, are you still there?')
    with patch('app.mods.workspace_mod._get_llm_client', return_value=(model, 'anthropic')):
        assert _run(_route_with_llm(ch, event, db, ws, allow_human_stop=True)) == expected
    prompt = model.messages.create.call_args.kwargs['messages'][0]['content']
    assert 'Sam Weber (sam@example.com)' in prompt
    assert 'Always pick exactly one agent' not in prompt


def test_proactive_router_error_does_not_wake_fallback(db, multi_agent_workspace):
    model = MagicMock()
    model.messages.create.side_effect = TimeoutError('router unavailable')
    with patch('app.mods.workspace_mod._get_llm_client', return_value=(model, 'anthropic')):
        assert route(db, multi_agent_workspace, 'Sam, are you still there?') == ['__no_response__']


@pytest.mark.parametrize('single', [False, True])
def test_proactive_classifies_single_and_multi_agent_threads(db, multi_agent_workspace, single):
    ch = multi_agent_workspace['channel']
    db.add(ChannelHumanMember(channel_id=ch.id, user_email='sam@example.com'))
    db.flush()
    if single:
        db.query(ChannelMember).filter_by(channel_id=ch.id, agent_name='agent-worker').delete()
        db.expire(ch, ['participants'])
    with patch('app.mods.workspace_mod._route_with_llm', new_callable=AsyncMock, return_value=[]) as router:
        assert route(db, multi_agent_workspace, 'Sam, are you there?') == ['__no_response__']
        assert router.call_args.kwargs['allow_human_stop'] is True
    with patch('app.mods.workspace_mod._route_with_llm', new_callable=AsyncMock, return_value=['agent-master']):
        assert route(db, multi_agent_workspace, 'Can you investigate the drop?') == ['agent-master']


def test_proactive_explicit_address_works_without_model(db, multi_agent_workspace, monkeypatch):
    monkeypatch.setattr(config, 'ROUTER_LLM_ENABLED', False)
    assert route(db, multi_agent_workspace, 'Hi everyone') == ['__no_response__']
    assert route(db, multi_agent_workspace, '@agent-worker hi') == ['agent-worker']


@pytest.mark.parametrize('mode', ['proactive', 'passive'])
def test_direct_agent_messages_keep_normal_behavior(db, multi_agent_workspace, mode):
    ws, ch = multi_agent_workspace['workspace'], multi_agent_workspace['channel']
    ch.response_mode = mode
    event = _make_event('human:user', 'openagents:agent-worker', 'hi')
    ctx = PipelineContext(network_id=str(ws.id), agent_address='human:user', db=db, workspace=ws)
    assert _run(_handle_message_posted(event, ctx)).metadata['target_agents'] == ['agent-worker']


@pytest.mark.parametrize('prefix', ['task:', 'routines:', 'routine:', 'dm:'])
def test_job_streams_are_not_conversation_gated(db, multi_agent_workspace, prefix):
    ch, ws = multi_agent_workspace['channel'], multi_agent_workspace['workspace']
    ch.name = prefix + 'test'
    ch.response_mode = 'passive'
    assert _run(_conversation_targets(_make_event('human:user', f'channel/{ch.name}', 'continue'), ch, db, ws, ['agent-master'])) is None


def test_response_mode_api_round_trip(client, workspace):
    url = f"/v1/workspaces/{workspace['id']}/channels/{workspace['channel']['name']}"
    headers = {'X-Workspace-Token': workspace['token']}
    assert workspace['channel']['responseMode'] == 'proactive'
    for mode in ['passive', 'proactive']:
        result = client.patch(url, headers=headers, json={'response_mode': mode})
        assert result.status_code == 200, result.text
        assert result.json()['data']['responseMode'] == mode
        assert client.get(url, headers=headers).json()['data']['responseMode'] == mode
    assert client.patch(url, headers=headers, json={'response_mode': 'bad'}).status_code == 400


def test_passive_overrides_master_for_explicit_recipient(db, multi_agent_workspace):
    ch = multi_agent_workspace['channel']
    ch.response_mode = 'passive'
    ch.orchestration_mode = 'master'
    assert route(db, multi_agent_workspace, '@agent-worker help') == ['agent-worker']
    assert route(db, multi_agent_workspace, '@agent-master @agent-worker help') == ['agent-master', 'agent-worker']


def test_proactive_nonleading_mention_routes_directly(db, multi_agent_workspace):
    with patch('app.mods.workspace_mod._route_with_llm', new_callable=AsyncMock, return_value=[]) as router:
        assert route(db, multi_agent_workspace, 'Please ask @agent-worker to review this') == ['agent-worker']
        router.assert_not_called()


@pytest.mark.parametrize('stored_mode', ['dynamic', 'master'])
@pytest.mark.parametrize('response_mode', ['proactive', 'passive'])
def test_stale_workflow_cannot_override_selected_conversation_mode(db, multi_agent_workspace, stored_mode, response_mode):
    from app.models import WorkflowRun
    from app.services.workflow import run_advance
    ch, ws = multi_agent_workspace['channel'], multi_agent_workspace['workspace']
    ch.orchestration_mode = stored_mode
    ch.response_mode = response_mode
    ch.workflow_id = 'old-workflow'
    run = WorkflowRun(workspace_id=str(ws.id), channel_name=ch.name, workflow_id='old-workflow',
                      snapshot={'steps': [{'id': 'review', 'instruction': 'Approve deployment',
                                           'assignee': {'kind': 'human'}}]},
                      current_step='review', status='running')
    db.add(run)
    db.flush()
    with patch('app.mods.workspace_mod._route_with_llm', new_callable=AsyncMock, return_value=[]) as router:
        assert route(db, multi_agent_workspace, 'Maya can you take this up') == ['__no_response__']
        if response_mode == 'proactive':
            router.assert_awaited_once()
        else:
            router.assert_not_called()
    # The independent workflow hook must also be inert, even if a completion
    # classifier would consider this message sufficient to advance.
    with patch('app.services.workflow._judge', return_value='done') as judge:
        assert run_advance(db, str(ws.id), {
            'target': f'channel/{ch.name}', 'source': 'human:user',
            'payload': {'content': 'Approved'},
        }) is False
        judge.assert_not_called()
    assert run.status == 'running'
    assert route(db, multi_agent_workspace, '@agent-worker help') == ['agent-worker']


@pytest.mark.parametrize('initial_mode', ['master', 'dynamic', 'workflow'])
@pytest.mark.parametrize('response_mode', ['proactive', 'passive'])
def test_selecting_conversation_mode_cancels_stale_runs(client, workspace, db, initial_mode, response_mode):
    from app.models import WorkflowRun
    ch = db.query(Channel).filter_by(workspace_id=workspace['id'], name=workspace['channel']['name']).one()
    ch.orchestration_mode = initial_mode
    ch.workflow_id = 'old-workflow'
    for status in ['running', 'paused']:
        db.add(WorkflowRun(workspace_id=workspace['id'], channel_name=ch.name, workflow_id='old-workflow',
                           snapshot={'steps': []}, current_step='review', status=status))
    db.commit()
    result = client.patch(f"/v1/workspaces/{workspace['id']}/channels/{ch.name}",
                          headers={'X-Workspace-Token': workspace['token']},
                          json={'response_mode': response_mode})
    assert result.status_code == 200, result.text
    assert result.json()['data']['orchestrationMode'] == 'dynamic'
    assert result.json()['data']['workflowId'] is None
    db.expire_all()
    assert {r.status for r in db.query(WorkflowRun).filter_by(workspace_id=workspace['id'], channel_name=ch.name)} == {'cancelled'}


def test_explicit_workflow_selection_still_routes_its_step(db, multi_agent_workspace):
    from app.models import WorkflowRun
    ch, ws = multi_agent_workspace['channel'], multi_agent_workspace['workspace']
    ch.orchestration_mode = 'workflow'
    ch.workflow_id = 'selected-workflow'
    db.add(WorkflowRun(workspace_id=str(ws.id), channel_name=ch.name, workflow_id=ch.workflow_id,
                       snapshot={'steps': [{'id': 'work', 'assignee': {'kind': 'agent', 'agent': 'agent-worker'}}]},
                       current_step='work', status='running'))
    db.flush()
    assert route(db, multi_agent_workspace, 'Perform current step', 'system:workflow') == ['agent-worker']

@pytest.mark.parametrize('mode', ['proactive', 'passive'])
def test_all_never_invokes_agent_router(db, multi_agent_workspace, mode):
    multi_agent_workspace['channel'].response_mode = mode
    with patch('app.mods.workspace_mod._route_with_llm', new_callable=AsyncMock) as router:
        assert route(db, multi_agent_workspace, '@All please review') == ['__no_response__']
        router.assert_not_called()


def test_one_human_one_agent_bypasses_router_even_when_offline(db, multi_agent_workspace):
    ch = multi_agent_workspace['channel']
    db.query(ChannelMember).filter_by(channel_id=ch.id, agent_name='agent-worker').delete()
    db.expire(ch, ['participants'])
    with patch('app.mods.workspace_mod._route_with_llm', new_callable=AsyncMock) as router:
        assert route(db, multi_agent_workspace, 'Please help me') == ['agent-master']
        router.assert_not_called()


def test_no_agents_bypasses_router(db, multi_agent_workspace):
    ch = multi_agent_workspace['channel']
    db.query(ChannelMember).filter_by(channel_id=ch.id).delete()
    db.expire(ch, ['participants'])
    with patch('app.mods.workspace_mod._route_with_llm', new_callable=AsyncMock) as router:
        assert route(db, multi_agent_workspace, 'Hello team') == ['__no_response__']
        router.assert_not_called()


@pytest.mark.parametrize('decision', ['ask', 'bad answer', 'next:unknown', 'stop'])
@pytest.mark.parametrize('multiple_people', [True, False])
def test_uncertainty_prompts_sender_but_clear_group_conversation_does_not(db, multi_agent_workspace, decision, multiple_people):
    ch, ws = multi_agent_workspace['channel'], multi_agent_workspace['workspace']
    if multiple_people:
        db.add(ChannelHumanMember(channel_id=ch.id, user_email='sam@example.com'))
        db.flush()
    event = _make_event('human:user', f'channel/{ch.name}', 'I want to publish a blog')
    event.payload['sender_email'] = ws.creator_email
    model = MagicMock()
    model.messages.create.return_value = _mock_anthropic_response(decision)
    ctx = PipelineContext(network_id=str(ws.id), agent_address=event.source, db=db, workspace=ws)
    with patch('app.mods.workspace_mod._get_llm_client', return_value=(model, 'anthropic')):
        result = _run(_handle_message_posted(event, ctx))
    assert result.metadata['target_agents'] == ['__no_response__']
    if decision == 'stop' and multiple_people:
        assert 'routing_choice' not in result.metadata
    else:
        choice = result.metadata['routing_choice']
        assert choice['status'] == 'pending'
        assert choice['requester_email'] == ws.creator_email
        assert set(choice['candidates']) == {'agent-master', 'agent-worker'}


def test_router_unavailable_produces_a_choice(db, multi_agent_workspace, monkeypatch):
    ch, ws = multi_agent_workspace['channel'], multi_agent_workspace['workspace']
    monkeypatch.setattr(config, 'ROUTER_LLM_ENABLED', False)
    event = _make_event('human:user', f'channel/{ch.name}', 'Need help')
    event.payload['sender_email'] = ws.creator_email
    ctx = PipelineContext(network_id=str(ws.id), agent_address=event.source, db=db, workspace=ws)
    assert _run(_handle_message_posted(event, ctx)).metadata['routing_choice']['status'] == 'pending'


@pytest.mark.parametrize('manual', [True, False])
@pytest.mark.parametrize('router_enabled', [True, False])
def test_assigned_agent_reply_does_not_wake_a_bystander(db, multi_agent_workspace, monkeypatch, manual, router_enabled):
    from app.models import EventRecord
    ws, ch = multi_agent_workspace['workspace'], multi_agent_workspace['channel']
    metadata = {'target_agents': ['agent-master']}
    if manual:
        metadata['routing_assignment'] = {'agent': 'agent-master', 'message_id': 'original'}
    db.add(EventRecord(id='assigned-human', network_id=ws.id, type='workspace.message.posted',
        source='human:user', target=f'channel/{ch.name}', payload={'content': 'hi'},
        metadata_=metadata, timestamp=100))
    db.flush()
    monkeypatch.setattr(config, 'ROUTER_LLM_ENABLED', router_enabled)
    with patch('app.mods.workspace_mod._route_with_llm', new_callable=AsyncMock, return_value=['agent-worker']) as router:
        assert route(db, multi_agent_workspace, 'Hi. What would you like to work on?', 'openagents:agent-master') == ['__no_response__']
        router.assert_not_called()
        assert route(db, multi_agent_workspace, '@agent-worker please review this', 'openagents:agent-master') == ['agent-worker']
        router.assert_not_called()
    # A new human request replaces the previous assignment; no permanent lock.
    db.add(EventRecord(id='new-human', network_id=ws.id, type='workspace.message.posted',
        source='human:user', target=f'channel/{ch.name}', payload={'content': 'Collaborate'},
        metadata_={'target_agents': ['agent-master', 'agent-worker']}, timestamp=200))
    db.flush()
    from app.mods.workspace_mod import _human_request_has_assignee
    assert not _human_request_has_assignee(db, ws, ch)
