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


# ---------------------------------------------------------------------------
# #3: per-tab cloud detection + BF key threading
# ---------------------------------------------------------------------------

def test_is_cloud_tab_uses_where_the_tab_lives():
    from app.browser import BrowserManager
    mgr = BrowserManager()
    mgr._sessions["cloud-tab"] = "sess-1"
    mgr._pages["local-tab"] = object()
    assert mgr._is_cloud_tab("cloud-tab") is True
    assert mgr._is_cloud_tab("local-tab") is False


def test_navigate_threads_tab_id_so_per_tab_key_is_used():
    import asyncio
    from unittest.mock import AsyncMock, patch
    from app.browser import BrowserManager
    mgr = BrowserManager()
    with patch.object(BrowserManager, "is_cloud", property(lambda self: True)), \
         patch("app.browser._assert_navigable", new=AsyncMock()), \
         patch("app.browser.TRUSTED_BF_EGRESS", True):
        mgr._sessions["t1"] = "sess-1"
        mgr._tab_keys["t1"] = "ws-key"
        mgr._bf_call = AsyncMock(return_value={"result": {"url": "https://x", "title": "X"}})
        asyncio.run(mgr.navigate("t1", "https://x"))
        # Every BF call for this tab must carry tab_id so _key_for_tab resolves
        # the workspace key instead of the global default.
        for call in mgr._bf_call.call_args_list:
            assert call.kwargs.get("tab_id") == "t1"


def test_open_tab_uses_provisioned_key_without_global(monkeypatch):
    # No global key, but a provisioned api_key is passed → must go cloud, not local.
    import asyncio
    from unittest.mock import AsyncMock
    import app.browser as bmod
    monkeypatch.setattr(bmod, "BROWSERFABRIC_API_KEY", "")
    monkeypatch.setattr(bmod, "_assert_navigable", AsyncMock())
    monkeypatch.setattr(bmod, "TRUSTED_BF_EGRESS", True)
    mgr = bmod.BrowserManager()
    mgr._bf_call = AsyncMock(side_effect=[
        {"result": {"session_id": "s1"}},                # create_session
        {"result": {}},                                   # navigate
        {"result": {"url": "https://x", "title": "X"}},  # get_page_info
    ])
    result = asyncio.run(mgr.open_tab("t1", "https://x", api_key="prov-key"))
    assert mgr._sessions.get("t1") == "s1"  # a cloud session, not a local page
    assert "t1" not in mgr._pages


# ---------------------------------------------------------------------------
# #4: close_tab treats an explicit BF 'session gone' as success
# ---------------------------------------------------------------------------

def test_close_tab_treats_bf_session_gone_as_success():
    import asyncio
    from unittest.mock import AsyncMock, patch
    from app.browser import BrowserManager
    mgr = BrowserManager()
    with patch.object(BrowserManager, "is_cloud", property(lambda self: True)):
        mgr._sessions["t1"] = "sess-1"
        mgr._bf_call = AsyncMock(side_effect=RuntimeError("Browser Fabric error: session_not_found"))
        ok = asyncio.run(mgr.close_tab("t1"))
        assert ok is True  # already gone == closed


def test_close_tab_returns_false_on_generic_failure():
    import asyncio
    from unittest.mock import AsyncMock, patch
    from app.browser import BrowserManager
    mgr = BrowserManager()
    with patch.object(BrowserManager, "is_cloud", property(lambda self: True)):
        mgr._sessions["t1"] = "sess-1"
        mgr._bf_call = AsyncMock(side_effect=RuntimeError("Browser Fabric error: internal error"))
        ok = asyncio.run(mgr.close_tab("t1"))
        assert ok is False  # a real failure is not swallowed


class TestDeleteIdempotency:

    @patch("app.routers.browser.BrowserManager")
    def test_delete_already_closing_is_idempotent(self, mock_bm, client):
        manager = _mock_manager()
        mock_bm.get.return_value = manager
        mock_bm.provision_workspace_key = AsyncMock(return_value=None)
        workspace = _create_workspace(client)
        tab = _open_tab(client, workspace).json()["data"]

        # Mark it already 'closing' (as if a reaper/other DELETE claimed it)
        db = TestingSessionLocal()
        db.get(BrowserTab, tab["id"]).status = "closing"
        db.commit()
        db.close()

        resp = client.delete(f"/v1/browser/tabs/{tab['id']}",
                             headers={"X-Workspace-Token": workspace["token"]})
        assert resp.status_code == 200
        assert resp.json()["data"].get("idempotent") is True
        # No second remote close was attempted for an already-claimed tab.
        manager.close_tab.assert_not_awaited()


# ---------------------------------------------------------------------------
# #3 (cont): cloud detection for close works cross-worker (no global key)
# ---------------------------------------------------------------------------

def test_close_tab_uses_cloud_path_from_session_hint_without_global_key(monkeypatch):
    # A worker with NO global key and an empty in-memory map must still close a
    # BF session when given a session_id_hint + api_key (cross-worker reaper).
    import asyncio
    from unittest.mock import AsyncMock
    import app.browser as bmod
    monkeypatch.setattr(bmod, "BROWSERFABRIC_API_KEY", "")
    mgr = bmod.BrowserManager()  # is_cloud is False (no global key)
    assert mgr.is_cloud is False
    mgr._bf_call = AsyncMock(return_value={"success": True})
    ok = asyncio.run(mgr.close_tab("t1", session_id_hint="sess-remote", api_key="ws-key"))
    assert ok is True
    # It went through the cloud (BF) close path, not local.
    called = mgr._bf_call.call_args
    assert called.args[0] == "close_session"
    assert called.kwargs.get("api_key") == "ws-key"


def test_is_cloud_close_prefers_local_when_page_present():
    from app.browser import BrowserManager
    mgr = BrowserManager()
    mgr._pages["t-local"] = object()
    assert mgr._is_cloud_close("t-local") is False
    assert mgr._is_cloud_close("t-unknown", session_id_hint="s") is True
    assert mgr._is_cloud_close("t-unknown", api_key="k") is True


def test_prune_dead_sessions_runs_without_global_key(monkeypatch):
    import asyncio
    from unittest.mock import AsyncMock
    import app.browser as bmod
    monkeypatch.setattr(bmod, "BROWSERFABRIC_API_KEY", "")
    mgr = bmod.BrowserManager()
    mgr._sessions["t1"] = "sess-1"
    mgr._tab_keys["t1"] = "ws-key"
    # get_page_info raises → session considered dead → pruned
    mgr._bf_call = AsyncMock(side_effect=RuntimeError("boom"))
    pruned = asyncio.run(mgr.prune_dead_sessions())
    assert pruned == 1
    assert "t1" not in mgr._sessions
