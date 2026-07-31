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

from app.browser_creds import redact
from app.browser_egress import DENY_MARKER_HEADER, EgressPolicyProxy
from app.net_security import UnsafeURLError, validate_public_url

logger = logging.getLogger(__name__)

MAX_BROWSER_TABS = int(os.environ.get("MAX_BROWSER_TABS", "20"))

BROWSERFABRIC_API_KEY = os.environ.get("BROWSERFABRIC_API_KEY", "")
BROWSERFABRIC_URL = os.environ.get("BROWSERFABRIC_URL", "https://api.browserfabric.com")
BROWSERFABRIC_PROVISION_SECRET = os.environ.get("BROWSERFABRIC_PROVISION_SECRET", "")

# render_page_text: let a JS page settle before snapshotting, and retry while it
# still looks like an empty shell.
RENDER_SETTLE_SECONDS = float(os.environ.get("RENDER_SETTLE_SECONDS", "1.5"))
RENDER_SETTLE_ATTEMPTS = int(os.environ.get("RENDER_SETTLE_ATTEMPTS", "3"))
RENDER_MIN_TEXT_CHARS = int(os.environ.get("RENDER_MIN_TEXT_CHARS", "50"))

# Enumerate the images the DOM actually resolved, so a rendered read can hand
# back the same assets a static read extracts from markup. currentSrc is what
# the browser picked out of any srcset; src is the fallback before layout.
# Bounded here rather than in the caller so a pathological page can't return a
# multi-megabyte list across the process boundary.
RENDER_IMAGE_JS = (
    "Array.from(document.images).slice(0, 60)"
    ".map(function (i) { return {url: i.currentSrc || i.src || '', alt: i.alt || ''}; })"
    ".filter(function (x) { return x.url; })"
)

# Chromium's own sandbox is a second containment layer under the egress proxy:
# it is what keeps a renderer compromise (from a page an agent chose) inside
# the renderer process. It needs a non-root user plus unprivileged user
# namespaces in the container, which the current backend image does not
# provide, so it stays opt-in — flipping the default here without changing the
# image would make every browser launch fail.
BROWSER_SANDBOX = os.environ.get("BROWSER_SANDBOX", "").lower() in ("1", "true", "yes")

# The only non-http(s) URL a tab may hold: the blank page a tab is opened on
# before anywhere real is navigated to.
BLANK_PAGE = "about:blank"


async def guard_browser_url(url: Optional[str]) -> str:
    """Policy gate for every URL a browser is asked to load.

    Raises UnsafeURLError for anything that is not a public http(s) target.
    `about:blank` is allowed through as an exact match only — it is the
    default a tab opens on, and it reaches no network — while any other
    non-http(s) URL (file://, chrome://, data:, view-source:, ...) is refused.

    This is the entry check. It is not the whole defence: once a page is
    loaded, where it navigates next is constrained by the egress proxy, not
    by this function.
    """
    if not url or url.strip() == "" or url.strip() == BLANK_PAGE:
        return BLANK_PAGE
    await validate_public_url(url)
    return url


class BrowserNavigationError(RuntimeError):
    """Navigation failure with a machine-readable code the agent can act on."""

    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


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
        self._egress_proxy = None        # EgressPolicyProxy (local mode only)

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

    def _is_cloud_tab(self, tab_id: str) -> bool:
        """A tab is a cloud tab iff it has a BF session. Dispatching on this
        (rather than the global env key) keeps per-workspace-key tabs working
        even when no global BROWSERFABRIC_API_KEY is configured."""
        return tab_id in self._sessions

    # ------------------------------------------------------------------
    # Browser Fabric REST helpers
    # ------------------------------------------------------------------

    def _key_for_tab(self, tab_id: str = None) -> str:
        """Return the BF API key for a given tab, or the global default."""
        if tab_id and tab_id in self._tab_keys:
            return self._tab_keys[tab_id]
        return BROWSERFABRIC_API_KEY

    def bind_tab_key(self, tab_id: str, api_key: Optional[str]) -> None:
        """Refresh the in-process key cache from the router's credential
        resolver, so per-tab ops use the verified key even when the tab was
        opened by another process/before a restart."""
        if api_key:
            self._tab_keys[tab_id] = api_key
        else:
            self._tab_keys.pop(tab_id, None)

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

    async def _ensure_egress_proxy(self):
        """Start (once) the policy proxy every local browser request goes through."""
        if self._egress_proxy is None:
            self._egress_proxy = EgressPolicyProxy()
            await self._egress_proxy.start()
        return self._egress_proxy

    async def _ensure_local_browser(self):
        if self._browser and self._browser.is_connected():
            return
        await self._ensure_playwright()
        proxy = await self._ensure_egress_proxy()
        # chromium_sandbox is the switch that actually decides this: Playwright
        # defaults it to False and injects --no-sandbox itself, so merely
        # leaving that flag out of `args` would keep the sandbox off while
        # looking like it had been enabled.
        self._browser = await self._playwright.chromium.launch(
            headless=True,
            args=list(proxy.chromium_args()),
            chromium_sandbox=BROWSER_SANDBOX,
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def _prune_dead_sessions(self) -> int:
        """Remove BF sessions that are no longer alive. Returns number pruned."""
        if not self.is_cloud or not self._sessions:
            return 0
        dead: list[str] = []
        for tab_id, session_id in list(self._sessions.items()):
            try:
                await self._bf_call("get_page_info", {}, session_id, tab_id=tab_id)
            except Exception:
                dead.append(tab_id)
        for tab_id in dead:
            # close_tab (not a bare pop) so a session that merely errored on
            # the liveness probe still gets a best-effort release on BF.
            await self.close_tab(tab_id)
            logger.info("Pruned dead BF session for tab %s", tab_id)
        return len(dead)

    async def open_tab(self, tab_id: str, url: str = "about:blank", bb_context_id: str = None, api_key: str = None) -> dict:
        """Create a new browser tab. Returns {url, title}.

        Raises UnsafeURLError if `url` is not a public http(s) target.
        """
        url = await guard_browser_url(url)
        if api_key:
            self._tab_keys[tab_id] = api_key
        async with self._global_lock:
            active_count = self.active_tab_count()
            if active_count >= MAX_BROWSER_TABS:
                if self.is_cloud_for(api_key):
                    await self._prune_dead_sessions()
                    active_count = len(self._sessions)
                if active_count >= MAX_BROWSER_TABS:
                    raise RuntimeError(f"Maximum browser tabs ({MAX_BROWSER_TABS}) reached")

        if self.is_cloud_for(api_key):
            args: dict = {"headless": True}
            if bb_context_id:
                args["context_id"] = bb_context_id
                args["persist"] = True

            try:
                result = await self._bf_call("create_session", args, tab_id=tab_id)
            except Exception:
                self._tab_keys.pop(tab_id, None)
                raise
            session_data = result["result"]
            session_id = session_data["session_id"]
            self._sessions[tab_id] = session_id
            if session_data.get("share_url"):
                self._live_urls[tab_id] = session_data["share_url"]

            # From here on the BF session exists and counts against the
            # per-key quota — nothing below may raise, or the caller never
            # records the session and it leaks. Failures are surfaced as
            # warnings so the caller knows init didn't fully succeed.
            warnings: list = []
            key_used = self._key_for_tab(tab_id)
            if url and url != "about:blank":
                try:
                    await self._bf_call("navigate", {"url": url, "wait_until": "domcontentloaded"}, session_id, tab_id=tab_id)
                except Exception as e:
                    warnings.append(f"navigation_failed: {redact(str(e), key_used)}")

            try:
                info = await self._bf_call("get_page_info", {}, session_id, tab_id=tab_id)
                page_info = info.get("result", {})
            except Exception as e:
                logger.warning("get_page_info failed for new tab %s (session kept): %s",
                               tab_id, redact(str(e), key_used))
                warnings.append(f"page_info_failed: {redact(str(e), key_used)}")
                page_info = {}
            return {"url": page_info.get("url", url), "title": page_info.get("title", ""), "warnings": warnings}
        else:
            # Local mode
            async with self._global_lock:
                await self._ensure_local_browser()
                page = await self._browser.new_page()
                self._pages[tab_id] = page

            warnings = []
            if url and url != "about:blank":
                try:
                    await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                except Exception as e:
                    warnings.append(f"navigation_failed: {e}")

            title = await page.title()
            return {"url": page.url, "title": title, "warnings": warnings}

    async def navigate(self, tab_id: str, url: str) -> dict:
        """Navigate a tab to a URL. Returns {url, title}.

        Raises UnsafeURLError if `url` is not a public http(s) target.
        """
        url = await guard_browser_url(url)
        if self._is_cloud_tab(tab_id):
            session_id = self._get_session(tab_id)
            try:
                await self._bf_call("navigate", {"url": url, "wait_until": "domcontentloaded"}, session_id, tab_id=tab_id)
            except Exception:
                pass
            info = await self._bf_call("get_page_info", {}, session_id, tab_id=tab_id)
            page_info = info.get("result", {})
            return {"url": page_info.get("url", url), "title": page_info.get("title", "")}
        else:
            page = self._get_page(tab_id)
            async with self._get_lock(tab_id):
                try:
                    await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                except Exception:
                    pass
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

    async def close_tab(self, tab_id: str, session_id_hint: str = None, api_key: str = None) -> tuple:
        """Close a browser tab.

        Returns (released, error):
          - (True, None)   — BF session confirmed released: 2xx close success,
                             a typed HTTP 404 (session no longer exists), or
                             nothing to release.
          - (False, error) — close failed / outcome unknown (timeout, network
                             error, non-404 HTTP error, success=false body).
                             The caller must keep the session marked open so
                             the maintenance sweeper retries. `error` is
                             redacted — safe to store and log.

        `api_key` is the key resolved from the tab's credential reference;
        required for cross-restart closes where the in-memory `_tab_keys`
        mapping is gone.
        """
        session_id = self._sessions.pop(tab_id, None) or session_id_hint
        tab_key = api_key or self._tab_keys.pop(tab_id, None)
        if api_key:
            self._tab_keys.pop(tab_id, None)
        self._live_urls.pop(tab_id, None)
        if session_id and self.is_cloud_for(tab_key):
            try:
                await self._bf_call("close_session", {}, session_id, api_key=tab_key)
            except httpx.HTTPStatusError as e:
                # Only a typed 404 reliably means "session no longer exists".
                # Any other status is an unknown outcome — do NOT report
                # released, the remote session may still hold quota.
                if e.response is not None and e.response.status_code == 404:
                    logger.info("BF session %s already gone (404) — treating as released", session_id)
                    return True, None
                err = redact(f"HTTP {e.response.status_code if e.response is not None else '?'} closing session", tab_key)
                logger.warning("Failed to close BF session %s: %s", session_id, err)
                return False, err
            except Exception as e:
                err = redact(str(e), tab_key)
                logger.warning("Failed to close BF session %s: %s", session_id, err)
                return False, err
            return True, None

        page = self._pages.pop(tab_id, None)
        self._locks.pop(tab_id, None)
        if page:
            try:
                await page.close()
            except Exception:
                pass
        return True, None

    async def render_page_text(self, url: str, api_key: str = None) -> dict:
        """One-shot render for the fetch chain: create a session/page, navigate,
        snapshot, close. Never registers a tab, so it doesn't consume the
        workspace tab quota. Returns {url, title, text}.

        Raises BrowserNavigationError on navigation failure, UnsafeURLError if
        the entry URL is not a public http(s) target.

        Validating the entry URL constrains only the first request. Everything
        the page does afterwards — redirects, meta-refresh, JS navigation,
        XHR, iframes, subresources, WebSockets — is constrained in local mode
        by the egress proxy (see app.browser_egress), which is the actual
        boundary. In Browser Fabric mode the navigation happens on BF's
        infrastructure and only this entry check applies.
        """
        url = await guard_browser_url(url)
        if url == BLANK_PAGE:
            raise BrowserNavigationError("NAVIGATION_FAILED", "No URL to render")
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
                # page is still an empty shell.
                text = ""
                for _ in range(RENDER_SETTLE_ATTEMPTS):
                    await asyncio.sleep(RENDER_SETTLE_SECONDS)
                    snap = await self._bf_call("snapshot", {}, session_id, api_key=key)
                    text = snap.get("result", {}).get("snapshot", "") or ""
                    if len(text.strip()) >= RENDER_MIN_TEXT_CHARS:
                        break
                info = await self._bf_call("get_page_info", {}, session_id, api_key=key)
                page_info = info.get("result", {})
                images = []
                try:
                    shot = await self._bf_call(
                        "evaluate_js", {"expression": RENDER_IMAGE_JS}, session_id, api_key=key
                    )
                    images = shot.get("result", {}).get("result") or []
                except Exception as e:
                    # Images are a bonus on top of the text read; never fail
                    # the render because the page wouldn't enumerate them.
                    logger.debug("Image enumeration failed for %s: %s", url, e)
                return {
                    "url": page_info.get("url", url),
                    "title": page_info.get("title", ""),
                    "text": text,
                    "images": images,
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

            # A policy denial arrives as an ordinary 403 and page.goto() does
            # not raise on HTTP error status, so without this the refusal page
            # would be scraped and returned as if it were the article. Only
            # main-frame navigations are treated as fatal: a page whose image
            # or analytics call was refused still has real content worth
            # returning.
            blocked_navigations = []
            deny_token = self._egress_proxy.deny_token if self._egress_proxy else None

            def _note_blocked(response):
                try:
                    # Compare the token, not just the header name. Any site the
                    # policy allows could set this header itself, and would
                    # otherwise be able to make its own page look like a
                    # blocked internal address.
                    if not deny_token or response.headers.get(DENY_MARKER_HEADER) != deny_token:
                        return
                    # response.frame is the frame that issued the request, so an
                    # image in the top document also reports the main frame.
                    # Only a navigation of the main frame replaces the content
                    # this function is about to return.
                    if response.frame is page.main_frame and response.request.is_navigation_request():
                        blocked_navigations.append(response.url)
                except Exception:
                    pass

            page.on("response", _note_blocked)
            try:
                try:
                    await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                except Exception as e:
                    raise BrowserNavigationError(classify_navigation_error(e), str(e)[:500]) from e
                await page.wait_for_timeout(1500)  # let client-side rendering settle
                if blocked_navigations:
                    raise UnsafeURLError(
                        "BLOCKED_PRIVATE_ADDRESS",
                        "The page navigated to a non-public address, which was blocked",
                    )
                text = await page.inner_text("body")
                try:
                    images = await page.evaluate(RENDER_IMAGE_JS)
                except Exception as e:
                    logger.debug("Image enumeration failed for %s: %s", url, e)
                    images = []
                return {"url": page.url, "title": await page.title(), "text": text, "images": images}
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
        if self._egress_proxy:
            try:
                await self._egress_proxy.stop()
            except Exception:
                pass
            self._egress_proxy = None

    # ------------------------------------------------------------------
    # Reconnection (serverless / cold-start recovery)
    # ------------------------------------------------------------------

    async def reconnect(self, tab_id: str, session_id: str, api_key: str = None) -> None:
        """Reconnect to an existing Browser Fabric session.

        In REST-only mode, we just store the session_id mapping (and the
        API key the session was created with, so subsequent calls don't
        fall back to the global key). The next operation will use it to
        call the BF API.
        """
        if not self.is_cloud_for(api_key):
            raise KeyError(f"Cannot reconnect to local tab: {tab_id}")
        if api_key:
            self._tab_keys[tab_id] = api_key
        if tab_id in self._sessions:
            return
        self._sessions[tab_id] = session_id

    # ------------------------------------------------------------------
    # Persistent contexts
    # ------------------------------------------------------------------

    async def create_bb_context(self, session_id: str = None, tab_id: str = None) -> str:
        """Save the current session's state and return a Browser Fabric context ID.

        If session_id is provided, calls save_context on the active session
        so cookies/localStorage are captured before the session is closed.
        """
        if self.is_cloud_for(self._key_for_tab(tab_id) if tab_id else None) and session_id:
            result = await self._bf_call(
                "save_context",
                {"context_name": f"persist-{session_id[:8]}"},
                session_id,
                tab_id=tab_id,
            )
            return result.get("result", {}).get("context_id", str(__import__("uuid").uuid4()))
        import uuid
        return str(uuid.uuid4())

    def delete_bb_context(self, bb_context_id: str) -> None:
        """Delete a persistent context (fire-and-forget)."""
        if not self.is_cloud:
            return
        try:
            with httpx.Client(timeout=10.0) as client:
                client.delete(
                    f"{BROWSERFABRIC_URL}/api/v1/contexts/{bb_context_id}",
                    headers={"Authorization": f"Bearer {BROWSERFABRIC_API_KEY}"},
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
            session_id = self._sessions[tab_id]
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
        return len(self._sessions) + len(self._pages)
