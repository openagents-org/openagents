"""Per-person read markers shared across devices.

A marker is the newest message time (unix ms) a person has read in one thread
or DM. Markers used to live only in each client's local storage, so reading a
thread on one device left it unread on the others. They are now stored per
person (keyed by email, never by device) and only ever move forward.

Clients may still send their local markers (`read_at` on discovery and DM
listing); the effective marker is the newer of the stored and the sent one,
so older clients keep working unchanged.
"""
import json
import logging
import uuid
from datetime import datetime, timezone
from time import time

from sqlalchemy import and_, or_, select, update

from app.models import NotificationRecord, ReadMarker

logger = logging.getLogger(__name__)

READ_STATE_EVENT = 'workspace.read_state.updated'
MAX_MARKERS = 200
MAX_SESSION_ID = 512
MAX_TIMESTAMP = 9007199254740991
SIGNAL_KINDS = ('dm', 'mention')


def now_ms():
    return int(time() * 1000)


def person_email(viewer):
    """The signed-in person markers belong to, or None (machines, agents, visitors)."""
    if getattr(viewer, 'kind', None) != 'human':
        return None
    return (getattr(viewer, 'email', None) or '').strip().lower() or None


def is_dm_session(session_id):
    if not session_id.startswith('dm:'):
        return False
    pair = session_id[3:].split(',')
    return len(pair) == 2 and all(pair)


def parse_marker_updates(raw):
    """Validate `{session_id: read_at_ms | null}`; null means "now" on the server clock."""
    if not isinstance(raw, dict) or not raw or len(raw) > MAX_MARKERS:
        raise ValueError('markers must be a non-empty object with at most 200 entries')
    out = {}
    for key, value in raw.items():
        if not isinstance(key, str) or not key.strip() or len(key) > MAX_SESSION_ID:
            raise ValueError('Invalid session id')
        if key.startswith('dm:') and not is_dm_session(key):
            raise ValueError('Invalid DM session id')
        if value is not None and (type(value) is not int or not 0 <= value <= MAX_TIMESTAMP):
            raise ValueError('Invalid read_at')
        out[key] = value
    return out


def stored_markers(db, workspace_id, email, session_ids=None, since=None):
    """{session_id: read_at} for this person; optionally only some ids / recent changes."""
    if not email:
        return {}
    query = select(ReadMarker.session_id, ReadMarker.read_at).where(
        ReadMarker.workspace_id == str(workspace_id), ReadMarker.user_email == email)
    if session_ids is not None:
        if not session_ids:
            return {}
        query = query.where(ReadMarker.session_id.in_(list(session_ids)))
    if since is not None:
        query = query.where(ReadMarker.updated_at > since)
    return dict(db.execute(query).all())


def merge_markers(sent, stored):
    """Newest of the client's local marker and the stored one, per session."""
    merged = dict(sent)
    for key, at in stored.items():
        if key not in merged or at > merged[key]:
            merged[key] = at
    return merged


def merged_for_viewer(db, workspace_id, viewer, sent, keep=lambda key: True):
    """Client-sent markers merged with the viewer's stored ones (filtered by `keep`)."""
    email = person_email(viewer)
    if not email:
        return sent
    stored = {k: v for k, v in stored_markers(db, workspace_id, email).items() if keep(k)}
    return merge_markers(sent, stored)


def _upsert(db, values):
    table = ReadMarker.__table__
    name = db.get_bind().dialect.name
    if name == 'postgresql':
        from sqlalchemy.dialects.postgresql import insert as _insert
    else:
        from sqlalchemy.dialects.sqlite import insert as _insert
    stmt = _insert(table).values(**values)
    stmt = stmt.on_conflict_do_update(
        index_elements=['workspace_id', 'user_email', 'session_id'],
        set_={'read_at': stmt.excluded.read_at, 'updated_at': stmt.excluded.updated_at},
        # Markers never move backwards, whichever device writes last.
        where=table.c.read_at < stmt.excluded.read_at,
    )
    db.execute(stmt)


def advance_markers(db, workspace_id, email, updates):
    """Move this person's markers forward. Returns (effective, changed).

    `effective` is the stored marker for every requested session after the
    write; `changed` holds only the sessions whose marker moved. Times in the
    future are clamped to the server clock so a fast device clock cannot hide
    messages that have not arrived yet.
    """
    workspace_id = str(workspace_id)
    now = now_ms()
    wanted = {key: min(now if at is None else at, now) for key, at in updates.items()}
    before = stored_markers(db, workspace_id, email, wanted.keys())
    changed = {key: at for key, at in wanted.items() if at > before.get(key, -1)}
    for key, at in changed.items():
        _upsert(db, {'workspace_id': workspace_id, 'user_email': email, 'session_id': key,
                     'read_at': at, 'updated_at': now})
    if changed:
        _clear_signals(db, workspace_id, email, changed)
    db.commit()
    effective = {**before, **changed}
    return {key: effective[key] for key in wanted}, changed


def _clear_signals(db, workspace_id, email, changed):
    """DM / @mention signals up to the new marker are read too, on every device."""
    clauses = [and_(NotificationRecord.channel_name == key,
                    NotificationRecord.created_at <= datetime.fromtimestamp(at / 1000, timezone.utc))
               for key, at in changed.items()]
    db.execute(update(NotificationRecord).where(
        NotificationRecord.workspace_id == workspace_id,
        NotificationRecord.recipient_email == email,
        NotificationRecord.kind.in_(SIGNAL_KINDS),
        NotificationRecord.is_read == False,  # noqa: E712
        or_(*clauses),
    ).values(is_read=True, read_at=datetime.now(timezone.utc)).execution_options(synchronize_session=False))


def read_state_event(workspace_id, email, session_id, read_at, at=None):
    """The stream event other devices of the same person receive."""
    address = f'human:{email}'
    return {
        'id': str(uuid.uuid4()),
        'type': READ_STATE_EVENT,
        'network': str(workspace_id),
        'source': address,
        'target': address,
        'visibility': 'direct',
        'timestamp': at or now_ms(),
        'payload': {'channel': session_id, 'session_id': session_id, 'read_at': read_at, 'user_email': email},
    }


def publish_changes(workspace_id, email, changed):
    from app import cache
    at = now_ms()
    for session_id, read_at in changed.items():
        try:
            cache.publish_event(f'ws:{workspace_id}:events', json.dumps(
                read_state_event(workspace_id, email, session_id, read_at, at), separators=(',', ':')).encode())
        except Exception as e:  # never fail the write because the stream is down
            logger.debug('read-state publish failed: %s', e)


def stream_allows(event, viewer):
    """Read-state events go only to the person they belong to — not to agents,
    machines, or anyone else who can otherwise see the whole workspace stream."""
    if event.get('type') != READ_STATE_EVENT:
        return True
    email = person_email(viewer)
    return bool(email) and event.get('target') == f'human:{email}'
