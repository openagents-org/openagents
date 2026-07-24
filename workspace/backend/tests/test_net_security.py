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

        transport = net_security._PinnedTransport({"example.com": "93.184.216.34"})
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

        transport = net_security._PinnedTransport({"93.184.216.34": "93.184.216.34"})
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
