"""Resolve reply citations from stored messages, never client-supplied excerpts."""
from sqlalchemy import select
from openagents.core.onm_mods import EventRejected
from app.models import EventRecord
from app.services.people_notify import dm_session_id


def attach_reply(event, db, workspace, channel=None):
    event.metadata.pop('reply_to', None)
    reference = (event.payload or {}).get('reply_to')
    if not reference:
        return
    if not isinstance(reference, str):
        raise EventRejected('workspace_mod', 'invalid_reply')
    original = db.execute(select(EventRecord).where(
        EventRecord.id == reference, EventRecord.network_id == workspace.id,
        EventRecord.type == 'workspace.message.posted',
    )).scalar_one_or_none()
    if not original:
        raise EventRejected('workspace_mod', 'reply_message_unavailable')
    if event.target.startswith('channel/'):
        same_conversation = original.target == event.target and original.visibility != 'direct'
    else:
        same_conversation = (not original.target.startswith('channel/')
            and {original.source, original.target} == {event.source, event.target})
    if not same_conversation:
        raise EventRejected('workspace_mod', 'reply_message_unavailable')
    payload = original.payload or {}
    text = str(payload.get('content') or '')
    if not text:
        text = ', '.join(str(a.get('filename') or '') for a in payload.get('attachments', []) if isinstance(a, dict))
    event.metadata['reply_to'] = {
        'message_id': original.id,
        'sender_name': payload.get('sender_name') or original.source.split(':', 1)[-1],
        'sender_address': original.source,
        'content': text[:500],
        'recalled': bool((original.metadata_ or {}).get('recalled')),
        'thread_id': str(channel.id) if channel else dm_session_id(original.source, original.target),
    }
    event.metadata['in_reply_to'] = original.id
