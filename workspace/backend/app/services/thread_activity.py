"""Viewer-specific thread unread counts and agent-reply attribution."""
import json
from sqlalchemy import and_, or_, select, text
from app.models import EventRecord
from app.services.message_identity import human_sender_email
from app.services.unread_window import unread_cutoff_ms

_PYTHON_WHITESPACE = ''.join(chr(i) for i in range(0x3001) if chr(i).isspace())


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
    cutoff = unread_cutoff_ms()
    viewer_email = (viewer_email or '').lower()
    if db.get_bind().dialect.name == 'postgresql':
        query, params = _unread_summary_query(workspace_id, markers, viewer_email, cutoff)
        for target, count, completion in db.execute(text(query), params):
            entry = result[target.removeprefix('channel/')]
            entry.update(unread_count=count, completion_at=completion)
        return result
    # SQLite deployments retain the same semantics without PostgreSQL JSONB.
    # Production returns only aggregate rows, never full historical messages.
    return _thread_activity_python(db, workspace_id, markers, viewer_email, result, cutoff)


def _json_truthy(expression):
    # Match Python truthiness for all JSON types, including legacy non-string
    # content. JSONB numeric equality also handles 0.0 and other zero spellings.
    return f"COALESCE({expression} NOT IN ('null'::jsonb, 'false'::jsonb, '0'::jsonb, '\"\"'::jsonb, '[]'::jsonb, '{{}}'::jsonb), false)"


def _unread_summary_query(workspace_id, markers, viewer_email, cutoff):
    """Indexed per-channel aggregates; keep each channel's exact read marker.

    LATERAL bounds each scan by workspace/target/type/timestamp, matching the
    existing events index. Only messages in the last 30 days and after the
    person's read marker count; the response echoes the original marker so
    clients can reject stale results without treating the cutoff as a read.
    """
    params = {'workspace_id': str(workspace_id), 'viewer_email': viewer_email, 'cutoff': cutoff,
              # Match str.strip(), including Unicode whitespace, in SQL btrim.
              'strip_chars': _PYTHON_WHITESPACE}
    values = []
    for i, (name, at) in enumerate(markers.items()):
        values.append(f'(CAST(:target_{i} AS text), CAST(:read_{i} AS bigint))')
        params[f'target_{i}'] = f'channel/{name}'
        params[f'read_{i}'] = at

    def normalized(expr):
        return f'lower(btrim({expr}, :strip_chars))'

    candidates = []
    for field in ("e.payload->'sender_email'", "e.metadata->'sender_email'", "e.payload->'sender_id'"):
        value = normalized(f"({field}) #>> '{{}}'")
        # human_sender_email accepts one @, nonempty parts, and no whitespace.
        candidates.append(f"CASE WHEN jsonb_typeof({field}) = 'string' "
                          f"AND {value} ~ '^[^@]+@[^@]+$' "
                          f"AND translate({value}, :strip_chars, '') = {value} THEN {value} END")
    source_identity = normalized('substring(e.source FROM 7)')
    sender = (f"CASE WHEN left(e.source, 6) = 'human:' THEN CASE "
              f"WHEN strpos({source_identity}, '@') > 0 THEN {source_identity} "
              f"ELSE COALESCE({', '.join(candidates)}) END END")
    message_type = "e.payload->'message_type'"
    query = f"""
        SELECT marker.target, summary.unread_count, summary.completion_at
        FROM (VALUES {', '.join(values)}) AS marker(target, read_at)
        CROSS JOIN LATERAL (
            SELECT count(*) AS unread_count,
                   max(CASE WHEN :viewer_email != ''
                            AND left(e.source, 11) = 'openagents:'
                            AND e.metadata->>'requester_email' = :viewer_email
                       THEN e.timestamp END) AS completion_at
            FROM events e
            WHERE e.network_id = CAST(:workspace_id AS uuid)
              AND e.target = marker.target
              AND e.type = 'workspace.message.posted'
              AND e.timestamp > marker.read_at
              AND e.timestamp >= :cutoff
              AND e.visibility != 'direct'
              AND (NOT {_json_truthy(message_type)} OR {message_type} = '"chat"'::jsonb)
              AND {_json_truthy("e.payload->'content'")}
              AND (:viewer_email = '' OR ({sender}) IS DISTINCT FROM :viewer_email)
        ) AS summary
    """
    return query, params


def _thread_activity_python(db, workspace_id, markers, viewer_email, result, cutoff):
    events = db.execute(select(EventRecord).where(
        EventRecord.network_id == workspace_id,
        EventRecord.type == 'workspace.message.posted',
        EventRecord.visibility != 'direct',
        EventRecord.timestamp >= cutoff,
        or_(*(and_(EventRecord.target == f'channel/{name}', EventRecord.timestamp > at) for name, at in markers.items())),
    )).scalars()
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
