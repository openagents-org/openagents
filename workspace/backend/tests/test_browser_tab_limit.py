# -*- coding: utf-8 -*-
"""A tab-limit refusal from Browser Fabric reaches the agent as an actionable 429."""
from unittest.mock import AsyncMock, patch

from tests.test_browser_contexts import _create_workspace, _global_bf_key, _mock_manager, _open_tab  # noqa: F401


def _try_open(client, ws):
    return client.post("/v1/browser/tabs", json={
        "url": "https://example.org", "network": ws["id"], "source": "openagents:agent-browser",
    }, headers={"X-Workspace-Token": ws["token"]})


@patch("app.routers.browser.BrowserManager")
def test_tab_limit_explains_and_lists_awake_tabs(MockManager, client):
    ws = _create_workspace(client)
    manager = _mock_manager()
    MockManager.get.return_value = manager
    open_tab = _open_tab(client, ws, manager, url="https://example.com/a")

    manager.open_tab = AsyncMock(side_effect=RuntimeError(
        "Browser Fabric error: Concurrent tab limit reached (5/5). Close a tab or let one go idle first."))
    resp = _try_open(client, ws)
    assert resp.status_code == 429
    body = resp.json()
    assert "5 of 5 browser tabs awake" in body["message"]
    assert "DELETE /v1/browser/tabs/{tab_id}" in body["message"]
    data = body["data"]
    assert data["error_code"] == "browser_tab_limit"
    assert (data["awake"], data["limit"], data["retry_after_seconds"]) == (5, 5, 60)
    assert [t["id"] for t in data["awake_tabs"]] == [open_tab["id"]]
    assert data["awake_tabs"][0]["url"] == "https://example.com/a"


@patch("app.routers.browser.BrowserManager")
def test_full_service_is_reported_separately(MockManager, client):
    ws = _create_workspace(client)
    manager = _mock_manager()
    MockManager.get.return_value = manager
    manager.open_tab = AsyncMock(side_effect=RuntimeError(
        "Browser Fabric error: Server at capacity (70 sessions max). Try again later."))
    resp = _try_open(client, ws)
    assert resp.status_code == 429
    assert resp.json()["data"]["error_code"] == "browser_service_full"


@patch("app.routers.browser.BrowserManager")
def test_other_open_failures_are_unchanged(MockManager, client):
    ws = _create_workspace(client)
    manager = _mock_manager()
    MockManager.get.return_value = manager
    manager.open_tab = AsyncMock(side_effect=RuntimeError("Browser Fabric error: navigation failed"))
    resp = _try_open(client, ws)
    assert resp.status_code == 400
    assert resp.json()["message"] == "Browser Fabric error: navigation failed"
