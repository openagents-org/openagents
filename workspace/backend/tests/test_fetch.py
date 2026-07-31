# -*- coding: utf-8 -*-
"""
Tests for the server-side fetch chain (POST /v1/fetch).

Static HTTP and browser rendering are mocked; the chain logic
(static → JS-shell detection → render → wall detection) is real.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.browser import BrowserNavigationError
from app.net_security import OUTBOUND_USER_AGENT
from app.routers.fetch import _detect_wall, _extract_text, _looks_like_js_shell


def _create_workspace(client):
    resp = client.post("/v1/workspaces", json={
        "name": "Fetch Test Workspace",
        "agent_name": "agent-fetch",
        "creator_email": "test@example.com",
    })
    assert resp.status_code == 200
    data = resp.json()["data"]
    return {"id": data["workspaceId"], "token": data["token"]}


def _fetch(client, workspace, url, **kwargs):
    return client.post("/v1/fetch", json={
        "url": url,
        "network": workspace["id"],
        "source": "openagents:agent-fetch",
        **kwargs,
    }, headers={"X-Workspace-Token": workspace["token"]})


STATIC_HTML = """
<html><head><title>Article</title></head><body>
<h1>A real article</h1>
<p>{}</p>
<script>console.log('ignored')</script>
</body></html>
""".format("Lots of readable static content. " * 30)

JS_SHELL_HTML = (
    "<html><head><title>Notion</title></head><body>"
    "<noscript>Please enable JavaScript to run this app.</noscript>"
    "<div id=\"root\"></div>"
    "<script src=\"/app.js\"></script>"
    "</body></html>"
)


class TestFetchChain:

    @pytest.fixture(autouse=True)
    def _skip_ssrf_dns(self):
        # These tests use example hostnames and mock the fetch tiers; the SSRF
        # guard's real DNS lookup is exercised separately in TestFetchSSRF.
        with patch("app.routers.fetch.validate_public_url", new=AsyncMock()):
            yield

    @patch("app.routers.fetch._static_fetch")
    def test_static_page_served_without_browser(self, mock_static, client):
        mock_static.return_value = {"html": STATIC_HTML, "final_url": "https://example.com/a", "status_code": 200}
        workspace = _create_workspace(client)

        with patch("app.routers.fetch.BrowserManager") as mock_bm:
            manager = MagicMock()
            manager.render_page_text = AsyncMock()
            mock_bm.get.return_value = manager
            resp = _fetch(client, workspace, "https://example.com/a")

        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["content_source"] == "static"
        assert "A real article" in data["content"]
        assert "console.log" not in data["content"]
        assert data["title"] == "Article"
        manager.render_page_text.assert_not_awaited()

    @patch("app.routers.fetch._resolve_bf_key", new_callable=AsyncMock, return_value=None)
    @patch("app.routers.fetch._static_fetch")
    def test_js_shell_escalates_to_browser_render(self, mock_static, _key, client):
        mock_static.return_value = {"html": JS_SHELL_HTML, "final_url": "https://notion.site/x", "status_code": 200}
        workspace = _create_workspace(client)

        with patch("app.routers.fetch.BrowserManager") as mock_bm:
            manager = MagicMock()
            manager.render_page_text = AsyncMock(return_value={
                "url": "https://notion.site/x",
                "title": "Lunchbox",
                "text": "Rendered Notion page content here. " * 100,
            })
            mock_bm.get.return_value = manager
            resp = _fetch(client, workspace, "https://notion.site/x")

        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["content_source"] == "browser"
        assert "Rendered Notion page" in data["content"]
        manager.render_page_text.assert_awaited_once()

    @patch("app.routers.fetch._resolve_bf_key", new_callable=AsyncMock, return_value=None)
    @patch("app.routers.fetch._static_fetch")
    def test_login_wall_returns_auth_required(self, mock_static, _key, client):
        mock_static.return_value = {"html": JS_SHELL_HTML, "final_url": "https://notion.site/p", "status_code": 200}
        workspace = _create_workspace(client)

        with patch("app.routers.fetch.BrowserManager") as mock_bm:
            manager = MagicMock()
            manager.render_page_text = AsyncMock(return_value={
                "url": "https://notion.site/p",
                "title": "Notion",
                "text": "Please sign in to continue.",
            })
            mock_bm.get.return_value = manager
            resp = _fetch(client, workspace, "https://notion.site/p")

        assert resp.status_code == 400
        body = resp.json()
        assert body["data"]["error_code"] == "AUTH_REQUIRED"
        assert "hint" in body["data"]

    @patch("app.routers.fetch._static_fetch")
    def test_static_mode_never_renders(self, mock_static, client):
        mock_static.return_value = {"html": JS_SHELL_HTML, "final_url": "https://spa.example.com", "status_code": 200}
        workspace = _create_workspace(client)

        with patch("app.routers.fetch.BrowserManager") as mock_bm:
            manager = MagicMock()
            manager.render_page_text = AsyncMock()
            mock_bm.get.return_value = manager
            resp = _fetch(client, workspace, "https://spa.example.com", mode="static")

        assert resp.status_code == 200
        manager.render_page_text.assert_not_awaited()

    @patch("app.routers.fetch._resolve_bf_key", new_callable=AsyncMock, return_value=None)
    @patch("app.routers.fetch._static_fetch")
    def test_render_timeout_surfaces_error_code(self, mock_static, _key, client):
        mock_static.return_value = {"html": JS_SHELL_HTML, "final_url": "https://slow.example.com", "status_code": 200}
        workspace = _create_workspace(client)

        with patch("app.routers.fetch.BrowserManager") as mock_bm:
            manager = MagicMock()
            manager.render_page_text = AsyncMock(
                side_effect=BrowserNavigationError("NAV_TIMEOUT", "Timeout 30000ms exceeded")
            )
            mock_bm.get.return_value = manager
            resp = _fetch(client, workspace, "https://slow.example.com")

        assert resp.status_code == 400
        assert resp.json()["data"]["error_code"] == "JS_RENDER_TIMEOUT"

    def test_truncates_to_max_chars(self, client):
        workspace = _create_workspace(client)
        with patch("app.routers.fetch._static_fetch") as mock_static:
            mock_static.return_value = {"html": STATIC_HTML, "final_url": "https://example.com", "status_code": 200}
            resp = _fetch(client, workspace, "https://example.com", max_chars=1000)
        data = resp.json()["data"]
        assert len(data["content"]) <= 1000
        assert data["truncated"] is True

    @patch("app.routers.fetch._static_fetch")
    def test_static_mode_reports_upstream_http_error(self, mock_static, client):
        # A 404 in static mode must surface as an error, not a success body.
        mock_static.return_value = {"html": "<html><body>Not found</body></html>",
                                    "final_url": "https://example.com/missing", "status_code": 404}
        workspace = _create_workspace(client)
        resp = _fetch(client, workspace, "https://example.com/missing", mode="static")
        assert resp.status_code == 400
        body = resp.json()
        assert body["data"]["error_code"] == "UPSTREAM_HTTP_ERROR"
        assert body["data"]["status"] == 404


class TestFetchSSRF:
    """The SSRF guard runs for real here (IP literals need no DNS)."""

    def test_rejects_non_http_scheme(self, client):
        workspace = _create_workspace(client)
        resp = _fetch(client, workspace, "file:///etc/passwd")
        assert resp.status_code == 400
        assert resp.json()["data"]["error_code"] == "UNSUPPORTED_SCHEME"

    def test_blocks_loopback(self, client):
        workspace = _create_workspace(client)
        resp = _fetch(client, workspace, "http://127.0.0.1/admin")
        assert resp.status_code == 400
        assert resp.json()["data"]["error_code"] == "BLOCKED_PRIVATE_ADDRESS"

    def test_blocks_cloud_metadata(self, client):
        workspace = _create_workspace(client)
        resp = _fetch(client, workspace, "http://169.254.169.254/latest/meta-data/")
        assert resp.status_code == 400
        assert resp.json()["data"]["error_code"] == "BLOCKED_PRIVATE_ADDRESS"

    def test_blocks_url_credentials(self, client):
        workspace = _create_workspace(client)
        resp = _fetch(client, workspace, "http://user:pw@10.0.0.1/")
        assert resp.status_code == 400
        assert resp.json()["data"]["error_code"] in ("URL_CREDENTIALS_NOT_ALLOWED", "BLOCKED_PRIVATE_ADDRESS")


class TestHeuristics:

    def test_extract_text_strips_scripts_and_keeps_title(self):
        extracted = _extract_text(STATIC_HTML)
        assert extracted["title"] == "Article"
        assert "console.log" not in extracted["text"]
        assert "A real article" in extracted["text"]

    def test_js_shell_detected_by_noscript_marker(self):
        extracted = _extract_text(JS_SHELL_HTML)
        assert _looks_like_js_shell(JS_SHELL_HTML, extracted) is True

    def test_rich_static_page_is_not_js_shell(self):
        extracted = _extract_text(STATIC_HTML)
        assert _looks_like_js_shell(STATIC_HTML, extracted) is False

    def test_wall_detection(self):
        assert _detect_wall("Please sign in to continue.", "App") == "AUTH_REQUIRED"
        assert _detect_wall("Checking your browser before accessing", "Just a moment") == "BOT_CHALLENGE"
        assert _detect_wall("A long normal article. " * 200, "News") is None
        # "sign in" link on a long page must not trigger the wall
        assert _detect_wall("please sign in " + "content " * 400, "News") is None


class TestOutboundUserAgent:
    """The UA is a compatibility contract with the sites we read, not a detail.

    Regression cover for two separate defects: the page reader and the file
    downloader drifting apart, and the Linux platform token that mp.weixin.qq.com
    answers with a "当前环境异常" interstitial instead of the article.
    """

    def test_fetch_and_download_send_the_same_ua(self):
        from app.routers.files import _DOWNLOAD_UA
        from app.routers.fetch import USER_AGENT

        assert USER_AGENT == _DOWNLOAD_UA == OUTBOUND_USER_AGENT

    def test_ua_does_not_advertise_linux(self):
        assert "Linux" not in OUTBOUND_USER_AGENT
        assert "X11" not in OUTBOUND_USER_AGENT

    def test_ua_looks_like_a_browser(self):
        # Non-Mozilla prefixes (curl/..., python-requests/...) are refused
        # outright by the same interstitial.
        assert OUTBOUND_USER_AGENT.startswith("Mozilla/5.0 ")
        assert "Chrome/" in OUTBOUND_USER_AGENT
