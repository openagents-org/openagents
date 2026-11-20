"""Conversation links and isolated history for the routines workspace surfaces."""
from datetime import datetime, timezone
from uuid import uuid4
import time
from app.models import Channel, EventRecord, RoutineRecord
from tests.test_routines import _headers, _create_payload, _other_workspace


def create(client, workspace, **kwargs):
    response = client.post('/v1/routines', headers=_headers(workspace), json=_create_payload(
        workspace, interval_minutes=60, context='Check feedback; only report actionable results.', **kwargs))
    assert response.status_code == 200, response.text
    return response.json()['data']


def test_source_link_and_source_listing_preserve_background_queue(client, workspace):
    r = create(client, workspace)
    assert r['source_channel_name'] == workspace['channel']['name']
    assert r['channel_name'] == 'routines:agent-alpha'
    for channel in (r['source_channel_name'], r['channel_name']):
        response = client.get('/v1/routines', params={'network': workspace['id'], 'channel': channel}, headers=_headers(workspace))
        assert [item['id'] for item in response.json()['data']['routines']] == [r['id']]


def test_legacy_channel_hint_stays_unlinked(client, workspace):
    assert create(client, workspace, channel='old-ignored-hint')['source_channel_name'] is None


def test_explicit_source_must_be_real_conversation_in_same_workspace(client, workspace, db):
    other = _other_workspace(client)
    db.add(Channel(workspace_id=other['id'], name='other-private-thread', title='Other', created_by='agent-omega'))
    db.commit()
    create(client, workspace)
    for source in ('missing-thread', 'other-private-thread', 'routines:agent-alpha'):
        response = client.post('/v1/routines', headers=_headers(workspace), json=_create_payload(
            workspace, interval_minutes=60, source_channel=source))
        assert response.status_code == 400


def test_link_edit_keeps_schedule_and_execution_queue(client, workspace):
    r = create(client, workspace, channel='old-ignored-hint')
    response = client.patch(f"/v1/routines/{r['id']}", headers=_headers(workspace), json={
        'network': workspace['id'], 'source_channel': workspace['channel']['name'],
        'context': 'Also check Discord. Always include the launch link.',
    })
    updated = response.json()['data']
    assert response.status_code == 200
    assert updated['source_channel_name'] == workspace['channel']['name']
    assert updated['channel_name'] == r['channel_name']
    assert updated['next_fires_at'] == r['next_fires_at']
    assert updated['context'] == 'Also check Discord. Always include the launch link.'


def event(db, workspace, timestamp, source, content, routine=None, message_type='chat'):
    payload = {'content': content, 'message_type': message_type}
    if routine:
        payload.update(routine_id=routine['id'], routine_agent='agent-alpha')
    item = EventRecord(id=str(uuid4()), network_id=workspace['id'], type='workspace.message.posted',
        source=source, target='channel/routines:agent-alpha', timestamp=int(time.time() * 1000) + timestamp, payload=payload)
    db.add(item)
    db.flush()
    return item


def test_run_history_does_not_mix_routines_or_attribute_legacy_fires(client, workspace, db):
    a, b = create(client, workspace), create(client, workspace)
    event(db, workspace, 100, 'system:routine', 'Old untagged run')
    event(db, workspace, 110, 'openagents:agent-alpha', 'Legacy answer')
    event(db, workspace, 200, 'system:routine', 'First routine', a)
    event(db, workspace, 210, 'openagents:agent-alpha', 'First result')
    event(db, workspace, 300, 'system:routine', 'Second routine', b)
    event(db, workspace, 310, 'openagents:agent-alpha', 'Second result')
    event(db, workspace, 400, 'system:routine', 'First again', a)
    event(db, workspace, 410, 'openagents:agent-alpha', 'Waiting for tool', message_type='thinking')
    db.commit()
    response = client.get(f"/v1/routines/{a['id']}/runs", params={'network': workspace['id']}, headers=_headers(workspace))
    runs = response.json()['data']['runs']
    assert len(runs) == 2
    assert runs[0]['status'] == 'waiting'
    assert runs[0]['summary'] is None
    assert runs[1]['summary'] == 'First result'
    assert runs[1]['status'] == 'responded'
    record = db.get(RoutineRecord, a['id'])
    record.created_by = 'replacement-agent'
    db.commit()
    assert client.get(f"/v1/routines/{a['id']}/runs", params={'network': workspace['id']}, headers=_headers(workspace)).json()['data']['runs'][1]['summary'] == 'First result'
    latest = client.get('/v1/routines', params={'network': workspace['id']}, headers=_headers(workspace)).json()['data']['routines']
    assert next(r for r in latest if r['id'] == b['id'])['latest_run']['summary'] == 'Second result'


def test_failed_and_abandoned_runs_have_attention_status(client, workspace, db):
    r = create(client, workspace)
    event(db, workspace, 100, 'system:routine', 'No response', r)
    event(db, workspace, 200, 'system:routine', 'Retry', r)
    event(db, workspace, 210, 'openagents:agent-alpha', 'Authentication failed', message_type='error')
    db.commit()
    runs = client.get(f"/v1/routines/{r['id']}/runs", params={'network': workspace['id']}, headers=_headers(workspace)).json()['data']['runs']
    assert [run['status'] for run in runs] == ['failed', 'unanswered']


def test_run_now_queues_existing_scheduler_and_rejects_paused(client, workspace):
    r = create(client, workspace)
    response = client.post(f"/v1/routines/{r['id']}/run", params={'network': workspace['id']}, headers=_headers(workspace))
    assert response.status_code == 200, response.text
    item = client.get('/v1/routines', params={'network': workspace['id']}, headers=_headers(workspace)).json()['data']['routines'][0]
    assert datetime.fromisoformat(item['next_fires_at']) <= datetime.now(timezone.utc)
    assert item['schedule_interval_minutes'] == 60
    client.patch(f"/v1/routines/{r['id']}", headers=_headers(workspace), json={'network': workspace['id'], 'status': 'paused'})
    assert client.post(f"/v1/routines/{r['id']}/run", params={'network': workspace['id']}, headers=_headers(workspace)).status_code == 400


def test_history_and_run_now_require_matching_workspace_credentials(client, workspace):
    r = create(client, workspace)
    other = _other_workspace(client)
    for method, suffix in (('get', 'runs'), ('post', 'run')):
        call = getattr(client, method)
        assert call(f"/v1/routines/{r['id']}/{suffix}", params={'network': workspace['id']}).status_code == 401
        assert call(f"/v1/routines/{r['id']}/{suffix}", params={'network': other['id']}, headers=_headers(other)).status_code == 404


def test_scheduler_tags_new_run_and_keeps_origin_conversation_quiet(client, workspace, db, monkeypatch):
    from tests.test_routine_backoff import _run_fire_due
    from sqlalchemy import select
    r = create(client, workspace)
    db.get(RoutineRecord, r['id']).next_fires_at = datetime.now(timezone.utc)
    db.commit()
    _run_fire_due(monkeypatch)
    fires = db.execute(select(EventRecord).where(EventRecord.source == 'system:routine')).scalars().all()
    assert len(fires) == 1
    fire = fires[0]
    assert fire.target == 'channel/' + r['channel_name']
    assert fire.payload['routine_id'] == r['id']
    assert fire.payload['source_channel'] == workspace['channel']['name']
    assert 'workspace_get_history' in fire.payload['content']
    assert 'Keep ordinary check results in this background run' in fire.payload['content']


def test_unanswered_run_becomes_attention_after_scheduler_timeout(client, workspace, db):
    r = create(client, workspace)
    event(db, workspace, -31 * 60 * 1000, 'system:routine', 'No agent reply', r)
    db.commit()
    runs = client.get(f"/v1/routines/{r['id']}/runs", params={'network': workspace['id']}, headers=_headers(workspace)).json()['data']['runs']
    assert runs[0]['status'] == 'unanswered'
