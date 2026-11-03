"""Cross-request cache for per-viewer permission results.

Polls recompute the same answers many times a second: which private threads a
viewer cannot see, and the viewer's role. These depend only on rows in a fixed
set of permission tables, so results are cached in Redis under a per-workspace
*permission generation* that changes after any commit touching those rows —
the same commit-hook pattern as the poll caches (app/services/poll_queries).

Safety rules:
  * A missing generation (never written, expired or evicted) gets a fresh
    random value, so a lost key only causes misses, never an old answer.
  * Bulk UPDATE/DELETE statements and raw SQL writes on permission tables bump
    a global generation that every key includes, since their workspace is
    unknown. Only columns known to be irrelevant are exempt.
  * A session with pending or uncommitted permission writes bypasses the cache,
    so a request always sees its own changes.
  * Every entry also expires after PERMISSION_CACHE_TTL_SECONDS as a backstop
    for any write path this module cannot see.
"""
import hashlib
import json
import re
import uuid

from sqlalchemy import event, inspect
from sqlalchemy.orm import Session

from app import cache
from app.models import (
    Channel, ChannelHumanMember, ChannelMember, CloudAgentConfig, ResourceGrant,
    SecurityGroup, SecurityGroupMember, Workspace, WorkspaceCollaborator,
    WorkspaceMember, WorkspaceMembership,
)

PERMISSION_CACHE_TTL_SECONDS = 30.0
GENERATION_TTL_SECONDS = 7 * 24 * 3600
GLOBAL = "global"

# Updates to these models only matter when one of these columns changes.
# Heartbeats and activity stamps rewrite the others constantly.
_RELEVANT_COLUMNS = {
    Channel: {"workspace_id", "name", "visibility", "owner_email"},
    Workspace: {"creator_email", "status"},
    WorkspaceMember: {"workspace_id", "agent_name", "agent_type", "owner_email"},
}
# Any change to these models matters.
_ALWAYS = (ChannelHumanMember, ChannelMember, CloudAgentConfig, ResourceGrant,
           SecurityGroup, SecurityGroupMember, WorkspaceCollaborator, WorkspaceMembership)
_TABLES = {m.__tablename__: m for m in (*_RELEVANT_COLUMNS, *_ALWAYS)}
_RAW_WRITE = re.compile(r"^\s*(update|delete|insert|truncate|alter|drop)\b", re.I)


def _generation_key(scope):
    return "perm-generation:" + str(scope)


def _generation(scope):
    key = _generation_key(scope)
    value = cache.get_bytes(key)
    if value is None:
        value = uuid.uuid4().hex.encode()
        cache.set_bytes(key, value, GENERATION_TTL_SECONDS)
    return value.hex()


def _bump(scope):
    cache.set_bytes(_generation_key(scope), uuid.uuid4().hex.encode(), GENERATION_TTL_SECONDS)


def _workspace_of(session, obj):
    workspace_id = getattr(obj, "workspace_id", None)
    if workspace_id is not None:
        return str(workspace_id)
    if isinstance(obj, Workspace):
        return str(obj.id) if obj.id is not None else None
    parent = None
    with session.no_autoflush:
        if isinstance(obj, (ChannelHumanMember, ChannelMember)) and obj.channel_id is not None:
            parent = session.get(Channel, obj.channel_id)
        elif isinstance(obj, SecurityGroupMember) and obj.group_id is not None:
            parent = session.get(SecurityGroup, obj.group_id)
    return str(parent.workspace_id) if parent is not None else None


def _changes_permissions(obj, is_dirty):
    relevant = _RELEVANT_COLUMNS.get(type(obj))
    if not is_dirty or relevant is None:
        return True
    state = inspect(obj)
    if any(state.attrs[name].history.has_changes() for name in relevant):
        return True
    if isinstance(obj, WorkspaceMember):
        # online/offline flips are presence; only entering or leaving
        # "removed" changes who belongs to the workspace.
        added, _, deleted = state.attrs["status"].history
        return "removed" in (list(added or []) + list(deleted or []))
    return False


def _mark(session, scope):
    session.info.setdefault("permission_scopes", set()).add(scope)


@event.listens_for(Session, "before_flush")
def _remember_permission_writes(session, flush_context, instances):
    for objs, is_dirty in ((session.new, False), (session.deleted, False), (session.dirty, True)):
        for obj in list(objs):
            if type(obj) not in _TABLES.values() or not _changes_permissions(obj, is_dirty):
                continue
            _mark(session, _workspace_of(session, obj) or GLOBAL)


@event.listens_for(Session, "do_orm_execute")
def _remember_bulk_permission_writes(state):
    if state.is_select:
        return
    statement = state.statement
    table = getattr(getattr(statement, "table", None), "name", None)
    if table is None:
        # Raw SQL: only the statement text says what it touches.
        sql = str(statement)
        if _RAW_WRITE.match(sql) and any(re.search(r"\b%s\b" % t, sql) for t in _TABLES):
            _mark(state.session, GLOBAL)
        return
    model = _TABLES.get(table)
    if model is None:
        return
    relevant = _RELEVANT_COLUMNS.get(model)
    values = getattr(statement, "_values", None)
    if state.is_update and relevant is not None and values:
        if not {getattr(k, "key", str(k)) for k in values} & relevant:
            return
    _mark(state.session, GLOBAL)


@event.listens_for(Session, "after_commit")
def _bump_committed(session):
    if session.in_nested_transaction():
        return
    for scope in session.info.pop("permission_scopes", set()):
        _bump(scope)


@event.listens_for(Session, "after_rollback")
def _discard_rolled_back(session):
    if not session.in_nested_transaction():
        session.info.pop("permission_scopes", None)


def _pending(db):
    """Unflushed or uncommitted permission writes in this session."""
    if db.info.get("permission_scopes"):
        return True
    for objs, is_dirty in ((db.new, False), (db.deleted, False), (db.dirty, True)):
        for obj in objs:
            if type(obj) in _TABLES.values() and _changes_permissions(obj, is_dirty):
                return True
    return False


def cached(db, kind, workspace_id, parts, compute):
    """Return compute(), reusing a result cached for this workspace's current
    permission generation. Values must be JSON-serializable."""
    if _pending(db):
        return compute()
    wid = str(workspace_id)
    raw_key = json.dumps([kind, wid, list(parts), _generation(wid), _generation(GLOBAL)], default=str)
    key = "perm:" + kind + ":" + hashlib.sha1(raw_key.encode("utf-8")).hexdigest()
    hit = cache.get_bytes(key)
    if hit is not None:
        try:
            return json.loads(hit)
        except (TypeError, ValueError):
            pass
    value = compute()
    cache.set_bytes(key, json.dumps(value).encode("utf-8"), PERMISSION_CACHE_TTL_SECONDS)
    return value
