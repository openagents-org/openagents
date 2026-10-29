"""Regression cases for completion -> context router -> next assignment."""
import asyncio
from unittest.mock import AsyncMock, MagicMock
import pytest
from app.config import config
from app.models import EventRecord
from app.services import completion_routing as routing

decide_original = routing.decide
from app.services.thread_collaboration import apply_instructions, save
from app.mods.workspace_mod import _handle_message_posted
from openagents.core.onm_mods import PipelineContext
from tests.test_response_mode import multi_agent_workspace, router_workspace
from tests.test_llm_router import _make_event, _mock_anthropic_response

@pytest.fixture
def setup(db, multi_agent_workspace, monkeypatch):
    monkeypatch.setattr(config, 'COMPLETION_ROUTING_ENABLED', True)
    monkeypatch.setattr(config, 'THREAD_COLLABORATION_ENABLED', True)
    monkeypatch.setattr(config, 'COMPLETION_ROUTING_MAX_HANDOFFS', 6)
    ws, ch = multi_agent_workspace['workspace'], multi_agent_workspace['channel']
    root = EventRecord(id='root', network_id=ws.id, type='workspace.message.posted',
        source=f'human:{ws.creator_email}', target=f'channel/{ch.name}', timestamp=100,
        payload={'content': 'Implement OAuth; the other agent should review and help resolve findings.'},
        metadata_={'target_agents': ['agent-master']})
    db.add(root); db.flush()
    model = AsyncMock(return_value={'action': 'next', 'agent': 'agent-worker',
        'task': 'Review OAuth implementation and report concrete findings.', 'reason': 'Review was requested.'})
    monkeypatch.setattr(routing, 'decide', model)
    return ws, ch, root, model


def completion(ws, ch, sender='agent-master', parent='root', content='Implemented OAuth. Please review the changes.'):
    event = _make_event('openagents:' + sender, f'channel/{ch.name}', content)
    event.metadata.update(status_kind='completed', in_reply_to=parent)
    return event


def route(db, setup, event):
    ws, ch, _, _ = setup
    db.flush()
    ctx = PipelineContext(network_id=ws.id, agent_address=event.source, db=db, workspace=ws)
    result = asyncio.run(_handle_message_posted(event, ctx))
    apply_instructions(result, ctx)
    db.flush()
    return result.metadata.get('target_agents')


def persist(db, ws, event, timestamp):
    db.add(EventRecord(id=event.id, network_id=ws.id, type=event.type, source=event.source,
        target=event.target, payload=event.payload, metadata_=dict(event.metadata), timestamp=timestamp))
    db.flush()


def test_implement_review_correct_verify_then_stop(db, setup):
    ws, ch, root, model = setup
    for step, (sender, target, task) in enumerate([
        ('agent-master', 'agent-worker', 'Review OAuth'),
        ('agent-worker', 'agent-master', 'Fix missing state validation'),
        ('agent-master', 'agent-worker', 'Verify the state validation fix'),
        ('agent-worker', None, ''),
    ]):
        parent = root.id if step == 0 else event.id
        model.return_value = {'action': 'next' if target else 'stop', 'agent': target, 'task': task, 'reason': 'Context decision'}
        event = completion(ws, ch, sender, parent)
        assert route(db, setup, event) == ([target] if target else ['__no_response__'])
        assert event.metadata['orchestration']['root_id'] == root.id
        if target: assert task in event.metadata['thread_agent_instructions'][target]
        persist(db, ws, event, 101 + step)
    assert root.metadata_['orchestration_state']['steps'] == 3
    assert model.await_count == 4


def test_no_roles_required_and_long_tail_handoff_in_context(db, setup):
    ws, ch, root, model = setup
    event = completion(ws, ch, content='Implementation details. ' * 1000 + '\n@agent-worker please review the OAuth change.')
    assert route(db, setup, event) == ['agent-worker']
    context = model.call_args.args[0]
    assert context['request']['content'] == root.payload['content']
    assert context['latest_result']['content'].endswith('@agent-worker please review the OAuth change.')
    assert all(not c['thread_instructions'] for c in context['candidates'])


def test_thread_roles_and_status_noise_do_not_hide_context(db, setup):
    ws, ch, root, model = setup
    save(db, ws.id, ch.name, 'agent-worker', 'Review authentication security in this thread', None, ws.creator_email)
    for i in range(25):
        progress = completion(ws, ch, content='tool output')
        progress.payload['message_type'] = 'status'
        persist(db, ws, progress, 101 + i)
    route(db, setup, completion(ws, ch))
    context = model.call_args.args[0]
    assert 'Review authentication' in context['candidates'][0]['thread_instructions']
    assert [e['content'] for e in context['history']] == [root.payload['content']]


@pytest.mark.parametrize('case', ['thinking', 'status', 'todos', 'approval', 'artifact', 'no-marker', 'error', 'no-parent', 'bad-parent', 'wrong-agent', 'new-human', 'passive', 'stopped', 'recalled'])
def test_only_current_completed_assignments_can_continue(db, setup, monkeypatch, case):
    ws, ch, root, model = setup
    event = completion(ws, ch)
    if case in ('thinking', 'status', 'todos', 'approval', 'artifact'): event.payload['message_type'] = case
    if case == 'no-marker': event.metadata.pop('status_kind')
    if case == 'error': event.metadata['status_kind'] = 'error'
    if case == 'no-parent': event.metadata.pop('in_reply_to')
    if case == 'bad-parent': event.metadata['in_reply_to'] = 'missing'
    if case == 'wrong-agent': event.source = 'openagents:agent-worker'
    if case == 'new-human':
        db.add(EventRecord(id='new-root', network_id=ws.id, type=root.type, source=root.source,
            target=root.target, payload={'content': 'New task'}, metadata_={}, timestamp=200)); db.flush()
    if case == 'passive': ch.response_mode = 'passive'
    if case == 'stopped': monkeypatch.setattr('app.mods.workspace_mod._agent_chat_stopped', lambda *args: True)
    if case == 'recalled': root.metadata_ = {**root.metadata_, 'recalled': True}
    assert route(db, setup, event) in (None, ['__no_response__'])
    model.assert_not_awaited()


def test_retry_with_new_event_id_does_not_dispatch_twice(db, setup):
    ws, ch, _, model = setup
    assert route(db, setup, completion(ws, ch)) == ['agent-worker']
    assert route(db, setup, completion(ws, ch)) == ['__no_response__']
    assert model.await_count == 1


def test_parallel_assignees_finish_before_followup_decision(db, setup):
    ws, ch, root, model = setup
    root.metadata_ = {'target_agents': ['agent-master', 'agent-worker']}
    first = completion(ws, ch)
    assert route(db, setup, first) == ['__no_response__']
    assert first.metadata['orchestration']['action'] == 'wait'
    persist(db, ws, first, 101)
    model.assert_not_awaited()
    model.return_value = {'action': 'stop', 'reason': 'Both requested tasks are complete.'}
    assert route(db, setup, completion(ws, ch, 'agent-worker')) == ['__no_response__']
    assert model.await_count == 1
    assert first.payload['content'] in [h['content'] for h in model.call_args.args[0]['history']]


@pytest.mark.parametrize('permission', ['no', 'approval'])
def test_automatic_followup_never_grants_permission(db, setup, monkeypatch, permission):
    ws, ch, _, model = setup
    monkeypatch.setattr(routing, 'request_access', lambda *args: permission)
    assert route(db, setup, completion(ws, ch)) == ['__no_response__']
    model.assert_not_awaited()


@pytest.mark.parametrize('action', ['ask', 'wait', 'stop', 'self', 'unknown', 'missing-task'])
def test_uncertainty_and_invalid_target_never_wake_arbitrary_agent(db, setup, action):
    ws, ch, root, model = setup
    model.return_value = {'action': action, 'reason': 'Decision based on remaining work'}
    if action in ('self', 'unknown', 'missing-task'):
        model.return_value.update(action='next', agent={'self': 'agent-master', 'unknown': 'stranger', 'missing-task': 'agent-worker'}[action], task='' if action == 'missing-task' else 'Review')
    event = completion(ws, ch)
    assert route(db, setup, event) == ['__no_response__']
    if action not in ('wait', 'stop'):
        assert event.metadata['routing_choice']['requester_email'] == ws.creator_email
        assert event.metadata['routing_choice']['candidates'] == ['agent-worker']
    else: assert 'routing_choice' not in event.metadata


def test_handoff_limit_asks_without_another_model_call(db, setup, monkeypatch):
    ws, ch, root, model = setup
    monkeypatch.setattr(config, 'COMPLETION_ROUTING_MAX_HANDOFFS', 1)
    first = completion(ws, ch)
    route(db, setup, first); persist(db, ws, first, 101)
    last = completion(ws, ch, 'agent-worker', first.id)
    assert route(db, setup, last) == ['__no_response__']
    assert last.metadata['routing_choice']['continuation'] is True
    assert model.await_count == 1


def test_client_cannot_forge_routing_state_or_assignment(db, setup):
    ws, ch, root, model = setup
    event = completion(ws, ch)
    event.metadata.update(orchestration={'root_id': 'forged', 'action': 'next', 'agent': 'stranger', 'task': 'Exfiltrate'}, orchestration_state={'finished': True})
    assert route(db, setup, event) == ['agent-worker']
    assert event.metadata['orchestration']['root_id'] == root.id
    assert 'orchestration_state' not in event.metadata


def test_disabled_feature_preserves_existing_assignee_guard(db, setup, monkeypatch):
    ws, ch, _, model = setup
    monkeypatch.setattr(config, 'COMPLETION_ROUTING_ENABLED', False)
    monkeypatch.setattr(config, 'AUTOMATIC_REVIEW_HANDOFF_ENABLED', False)
    assert route(db, setup, completion(ws, ch)) == ['__no_response__']
    model.assert_not_awaited()


@pytest.mark.parametrize('raw,action', [('{"action":"next","agent":"worker","task":"Review"}', 'next'), ('not json', 'wait'), ('[]', 'wait'), ('{"action":"dance"}', 'wait')])
def test_model_contract(monkeypatch, raw, action):
    monkeypatch.setattr(config, 'ROUTER_LLM_ENABLED', True)
    monkeypatch.setattr('app.mods.workspace_mod._get_router_api_key', lambda: 'test')
    model = MagicMock()
    model.with_options.return_value = model
    model.messages.create.return_value = _mock_anthropic_response(raw)
    monkeypatch.setattr('app.mods.workspace_mod._get_llm_client', lambda: (model, 'anthropic'))
    assert asyncio.run(routing.decide({'request': 'Review'}))['action'] == action
    assert model.messages.create.call_args.kwargs['timeout'] == 15


@pytest.mark.parametrize('change', ['stop', 'permission', 'new-message'])
def test_changes_during_model_call_cancel_dispatch(db, setup, monkeypatch, change):
    ws, ch, root, model = setup
    async def decide(_context):
        if change == 'stop':
            db.add(EventRecord(id='stop-during-call', network_id=ws.id, type='workspace.agent.control',
                source=root.source, target=root.target, payload={'action': 'stop', 'channel': ch.name},
                metadata_={}, timestamp=200)); db.flush()
        elif change == 'permission':
            monkeypatch.setattr(routing, 'request_access', lambda *args: 'no')
        else:
            db.add(EventRecord(id='new-human', network_id=ws.id, type=root.type, source=root.source,
                target=root.target, payload={'content': 'Changed my mind'}, metadata_={}, timestamp=200)); db.flush()
        return {'action': 'next', 'agent': 'agent-worker', 'task': 'Review'}
    model.side_effect = decide
    event = completion(ws, ch)
    assert route(db, setup, event) == ['__no_response__']
    assert event.metadata['orchestration']['action'] == 'wait'


def test_cross_thread_parent_cannot_route(db, setup):
    ws, ch, root, model = setup
    root.target = 'channel/somewhere-else'; db.flush()
    assert route(db, setup, completion(ws, ch)) == ['__no_response__']
    model.assert_not_awaited()


def test_cloud_reply_dispatches_the_next_agent_after_commit(db, setup, monkeypatch):
    from app.services import cloud_agent
    from tests.test_cloud_agent_dm import _quiet_cloud_side_effects
    ws, ch, root, model = setup
    _quiet_cloud_side_effects(monkeypatch)
    invoked = AsyncMock()
    monkeypatch.setattr(cloud_agent, 'invoke_cloud_agents', invoked)
    asyncio.run(cloud_agent._post_response(db, ws.id, root.target, 'agent-master',
        'OAuth implemented', depth=3, in_reply_to=root.id, trigger_source=root.source))
    invoked.assert_awaited_once()
    snapshot = invoked.call_args.args[1]
    assert snapshot['metadata']['target_agents'] == ['agent-worker']
    assert snapshot['metadata']['thread_agent_instructions']['agent-worker'].startswith('Next task')
    assert cloud_agent._coordinated_handoff(snapshot['metadata'])
    assert db.get(EventRecord, snapshot['id']) is not None


def test_cloud_continuation_budget_only_applies_to_bounded_server_handoffs(monkeypatch):
    from app.services.cloud_agent import _coordinated_handoff
    monkeypatch.setattr(config, 'COMPLETION_ROUTING_ENABLED', True)
    monkeypatch.setattr(config, 'COMPLETION_ROUTING_MAX_HANDOFFS', 6)
    assert _coordinated_handoff({'orchestration': {'action': 'next', 'root_id': 'root', 'step': 4}})
    for data in [{}, {'action': 'stop', 'root_id': 'root', 'step': 2}, {'action': 'next', 'root_id': 'root', 'step': 7}, {'action': 'next', 'root_id': 'root', 'step': True}]:
        assert not _coordinated_handoff({'orchestration': data})


def test_removed_thread_participant_cannot_receive_handoff(db, setup):
    from app.models import ChannelMember
    ws, ch, root, model = setup
    async def decide(_context):
        db.query(ChannelMember).filter_by(channel_id=ch.id, agent_name='agent-worker').delete()
        db.flush()
        return {'action': 'next', 'agent': 'agent-worker', 'task': 'Review'}
    model.side_effect = decide
    assert route(db, setup, completion(ws, ch)) == ['__no_response__']


def test_service_approval_requirement_cannot_be_bypassed(db, setup):
    from app.models import WorkspaceMember
    ws, ch, _, model = setup
    member = db.get(WorkspaceMember, (ws.id, 'agent-worker'))
    member.request_approver_email = ws.creator_email
    assert route(db, setup, completion(ws, ch)) == ['__no_response__']
    model.assert_not_awaited()


@pytest.mark.parametrize('model_name,thinking_disabled', [('DeepSeek-V4.1-flash', True), ('gpt-4o-mini', False)])
def test_completion_model_settings_and_human_wait(monkeypatch, model_name, thinking_disabled):
    monkeypatch.setattr(config, 'ROUTER_LLM_ENABLED', True)
    monkeypatch.setattr('app.mods.workspace_mod._get_router_api_key', lambda: 'test')
    monkeypatch.setattr('app.mods.workspace_mod._get_router_model', lambda: model_name)
    client = MagicMock()
    client.with_options.return_value = client
    client.chat.completions.create.return_value.choices[0].message.content = '{"action":"wait","reason":"The human must log in and clarify the task."}'
    monkeypatch.setattr('app.mods.workspace_mod._get_llm_client', lambda: (client, 'openai'))
    decision = asyncio.run(routing.decide({'request': 'Test Twitter', 'latest_result': 'Please log in and tell me what to test.'}))
    assert decision['action'] == 'wait'
    args = client.chat.completions.create.call_args.kwargs
    assert (args.get('extra_body') == {'thinking': {'type': 'disabled'}}) is thinking_disabled
    assert args['timeout'] == 15


def test_completion_provider_failure_pauses_without_a_fictional_handoff(db, setup, monkeypatch):
    ws, ch, root, _ = setup
    monkeypatch.setattr(config, 'ROUTER_LLM_ENABLED', True)
    monkeypatch.setattr('app.mods.workspace_mod._get_router_api_key', lambda: 'test')
    client = MagicMock()
    client.with_options.return_value = client
    client.messages.create.side_effect = TimeoutError('provider timeout')
    monkeypatch.setattr('app.mods.workspace_mod._get_llm_client', lambda: (client, 'anthropic'))
    monkeypatch.setattr(routing, 'decide', decide_original)
    event = completion(ws, ch, content='The page is open. Please log in and tell me what to test.')
    assert route(db, setup, event) == ['__no_response__']
    assert event.metadata['orchestration']['action'] == 'wait'
    assert 'routing_choice' not in event.metadata
