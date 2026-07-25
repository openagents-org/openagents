# -*- coding: utf-8 -*-
"""
Shared browser manager — Browser Fabric (cloud) or local Playwright.

When BROWSERFABRIC_API_KEY is set, all browser operations are proxied to
the Browser Fabric REST API.  No local Playwright/Chromium is needed.
Otherwise, a local Chromium instance is launched (dev/testing only).
"""

import asyncio
import base64
import logging
import os
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

MAX_BROWSER_TABS = int(os.environ.get("MAX_BROWSER_TABS", "20"))

BROWSERFABRIC_API_KEY = os.environ.get("BROWSERFABRIC_API_KEY", "")
BROWSERFABRIC_URL = os.environ.get("BROWSERFABRIC_URL", "https://api.browserfabric.com")
BROWSERFABRIC_PROVISION_SECRET = os.environ.get("BROWSERFABRIC_PROVISION_SECRET", "")

CLOSE_SESSION_RETRIES = 3

# render_page_text: how long to let a JS page settle before snapshotting, and
# how many times to retry while it still looks like an empty shell.
RENDER_SETTLE_SECONDS = float(os.environ.get("RENDER_SETTLE_SECONDS", "1.5"))
RENDER_SETTLE_ATTEMPTS = int(os.environ.get("RENDER_SETTLE_ATTEMPTS", "3"))
RENDER_MIN_TEXT_CHARS = int(os.environ.get("RENDER_MIN_TEXT_CHARS", "50"))

# Per-worker cap on concurrent ephemeral render sessions, so a burst of fetches
# can't exhaust BrowserFabric concurrency / cost on this worker. NOTE: this is
# per-process only; cross-worker metering needs a shared store (see deployment
# notes) — kept out of Redis per project convention.
RENDER_MAX_CONCURRENCY = int(os.environ.get("RENDER_MAX_CONCURRENCY", "4"))
RENDER_ACQUIRE_TIMEOUT_SECONDS = float(os.environ.get("RENDER_ACQUIRE_TIMEOUT_SECONDS", "20"))

# SSRF safety gates. Browser navigation (render + shared tabs) can be pointed at
# arbitrary agent/user URLs; application-layer guards can't fully stop DNS
# rebinding or cover every sub-resource, so browsing is DISABLED by default and
# only enabled when the operator confirms network-layer isolation. The two
# execution surfaces have different networks, so they have separate gates:
#   - local Playwright runs on THIS host → needs container private-egress deny
#   - Browser Fabric runs in BF's network → needs a BF isolation guarantee
def _env_flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes", "on")


# Back-compat umbrella flag: enables both surfaces if set.
_TRUSTED_ALL = _env_flag("TRUSTED_BROWSER_EGRESS")
TRUSTED_LOCAL_BROWSER_EGRESS = _TRUSTED_ALL or _env_flag("TRUSTED_LOCAL_BROWSER_EGRESS")
TRUSTED_BF_EGRESS = _TRUSTED_ALL or _env_flag("TRUSTED_BF_EGRESS")


def _egress_trusted(use_cloud: bool) -> bool:
    """Whether the execution surface that will actually run the navigation has a
    confirmed private-egress isolation guarantee."""
    return TRUSTED_BF_EGRESS if use_cloud else TRUSTED_LOCAL_BROWSER_EGRESS


class RenderDisabledError(RuntimeError):
    """Raised when browsing is requested but the deployment has not been marked
    as having trusted (private-egress-denied) networking for that surface."""


class BrowserNavigationError(RuntimeError):
    """Navigation failure with a machine-readable code the agent can act on."""

    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


class BrowserCapacityError(RuntimeError):
    """Raised when this process's global browser-session backstop is hit.

    This is NOT the per-workspace tab quota (that is enforced in the router
    against the DB). It is a coarse per-process safety limit on live sessions
    so a single worker can't spawn unbounded Chromium pages / BF sessions.
    """


def _is_session_gone_error(exc: Exception) -> bool:
    """True only for an explicit Browser Fabric 'session already gone' signal.

    _bf_call raises RuntimeError("Browser Fabric error: <error>") when BF reports
    a semantic failure. A session that is already closed / not found means the
    close goal is already achieved, so treat it as success. We deliberately do
    NOT treat arbitrary HTTP errors (e.g. a bare 404 from a proxy) as 'gone' —
    only BF's own not-found/expired/closed error strings.
    """
    if not isinstance(exc, RuntimeError):
        return False
    s = str(exc).lower()
    if "browser fabric error" not in s:
        return False
    return any(
        marker in s
        for marker in (
            "session_not_found",
            "session not found",
            "no such session",
            "already closed",
            "already_closed",
            "session expired",
            "session_expired",
            "does not exist",
        )
    )


# Only these in-page, non-network schemes are allowed through the SSRF route
# guard. Everything else (ws/wss/ftp/file/…) is blocked so an internal service
# can't be reached over a non-http scheme.
_ROUTE_GUARD_ALLOWED_SCHEMES = {"data", "blob", "about"}


async def _ssrf_route_guard(route) -> None:
    """Playwright route handler for the local render path. Aborts any request
    that could reach an internal address:

    - http/https: the host must resolve only to public IPs (covers the main
      navigation, redirects, XHR and sub-resources — not just the entry URL).
    - data/blob/about: allowed (in-page, no network).
    - anything else (ws/wss/ftp/file/…): blocked.

    This is defense-in-depth only. Playwright's page.route does not intercept
    every Service Worker request and WebSockets need a separate routing API, so
    the real boundary is a container/process-level private-egress deny (see the
    deployment notes). The cloud Browser Fabric path runs in the provider's
    network; its sub-resource isolation is BF's boundary and we still
    pre-validate the entry URL before navigating there.
    """
    from urllib.parse import urlparse

    from app.net_security import UnsafeURLError, validate_public_url

    url = route.request.url
    scheme = urlparse(url).scheme.lower()

    async def _abort():
        try:
            await route.abort()
        except Exception:
            pass

    if scheme in ("http", "https"):
        try:
            await validate_public_url(url)
        except Exception:
            # UnsafeURLError or anything unexpected → never fail open.
            await _abort()
            return
    elif scheme not in _ROUTE_GUARD_ALLOWED_SCHEMES:
        await _abort()
        return
    try:
        await route.continue_()
    except Exception:
        pass


async def _assert_navigable(url: str) -> None:
    """Guard navigation for the shared browser and render paths. Allows only
    http(s) (validated to resolve to public IPs) and about:blank. Any other
    scheme — file://, ftp://, ws://, … — is rejected (a file:// on the local
    browser would read this host's filesystem). Raises BrowserNavigationError
    with UNSUPPORTED_SCHEME or BLOCKED_PRIVATE_ADDRESS."""
    if not url or url == "about:blank":
        return
    from urllib.parse import urlparse

    from app.net_security import UnsafeURLError, validate_public_url

    if urlparse(url).scheme.lower() not in ("http", "https"):
        raise BrowserNavigationError(
            "UNSUPPORTED_SCHEME", f"Only http(s) and about:blank are allowed, got: {url[:80]}"
        )
    try:
        await validate_public_url(url)
    except UnsafeURLError as e:
        raise BrowserNavigationError("BLOCKED_PRIVATE_ADDRESS", str(e)) from e


def classify_navigation_error(exc: Exception) -> str:
    """Map a raw navigation exception to a stable error code."""
    low = str(exc).lower()
    if "err_name_not_resolved" in low or "err_cert" in low or "ssl" in low or "tls" in low or "dns" in low:
        return "DNS_OR_TLS_ERROR"
    if "timeout" in low or "timed out" in low:
        return "NAV_TIMEOUT"
    if "err_blocked" in low or "err_connection_refused" in low or "403" in low:
        return "CONTENT_BLOCKED"
    return "NAVIGATION_FAILED"


class BrowserManager:
    """Singleton managing shared browser tabs via Browser Fabric or local Playwright."""

    _instance: Optional["BrowserManager"] = None

    def __init__(self):
        self._playwright = None
        self._browser = None            # Only used for local mode
        self._pages: dict = {}           # tab_id -> Page (local mode only)
        self._locks: dict = {}           # tab_id -> asyncio.Lock (local mode only)
        self._global_lock = asyncio.Lock()
        self._sessions: dict = {}        # tab_id -> Browser Fabric session id
        self._live_urls: dict = {}       # tab_id -> Browser Fabric share URL
        self._tab_keys: dict = {}        # tab_id -> per-workspace BF API key

    @classmethod
    def get(cls) -> "BrowserManager":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @property
    def is_cloud(self) -> bool:
        return bool(BROWSERFABRIC_API_KEY)

    def is_cloud_for(self, api_key: str = None) -> bool:
        return bool(api_key or BROWSERFABRIC_API_KEY)

    # ------------------------------------------------------------------
    # Browser Fabric REST helpers
    # ------------------------------------------------------------------

    def _key_for_tab(self, tab_id: str = None) -> str:
        """Return the BF API key for a given tab, or the global default."""
        if tab_id and tab_id in self._tab_keys:
            return self._tab_keys[tab_id]
        return BROWSERFABRIC_API_KEY

    async def _bf_call(self, tool_name: str, arguments: dict = None, session_id: str = None, api_key: str = None, tab_id: str = None) -> dict:
        """Call a Browser Fabric tool via REST API."""
        key = api_key or (self._key_for_tab(tab_id) if tab_id else BROWSERFABRIC_API_KEY)
        payload: dict = {"tool_name": tool_name}
        if arguments:
            payload["arguments"] = arguments
        if session_id:
            payload["session_id"] = session_id
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{BROWSERFABRIC_URL}/api/v1/services/browseruse/call",
                json=payload,
                headers={"Authorization": f"Bearer {key}"},
            )
            resp.raise_for_status()
            data = resp.json()
            if not data.get("success"):
                raise RuntimeError(f"Browser Fabric error: {data.get('error', 'unknown')}")
            return data

    @staticmethod
    async def provision_workspace_key(workspace_id: str) -> Optional[str]:
        """Auto-provision a free-tier BF API key for a workspace."""
        if not BROWSERFABRIC_PROVISION_SECRET:
            return None
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(
                    f"{BROWSERFABRIC_URL}/api/v1/auth/provision-workspace",
                    json={"workspace_id": workspace_id, "secret": BROWSERFABRIC_PROVISION_SECRET},
                )
                resp.raise_for_status()
                data = resp.json()
                return data.get("api_key")
        except Exception as e:
            logger.warning("Failed to provision BF key for workspace %s: %s", workspace_id, e)
            return None

    # ------------------------------------------------------------------
    # Playwright init (local mode only)
    # ------------------------------------------------------------------

    async def _ensure_playwright(self):
        if self._playwright:
            return
        from playwright.async_api import async_playwright
        self._playwright = await async_playwright().start()

    async def _ensure_local_browser(self):
        if self._browser and self._browser.is_connected():
            return
        await self._ensure_playwright()
        self._browser = await self._playwright.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox"],
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def prune_dead_sessions(self) -> int:
        """Remove BF sessions that are no longer alive (public, for the reaper)."""
        return await self._prune_dead_sessions()

    def _is_cloud_tab(self, tab_id: str) -> bool:
        """Whether a specific tab is a cloud (BF) tab. Determined by where the
        tab actually lives, not the global key — so a workspace that only has a
        provisioned BF key (no global env key) still routes its tabs to BF
        instead of falling through to local Playwright."""
        if tab_id in self._sessions:
            return True
        if tab_id in self._pages:
            return False
        return self.is_cloud

    def _require_egress(self, use_cloud: bool) -> None:
        """Fail closed unless the execution surface has a confirmed egress
        isolation guarantee. Applies to both render and the shared browser."""
        if not _egress_trusted(use_cloud):
            surface = "Browser Fabric" if use_cloud else "local browser"
            flag = "TRUSTED_BF_EGRESS" if use_cloud else "TRUSTED_LOCAL_BROWSER_EGRESS"
            raise RenderDisabledError(
                f"Browsing via the {surface} is disabled on this deployment "
                f"(no confirmed private-egress isolation). Set {flag}=1 once "
                f"egress is locked down."
            )

    def _is_cloud_close(self, tab_id: str, session_id_hint: str = None, api_key: str = None) -> bool:
        """Whether closing this tab should target BF. Works cross-worker: a
        session_id_hint or an explicit api_key means it's a cloud session even
        if this process's in-memory maps don't know the tab (and even if there
        is no global key)."""
        if tab_id in self._pages and tab_id not in self._sessions:
            return False
        if tab_id in self._sessions or session_id_hint:
            return True
        return self.is_cloud_for(api_key)

    async def _prune_dead_sessions(self) -> int:
        """Remove BF sessions that are no longer alive. Returns number pruned."""
        # Prune whenever there are cloud sessions in memory, regardless of the
        # global key (a provisioned-key-only workspace still has BF sessions).
        if not self._sessions:
            return 0
        dead: list[str] = []
        for tab_id, session_id in list(self._sessions.items()):
            try:
                # Pass tab_id so the per-tab key (not the global key) is used.
                await self._bf_call("get_page_info", {}, session_id, tab_id=tab_id)
            except Exception:
                dead.append(tab_id)
        for tab_id in dead:
            self._sessions.pop(tab_id, None)
            self._live_urls.pop(tab_id, None)
            logger.info("Pruned dead BF session for tab %s", tab_id)
        return len(dead)

    async def open_tab(self, tab_id: str, url: str = "about:blank", bb_context_id: str = None, api_key: str = None) -> dict:
        """Create a new browser tab. Returns {url, title}."""
        # Use is_cloud_for(api_key): a workspace with only a provisioned key
        # (no global env key) must still open a cloud session, not fall through
        # to local Playwright.
        use_cloud = self.is_cloud_for(api_key)
        # Fail closed on the actual execution surface's egress trust, and
        # validate the URL BEFORE storing the per-tab key (a rejected open must
        # not leave a _tab_keys entry behind).
        if url and url != "about:blank":
            self._require_egress(use_cloud)
        await _assert_navigable(url)
        if api_key:
            self._tab_keys[tab_id] = api_key
        async with self._global_lock:
            active_count = len(self._sessions) if use_cloud else len(self._pages)
            if active_count >= MAX_BROWSER_TABS:
                if use_cloud:
                    await self._prune_dead_sessions()
                    active_count = len(self._sessions)
                if active_count >= MAX_BROWSER_TABS:
                    # Per-process safety backstop, not the workspace quota.
                    raise BrowserCapacityError(
                        f"Global browser capacity ({MAX_BROWSER_TABS} live sessions) "
                        f"reached on this worker"
                    )

        if use_cloud:
            args: dict = {"headless": True}
            if bb_context_id:
                args["context_id"] = bb_context_id
                args["persist"] = True

            result = await self._bf_call("create_session", args, tab_id=tab_id)
            session_data = result["result"]
            session_id = session_data["session_id"]
            self._sessions[tab_id] = session_id
            if session_data.get("share_url"):
                self._live_urls[tab_id] = session_data["share_url"]

            nav_error = None
            if url and url != "about:blank":
                try:
                    await self._bf_call("navigate", {"url": url, "wait_until": "domcontentloaded"}, session_id, tab_id=tab_id)
                except Exception as e:
                    # Keep the session alive (the tab is still usable) but tell
                    # the caller the initial navigation failed instead of
                    # silently handing back a blank page.
                    nav_error = {"code": classify_navigation_error(e), "message": str(e)[:500]}
                    logger.warning("Initial navigation to %s failed for tab %s: %s", url, tab_id, e)

            info = await self._bf_call("get_page_info", {}, session_id, tab_id=tab_id)
            page_info = info.get("result", {})
            result = {"url": page_info.get("url", url), "title": page_info.get("title", "")}
            if nav_error:
                result["navigation_error"] = nav_error
            return result
        else:
            # Local mode
            async with self._global_lock:
                await self._ensure_local_browser()
                page = await self._browser.new_page()
                self._pages[tab_id] = page

            # Guard sub-resources / redirects to internal addresses.
            await page.route("**/*", _ssrf_route_guard)

            nav_error = None
            if url and url != "about:blank":
                try:
                    await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                except Exception as e:
                    nav_error = {"code": classify_navigation_error(e), "message": str(e)[:500]}
                    logger.warning("Initial navigation to %s failed for tab %s: %s", url, tab_id, e)

            title = await page.title()
            result = {"url": page.url, "title": title}
            if nav_error:
                result["navigation_error"] = nav_error
            return result

    async def navigate(self, tab_id: str, url: str) -> dict:
        """Navigate a tab to a URL. Returns {url, title}.

        Raises BrowserNavigationError on failure instead of silently leaving
        the page wherever it was (which agents used to see as a blank page).
        """
        # Fail closed on egress trust for the surface this tab runs on, then
        # block navigation to internal addresses / disallowed schemes.
        self._require_egress(self._is_cloud_tab(tab_id))
        await _assert_navigable(url)
        if self._is_cloud_tab(tab_id):
            session_id = self._get_session(tab_id)
            try:
                await self._bf_call("navigate", {"url": url, "wait_until": "domcontentloaded"}, session_id, tab_id=tab_id)
            except Exception as e:
                raise BrowserNavigationError(classify_navigation_error(e), str(e)[:500]) from e
            info = await self._bf_call("get_page_info", {}, session_id, tab_id=tab_id)
            page_info = info.get("result", {})
            return {"url": page_info.get("url", url), "title": page_info.get("title", "")}
        else:
            page = self._get_page(tab_id)
            async with self._get_lock(tab_id):
                try:
                    await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                except Exception as e:
                    raise BrowserNavigationError(classify_navigation_error(e), str(e)[:500]) from e
                title = await page.title()
                return {"url": page.url, "title": title}

    async def click(self, tab_id: str, selector: str) -> dict:
        """Click an element by CSS selector."""
        if self._is_cloud_tab(tab_id):
            session_id = self._get_session(tab_id)
            await self._bf_call("click_element", {"selector": selector}, session_id, tab_id=tab_id)
            info = await self._bf_call("get_page_info", {}, session_id, tab_id=tab_id)
            page_info = info.get("result", {})
            return {"clicked": selector, "url": page_info.get("url", ""), "title": page_info.get("title", "")}
        else:
            page = self._get_page(tab_id)
            async with self._get_lock(tab_id):
                await page.click(selector, timeout=10000)
                await page.wait_for_load_state("domcontentloaded", timeout=5000)
                return {"clicked": selector, "url": page.url, "title": await page.title()}

    async def type_text(self, tab_id: str, selector: str, text: str, append: bool = False) -> dict:
        """Type text into an element."""
        if self._is_cloud_tab(tab_id):
            session_id = self._get_session(tab_id)
            await self._bf_call("type_text", {"selector": selector, "text": text}, session_id, tab_id=tab_id)
            return {"filled": selector, "text": text}
        else:
            page = self._get_page(tab_id)
            async with self._get_lock(tab_id):
                try:
                    if append:
                        raise Exception("skip fill for append mode")
                    await page.fill(selector, text, timeout=5000)
                except Exception:
                    await page.click(selector, timeout=5000)
                    if append:
                        await page.keyboard.press("End")
                        await page.keyboard.press("Control+End")
                    chunk_size = 200
                    for i in range(0, len(text), chunk_size):
                        chunk = text[i:i + chunk_size]
                        await page.keyboard.type(chunk, delay=15)
                        await asyncio.sleep(0.1)
                return {"filled": selector, "text": text}

    async def press_key(self, tab_id: str, key: str) -> dict:
        """Press a keyboard key."""
        if self._is_cloud_tab(tab_id):
            session_id = self._get_session(tab_id)
            await self._bf_call("press_key", {"key": key}, session_id, tab_id=tab_id)
            return {"pressed": key}
        else:
            page = self._get_page(tab_id)
            async with self._get_lock(tab_id):
                await page.keyboard.press(key)
                return {"pressed": key}

    async def evaluate(self, tab_id: str, expression: str) -> dict:
        """Execute JavaScript in the page context."""
        if self._is_cloud_tab(tab_id):
            session_id = self._get_session(tab_id)
            result = await self._bf_call("evaluate_js", {"expression": expression}, session_id, tab_id=tab_id)
            return {"result": result.get("result", {}).get("result")}
        else:
            page = self._get_page(tab_id)
            async with self._get_lock(tab_id):
                result = await page.evaluate(expression)
                return {"result": result}

    async def screenshot(self, tab_id: str) -> bytes:
        """Take a PNG screenshot of the tab."""
        if self._is_cloud_tab(tab_id):
            session_id = self._get_session(tab_id)
            result = await self._bf_call("take_screenshot", {"full_page": False}, session_id, tab_id=tab_id)
            b64_data = result.get("result", {}).get("screenshot", "")
            if b64_data.startswith("data:"):
                b64_data = b64_data.split(",", 1)[1]
            return base64.b64decode(b64_data)
        else:
            page = self._get_page(tab_id)
            async with self._get_lock(tab_id):
                return await page.screenshot(type="png", full_page=False)

    async def snapshot(self, tab_id: str) -> str:
        """Get page content as a readable text snapshot."""
        if self._is_cloud_tab(tab_id):
            session_id = self._get_session(tab_id)
            result = await self._bf_call("snapshot", {}, session_id, tab_id=tab_id)
            return result.get("result", {}).get("snapshot", "(empty page)")
        else:
            page = self._get_page(tab_id)
            async with self._get_lock(tab_id):
                try:
                    tree = await page.locator("body").aria_snapshot()
                    return tree or "(empty page)"
                except (AttributeError, Exception):
                    pass
                try:
                    text = await page.inner_text("body", timeout=5000)
                    title = await page.title()
                    url = page.url
                    return f"URL: {url}\nTitle: {title}\n\n{text[:5000]}"
                except Exception:
                    return "(empty page)"

    async def close_tab(self, tab_id: str, session_id_hint: str = None, api_key: str = None) -> bool:
        """Close a browser tab. Returns True if the remote session was closed
        (or there was nothing to close), False if the remote close failed after
        retries — the caller can then decide whether to retry rather than
        assuming success.

        `api_key` lets a caller close a session it did not open in this process
        (e.g. the reaper on another worker), where the per-tab key is not in
        this process's memory; it falls back to the per-tab key then the global.
        """
        if self._is_cloud_close(tab_id, session_id_hint, api_key):
            session_id = self._sessions.pop(tab_id, None) or session_id_hint
            self._live_urls.pop(tab_id, None)
            # Pop unconditionally so the per-tab key mapping is always cleaned
            # up, even when an explicit api_key is passed (the `or` used to
            # short-circuit the pop and leak the entry).
            stored_key = self._tab_keys.pop(tab_id, None)
            tab_key = api_key or stored_key
            if not session_id:
                return True
            # A leaked BF session keeps consuming the concurrency quota
            # until BF expires it, so retry before giving up.
            last_err = None
            for attempt in range(CLOSE_SESSION_RETRIES):
                try:
                    await self._bf_call("close_session", {}, session_id, api_key=tab_key)
                    return True
                except Exception as e:
                    # If BF says the session is already gone, the close goal is
                    # achieved — treat it as success (idempotent close).
                    if _is_session_gone_error(e):
                        return True
                    last_err = e
                    if attempt < CLOSE_SESSION_RETRIES - 1:
                        await asyncio.sleep(1.0 * (attempt + 1))
            logger.error(
                "Failed to close BF session %s after %d attempts (session may leak until BF expiry): %s",
                session_id, CLOSE_SESSION_RETRIES, last_err,
            )
            return False
        else:
            page = self._pages.pop(tab_id, None)
            self._locks.pop(tab_id, None)
            if page:
                try:
                    await page.close()
                except Exception:
                    return False
            return True

    def _get_render_semaphore(self) -> "asyncio.Semaphore":
        # Created lazily inside the event loop (a module-level Semaphore would
        # bind to the import-time loop). Singleton manager → one semaphore.
        if getattr(self, "_render_sem", None) is None:
            self._render_sem = asyncio.Semaphore(RENDER_MAX_CONCURRENCY)
        return self._render_sem

    async def render_page_text(self, url: str, api_key: str = None) -> dict:
        """One-shot render for the fetch chain: create a session/page, navigate,
        snapshot, close. Never registers a tab, so it doesn't consume the
        workspace tab quota. Returns {url, title, text}.

        Raises BrowserNavigationError on navigation failure, RenderDisabledError
        when trusted egress isn't configured, or BrowserCapacityError when the
        per-worker render concurrency cap is saturated.
        """
        use_cloud = self.is_cloud_for(api_key)
        if not _egress_trusted(use_cloud):
            surface = "Browser Fabric" if use_cloud else "local browser"
            flag = "TRUSTED_BF_EGRESS" if use_cloud else "TRUSTED_LOCAL_BROWSER_EGRESS"
            raise RenderDisabledError(
                f"JS rendering via the {surface} is disabled on this deployment. "
                f"It can reach internal/metadata endpoints without network-layer "
                f"isolation; set {flag}=1 once private egress is denied."
            )
        # SSRF: validate the entry URL up front (sub-resources are guarded below
        # for local; BF sub-resources are the provider's boundary).
        await _assert_navigable(url)

        # Bound per-worker concurrent renders so a burst can't exhaust BF.
        sem = self._get_render_semaphore()
        try:
            await asyncio.wait_for(sem.acquire(), timeout=RENDER_ACQUIRE_TIMEOUT_SECONDS)
        except asyncio.TimeoutError:
            raise BrowserCapacityError("Render concurrency limit reached; try again shortly")
        try:
            return await self._render_page_text_inner(url, api_key)
        finally:
            sem.release()

    async def _render_page_text_inner(self, url: str, api_key: str = None) -> dict:
        if self.is_cloud_for(api_key):
            key = api_key or BROWSERFABRIC_API_KEY
            result = await self._bf_call("create_session", {"headless": True}, api_key=key)
            session_id = result["result"]["session_id"]
            try:
                try:
                    await self._bf_call(
                        "navigate", {"url": url, "wait_until": "domcontentloaded"}, session_id, api_key=key
                    )
                except Exception as e:
                    raise BrowserNavigationError(classify_navigation_error(e), str(e)[:500]) from e
                # domcontentloaded fires before client-side frameworks (Notion,
                # SPAs) paint. Snapshot after a short settle and retry while the
                # page is still an empty shell, bounded by RENDER_SETTLE_ATTEMPTS.
                text = ""
                for attempt in range(RENDER_SETTLE_ATTEMPTS):
                    await asyncio.sleep(RENDER_SETTLE_SECONDS)
                    snap = await self._bf_call("snapshot", {}, session_id, api_key=key)
                    text = snap.get("result", {}).get("snapshot", "") or ""
                    if len(text.strip()) >= RENDER_MIN_TEXT_CHARS:
                        break
                info = await self._bf_call("get_page_info", {}, session_id, api_key=key)
                page_info = info.get("result", {})
                return {
                    "url": page_info.get("url", url),
                    "title": page_info.get("title", ""),
                    "text": text,
                }
            finally:
                try:
                    await self._bf_call("close_session", {}, session_id, api_key=key)
                except Exception as e:
                    logger.warning("Failed to close ephemeral BF session %s: %s", session_id, e)
        else:
            async with self._global_lock:
                await self._ensure_local_browser()
                page = await self._browser.new_page()
            try:
                # Block sub-resources / redirects that target internal addresses
                # (the entry URL is validated by the caller, but the page can
                # then fetch or redirect to a private host).
                await page.route("**/*", _ssrf_route_guard)
                try:
                    await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                except Exception as e:
                    raise BrowserNavigationError(classify_navigation_error(e), str(e)[:500]) from e
                # Give client-side rendering a moment to settle
                await page.wait_for_timeout(1500)
                text = await page.inner_text("body")
                return {"url": page.url, "title": await page.title(), "text": text}
            finally:
                try:
                    await page.close()
                except Exception:
                    pass

    async def shutdown(self) -> None:
        """Close all tabs and the browser."""
        for tab_id in list(self._sessions.keys()) + list(self._pages.keys()):
            await self.close_tab(tab_id)
        if self._browser:
            try:
                await self._browser.close()
            except Exception:
                pass
            self._browser = None
        if self._playwright:
            try:
                await self._playwright.stop()
            except Exception:
                pass
            self._playwright = None

    # ------------------------------------------------------------------
    # Reconnection (serverless / cold-start recovery)
    # ------------------------------------------------------------------

    async def reconnect(self, tab_id: str, session_id: str, api_key: str = None) -> None:
        """Reconnect to an existing Browser Fabric session.

        In REST-only mode, we just store the session_id mapping (and restore the
        per-tab key so subsequent operations authenticate with the workspace's
        BF key, not the global one).
        """
        if self.is_cloud_for(api_key):
            if api_key:
                self._tab_keys[tab_id] = api_key
            if tab_id in self._sessions:
                return
            self._sessions[tab_id] = session_id
        else:
            raise KeyError(f"Cannot reconnect to local tab: {tab_id}")

    # ------------------------------------------------------------------
    # Persistent contexts
    # ------------------------------------------------------------------

    async def create_bb_context(self, session_id: str = None, api_key: str = None) -> str:
        """Save the current session's state and return a Browser Fabric context ID.

        If session_id is provided, calls save_context on the active session
        so cookies/localStorage are captured before the session is closed.
        `api_key` selects the workspace BF key (falls back to the global key).
        """
        if self.is_cloud_for(api_key) and session_id:
            result = await self._bf_call(
                "save_context",
                {"context_name": f"persist-{session_id[:8]}"},
                session_id,
                api_key=api_key,
            )
            return result.get("result", {}).get("context_id", str(__import__("uuid").uuid4()))
        import uuid
        return str(uuid.uuid4())

    def delete_bb_context(self, bb_context_id: str, api_key: str = None) -> None:
        """Delete a persistent context (fire-and-forget). Uses the workspace BF
        key when provided so the delete targets the right BF account."""
        if not self.is_cloud_for(api_key):
            return
        key = api_key or BROWSERFABRIC_API_KEY
        try:
            with httpx.Client(timeout=10.0) as client:
                client.delete(
                    f"{BROWSERFABRIC_URL}/api/v1/contexts/{bb_context_id}",
                    headers={"Authorization": f"Bearer {key}"},
                )
        except Exception as e:
            logger.warning("Failed to delete BF context %s: %s", bb_context_id, e)

    # ------------------------------------------------------------------
    # Accessors
    # ------------------------------------------------------------------

    def _get_session(self, tab_id: str) -> str:
        session_id = self._sessions.get(tab_id)
        if not session_id:
            raise KeyError(f"Browser tab not found: {tab_id}")
        return session_id

    def _get_page(self, tab_id: str):
        page = self._pages.get(tab_id)
        if not page:
            raise KeyError(f"Browser tab not found: {tab_id}")
        return page

    def _get_lock(self, tab_id: str) -> asyncio.Lock:
        if tab_id not in self._locks:
            self._locks[tab_id] = asyncio.Lock()
        return self._locks[tab_id]

    def get_live_url(self, tab_id: str) -> Optional[str]:
        """Return the live view URL for interactive browser access."""
        return self._live_urls.get(tab_id)

    def get_session_id(self, tab_id: str) -> Optional[str]:
        """Return the Browser Fabric session ID for a tab."""
        return self._sessions.get(tab_id)

    async def get_current_url(self, tab_id: str) -> Optional[dict]:
        """Return the current {url, title} from the live page."""
        if self._is_cloud_tab(tab_id):
            session_id = self._sessions.get(tab_id)
            if not session_id:
                return None
            try:
                info = await self._bf_call("get_page_info", {}, session_id, tab_id=tab_id)
                page_info = info.get("result", {})
                return {"url": page_info.get("url", ""), "title": page_info.get("title", "")}
            except Exception:
                return None
        else:
            page = self._pages.get(tab_id)
            if not page:
                return None
            try:
                url = page.url
                title = await page.title()
                return {"url": url, "title": title}
            except Exception:
                return None

    def active_tab_count(self) -> int:
        # Count whatever live tabs this worker holds, not by global mode
        # (a worker may hold cloud sessions even without a global key).
        return len(self._sessions) + len(self._pages)
