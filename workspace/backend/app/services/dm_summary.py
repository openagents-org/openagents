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

from app import cache
from app.services.conversation_queries import conversation_pairs_query
from app.models import EventRecord

BASE_MAX_AGE_SECONDS = 600
BASE_SETTLE_MS = 120_000
MERGED_MAX_STALE_SECONDS = 5.0
TTL_SECONDS = 1800
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


def _write(key, value):
    cache.set_bytes(key, json.dumps(value).encode("utf-8"), TTL_SECONDS)


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
    if base and base.get("rewrite") == rewrite and now - base.get("built_at", 0) < BASE_MAX_AGE_SECONDS:
        return base

    def build():
        watermark = int(time.time() * 1000) - BASE_SETTLE_MS
        return {"rewrite": rewrite, "built_at": time.time(), "watermark": watermark,
                "pairs": _pack(_aggregate(db, workspace_id, EventRecord.timestamp <= watermark))}

    base = cache.json_singleflight(key + ":" + rewrite + ":" + str(int(now // BASE_MAX_AGE_SECONDS)),
                                   TTL_SECONDS, build)
    _write(key, base)
    return base


def workspace_pairs(db, workspace_id, generation, rewrite):
    """All DM pairs of the workspace: {(agent_a, agent_b): [last_ts, msg_count]}."""
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
