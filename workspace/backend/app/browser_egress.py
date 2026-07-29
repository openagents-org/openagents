# -*- coding: utf-8 -*-
"""
Egress policy proxy for the local (Playwright) browser.

Validating the URL a browser is *told* to open constrains nothing about where
it goes next: a 302, a meta-refresh, a JS navigation, an XHR, an iframe, an
image, or a WebSocket can all reach an internal address without any top-level
navigation happening. Intercepting inside the page (Playwright routing) means
enumerating every one of those mechanisms, still leaves service workers and
WebSockets needing their own handling, and cannot close the gap between the
interceptor's DNS lookup and Chromium's own.

So the boundary is put below the browser instead. Chromium is launched with
`--proxy-server` pointing here, which turns every request it makes — of every
kind — into one chokepoint, and stops it from resolving DNS at all: the name
arrives here in the request line or CONNECT target, this proxy resolves it
exactly once via `resolve_and_validate`, and connects to that pinned address.

Deny is the default: anything this proxy cannot parse, resolve, or prove
public gets a 403 and no connection is made.

One gotcha this depends on: Chromium bypasses the proxy for loopback targets
unless it is launched with `--proxy-bypass-list=<-loopback>`. Without that
flag `http://127.0.0.1:...` goes direct and never reaches this code, which
would leave the backend's own API reachable. `chromium_proxy_args()` below is
the only supported way to build the flags, so the two can't drift apart.
"""

import asyncio
import logging
from typing import Optional

from app.net_security import UnsafeURLError, resolve_and_validate

logger = logging.getLogger(__name__)

_MAX_HEADER_BYTES = 64 * 1024
_HEADER_TIMEOUT_SECONDS = 15.0
_CONNECT_TIMEOUT_SECONDS = 15.0
# An upstream that never closes must not be able to hold a relay task open
# indefinitely; the plain-HTTP path is bounded even when framing is absent.
_EXCHANGE_TIMEOUT_SECONDS = 120.0

# A denial is an ordinary 403, and page.goto() does not raise on HTTP error
# status — so without a marker the browser would simply render the refusal
# text and the caller would report it as a successful page load. This header
# is what lets BrowserManager tell "we refused this" apart from "the site
# returned 403".
DENY_MARKER_HEADER = "x-workspace-egress-blocked"

_DENY_TEXT = b"Blocked by workspace egress policy: destination is not public"
_DENY_BODY = (
    b"HTTP/1.1 403 Forbidden\r\n"
    b"Content-Type: text/plain; charset=utf-8\r\n"
    b"X-Workspace-Egress-Blocked: 1\r\n"
    b"Content-Length: " + str(len(_DENY_TEXT)).encode() + b"\r\n"
    b"Connection: close\r\n"
    b"\r\n" + _DENY_TEXT
)


def _bad_gateway(reason: str) -> bytes:
    body = f"Egress proxy could not reach the destination: {reason}".encode("utf-8")
    return (
        b"HTTP/1.1 502 Bad Gateway\r\n"
        b"Content-Type: text/plain; charset=utf-8\r\n"
        b"Content-Length: " + str(len(body)).encode() + b"\r\n"
        b"Connection: close\r\n"
        b"\r\n" + body
    )


def _split_host_port(authority: str, default_port: int) -> tuple:
    """Split 'host:port' / '[v6]:port' / 'host' into (host, port)."""
    authority = authority.strip()
    if authority.startswith("["):
        close = authority.find("]")
        if close == -1:
            raise ValueError("malformed IPv6 authority")
        host = authority[1:close]
        rest = authority[close + 1:]
        port = int(rest[1:]) if rest.startswith(":") and rest[1:].isdigit() else default_port
        return host, port
    if ":" in authority:
        host, _, port_str = authority.rpartition(":")
        if port_str.isdigit():
            return host, int(port_str)
        raise ValueError("malformed port")
    return authority, default_port


def _target_from_absolute_url(target: str) -> tuple:
    """Parse the absolute-form request target proxies receive for plain HTTP
    ('GET http://host/path HTTP/1.1') into (host, port, path)."""
    if "://" not in target:
        raise ValueError("expected absolute-form request target")
    scheme, _, rest = target.partition("://")
    if scheme.lower() not in ("http", "https"):
        raise ValueError(f"unsupported scheme '{scheme}'")
    authority, slash, path = rest.partition("/")
    default_port = 443 if scheme.lower() == "https" else 80
    host, port = _split_host_port(authority, default_port)
    return host, port, (("/" + path) if slash else "/")


# Connection-management headers. These are meaningful only between two
# adjacent HTTP peers and must not be relayed. Transfer-Encoding is
# deliberately NOT in this set: the body framing it describes is relayed
# verbatim, so dropping the header would leave the receiver unable to parse
# what it is being sent.
#
# Upgrade is stripped on purpose. A 101 response would turn this path back
# into an unframed tunnel, which is exactly what must not happen here.
# Chromium tunnels ws:// through CONNECT anyway, so nothing legitimate needs
# an in-band upgrade.
_CONNECTION_HEADERS = {
    b"connection", b"proxy-connection", b"proxy-authorization", b"proxy-authenticate",
    b"keep-alive", b"te", b"trailer", b"upgrade",
}


def _parse_headers(header_block: bytes) -> dict:
    """Parse a raw header block into {lowercased name: value}, both bytes."""
    parsed = {}
    for line in header_block.split(b"\r\n"):
        if not line or b":" not in line:
            continue
        name, _, value = line.partition(b":")
        parsed[name.strip().lower()] = value.strip()
    return parsed


def _rewrite_headers(header_block: bytes) -> bytes:
    """Strip connection-management headers and pin the connection closed.

    Every request must be individually validated, which means this proxy can
    never let a second request ride a connection it has already spliced to an
    upstream. Closing after one exchange, in both directions, is what makes
    that structurally true rather than a property of the upstream's manners.
    """
    kept = [
        line for line in header_block.split(b"\r\n")
        if line and line.split(b":", 1)[0].strip().lower() not in _CONNECTION_HEADERS
    ]
    kept.append(b"Connection: close")
    return b"\r\n".join(kept) + b"\r\n"


async def _relay_exact(src: asyncio.StreamReader, dst: asyncio.StreamWriter, count: int) -> None:
    remaining = count
    while remaining > 0:
        chunk = await src.read(min(65536, remaining))
        if not chunk:
            return
        dst.write(chunk)
        await dst.drain()
        remaining -= len(chunk)


async def _relay_chunked(src: asyncio.StreamReader, dst: asyncio.StreamWriter) -> None:
    """Relay a chunked body, stopping at the terminal chunk rather than at EOF."""
    while True:
        size_line = await src.readline()
        if not size_line:
            return
        dst.write(size_line)
        await dst.drain()
        try:
            size = int(size_line.split(b";")[0].strip(), 16)
        except ValueError:
            return
        if size == 0:
            while True:  # trailers, terminated by a blank line
                trailer = await src.readline()
                if not trailer:
                    return
                dst.write(trailer)
                await dst.drain()
                if trailer in (b"\r\n", b"\n"):
                    return
        await _relay_exact(src, dst, size)
        dst.write(await src.read(2))  # chunk terminator
        await dst.drain()


async def _relay_until_eof(src: asyncio.StreamReader, dst: asyncio.StreamWriter) -> None:
    while True:
        data = await src.read(65536)
        if not data:
            return
        dst.write(data)
        await dst.drain()


async def _relay_body(src, dst, headers: dict, *, read_to_eof_if_unframed: bool) -> None:
    """Relay exactly one message body, using the framing its headers declare."""
    if b"chunked" in headers.get(b"transfer-encoding", b"").lower():
        await _relay_chunked(src, dst)
    elif b"content-length" in headers:
        try:
            length = int(headers[b"content-length"])
        except ValueError:
            return
        await _relay_exact(src, dst, length)
    elif read_to_eof_if_unframed:
        await _relay_until_eof(src, dst)


async def _pipe(src: asyncio.StreamReader, dst: asyncio.StreamWriter) -> None:
    try:
        while True:
            data = await src.read(65536)
            if not data:
                break
            dst.write(data)
            await dst.drain()
    except (ConnectionError, asyncio.CancelledError, OSError):
        pass
    finally:
        try:
            dst.close()
        except Exception:
            pass


class EgressPolicyProxy:
    """A loopback HTTP/HTTPS proxy that only forwards to public addresses."""

    def __init__(self):
        self._server: Optional[asyncio.AbstractServer] = None
        self._port: Optional[int] = None
        self.blocked_count = 0
        self.allowed_count = 0

    @property
    def port(self) -> Optional[int]:
        return self._port

    async def start(self) -> int:
        if self._server is not None:
            return self._port
        # Bind to an ephemeral port on loopback only: each uvicorn worker runs
        # its own proxy for its own browser, and nothing off-box can use it.
        self._server = await asyncio.start_server(self._handle, "127.0.0.1", 0)
        self._port = self._server.sockets[0].getsockname()[1]
        logger.info("Browser egress policy proxy listening on 127.0.0.1:%d", self._port)
        return self._port

    async def stop(self) -> None:
        if self._server is None:
            return
        self._server.close()
        try:
            await self._server.wait_closed()
        except Exception:
            pass
        self._server = None
        self._port = None

    def chromium_args(self) -> list:
        """Launch flags that route this browser's traffic through the proxy.

        `<-loopback>` removes loopback from Chromium's implicit bypass list.
        Without it, 127.0.0.1 and localhost are fetched directly and never
        reach the policy check.
        """
        if self._port is None:
            return []
        return [
            f"--proxy-server=http://127.0.0.1:{self._port}",
            "--proxy-bypass-list=<-loopback>",
        ]

    # ------------------------------------------------------------------

    async def _deny(self, writer: asyncio.StreamWriter, host: str, port: int, reason: str) -> None:
        self.blocked_count += 1
        logger.warning("Egress policy blocked browser request to %s:%s (%s)", host, port, reason)
        try:
            writer.write(_DENY_BODY)
            await writer.drain()
        except (ConnectionError, OSError):
            pass
        writer.close()

    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            await self._handle_inner(reader, writer)
        except Exception:
            logger.exception("Egress proxy connection failed")
            try:
                writer.close()
            except Exception:
                pass

    async def _handle_inner(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            request_line = await asyncio.wait_for(
                reader.readline(), timeout=_HEADER_TIMEOUT_SECONDS
            )
        except (asyncio.TimeoutError, ConnectionError):
            writer.close()
            return
        if not request_line:
            writer.close()
            return

        parts = request_line.decode("latin-1").strip().split(" ")
        if len(parts) < 3:
            await self._deny(writer, "?", 0, "malformed request line")
            return
        method, target = parts[0].upper(), parts[1]

        header_block = bytearray()
        while True:
            try:
                line = await asyncio.wait_for(reader.readline(), timeout=_HEADER_TIMEOUT_SECONDS)
            except (asyncio.TimeoutError, ConnectionError):
                writer.close()
                return
            if not line or line in (b"\r\n", b"\n"):
                break
            header_block += line
            if len(header_block) > _MAX_HEADER_BYTES:
                await self._deny(writer, "?", 0, "header block too large")
                return

        if method == "CONNECT":
            # HTTPS and WebSocket-over-TLS. Policy is enforced on the tunnel
            # target and the bytes are then relayed untouched, so the browser's
            # own certificate verification is unaffected — no MITM here.
            try:
                host, port = _split_host_port(target, 443)
            except ValueError as e:
                await self._deny(writer, target, 0, str(e))
                return
            await self._tunnel(reader, writer, host, port)
            return

        try:
            host, port, path = _target_from_absolute_url(target)
        except ValueError as e:
            await self._deny(writer, target, 0, str(e))
            return
        await self._forward(reader, writer, method, host, port, path, bytes(header_block))

    async def _pin(self, writer: asyncio.StreamWriter, host: str, port: int) -> Optional[str]:
        """Return the pinned public IP, or None after writing a denial."""
        try:
            return await resolve_and_validate(host, port)
        except UnsafeURLError as e:
            await self._deny(writer, host, port, e.code)
            return None
        except Exception as e:  # fail closed on anything unexpected
            await self._deny(writer, host, port, f"policy error: {type(e).__name__}")
            return None

    async def _tunnel(self, reader, writer, host: str, port: int) -> None:
        pinned = await self._pin(writer, host, port)
        if pinned is None:
            return
        try:
            up_reader, up_writer = await asyncio.wait_for(
                asyncio.open_connection(pinned, port), timeout=_CONNECT_TIMEOUT_SECONDS
            )
        except (OSError, asyncio.TimeoutError) as e:
            writer.write(_bad_gateway(type(e).__name__))
            await writer.drain()
            writer.close()
            return

        self.allowed_count += 1
        writer.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
        await writer.drain()
        await asyncio.gather(
            _pipe(reader, up_writer), _pipe(up_reader, writer), return_exceptions=True
        )

    async def _forward(self, reader, writer, method: str, host: str, port: int,
                       path: str, header_block: bytes) -> None:
        pinned = await self._pin(writer, host, port)
        if pinned is None:
            return
        try:
            up_reader, up_writer = await asyncio.wait_for(
                asyncio.open_connection(pinned, port), timeout=_CONNECT_TIMEOUT_SECONDS
            )
        except (OSError, asyncio.TimeoutError) as e:
            writer.write(_bad_gateway(type(e).__name__))
            await writer.drain()
            writer.close()
            return

        self.allowed_count += 1
        try:
            await asyncio.wait_for(
                self._exchange(reader, writer, up_reader, up_writer, method, path, header_block),
                timeout=_EXCHANGE_TIMEOUT_SECONDS,
            )
        except (asyncio.TimeoutError, ConnectionError, OSError):
            pass
        finally:
            for w in (up_writer, writer):
                try:
                    w.close()
                except Exception:
                    pass

    async def _exchange(self, reader, writer, up_reader, up_writer,
                        method: str, path: str, header_block: bytes) -> None:
        """Relay exactly one request and one response, then let the caller close.

        Nothing is read from the browser after this request's body. A second
        request arriving on this connection is therefore never forwarded
        anywhere — it cannot reach the upstream this socket is already spliced
        to, which is what would let it skip the destination check entirely.
        """
        request_headers = _parse_headers(header_block)
        # Re-emit in origin form. The client's Host header is preserved so
        # virtual-hosted origins still resolve correctly; only the request
        # target is rewritten and connection headers are replaced.
        up_writer.write(f"{method} {path} HTTP/1.1\r\n".encode("latin-1"))
        up_writer.write(_rewrite_headers(header_block))
        up_writer.write(b"\r\n")
        await up_writer.drain()
        await _relay_body(reader, up_writer, request_headers, read_to_eof_if_unframed=False)

        status_line = await up_reader.readline()
        if not status_line:
            return
        raw_headers = bytearray()
        while True:
            line = await up_reader.readline()
            if not line or line in (b"\r\n", b"\n"):
                break
            raw_headers += line
            if len(raw_headers) > _MAX_HEADER_BYTES:
                return
        response_headers = _parse_headers(bytes(raw_headers))

        writer.write(status_line)
        writer.write(_rewrite_headers(bytes(raw_headers)))
        writer.write(b"\r\n")
        await writer.drain()

        try:
            status = int(status_line.split(b" ")[1])
        except (IndexError, ValueError):
            status = 0
        # A body is absent by definition for these, regardless of headers.
        if method == "HEAD" or status in (204, 304) or 100 <= status < 200:
            return
        await _relay_body(up_reader, writer, response_headers, read_to_eof_if_unframed=True)
