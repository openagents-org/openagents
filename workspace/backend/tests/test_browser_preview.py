# -*- coding: utf-8 -*-
"""Browser previews in Slack (v1.1 M6) — services/browser_preview.

Slack HTTP is faked at the ``httpx.Client`` level so the exact wire payloads
are asserted; the screenshot path is monkeypatched to return PNG bytes; the
BrowserManager is mocked the way the other browser tests do it. The service
opens its own DB sessions via module-level ``SessionLocal`` symbols, which are
pointed at the shared in-memory SQLite (same trick as test_integrations).
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import app.services.browser_preview as bp
import app.services.integrations as svc
import httpx
import pytest
from app.config import config
from app.models import Channel, IntegrationBinding, Workspace

from tests.conftest import TestingSessionLocal

SLACK_SIGNING_SECRET = "8f742231b10e8888abcd99yyyzzz85a5"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
LIVE_URL = "https://live.example/share/abc"
SLACK_CHAT_ID = "C0BROWSE"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    monkeypatch.setattr(svc, "SessionLocal", TestingSessionLocal)
    monkeypatch.setattr(bp, "SessionLocal", TestingSessionLocal)
    monkeypatch.setattr("app.routers.browser.BROWSERFABRIC_API_KEY", "bf_test_key")
    bp._last_post.clear()
    bp._local_tab_channels.clear()
    yield
    bp._last_post.clear()
    bp._local_tab_channels.clear()


@pytest.fixture
def screenshot(monkeypatch):
    """Screenshot path returns PNG bytes; records the tab ids it was asked for."""
    asked = []

    async def fake(tab_id):
        asked.append(tab_id)
        return PNG

    monkeypatch.setattr(bp, "take_screenshot", fake)
    return asked


class _Resp:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {"ok": True}

    def json(self):
        return self._payload


class FakeSlack:
    """Stands in for ``httpx.Client``: records calls, answers Slack endpoints."""

    def __init__(self, upload_url_ok=True, complete_ok=True, post_ok=True):
        self.calls = []
        self.upload_url_ok = upload_url_ok
        self.complete_ok = complete_ok
        self.post_ok = post_ok

    # httpx.Client(timeout=...) → context manager → self
    def __call__(self, *args, **kwargs):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def get(self, url, **kw):
        self.calls.append(("GET", url, kw))
        if url.endswith("files.getUploadURLExternal"):
            if not self.upload_url_ok:
                return _Resp(200, {"ok": False, "error": "missing_scope"})
            return _Resp(200, {"ok": True, "upload_url": "https://files.slack.com/upload/v1/abc", "file_id": "F123"})
        return _Resp(200, {"ok": True})

    def post(self, url, **kw):
        self.calls.append(("POST", url, kw))
        if url.startswith("https://files.slack.com/upload/"):
            return _Resp(200, {})
        if url.endswith("files.completeUploadExternal"):
            if not self.complete_ok:
                return _Resp(200, {"ok": False, "error": "invalid_arguments"})
            return _Resp(200, {"ok": True, "files": [{"id": "F123"}]})
        if url.endswith("chat.postMessage"):
            if not self.post_ok:
                return _Resp(200, {"ok": False, "error": "channel_not_found"})
            return _Resp(200, {"ok": True, "ts": "1727700000.000100"})
        return _Resp(200, {"ok": True})

    def urls(self):
        return [u for _, u, _ in self.calls]


@pytest.fixture
def slack(monkeypatch):
    fake = FakeSlack()
    monkeypatch.setattr(httpx, "Client", fake)
    return fake


@pytest.fixture
def slack_binding(client, workspace, monkeypatch):
    monkeypatch.setattr(
        svc, "slack_auth_test",
        lambda token: {"team": "Acme", "team_id": "T1", "user_id": "UBOT"},
    )
    resp = client.post(
        f"/v1/workspaces/{workspace['id']}/integrations",
        json={"platform": "slack", "bot_token": "xoxb-secret-token",
              "signing_secret": SLACK_SIGNING_SECRET, "default_agent": "agent-alpha"},
        headers={"X-Workspace-Token": workspace["token"]},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["data"]["integration"]


def _make_bridged_channel(workspace, binding, visibility="workspace", chat_id=SLACK_CHAT_ID):
    """The ext- channel the bridge would create for a Slack conversation."""
    name = f"ext-slack-{binding['id'][:8]}-{chat_id}"
    db = TestingSessionLocal()
    try:
        db.add(Channel(
            workspace_id=workspace["id"], name=name, title=f"Slack: #{chat_id}",
            created_by="system:integration-slack", status="active", visibility=visibility,
        ))
        db.commit()
    finally:
        db.close()
    return name


@pytest.fixture
def bridged_channel(workspace, slack_binding):
    return _make_bridged_channel(workspace, slack_binding)


def _mock_manager():
    manager = MagicMock()
    manager.is_cloud = False
    manager.is_cloud_for = MagicMock(return_value=False)
    manager.get_session_id.return_value = None
    manager.get_live_url.return_value = LIVE_URL
    manager.open_tab = AsyncMock(return_value={"url": "https://example.com/", "title": "Example Domain"})
    manager.navigate = AsyncMock(return_value={"url": "https://example.com/docs", "title": "Docs & Guides"})
    manager.close_tab = AsyncMock(return_value=(True, None))
    manager.get_current_url = AsyncMock(return_value=None)
    return manager


def _open(client, workspace, channel=None, source="openagents:scout", url="https://example.com/"):
    body = {"url": url, "network": workspace["id"], "source": source}
    if channel:
        body["channel"] = channel
    return client.post("/v1/browser/tabs", json=body, headers={"X-Workspace-Token": workspace["token"]})


def _tab(tab_id="tab-1", url="https://example.com/", title="Example Domain", live_url=LIVE_URL):
    return {"id": tab_id, "url": url, "title": title, "live_url": live_url, "created_by": "openagents:scout"}


def _run(ws_id, channel, tab, actor="openagents:scout", reason="opened"):
    asyncio.run(bp.maybe_post_browser_preview(ws_id, channel, tab, actor, reason))


def _default_channel(workspace):
    ch = workspace["channel"]
    return ch["name"] if isinstance(ch, dict) else ch


def _workspace_slug(ws_id):
    db = TestingSessionLocal()
    try:
        return db.get(Workspace, ws_id).slug
    finally:
        db.close()


def _expected_comment(slug, title="Example Domain", url="https://example.com/"):
    return (
        f"🌐 *@scout* is browsing: {title} — <{url}>\n"
        f"<{LIVE_URL}|Open live browser view> · "
        f"<{config.FRONTEND_BASE_URL.rstrip('/')}/{slug}|Open in workspace>"
    )


# ---------------------------------------------------------------------------
# Posting
# ---------------------------------------------------------------------------

@patch("app.routers.browser.BrowserManager")
def test_posts_preview_on_open_for_bridged_public_thread(
    MockManager, client, workspace, bridged_channel, slack, screenshot,
):
    MockManager.get.return_value = _mock_manager()

    resp = _open(client, workspace, channel=bridged_channel)
    assert resp.status_code == 200, resp.text
    tab = resp.json()["data"]
    assert screenshot == [tab["id"]]

    # Exact external-upload flow: URL → bytes → complete (with the comment).
    assert slack.urls() == [
        "https://slack.com/api/files.getUploadURLExternal",
        "https://files.slack.com/upload/v1/abc",
        "https://slack.com/api/files.completeUploadExternal",
    ]
    method, _, kw = slack.calls[0]
    assert method == "GET"
    assert kw["headers"] == {"Authorization": "Bearer xoxb-secret-token"}
    assert kw["params"] == {"filename": f"browser-preview-{tab['id'][:8]}.png", "length": len(PNG)}

    _, _, kw = slack.calls[1]
    assert kw["files"] == {"file": (f"browser-preview-{tab['id'][:8]}.png", PNG, "image/png")}

    _, _, kw = slack.calls[2]
    assert kw["headers"] == {"Authorization": "Bearer xoxb-secret-token"}
    assert kw["json"] == {
        "files": [{"id": "F123", "title": "Example Domain"}],
        "channel_id": SLACK_CHAT_ID,
        "initial_comment": _expected_comment(_workspace_slug(workspace["id"])),
    }
    assert "thread_ts" not in kw["json"]  # the bridge posts top-level today

    # Success is recorded on the binding like any relay.
    db = TestingSessionLocal()
    try:
        binding = db.execute(
            __import__("sqlalchemy").select(IntegrationBinding)
            .where(IntegrationBinding.workspace_id == workspace["id"])
        ).scalar_one()
        assert binding.last_error is None
        assert binding.last_event_at is not None
    finally:
        db.close()


@patch("app.routers.browser.BrowserManager")
def test_throttles_second_call_within_window(
    MockManager, client, workspace, bridged_channel, slack, screenshot,
):
    MockManager.get.return_value = _mock_manager()
    tab = _open(client, workspace, channel=bridged_channel).json()["data"]
    assert slack.urls()[-1].endswith("files.completeUploadExternal")
    n = len(slack.calls)

    # Navigate without repeating `channel`: the association is remembered,
    # but the 30 s window swallows the second preview.
    resp = client.post(f"/v1/browser/tabs/{tab['id']}/navigate", json={"url": "https://example.com/docs"},
                       headers={"X-Workspace-Token": workspace["token"]})
    assert resp.status_code == 200, resp.text
    assert len(slack.calls) == n
    assert screenshot == [tab["id"]]

    # Once the window has passed, the navigation posts (title escaped for mrkdwn).
    bp._last_post[tab["id"]] -= bp.PREVIEW_THROTTLE_SECONDS + 1
    resp = client.post(f"/v1/browser/tabs/{tab['id']}/navigate", json={"url": "https://example.com/docs"},
                       headers={"X-Workspace-Token": workspace["token"]})
    assert resp.status_code == 200
    assert len(slack.calls) == n + 3
    comment = slack.calls[-1][2]["json"]["initial_comment"]
    assert comment.startswith("🌐 *@scout* is browsing: Docs &amp; Guides — <https://example.com/docs>")


def test_falls_back_to_chat_post_message_when_upload_fails(
    workspace, bridged_channel, slack, screenshot,
):
    slack.upload_url_ok = False  # e.g. bot token without files:write
    _run(workspace["id"], bridged_channel, _tab())

    assert slack.urls() == [
        "https://slack.com/api/files.getUploadURLExternal",
        "https://slack.com/api/chat.postMessage",
    ]
    _, _, kw = slack.calls[-1]
    text = _expected_comment(_workspace_slug(workspace["id"]))
    assert kw["headers"] == {"Authorization": "Bearer xoxb-secret-token"}
    assert kw["json"] == {
        "channel": SLACK_CHAT_ID,
        "text": text,
        "blocks": [
            {"type": "section", "text": {"type": "mrkdwn", "text": text}},
            {"type": "context", "elements": [
                {"type": "mrkdwn", "text": "Shared browser preview from OpenAgents Workspace"},
            ]},
        ],
        "unfurl_links": False,
        "unfurl_media": False,
    }


def test_fallback_includes_image_block_when_tab_exposes_public_screenshot(
    workspace, bridged_channel, slack, monkeypatch,
):
    async def no_shot(tab_id):
        raise RuntimeError("browser gone")

    monkeypatch.setattr(bp, "take_screenshot", no_shot)
    tab = _tab() | {"screenshot_url": "https://cdn.example/shots/tab-1.png"}
    _run(workspace["id"], bridged_channel, tab)

    # No PNG → no upload attempt at all, straight to the message.
    assert slack.urls() == ["https://slack.com/api/chat.postMessage"]
    blocks = slack.calls[-1][2]["json"]["blocks"]
    assert blocks[1] == {
        "type": "image", "image_url": "https://cdn.example/shots/tab-1.png", "alt_text": "Example Domain",
    }


def test_both_paths_failing_records_error_on_binding_and_does_not_raise(
    workspace, bridged_channel, slack, screenshot,
):
    slack.upload_url_ok = False
    slack.post_ok = False
    _run(workspace["id"], bridged_channel, _tab())  # must not raise
    db = TestingSessionLocal()
    try:
        binding = db.execute(
            __import__("sqlalchemy").select(IntegrationBinding)
            .where(IntegrationBinding.workspace_id == workspace["id"])
        ).scalar_one()
        assert "missing_scope" in binding.last_error
        assert "channel_not_found" in binding.last_error
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Skips
# ---------------------------------------------------------------------------

def test_skips_private_threads(workspace, slack_binding, slack, screenshot):
    private = _make_bridged_channel(workspace, slack_binding, visibility="private", chat_id="C0PRIV")
    _run(workspace["id"], private, _tab())
    assert slack.calls == []
    assert screenshot == []  # not even a screenshot is taken


def test_skips_unbridged_channels(workspace, slack_binding, slack, screenshot):
    _run(workspace["id"], _default_channel(workspace), _tab())
    assert slack.calls == []
    assert screenshot == []


def test_skips_when_setting_off(workspace, bridged_channel, slack, screenshot):
    db = TestingSessionLocal()
    try:
        ws = db.get(Workspace, workspace["id"])
        ws.settings = dict(ws.settings or {}, slack_browser_previews=False)
        db.commit()
    finally:
        db.close()
    _run(workspace["id"], bridged_channel, _tab())
    assert slack.calls == []

    # Explicit True (and absent) both post.
    db = TestingSessionLocal()
    try:
        ws = db.get(Workspace, workspace["id"])
        ws.settings = dict(ws.settings or {}, slack_browser_previews=True)
        db.commit()
    finally:
        db.close()
    _run(workspace["id"], bridged_channel, _tab())
    assert slack.urls()[-1].endswith("files.completeUploadExternal")


def test_skips_human_actors_and_blank_pages(workspace, bridged_channel, slack, screenshot):
    _run(workspace["id"], bridged_channel, _tab(), actor="human:user")
    _run(workspace["id"], bridged_channel, _tab(url="about:blank", title=None))
    _run(workspace["id"], None, _tab())
    assert slack.calls == []


def test_skips_disabled_binding(workspace, slack_binding, bridged_channel, slack, screenshot):
    db = TestingSessionLocal()
    try:
        b = db.get(IntegrationBinding, slack_binding["id"])
        b.status = "disabled"
        db.commit()
    finally:
        db.close()
    _run(workspace["id"], bridged_channel, _tab())
    assert slack.calls == []


@patch("app.routers.browser.BrowserManager")
def test_tab_without_channel_never_previews(MockManager, client, workspace, bridged_channel, slack, screenshot):
    MockManager.get.return_value = _mock_manager()
    tab = _open(client, workspace)  # no `channel`
    assert tab.status_code == 200
    client.post(f"/v1/browser/tabs/{tab.json()['data']['id']}/navigate", json={"url": "https://example.com/x"},
                headers={"X-Workspace-Token": workspace["token"]})
    assert slack.calls == []
    assert screenshot == []


# ---------------------------------------------------------------------------
# Router isolation: browser endpoints never fail because of the preview
# ---------------------------------------------------------------------------

@patch("app.routers.browser.BrowserManager")
def test_preview_errors_never_change_tab_endpoint_response(
    MockManager, client, workspace, bridged_channel, slack, monkeypatch,
):
    MockManager.get.return_value = _mock_manager()

    # 1. The screenshot blows up inside the background task.
    async def boom(tab_id):
        raise RuntimeError("BrowserFabric 502")

    monkeypatch.setattr(bp, "take_screenshot", boom)
    resp = _open(client, workspace, channel=bridged_channel)
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert data["url"] == "https://example.com/" and data["live_url"] == LIVE_URL
    assert "warnings" not in data
    # Without a PNG the poster still tells Slack what the agent is doing.
    assert slack.urls() == ["https://slack.com/api/chat.postMessage"]

    # 2. The hook itself raises synchronously (e.g. a bug in scheduling).
    def hook_boom(*a, **k):
        raise RuntimeError("hook bug")

    monkeypatch.setattr("app.services.browser_preview.schedule_browser_preview", hook_boom)
    bp._last_post.clear()
    resp = _open(client, workspace, channel=bridged_channel)
    assert resp.status_code == 200, resp.text
    assert resp.json()["data"]["url"] == "https://example.com/"
    tab_id = resp.json()["data"]["id"]
    resp = client.post(f"/v1/browser/tabs/{tab_id}/navigate", json={"url": "https://example.com/docs"},
                       headers={"X-Workspace-Token": workspace["token"]})
    assert resp.status_code == 200, resp.text
    assert resp.json()["data"]["url"] == "https://example.com/docs"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def test_resolve_binding_for_channel_roundtrip(workspace, slack_binding, bridged_channel):
    resolved = svc.resolve_binding_for_channel(workspace["id"], bridged_channel)
    assert resolved is not None
    binding, chat_id = resolved
    assert str(binding.id) == slack_binding["id"] and chat_id == SLACK_CHAT_ID
    assert svc.resolve_binding_for_channel(workspace["id"], _default_channel(workspace)) is None
    assert svc.resolve_binding_for_channel(workspace["id"], "ext-slack-deadbeef-C1") is None


def test_tab_channel_association_roundtrip():
    bp.remember_tab_channel("t1", "ext-slack-abcdef12-C1")
    assert bp.channel_for_tab("t1") == "ext-slack-abcdef12-C1"
    bp.forget_tab_channel("t1")
    assert bp.channel_for_tab("t1") is None
