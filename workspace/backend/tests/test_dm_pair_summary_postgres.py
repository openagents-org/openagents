"""dm_pair_summaries trigger + backfill against a real PostgreSQL.

Opt in with OPENAGENTS_TEST_POSTGRES_SCRATCH_URL pointing at a scratch
database: the test creates and drops its own events / dm_pair_summaries /
dm_summary_backfills tables there. The trigger SQL is loaded from migration
101 itself, and every check compares against conversation_pairs_query, the
aggregate the DM list uses today.
"""
import importlib.util
import os
import pathlib
import random
import threading
import uuid

import pytest
from sqlalchemy import create_engine, text

from app.models import DmPairSummary, DmSummaryBackfill, EventRecord
from app.services import dm_pair_summary
from app.services.conversation_queries import conversation_pairs_query

URL = os.getenv("OPENAGENTS_TEST_POSTGRES_SCRATCH_URL")
pytestmark = pytest.mark.skipif(not URL, reason="requires a scratch PostgreSQL database")

WS = "11111111-1111-4111-8111-111111111111"
OTHER = "22222222-2222-4222-8222-222222222222"
ADDRESSES = ["human:adam@acme.test", "human:mia@acme.test", "openagents:alpha", "openagents:beta",
             "openagents:gamma", "human:system", "Human:System"]
TABLES = [EventRecord.__table__, DmPairSummary.__table__, DmSummaryBackfill.__table__]


def _migration():
    path = pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions" / "101_dm_pair_summaries.py"
    spec = importlib.util.spec_from_file_location("m101", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def pg(monkeypatch):
    engine = create_engine(URL)
    with engine.begin() as conn:
        conn.execute(text("DROP TRIGGER IF EXISTS events_dm_pair_summary ON events"))
        for table in reversed(TABLES):
            table.drop(conn, checkfirst=True)
        for table in TABLES:
            table.create(conn)
    monkeypatch.setattr(dm_pair_summary, "_backfilled", {})
    yield engine
    with engine.begin() as conn:
        for table in reversed(TABLES):
            table.drop(conn, checkfirst=True)
        conn.execute(text("DROP FUNCTION IF EXISTS dm_pair_summary_apply()"))
    engine.dispose()


def install_trigger(engine):
    m = _migration()
    with engine.begin() as conn:
        conn.execute(text(m.FUNCTION_SQL))
        conn.execute(text(m.TRIGGER_SQL))


def insert(conn, rng, ws=WS, ts=None, **overrides):
    row = dict(id=str(uuid.uuid4()), network_id=ws, type="workspace.message.posted",
               source=rng.choice(ADDRESSES), target=rng.choice(ADDRESSES), payload={}, metadata_={},
               timestamp=ts if ts is not None else rng.randint(1, 10_000), visibility="direct")
    roll = rng.random()
    if roll < 0.1:
        row["visibility"] = "channel"
    elif roll < 0.15:
        row["type"] = "workspace.message.status"
    elif roll < 0.2:
        row["target"] = "channel/general"
    row.update(overrides)
    conn.execute(EventRecord.__table__.insert().values(**{("metadata" if k == "metadata_" else k): v for k, v in row.items()}))
    return row["id"]


def expected(conn, ws=WS):
    return {(r.agent_a, r.agent_b): [r.last_ts, r.msg_count]
            for r in conn.execute(conversation_pairs_query(ws, 1_000_000))}


def table(conn, ws=WS):
    return dm_pair_summary.read_pairs(conn, ws)


def random_ops(engine, rng, n):
    with engine.begin() as conn:
        for _ in range(n):
            roll = rng.random()
            ids = [r[0] for r in conn.execute(text("select id from events order by random() limit 1"))]
            if roll < 0.6 or not ids:
                insert(conn, rng, ws=rng.choice([WS, WS, OTHER]))
            elif roll < 0.8:
                conn.execute(text("delete from events where id = :id"), {"id": ids[0]})
            else:
                column, value = rng.choice([("target", rng.choice(ADDRESSES)), ("source", rng.choice(ADDRESSES)),
                                            ("visibility", rng.choice(["direct", "channel"])),
                                            ("timestamp", rng.randint(1, 10_000)),
                                            ("type", rng.choice(["workspace.message.posted", "x"])),
                                            ("payload", "{}")])
                conn.execute(text(f"update events set {column} = :v where id = :id"), {"v": value, "id": ids[0]})


def test_trigger_then_backfill_matches_the_aggregate_exactly(pg):
    rng = random.Random(7)
    with pg.begin() as conn:                      # history from before the migration
        for _ in range(400):
            insert(conn, rng, ws=rng.choice([WS, OTHER]))
    install_trigger(pg)
    random_ops(pg, rng, 300)                       # live traffic before the backfill
    result = dm_pair_summary.backfill_workspace(pg, WS)
    assert result["pairs"] > 0
    with pg.connect() as conn:
        assert table(conn) == expected(conn)
    random_ops(pg, rng, 400)                       # and after it
    assert dm_pair_summary.backfill_workspace(pg, WS)["skipped"] == "already backfilled"
    assert dm_pair_summary.backfill_workspace(pg, OTHER)["pairs"] > 0
    with pg.connect() as conn:
        assert table(conn) == expected(conn)
        assert table(conn, OTHER) == expected(conn, OTHER)


def test_messages_arriving_during_the_backfill_are_counted_once(pg):
    rng = random.Random(11)
    with pg.begin() as conn:
        for _ in range(3000):
            insert(conn, rng)
    install_trigger(pg)
    stop = threading.Event()

    def writer():
        local = random.Random(3)
        while not stop.is_set():
            random_ops(pg, local, 5)

    thread = threading.Thread(target=writer)
    thread.start()
    try:
        for _ in range(3):
            random_ops(pg, rng, 20)
        dm_pair_summary.backfill_workspace(pg, WS)
        for _ in range(3):
            random_ops(pg, rng, 20)
    finally:
        stop.set()
        thread.join()
    with pg.connect() as conn:
        assert table(conn) == expected(conn)


def test_deleting_the_newest_message_moves_last_ts_back(pg):
    install_trigger(pg)
    with pg.begin() as conn:
        rng = random.Random(1)
        insert(conn, rng, source="openagents:alpha", target="openagents:beta", ts=100, visibility="direct",
               type="workspace.message.posted")
        newest = insert(conn, rng, source="openagents:beta", target="openagents:alpha", ts=200,
                        visibility="direct", type="workspace.message.posted")
    dm_pair_summary.backfill_workspace(pg, WS)
    with pg.begin() as conn:
        assert table(conn) == {("openagents:alpha", "openagents:beta"): [200, 2]}
        conn.execute(text("delete from events where id = :id"), {"id": newest})
        assert table(conn) == {("openagents:alpha", "openagents:beta"): [100, 1]}
        conn.execute(text("delete from events where network_id = :ws"), {"ws": WS})
        assert table(conn) == {}
