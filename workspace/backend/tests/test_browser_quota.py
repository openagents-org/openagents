# -*- coding: utf-8 -*-
"""
Tests for per-workspace browser tab quota, idle-tab reaping, and
navigation error transparency.

BrowserManager is mocked since we don't run real browser sessions in tests.
"""

import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.browser import BrowserNavigationError, classify_navigation_error
from app.models import BrowserTab
from app.routers.browser import reap_idle_tabs
from tests.conftest import TestingSessionLocal


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _create_workspace(client, name="Quota Test Workspace"):
    resp = client.post("/v1/workspaces", json={
        "name": name,
        "agent_name": "agent-quota",
        "creator_email": "test@example.com",
    })
    assert resp.status_code == 200
    data = resp.json()["data"]
    return {"id": data["workspaceId"], "token": data["token"]}


def _mock_manager():
    manager = MagicMock()
    manager.is_cloud = False
    manager._pages = {}
    manager.get_session_id.return_value = None
    manager.get_live_url.return_value = None
    manager.open_tab = AsyncMock(return_value={"url": "https://example.com", "title": "Example"})
    manager.close_tab = AsyncMock(return_value=True)  # remote close succeeded
    manager.navigate = AsyncMock(return_value={"url": "https://example.com", "title": "Example"})
    manager.prune_dead_sessions = AsyncMock(return_value=0)
    return manager


def _open_tab(client, workspace, url="https://example.com"):
    return client.post("/v1/browser/tabs", json={
        "url": url,
        "network": workspace["id"],
        "source": "openagents:agent-quota",
    }, headers={"X-Workspace-Token": workspace["token"]})


# ---------------------------------------------------------------------------
# Per-workspace quota
# ---------------------------------------------------------------------------

class TestWorkspaceQuota:

    @patch("app.routers.browser.MAX_TABS_PER_WORKSPACE", 2)
    @patch("app.routers.browser.BrowserManager")
    def test_quota_enforced_per_workspace(self, mock_bm, client):
        mock_bm.get.return_value = _mock_manager()
        mock_bm.provision_workspace_key = AsyncMock(return_value=None)
        workspace = _create_workspace(client)

        assert _open_tab(client, workspace).status_code == 200
        assert _open_tab(client, workspace).status_code == 200

        resp = _open_tab(client, workspace)
        assert resp.status_code == 400
        body = resp.json()
        assert "limit (2)" in body["message"]
        data = body["data"]
        assert data["error_code"] == "BROWSER_QUOTA_EXCEEDED"
        assert len(data["open_tabs"]) == 2
        for tab in data["open_tabs"]:
            assert tab["created_by"] == "openagents:agent-quota"
            assert tab["idle_seconds"] is not None
        assert "hint" in data

    @patch("app.routers.browser.MAX_TABS_PER_WORKSPACE", 1)
    @patch("app.routers.browser.BrowserManager")
    def test_quota_does_not_leak_across_workspaces(self, mock_bm, client):
        mock_bm.get.return_value = _mock_manager()
        mock_bm.provision_workspace_key = AsyncMock(return_value=None)
        ws_a = _create_workspace(client, "Workspace A")
        ws_b = _create_workspace(client, "Workspace B")

        assert _open_tab(client, ws_a).status_code == 200
        assert _open_tab(client, ws_a).status_code == 400
        # Workspace B is unaffected by A's full quota
        assert _open_tab(client, ws_b).status_code == 200

    @patch("app.routers.browser.MAX_TABS_PER_WORKSPACE", 1)
    @patch("app.routers.browser.BrowserManager")
    def test_closed_tab_frees_quota_slot(self, mock_bm, client):
        mock_bm.get.return_value = _mock_manager()
        mock_bm.provision_workspace_key = AsyncMock(return_value=None)
        workspace = _create_workspace(client)

        tab = _open_tab(client, workspace).json()["data"]
        assert _open_tab(client, workspace).status_code == 400

        resp = client.delete(f"/v1/browser/tabs/{tab['id']}",
                             headers={"X-Workspace-Token": workspace["token"]})
        assert resp.status_code == 200
        assert _open_tab(client, workspace).status_code == 200

    @patch("app.routers.browser.MAX_TABS_PER_WORKSPACE", 2)
    @patch("app.routers.browser.BrowserManager")
    def test_failed_open_releases_reserved_slot(self, mock_bm, client):
        manager = _mock_manager()
        mock_bm.get.return_value = manager
        mock_bm.provision_workspace_key = AsyncMock(return_value=None)
        workspace = _create_workspace(client)

        manager.open_tab = AsyncMock(side_effect=RuntimeError("Browser Fabric error: boom"))
        assert _open_tab(client, workspace).status_code == 400

        # The reserved slot must not stay occupied after the failure
        manager.open_tab = AsyncMock(return_value={"url": "https://example.com", "title": "Example"})
        assert _open_tab(client, workspace).status_code == 200
        assert _open_tab(client, workspace).status_code == 200


# ---------------------------------------------------------------------------
# Idle-tab reaper
# ---------------------------------------------------------------------------

class TestIdleReaper:

    @patch("app.routers.browser.BrowserManager")
    def test_reaper_closes_idle_tabs_only(self, mock_bm, client):
        manager = _mock_manager()
        mock_bm.get.return_value = manager
        mock_bm.provision_workspace_key = AsyncMock(return_value=None)
        workspace = _create_workspace(client)

        idle_tab = _open_tab(client, workspace, "https://idle.example.com").json()["data"]
        fresh_tab = _open_tab(client, workspace, "https://fresh.example.com").json()["data"]

        # Backdate the idle tab past the TTL
        db = TestingSessionLocal()
        record = db.get(BrowserTab, idle_tab["id"])
        record.last_active_at = datetime.now(timezone.utc) - timedelta(hours=1)
        db.commit()
        db.close()

        closed = asyncio.run(reap_idle_tabs(session_factory=TestingSessionLocal))
        assert closed == 1

        db = TestingSessionLocal()
        assert db.get(BrowserTab, idle_tab["id"]).status == "closed"
        assert db.get(BrowserTab, fresh_tab["id"]).status == "active"
        db.close()
        manager.close_tab.assert_awaited()

    @patch("app.routers.browser.BrowserManager")
    def test_delete_marks_closing_when_remote_close_fails(self, mock_bm, client):
        # DELETE returns success (tab gone from the user's list) but leaves the
        # row 'closing' — NOT 'closed' — so the reaper retries the remote close
        # instead of the BF session leaking forever.
        manager = _mock_manager()
        manager.close_tab = AsyncMock(return_value=False)
        mock_bm.get.return_value = manager
        mock_bm.provision_workspace_key = AsyncMock(return_value=None)
        workspace = _create_workspace(client)
        tab = _open_tab(client, workspace).json()["data"]

        resp = client.delete(f"/v1/browser/tabs/{tab['id']}",
                             headers={"X-Workspace-Token": workspace["token"]})
        assert resp.status_code == 200
        assert resp.json()["data"]["status"] == "closing"
        db = TestingSessionLocal()
        assert db.get(BrowserTab, tab["id"]).status == "closing"
        db.close()

    @patch("app.routers.browser.BrowserManager")
    def test_delete_marks_closed_when_remote_close_succeeds(self, mock_bm, client):
        manager = _mock_manager()  # close_tab returns True by default
        mock_bm.get.return_value = manager
        mock_bm.provision_workspace_key = AsyncMock(return_value=None)
        workspace = _create_workspace(client)
        tab = _open_tab(client, workspace).json()["data"]

        resp = client.delete(f"/v1/browser/tabs/{tab['id']}",
                             headers={"X-Workspace-Token": workspace["token"]})
        assert resp.status_code == 200
        db = TestingSessionLocal()
        assert db.get(BrowserTab, tab["id"]).status == "closed"
        db.close()

    @patch("app.routers.browser.BrowserManager")
    def test_reaper_noop_when_nothing_idle(self, mock_bm, client):
        manager = _mock_manager()
        mock_bm.get.return_value = manager
        mock_bm.provision_workspace_key = AsyncMock(return_value=None)
        workspace = _create_workspace(client)
        _open_tab(client, workspace)

        closed = asyncio.run(reap_idle_tabs(session_factory=TestingSessionLocal))
        assert closed == 0
        manager.close_tab.assert_not_awaited()

    @patch("app.routers.browser.BrowserManager")
    def test_reaper_leaves_tab_claimable_when_remote_close_fails(self, mock_bm, client):
        manager = _mock_manager()
        # Real close_tab RETURNS False on failure (it never raises); the reaper
        # must still leave the tab retryable, not mark it closed.
        manager.close_tab = AsyncMock(return_value=False)
        mock_bm.get.return_value = manager
        mock_bm.provision_workspace_key = AsyncMock(return_value=None)
        workspace = _create_workspace(client)

        tab = _open_tab(client, workspace, "https://idle.example.com").json()["data"]
        db = TestingSessionLocal()
        db.get(BrowserTab, tab["id"]).last_active_at = datetime.now(timezone.utc) - timedelta(hours=1)
        db.commit()
        db.close()

        closed = asyncio.run(reap_idle_tabs(session_factory=TestingSessionLocal))
        assert closed == 0
        # Remote close failed → the tab is claimed as "closing", not "closed",
        # so a later pass can retry it (never a spurious "closed").
        db = TestingSessionLocal()
        assert db.get(BrowserTab, tab["id"]).status == "closing"
        db.close()

    @patch("app.routers.browser.BrowserManager")
    def test_reaper_claim_frees_quota_slot(self, mock_bm, client):
        # A tab mid-close ("closing") must not count against the workspace quota.
        manager = _mock_manager()
        manager.close_tab = AsyncMock(return_value=False)  # remote close fails
        mock_bm.get.return_value = manager
        mock_bm.provision_workspace_key = AsyncMock(return_value=None)
        with patch("app.routers.browser.MAX_TABS_PER_WORKSPACE", 1):
            workspace = _create_workspace(client)
            tab = _open_tab(client, workspace, "https://idle.example.com").json()["data"]
            assert _open_tab(client, workspace).status_code == 400  # quota full

            db = TestingSessionLocal()
            db.get(BrowserTab, tab["id"]).last_active_at = datetime.now(timezone.utc) - timedelta(hours=1)
            db.commit()
            db.close()
            asyncio.run(reap_idle_tabs(session_factory=TestingSessionLocal))

            # Tab is now "closing" (remote close failed) → slot is free again
            assert _open_tab(client, workspace).status_code == 200


# ---------------------------------------------------------------------------
# Reads refresh idle time (so the reaper doesn't close an actively-read tab)
# ---------------------------------------------------------------------------

class TestReadRefreshesIdle:

    @patch("app.routers.browser.BrowserManager")
    def test_snapshot_touches_last_active(self, mock_bm, client):
        manager = _mock_manager()
        manager.snapshot = AsyncMock(return_value="<page snapshot>")
        manager.get_current_url = AsyncMock(return_value=None)
        mock_bm.get.return_value = manager
        mock_bm.provision_workspace_key = AsyncMock(return_value=None)
        workspace = _create_workspace(client)
        tab = _open_tab(client, workspace).json()["data"]

        # Backdate to just under the TTL, then read
        db = TestingSessionLocal()
        db.get(BrowserTab, tab["id"]).last_active_at = datetime.now(timezone.utc) - timedelta(minutes=9)
        db.commit()
        db.close()

        resp = client.get(f"/v1/browser/tabs/{tab['id']}/snapshot",
                          headers={"X-Workspace-Token": workspace["token"]})
        assert resp.status_code == 200

        db = TestingSessionLocal()
        idle = datetime.now(timezone.utc) - db.get(BrowserTab, tab["id"]).last_active_at.replace(tzinfo=timezone.utc)
        db.close()
        assert idle.total_seconds() < 60  # refreshed by the read


# ---------------------------------------------------------------------------
# Navigation error transparency
# ---------------------------------------------------------------------------

class TestNavigationErrors:

    @patch("app.routers.browser.BrowserManager")
    def test_navigate_surfaces_classified_error(self, mock_bm, client):
        manager = _mock_manager()
        mock_bm.get.return_value = manager
        mock_bm.provision_workspace_key = AsyncMock(return_value=None)
        workspace = _create_workspace(client)
        tab = _open_tab(client, workspace).json()["data"]

        manager.navigate = AsyncMock(
            side_effect=BrowserNavigationError("NAV_TIMEOUT", "Timeout 30000ms exceeded")
        )
        resp = client.post(f"/v1/browser/tabs/{tab['id']}/navigate",
                           json={"url": "https://slow.example.com"},
                           headers={"X-Workspace-Token": workspace["token"]})
        assert resp.status_code == 400
        body = resp.json()
        assert body["data"]["error_code"] == "NAV_TIMEOUT"
        assert "NAV_TIMEOUT" in body["message"]

    @patch("app.routers.browser.BrowserManager")
    def test_open_tab_reports_initial_navigation_error(self, mock_bm, client):
        manager = _mock_manager()
        manager.open_tab = AsyncMock(return_value={
            "url": "about:blank",
            "title": "",
            "navigation_error": {"code": "DNS_OR_TLS_ERROR", "message": "net::ERR_NAME_NOT_RESOLVED"},
        })
        mock_bm.get.return_value = manager
        mock_bm.provision_workspace_key = AsyncMock(return_value=None)
        workspace = _create_workspace(client)

        resp = _open_tab(client, workspace, "https://no-such-host.invalid")
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["navigation_error"]["code"] == "DNS_OR_TLS_ERROR"


def test_classify_navigation_error():
    assert classify_navigation_error(Exception("net::ERR_NAME_NOT_RESOLVED at https://x")) == "DNS_OR_TLS_ERROR"
    assert classify_navigation_error(Exception("Timeout 30000ms exceeded")) == "NAV_TIMEOUT"
    assert classify_navigation_error(Exception("net::ERR_BLOCKED_BY_CLIENT")) == "CONTENT_BLOCKED"
    assert classify_navigation_error(Exception("something odd")) == "NAVIGATION_FAILED"


# ---------------------------------------------------------------------------
# close_tab cleans up its per-tab BF key mapping even with an explicit key
# ---------------------------------------------------------------------------

def test_close_tab_pops_tab_key_even_with_explicit_key():
    import asyncio
    from unittest.mock import AsyncMock, patch
    from app.browser import BrowserManager

    mgr = BrowserManager()
    # Simulate cloud mode with a live session + stored per-tab key.
    with patch.object(BrowserManager, "is_cloud", property(lambda self: True)):
        mgr._sessions["tab-1"] = "sess-1"
        mgr._tab_keys["tab-1"] = "stored-key"
        mgr._bf_call = AsyncMock(return_value={"success": True})

        ok = asyncio.run(mgr.close_tab("tab-1", api_key="explicit-key"))
        assert ok is True
        # The mapping must be cleaned up (was leaking when api_key short-circuited).
        assert "tab-1" not in mgr._tab_keys
        # The explicit key won over the stored one.
        _, kwargs = mgr._bf_call.call_args
        assert kwargs.get("api_key") == "explicit-key"
