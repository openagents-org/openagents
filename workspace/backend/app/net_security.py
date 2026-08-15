# -*- coding: utf-8 -*-
"""
SSRF-safe outbound networking for agent-triggered fetches.

Anything that fetches a URL chosen by a workspace agent (POST /v1/fetch,
POST /v1/files/from_url) MUST go through here. A raw httpx.get would let an
agent reach the backend's own network: cloud metadata (169.254.169.254),
localhost, and private/internal services.

Protections:
  - scheme restricted to http/https, destination port restricted to an allowlist
  - URLs with embedded credentials rejected
  - every hostname is resolved and ALL resolved IPs must be public
    (private / loopback / link-local / reserved / multicast are blocked,
    including IPv4-mapped IPv6)
  - the validated IP is PINNED and connected to directly, so the name is
    resolved exactly once — a DNS rebind between validation and connect can't
    swing the destination to an internal address
  - redirects are followed manually and re-validated (and re-pinned) per hop
  - each hop gets its own connection pool, so two hostnames sharing an IP can
    never reuse one another's connection (which would carry the wrong TLS SNI)
  - trust_env=False so backend proxy env vars can't redirect the request
  - streamed with an enforced byte cap so a huge body can't OOM the worker

The browser render path cannot use this module (Chromium does its own
networking); it is constrained by the egress proxy in app.browser_egress,
which enforces the same policy via `resolve_and_validate`.
"""

import asyncio
import ipaddress
import logging
import os
from http.cookiejar import CookieJar
from typing import Optional
from urllib.parse import urljoin, urlparse

import httpx

logger = logging.getLogger(__name__)

ALLOWED_SCHEMES = {"http", "https"}
DEFAULT_MAX_REDIRECTS = 4

# The User-Agent for every agent-triggered outbound fetch. Defined here, next
# to safe_fetch, because both callers (/v1/fetch and /v1/files/from_url) must
# send the same one: a page read and the image download that follows it come
# from the same logical client, and two drifting strings mean a site can serve
# the article but refuse its images.
#
# The platform token is load-bearing, not cosmetic. mp.weixin.qq.com serves a
# "当前环境异常" interstitial instead of the article to non-browser agents, and
# it treats "X11; Linux x86_64" as one of them: measured over four requests
# each from the same IP, the Linux token was blocked 4/4 while the Windows and
# macOS tokens succeeded 4/4. The trailing product token is fine to keep (3/3
# with it), so we stay honest about who is calling.
OUTBOUND_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0.0.0 Safari/537.36 OpenAgentsFetch/1.0"
)


def _parse_port_allowlist() -> frozenset:
    """Destination ports agents may reach. Restricting this stops the fetch
    tools from being used to probe non-HTTP services (SSH, SMTP, Redis, ...)
    on hosts that are technically public."""
    raw = os.environ.get("OUTBOUND_ALLOWED_PORTS", "80,443,8080,8443")
    ports = set()
    for part in raw.split(","):
        part = part.strip()
        if part.isdigit():
            ports.add(int(part))
    return frozenset(ports or {80, 443})


ALLOWED_PORTS = _parse_port_allowlist()


class UnsafeURLError(Exception):
    """A URL was rejected before or during fetching. Carries a stable code."""

    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


def _ip_is_public(ip: ipaddress._BaseAddress) -> bool:
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


async def _resolve_ips(host: str, port: int) -> list:
    """Resolve `host` to a de-duplicated, order-preserving list of IP literals."""
    loop = asyncio.get_event_loop()
    try:
        infos = await loop.getaddrinfo(host, port, proto=0, type=0)
    except OSError as e:
        raise UnsafeURLError("DNS_RESOLUTION_FAILED", f"Could not resolve host '{host}': {e}") from e
    ips = []
    for info in infos:
        ip_str = info[4][0]
        if ip_str not in ips:
            ips.append(ip_str)
    return ips


async def resolve_and_validate(host: str, port: int) -> str:
    """Resolve `host` and return the single IP literal to connect to.

    Every address the name resolves to must be public — a name that returns
    both a public and a private address is rejected outright rather than
    having a "good" address picked out of it, since which one a later
    resolution would pick is not ours to control.

    The returned IP is what callers must actually connect to. Resolving here
    and connecting elsewhere by name would reopen the rebinding window this
    function exists to close.
    """
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None

    if literal is not None:
        if not _ip_is_public(literal):
            logger.warning("Blocked SSRF attempt to non-public literal %s", host)
            raise UnsafeURLError("BLOCKED_PRIVATE_ADDRESS", "Host resolves to a non-public address")
        ips = [str(literal)]
    else:
        # Address policy is checked before port policy so a request aimed at an
        # internal host reports BLOCKED_PRIVATE_ADDRESS — the code worth
        # alerting on — rather than being masked by a port rejection.
        ips = list(await _resolve_ips(host, port))
        if not ips:
            raise UnsafeURLError("DNS_RESOLUTION_FAILED", f"Host '{host}' did not resolve")
        for ip_str in ips:
            if not _ip_is_public(ipaddress.ip_address(ip_str)):
                # The resolved address is deliberately kept out of the
                # caller-facing message: echoing it back turns this endpoint
                # into an internal-DNS mapping oracle for the agent.
                logger.warning("Blocked SSRF attempt: %s resolved to non-public %s", host, ip_str)
                raise UnsafeURLError(
                    "BLOCKED_PRIVATE_ADDRESS",
                    f"Host '{host}' resolves to a non-public address",
                )

    if port not in ALLOWED_PORTS:
        raise UnsafeURLError(
            "BLOCKED_PORT",
            f"Port {port} is not allowed; permitted ports: {sorted(ALLOWED_PORTS)}",
        )
    return ips[0]


def _split_url(url: str) -> tuple:
    """Return (scheme, host, port) after scheme/credential/host checks."""
    parsed = urlparse(url)
    if parsed.scheme not in ALLOWED_SCHEMES:
        raise UnsafeURLError("UNSUPPORTED_SCHEME", "Only http(s) URLs are supported")
    if parsed.username or parsed.password:
        raise UnsafeURLError("URL_CREDENTIALS_NOT_ALLOWED", "URLs with embedded credentials are not allowed")
    host = parsed.hostname
    if not host:
        raise UnsafeURLError("INVALID_URL", "URL has no host")
    try:
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
    except ValueError:
        raise UnsafeURLError("INVALID_URL", "URL has an invalid port")
    return parsed.scheme, host, port


async def validate_public_url(url: str) -> str:
    """Raise UnsafeURLError unless `url` is an http(s) URL on an allowed port
    that resolves only to public addresses and carries no embedded credentials.

    Returns the pinned IP, so a caller that is about to connect can use it
    instead of resolving the name a second time.
    """
    _scheme, host, port = _split_url(url)
    return await resolve_and_validate(host, port)


class _PinnedTransport(httpx.AsyncHTTPTransport):
    """Connects to a pre-validated IP while keeping the request's logical
    identity: the Host header and the TLS SNI / certificate hostname stay the
    original name, so HTTPS still verifies against the domain the caller asked
    for — only the address the socket goes to is fixed.
    """

    def __init__(self, pinned_ip: str, **kwargs):
        super().__init__(**kwargs)
        self._pinned_ip = pinned_ip

    async def handle_async_request(self, request: httpx.Request):
        logical_url = request.url
        original_host = logical_url.host
        original_authority = request.headers.get("host") or logical_url.netloc.decode("ascii")
        # Host header must survive the rewrite or virtual-hosted origins 404.
        request.headers["Host"] = original_authority
        # server_hostname for the TLS handshake: drives both SNI and the
        # certificate hostname check. Without it the cert would be validated
        # against the bare IP and every HTTPS fetch would fail.
        request.extensions = dict(request.extensions or {})
        request.extensions["sni_hostname"] = original_host
        request.url = logical_url.copy_with(host=self._pinned_ip, port=logical_url.port)
        try:
            return await super().handle_async_request(request)
        finally:
            # The rewrite has to be undone before httpx sees the response.
            # Everything above this layer reads identity off the request URL --
            # cookie ownership most of all, which would otherwise be filed
            # under the pinned address and never sent back to the real host.
            request.url = logical_url


class SafeFetchResult:
    __slots__ = ("content", "status_code", "headers", "final_url", "truncated")

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
    """SSRF-safe GET with manual, re-validated, IP-pinned redirects and a
    streamed byte cap.

    truncate=True  -> stop reading at max_bytes and flag `truncated` (text reads).
    truncate=False -> raise UnsafeURLError('RESPONSE_TOO_LARGE') past max_bytes.
    """
    request_headers = dict(headers or {})
    current = url
    # Cookies have to outlive the per-hop clients below: plenty of sites set a
    # session cookie on the redirect and expect it back on the landing page,
    # and httpx keeps its jar on the client. This must be a raw CookieJar --
    # handing httpx a Cookies instance makes it copy the cookies into a fresh
    # jar per client, which would silently drop everything a later hop sets.
    # A CookieJar is adopted by reference, and its domain and path rules still
    # decide what actually gets sent.
    cookie_jar = CookieJar()
    for _ in range(max_redirects + 1):
        pinned_ip = await validate_public_url(current)
        # One client (one connection pool) per hop. Sharing a pool across hops
        # would let a later hop reuse a connection opened for a different
        # hostname that happens to share this IP, carrying the wrong TLS SNI.
        async with httpx.AsyncClient(
            transport=_PinnedTransport(pinned_ip, trust_env=False),
            follow_redirects=False,
            trust_env=False,
            timeout=timeout,
            cookies=cookie_jar,
        ) as client:
            async with client.stream("GET", current, headers=request_headers) as resp:
                if resp.is_redirect:
                    location = resp.headers.get("location")
                    if not location:
                        raise UnsafeURLError("NAVIGATION_FAILED", "Redirect without a Location header")
                    # Resolve the next hop against the logical URL, never the
                    # pinned-IP URL, so relative Locations keep the real host.
                    current = urljoin(current, location)
                    continue

                declared = resp.headers.get("content-length")
                if declared and declared.isdigit() and int(declared) > max_bytes and not truncate:
                    raise UnsafeURLError("RESPONSE_TOO_LARGE", f"Response is {int(declared)} bytes; limit is {max_bytes}")

                chunks = []
                total = 0
                truncated = False
                async for chunk in resp.aiter_bytes():
                    total += len(chunk)
                    if total > max_bytes:
                        if truncate:
                            chunks.append(chunk[: len(chunk) - (total - max_bytes)])
                            truncated = True
                            break
                        raise UnsafeURLError("RESPONSE_TOO_LARGE", f"Response exceeded {max_bytes} bytes")
                    chunks.append(chunk)

                return SafeFetchResult(
                    content=b"".join(chunks),
                    status_code=resp.status_code,
                    headers=resp.headers,
                    final_url=current,
                    truncated=truncated,
                )
    raise UnsafeURLError("TOO_MANY_REDIRECTS", f"Exceeded {max_redirects} redirects")
