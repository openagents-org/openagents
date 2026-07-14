# -*- coding: utf-8 -*-
"""
Tests for the shared-browser session-leak fixes.

Covers the leak classes from the bug report and the follow-up review:
  1. BF session created but a later step failed → session must be recorded
     and the caller must see explicit warnings (never silent success, never
     a lost session).
  2. Close/reconnect after a restart resolve the key from the credential
     reference persisted on the row (source + fingerprint, never plaintext);
     rotated credentials fail loudly instead of touching the old session
     with the new key.
  3. Failed/unknown closes keep session_closed=FALSE and step through the
     close_status state machine (close_failed → retries → retry_exhausted,
     never faked as released).
  4. The maintenance sweeper claims rows via CAS (close_status+session_id)
     so multiple replicas never double-process, and a persist/reconnect
     session swap is never clobbered.

Concurrency here is simulated via controlled interleavings on SQLite; the
true multi-connection race is verified in test_browser_postgres_concurrency
(PostgreSQL only, gated on TEST_DATABASE_URL).
"""

import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

import app.database as database
from app.browser import BrowserManager
from app.browser_creds import BrowserCredentialError, key_fingerprint, redact, resolve_tab_key
from app.models import BrowserContext, BrowserTab, BrowserUsage, Workspace
from tests.conftest import TestingSessionLocal

WS_KEY = "bf-secret-workspace-key-123456"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _create_workspace(client):
    resp = client.post("/v1/workspaces", json={
        "name": "Leak Test Workspace",
        "agent_name": "agent-leak",
        "creator_email": "test@example.com",
    })
    assert resp.status_code == 200
    data = resp.json()["data"]
    return {"id": data["workspaceId"], "slug": data["slug"], "token": data["token"]}


def _set_workspace_key(db, ws_id, key=WS_KEY):
    ws = db.query(Workspace).filter_by(id=ws_id).one()
    settings = dict(ws.settings or {})
    settings["browserfabric_api_key"] = key
    ws.settings = settings
    db.commit()


def _mock_cloud_manager(session_id="sess-1"):
    manager = MagicMock()
    manager.is_cloud = True
    manager.is_cloud_for = MagicMock(return_value=True)
    manager.get_session_id.return_value = session_id
    manager.get_live_url.return_value = None
    manager.open_tab = AsyncMock(return_value={"url": "https://example.com", "title": "Example", "warnings": []})
    manager.close_tab = AsyncMock(return_value=(True, None))
    manager.reconnect = AsyncMock()
    manager.get_current_url = AsyncMock(return_value={"url": "https://example.com", "title": "Example"})
    manager.delete_bb_context = MagicMock()
    manager._pages = {}
    manager._sessions = {}
    manager._live_urls = {}
    manager._tab_keys = {}
    return manager


def _patch_manager_cls(MockManager, manager):
    MockManager.get.return_value = manager
    MockManager.provision_workspace_key = AsyncMock(return_value=None)


def _open_tab(client, ws, url="https://example.com"):
    return client.post("/v1/browser/tabs", json={
        "url": url,
        "network": ws["id"],
        "source": "human:user",
    }, headers={"X-Workspace-Token": ws["token"]})


def _http_status_error(status_code):
    req = httpx.Request("POST", "https://bf.example/api")
    resp = httpx.Response(status_code, request=req)
    return httpx.HTTPStatusError(f"HTTP {status_code}", request=req, response=resp)


# ---------------------------------------------------------------------------
# 1. Manager: no leak + explicit warnings when a step after create fails
# ---------------------------------------------------------------------------

class TestManagerOpenTab:
    def _manager(self, monkeypatch):
        monkeypatch.setattr("app.browser.BROWSERFABRIC_API_KEY", "global-key")
        return BrowserManager()

    def test_navigate_failure_keeps_session_and_reports_warning(self, monkeypatch):
        manager = self._manager(monkeypatch)

        async def bf(tool_name, arguments=None, session_id=None, api_key=None, tab_id=None):
            if tool_name == "create_session":
                return {"success": True, "result": {"session_id": "sess-1", "share_url": "https://live"}}
            if tool_name == "navigate":
                raise RuntimeError("Browser Fabric error: nav boom")
            return {"success": True, "result": {"url": "about:blank", "title": ""}}

        manager._bf_call = AsyncMock(side_effect=bf)
        result = asyncio.run(manager.open_tab("tab-1", "https://example.com", api_key="ws-key"))

        assert manager.get_session_id("tab-1") == "sess-1"
        assert any(w.startswith("navigation_failed:") for w in result["warnings"])

    def test_page_info_failure_keeps_session_and_reports_warning(self, monkeypatch):
        manager = self._manager(monkeypatch)

        async def bf(tool_name, arguments=None, session_id=None, api_key=None, tab_id=None):
            if tool_name == "create_session":
                return {"success": True, "result": {"session_id": "sess-1"}}
            if tool_name == "navigate":
                return {"success": True, "result": {}}
            raise RuntimeError("Browser Fabric error: transient")

        manager._bf_call = AsyncMock(side_effect=bf)
        result = asyncio.run(manager.open_tab("tab-1", "https://example.com", api_key="ws-key"))

        assert result["url"] == "https://example.com"
        assert manager.get_session_id("tab-1") == "sess-1"
        assert manager._tab_keys["tab-1"] == "ws-key"
        assert any(w.startswith("page_info_failed:") for w in result["warnings"])

    def test_create_failure_leaves_no_state(self, monkeypatch):
        manager = self._manager(monkeypatch)
        manager._bf_call = AsyncMock(side_effect=RuntimeError("Browser Fabric error: limit reached"))

        with pytest.raises(RuntimeError):
            asyncio.run(manager.open_tab("tab-1", "https://example.com", api_key="ws-key"))

        assert manager.get_session_id("tab-1") is None
        assert "tab-1" not in manager._tab_keys

    def test_warning_text_never_contains_key(self, monkeypatch):
        manager = self._manager(monkeypatch)

        async def bf(tool_name, arguments=None, session_id=None, api_key=None, tab_id=None):
            if tool_name == "create_session":
                return {"success": True, "result": {"session_id": "sess-1"}}
            raise RuntimeError(f"Browser Fabric error: auth failed for ws-key")

        manager._bf_call = AsyncMock(side_effect=bf)
        result = asyncio.run(manager.open_tab("tab-1", "https://example.com", api_key="ws-key"))
        for w in result["warnings"]:
            assert "ws-key" not in w


# ---------------------------------------------------------------------------
# 2. Manager: close outcome semantics (typed 404 vs unknown failures)
# ---------------------------------------------------------------------------

class TestManagerClose:
    def _manager(self, monkeypatch):
        monkeypatch.setattr("app.browser.BROWSERFABRIC_API_KEY", "global-key")
        return BrowserManager()

    def test_close_after_restart_uses_resolved_key(self, monkeypatch):
        """Fresh manager (post-restart): close goes out with the explicitly
        resolved credential, not the global one."""
        manager = self._manager(monkeypatch)
        manager._bf_call = AsyncMock(return_value={"success": True})

        released, err = asyncio.run(
            manager.close_tab("tab-1", session_id_hint="sess-1", api_key="ws-key")
        )

        assert (released, err) == (True, None)
        manager._bf_call.assert_awaited_once_with("close_session", {}, "sess-1", api_key="ws-key")

    def test_close_404_is_confirmed_released(self, monkeypatch):
        manager = self._manager(monkeypatch)
        manager._bf_call = AsyncMock(side_effect=_http_status_error(404))

        released, err = asyncio.run(manager.close_tab("tab-1", session_id_hint="sess-1", api_key="k"))
        assert (released, err) == (True, None)

    def test_close_non_404_http_error_not_released(self, monkeypatch):
        manager = self._manager(monkeypatch)
        manager._bf_call = AsyncMock(side_effect=_http_status_error(502))

        released, err = asyncio.run(manager.close_tab("tab-1", session_id_hint="sess-1", api_key="k"))
        assert released is False
        assert "502" in err

    def test_close_timeout_not_released(self, monkeypatch):
        manager = self._manager(monkeypatch)
        manager._bf_call = AsyncMock(side_effect=httpx.ConnectTimeout("timed out"))
        manager._sessions["tab-1"] = "sess-1"

        released, err = asyncio.run(manager.close_tab("tab-1"))
        assert released is False
        assert manager.get_session_id("tab-1") is None  # local mapping still dropped

    def test_close_error_text_is_redacted(self, monkeypatch):
        manager = self._manager(monkeypatch)
        manager._bf_call = AsyncMock(side_effect=RuntimeError("denied for key secret-key-9"))

        released, err = asyncio.run(
            manager.close_tab("tab-1", session_id_hint="sess-1", api_key="secret-key-9")
        )
        assert released is False
        assert "secret-key-9" not in err

    def test_reconnect_restores_tab_key(self, monkeypatch):
        manager = self._manager(monkeypatch)
        asyncio.run(manager.reconnect("tab-1", "sess-1", api_key="ws-key"))

        assert manager.get_session_id("tab-1") == "sess-1"
        assert manager._key_for_tab("tab-1") == "ws-key"

    def test_ops_pass_tab_id_for_key_resolution(self, monkeypatch):
        manager = self._manager(monkeypatch)
        manager._sessions["tab-1"] = "sess-1"
        manager._tab_keys["tab-1"] = "ws-key"
        manager._bf_call = AsyncMock(return_value={"success": True, "result": {"url": "u", "title": "t"}})

        asyncio.run(manager.navigate("tab-1", "https://example.com"))

        for call in manager._bf_call.await_args_list:
            assert call.kwargs.get("tab_id") == "tab-1"

    def test_per_workspace_key_without_global_env_is_cloud(self, monkeypatch):
        monkeypatch.setattr("app.browser.BROWSERFABRIC_API_KEY", "")
        manager = BrowserManager()

        async def bf(tool_name, arguments=None, session_id=None, api_key=None, tab_id=None):
            return {"success": True, "result": {"session_id": "sess-1", "url": "u", "title": "t"}}

        manager._bf_call = AsyncMock(side_effect=bf)
        asyncio.run(manager.open_tab("tab-1", "https://example.com", api_key="ws-key"))

        assert manager.get_session_id("tab-1") == "sess-1"  # cloud branch, no Playwright


# ---------------------------------------------------------------------------
# 3. Credential reference: resolution, rotation, no plaintext anywhere
# ---------------------------------------------------------------------------

class TestCredentialReference:
    def test_redact_strips_key(self):
        assert "sk-123" not in redact("error with sk-123 inside", "sk-123")
        assert redact(None, "sk-123") is None
        assert redact("no key here", None) == "no key here"

    def test_resolve_workspace_source(self, client, db):
        ws = _create_workspace(client)
        _set_workspace_key(db, ws["id"])
        workspace = db.query(Workspace).filter_by(id=ws["id"]).one()
        tab = BrowserTab(workspace_id=ws["id"], url="u", created_by="human:user",
                         bf_key_source="workspace", bf_key_fingerprint=key_fingerprint(WS_KEY))
        assert resolve_tab_key(tab, workspace) == WS_KEY

    def test_resolve_rotated_key_raises_mismatch(self, client, db):
        ws = _create_workspace(client)
        _set_workspace_key(db, ws["id"], key="rotated-new-key")
        workspace = db.query(Workspace).filter_by(id=ws["id"]).one()
        tab = BrowserTab(workspace_id=ws["id"], url="u", created_by="human:user",
                         bf_key_source="workspace", bf_key_fingerprint=key_fingerprint(WS_KEY))
        with pytest.raises(BrowserCredentialError) as exc:
            resolve_tab_key(tab, workspace)
        assert exc.value.reason == "credential_mismatch"
        assert "rotated-new-key" not in str(exc.value)
        assert WS_KEY not in str(exc.value)

    def test_resolve_missing_key_raises(self, client, db):
        ws = _create_workspace(client)
        workspace = db.query(Workspace).filter_by(id=ws["id"]).one()
        tab = BrowserTab(workspace_id=ws["id"], url="u", created_by="human:user",
                         bf_key_source="workspace", bf_key_fingerprint=key_fingerprint(WS_KEY))
        with pytest.raises(BrowserCredentialError) as exc:
            resolve_tab_key(tab, workspace)
        assert exc.value.reason == "credential_missing"

    @patch("app.routers.browser.BrowserManager")
    def test_open_persists_reference_not_plaintext(self, MockManager, client, db, caplog):
        ws = _create_workspace(client)
        _set_workspace_key(db, ws["id"])
        manager = _mock_cloud_manager()
        _patch_manager_cls(MockManager, manager)

        with caplog.at_level("DEBUG"):
            resp = _open_tab(client, ws)
        assert resp.status_code == 200

        row = db.query(BrowserTab).filter_by(id=resp.json()["data"]["id"]).one()
        assert row.bf_key_source == "workspace"
        assert row.bf_key_fingerprint == key_fingerprint(WS_KEY)
        # No plaintext key anywhere: DB row, API response, logs, repr
        for value in row.__dict__.values():
            assert value != WS_KEY, "plaintext key stored in browser_tabs"
        assert WS_KEY not in resp.text
        assert WS_KEY not in repr(row)
        for record in caplog.records:
            assert WS_KEY not in record.getMessage()

    @patch("app.routers.browser.BrowserManager")
    def test_close_after_rotation_fails_loudly_not_with_new_key(self, MockManager, client, db):
        ws = _create_workspace(client)
        _set_workspace_key(db, ws["id"])
        manager = _mock_cloud_manager(session_id="sess-old")
        _patch_manager_cls(MockManager, manager)

        tab = _open_tab(client, ws).json()["data"]
        _set_workspace_key(db, ws["id"], key="rotated-new-key")  # rotate

        resp = client.delete(f"/v1/browser/tabs/{tab['id']}",
                             headers={"X-Workspace-Token": ws["token"]})
        assert resp.status_code == 200

        manager.close_tab.assert_not_awaited()  # never called BF with the new key
        row = db.query(BrowserTab).filter_by(id=tab["id"]).one()
        assert row.status == "closed"
        assert row.session_closed is False
        assert row.close_status == "close_failed"
        assert "credential_mismatch" in row.last_close_error
        assert "rotated-new-key" not in (row.last_close_error or "")

    @patch("app.routers.browser.BrowserManager")
    def test_op_with_missing_credential_returns_structured_400(self, MockManager, client, db):
        ws = _create_workspace(client)
        _set_workspace_key(db, ws["id"])
        manager = _mock_cloud_manager(session_id="sess-1")
        _patch_manager_cls(MockManager, manager)
        tab = _open_tab(client, ws).json()["data"]

        _set_workspace_key(db, ws["id"], key=None)  # key removed entirely
        ws_row = db.query(Workspace).filter_by(id=ws["id"]).one()
        settings = dict(ws_row.settings or {})
        settings.pop("browserfabric_api_key", None)
        ws_row.settings = settings
        db.commit()

        resp = client.post(f"/v1/browser/tabs/{tab['id']}/navigate",
                           json={"url": "https://other.com"},
                           headers={"X-Workspace-Token": ws["token"]})
        assert resp.status_code == 400
        assert "credential_missing" in resp.json()["message"]


# ---------------------------------------------------------------------------
# 4. Router: quota pre-check, warnings, close state machine, event failures
# ---------------------------------------------------------------------------

class TestRouterOpenClose:
    @patch("app.routers.browser.BrowserManager")
    def test_ephemeral_quota_precheck(self, MockManager, client, monkeypatch):
        monkeypatch.setattr("app.routers.browser.BF_EPHEMERAL_TAB_LIMIT", 2)
        ws = _create_workspace(client)
        manager = _mock_cloud_manager()
        _patch_manager_cls(MockManager, manager)

        assert _open_tab(client, ws).status_code == 200
        assert _open_tab(client, ws).status_code == 200

        resp = _open_tab(client, ws)
        assert resp.status_code == 400
        body = resp.json()
        assert "Temporary tab limit reached (2/2)" in body["message"]
        assert len(body["data"]["open_tabs"]) == 2
        assert manager.open_tab.await_count == 2  # BF never called for the rejected open

    @patch("app.routers.browser.BrowserManager")
    def test_bf_limit_error_maps_to_structured_400(self, MockManager, client):
        ws = _create_workspace(client)
        manager = _mock_cloud_manager()
        manager.open_tab = AsyncMock(side_effect=RuntimeError(
            "Browser Fabric error: 已到达临时标签限制（3/3）。先关闭一个标签页。"))
        _patch_manager_cls(MockManager, manager)

        resp = _open_tab(client, ws)
        assert resp.status_code == 400
        assert "临时标签限制" in resp.json()["message"]

    @patch("app.routers.browser.BrowserManager")
    def test_persistent_open_skips_ephemeral_quota(self, MockManager, client, monkeypatch, db):
        monkeypatch.setattr("app.routers.browser.BF_EPHEMERAL_TAB_LIMIT", 1)
        ws = _create_workspace(client)
        manager = _mock_cloud_manager()
        _patch_manager_cls(MockManager, manager)

        assert _open_tab(client, ws).status_code == 200  # fills the quota

        ctx = BrowserContext(workspace_id=ws["id"], name="Reddit", bb_context_id="bbctx-1",
                             created_by="human:user", shared_with=[])
        db.add(ctx)
        db.commit()

        resp = client.post("/v1/browser/tabs", json={
            "url": "https://reddit.com", "network": ws["id"],
            "source": "human:user", "context_id": ctx.id,
        }, headers={"X-Workspace-Token": ws["token"]})
        assert resp.status_code == 200, resp.json()

    @patch("app.routers.browser.BrowserManager")
    def test_open_with_init_warnings_returns_tab_plus_warnings(self, MockManager, client, db):
        ws = _create_workspace(client)
        manager = _mock_cloud_manager()
        manager.open_tab = AsyncMock(return_value={
            "url": "https://example.com", "title": "",
            "warnings": ["navigation_failed: Browser Fabric error: timeout"],
        })
        _patch_manager_cls(MockManager, manager)

        resp = _open_tab(client, ws)
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["id"]
        assert data["status"] == "active"
        assert any("navigation_failed" in w for w in data["warnings"])

        row = db.query(BrowserTab).filter_by(id=data["id"]).one()
        assert row.status == "active"
        assert "navigation_failed" in row.last_error
        assert row.session_id == "sess-1"  # session recorded despite init failure

    @patch("app.routers.browser.BrowserManager")
    def test_event_pipeline_failure_does_not_lose_tab(self, MockManager, client, db):
        ws = _create_workspace(client)
        manager = _mock_cloud_manager()
        _patch_manager_cls(MockManager, manager)

        with patch("app.routers.browser._emit_event", AsyncMock(side_effect=RuntimeError("pipeline down"))):
            resp = _open_tab(client, ws)
        assert resp.status_code == 200

        row = db.query(BrowserTab).filter_by(id=resp.json()["data"]["id"]).one()
        assert row.session_id == "sess-1"  # committed before the event

    @patch("app.routers.browser.BrowserManager")
    def test_failed_bf_close_keeps_session_open_in_db(self, MockManager, client, db):
        ws = _create_workspace(client)
        manager = _mock_cloud_manager(session_id="sess-fail")
        manager.close_tab = AsyncMock(return_value=(False, "HTTP 502 closing session"))
        _patch_manager_cls(MockManager, manager)

        tab = _open_tab(client, ws).json()["data"]
        resp = client.delete(f"/v1/browser/tabs/{tab['id']}",
                             headers={"X-Workspace-Token": ws["token"]})
        assert resp.status_code == 200

        row = db.query(BrowserTab).filter_by(id=tab["id"]).one()
        assert row.status == "closed"
        assert row.session_closed is False
        assert row.close_status == "close_failed"
        assert row.close_attempts == 1
        assert "502" in row.last_close_error

    @patch("app.routers.browser.BrowserManager")
    def test_successful_close_marks_session_closed(self, MockManager, client, db):
        ws = _create_workspace(client)
        manager = _mock_cloud_manager(session_id="sess-ok")
        _patch_manager_cls(MockManager, manager)

        tab = _open_tab(client, ws).json()["data"]
        resp = client.delete(f"/v1/browser/tabs/{tab['id']}",
                             headers={"X-Workspace-Token": ws["token"]})
        assert resp.status_code == 200

        row = db.query(BrowserTab).filter_by(id=tab["id"]).one()
        assert row.session_closed is True
        assert row.close_status == "closed"
        assert manager.close_tab.await_args.kwargs.get("session_id_hint") == "sess-ok"


# ---------------------------------------------------------------------------
# 5. Maintenance sweeper: claims, retries, exhaustion, swap safety
# ---------------------------------------------------------------------------

class TestBrowserSweep:
    def _run_sweep(self, manager, monkeypatch):
        monkeypatch.setattr(database, "SessionLocal", TestingSessionLocal)
        with patch("app.browser_maintenance.BrowserManager") as MockManager:
            MockManager.get.return_value = manager
            from app.browser_maintenance import sweep_browser_tabs
            return asyncio.run(sweep_browser_tabs())

    def _add_tab(self, db, ws_id, *, status="active", context_id=None,
                 session_id="sess-1", close_status="open", session_closed=False,
                 idle_minutes=0, closing_minutes=None, source=None, fingerprint=None):
        tab = BrowserTab(
            workspace_id=ws_id,
            url="https://example.com",
            status=status,
            created_by="openagents:agent-leak",
            shared_with=[],
            context_id=context_id,
            session_id=session_id,
            session_closed=session_closed,
            close_status=close_status,
            bf_key_source=source,
            bf_key_fingerprint=fingerprint,
            last_active_at=datetime.now(timezone.utc) - timedelta(minutes=idle_minutes),
            last_close_attempt_at=(
                datetime.now(timezone.utc) - timedelta(minutes=closing_minutes)
                if closing_minutes is not None else None
            ),
        )
        db.add(tab)
        db.flush()
        db.add(BrowserUsage(
            workspace_id=ws_id, tab_id=tab.id, session_id=session_id,
            opened_by="openagents:agent-leak",
        ))
        db.commit()
        return tab.id

    def test_reaps_idle_ephemeral_tab(self, client, db, monkeypatch):
        ws = _create_workspace(client)
        _set_workspace_key(db, ws["id"])
        tab_id = self._add_tab(db, ws["id"], idle_minutes=120,
                               source="workspace", fingerprint=key_fingerprint(WS_KEY))
        manager = _mock_cloud_manager()

        stats = self._run_sweep(manager, monkeypatch)

        assert stats["reaped"] == 1
        db.expire_all()
        row = db.query(BrowserTab).filter_by(id=tab_id).one()
        assert row.status == "closed"
        assert row.close_status == "closed"
        assert row.session_closed is True
        usage = db.query(BrowserUsage).filter_by(tab_id=tab_id).one()
        assert usage.ended_at is not None
        # Reap resolved the key from the credential reference on the row
        assert manager.close_tab.await_args.kwargs.get("api_key") == WS_KEY

    def test_skips_fresh_and_persistent_tabs(self, client, db, monkeypatch):
        ws = _create_workspace(client)
        ctx = BrowserContext(workspace_id=ws["id"], name="Reddit", bb_context_id="bbctx-1",
                             created_by="human:user", shared_with=[])
        db.add(ctx)
        db.flush()
        self._add_tab(db, ws["id"], idle_minutes=1)                        # fresh
        self._add_tab(db, ws["id"], context_id=ctx.id, idle_minutes=120)   # persistent
        manager = _mock_cloud_manager()

        stats = self._run_sweep(manager, monkeypatch)

        assert stats["reaped"] == 0
        manager.close_tab.assert_not_awaited()

    def test_retries_orphaned_session_release(self, client, db, monkeypatch):
        ws = _create_workspace(client)
        tab_id = self._add_tab(db, ws["id"], status="closed",
                               close_status="close_failed", idle_minutes=30)
        manager = _mock_cloud_manager()

        stats = self._run_sweep(manager, monkeypatch)

        assert stats["released"] == 1
        db.expire_all()
        row = db.query(BrowserTab).filter_by(id=tab_id).one()
        assert row.session_closed is True
        assert row.close_status == "closed"

    def test_failed_retry_stays_pending_with_bookkeeping(self, client, db, monkeypatch):
        ws = _create_workspace(client)
        tab_id = self._add_tab(db, ws["id"], status="closed",
                               close_status="close_failed", idle_minutes=30)
        manager = _mock_cloud_manager()
        manager.close_tab = AsyncMock(return_value=(False, "HTTP 502 closing session"))

        stats = self._run_sweep(manager, monkeypatch)

        assert stats["release_failed"] == 1
        db.expire_all()
        row = db.query(BrowserTab).filter_by(id=tab_id).one()
        assert row.session_closed is False
        assert row.close_status == "close_failed"  # picked up again next sweep
        assert row.close_attempts == 1
        assert row.last_close_attempt_at is not None
        assert "502" in row.last_close_error

    def test_exhausts_after_retry_window_without_faking_release(self, client, db, monkeypatch, caplog):
        ws = _create_workspace(client)
        tab_id = self._add_tab(db, ws["id"], status="closed",
                               close_status="close_failed", idle_minutes=60 * 10)  # 10h old
        manager = _mock_cloud_manager()

        import logging
        with caplog.at_level(logging.ERROR, logger="app.browser_maintenance"):
            stats = self._run_sweep(manager, monkeypatch)

        assert stats["exhausted"] == 1
        assert stats["released"] == 0
        manager.close_tab.assert_not_awaited()
        db.expire_all()
        row = db.query(BrowserTab).filter_by(id=tab_id).one()
        assert row.close_status == "retry_exhausted"
        assert row.session_closed is False  # NEVER faked as released
        assert any("retry_exhausted" in r.getMessage() for r in caplog.records)

    def test_exhausted_rows_not_retried_again(self, client, db, monkeypatch):
        ws = _create_workspace(client)
        self._add_tab(db, ws["id"], status="closed",
                      close_status="retry_exhausted", idle_minutes=30)
        manager = _mock_cloud_manager()

        stats = self._run_sweep(manager, monkeypatch)

        assert stats["released"] == 0 and stats["exhausted"] == 0
        manager.close_tab.assert_not_awaited()

    def test_no_session_rows_produce_no_work(self, client, db, monkeypatch):
        ws = _create_workspace(client)
        self._add_tab(db, ws["id"], status="closed", session_id=None,
                      close_status="none", session_closed=True, idle_minutes=120)
        manager = _mock_cloud_manager()

        stats = self._run_sweep(manager, monkeypatch)

        assert all(v == 0 for v in stats.values())
        manager.close_tab.assert_not_awaited()

    def test_row_claimed_by_other_worker_is_skipped(self, client, db, monkeypatch):
        """A fresh 'closing' claim (another replica mid-close) is not touched."""
        ws = _create_workspace(client)
        self._add_tab(db, ws["id"], status="closed",
                      close_status="closing", closing_minutes=1, idle_minutes=30)
        manager = _mock_cloud_manager()

        stats = self._run_sweep(manager, monkeypatch)

        assert stats["stale_recovered"] == 0
        manager.close_tab.assert_not_awaited()

    def test_stale_closing_claim_is_recovered_and_retried(self, client, db, monkeypatch):
        """A 'closing' claim from a crashed worker flips back and gets retried."""
        ws = _create_workspace(client)
        tab_id = self._add_tab(db, ws["id"], status="closed",
                               close_status="closing", closing_minutes=30, idle_minutes=30)
        manager = _mock_cloud_manager()

        stats = self._run_sweep(manager, monkeypatch)

        assert stats["stale_recovered"] == 1
        assert stats["released"] == 1
        db.expire_all()
        row = db.query(BrowserTab).filter_by(id=tab_id).one()
        assert row.close_status == "closed"

    def test_session_swap_between_claim_and_outcome_is_not_clobbered(self, client, db, monkeypatch):
        """If the session_id changes while the sweeper is closing (persist/
        reconnect swap), the outcome write must be dropped."""
        ws = _create_workspace(client)
        tab_id = self._add_tab(db, ws["id"], idle_minutes=120, session_id="sess-old")
        manager = _mock_cloud_manager()

        async def close_and_swap(*args, **kwargs):
            swap_db = TestingSessionLocal()
            try:
                swap_db.query(BrowserTab).filter_by(id=tab_id).update({"session_id": "sess-new"})
                swap_db.commit()
            finally:
                swap_db.close()
            return True, None

        manager.close_tab = AsyncMock(side_effect=close_and_swap)

        self._run_sweep(manager, monkeypatch)

        db.expire_all()
        row = db.query(BrowserTab).filter_by(id=tab_id).one()
        assert row.session_id == "sess-new"
        assert row.session_closed is False       # stale outcome dropped
        assert row.close_status != "closed"


# ---------------------------------------------------------------------------
# 6. Session swaps leave tombstones instead of leaking the old session
# ---------------------------------------------------------------------------

class TestOrphanTombstones:
    @patch("app.routers.browser.BrowserManager")
    def test_reconnect_with_failed_old_close_leaves_tombstone(self, MockManager, client, db):
        ws = _create_workspace(client)
        manager = _mock_cloud_manager(session_id="sess-old")
        _patch_manager_cls(MockManager, manager)
        tab = _open_tab(client, ws).json()["data"]

        manager.get_session_id.return_value = "sess-new"
        manager.close_tab = AsyncMock(return_value=(False, "HTTP 502 closing session"))

        resp = client.post(f"/v1/browser/tabs/{tab['id']}/reconnect",
                           headers={"X-Workspace-Token": ws["token"]})
        assert resp.status_code == 200
        assert resp.json()["data"]["session_id"] == "sess-new"

        tombstone = db.query(BrowserTab).filter_by(session_id="sess-old", status="closed").one()
        assert tombstone.created_by == "system:orphaned-session"
        assert tombstone.close_status == "close_failed"
        assert tombstone.session_closed is False  # sweeper will retry it

    @patch("app.routers.browser.BrowserManager")
    def test_reconnect_with_confirmed_old_close_leaves_no_tombstone(self, MockManager, client, db):
        ws = _create_workspace(client)
        manager = _mock_cloud_manager(session_id="sess-old")
        _patch_manager_cls(MockManager, manager)
        tab = _open_tab(client, ws).json()["data"]

        manager.get_session_id.return_value = "sess-new"

        resp = client.post(f"/v1/browser/tabs/{tab['id']}/reconnect",
                           headers={"X-Workspace-Token": ws["token"]})
        assert resp.status_code == 200

        assert db.query(BrowserTab).filter_by(session_id="sess-old").count() == 0
