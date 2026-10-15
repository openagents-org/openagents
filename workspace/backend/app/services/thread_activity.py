"""Viewer-specific thread unread counts and agent-reply attribution."""
import json
from sqlalchemy import and_, or_, select
from app.models import EventRecord
from app.services.message_identity import human_sender_email


def read_markers(raw):
    if not raw:
        return {}
    markers = json.loads(raw)
    if not isinstance(markers, dict) or len(markers) > 200:
        raise ValueError('Invalid read markers')
    if any(not isinstance(k, str) or type(v) is not int or not 0 <= v <= 9007199254740991 for k, v in markers.items()):
        raise ValueError('Invalid read markers')
    return markers


def sender_email(event):
    source = event.source or ''
    if not source.startswith('human:'):
        return None
    identity = source.removeprefix('human:').strip().lower()
    return identity if '@' in identity else human_sender_email(event.payload, event.metadata_)


def reply_requester(db, workspace_id, source, target, metadata):
    """Prefer an explicit reply parent; legacy adapters use the latest routed request.

    Human-only interjections never replace the person who asked this agent.
    Unknown attribution stays unknown rather than notifying every participant.
    """
    base = select(EventRecord).where(EventRecord.network_id == workspace_id,
        EventRecord.target == target, EventRecord.type == 'workspace.message.posted')
    parent_id = (metadata or {}).get('in_reply_to')
    if parent_id:
        parent = db.execute(base.where(EventRecord.id == parent_id)).scalar_one_or_none()
        if parent:
            return sender_email(parent) or (parent.metadata_ or {}).get('requester_email')
        return None
    agent = source.removeprefix('openagents:')
    # Adapters without a reply ID can only be attributed when the routed
    # requests since this agent's previous final answer have one requester.
    # Concurrent requests from different people are ambiguous; do not guess.
    candidates = db.execute(base.order_by(EventRecord.timestamp.desc()).limit(200)).scalars()
    requesters = set()
    for parent in candidates:
        if (parent.payload or {}).get('message_type', 'chat') != 'chat':
            continue
        if parent.source == source:
            break
        if agent not in ((parent.metadata_ or {}).get('target_agents') or []):
            continue
        requester = sender_email(parent) or (parent.metadata_ or {}).get('requester_email')
        if not requester:
            return None
        requesters.add(requester)
    return next(iter(requesters)) if len(requesters) == 1 else None


def thread_activity(db, workspace_id, channels, markers, viewer_email):
    markers = {c.name: markers[c.name] for c in channels if c.name in markers}
    result = {name: {'read_at': at, 'unread_count': 0, 'completion_at': None} for name, at in markers.items()}
    if not markers:
        return result
    events = db.execute(select(EventRecord).where(
        EventRecord.network_id == workspace_id,
        EventRecord.type == 'workspace.message.posted',
        EventRecord.visibility != 'direct',
        or_(*(and_(EventRecord.target == f'channel/{name}', EventRecord.timestamp > at) for name, at in markers.items())),
    )).scalars()
    viewer_email = (viewer_email or '').lower()
    for event in events:
        payload = event.payload or {}
        if (payload.get('message_type') or 'chat') != 'chat' or not payload.get('content'):
            continue
        if viewer_email and sender_email(event) == viewer_email:
            continue
        entry = result[event.target.removeprefix('channel/')]
        entry['unread_count'] += 1
        if event.source.startswith('openagents:') and viewer_email and (event.metadata_ or {}).get('requester_email') == viewer_email:
            entry['completion_at'] = max(entry['completion_at'] or 0, event.timestamp)
    return result
