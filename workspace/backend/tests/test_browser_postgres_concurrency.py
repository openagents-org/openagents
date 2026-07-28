# -*- coding: utf-8 -*-
"""
Real-PostgreSQL concurrency tests for the browser maintenance CAS claims.

These verify that the conditional-UPDATE claim used by the sweeper is a
genuine cross-connection arbiter, which SQLite cannot demonstrate (its
writer lock serialises everything). They need a real PostgreSQL server:

    export TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/openagents_test
    pytest -m postgres tests/test_browser_postgres_concurrency.py

Without TEST_DATABASE_URL the whole module is skipped. SQLite-based tests
in test_browser_tab_leak.py cover the same logic as controlled-interleaving
simulations; only this module exercises true concurrent transactions.
"""

import os
import threading
import uuid
from datetime import datetime, timezone

import pytest

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "")

pytestmark = [
    pytest.mark.postgres,
    pytest.mark.skipif(
        not TEST_DATABASE_URL.startswith("postgresql"),
        reason="TEST_DATABASE_URL not set to a PostgreSQL DSN",
    ),
]


@pytest.fixture
def pg_engine():
    from sqlalchemy import create_engine
    from app.database import Base
    import app.models  # noqa: F401 — register models

    engine = create_engine(TEST_DATABASE_URL)
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def _insert_close_failed_tab(engine, ws_id: str) -> str:
    from sqlalchemy import text
    tab_id = str(uuid.uuid4())
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO workspaces (id, name, slug, password_hash, status, created_at) "
            "VALUES (:id, 'pg-test', :slug, 'x', 'active', :now) ON CONFLICT DO NOTHING"
        ), {"id": ws_id, "slug": f"pg-{ws_id[:8]}", "now": datetime.now(timezone.utc)})
        conn.execute(text(
            "INSERT INTO browser_tabs (id, workspace_id, url, status, created_by, shared_with, "
            "session_id, session_closed, close_status, close_attempts, created_at, last_active_at) "
            "VALUES (:id, :ws, 'https://example.com', 'closed', 'human:user', '[]', "
            "'sess-race', FALSE, 'close_failed', 0, :now, :now)"
        ), {"id": tab_id, "ws": ws_id, "now": datetime.now(timezone.utc)})
    return tab_id


def test_only_one_worker_claims_a_close_failed_tab(pg_engine):
    """Two connections race the same CAS claim; exactly one rowcount==1."""
    from sqlalchemy import text

    ws_id = str(uuid.uuid4())
    tab_id = _insert_close_failed_tab(pg_engine, ws_id)

    barrier = threading.Barrier(2)
    results = []

    def claim():
        with pg_engine.connect() as conn:
            barrier.wait()
            with conn.begin():
                r = conn.execute(text(
                    "UPDATE browser_tabs SET close_status='closing', last_close_attempt_at=:now "
                    "WHERE id=:id AND close_status='close_failed' AND session_id='sess-race'"
                ), {"id": tab_id, "now": datetime.now(timezone.utc)})
                results.append(r.rowcount)

    threads = [threading.Thread(target=claim) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert sorted(results) == [0, 1], f"exactly one claim must win, got {results}"


def test_outcome_write_dropped_when_session_swapped(pg_engine):
    """A persist/reconnect swap between claim and outcome invalidates the
    outcome CAS — the new session's state is never clobbered."""
    from sqlalchemy import text

    ws_id = str(uuid.uuid4())
    tab_id = _insert_close_failed_tab(pg_engine, ws_id)

    with pg_engine.begin() as conn:
        # Sweeper claims the row (session snapshot: sess-race)
        r = conn.execute(text(
            "UPDATE browser_tabs SET close_status='closing' "
            "WHERE id=:id AND close_status='close_failed' AND session_id='sess-race'"
        ), {"id": tab_id})
        assert r.rowcount == 1

    with pg_engine.begin() as conn:
        # Meanwhile a reconnect swaps in a fresh session
        conn.execute(text(
            "UPDATE browser_tabs SET session_id='sess-new', close_status='open', session_closed=FALSE "
            "WHERE id=:id"
        ), {"id": tab_id})

    with pg_engine.begin() as conn:
        # Sweeper writes its outcome with the stale snapshot — must be a no-op
        r = conn.execute(text(
            "UPDATE browser_tabs SET close_status='closed', session_closed=TRUE "
            "WHERE id=:id AND close_status='closing' AND session_id='sess-race'"
        ), {"id": tab_id})
        assert r.rowcount == 0

    with pg_engine.connect() as conn:
        row = conn.execute(text(
            "SELECT session_id, close_status, session_closed FROM browser_tabs WHERE id=:id"
        ), {"id": tab_id}).one()
        assert row.session_id == "sess-new"
        assert row.close_status == "open"
        assert row.session_closed is False
