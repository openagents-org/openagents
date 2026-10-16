"""Thread-local collaboration settings, stored as an auditable settings event.

Uses the existing events table and index; no migration or workspace-agent edits.
Only this service's authorized endpoint writes these records.
"""
import time
import uuid
from sqlalchemy import select, func
from app.models import EventRecord

EVENT_TYPE = 'workspace.thread.collaboration.updated'


def settings(db, workspace_id, channel_name):
    event = db.execute(select(EventRecord).where(EventRecord.network_id == str(workspace_id),
        EventRecord.target == f'channel/{channel_name}', EventRecord.type == EVENT_TYPE)
        .order_by(EventRecord.timestamp.desc(), EventRecord.id.desc()).limit(1)).scalar_one_or_none()
    return dict((event.payload or {}).get('agents') or {}) if event else {}


def save(db, workspace_id, channel_name, agent, instructions, review_after, actor):
    latest = db.scalar(select(func.max(EventRecord.timestamp)).where(EventRecord.network_id == str(workspace_id), EventRecord.target == f"channel/{channel_name}", EventRecord.type == EVENT_TYPE)) or 0
    timestamp = max(time.time_ns() // 1_000_000, latest + 1)
    value = settings(db, workspace_id, channel_name)
    value[agent] = {'instructions': instructions, 'review_after': review_after}
    db.add(EventRecord(id=str(uuid.uuid4()), network_id=str(workspace_id), type=EVENT_TYPE,
        source=f'human:{actor}', target=f'channel/{channel_name}', visibility='channel',
        payload={'agents': value}, metadata_={'target_agents': ['__no_response__']}, timestamp=timestamp))
    return value


def instruction_blocks(db, workspace_id, channel_name, targets):
    values = settings(db, workspace_id, channel_name)
    result = {}
    for agent in targets:
        setting = values.get(agent) or {}
        text = str(setting.get('instructions') or '').strip()
        review_after = setting.get('review_after')
        if review_after:
            text += f'\nReview outputs from {review_after}. Report findings and required corrections in this thread.'
        if text.strip():
            result[agent] = text.strip()
    return result


def apply_instructions(event, context):
    from app.config import config
    if event is None or event.type != 'workspace.message.posted':
        return
    event.metadata.pop('thread_agent_instructions', None)
    if not (event.target or '').startswith('channel/'):
        return
    targets = event.metadata.get('target_agents') or []
    if targets:
        blocks = instruction_blocks(context.extra['db'], context.extra['workspace'].id,
            event.target[len('channel/'):], targets) if config.THREAD_COLLABORATION_ENABLED else {}
        handoff = event.metadata.get('orchestration') or {}
        if handoff.get('action') == 'next' and handoff.get('agent') in targets:
            name = handoff['agent']
            blocks[name] = (blocks.get(name, '') + '\nNext task for this request: ' + handoff['task']).strip()
        event.metadata['thread_agent_instructions'] = blocks
