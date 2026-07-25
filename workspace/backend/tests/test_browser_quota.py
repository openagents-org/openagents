# -*- coding: utf-8 -*-
"""Tests for per-workspace browser tab quota and the idle-tab reaper."""

import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

from app.models import BrowserTab
from app.routers.browser import reap_idle_tabs
from tests.conftest import TestingSessionLocal


def _create_workspace(client, name="Quota Test Workspace"):
    resp = client.post("/v1/workspaces", json={
        "name": name, "agent_name": "agent-quota", "creator_email": "test@example.com",
    })
    assert resp.status_code == 200
    data = resp.json()["data"]
    return {"id": data["workspaceId"], "token": data["token"]}


def _mock_manager():
    manager = MagicMock()
    manager.is_cloud = False
    manager.get_session_id.return_value = None
    manager.get_live_url.return_value = None
    manager.open_tab = AsyncMock(return_value={"url": "https://example.com", "title": "Example"})
    manager.close_tab = AsyncMock()
    return manager


def _open_tab(client, workspace, url="https://example.com"):
    return client.post("/v1/browser/tabs", json={
        "url": url, "network": workspace["id"], "source": "openagents:agent-quota",
    }, headers={"X-Workspace-Token": workspace["token"]})


class TestWorkspaceQuota:
    @patch("app.routers.browser.MAX_TABS_PER_WORKSPACE", 2)
    @patch("app.routers.browser.BrowserManager")
    def test_quota_enforced_per_workspace(self, mock_bm, client):
        mock_bm.get.return_value = _mock_manager()
        mock_bm.provision_workspace_key = AsyncMock(return_value=None)
        ws = _create_workspace(client)
        assert _open_tab(client, ws).status_code == 200
        assert _open_tab(client, ws).status_code == 200
        resp = _open_tab(client, ws)
        assert resp.status_code == 400
        data = resp.json()["data"]
        assert data["error_code"] == "BROWSER_QUOTA_EXCEEDED"
        assert len(data["open_tabs"]) == 2
        assert "hint" in data

    @patch("app.routers.browser.MAX_TABS_PER_WORKSPACE", 1)
    @patch("app.routers.browser.BrowserManager")
    def test_quota_does_not_leak_across_workspaces(self, mock_bm, client):
        mock_bm.get.return_value = _mock_manager()
        mock_bm.provision_workspace_key = AsyncMock(return_value=None)
        ws_a = _create_workspace(client, "A")
        ws_b = _create_workspace(client, "B")
        assert _open_tab(client, ws_a).status_code == 200
        assert _open_tab(client, ws_a).status_code == 400
        assert _open_tab(client, ws_b).status_code == 200  # B unaffected

    @patch("app.routers.browser.MAX_TABS_PER_WORKSPACE", 1)
    @patch("app.routers.browser.BrowserManager")
    def test_closed_tab_frees_slot(self, mock_bm, client):
        mock_bm.get.return_value = _mock_manager()
        mock_bm.provision_workspace_key = AsyncMock(return_value=None)
        ws = _create_workspace(client)
        tab = _open_tab(client, ws).json()["data"]
        assert _open_tab(client, ws).status_code == 400
        resp = client.delete(f"/v1/browser/tabs/{tab['id']}", headers={"X-Workspace-Token": ws["token"]})
        assert resp.status_code == 200
        assert _open_tab(client, ws).status_code == 200


class TestIdleReaper:
    @patch("app.routers.browser.BrowserManager")
    def test_reaper_closes_idle_tabs_only(self, mock_bm, client):
        manager = _mock_manager()
        mock_bm.get.return_value = manager
        mock_bm.provision_workspace_key = AsyncMock(return_value=None)
        ws = _create_workspace(client)
        idle = _open_tab(client, ws, "https://idle.example.com").json()["data"]
        fresh = _open_tab(client, ws, "https://fresh.example.com").json()["data"]

        db = TestingSessionLocal()
        db.get(BrowserTab, idle["id"]).last_active_at = datetime.now(timezone.utc) - timedelta(hours=1)
        db.commit()
        db.close()

        closed = asyncio.run(reap_idle_tabs(session_factory=TestingSessionLocal))
        assert closed == 1
        db = TestingSessionLocal()
        assert db.get(BrowserTab, idle["id"]).status == "closed"
        assert db.get(BrowserTab, fresh["id"]).status == "active"
        db.close()
        manager.close_tab.assert_awaited()

    @patch("app.routers.browser.BrowserManager")
    def test_reaper_noop_when_nothing_idle(self, mock_bm, client):
        manager = _mock_manager()
        mock_bm.get.return_value = manager
        mock_bm.provision_workspace_key = AsyncMock(return_value=None)
        ws = _create_workspace(client)
        _open_tab(client, ws)
        closed = asyncio.run(reap_idle_tabs(session_factory=TestingSessionLocal))
        assert closed == 0
        manager.close_tab.assert_not_awaited()
