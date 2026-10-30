import pytest
from sqlalchemy import select
from app.models import EventRecord, WorkspaceMember
from app.services.review_handoff import reviewer_targets, reviews_agent
from tests.test_response_mode import multi_agent_workspace, router_workspace
from tests.test_llm_router import _make_event

@pytest.fixture(autouse=True)
def enable_reviews(monkeypatch):
    from app.config import config
    monkeypatch.setattr(config, "AUTOMATIC_REVIEW_HANDOFF_ENABLED", True)


@pytest.mark.parametrize('description,expected', [
    ('帮我审核agent-master这个agent的回答，并做出必要的修改', True),
    ('Review agent-master answers for errors', True),
    ('审核 agent-master 的回答', True),
    ('Do not review agent-master', False),
    ('不要审核agent-master', False),
    ('I work with agent-master', False),
    ('Review agent-master-other', False),
])
def test_only_explicit_positive_review_duties(description, expected):
    assert reviews_agent(description, 'agent-master') is expected


def setup_review(db, setup):
    ws, ch = setup['workspace'], setup['channel']
    reviewer = db.execute(select(WorkspaceMember).where(WorkspaceMember.workspace_id == ws.id, WorkspaceMember.agent_name == 'agent-worker')).scalar_one()
    reviewer.description = '帮我审核agent-master这个agent的回答'
    root = EventRecord(id='review-root', network_id=ws.id, type='workspace.message.posted', source=f'human:{ws.creator_email}', target=f'channel/{ch.name}',
        payload={'content': 'Compare these products'}, metadata_={'target_agents': ['agent-master']}, timestamp=100)
    db.add(root); db.flush()
    event = _make_event('openagents:agent-master', f'channel/{ch.name}', 'Here is the comparison and conclusions.')
    return ws, ch, reviewer, root, event


def test_dispatch_once_and_no_review_loop(db, multi_agent_workspace):
    ws, ch, reviewer, root, event = setup_review(db, multi_agent_workspace)
    assert reviewer_targets(db, ws, ch, event) == ['agent-worker']
    assert event.metadata['review_handoff']['request_id'] == root.id
    assert reviewer_targets(db, ws, ch, event) == []
    event.source = 'openagents:agent-worker'
    assert reviewer_targets(db, ws, ch, event) == []


@pytest.mark.parametrize('case', ['passive', 'status', 'old-reply', 'greeting', 'permission'])
def test_no_unauthorized_or_unrelated_review(db, multi_agent_workspace, monkeypatch, case):
    ws, ch, reviewer, root, event = setup_review(db, multi_agent_workspace)
    if case == 'passive': ch.response_mode = 'passive'
    if case == 'status': event.payload['message_type'] = 'status'
    if case == 'old-reply': event.metadata['in_reply_to'] = 'old-human-request'
    if case == 'greeting': root.payload = {'content': 'Hi!'}
    if case == 'permission': monkeypatch.setattr('app.services.review_handoff.request_access', lambda *args: 'approval')
    assert reviewer_targets(db, ws, ch, event) == []
    if case == 'permission': assert event.metadata['review_handoff']['blocked'] == ['agent-worker']


def test_thread_review_role_overrides_global_description(db, multi_agent_workspace, monkeypatch):
    from app.config import config
    from app.services.thread_collaboration import save
    monkeypatch.setattr(config, 'THREAD_COLLABORATION_ENABLED', True)
    ws, ch, reviewer, root, event = setup_review(db, multi_agent_workspace)
    save(db, ws.id, ch.name, reviewer.agent_name, 'Research only in this thread', None, ws.creator_email)
    db.flush()
    assert reviewer_targets(db, ws, ch, event) == []
    save(db, ws.id, ch.name, reviewer.agent_name, 'Review citations', 'agent-master', ws.creator_email)
    db.flush()
    assert reviewer_targets(db, ws, ch, event) == ['agent-worker']
