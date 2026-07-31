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
from app.routers.fetch import (
    ASSET_LIMIT,
    _detect_wall,
    _extract_text,
    _looks_like_js_shell,
    _normalize_rendered_assets,
)


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


class TestAssetsInResponse:
    """The endpoint must actually carry the assets, not just extract them."""

    @pytest.fixture(autouse=True)
    def _skip_ssrf_dns(self):
        with patch("app.routers.fetch.validate_public_url", new=AsyncMock()):
            yield

    @patch("app.routers.fetch._static_fetch")
    def test_static_read_returns_image_assets(self, mock_static, client):
        html = STATIC_HTML.replace(
            "<h1>", '<img data-src="https://mmbiz.qpic.cn/x/640?wx_fmt=jpeg" alt="figure"><h1>'
        )
        mock_static.return_value = {
            "html": html, "final_url": "https://mp.weixin.qq.com/s/x", "status_code": 200,
        }
        workspace = _create_workspace(client)

        with patch("app.routers.fetch.BrowserManager") as mock_bm:
            manager = MagicMock()
            manager.render_page_text = AsyncMock()
            mock_bm.get.return_value = manager
            resp = _fetch(client, workspace, "https://mp.weixin.qq.com/s/x")

        assets = resp.json()["data"]["assets"]
        assert [a["url"] for a in assets] == ["https://mmbiz.qpic.cn/x/640?wx_fmt=jpeg"]
        assert assets[0]["alt"] == "figure"

    @patch("app.routers.fetch._resolve_bf_key", new_callable=AsyncMock, return_value=None)
    @patch("app.routers.fetch._static_fetch")
    def test_rendered_read_returns_image_assets(self, mock_static, _key, client):
        mock_static.return_value = {
            "html": JS_SHELL_HTML, "final_url": "https://app.example/x", "status_code": 200,
        }
        workspace = _create_workspace(client)

        with patch("app.routers.fetch.BrowserManager") as mock_bm:
            manager = MagicMock()
            manager.render_page_text = AsyncMock(return_value={
                "url": "https://app.example/x",
                "title": "App",
                "text": "Rendered content. " * 100,
                "images": [{"url": "https://cdn.example.com/hero.png", "alt": "hero"}],
            })
            mock_bm.get.return_value = manager
            resp = _fetch(client, workspace, "https://app.example/x")

        data = resp.json()["data"]
        assert data["content_source"] == "browser"
        assert [a["url"] for a in data["assets"]] == ["https://cdn.example.com/hero.png"]
        assert data["assets"][0]["source"] == "browser"


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


class TestAssetExtraction:
    """Reading a page is the only step that sees markup. If it drops the image
    URLs, /v1/files/from_url — which needs a direct URL — can never be reached,
    so these cover the shapes real pages actually use.
    """

    def test_lazy_loaded_images_are_collected(self):
        # mp.weixin.qq.com puts every article image in data-src and leaves no src.
        html = '<html><body><img data-src="https://mmbiz.qpic.cn/a/640?wx_fmt=jpeg" alt="fig"></body></html>'
        assets = _extract_text(html, "https://mp.weixin.qq.com/s/x")["assets"]
        assert [a["url"] for a in assets] == ["https://mmbiz.qpic.cn/a/640?wx_fmt=jpeg"]
        assert assets[0]["alt"] == "fig"
        assert assets[0]["type"] == "image"
        assert assets[0]["source"] == "html"

    def test_extensionless_img_url_is_kept(self):
        # An <img> is an image whatever its path looks like; filtering markup
        # by file extension is what dropped these platforms' images entirely.
        html = '<html><body><img src="https://cdn.example.com/note/abc!nd_dft"></body></html>'
        assets = _extract_text(html, "https://example.com/")["assets"]
        assert len(assets) == 1
        assert assets[0]["mime"] is None

    def test_images_from_escaped_embedded_json(self):
        # xiaohongshu renders its gallery from a JSON blob inside <script>,
        # writing every path separator as /.
        html = (
            '<html><body><script>window.__INITIAL_STATE__={"imageList":[{"urlDefault":'
            '"http:\\u002F\\u002Fsns-webpic-qc.xhscdn.com\\u002F202607\\u002Fabc\\u002Fnote!nd_dft"}]}'
            "</script></body></html>"
        )
        assets = _extract_text(html, "https://www.xiaohongshu.com/explore/x")["assets"]
        assert [a["url"] for a in assets] == [
            "http://sns-webpic-qc.xhscdn.com/202607/abc/note!nd_dft"
        ]
        assert assets[0]["source"] == "embedded_json"

    def test_non_image_assets_from_json_are_rejected(self):
        html = (
            '<html><body><script>{"url":"https:\\u002F\\u002Ffe-static.xhscdn.com\\u002Fas\\u002Fv2\\u002Fapp.js",'
            '"cssUrl":"https:\\u002F\\u002Ffe-static.xhscdn.com\\u002Fa\\u002Fb.css"}</script></body></html>'
        )
        assert _extract_text(html, "https://www.xiaohongshu.com/")["assets"] == []

    def test_relative_and_protocol_relative_urls_are_absolute(self):
        html = '<html><body><img src="/img/a.png"><img src="//cdn.example.com/b.jpg"></body></html>'
        urls = [a["url"] for a in _extract_text(html, "https://site.example/post/1")["assets"]]
        assert urls == ["https://site.example/img/a.png", "https://cdn.example.com/b.jpg"]

    def test_inline_data_uris_and_duplicates_are_dropped(self):
        html = (
            '<html><body><img src="data:image/png;base64,AAAA">'
            '<img src="https://cdn.example.com/a.jpg">'
            '<img data-src="https://cdn.example.com/a.jpg"></body></html>'
        )
        assets = _extract_text(html, "https://example.com/")["assets"]
        assert [a["url"] for a in assets] == ["https://cdn.example.com/a.jpg"]

    def test_asset_list_is_capped(self):
        html = "<html><body>" + "".join(
            f'<img src="https://cdn.example.com/{i}.jpg">' for i in range(200)
        ) + "</body></html>"
        assert len(_extract_text(html, "https://example.com/")["assets"]) == ASSET_LIMIT

    def test_og_title_fills_in_for_an_empty_title_tag(self):
        html = (
            '<html><head><title></title>'
            '<meta property="og:title" content="真正的标题" /></head><body>x</body></html>'
        )
        assert _extract_text(html, "https://mp.weixin.qq.com/s/x")["title"] == "真正的标题"

    def test_real_title_tag_wins_over_og_title(self):
        html = (
            '<html><head><title>Real</title>'
            '<meta property="og:title" content="Other" /></head><body>x</body></html>'
        )
        assert _extract_text(html, "https://example.com/")["title"] == "Real"


class TestRenderedAssets:

    def test_rendered_images_are_normalized_and_deduped(self):
        assets = _normalize_rendered_assets(
            [
                {"url": "https://cdn.example.com/a.png", "alt": "A"},
                {"url": "https://cdn.example.com/a.png", "alt": "dup"},
                {"url": "data:image/png;base64,AAA", "alt": ""},
                {"url": "/rel/b.jpg", "alt": ""},
                "not-a-dict",
                {"alt": "no url"},
            ],
            "https://site.example/page",
        )
        assert [a["url"] for a in assets] == [
            "https://cdn.example.com/a.png",
            "https://site.example/rel/b.jpg",
        ]
        assert all(a["source"] == "browser" for a in assets)

    def test_missing_image_list_is_not_an_error(self):
        assert _normalize_rendered_assets(None, "https://site.example/") == []
