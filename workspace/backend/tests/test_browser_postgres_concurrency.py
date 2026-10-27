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


def test_explicit_recovery_serializes_two_workers_and_rejects_stale_retry(pg_engine, monkeypatch):
    """Exercise the actual endpoint with separate connections/process caches.

    Worker A pauses during provider creation while B tries to replace the same
    session. B must fail NOWAIT, and a later retry with the old ID must fail CAS
    validation rather than closing A's new session.
    """
    import asyncio
    from unittest.mock import AsyncMock, MagicMock

    from fastapi import HTTPException
    from sqlalchemy import text
    from sqlalchemy.orm import Session
    from app.models import BrowserTab
    from app.routers import browser

    ws_id = str(uuid.uuid4())
    tab_id = _insert_close_failed_tab(pg_engine, ws_id)
    with pg_engine.begin() as conn:
        conn.execute(text("UPDATE browser_tabs SET status='active', close_status='open' WHERE id=:id"), {'id': tab_id})

    local = threading.local()
    entered, release = threading.Event(), threading.Event()
    calls, outcomes = [], []
    monkeypatch.setattr(browser, '_verify_workspace_access', lambda *a: True)
    monkeypatch.setattr(browser, '_resolve_bf_key', AsyncMock(return_value=('test-key', 'global')))
    monkeypatch.setattr(browser, '_attach_saved_context', AsyncMock())
    monkeypatch.setattr(browser, 'resolve_tab_key', lambda *a: 'test-key')
    monkeypatch.setattr(browser.BrowserManager, 'get', lambda: local.manager)

    def make_manager():
        manager = MagicMock()
        manager.reconnect = AsyncMock()
        manager.get_session_id.return_value = 'sess-new'
        manager.get_live_url.return_value = 'new-link'

        async def close(*args, **kwargs):
            calls.append(('close', kwargs['session_id_hint']))
            return True, None

        async def create(*args, **kwargs):
            calls.append(('create', 'sess-new'))
            entered.set()
            assert await asyncio.to_thread(release.wait, 5), 'contender did not finish'
            return {'url': 'https://example.com', 'title': 'Restored'}

        manager.close_tab = close
        manager.open_tab = create
        return manager

    def run_worker():
        local.manager = make_manager()
        with Session(pg_engine, autoflush=False) as db:
            try:
                response = asyncio.run(browser.reconnect_tab(
                    tab_id, reopen=False, confirm_replace=True, expected_session_id='sess-race',
                    x_workspace_token='x', authorization=None, db=db,
                ))
                outcomes.append(response.status_code if hasattr(response, "status_code") else 200)
            except HTTPException as exc:
                outcomes.append(exc.status_code)
            except BaseException as exc:
                outcomes.append(exc)

    first = threading.Thread(target=run_worker)
    first.start()
    assert entered.wait(5), 'first worker never reached provider creation'
    second = threading.Thread(target=run_worker)
    second.start()
    second.join(5)
    try:
        assert not second.is_alive(), 'second worker blocked instead of returning conflict'
        assert outcomes == [409]
    finally:
        release.set()
        first.join(5)
    assert all(isinstance(value, int) for value in outcomes), outcomes
    assert sorted(outcomes) == [200, 409]
    assert calls == [('close', 'sess-race'), ('create', 'sess-new')]

    # After A has committed, the same old request still must not replace A.
    run_worker()
    assert outcomes[-1] == 409
    assert calls == [('close', 'sess-race'), ('create', 'sess-new')]
    with Session(pg_engine) as db:
        assert db.get(BrowserTab, tab_id).session_id == 'sess-new'


def test_recovery_mapping_cas_drops_stale_write_on_postgres(pg_engine):
    from fastapi import HTTPException
    from sqlalchemy import text
    from sqlalchemy.orm import Session
    from app.models import BrowserTab
    from app.routers.browser import _replace_session_mapping

    tab_id = _insert_close_failed_tab(pg_engine, str(uuid.uuid4()))
    with Session(pg_engine, autoflush=False) as stale:
        tab = stale.get(BrowserTab, tab_id)
        with pg_engine.begin() as conn:
            conn.execute(text("UPDATE browser_tabs SET session_id='current-session' WHERE id=:id"), {'id': tab_id})
        with pytest.raises(HTTPException) as exc:
            _replace_session_mapping(stale, tab, 'sess-race', 'closed', 'stale-replacement', 'stale-link')
        assert exc.value.status_code == 409
        stale.rollback()
        assert stale.get(BrowserTab, tab_id).session_id == 'current-session'
