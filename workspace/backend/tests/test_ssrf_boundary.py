# -*- coding: utf-8 -*-
"""
SSRF boundary tests.

Two boundaries are covered:

  * the static tier (app.net_security) — every hop is resolved once, validated,
    and connected to by pinned IP, so a name that rebinds after validation
    cannot swing the connection to an internal address;

  * the browser tier (app.browser_egress) — every request Chromium makes, of
    every kind, goes through a policy proxy. The browser integration tests
    drive a real Chromium and assert on what the proxy was asked to reach,
    because the thing worth regression-testing is the network destination,
    not whether some interception hook fired.

The Chromium tests skip when no browser binary is installed (the production
image does not ship one); the rest always run.
"""

import asyncio
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from unittest.mock import AsyncMock, patch

import pytest

from app import net_security
from app.browser import BLANK_PAGE, guard_browser_url
from app.browser_egress import EgressPolicyProxy, _split_host_port, _target_from_absolute_url
from app.net_security import UnsafeURLError, safe_fetch, validate_public_url


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


# ---------------------------------------------------------------------------
# Static tier: resolve once, connect to the pinned IP
# ---------------------------------------------------------------------------

class TestResolveOnceAndPin:
    """The rebinding case: validation sees a public address, and the socket
    must go to *that* address rather than whatever a second lookup returns."""

    def test_connects_to_first_resolved_ip_not_a_second_lookup(self):
        """A name that answers public once and internal afterwards must still
        be connected to at the address that was validated."""
        import httpx

        lookups = []
        connected_to = []

        async def rebinding_resolve(host, port):
            lookups.append(host)
            # First lookup: public. Any later lookup: cloud metadata.
            return ["93.184.216.34"] if len(lookups) == 1 else ["169.254.169.254"]

        async def capture(self, request):
            connected_to.append(request.url.host)
            return httpx.Response(200, content=b"ok", request=request)

        with patch.object(net_security, "_resolve_ips", new=rebinding_resolve):
            with patch.object(httpx.AsyncHTTPTransport, "handle_async_request", new=capture):
                result = _run(safe_fetch("http://rebind.example/", max_bytes=1000, timeout=5))

        assert result.status_code == 200
        # One resolution for the one hop, and the socket went to the address
        # that resolution returned — not to what a connect-time lookup says.
        assert lookups == ["rebind.example"]
        assert connected_to == ["93.184.216.34"]

    def test_redirect_hop_to_internal_is_blocked_after_a_public_first_hop(self):
        """The first hop being legitimate must not carry the second one."""
        import httpx

        async def resolve(host, port):
            return ["93.184.216.34"] if host == "public.example" else ["169.254.169.254"]

        async def redirect_once(self, request):
            return httpx.Response(
                302, headers={"location": "http://metadata.example/creds"}, request=request
            )

        with patch.object(net_security, "_resolve_ips", new=resolve):
            with patch.object(httpx.AsyncHTTPTransport, "handle_async_request", new=redirect_once):
                with pytest.raises(UnsafeURLError) as ei:
                    _run(safe_fetch("http://public.example/", max_bytes=1000, timeout=5))
        assert ei.value.code == "BLOCKED_PRIVATE_ADDRESS"

    def test_pinned_transport_rewrites_host_but_keeps_identity(self):
        import httpx
        from app.net_security import _PinnedTransport

        transport = _PinnedTransport("93.184.216.34")
        request = httpx.Request("GET", "https://example.com/page")
        captured = {}

        async def fake_super(req):
            captured["url"] = str(req.url)
            captured["host_header"] = req.headers.get("host")
            captured["sni"] = req.extensions.get("sni_hostname")
            return httpx.Response(200)

        with patch.object(httpx.AsyncHTTPTransport, "handle_async_request", new=lambda self, r: fake_super(r)):
            _run(transport.handle_async_request(request))

        # Socket goes to the pinned IP; Host and TLS identity stay the domain,
        # so certificate verification is still against example.com.
        assert captured["url"] == "https://93.184.216.34/page"
        assert captured["host_header"] == "example.com"
        assert captured["sni"] == "example.com"

    def test_ipv6_pin_is_bracketed(self):
        import httpx
        from app.net_security import _PinnedTransport

        transport = _PinnedTransport("2606:2800:220:1:248:1893:25c8:1946")
        request = httpx.Request("GET", "https://example.com/x")
        captured = {}

        async def fake_super(req):
            captured["url"] = str(req.url)
            return httpx.Response(200)

        with patch.object(httpx.AsyncHTTPTransport, "handle_async_request", new=lambda self, r: fake_super(r)):
            _run(transport.handle_async_request(request))
        assert captured["url"].startswith("https://[2606:2800:220:1:248:1893:25c8:1946]/")

    def test_mixed_public_and_private_answers_are_rejected(self):
        """A name answering with both a public and an internal address is
        refused outright — picking the 'good' one would leave which address a
        later lookup returns up to the attacker."""
        async def resolve(host, port):
            return ["93.184.216.34", "10.0.0.7"]

        with patch.object(net_security, "_resolve_ips", new=resolve):
            with pytest.raises(UnsafeURLError) as ei:
                _run(validate_public_url("http://mixed.example/"))
        assert ei.value.code == "BLOCKED_PRIVATE_ADDRESS"

    def test_blocked_message_does_not_leak_the_resolved_address(self):
        async def resolve(host, port):
            return ["10.11.12.13"]

        with patch.object(net_security, "_resolve_ips", new=resolve):
            with pytest.raises(UnsafeURLError) as ei:
                _run(validate_public_url("http://internal.example/"))
        # Knowing *that* it is internal is fine; knowing which address it maps
        # to would let an agent map internal DNS one name at a time.
        assert "10.11.12.13" not in str(ei.value)


class TestPortPolicy:
    def test_blocks_non_http_port(self):
        with pytest.raises(UnsafeURLError) as ei:
            _run(validate_public_url("http://example.com:22/"))
        assert ei.value.code == "BLOCKED_PORT"

    def test_internal_address_reports_private_not_port(self):
        # Address policy must win, so the alertable code is the one emitted.
        with pytest.raises(UnsafeURLError) as ei:
            _run(validate_public_url("http://127.0.0.1:9999/"))
        assert ei.value.code == "BLOCKED_PRIVATE_ADDRESS"


# ---------------------------------------------------------------------------
# Browser entry guard
# ---------------------------------------------------------------------------

class TestBrowserUrlGuard:
    def test_about_blank_is_allowed(self):
        assert _run(guard_browser_url("about:blank")) == BLANK_PAGE
        assert _run(guard_browser_url(None)) == BLANK_PAGE
        assert _run(guard_browser_url("")) == BLANK_PAGE

    @pytest.mark.parametrize("url", [
        "http://169.254.169.254/latest/meta-data/",
        "http://127.0.0.1/admin",
        "http://[::ffff:127.0.0.1]/",
    ])
    def test_internal_targets_rejected(self, url):
        with pytest.raises(UnsafeURLError) as ei:
            _run(guard_browser_url(url))
        assert ei.value.code == "BLOCKED_PRIVATE_ADDRESS"

    @pytest.mark.parametrize("url", [
        "file:///etc/passwd",
        "chrome://settings",
        "data:text/html,<script>alert(1)</script>",
        "view-source:http://example.com/",
    ])
    def test_non_http_schemes_rejected(self, url):
        # about:blank is allowlisted by exact match; nothing else non-http is.
        with pytest.raises(UnsafeURLError):
            _run(guard_browser_url(url))


# ---------------------------------------------------------------------------
# Egress proxy policy
# ---------------------------------------------------------------------------

class TestEgressProxyParsing:
    def test_split_host_port_ipv6(self):
        assert _split_host_port("[::1]:8443", 443) == ("::1", 8443)
        assert _split_host_port("[::1]", 443) == ("::1", 443)

    def test_split_host_port_ipv4(self):
        assert _split_host_port("example.com:8080", 443) == ("example.com", 8080)
        assert _split_host_port("example.com", 80) == ("example.com", 80)

    def test_absolute_form_target(self):
        assert _target_from_absolute_url("http://example.com/a/b?c=1") == ("example.com", 80, "/a/b?c=1")
        assert _target_from_absolute_url("http://example.com") == ("example.com", 80, "/")

    def test_origin_form_target_is_refused(self):
        # A proxy only ever receives absolute-form or CONNECT; anything else
        # is malformed and must not be guessed at.
        with pytest.raises(ValueError):
            _target_from_absolute_url("/relative/path")


class TestEgressProxyPolicy:
    """Drive the proxy directly over a socket — no browser needed."""

    def _request(self, request_line: str) -> bytes:
        async def run():
            proxy = EgressPolicyProxy()
            port = await proxy.start()
            try:
                reader, writer = await asyncio.open_connection("127.0.0.1", port)
                writer.write(f"{request_line}\r\nHost: x\r\n\r\n".encode())
                await writer.drain()
                data = await asyncio.wait_for(reader.read(200), timeout=10)
                writer.close()
                return data, proxy
            finally:
                await proxy.stop()

        data, _proxy = _run(run())
        return data

    @pytest.mark.parametrize("request_line", [
        "GET http://169.254.169.254/latest/meta-data/ HTTP/1.1",
        "GET http://127.0.0.1:8000/v1/workspaces HTTP/1.1",
        "GET http://10.0.0.5/internal HTTP/1.1",
        "GET http://192.168.1.1/router HTTP/1.1",
        "CONNECT 169.254.169.254:443 HTTP/1.1",
        "CONNECT 127.0.0.1:8000 HTTP/1.1",
        "CONNECT [::1]:443 HTTP/1.1",
    ])
    def test_internal_destinations_are_refused(self, request_line):
        assert b"403 Forbidden" in self._request(request_line)

    @pytest.mark.parametrize("request_line", [
        "GET ftp://example.com/x HTTP/1.1",
        "GET /origin-form HTTP/1.1",
        "GARBAGE",
    ])
    def test_unparseable_requests_fail_closed(self, request_line):
        assert b"403 Forbidden" in self._request(request_line)

    def test_non_http_port_is_refused(self):
        assert b"403 Forbidden" in self._request("CONNECT example.com:22 HTTP/1.1")


# ---------------------------------------------------------------------------
# Real-browser integration: the destinations Chromium actually tries to reach
# ---------------------------------------------------------------------------

def _chromium_available() -> bool:
    try:
        import os

        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            return os.path.exists(p.chromium.executable_path)
    except Exception:
        return False


CHROMIUM = pytest.mark.skipif(
    not _chromium_available(), reason="no Chromium binary installed (production image ships none)"
)

INTERNAL = "169.254.169.254"
INTERNAL_PRIVATE = "10.0.0.5"

PAGES = {
    "/redirect": ("302", f"http://{INTERNAL}/creds"),
    "/meta": ("200", f'<meta http-equiv="refresh" content="0;url=http://{INTERNAL}/meta-target">'),
    "/jsnav": ("200", f'<script>location.href="http://{INTERNAL}/jsnav-target"</script>'),
    "/xhr": ("200", f'<script>fetch("http://{INTERNAL}/xhr-target").catch(function(){{}})</script>'),
    "/iframe": ("200", f'<iframe src="http://{INTERNAL_PRIVATE}/iframe-target"></iframe>'),
    "/img": ("200", f'<img src="http://{INTERNAL}/img-target">'),
    "/ws": ("200", f'<script>try{{new WebSocket("ws://{INTERNAL_PRIVATE}/ws-target")}}catch(e){{}}</script>'),
    "/popup": ("200", f'<script>window.open("http://{INTERNAL}/popup-target")</script>'),
    "/public": ("200", "<html><body>public content here</body></html>"),
}


class _OriginHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split("?")[0]
        kind, payload = PAGES.get(path, ("200", "<html><body>ok</body></html>"))
        if kind == "302":
            self.send_response(302)
            self.send_header("Location", payload)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        body = payload.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


@pytest.fixture(scope="module")
def origin_server():
    server = HTTPServer(("127.0.0.1", 0), _OriginHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield server.server_address[1]
    server.shutdown()


@CHROMIUM
class TestBrowserEgressIntegration:
    """Launch a real Chromium behind the policy proxy and assert on every
    destination it tried to reach. The origin page is served from loopback,
    which the policy would normally refuse — so the policy is patched to allow
    exactly that one port and nothing else, letting the test distinguish
    'reached the page' from 'escaped to an internal address'."""

    def _drive(self, origin_port, path, wait_ms=1500):
        attempts = []

        async def policy(host, port):
            attempts.append((host, port))
            if host in ("127.0.0.1", "localhost") and port == origin_port:
                return "127.0.0.1"
            raise UnsafeURLError("BLOCKED_PRIVATE_ADDRESS", "Host resolves to a non-public address")

        async def run():
            from playwright.async_api import async_playwright

            proxy = EgressPolicyProxy()
            await proxy.start()
            with patch("app.browser_egress.resolve_and_validate", new=policy):
                async with async_playwright() as p:
                    browser = await p.chromium.launch(
                        headless=True,
                        args=["--no-sandbox"] + proxy.chromium_args(),
                    )
                    page = await browser.new_page()
                    try:
                        await page.goto(f"http://127.0.0.1:{origin_port}{path}", timeout=15000)
                        await page.wait_for_timeout(wait_ms)
                    except Exception:
                        pass
                    body = ""
                    try:
                        body = await page.content()
                    except Exception:
                        pass
                    await browser.close()
            await proxy.stop()
            return attempts, proxy.blocked_count, body

        return _run(run())

    @pytest.mark.parametrize("path,expected_host", [
        ("/redirect", INTERNAL),
        ("/meta", INTERNAL),
        ("/jsnav", INTERNAL),
        ("/xhr", INTERNAL),
        ("/img", INTERNAL),
        ("/popup", INTERNAL),
        ("/iframe", INTERNAL_PRIVATE),
        ("/ws", INTERNAL_PRIVATE),
    ])
    def test_internal_navigation_is_blocked_at_the_chokepoint(self, origin_server, path, expected_host):
        attempts, blocked, _body = self._drive(origin_server, path)
        hosts = [h for h, _p in attempts]
        # The browser did try to reach the internal host (so the test is
        # actually exercising the vector) and the proxy refused it.
        assert expected_host in hosts, f"{path}: browser never attempted {expected_host}; got {hosts}"
        assert blocked >= 1, f"{path}: proxy allowed the internal request"

    def test_public_page_still_loads(self, origin_server):
        _attempts, _blocked, body = self._drive(origin_server, "/public", wait_ms=300)
        assert "public content here" in body

    def test_loopback_is_not_bypassed_by_chromium(self, origin_server):
        # The whole design rests on --proxy-bypass-list=<-loopback>: without it
        # Chromium fetches loopback directly and never consults the policy.
        attempts, _blocked, _body = self._drive(origin_server, "/public", wait_ms=300)
        assert ("127.0.0.1", origin_server) in attempts, (
            "loopback request never reached the proxy — the bypass flag regressed"
        )


# ---------------------------------------------------------------------------
# Production wiring: the manager must actually launch behind the proxy
# ---------------------------------------------------------------------------

class TestLocalBrowserLaunchWiring:
    """The integration tests above build a proxy themselves, so they would
    still pass if BrowserManager forgot to launch Chromium behind one. This
    asserts the real launch path."""

    def _captured_launch_args(self, env=None):
        from app.browser import BrowserManager

        captured = {}

        class _FakeChromium:
            async def launch(self, headless=True, args=None):
                captured["args"] = args or []
                return object()

        class _FakePlaywright:
            chromium = _FakeChromium()

        async def run():
            manager = BrowserManager()
            manager._playwright = _FakePlaywright()
            await manager._ensure_local_browser()
            port = manager._egress_proxy.port
            await manager._egress_proxy.stop()
            return port

        port = _run(run())
        return captured["args"], port

    def test_launches_behind_the_egress_proxy(self):
        args, port = self._captured_launch_args()
        assert f"--proxy-server=http://127.0.0.1:{port}" in args
        assert "--proxy-bypass-list=<-loopback>" in args

    def test_sandbox_flags_are_gated(self):
        args, _port = self._captured_launch_args()
        # Default keeps --no-sandbox because the image has no non-root user;
        # the point of the assertion is that it is the gate deciding, so
        # enabling BROWSER_SANDBOX genuinely changes the launch.
        assert "--no-sandbox" in args
        with patch("app.browser.BROWSER_SANDBOX", True):
            args_sandboxed, _ = self._captured_launch_args()
        assert "--no-sandbox" not in args_sandboxed


# ---------------------------------------------------------------------------
# Router surface: shared browser tools and the fetch render tier
# ---------------------------------------------------------------------------

def _create_workspace(client):
    resp = client.post("/v1/workspaces", json={
        "name": "SSRF Boundary Workspace",
        "agent_name": "agent-ssrf",
        "creator_email": "test@example.com",
    })
    assert resp.status_code == 200
    data = resp.json()["data"]
    return {"id": data["workspaceId"], "token": data["token"]}


class TestSharedBrowserRouterRejectsInternal:
    """The shared-browser tools are agent-callable with an arbitrary URL, so
    they need the same entry check as /v1/fetch — and it has to surface as a
    stable 400, not a generic 500."""

    @pytest.mark.parametrize("url", [
        "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
        "http://127.0.0.1:8000/v1/workspaces",
        "file:///etc/passwd",
    ])
    def test_open_tab_rejects_internal_url(self, client, url):
        workspace = _create_workspace(client)
        resp = client.post("/v1/browser/tabs", json={
            "url": url,
            "network": workspace["id"],
            "source": "openagents:agent-ssrf",
        }, headers={"X-Workspace-Token": workspace["token"]})
        assert resp.status_code == 400
        assert resp.json()["data"]["error_code"] in (
            "BLOCKED_PRIVATE_ADDRESS", "UNSUPPORTED_SCHEME", "BLOCKED_PORT",
        )

    def test_open_tab_without_url_still_works(self, client):
        # about:blank is the default a tab opens on; the guard must not break it.
        workspace = _create_workspace(client)
        with patch("app.browser.BrowserManager.open_tab",
                   new=AsyncMock(return_value={"url": "about:blank", "title": ""})):
            resp = client.post("/v1/browser/tabs", json={
                "network": workspace["id"],
                "source": "openagents:agent-ssrf",
            }, headers={"X-Workspace-Token": workspace["token"]})
        assert resp.status_code == 200


class TestFetchRenderTierRejectsInternal:
    def test_render_mode_propagates_unsafe_url_as_400(self, client):
        workspace = _create_workspace(client)
        with patch("app.browser.BrowserManager.render_page_text",
                   new=AsyncMock(side_effect=UnsafeURLError(
                       "BLOCKED_PRIVATE_ADDRESS", "Host resolves to a non-public address"))):
            with patch("app.routers.fetch.validate_public_url", new=AsyncMock(return_value="93.184.216.34")):
                resp = client.post("/v1/fetch", json={
                    "url": "http://attacker.example/redirect-to-metadata",
                    "network": workspace["id"],
                    "mode": "render",
                    "source": "openagents:agent-ssrf",
                }, headers={"X-Workspace-Token": workspace["token"]})
        assert resp.status_code == 400
        assert resp.json()["data"]["error_code"] == "BLOCKED_PRIVATE_ADDRESS"

    def test_render_mode_blocks_internal_entry_url(self, client):
        workspace = _create_workspace(client)
        resp = client.post("/v1/fetch", json={
            "url": "http://169.254.169.254/latest/meta-data/",
            "network": workspace["id"],
            "mode": "render",
            "source": "openagents:agent-ssrf",
        }, headers={"X-Workspace-Token": workspace["token"]})
        assert resp.status_code == 400
        assert resp.json()["data"]["error_code"] == "BLOCKED_PRIVATE_ADDRESS"


class TestFetchRateLimit:
    def test_rate_limit_kicks_in(self, client):
        from app.routers import fetch as fetch_router

        workspace = _create_workspace(client)
        fetch_router._fetch_hits.clear()
        with patch.object(fetch_router, "FETCH_RATE_LIMIT_PER_MINUTE", 3):
            codes = []
            for _ in range(5):
                resp = client.post("/v1/fetch", json={
                    "url": "http://169.254.169.254/",   # rejected either way
                    "network": workspace["id"],
                    "source": "openagents:agent-ssrf",
                }, headers={"X-Workspace-Token": workspace["token"]})
                codes.append(resp.json()["data"]["error_code"])
        fetch_router._fetch_hits.clear()
        assert codes[-1] == "FETCH_RATE_LIMITED"
        assert "BLOCKED_PRIVATE_ADDRESS" in codes
