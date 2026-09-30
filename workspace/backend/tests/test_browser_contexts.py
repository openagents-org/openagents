# -*- coding: utf-8 -*-
"""
Tests for persistent browser contexts.

BrowserManager is mocked since we don't run real Browserbase sessions in tests.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _create_workspace(client):
    resp = client.post("/v1/workspaces", json={
        "name": "Browser Test Workspace",
        "agent_name": "agent-browser",
        "creator_email": "test@example.com",
    })
    assert resp.status_code == 200
    data = resp.json()["data"]
    return {
        "id": data["workspaceId"],
        "slug": data["slug"],
        "token": data["token"],
    }


@pytest.fixture(autouse=True)
def _global_bf_key(monkeypatch):
    # A configured global key makes _resolve_bf_key return early instead of
    # awaiting BrowserManager.provision_workspace_key on the (non-async) class
    # mock. The manager mock below still reports local mode for that key.
    monkeypatch.setattr("app.routers.browser.BROWSERFABRIC_API_KEY", "bf_test_key")


def _mock_manager():
    manager = MagicMock()
    manager.is_cloud = False
    manager.is_cloud_for = MagicMock(return_value=False)
    manager.get_session_id.return_value = None
    manager.get_live_url.return_value = None
    manager.open_tab = AsyncMock(return_value={"url": "https://example.com", "title": "Example"})
    manager.close_tab = AsyncMock(return_value=(True, None))  # (released, error)
    manager.delete_bb_context = MagicMock()
    return manager


def _open_tab(client, workspace, manager, url="https://example.com"):
    manager.open_tab = AsyncMock(return_value={"url": url, "title": "Test Page"})
    resp = client.post("/v1/browser/tabs", json={
        "url": url,
        "network": workspace["id"],
        "source": "human:user",
    }, headers={"X-Workspace-Token": workspace["token"]})
    assert resp.status_code == 200, resp.json()
    return resp.json()["data"]


def _persist_tab(client, workspace, tab_id, name):
    return client.post(
        f"/v1/browser/tabs/{tab_id}/persist",
        json={"name": name},
        headers={"X-Workspace-Token": workspace["token"]},
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestPersistTab:
    """POST /v1/browser/tabs/{tab_id}/persist"""

    @patch("app.routers.browser.BrowserManager")
    def test_persist_tab_creates_context(self, MockManager, client):
        ws = _create_workspace(client)
        manager = _mock_manager()
        MockManager.get.return_value = manager

        tab = _open_tab(client, ws, manager, url="https://linkedin.com/feed")
        resp = _persist_tab(client, ws, tab["id"], "LinkedIn Account")

        assert resp.status_code == 200
        data = resp.json()["data"]
        ctx = data["context"]
        assert ctx["name"] == "LinkedIn Account"
        assert ctx["domain"] == "linkedin.com"
        assert ctx["status"] == "active"
        assert data["tab"]["context_id"] == ctx["id"]

    @patch("app.routers.browser.BrowserManager")
    def test_persist_tab_rejects_duplicate_name(self, MockManager, client):
        ws = _create_workspace(client)
        manager = _mock_manager()
        MockManager.get.return_value = manager

        tab1 = _open_tab(client, ws, manager, url="https://linkedin.com")
        resp = _persist_tab(client, ws, tab1["id"], "My Account")
        assert resp.status_code == 200

        tab2 = _open_tab(client, ws, manager, url="https://twitter.com")
        resp = _persist_tab(client, ws, tab2["id"], "My Account")
        assert resp.status_code == 400
        assert "already exists" in resp.json()["message"]

    @patch("app.routers.browser.BrowserManager")
    def test_persist_already_persistent_tab(self, MockManager, client):
        ws = _create_workspace(client)
        manager = _mock_manager()
        MockManager.get.return_value = manager

        tab = _open_tab(client, ws, manager)
        _persist_tab(client, ws, tab["id"], "First Name")

        resp = _persist_tab(client, ws, tab["id"], "Second Name")
        assert resp.status_code == 400
        assert "already persistent" in resp.json()["message"]


class TestListContexts:
    """GET /v1/browser/contexts"""

    @patch("app.routers.browser.BrowserManager")
    def test_list_contexts(self, MockManager, client):
        ws = _create_workspace(client)
        manager = _mock_manager()
        MockManager.get.return_value = manager

        tab1 = _open_tab(client, ws, manager, url="https://linkedin.com")
        _persist_tab(client, ws, tab1["id"], "LinkedIn")

        tab2 = _open_tab(client, ws, manager, url="https://google.com")
        _persist_tab(client, ws, tab2["id"], "Google Search Console")

        resp = client.get(
            "/v1/browser/contexts",
            params={"network": ws["id"]},
            headers={"X-Workspace-Token": ws["token"]},
        )
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["total"] == 2
        names = {c["name"] for c in data["contexts"]}
        assert names == {"LinkedIn", "Google Search Console"}

    @patch("app.routers.browser.BrowserManager")
    def test_list_contexts_empty(self, MockManager, client):
        ws = _create_workspace(client)

        resp = client.get(
            "/v1/browser/contexts",
            params={"network": ws["id"]},
            headers={"X-Workspace-Token": ws["token"]},
        )
        assert resp.status_code == 200
        assert resp.json()["data"]["total"] == 0


class TestDeleteContext:
    """DELETE /v1/browser/contexts/{context_id}"""

    @patch("app.routers.browser.BrowserManager")
    def test_delete_context(self, MockManager, client):
        ws = _create_workspace(client)
        manager = _mock_manager()
        MockManager.get.return_value = manager

        tab = _open_tab(client, ws, manager)
        resp = _persist_tab(client, ws, tab["id"], "Temp Session")
        ctx_id = resp.json()["data"]["context"]["id"]

        resp = client.delete(
            f"/v1/browser/contexts/{ctx_id}",
            headers={"X-Workspace-Token": ws["token"]},
        )
        assert resp.status_code == 200
        assert resp.json()["data"]["status"] == "deleted"

        # Verify removed from listing
        resp = client.get(
            "/v1/browser/contexts",
            params={"network": ws["id"]},
            headers={"X-Workspace-Token": ws["token"]},
        )
        assert resp.json()["data"]["total"] == 0

    @patch("app.routers.browser.BrowserManager")
    def test_delete_context_unlinks_tabs(self, MockManager, client):
        ws = _create_workspace(client)
        manager = _mock_manager()
        MockManager.get.return_value = manager

        tab = _open_tab(client, ws, manager)
        resp = _persist_tab(client, ws, tab["id"], "Will Delete")
        ctx_id = resp.json()["data"]["context"]["id"]

        # Tab should have context_id
        resp = client.get(
            f"/v1/browser/tabs/{tab['id']}",
            headers={"X-Workspace-Token": ws["token"]},
        )
        assert resp.json()["data"]["context_id"] == ctx_id

        # Delete context
        client.delete(
            f"/v1/browser/contexts/{ctx_id}",
            headers={"X-Workspace-Token": ws["token"]},
        )

        # Tab should no longer have context_id
        resp = client.get(
            f"/v1/browser/tabs/{tab['id']}",
            headers={"X-Workspace-Token": ws["token"]},
        )
        assert resp.json()["data"].get("context_id") is None


class TestOpenTabWithContext:
    """POST /v1/browser/tabs with context_id"""

    @patch("app.routers.browser.BrowserManager")
    def test_open_tab_with_context(self, MockManager, client):
        ws = _create_workspace(client)
        manager = _mock_manager()
        MockManager.get.return_value = manager

        # Create a persistent context
        tab = _open_tab(client, ws, manager, url="https://linkedin.com")
        resp = _persist_tab(client, ws, tab["id"], "LinkedIn")
        ctx_id = resp.json()["data"]["context"]["id"]

        # Close the original tab
        client.delete(
            f"/v1/browser/tabs/{tab['id']}",
            headers={"X-Workspace-Token": ws["token"]},
        )

        # Open a new tab with the saved context
        resp = client.post("/v1/browser/tabs", json={
            "url": "about:blank",
            "network": ws["id"],
            "source": "human:user",
            "context_id": ctx_id,
        }, headers={"X-Workspace-Token": ws["token"]})
        assert resp.status_code == 200
        new_tab = resp.json()["data"]
        assert new_tab["context_id"] == ctx_id

    @patch("app.routers.browser.BrowserManager")
    def test_open_tab_with_invalid_context(self, MockManager, client):
        ws = _create_workspace(client)
        manager = _mock_manager()
        MockManager.get.return_value = manager

        resp = client.post("/v1/browser/tabs", json={
            "url": "about:blank",
            "network": ws["id"],
            "source": "human:user",
            "context_id": "nonexistent-id",
        }, headers={"X-Workspace-Token": ws["token"]})
        assert resp.status_code == 404
        assert "context not found" in resp.json()["message"].lower()


class TestUnpersistTab:
    """POST /v1/browser/tabs/{tab_id}/unpersist"""

    @patch("app.routers.browser.BrowserManager")
    def test_unpersist_tab(self, MockManager, client):
        ws = _create_workspace(client)
        manager = _mock_manager()
        MockManager.get.return_value = manager

        tab = _open_tab(client, ws, manager)
        resp = _persist_tab(client, ws, tab["id"], "My Session")
        assert resp.status_code == 200

        # Tab should be persistent
        resp = client.get(
            f"/v1/browser/tabs/{tab['id']}",
            headers={"X-Workspace-Token": ws["token"]},
        )
        assert resp.json()["data"]["context_id"] is not None

        # Unpersist
        resp = client.post(
            f"/v1/browser/tabs/{tab['id']}/unpersist",
            headers={"X-Workspace-Token": ws["token"]},
        )
        assert resp.status_code == 200
        assert resp.json()["data"].get("context_id") is None

        # Context should be deleted
        resp = client.get(
            "/v1/browser/contexts",
            params={"network": ws["id"]},
            headers={"X-Workspace-Token": ws["token"]},
        )
        assert resp.json()["data"]["total"] == 0

    @patch("app.routers.browser.BrowserManager")
    def test_unpersist_non_persistent_tab(self, MockManager, client):
        ws = _create_workspace(client)
        manager = _mock_manager()
        MockManager.get.return_value = manager

        tab = _open_tab(client, ws, manager)
        resp = client.post(
            f"/v1/browser/tabs/{tab['id']}/unpersist",
            headers={"X-Workspace-Token": ws["token"]},
        )
        assert resp.status_code == 400
        assert "not persistent" in resp.json()["message"]


class TestCloseTabWithContext:
    """DELETE /v1/browser/tabs/{tab_id} — persistent context preserved"""

    @patch("app.routers.browser.BrowserManager")
    def test_close_persistent_tab_preserves_context(self, MockManager, client):
        ws = _create_workspace(client)
        manager = _mock_manager()
        MockManager.get.return_value = manager

        tab = _open_tab(client, ws, manager)
        resp = _persist_tab(client, ws, tab["id"], "My Session")
        ctx_id = resp.json()["data"]["context"]["id"]

        # Close the tab
        resp = client.delete(
            f"/v1/browser/tabs/{tab['id']}",
            headers={"X-Workspace-Token": ws["token"]},
        )
        assert resp.status_code == 200
        assert resp.json()["data"]["context_preserved"] is True

        # Context should still exist
        resp = client.get(
            "/v1/browser/contexts",
            params={"network": ws["id"]},
            headers={"X-Workspace-Token": ws["token"]},
        )
        assert resp.json()["data"]["total"] == 1
        assert resp.json()["data"]["contexts"][0]["id"] == ctx_id


# ---------------------------------------------------------------------------
# Permanent-from-birth tabs, tab kinds, quotas and activity
# ---------------------------------------------------------------------------

class TestPermanentTabs:
    """POST /v1/browser/tabs with persistent=true + kind/limits/activity in listings."""

    @patch("app.routers.browser.BrowserManager")
    def test_open_permanent_tab_creates_context_named_after_host(self, MockManager, client):
        ws = _create_workspace(client)
        manager = _mock_manager()
        MockManager.get.return_value = manager
        manager.open_tab = AsyncMock(return_value={"url": "https://www.linkedin.com/feed", "title": "Feed"})

        resp = client.post("/v1/browser/tabs", json={
            "url": "https://www.linkedin.com/feed",
            "network": ws["id"],
            "source": "human:user",
            "persistent": True,
        }, headers={"X-Workspace-Token": ws["token"]})
        assert resp.status_code == 200, resp.json()
        data = resp.json()["data"]
        assert data["kind"] == "permanent"
        assert data["persistent"] is True
        assert data["context_id"] == data["context"]["id"]
        assert data["context"]["name"] == "linkedin.com"
        assert data["context_name"] == "linkedin.com"

        # The manager was asked for a persistent BF session up front (no swap).
        _, kwargs = manager.open_tab.call_args
        assert kwargs.get("persist") is True

        # And the context shows up in the saved-sessions list.
        ctx_resp = client.get("/v1/browser/contexts", params={"network": ws["id"]},
                              headers={"X-Workspace-Token": ws["token"]})
        assert {c["name"] for c in ctx_resp.json()["data"]["contexts"]} == {"linkedin.com"}

    @patch("app.routers.browser.BrowserManager")
    def test_open_permanent_tab_dedupes_names(self, MockManager, client):
        ws = _create_workspace(client)
        manager = _mock_manager()
        MockManager.get.return_value = manager

        names = []
        for _ in range(2):
            manager.open_tab = AsyncMock(return_value={"url": "https://github.com", "title": "GitHub"})
            resp = client.post("/v1/browser/tabs", json={
                "url": "https://github.com", "network": ws["id"], "persistent": True, "name": "GitHub",
            }, headers={"X-Workspace-Token": ws["token"]})
            assert resp.status_code == 200, resp.json()
            names.append(resp.json()["data"]["context"]["name"])
        assert names == ["GitHub", "GitHub (2)"]

    @patch("app.routers.browser.BrowserManager")
    def test_default_open_is_temporary(self, MockManager, client):
        ws = _create_workspace(client)
        manager = _mock_manager()
        MockManager.get.return_value = manager

        tab = _open_tab(client, ws, manager)
        assert tab["kind"] == "temporary"
        assert tab["persistent"] is False
        _, kwargs = manager.open_tab.call_args
        assert not kwargs.get("persist")

    @patch("app.routers.browser.BrowserManager")
    def test_list_reports_limits_per_kind(self, MockManager, client):
        ws = _create_workspace(client)
        manager = _mock_manager()
        MockManager.get.return_value = manager
        manager.get_current_url = AsyncMock(return_value=None)

        _open_tab(client, ws, manager, url="https://a.example")
        client.post("/v1/browser/tabs", json={
            "url": "https://b.example", "network": ws["id"], "persistent": True,
        }, headers={"X-Workspace-Token": ws["token"]})

        resp = client.get("/v1/browser/tabs", params={"network": ws["id"]},
                          headers={"X-Workspace-Token": ws["token"]})
        assert resp.status_code == 200
        data = resp.json()["data"]
        kinds = sorted(t["kind"] for t in data["tabs"])
        assert kinds == ["permanent", "temporary"]
        limits = data["limits"]
        assert limits["temporary"]["used"] == 1 and limits["temporary"]["max"] >= 1
        assert limits["permanent"]["used"] == 1 and limits["permanent"]["max"] >= 1
        assert limits["temporary_idle_minutes"] > 0

    @patch("app.routers.browser.BrowserManager")
    def test_agent_click_shows_up_as_activity(self, MockManager, client):
        ws = _create_workspace(client)
        manager = _mock_manager()
        MockManager.get.return_value = manager
        manager.get_current_url = AsyncMock(return_value=None)
        manager.click = AsyncMock(return_value={"url": "https://a.example/x", "title": "X"})

        manager.open_tab = AsyncMock(return_value={"url": "https://a.example", "title": "A"})
        resp = client.post("/v1/browser/tabs", json={
            "url": "https://a.example", "network": ws["id"], "source": "openagents:scout",
        }, headers={"X-Workspace-Token": ws["token"]})
        tab = resp.json()["data"]
        assert tab["activity"] is None

        resp = client.post(f"/v1/browser/tabs/{tab['id']}/click", json={"selector": "#go"},
                           headers={"X-Workspace-Token": ws["token"]})
        assert resp.status_code == 200, resp.json()

        resp = client.get("/v1/browser/tabs", params={"network": ws["id"]},
                          headers={"X-Workspace-Token": ws["token"]})
        listed = next(t for t in resp.json()["data"]["tabs"] if t["id"] == tab["id"])
        assert listed["activity"]["action"] == "click"
        # Unattributed actions on an agent-created tab are that agent's.
        assert listed["activity"]["actor"] == "openagents:scout"
        assert listed["activity"]["at"]
