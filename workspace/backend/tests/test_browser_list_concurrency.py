"""Tab listing releases DB transactions while awaiting the live browser."""

import asyncio
import threading
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
