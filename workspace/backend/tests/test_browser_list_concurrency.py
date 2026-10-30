"""Tab listing releases DB transactions while awaiting the live browser."""

import asyncio
import threading
import time
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import event

from app.database import get_db
from app.main import app
from app.models import BrowserContext, BrowserTab
from app.routers import browser
from tests.conftest import TestingSessionLocal


@pytest.mark.parametrize("live_state", ["unchanged", "updated", "closed_during_lookup"])
def test_tab_list_scopes_database_work(client, workspace, db, monkeypatch, live_state):
    context = BrowserContext(
        workspace_id=workspace["id"], name="Account", created_by="human:user",
    )
    db.add(context)
    db.flush()
    tab = BrowserTab(
        workspace_id=workspace["id"], context_id=context.id,
        url="https://example.com/old", title="Old", created_by="human:user",
    )
    db.add(tab)
    db.commit()
    tab_id, context_id = tab.id, context.id
    db.close()

    sessions = []
    transaction_threads = []
    loop_threads = []

    def request_db():
        with TestingSessionLocal() as session:
            sessions.append(session)
            event.listen(session, "after_begin", lambda *args:
                         transaction_threads.append(threading.get_ident()))
            yield session

    monkeypatch.setitem(app.dependency_overrides, get_db, request_db)

    async def live_metadata(requested_id):
        assert requested_id == tab_id
        loop_threads.append(threading.get_ident())
        assert sessions and all(not s.in_transaction() for s in sessions)
        if live_state == "closed_during_lookup":
            def close_tab():
                with TestingSessionLocal() as other:
                    other.get(BrowserTab, tab_id).status = "closed"
                    other.commit()

            await asyncio.to_thread(close_tab)
        if live_state == "unchanged":
            return {"url": "https://example.com/old", "title": "Old"}
        return {"url": "https://example.com/new", "title": "New"}

    manager = MagicMock()
    manager.get_current_url = AsyncMock(side_effect=live_metadata)
    monkeypatch.setattr(browser.BrowserManager, "get", lambda: manager)

    response = client.get(
        "/v1/browser/tabs", params={"network": workspace["id"]},
        headers={"X-Workspace-Token": workspace["token"]},
    )
    assert response.status_code == 200, response.text
    result = response.json()["data"]
    assert result["total"] == 1
    returned_tab = result["tabs"][0]
    assert returned_tab["context_id"] == context_id
    assert returned_tab["context_name"] == "Account"
    assert returned_tab["persistent"] is True
    expected_title = "Old" if live_state == "unchanged" else "New"
    assert returned_tab["title"] == expected_title
    assert transaction_threads and loop_threads
    assert set(transaction_threads).isdisjoint(loop_threads)
    assert all(not s.in_transaction() for s in sessions)

    with TestingSessionLocal() as check:
        stored = check.get(BrowserTab, tab_id)
        if live_state == "closed_during_lookup":
            assert stored.status == "closed"
            assert stored.title == "Old"
            assert stored.url == "https://example.com/old"
        else:
            assert stored.title == expected_title
            assert stored.url == returned_tab["url"]


def test_tab_list_uses_one_deadline_and_keeps_completed_refreshes(client, workspace, db, monkeypatch):
    tabs = [BrowserTab(
        id=f"tab-{i}", workspace_id=workspace["id"],
        url="https://example.com/saved", title="Saved", created_by="human:user",
    ) for i in range(10)]
    db.add_all(tabs)
    db.commit()
    db.close()
    monkeypatch.setattr(browser, 'TAB_LIST_REFRESH_TIMEOUT_SECONDS', 0.05)
    active = peak = cancelled = 0

    async def metadata(tab_id):
        nonlocal active, peak, cancelled
        active += 1
        peak = max(peak, active)
        try:
            # Newest rows are first, so the fast result arrives before the
            # budget expires even though the remaining browsers are stalled.
            if tab_id == 'tab-9':
                return {"url": "https://example.com/live", "title": "Live"}
            await asyncio.sleep(0.3)
            return {"url": "https://example.com/late", "title": "Late"}
        except asyncio.CancelledError:
            cancelled += 1
            raise
        finally:
            active -= 1

    manager = MagicMock()
    manager.get_current_url = AsyncMock(side_effect=metadata)
    monkeypatch.setattr(browser.BrowserManager, 'get', lambda: manager)
    started = time.monotonic()
    response = client.get('/v1/browser/tabs', params={"network": workspace['id']},
                          headers={"X-Workspace-Token": workspace['token']})
    assert time.monotonic() - started < 0.5
    assert response.status_code == 200
    data = response.json()['data']
    assert data['total'] == 10
    assert next(t for t in data['tabs'] if t['id'] == 'tab-9')['title'] == 'Live'
    assert all(t['title'] == 'Saved' for t in data['tabs'] if t['id'] != 'tab-9')
    assert 1 < peak <= browser.TAB_LIST_REFRESH_CONCURRENCY
    assert cancelled > 0 and active == 0
    with TestingSessionLocal() as check:
        assert check.get(BrowserTab, 'tab-9').title == 'Live'
        assert check.get(BrowserTab, 'tab-0').title == 'Saved'
