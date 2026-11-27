"""Workspace-wide DM conversation totals, maintained incrementally.

GET /v1/events/conversations needs, per DM pair, the message count and the
newest timestamp. Aggregating the whole DM history per request does not scale:
an agent-to-agent reply loop produced 500k+ DM rows in a few days, and every
new DM invalidated each viewer's cached list.

Two observations make this cheap and exact:

* Who may see a conversation depends only on its two participants (see
  _dm_privacy_clause: a row is readable when neither side is a person, or the
  viewer is one side), so totals can be computed once per workspace for all
  pairs and filtered per viewer afterwards.
* History only grows, except for rare edits/deletes (tracked by
  dm_rewrite_generation). Totals = a *base* aggregate over rows with
  timestamp <= W, plus a small *delta* aggregate over rows newer than W.

The base is rebuilt when DM history is rewritten, or when it is older than
BASE_MAX_AGE_SECONDS (keeping the delta small). It stops BASE_SETTLE_MS short
of the present, and each rebuild re-reads everything up to its watermark, so a
row committed late with an older timestamp is picked up by the next rebuild.
The merged result is reused for MERGED_MAX_STALE_SECONDS when DMs keep arriving.
"""
import json
import time
from contextlib import contextmanager

from sqlalchemy import text

from app import cache
from app.services.conversation_queries import conversation_pairs_query
from app.models import EventRecord

# New messages are read from the delta on every refresh; a full-history
# rescan is reconciliation, not the freshness mechanism.
BASE_MAX_AGE_SECONDS = 3600
BASE_SETTLE_MS = 120_000
MERGED_MAX_STALE_SECONDS = 5.0
TTL_SECONDS = 1800
# An aged base stays exact (the delta covers everything after its watermark),
# so keep it far longer than it is "fresh": it must never vanish while a
# rebuild is pending, or every request falls back to a full-history scan.
BASE_TTL_SECONDS = 86400
# A busy workspace's full-history aggregate can exceed the app's 30 s
# statement timeout under load; then every rebuild failed, the base expired,
# and all requests piled onto the same scan (2026-11-25). Give the one
# rebuild query its own limit.
BASE_STATEMENT_TIMEOUT_MS = 300_000
BASE_REBUILD_LOCK_SECONDS = 360
GLOBAL_REBUILD_KEY = "v1events:dm-summary:history-rebuild"


class SummaryWarmingError(RuntimeError):
    """Another request is rebuilding history; retry without occupying a DB slot."""
ALL_PAIRS = 1_000_000


def _key(kind, workspace_id):
    return "v1events:dm-summary:" + kind + ":" + str(workspace_id)


def _read(key):
    raw = cache.get_bytes(key)
    if raw is None:
        return None
    try:
        value = json.loads(raw)
    except (TypeError, ValueError):
        return None
    return value if isinstance(value, dict) else None


def _write(key, value, ttl=TTL_SECONDS):
    cache.set_bytes(key, json.dumps(value).encode("utf-8"), ttl)


@contextmanager
def _statement_timeout(db, ms):
    """Raise the transaction's statement_timeout for one query, then restore it."""
    if db.get_bind().dialect.name != "postgresql":
        yield
        return
    from app.db_timeouts import STATEMENT_TIMEOUT_MS
    db.execute(text(f"SET LOCAL statement_timeout = {int(ms)}"))
    yield
    # Only on success: after a failed query the transaction is aborted, and the
    # caller's rollback resets SET LOCAL anyway.
    db.execute(text(f"SET LOCAL statement_timeout = {int(STATEMENT_TIMEOUT_MS)}"))


def _aggregate(db, workspace_id, *filters):
    return {(r.agent_a, r.agent_b): [r.last_ts, r.msg_count] for r in db.execute(
        conversation_pairs_query(workspace_id, ALL_PAIRS, None, list(filters)))}


def _pack(pairs):
    return [[a, b, ts, n] for (a, b), (ts, n) in pairs.items()]


def _unpack(rows):
    return {(a, b): [ts, n] for a, b, ts, n in rows}


def _base(db, workspace_id, rewrite):
    key = _key("base", workspace_id)
    base = _read(key)
    now = time.time()
    current = base is not None and base.get("rewrite") == rewrite and "watermark" in base
    if current and now - base.get("built_at", 0) < BASE_MAX_AGE_SECONDS:
        return base

    def build():
        watermark = int(time.time() * 1000) - BASE_SETTLE_MS
        with _statement_timeout(db, BASE_STATEMENT_TIMEOUT_MS):
            pairs = _aggregate(db, workspace_id, EventRecord.timestamp <= watermark)
        return {"rewrite": rewrite, "built_at": time.time(), "watermark": watermark, "pairs": _pack(pairs)}

    # Never wait for history while holding the request's authentication DB
    # transaction. A timed-out waiter used to start another full scan even
    # while the first one was still running (up to five minutes).
    lock = _rebuild_lock(key)
    global_lock = None
    if lock is not None:
        if not _try_acquire(lock, 0):
            if current:
                return base
            raise SummaryWarmingError("DM history is being prepared. Please retry.")
        # Serialize full-history reads across workspaces as well: even distinct
        # rebuilds contend on the same events-table disk pages.
        global_lock = _rebuild_lock(GLOBAL_REBUILD_KEY)
        if global_lock is None or not _try_acquire(global_lock, 0):
            _release(lock)
            if current:
                return base
            raise SummaryWarmingError("DM history is being prepared. Please retry.")
    try:
        # Re-read under the locks in case a preceding leader just finished.
        fresh = _read(key)
        if fresh and fresh.get("rewrite") == rewrite and "watermark" in fresh and \
                time.time() - fresh.get("built_at", 0) < BASE_MAX_AGE_SECONDS:
            return fresh
        base = build()
        _write(key, base, BASE_TTL_SECONDS)
        return base
    finally:
        if global_lock is not None:
            _release(global_lock)
        if lock is not None:
            _release(lock)


def _rebuild_lock(key):
    client = cache._lazy_client()
    if client is None:
        return None
    try:
        return client.lock(key + ":rebuild", timeout=BASE_REBUILD_LOCK_SECONDS, sleep=0.05)
    except Exception:
        return None


def _try_acquire(lock, wait):
    try:
        return lock.acquire(blocking=wait > 0, blocking_timeout=wait or None)
    except Exception:
        return False


def _release(lock):
    try:
        lock.release()
    except Exception:
        pass


def workspace_pairs(db, workspace_id, generation, rewrite):
    """All DM pairs of the workspace: {(agent_a, agent_b): [last_ts, msg_count]}."""
    from app.services import dm_pair_summary
    table_mode = dm_pair_summary.mode()
    if table_mode != "off" and dm_pair_summary.is_backfilled(db, workspace_id):
        if table_mode == "on":
            # Trigger-maintained per-pair rows: no history scan, no rebuilds.
            return dm_pair_summary.read_pairs(db, workspace_id)
        pairs = _cached_workspace_pairs(db, workspace_id, generation, rewrite)
        dm_pair_summary.shadow_compare(db, workspace_id, pairs)
        return pairs
    return _cached_workspace_pairs(db, workspace_id, generation, rewrite)


def _cached_workspace_pairs(db, workspace_id, generation, rewrite):
    key = _key("merged", workspace_id)
    merged = _read(key)
    if merged and (merged.get("generation") == generation
                   or time.time() - merged.get("at", 0) < MERGED_MAX_STALE_SECONDS):
        return _unpack(merged["pairs"])

    def compute():
        base = _base(db, workspace_id, rewrite)
        pairs = _unpack(base["pairs"])
        for pair, (ts, n) in _aggregate(db, workspace_id, EventRecord.timestamp > base["watermark"]).items():
            if pair in pairs:
                pairs[pair] = [max(pairs[pair][0], ts), pairs[pair][1] + n]
            else:
                pairs[pair] = [ts, n]
        return {"generation": generation, "at": time.time(), "pairs": _pack(pairs)}

    merged = cache.json_singleflight(key + ":" + generation, TTL_SECONDS, compute)
    _write(key, merged)
    return _unpack(merged["pairs"])


def _is_person(address):
    # Mirrors _is_person_address in app/routers/events.py.
    return address.startswith("human:") and "@" in address


def visible_pairs(pairs, viewer_addresses, agent, limit):
    """Rows like conversation_pairs_query's, filtered for one viewer.

    viewer_addresses None = unrestricted (machine callers); otherwise a pair
    is visible when neither side is a person or the viewer is one side."""
    mine = set(viewer_addresses or ())
    out = []
    for (a, b), (ts, n) in pairs.items():
        if agent and agent not in (a, b):
            continue
        if viewer_addresses is not None and (_is_person(a) or _is_person(b)) and not ({a, b} & mine):
            continue
        out.append({"agent_a": a, "agent_b": b, "last_ts": ts, "msg_count": n})
    out.sort(key=lambda r: (-r["last_ts"], r["agent_a"], r["agent_b"]))
    return out[:limit]
