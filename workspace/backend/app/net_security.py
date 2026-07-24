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


async def validate_public_url(url: str) -> None:
    """Raise UnsafeURLError unless `url` is an http(s) URL that resolves only
    to public IP addresses and carries no embedded credentials."""
    parsed = urlparse(url)
    if parsed.scheme not in ALLOWED_SCHEMES:
        raise UnsafeURLError("UNSUPPORTED_SCHEME", "Only http(s) URLs are supported")
    if parsed.username or parsed.password:
        raise UnsafeURLError("URL_CREDENTIALS_NOT_ALLOWED", "URLs with embedded credentials are not allowed")
    host = parsed.hostname
    if not host:
        raise UnsafeURLError("INVALID_URL", "URL has no host")

    # An IP literal is validated directly; a hostname is resolved first.
    try:
        literal = ipaddress.ip_address(host)
        ips = {str(literal)}
    except ValueError:
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        ips = await _resolve_ips(host, port)

    if not ips:
        raise UnsafeURLError("DNS_RESOLUTION_FAILED", f"Host '{host}' did not resolve")
    for ip_str in ips:
        if not _ip_is_public(ipaddress.ip_address(ip_str)):
            raise UnsafeURLError(
                "BLOCKED_PRIVATE_ADDRESS",
                f"Host '{host}' resolves to a non-public address ({ip_str})",
            )


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
    async with httpx.AsyncClient(
        follow_redirects=False,
        trust_env=False,
        timeout=timeout,
    ) as client:
        current = url
        for _ in range(max_redirects + 1):
            await validate_public_url(current)
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
                    final_url=str(resp.url),
                    truncated=truncated,
                )

        raise UnsafeURLError("TOO_MANY_REDIRECTS", f"Exceeded {max_redirects} redirects")
