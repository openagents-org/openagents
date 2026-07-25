# -*- coding: utf-8 -*-
"""
Server-side URL fetch chain for agents.

POST /v1/fetch — read a web page without holding a shared-browser tab:

  1. Static HTTP GET + text extraction (fast, no browser).
  2. If the page is a JS shell (Notion, Next.js apps, ...), render it in an
     ephemeral browser session (created and closed within this request —
     never counts against the workspace tab quota).
  3. If the rendered page is a login wall / bot challenge, return
     AUTH_REQUIRED so the agent can open a shared browser tab and let a
     human take over.

Errors carry a stable error_code:
  JS_RENDER_TIMEOUT | AUTH_REQUIRED | BOT_CHALLENGE | DNS_OR_TLS_ERROR |
  CONTENT_BLOCKED | NAVIGATION_FAILED | UNSUPPORTED_CONTENT
"""

import logging
import re
from html.parser import HTMLParser
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.browser import (
    BrowserCapacityError,
    BrowserManager,
    BrowserNavigationError,
    RenderDisabledError,
    classify_navigation_error,
)
from app.database import get_db
from app.net_security import UnsafeURLError, safe_fetch, validate_public_url
from app.response import ResponseCode, json_response, success_response
from app.routers.browser import _resolve_bf_key
from app.routers.network import _resolve_workspace, _verify_workspace_access

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["Fetch"])

STATIC_TIMEOUT_SECONDS = 15.0
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
DEFAULT_MAX_CHARS = 20000
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0.0.0 Safari/537.36 OpenAgentsFetch/1.0"
)

# A static fetch that yields less text than this (from a large HTML payload)
# is treated as a JS shell and escalated to browser rendering.
JS_SHELL_MIN_TEXT_CHARS = 200

_JS_SHELL_MARKERS = (
    "enable javascript",
    "requires javascript",
    "javascript is disabled",
    "javascript to run this app",
    "please turn on javascript",
)

_AUTH_MARKERS = (
    "sign in to continue",
    "log in to continue",
    "please sign in",
    "please log in",
    "authentication required",
    "登录后查看",
    "请先登录",
)

_BOT_MARKERS = (
    "verify you are human",
    "checking your browser",
    "cloudflare",
    "are you a robot",
    "unusual traffic",
    "captcha",
    "验证码",
)


class _TextExtractor(HTMLParser):
    """Minimal main-text extraction: strips tags, drops script/style/noscript
    (noscript content is kept separately for JS-shell detection)."""

    _SKIP = {"script", "style", "svg", "template"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.chunks: list[str] = []
        self.noscript_chunks: list[str] = []
        self.title = ""
        self._skip_depth = 0
        self._in_noscript = False
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        if tag in self._SKIP:
            self._skip_depth += 1
        elif tag == "noscript":
            self._in_noscript = True
        elif tag == "title":
            self._in_title = True

    def handle_endtag(self, tag):
        if tag in self._SKIP and self._skip_depth > 0:
            self._skip_depth -= 1
        elif tag == "noscript":
            self._in_noscript = False
        elif tag == "title":
            self._in_title = False

    def handle_data(self, data):
        if self._skip_depth:
            return
        if self._in_title:
            self.title += data
            return
        target = self.noscript_chunks if self._in_noscript else self.chunks
        stripped = data.strip()
        if stripped:
            target.append(stripped)


def _extract_text(html: str) -> dict:
    parser = _TextExtractor()
    try:
        parser.feed(html)
        parser.close()
    except Exception:
        pass
    text = re.sub(r"\n{3,}", "\n\n", "\n".join(parser.chunks))
    return {
        "text": text,
        "noscript": " ".join(parser.noscript_chunks),
        "title": parser.title.strip(),
    }


def _looks_like_js_shell(html: str, extracted: dict) -> bool:
    combined = (extracted["noscript"] + " " + extracted["text"][:2000]).lower()
    if any(marker in combined for marker in _JS_SHELL_MARKERS):
        return True
    return len(html) > 10000 and len(extracted["text"]) < JS_SHELL_MIN_TEXT_CHARS


def _detect_wall(text: str, title: str) -> Optional[str]:
    """Return AUTH_REQUIRED / BOT_CHALLENGE if the page is a wall, else None.

    Markers alone are too false-positive-prone (any page with a login link
    mentions "sign in"), so only classify short pages as walls.
    """
    if len(text) > 1500:
        return None
    sample = (title + " " + text[:1500]).lower()
    if any(marker in sample for marker in _BOT_MARKERS):
        return "BOT_CHALLENGE"
    if any(marker in sample for marker in _AUTH_MARKERS):
        return "AUTH_REQUIRED"
    return None


class FetchRequest(BaseModel):
    url: str
    network: str
    source: Optional[str] = "human:user"
    mode: str = "auto"                 # auto | static | render
    max_chars: int = DEFAULT_MAX_CHARS


def _error(code: ResponseCode, message: str, error_code: str, **extra) -> object:
    return json_response(code, message, data={"error_code": error_code, **extra})


def _success(content: str, source: str, url: str, title: str, max_chars: int) -> object:
    truncated = len(content) > max_chars
    return success_response({
        "url": url,
        "title": title,
        "content": content[:max_chars],
        "truncated": truncated,
        "content_source": source,
    })


def _charset_from_content_type(raw_content_type: str) -> Optional[str]:
    """Pull the charset out of a Content-Type header, if declared."""
    for part in raw_content_type.split(";")[1:]:
        part = part.strip()
        if part.lower().startswith("charset="):
            cs = part.split("=", 1)[1].strip().strip('"\'')
            return cs or None
    return None


def _decode_body(content: bytes, raw_content_type: str, html: str = "") -> str:
    """Decode bytes to text using the declared charset (Content-Type, then an
    HTML <meta charset>), falling back to UTF-8. Fixes mojibake on GBK/GB18030
    (and other non-UTF-8) sites that a hardcoded UTF-8 decode would garble."""
    charset = _charset_from_content_type(raw_content_type)
    if not charset:
        # Sniff a leading <meta charset=...> from the raw bytes (common on
        # Chinese sites that only declare the encoding in the document).
        head = content[:2048].decode("ascii", errors="ignore").lower()
        m = re.search(r'charset=["\']?\s*([a-z0-9_\-]+)', head)
        if m:
            charset = m.group(1)
    for enc in (charset, "utf-8"):
        if not enc:
            continue
        try:
            return content.decode(enc)
        except (LookupError, UnicodeDecodeError):
            continue
    return content.decode("utf-8", errors="replace")


async def _static_fetch(url: str) -> dict:
    """Tier 1: SSRF-safe streamed HTTP GET. Returns {html, final_url,
    status_code} or raises UnsafeURLError / BrowserNavigationError."""
    result = await safe_fetch(
        url,
        max_bytes=MAX_RESPONSE_BYTES,
        timeout=STATIC_TIMEOUT_SECONDS,
        headers={"User-Agent": USER_AGENT, "Accept-Language": "en,zh;q=0.8"},
        truncate=True,  # a partial page is fine for a text read
    )
    content_type = result.content_type
    if content_type and not any(
        t in content_type
        for t in ("text/html", "text/plain", "application/xhtml", "application/xml", "application/json")
    ):
        raise BrowserNavigationError(
            "UNSUPPORTED_CONTENT",
            f"Content-type '{content_type}' is not text; download it via the files API instead",
        )
    raw_ct = result.headers.get("content-type", "") or ""
    return {
        "html": _decode_body(result.content, raw_ct),
        "final_url": result.final_url,
        "status_code": result.status_code,
    }


@router.post("/fetch")
async def fetch_url(
    body: FetchRequest,
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    workspace = _resolve_workspace(db, body.network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    # SSRF guard — reject internal/metadata targets before any outbound call
    # (covers both the static tier and the browser-render tier below).
    try:
        await validate_public_url(body.url)
    except UnsafeURLError as e:
        return _error(ResponseCode.BAD_REQUEST, str(e), e.code)

    max_chars = max(1000, min(body.max_chars, 100000))
    manager = BrowserManager.get()

    # ---- Tier 1: static HTTP ----
    static_result = None
    static_error = None
    if body.mode in ("auto", "static"):
        try:
            static_result = await _static_fetch(body.url)
        except UnsafeURLError as e:
            # A redirect hop pointed at an internal address — never fall back.
            return _error(ResponseCode.BAD_REQUEST, str(e), e.code)
        except BrowserNavigationError as e:
            return _error(ResponseCode.BAD_REQUEST, str(e), e.code)
        except httpx.TimeoutException as e:
            static_error = ("NAV_TIMEOUT", f"Static fetch timed out after {STATIC_TIMEOUT_SECONDS}s: {e}")
        except httpx.HTTPError as e:
            static_error = (classify_navigation_error(e), f"Static fetch failed: {e}")

    if static_result is not None:
        extracted = _extract_text(static_result["html"])
        wall = _detect_wall(extracted["text"], extracted["title"])
        upstream_error = static_result["status_code"] >= 400
        needs_render = (
            upstream_error
            or _looks_like_js_shell(static_result["html"], extracted)
            or wall is not None
        )
        if body.mode == "static" or not needs_render:
            if wall:
                return _error(
                    ResponseCode.BAD_REQUEST,
                    "The page is behind a login wall or bot challenge",
                    wall,
                    hint="Open the URL in the shared browser (workspace_browser_open) and ask a human to complete the login there.",
                )
            # In static mode we don't escalate to a browser, so an upstream
            # 4xx/5xx must be reported as an error, not returned as success.
            if body.mode == "static" and upstream_error:
                return _error(
                    ResponseCode.BAD_REQUEST,
                    f"Upstream returned HTTP {static_result['status_code']}",
                    "UPSTREAM_HTTP_ERROR",
                    status=static_result["status_code"],
                )
            return _success(extracted["text"], "static", static_result["final_url"], extracted["title"], max_chars)
    elif body.mode == "static":
        code, message = static_error
        return _error(ResponseCode.BAD_REQUEST, message, code)

    # ---- Tier 2: ephemeral browser render ----
    bf_key = await _resolve_bf_key(workspace, db)
    try:
        rendered = await manager.render_page_text(body.url, api_key=bf_key)
    except RenderDisabledError as e:
        # Rendering is off (no trusted egress). If static gave usable content,
        # return it; otherwise report RENDER_DISABLED and do NOT steer the agent
        # to the equally-unsafe shared browser.
        if static_result is not None:
            extracted = _extract_text(static_result["html"])
            if extracted["text"]:
                return _success(extracted["text"], "static", static_result["final_url"], extracted["title"], max_chars)
        return _error(ResponseCode.BAD_REQUEST, str(e), "RENDER_DISABLED")
    except BrowserCapacityError as e:
        return _error(ResponseCode.INTERNAL_ERROR, str(e), "RENDER_BUSY", status=503)
    except BrowserNavigationError as e:
        code = "JS_RENDER_TIMEOUT" if e.code == "NAV_TIMEOUT" else e.code
        return _error(ResponseCode.BAD_REQUEST, f"Browser render failed: {e}", code)
    except Exception as e:
        logger.error("Ephemeral render failed for %s: %s", body.url, e)
        # If the static tier had usable content, degrade gracefully to it
        if static_result is not None:
            extracted = _extract_text(static_result["html"])
            if extracted["text"]:
                return _success(extracted["text"], "static", static_result["final_url"], extracted["title"], max_chars)
        if static_error is not None:
            code, message = static_error
            return _error(ResponseCode.BAD_REQUEST, message, code)
        return _error(ResponseCode.INTERNAL_ERROR, "Browser render failed", "NAVIGATION_FAILED")

    # ---- Tier 3: wall detection on the rendered page ----
    wall = _detect_wall(rendered["text"], rendered["title"])
    if wall:
        return _error(
            ResponseCode.BAD_REQUEST,
            "The page is behind a login wall or bot challenge",
            wall,
            hint="Open the URL in the shared browser (workspace_browser_open) and ask a human to complete the login there.",
        )

    return _success(rendered["text"], "browser", rendered["url"], rendered["title"], max_chars)
