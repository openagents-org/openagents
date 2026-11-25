"""DM pair totals from ``dm_pair_summaries`` (migration 101) instead of a
full-history aggregate.

The table is kept current by a PostgreSQL trigger on ``events``. A workspace's
rows only include its whole history after ``backfill_workspace`` ran for it
(recorded in ``dm_summary_backfills``); before that they hold just the
trigger's deltas since the migration.

Exact backfill without locks: read the full aggregate A and the workspace's
current rows C from ONE repeatable-read snapshot, then add ``A - C`` per pair
in a separate read-committed transaction. Rows visible in the snapshot are in
A, and any trigger increments they caused are in C and cancel out; rows
committed after the snapshot are not in A, and their increments stay in the
live table. So every message is counted exactly once, whatever arrives or is
deleted meanwhile. (One accepted edge: if the newest message of a pair is
deleted during a backfill, that pair's last_ts may stay on the deleted
message until the pair's next message.)

Rollout switch ``DM_SUMMARY_TABLE``:
  off     (default) read the existing cached aggregate, as before
  shadow  serve the existing path; for backfilled workspaces also read the
          table on a sample of requests and log any difference
  on      serve backfilled workspaces from the table
"""
from __future__ import annotations

import logging
import os
import random
import time

from sqlalchemy import select, text

from app.models import DmPairSummary, DmSummaryBackfill

logger = logging.getLogger(__name__)

SHADOW_SAMPLE = 0.05
BACKFILL_STATEMENT_TIMEOUT_MS = 900_000
_BACKFILLED_TTL_SECONDS = 60.0
_backfilled: dict[str, float] = {}


def mode() -> str:
    value = os.environ.get("DM_SUMMARY_TABLE", "off").strip().lower()
    return value if value in ("off", "shadow", "on") else "off"


def is_backfilled(db, workspace_id) -> bool:
    """Cached per process; a completed backfill is permanent."""
    key = str(workspace_id)
    if key in _backfilled:
        return True
    found = db.execute(select(DmSummaryBackfill.workspace_id).where(
        DmSummaryBackfill.workspace_id == key)).first() is not None
    if found:
        _backfilled[key] = time.time()
    return found


def read_pairs(db, workspace_id) -> dict:
    """{(agent_a, agent_b): [last_ts, msg_count]}, like dm_summary.workspace_pairs."""
    rows = db.execute(select(DmPairSummary.agent_a, DmPairSummary.agent_b,
                             DmPairSummary.last_ts, DmPairSummary.msg_count).where(
        DmPairSummary.workspace_id == str(workspace_id), DmPairSummary.msg_count > 0))
    return {(a, b): [ts, n] for a, b, ts, n in rows}


def shadow_compare(db, workspace_id, served: dict) -> None:
    """Log differences between the served totals and the table (sampled)."""
    if random.random() >= SHADOW_SAMPLE:
        return
    try:
        table = read_pairs(db, workspace_id)
    except Exception:
        logger.warning("dm_pair_summary shadow read failed", exc_info=True)
        return
    diff = {pair: (served.get(pair), table.get(pair)) for pair in set(served) | set(table)
            if (served.get(pair) or [None, None])[1] != (table.get(pair) or [None, None])[1]}
    if diff:
        sample = dict(list(diff.items())[:5])
        logger.warning("dm_pair_summary shadow mismatch workspace=%s pairs=%d sample=%s",
                       workspace_id, len(diff), sample)


def _aggregate(conn, workspace_id) -> dict:
    from app.services.conversation_queries import conversation_pairs_query
    return {(r.agent_a, r.agent_b): (r.last_ts, r.msg_count)
            for r in conn.execute(conversation_pairs_query(str(workspace_id), 1_000_000_000))}


def backfill_workspace(engine, workspace_id, statement_timeout_ms: int = BACKFILL_STATEMENT_TIMEOUT_MS) -> dict:
    """Add a workspace's full history to its rows, exactly once. Idempotent:
    a workspace that is already backfilled is left untouched."""
    ws = str(workspace_id)
    postgres = engine.dialect.name == "postgresql"

    # 1. Aggregate A and current rows C from one snapshot.
    read_conn = engine.connect()
    try:
        if postgres:
            read_conn = read_conn.execution_options(isolation_level="REPEATABLE READ")
        with read_conn.begin():
            if postgres:
                read_conn.execute(text("SET TRANSACTION READ ONLY"))
                read_conn.execute(text(f"SET LOCAL statement_timeout = {int(statement_timeout_ms)}"))
            if read_conn.execute(select(DmSummaryBackfill.workspace_id).where(
                    DmSummaryBackfill.workspace_id == ws)).first() is not None:
                return {"workspace_id": ws, "skipped": "already backfilled"}
            started = time.monotonic()
            history = _aggregate(read_conn, ws)
            current = {(a, b): n for a, b, n in read_conn.execute(
                select(DmPairSummary.agent_a, DmPairSummary.agent_b, DmPairSummary.msg_count).where(
                    DmPairSummary.workspace_id == ws))}
            seconds = time.monotonic() - started
    finally:
        read_conn.close()

    # 2. Apply A - C on top of the live rows; claim the workspace first so a
    #    concurrent or repeated backfill can never add the history twice.
    if postgres:
        from sqlalchemy.dialects.postgresql import insert
    else:
        from sqlalchemy.dialects.sqlite import insert
    with engine.begin() as conn:
        claim = insert(DmSummaryBackfill).values(workspace_id=ws).on_conflict_do_nothing(
            index_elements=["workspace_id"]).returning(DmSummaryBackfill.workspace_id)
        if conn.execute(claim).first() is None:
            return {"workspace_id": ws, "skipped": "already backfilled"}
        changed = 0
        for pair in set(history) | set(current):
            last_ts, count = history.get(pair, (0, 0))
            delta = count - current.get(pair, 0)
            if delta == 0 and pair in current:
                if last_ts:
                    conn.execute(DmPairSummary.__table__.update().where(
                        DmPairSummary.workspace_id == ws, DmPairSummary.agent_a == pair[0],
                        DmPairSummary.agent_b == pair[1], DmPairSummary.last_ts < last_ts).values(last_ts=last_ts))
                continue
            stmt = insert(DmPairSummary).values(workspace_id=ws, agent_a=pair[0], agent_b=pair[1],
                                                msg_count=delta, last_ts=last_ts or 0)
            stmt = stmt.on_conflict_do_update(
                index_elements=["workspace_id", "agent_a", "agent_b"],
                set_={"msg_count": DmPairSummary.msg_count + stmt.excluded.msg_count,
                      "last_ts": _greatest(postgres, DmPairSummary.last_ts, stmt.excluded.last_ts)})
            conn.execute(stmt)
            changed += 1
    _backfilled[ws] = time.time()
    return {"workspace_id": ws, "pairs": len(history), "changed": changed, "aggregate_seconds": round(seconds, 1)}


def _greatest(postgres, a, b):
    from sqlalchemy import func
    return func.greatest(a, b) if postgres else func.max(a, b)
