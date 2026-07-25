# -*- coding: utf-8 -*-
"""
Unit tests for the SSRF-safe fetch helpers (app/net_security.py).
DNS resolution and the HTTP transport are mocked.
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app import net_security
from app.net_security import UnsafeURLError, safe_fetch, validate_public_url


def _run(coro):
    return asyncio.run(coro)


class TestValidatePublicUrl:

    def test_rejects_non_http_scheme(self):
        with pytest.raises(UnsafeURLError) as ei:
            _run(validate_public_url("file:///etc/passwd"))
        assert ei.value.code == "UNSUPPORTED_SCHEME"

    def test_rejects_embedded_credentials(self):
        with pytest.raises(UnsafeURLError) as ei:
            _run(validate_public_url("https://user:pass@example.com/"))
        assert ei.value.code == "URL_CREDENTIALS_NOT_ALLOWED"

    def test_rejects_loopback_ip_literal(self):
        with pytest.raises(UnsafeURLError) as ei:
            _run(validate_public_url("http://127.0.0.1/admin"))
        assert ei.value.code == "BLOCKED_PRIVATE_ADDRESS"

    def test_rejects_cloud_metadata_ip(self):
        with pytest.raises(UnsafeURLError) as ei:
            _run(validate_public_url("http://169.254.169.254/latest/meta-data/"))
        assert ei.value.code == "BLOCKED_PRIVATE_ADDRESS"

    def test_rejects_private_range_ip(self):
        with pytest.raises(UnsafeURLError) as ei:
            _run(validate_public_url("http://10.0.0.5/"))
        assert ei.value.code == "BLOCKED_PRIVATE_ADDRESS"

    def test_rejects_ipv4_mapped_ipv6_loopback(self):
        with pytest.raises(UnsafeURLError) as ei:
            _run(validate_public_url("http://[::ffff:127.0.0.1]/"))
        assert ei.value.code == "BLOCKED_PRIVATE_ADDRESS"

    def test_rejects_hostname_resolving_to_private(self):
        with patch.object(net_security, "_resolve_ips", new=AsyncMock(return_value={"127.0.0.1"})):
            with pytest.raises(UnsafeURLError) as ei:
                _run(validate_public_url("http://sneaky.internal.example/"))
        assert ei.value.code == "BLOCKED_PRIVATE_ADDRESS"

    def test_allows_public_hostname_returns_ips(self):
        with patch.object(net_security, "_resolve_ips", new=AsyncMock(return_value={"93.184.216.34"})):
            ips = _run(validate_public_url("https://example.com/page"))
        assert ips == {"93.184.216.34"}

    def test_invalid_port_raises_invalid_url(self):
        with pytest.raises(UnsafeURLError) as ei:
            _run(validate_public_url("http://example.com:99999/"))
        assert ei.value.code == "INVALID_URL"


class TestPinnedTransport:

    def test_rewrites_host_to_validated_ip_and_keeps_hostname_for_tls(self):
        import httpx

        transport = net_security._PinnedTransport({"example.com": ["93.184.216.34"]})
        request = httpx.Request("GET", "https://example.com/path")
        captured = {}

        async def fake_super(self, req):
            captured["host"] = req.url.host
            captured["host_header"] = req.headers.get("host")
            captured["sni"] = req.extensions.get("sni_hostname")
            return MagicMock()

        with patch.object(net_security.httpx.AsyncHTTPTransport, "handle_async_request", fake_super):
            _run(transport.handle_async_request(request))

        # Connects to the validated IP, but TLS/Host still use the real hostname.
        assert captured["host"] == "93.184.216.34"
        assert captured["host_header"] == "example.com"
        assert captured["sni"] == "example.com"

    def test_ip_literal_host_is_not_rewritten(self):
        import httpx

        transport = net_security._PinnedTransport({"93.184.216.34": ["93.184.216.34"]})
        request = httpx.Request("GET", "http://93.184.216.34/x")
        captured = {}

        async def fake_super(self, req):
            captured["host"] = req.url.host
            captured["sni"] = req.extensions.get("sni_hostname")
            return MagicMock()

        with patch.object(net_security.httpx.AsyncHTTPTransport, "handle_async_request", fake_super):
            _run(transport.handle_async_request(request))

        assert captured["host"] == "93.184.216.34"
        assert captured["sni"] is None  # no rewrite → no SNI override

    def test_fails_over_to_next_ip_on_connect_error(self):
        import httpx

        # First candidate is an (unroutable) IPv6, second is a good IPv4.
        transport = net_security._PinnedTransport({"example.com": ["2001:db8::1", "93.184.216.34"]})
        request = httpx.Request("GET", "https://example.com/x")
        tried = []

        async def fake_super(self, req):
            tried.append(req.url.host)
            if req.url.host == "2001:db8::1":
                raise httpx.ConnectError("no route to host")
            return MagicMock()

        with patch.object(net_security.httpx.AsyncHTTPTransport, "handle_async_request", fake_super):
            _run(transport.handle_async_request(request))

        # It tried the first, failed, then succeeded on the second validated IP.
        assert tried == ["2001:db8::1", "93.184.216.34"]

    def test_order_ips_puts_v4_first(self):
        assert net_security._order_ips({"2001:db8::1", "1.2.3.4", "1.1.1.1"}) == [
            "1.1.1.1", "1.2.3.4", "2001:db8::1",
        ]


def _stream_response(*, status=200, headers=None, chunks=(b"hello",), is_redirect=False):
    resp = MagicMock()
    resp.status_code = status
    resp.headers = headers or {"content-type": "text/html"}
    resp.is_redirect = is_redirect
    resp.url = "https://example.com/final"

    async def _aiter():
        for c in chunks:
            yield c
    resp.aiter_bytes = _aiter

    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=resp)
    cm.__aexit__ = AsyncMock(return_value=False)
    return cm


class TestSafeFetch:

    def _client_with(self, responses):
        """responses: list of stream context managers returned per stream() call."""
        client = MagicMock()
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=False)
        client.stream = MagicMock(side_effect=responses)
        return client

    def test_reads_body_up_to_limit_and_truncates(self):
        client = self._client_with([_stream_response(chunks=[b"a" * 100, b"b" * 100])])
        with patch.object(net_security, "validate_public_url", new=AsyncMock(return_value={"93.184.216.34"})), \
             patch.object(net_security.httpx, "AsyncClient", return_value=client):
            result = _run(safe_fetch("https://example.com", max_bytes=150, timeout=5, truncate=True))
        assert result.truncated is True
        assert len(result.content) == 150

    def test_raises_when_over_limit_and_not_truncating(self):
        client = self._client_with([_stream_response(chunks=[b"a" * 100, b"b" * 100])])
        with patch.object(net_security, "validate_public_url", new=AsyncMock(return_value={"93.184.216.34"})), \
             patch.object(net_security.httpx, "AsyncClient", return_value=client):
            with pytest.raises(UnsafeURLError) as ei:
                _run(safe_fetch("https://example.com", max_bytes=150, timeout=5, truncate=False))
        assert ei.value.code == "RESPONSE_TOO_LARGE"

    def test_rejects_declared_content_length_over_limit(self):
        client = self._client_with([
            _stream_response(headers={"content-type": "image/png", "content-length": "99999"}),
        ])
        with patch.object(net_security, "validate_public_url", new=AsyncMock(return_value={"93.184.216.34"})), \
             patch.object(net_security.httpx, "AsyncClient", return_value=client):
            with pytest.raises(UnsafeURLError) as ei:
                _run(safe_fetch("https://example.com/big.png", max_bytes=1000, timeout=5, truncate=False))
        assert ei.value.code == "RESPONSE_TOO_LARGE"

    def test_revalidates_each_redirect_hop(self):
        # First hop is a redirect to an internal host; validate must block it.
        redirect = _stream_response(status=302, headers={"location": "http://169.254.169.254/"}, is_redirect=True)
        client = self._client_with([redirect])

        calls = []

        async def fake_validate(url):
            calls.append(url)
            if "169.254" in url:
                raise UnsafeURLError("BLOCKED_PRIVATE_ADDRESS", "blocked")
            return {"93.184.216.34"}

        with patch.object(net_security, "validate_public_url", new=fake_validate), \
             patch.object(net_security.httpx, "AsyncClient", return_value=client):
            with pytest.raises(UnsafeURLError) as ei:
                _run(safe_fetch("https://example.com/redir", max_bytes=1000, timeout=5, truncate=True))
        assert ei.value.code == "BLOCKED_PRIVATE_ADDRESS"
        assert any("169.254" in c for c in calls)


class TestSsrfRouteGuard:
    """The Playwright route guard used on the local render path."""

    def _route(self, url):
        route = MagicMock()
        route.request.url = url
        route.abort = AsyncMock()
        route.continue_ = AsyncMock()
        return route

    def test_blocks_private_host_subresource(self):
        from app.browser import _ssrf_route_guard
        route = self._route("http://169.254.169.254/latest/meta-data/")
        _run(_ssrf_route_guard(route))
        route.abort.assert_awaited_once()
        route.continue_.assert_not_awaited()

    def test_allows_public_host(self):
        from app.browser import _ssrf_route_guard
        from app import net_security
        route = self._route("https://example.com/app.js")
        with patch.object(net_security, "_resolve_ips", new=AsyncMock(return_value={"93.184.216.34"})):
            _run(_ssrf_route_guard(route))
        route.continue_.assert_awaited_once()
        route.abort.assert_not_awaited()

    def test_allows_data_uri(self):
        from app.browser import _ssrf_route_guard
        route = self._route("data:image/png;base64,iVBORw0KGgo=")
        _run(_ssrf_route_guard(route))
        route.continue_.assert_awaited_once()
        route.abort.assert_not_awaited()


class TestRouteGuardSchemes:
    def _route(self, url):
        route = MagicMock()
        route.request.url = url
        route.abort = AsyncMock()
        route.continue_ = AsyncMock()
        return route

    def test_allows_blob_scheme(self):
        from app.browser import _ssrf_route_guard
        route = self._route("blob:https://example.com/uuid")
        _run(_ssrf_route_guard(route))
        route.continue_.assert_awaited_once()

    def test_blocks_websocket_scheme(self):
        from app.browser import _ssrf_route_guard
        route = self._route("ws://169.254.169.254/")
        _run(_ssrf_route_guard(route))
        route.abort.assert_awaited_once()
        route.continue_.assert_not_awaited()

    def test_blocks_file_scheme(self):
        from app.browser import _ssrf_route_guard
        route = self._route("file:///etc/passwd")
        _run(_ssrf_route_guard(route))
        route.abort.assert_awaited_once()


class TestBrowserNavigationSSRF:
    def test_assert_navigable_blocks_private(self):
        from app.browser import _assert_navigable, BrowserNavigationError
        with pytest.raises(BrowserNavigationError) as ei:
            _run(_assert_navigable("http://127.0.0.1/admin"))
        assert ei.value.code == "BLOCKED_PRIVATE_ADDRESS"

    def test_assert_navigable_allows_about_blank(self):
        from app.browser import _assert_navigable
        _run(_assert_navigable("about:blank"))  # no raise

    def test_open_tab_blocks_private_url(self, monkeypatch):
        import asyncio
        import app.browser as bmod
        from unittest.mock import AsyncMock, patch
        from app.browser import BrowserManager, BrowserNavigationError
        # Enable egress so the test isolates the private-address block (not the
        # egress gate).
        monkeypatch.setattr(bmod, "TRUSTED_BF_EGRESS", True)
        mgr = BrowserManager()
        with patch.object(BrowserManager, "is_cloud", property(lambda self: True)):
            mgr._bf_call = AsyncMock()
            with pytest.raises(BrowserNavigationError) as ei:
                asyncio.run(mgr.open_tab("t1", "http://169.254.169.254/", api_key="k"))
        assert ei.value.code == "BLOCKED_PRIVATE_ADDRESS"
        mgr._bf_call.assert_not_awaited()  # never even created a session

    def test_open_tab_blocks_non_http_scheme(self, monkeypatch):
        import asyncio
        import app.browser as bmod
        from unittest.mock import AsyncMock, patch
        from app.browser import BrowserManager, BrowserNavigationError
        monkeypatch.setattr(bmod, "TRUSTED_BF_EGRESS", True)
        mgr = BrowserManager()
        with patch.object(BrowserManager, "is_cloud", property(lambda self: True)):
            mgr._bf_call = AsyncMock()
            with pytest.raises(BrowserNavigationError) as ei:
                asyncio.run(mgr.open_tab("t1", "file:///etc/passwd", api_key="k"))
        assert ei.value.code == "UNSUPPORTED_SCHEME"
        mgr._bf_call.assert_not_awaited()


class TestRenderDisabled:
    def test_render_disabled_by_default(self):
        import asyncio
        import app.browser as bmod
        from app.browser import BrowserManager, RenderDisabledError
        # Both surfaces off by default (safe).
        assert bmod.TRUSTED_BF_EGRESS is False
        assert bmod.TRUSTED_LOCAL_BROWSER_EGRESS is False
        mgr = BrowserManager()
        with pytest.raises(RenderDisabledError):
            asyncio.run(mgr.render_page_text("https://example.com"))

    def test_shared_open_disabled_without_egress(self):
        # The shared browser is gated too, not just render.
        import asyncio
        from unittest.mock import AsyncMock, patch
        from app.browser import BrowserManager, RenderDisabledError
        mgr = BrowserManager()
        with patch.object(BrowserManager, "is_cloud", property(lambda self: True)):
            mgr._bf_call = AsyncMock()
            with pytest.raises(RenderDisabledError):
                asyncio.run(mgr.open_tab("t1", "https://example.com", api_key="k"))
        mgr._bf_call.assert_not_awaited()

    def test_render_runs_when_trusted_egress_enabled(self, monkeypatch):
        import asyncio
        from unittest.mock import AsyncMock, patch
        import app.browser as bmod
        from app.browser import BrowserManager
        monkeypatch.setattr(bmod, "TRUSTED_BF_EGRESS", True)
        monkeypatch.setattr(bmod, "_assert_navigable", AsyncMock())
        mgr = BrowserManager()
        with patch.object(BrowserManager, "is_cloud_for", lambda self, k=None: True):
            mgr._bf_call = AsyncMock(side_effect=[
                {"result": {"session_id": "s1"}},           # create_session
                {"result": {}},                              # navigate
                {"result": {"snapshot": "hello world " * 20}},  # snapshot
                {"result": {"url": "https://example.com", "title": "Example"}},  # get_page_info
                {"result": {}},                              # close_session
            ])
            out = asyncio.run(mgr.render_page_text("https://example.com", api_key="k"))
        assert "hello world" in out["text"]


class TestRenderSemaphore:
    def test_concurrency_limit_serializes_and_releases(self, monkeypatch):
        # With RENDER_MAX_CONCURRENCY=1, two concurrent renders must not overlap,
        # and the semaphore must be released after each (even the second runs).
        import asyncio
        from unittest.mock import AsyncMock, patch
        import app.browser as bmod
        from app.browser import BrowserManager

        monkeypatch.setattr(bmod, "TRUSTED_BF_EGRESS", True)
        monkeypatch.setattr(bmod, "RENDER_MAX_CONCURRENCY", 1)
        monkeypatch.setattr(bmod, "_assert_navigable", AsyncMock())

        mgr = BrowserManager()
        overlap = {"active": 0, "max": 0}

        async def fake_inner(self, url, api_key=None):
            overlap["active"] += 1
            overlap["max"] = max(overlap["max"], overlap["active"])
            await asyncio.sleep(0.02)
            overlap["active"] -= 1
            return {"url": url, "title": "", "text": "ok"}

        async def _run():
            with patch.object(BrowserManager, "_render_page_text_inner", fake_inner):
                r1, r2 = await asyncio.gather(
                    mgr.render_page_text("https://a.example", api_key="k"),
                    mgr.render_page_text("https://b.example", api_key="k"),
                )
            return r1, r2

        r1, r2 = _run_asyncio(_run())
        assert overlap["max"] == 1          # never ran concurrently
        assert r1["text"] == "ok" and r2["text"] == "ok"  # both completed (released)


def _run_asyncio(coro):
    import asyncio
    return asyncio.run(coro)
