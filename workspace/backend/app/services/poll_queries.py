"""Indexed event polling and short-lived, commit-invalidated stream heads."""
import hashlib
import json
import uuid

from sqlalchemy import event, literal_column, select
from sqlalchemy.orm import Session

from app import cache
from app.models import EventRecord

POLL_PREFIXES = ('workspace.message.posted', 'workspace.agent.control', 'workspace.tool_result')


def event_type_filter(prefix):
    # Constants let PostgreSQL prove the partial-index predicate even with a
    # generic prepared plan. Preserve the API's existing LIKE-prefix semantics
    # (including the underscore in tool_result); never interpolate user input.
    if prefix in POLL_PREFIXES:
        return EventRecord.type.like(literal_column("'" + prefix + "%'"))
    return EventRecord.type.startswith(prefix)


def _generation_key(workspace_id):
    return 'v1events:head-generation:' + str(workspace_id)


def _dm_generation_key(workspace_id):
    return 'v1events:dm-generation:' + str(workspace_id)


def poll_generation(workspace_id):
    """Current event-write generation of *workspace_id* (changes on every
    committed event write). Poll caches fold it into their keys so a page
    cached before a write is never served after it, whatever the filter."""
    return (cache.get_bytes(_generation_key(workspace_id)) or b'0').hex()


DM_GENERATION_TTL_SECONDS = 7 * 24 * 3600


def dm_generation(workspace_id):
    """Like poll_generation, but changes only on writes that can alter direct
    message history, so DM summaries survive a busy workspace's channel traffic.

    A missing key (never written, expired or evicted) gets a fresh random value
    instead of a fixed default, so an entry cached under an older generation can
    never become current again; callers may cache for longer than this TTL.
    """
    key = _dm_generation_key(workspace_id)
    value = cache.get_bytes(key)
    if value is None:
        value = uuid.uuid4().hex.encode()
        cache.set_bytes(key, value, DM_GENERATION_TTL_SECONDS)
    return value.hex()


def _may_change_dms(row, is_new):
    # Edits and deletes are rare; treat any of them as a possible DM change
    # rather than reasoning about which attributes moved.
    return not is_new or (row.visibility == 'direct' and row.type == 'workspace.message.posted')


@event.listens_for(Session, 'before_flush')
def _remember_event_writes(session, flush_context, instances):
    for row in session.new.union(session.dirty).union(session.deleted):
        if isinstance(row, EventRecord):
            session.info.setdefault('poll_head_workspaces', set()).add(str(row.network_id))
            if _may_change_dms(row, row in session.new):
                session.info.setdefault('dm_workspaces', set()).add(str(row.network_id))


@event.listens_for(Session, 'after_commit')
def _invalidate_committed_heads(session):
    if session.in_nested_transaction():
        return
    for workspace_id in session.info.pop('poll_head_workspaces', set()):
        # A generation prevents a query started before the commit from later
        # repopulating the current cache with an obsolete head. All ORM event
        # writers are covered, including those publishing before commit.
        cache.set_bytes(_generation_key(workspace_id), uuid.uuid4().hex.encode(), 60)
    for workspace_id in session.info.pop('dm_workspaces', set()):
        cache.set_bytes(_dm_generation_key(workspace_id), uuid.uuid4().hex.encode(), DM_GENERATION_TTL_SECONDS)


@event.listens_for(Session, 'after_rollback')
def _discard_rolled_back_heads(session):
    if not session.in_nested_transaction():
        session.info.pop('poll_head_workspaces', None)
        session.info.pop('dm_workspaces', None)


def stream_head(db, workspace_id, prefix, channel=None, target=None):
    scope = json.dumps([str(workspace_id), prefix, channel, target], separators=(',', ':'))
    key = 'v1events:stream-head:' + hashlib.sha256(scope.encode()).hexdigest() + ':' + poll_generation(workspace_id)

    def fetch():
        query = select(EventRecord.id, EventRecord.timestamp).where(EventRecord.network_id == workspace_id)
        if prefix:
            query = query.where(event_type_filter(prefix))
        if channel:
            query = query.where(EventRecord.target == 'channel/' + channel)
        elif target:
            query = query.where(EventRecord.target == target)
        row = db.execute(query.order_by(EventRecord.timestamp.desc(), EventRecord.id.desc()).limit(1)).first()
        return {'id': row.id, 'timestamp': row.timestamp} if row else None

    # Null heads are cached too: streams that have never had an event are a
    # common source of repeated cursor-free polls. External SQL writers are
    # bounded by this TTL even if they bypass the ORM commit hook.
    return cache.json_singleflight(key, 1.0, fetch)


def resume_cursor(head, newest, incoming):
    # A cached head may predate the message query. Never move backward from a
    # returned event or valid incoming cursor. At equal timestamps prefer the
    # DB-ordered position, avoiding a Python-vs-PostgreSQL collation mismatch.
    position = newest or incoming
    if head and (not position or head['timestamp'] > position['timestamp']):
        position = head
    return position['id'] if position else None
