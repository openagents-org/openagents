# -*- coding: utf-8 -*-
"""
SSRF-safe outbound HTTP for agent-triggered fetches.

Anything that fetches a URL chosen by a workspace agent (POST /v1/fetch,
POST /v1/files/from_url) MUST go through here. A raw httpx.get would let an
agent reach the backend's own network: cloud metadata (169.254.169.254),
localhost, and private/internal services.

Protections:
  - scheme restricted to http/https
  - URLs with embedded credentials rejected
  - every hostname is resolved and ALL resolved IPs must be public
    (private / loopback / link-local / reserved / multicast are blocked,
    including IPv4-mapped IPv6)
  - redirects are followed manually and re-validated at every hop
  - trust_env=False so backend proxy env vars can't redirect the request
  - streamed with an enforced byte cap so a huge body can't OOM the worker

Known residual: a DNS-rebinding window exists between validation and the
socket connect. The high-severity vectors (direct internal URLs, metadata
IPs, redirect-to-internal) are all closed; pinning the connection to the
validated IP would close rebinding too and can be layered on later.
"""

import asyncio
import ipaddress
import logging
from typing import Optional
from urllib.parse import urljoin, urlparse

import httpx

logger = logging.getLogger(__name__)

ALLOWED_SCHEMES = {"http", "https"}
DEFAULT_MAX_REDIRECTS = 4


class UnsafeURLError(Exception):
    """A URL was rejected before or during fetching. Carries a stable code."""

    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


def _ip_is_public(ip: ipaddress._BaseAddress) -> bool:
    # Unwrap IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1) so it's judged as its v4.
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return not (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


async def _resolve_ips(host: str, port: int) -> set:
    loop = asyncio.get_event_loop()
    try:
        infos = await loop.getaddrinfo(host, port, proto=0, type=0)
    except OSError as e:
        raise UnsafeURLError("DNS_RESOLUTION_FAILED", f"Could not resolve host '{host}': {e}") from e
    return {info[4][0] for info in infos}


async def validate_public_url(url: str) -> set:
    """Validate `url` and return the set of resolved public IPs.

    Raises UnsafeURLError unless it is an http(s) URL with no embedded
    credentials that resolves only to public IP addresses. The returned IPs
    are used to pin the connection (see safe_fetch), so the socket connects to
    an address we actually validated rather than re-resolving (rebinding)."""
    parsed = urlparse(url)
    if parsed.scheme not in ALLOWED_SCHEMES:
        raise UnsafeURLError("UNSUPPORTED_SCHEME", "Only http(s) URLs are supported")
    if parsed.username or parsed.password:
        raise UnsafeURLError("URL_CREDENTIALS_NOT_ALLOWED", "URLs with embedded credentials are not allowed")
    host = parsed.hostname
    if not host:
        raise UnsafeURLError("INVALID_URL", "URL has no host")
    # An out-of-range / non-numeric port makes urlparse raise on .port access.
    try:
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
    except ValueError:
        raise UnsafeURLError("INVALID_URL", "URL has an invalid port")

    # An IP literal is validated directly; a hostname is resolved first.
    try:
        literal = ipaddress.ip_address(host)
        ips = {str(literal)}
    except ValueError:
        ips = await _resolve_ips(host, port)

    if not ips:
        raise UnsafeURLError("DNS_RESOLUTION_FAILED", f"Host '{host}' did not resolve")
    for ip_str in ips:
        if not _ip_is_public(ipaddress.ip_address(ip_str)):
            raise UnsafeURLError(
                "BLOCKED_PRIVATE_ADDRESS",
                f"Host '{host}' resolves to a non-public address ({ip_str})",
            )
    return ips


def _order_ips(ips) -> list:
    """Deterministic connect order: IPv4 first (more reliably routable in most
    deployments), then IPv6, each sorted."""
    v4 = sorted(ip for ip in ips if ":" not in ip)
    v6 = sorted(ip for ip in ips if ":" in ip)
    return v4 + v6


class _PinnedTransport(httpx.AsyncHTTPTransport):
    """Transport that connects to a pre-validated IP while keeping the original
    hostname for the Host header and TLS (SNI + certificate verification).

    This closes the DNS-rebinding window: validate_public_url resolves and
    checks the IPs, and the socket connects to exactly one of those IPs instead
    of re-resolving the hostname at connect time. httpcore honors the
    `sni_hostname` request extension as the TLS server_hostname, so certificate
    verification still runs against the real hostname.

    When a host has several validated IPs, they are tried in order so a first
    IP that happens to be unreachable (e.g. an unroutable IPv6) fails over to
    the next validated address rather than failing the whole fetch.
    """

    def __init__(self, pin_map: dict, **kwargs):
        super().__init__(**kwargs)
        self._pin_map = pin_map  # hostname -> [validated IPs], updated per hop

    async def handle_async_request(self, request):
        host = request.url.host
        candidates = self._pin_map.get(host)
        if not candidates:
            return await super().handle_async_request(request)

        original_url = request.url
        netloc = host if original_url.port is None else f"{host}:{original_url.port}"
        base_extensions = dict(request.extensions or {})
        last_exc = None
        for ip in candidates:
            if ip != host:
                request.url = original_url.copy_with(host=ip)
                request.headers["Host"] = netloc
                request.extensions = {**base_extensions, "sni_hostname": base_extensions.get("sni_hostname", host)}
            else:
                request.url = original_url
                request.extensions = dict(base_extensions)
            try:
                return await super().handle_async_request(request)
            except (httpx.ConnectError, httpx.ConnectTimeout) as e:
                last_exc = e
                continue
        # All validated IPs failed to connect — re-raise the last error.
        raise last_exc


class SafeFetchResult:
    __slots__ = ("content", "text", "status_code", "headers", "final_url", "truncated")

    def __init__(self, content, status_code, headers, final_url, truncated):
        self.content = content
        self.status_code = status_code
        self.headers = headers
        self.final_url = final_url
        self.truncated = truncated

    @property
    def content_type(self) -> str:
        return (self.headers.get("content-type", "") or "").split(";")[0].strip().lower()


async def safe_fetch(
    url: str,
    *,
    max_bytes: int,
    timeout: float,
    headers: Optional[dict] = None,
    truncate: bool = False,
    max_redirects: int = DEFAULT_MAX_REDIRECTS,
) -> SafeFetchResult:
    """SSRF-safe GET with manual, re-validated redirects and a streamed byte cap.

    truncate=True  -> stop reading at max_bytes and flag `truncated` (for text
                      reads where a partial page is fine).
    truncate=False -> raise UnsafeURLError('RESPONSE_TOO_LARGE') once the body
                      exceeds max_bytes (for file downloads).
    """
    request_headers = dict(headers or {})
    pin_map: dict = {}
    transport = _PinnedTransport(pin_map, trust_env=False)
    async with httpx.AsyncClient(
        follow_redirects=False,
        trust_env=False,
        timeout=timeout,
        transport=transport,
    ) as client:
        current = url
        for _ in range(max_redirects + 1):
            ips = await validate_public_url(current)
            # Pin this hop's hostname to the validated IPs so the socket connects
            # to an address we checked, not a possibly-rebound re-resolution.
            # The transport tries them in order (v4 first) with failover.
            host = urlparse(current).hostname
            if host:
                pin_map[host] = _order_ips(ips)
            async with client.stream("GET", current, headers=request_headers) as resp:
                if resp.is_redirect:
                    location = resp.headers.get("location")
                    if not location:
                        raise UnsafeURLError("NAVIGATION_FAILED", "Redirect without a Location header")
                    current = urljoin(current, location)
                    continue

                # Reject early when the declared size already blows the cap.
                declared = resp.headers.get("content-length")
                if declared and declared.isdigit() and int(declared) > max_bytes and not truncate:
                    raise UnsafeURLError(
                        "RESPONSE_TOO_LARGE",
                        f"Response is {int(declared)} bytes; limit is {max_bytes}",
                    )

                chunks = []
                total = 0
                truncated = False
                async for chunk in resp.aiter_bytes():
                    total += len(chunk)
                    if total > max_bytes:
                        if truncate:
                            keep = len(chunk) - (total - max_bytes)
                            chunks.append(chunk[:keep])
                            truncated = True
                            break
                        raise UnsafeURLError(
                            "RESPONSE_TOO_LARGE",
                            f"Response exceeded {max_bytes} bytes",
                        )
                    chunks.append(chunk)

                return SafeFetchResult(
                    content=b"".join(chunks),
                    status_code=resp.status_code,
                    headers=resp.headers,
                    # Use the hostname URL we followed, NOT resp.url — the pinned
                    # transport rewrites the request host to the IP, so resp.url
                    # would report http://<ip>/... and lose the domain.
                    final_url=current,
                    truncated=truncated,
                )

        raise UnsafeURLError("TOO_MANY_REDIRECTS", f"Exceeded {max_redirects} redirects")
