# -*- coding: utf-8 -*-
"""Tests for the SSRF-safe fetch helpers (app/net_security.py)."""

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

    def test_rejects_loopback(self):
        with pytest.raises(UnsafeURLError) as ei:
            _run(validate_public_url("http://127.0.0.1/admin"))
        assert ei.value.code == "BLOCKED_PRIVATE_ADDRESS"

    def test_rejects_cloud_metadata(self):
        with pytest.raises(UnsafeURLError) as ei:
            _run(validate_public_url("http://169.254.169.254/latest/meta-data/"))
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

    def test_allows_public_hostname(self):
        with patch.object(net_security, "_resolve_ips", new=AsyncMock(return_value={"93.184.216.34"})):
            _run(validate_public_url("https://example.com/page"))  # no raise


def _stream_response(*, status=200, headers=None, chunks=(b"hello",), is_redirect=False):
    resp = MagicMock()
    resp.status_code = status
    resp.headers = headers or {"content-type": "text/html"}
    resp.is_redirect = is_redirect

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
        client = MagicMock()
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=False)
        client.stream = MagicMock(side_effect=responses)
        return client

    def test_truncates_at_limit(self):
        client = self._client_with([_stream_response(chunks=[b"a" * 100, b"b" * 100])])
        with patch.object(net_security, "validate_public_url", new=AsyncMock()), \
             patch.object(net_security.httpx, "AsyncClient", return_value=client):
            result = _run(safe_fetch("https://example.com", max_bytes=150, timeout=5, truncate=True))
        assert result.truncated is True and len(result.content) == 150

    def test_raises_over_limit_when_not_truncating(self):
        client = self._client_with([_stream_response(chunks=[b"a" * 200])])
        with patch.object(net_security, "validate_public_url", new=AsyncMock()), \
             patch.object(net_security.httpx, "AsyncClient", return_value=client):
            with pytest.raises(UnsafeURLError) as ei:
                _run(safe_fetch("https://example.com", max_bytes=150, timeout=5, truncate=False))
        assert ei.value.code == "RESPONSE_TOO_LARGE"

    def test_revalidates_each_redirect_hop(self):
        redirect = _stream_response(status=302, headers={"location": "http://169.254.169.254/"}, is_redirect=True)
        client = self._client_with([redirect])
        calls = []

        async def fake_validate(url):
            calls.append(url)
            if "169.254" in url:
                raise UnsafeURLError("BLOCKED_PRIVATE_ADDRESS", "blocked")

        with patch.object(net_security, "validate_public_url", new=fake_validate), \
             patch.object(net_security.httpx, "AsyncClient", return_value=client):
            with pytest.raises(UnsafeURLError) as ei:
                _run(safe_fetch("https://example.com/redir", max_bytes=1000, timeout=5, truncate=True))
        assert ei.value.code == "BLOCKED_PRIVATE_ADDRESS"
        assert any("169.254" in c for c in calls)
