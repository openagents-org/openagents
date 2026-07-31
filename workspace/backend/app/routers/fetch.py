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

Errors carry a stable error_code, so the caller can ask for the one action
that would actually help instead of a generic "fetch failed":
  JS_RENDER_TIMEOUT | AUTH_REQUIRED | BOT_CHALLENGE | DNS_OR_TLS_ERROR |
  CONTENT_BLOCKED | NAVIGATION_FAILED | UNSUPPORTED_CONTENT |
  CLIENT_ENV_BLOCKED | SHARE_TOKEN_REQUIRED | CONTENT_UNAVAILABLE |
  IP_OR_REGION_BLOCKED
"""

import logging
import os
import re
import time
from html.parser import HTMLParser
from typing import Optional
from urllib.parse import urljoin, urlparse

import httpx
from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.browser import BrowserManager, BrowserNavigationError, classify_navigation_error
from app.database import get_db
from app.net_security import (
    OUTBOUND_USER_AGENT,
    UnsafeURLError,
    safe_fetch,
    validate_public_url,
)
from app.response import ResponseCode, json_response, success_response
from app.routers.browser import _resolve_bf_key
from app.routers.network import _resolve_workspace, _verify_workspace_access

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["Fetch"])

STATIC_TIMEOUT_SECONDS = 15.0
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
DEFAULT_MAX_CHARS = 20000
USER_AGENT = OUTBOUND_USER_AGENT

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


# --- image asset extraction -------------------------------------------------
#
# Reading a page and downloading its images are two different endpoints, and
# only this one sees the markup. If the read returns text alone, the direct
# image URLs are gone by the time the agent wants them and
# POST /v1/files/from_url — which requires a direct URL — is unreachable in
# practice. So the read has to hand back what it saw.

ASSET_LIMIT = 60

# src is the easy case. The data-* attributes are what lazy-loading pages use
# instead, and mp.weixin.qq.com is one of them: every article image sits in
# data-src with no src at all, so a src-only reader reports zero images for a
# page full of them.
_IMG_URL_ATTRS = ("src", "data-src", "data-original", "data-lazy-src", "data-actualsrc")

_IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".avif", ".ico", ".svg")

# Checked before anything else. The host-shape arm below would otherwise
# accept a bundle off a CDN named "fe-static" as an image purely because its
# key was "url" — a real hit on xiaohongshu's note pages.
_NON_IMAGE_EXTENSIONS = (
    ".js", ".mjs", ".css", ".json", ".xml", ".txt", ".map",
    ".woff", ".woff2", ".ttf", ".otf", ".eot",
    ".mp4", ".webm", ".m3u8", ".ts", ".mp3", ".m4a", ".wav",
    ".pdf", ".zip", ".gz", ".html", ".htm",
)

_MIME_BY_EXTENSION = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
    ".avif": "image/avif", ".ico": "image/x-icon", ".svg": "image/svg+xml",
}

# Some sites build the gallery from an embedded JSON blob and never emit an
# <img> for it — xiaohongshu keeps its note images under
# imageList[].urlDefault, inside a <script> the text reader deliberately
# drops. Those URLs carry no file extension either, so this matches on the
# key name and falls back to a host-shape check below.
# The body alternation has to accept the escape sequences themselves: these
# blobs write every path separator as /, so a char class that merely
# excludes backslash stops at the first separator and matches nothing useful.
_ESCAPED_SLASH = r"(?:\\u002[fF]|\\/|/)"
_JSON_URL_RE = re.compile(
    r'"([A-Za-z0-9_]{2,40})"\s*:\s*"'
    r"((?:https?:)?" + _ESCAPED_SLASH + r"{2}"
    r"(?:[^\"\\\s]|" + _ESCAPED_SLASH + r"){8,600})\""
)
_IMAGE_KEY_RE = re.compile(r"image|img|pic|photo|cover|thumb|avatar|poster", re.IGNORECASE)
_URLISH_KEY_RE = re.compile(r"^url|url$", re.IGNORECASE)
_IMAGE_HOST_RE = re.compile(r"img|pic|image|photo|webpic|media|static|cdn", re.IGNORECASE)


def _unescape_json_url(raw: str) -> str:
    return raw.replace("\\u002F", "/").replace("\\u002f", "/").replace("\\/", "/")


def _guess_mime(url: str) -> Optional[str]:
    path = urlparse(url).path.lower()
    for ext, mime in _MIME_BY_EXTENSION.items():
        if path.endswith(ext):
            return mime
    return None


def _json_url_is_image(url: str, key: str) -> bool:
    """Decide whether a URL lifted out of an embedded JSON blob is an image.

    Only applies to the JSON sweep. Anything found in an <img> tag is an image
    by construction and must not be filtered — CDN image URLs routinely have
    no file extension (mp.weixin.qq.com ends its paths in /640, xiaohongshu in
    !nd_dft), so an extension test would drop exactly the ones that matter.
    """
    path = urlparse(url).path.lower()
    if path.endswith(_NON_IMAGE_EXTENSIONS):
        return False
    if path.endswith(_IMAGE_EXTENSIONS):
        return True
    if _IMAGE_KEY_RE.search(key):
        return True
    # A bare "url" key is far too common to trust on its own; require the host
    # to look like an image CDN before believing it.
    return bool(_URLISH_KEY_RE.search(key) and _IMAGE_HOST_RE.search(urlparse(url).netloc))


class _TextExtractor(HTMLParser):
    """Minimal main-text extraction: strips tags, drops script/style/noscript
    (noscript content is kept separately for JS-shell detection). Image URLs
    are collected on the way past, since nothing downstream sees the markup."""

    _SKIP = {"script", "style", "svg", "template"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.chunks: list[str] = []
        self.noscript_chunks: list[str] = []
        self.images: list[dict] = []
        self.title = ""
        self.og_title = ""
        self._skip_depth = 0
        self._in_noscript = False
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        if tag == "img":
            self._collect_image(dict(attrs))
        elif tag == "meta":
            self._collect_meta(dict(attrs))
        if tag in self._SKIP:
            self._skip_depth += 1
        elif tag == "noscript":
            self._in_noscript = True
        elif tag == "title":
            self._in_title = True

    def _collect_meta(self, attrs: dict):
        prop = (attrs.get("property") or attrs.get("name") or "").lower()
        content = (attrs.get("content") or "").strip()
        if not content:
            return
        if prop == "og:title" and not self.og_title:
            # mp.weixin.qq.com ships an empty <title> and puts the real one
            # here, so without this every article comes back untitled.
            self.og_title = content
        elif prop in ("og:image", "twitter:image"):
            self.images.append({"url": content, "alt": ""})

    def _collect_image(self, attrs: dict):
        url = next((attrs[a] for a in _IMG_URL_ATTRS if attrs.get(a)), None)
        if not url and attrs.get("srcset"):
            # "url 1x, url 2x" — the first candidate is enough to identify it.
            url = attrs["srcset"].split(",")[0].strip().split(" ")[0]
        if url:
            self.images.append({"url": url.strip(), "alt": (attrs.get("alt") or "").strip()[:200]})

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


def _collect_assets(html: str, tag_images: list[dict], base_url: str) -> list[dict]:
    """Merge <img>-derived and JSON-derived image URLs into one deduped list.

    Markup first, since those carry alt text and are the images actually laid
    out on the page; the JSON sweep then adds galleries that never reached the
    DOM. Relative URLs are resolved against the final URL so what comes back
    is always directly fetchable.
    """
    candidates: list[tuple[str, str, Optional[str]]] = [
        (img["url"], img.get("alt", ""), None) for img in tag_images
    ]
    if len(candidates) < ASSET_LIMIT:
        for key, raw in _JSON_URL_RE.findall(html):
            candidates.append((_unescape_json_url(raw), "", key))

    assets: list[dict] = []
    seen: set[str] = set()
    for raw_url, alt, key in candidates:
        if len(assets) >= ASSET_LIMIT:
            break
        if raw_url.startswith("data:"):
            continue  # already inline; nothing to download
        url = urljoin(base_url, raw_url) if not raw_url.startswith("//") else "https:" + raw_url
        if urlparse(url).scheme not in ("http", "https"):
            continue
        # key is None for markup-derived URLs, which need no further proof.
        if key is not None and not _json_url_is_image(url, key):
            continue
        if url in seen:
            continue
        seen.add(url)
        assets.append({
            "url": url,
            "type": "image",
            "mime": _guess_mime(url),
            "alt": alt,
            "source": "html" if key is None else "embedded_json",
        })
    return assets


def _normalize_rendered_assets(images: Optional[list], base_url: str) -> list[dict]:
    """Shape the rendered page's image list like the static tier's assets.

    The browser reports what the DOM actually resolved, so these are already
    absolute and already images — no markup heuristics needed. Anything
    malformed is dropped rather than trusted, since it crosses a process
    boundary (Browser Fabric or Chromium) before arriving here.
    """
    assets: list[dict] = []
    seen: set[str] = set()
    for entry in images or []:
        if not isinstance(entry, dict):
            continue
        raw = (entry.get("url") or "").strip()
        if not raw or raw.startswith("data:"):
            continue
        url = urljoin(base_url, raw)
        if urlparse(url).scheme not in ("http", "https") or url in seen:
            continue
        seen.add(url)
        assets.append({
            "url": url,
            "type": "image",
            "mime": _guess_mime(url),
            "alt": str(entry.get("alt") or "")[:200],
            "source": "browser",
        })
        if len(assets) >= ASSET_LIMIT:
            break
    return assets


def _extract_text(html: str, base_url: str = "") -> dict:
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
        "title": parser.title.strip() or parser.og_title.strip(),
        "assets": _collect_assets(html, parser.images, base_url),
    }


def _looks_like_js_shell(html: str, extracted: dict) -> bool:
    combined = (extracted["noscript"] + " " + extracted["text"][:2000]).lower()
    if any(marker in combined for marker in _JS_SHELL_MARKERS):
        return True
    return len(html) > 10000 and len(extracted["text"]) < JS_SHELL_MIN_TEXT_CHARS


# One line per code, so the caller can tell the user what happened without
# reading the hint, and so "login wall or bot challenge" stops being the
# message for refusals that are neither.
_WALL_MESSAGES = {
    "AUTH_REQUIRED": "The page is behind a login wall",
    "BOT_CHALLENGE": "The page is behind a bot challenge",
    "CLIENT_ENV_BLOCKED": "The site rejected this client and served a verification page",
    "SHARE_TOKEN_REQUIRED": "The page needs the share token that comes with the app link",
    "CONTENT_UNAVAILABLE": "The content is deleted, private, or no longer public",
    "IP_OR_REGION_BLOCKED": "The site refused this request at the network level",
}

_GENERIC_BOT_HINT = (
    "Open the URL in the shared browser (workspace_browser_open) and ask a human "
    "to complete the challenge there."
)
_GENERIC_AUTH_HINT = (
    "Open the URL in the shared browser (workspace_browser_open) and ask a human "
    "to sign in there."
)


def _host_matches(host: str, domains: tuple) -> bool:
    return any(host == d or host.endswith("." + d) for d in domains)


def _detect_platform_wall(host: str, sample: str, url: str) -> Optional[tuple]:
    """Classify refusals whose wording only means something on one platform.

    Kept off the generic marker lists on purpose. Those are substring-matched
    against every page we read, so a phrase added here for one site would be
    free to misclassify another site's perfectly good article.
    """
    if _host_matches(host, ("weixin.qq.com",)) and any(
        m in sample for m in ("当前环境异常", "请在微信客户端打开")
    ):
        # Nothing a user can do: WeChat decided the caller isn't a browser.
        return ("CLIENT_ENV_BLOCKED", (
            "WeChat served an environment check instead of the article. This is an "
            "outbound-client problem, not a user action — check that "
            "OUTBOUND_USER_AGENT still presents a desktop browser."
        ))

    if _host_matches(host, ("xiaohongshu.com", "xhslink.com")) and "你访问的页面不见了" in sample:
        # Same page for "you didn't bring a share token" and "this note is
        # gone", so the URL decides which. Asking a user to re-share a link
        # that already had a token would just fail again.
        if "xsec_token=" in url:
            return ("CONTENT_UNAVAILABLE", (
                "The note is deleted or private. The link already carried a share "
                "token, so this is not a missing-parameter problem — do not ask the "
                "user to send it again."
            ))
        return ("SHARE_TOKEN_REQUIRED", (
            "Xiaohongshu only serves a note to a link carrying xsec_token. Ask the "
            "user for the full link shared from the app, not a trimmed "
            "/explore/<id> URL."
        ))

    if _host_matches(host, ("zhihu.com",)) and any(
        m in sample for m in ("请求存在异常", "安全验证")
    ):
        return ("IP_OR_REGION_BLOCKED", (
            "Zhihu refused this request at the network level, which signing in does "
            "not by itself fix. Do not prompt the user to log in until an egress "
            "path has been verified."
        ))

    return None


def _detect_wall(text: str, title: str, url: str = "") -> Optional[tuple]:
    """Return (error_code, hint) if the page is a refusal rather than content.

    Markers alone are too false-positive-prone (any page with a login link
    mentions "sign in"), so only classify short pages as walls.
    """
    if len(text) > 1500:
        return None
    sample = title + " " + text[:1500]
    platform = _detect_platform_wall(urlparse(url).netloc.lower(), sample, url)
    if platform:
        return platform
    lowered = sample.lower()
    if any(marker in lowered for marker in _BOT_MARKERS):
        return ("BOT_CHALLENGE", _GENERIC_BOT_HINT)
    if any(marker in lowered for marker in _AUTH_MARKERS):
        return ("AUTH_REQUIRED", _GENERIC_AUTH_HINT)
    return None


class FetchRequest(BaseModel):
    url: str
    network: str
    source: Optional[str] = "human:user"
    mode: str = "auto"                 # auto | static | render
    max_chars: int = DEFAULT_MAX_CHARS


# Per-workspace throttle. Without one, an agent loop turns this endpoint into
# an unmetered outbound proxy running from the deployment's IP — useful for
# scanning or for amplifying traffic at a third party.
#
# The counter is per process, so with N uvicorn workers the effective ceiling
# is N x this value. That is deliberate: a shared counter would need Redis,
# and a loose in-process cap already removes the unbounded case.
FETCH_RATE_LIMIT_PER_MINUTE = int(os.environ.get("FETCH_RATE_LIMIT_PER_MINUTE", "60"))
_RATE_WINDOW_SECONDS = 60.0
_fetch_hits: dict = {}   # workspace_id -> list[timestamp]


def _rate_limited(workspace_id: str) -> bool:
    now = time.monotonic()
    cutoff = now - _RATE_WINDOW_SECONDS
    hits = [t for t in _fetch_hits.get(workspace_id, []) if t > cutoff]
    if len(hits) >= FETCH_RATE_LIMIT_PER_MINUTE:
        _fetch_hits[workspace_id] = hits
        return True
    hits.append(now)
    _fetch_hits[workspace_id] = hits
    if len(_fetch_hits) > 1000:  # bound the dict on a busy multi-tenant host
        for key in [k for k, v in _fetch_hits.items() if not any(t > cutoff for t in v)]:
            _fetch_hits.pop(key, None)
    return False


def _error(code: ResponseCode, message: str, error_code: str, **extra) -> object:
    return json_response(code, message, data={"error_code": error_code, **extra})


def _success(content: str, source: str, url: str, title: str, max_chars: int,
             assets: Optional[list] = None) -> object:
    truncated = len(content) > max_chars
    return success_response({
        "url": url,
        "title": title,
        "content": content[:max_chars],
        "truncated": truncated,
        "content_source": source,
        # Direct, already-absolute image URLs seen on the page. This is the
        # only place they exist: the text above has no markup left, and
        # POST /v1/files/from_url needs a direct URL to save one.
        "assets": assets or [],
    })


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
    return {
        "html": result.content.decode("utf-8", errors="replace"),
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

    if _rate_limited(str(workspace.id)):
        return _error(
            ResponseCode.BAD_REQUEST,
            f"Fetch rate limit reached ({FETCH_RATE_LIMIT_PER_MINUTE}/min for this workspace)",
            "FETCH_RATE_LIMITED",
            hint="Wait a moment before fetching again.",
        )

    # SSRF guard — reject internal/metadata targets before any outbound call.
    # This is the entry check only; the static tier re-validates and pins every
    # redirect hop, and the browser tier is bounded by the egress proxy.
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
        extracted = _extract_text(static_result["html"], static_result["final_url"])
        wall = _detect_wall(extracted["text"], extracted["title"], static_result["final_url"])
        upstream_error = static_result["status_code"] >= 400
        needs_render = (
            upstream_error
            or _looks_like_js_shell(static_result["html"], extracted)
            or wall is not None
        )
        if body.mode == "static" or not needs_render:
            if wall:
                code, hint = wall
                return _error(ResponseCode.BAD_REQUEST, _WALL_MESSAGES[code], code, hint=hint)
            # In static mode we don't escalate to a browser, so an upstream
            # 4xx/5xx must be reported as an error, not returned as success.
            if body.mode == "static" and upstream_error:
                return _error(
                    ResponseCode.BAD_REQUEST,
                    f"Upstream returned HTTP {static_result['status_code']}",
                    "UPSTREAM_HTTP_ERROR",
                    status=static_result["status_code"],
                )
            return _success(extracted["text"], "static", static_result["final_url"],
                            extracted["title"], max_chars, extracted["assets"])
    elif body.mode == "static":
        code, message = static_error
        return _error(ResponseCode.BAD_REQUEST, message, code)

    # ---- Tier 2: ephemeral browser render ----
    #
    # The entry URL was validated above, but that constrains only the first
    # request. Where the page goes next is constrained by the egress proxy the
    # local browser is launched behind (app.browser_egress). In Browser Fabric
    # mode the page runs on BF's infrastructure and this process cannot
    # intercept its navigation, so the render tier there is only as confined
    # as BF's own egress policy.
    bf_key = await _resolve_bf_key(workspace, db)
    try:
        rendered = await manager.render_page_text(body.url, api_key=bf_key)
    except UnsafeURLError as e:
        return _error(ResponseCode.BAD_REQUEST, str(e), e.code)
    except BrowserNavigationError as e:
        code = "JS_RENDER_TIMEOUT" if e.code == "NAV_TIMEOUT" else e.code
        return _error(ResponseCode.BAD_REQUEST, f"Browser render failed: {e}", code)
    except Exception as e:
        logger.error("Ephemeral render failed for %s: %s", body.url, e)
        # If the static tier had usable content, degrade gracefully to it
        if static_result is not None:
            extracted = _extract_text(static_result["html"], static_result["final_url"])
            if extracted["text"]:
                return _success(extracted["text"], "static", static_result["final_url"],
                                extracted["title"], max_chars, extracted["assets"])
        if static_error is not None:
            code, message = static_error
            return _error(ResponseCode.BAD_REQUEST, message, code)
        return _error(ResponseCode.INTERNAL_ERROR, "Browser render failed", "NAVIGATION_FAILED")

    # ---- Tier 3: wall detection on the rendered page ----
    wall = _detect_wall(rendered["text"], rendered["title"], rendered["url"])
    if wall:
        code, hint = wall
        return _error(ResponseCode.BAD_REQUEST, _WALL_MESSAGES[code], code, hint=hint)

    return _success(rendered["text"], "browser", rendered["url"], rendered["title"], max_chars,
                    _normalize_rendered_assets(rendered.get("images"), rendered["url"]))
