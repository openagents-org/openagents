# -*- coding: utf-8 -*-
"""
Shared browser manager — Browserbase (cloud) or local Playwright.

When BROWSERBASE_API_KEY is set, tabs are opened as Browserbase sessions
and controlled via Playwright connected over CDP.  Otherwise, a local
Chromium instance is launched (dev/testing only).
"""

import asyncio
import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

MAX_BROWSER_TABS = int(os.environ.get("MAX_BROWSER_TABS", "10"))

BROWSERBASE_API_KEY = os.environ.get("BROWSERBASE_API_KEY", "")
BROWSERBASE_PROJECT_ID = os.environ.get("BROWSERBASE_PROJECT_ID", "")


class BrowserManager:
    """Singleton managing shared browser tabs via Browserbase or local Playwright."""

    _instance: Optional["BrowserManager"] = None

    def __init__(self):
        self._playwright = None
        self._browser = None            # Only used for local mode
        self._pages: dict = {}           # tab_id -> Page
        self._locks: dict = {}           # tab_id -> asyncio.Lock
        self._global_lock = asyncio.Lock()
        self._sessions: dict = {}        # tab_id -> browserbase session id
        self._live_urls: dict = {}       # tab_id -> live view URL
        self._browsers_cdp: dict = {}    # tab_id -> CDP Browser (Browserbase)

    @classmethod
    def get(cls) -> "BrowserManager":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @property
    def is_cloud(self) -> bool:
        return bool(BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID)

    # ------------------------------------------------------------------
    # Playwright init
    # ------------------------------------------------------------------

    async def _ensure_playwright(self):
        """Start the Playwright driver if not already running."""
        if self._playwright:
            return
        from playwright.async_api import async_playwright
        self._playwright = await async_playwright().start()

    async def _ensure_local_browser(self):
        """Lazy-init a local Chromium (dev mode only)."""
        if self._browser and self._browser.is_connected():
            return
        await self._ensure_playwright()
        self._browser = await self._playwright.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox"],
        )

    # ------------------------------------------------------------------
    # Browserbase helpers
    # ------------------------------------------------------------------

    def _bb_client(self):
        from browserbase import Browserbase
        return Browserbase(api_key=BROWSERBASE_API_KEY)

    async def _create_bb_session(self, tab_id: str, bb_context_id: str = None) -> str:
        """Create a Browserbase session and return its connect URL.

        If bb_context_id is provided, the session will use the persistent
        context (cookies/localStorage restored) and persist changes back.
        """
        bb = self._bb_client()

        create_kwargs = {"project_id": BROWSERBASE_PROJECT_ID}
        # Use a compact viewport so the live view is readable in split panels
        browser_settings: dict = {
            "viewport": {"width": 1024, "height": 768},
        }
        if bb_context_id:
            browser_settings["context"] = {
                "id": bb_context_id,
                "persist": True,
            }
        create_kwargs["browser_settings"] = browser_settings

        session = bb.sessions.create(**create_kwargs)
        self._sessions[tab_id] = session.id

        # Get live debug URLs
        try:
            debug = bb.sessions.debug(session.id)
            if debug.debugger_fullscreen_url:
                self._live_urls[tab_id] = debug.debugger_fullscreen_url
        except Exception as e:
            logger.warning("Failed to get live URL for session %s: %s", session.id, e)

        return session.connect_url

    def create_bb_context(self) -> str:
        """Create a new BrowserBase persistent context. Returns the context ID."""
        bb = self._bb_client()
        context = bb.contexts.create(project_id=BROWSERBASE_PROJECT_ID)
        return context.id

    def delete_bb_context(self, bb_context_id: str) -> None:
        """Delete a BrowserBase persistent context."""
        bb = self._bb_client()
        try:
            bb.contexts.delete(bb_context_id)
        except Exception as e:
            logger.warning("Failed to delete BB context %s: %s", bb_context_id, e)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def open_tab(self, tab_id: str, url: str = "about:blank", bb_context_id: str = None) -> dict:
        """Create a new browser tab. Returns {url, title}.

        If bb_context_id is provided (persistent context), the session will
        start with cookies/storage from that context already loaded.
        """
        async with self._global_lock:
            if len(self._pages) >= MAX_BROWSER_TABS:
                raise RuntimeError(f"Maximum browser tabs ({MAX_BROWSER_TABS}) reached")

            await self._ensure_playwright()

            if self.is_cloud:
                connect_url = await self._create_bb_session(tab_id, bb_context_id=bb_context_id)
                browser = await self._playwright.chromium.connect_over_cdp(connect_url)
                self._browsers_cdp[tab_id] = browser
                # Browserbase gives us one default page
                contexts = browser.contexts
                if contexts and contexts[0].pages:
                    page = contexts[0].pages[0]
                else:
                    ctx = contexts[0] if contexts else await browser.new_context()
                    page = await ctx.new_page()
            else:
                await self._ensure_local_browser()
                page = await self._browser.new_page()

            self._pages[tab_id] = page

        if url and url != "about:blank":
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            except Exception:
                pass

        title = await page.title()
        return {"url": page.url, "title": title}

    async def navigate(self, tab_id: str, url: str) -> dict:
        """Navigate a tab to a URL. Returns {url, title}."""
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
        page = self._get_page(tab_id)
        async with self._get_lock(tab_id):
            await page.click(selector, timeout=10000)
            await page.wait_for_load_state("domcontentloaded", timeout=5000)
            return {"clicked": selector, "url": page.url, "title": await page.title()}

    async def type_text(self, tab_id: str, selector: str, text: str, append: bool = False) -> dict:
        """Type text into an element. Handles both regular inputs and contenteditable.

        If append=True, moves cursor to the end of existing content before typing
        (useful for adding to contenteditable elements without overwriting).
        """
        page = self._get_page(tab_id)
        async with self._get_lock(tab_id):
            try:
                if append:
                    raise Exception("skip fill for append mode")
                await page.fill(selector, text, timeout=5000)
            except Exception:
                # Fallback for contenteditable elements: click then type via keyboard
                await page.click(selector, timeout=5000)
                if append:
                    # Move cursor to end of existing content
                    await page.keyboard.press("End")
                    await page.keyboard.press("Control+End")
                # Type in chunks to avoid overwhelming rich-text editors
                chunk_size = 200
                for i in range(0, len(text), chunk_size):
                    chunk = text[i:i + chunk_size]
                    await page.keyboard.type(chunk, delay=15)
                    # Brief pause between chunks for editor to process
                    await asyncio.sleep(0.1)
            return {"filled": selector, "text": text}

    async def press_key(self, tab_id: str, key: str) -> dict:
        """Press a keyboard key (e.g. 'Enter', 'Tab', 'End', 'Control+a')."""
        page = self._get_page(tab_id)
        async with self._get_lock(tab_id):
            await page.keyboard.press(key)
            return {"pressed": key}

    async def evaluate(self, tab_id: str, expression: str) -> dict:
        """Execute JavaScript in the page context and return the result."""
        page = self._get_page(tab_id)
        async with self._get_lock(tab_id):
            result = await page.evaluate(expression)
            return {"result": result}

    async def screenshot(self, tab_id: str) -> bytes:
        """Take a PNG screenshot of the tab."""
        page = self._get_page(tab_id)
        async with self._get_lock(tab_id):
            return await page.screenshot(type="png", full_page=False)

    async def snapshot(self, tab_id: str) -> str:
        """Get page content as a readable text snapshot."""
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

    async def close_tab(self, tab_id: str, session_id_hint: str = None) -> None:
        """Close a browser tab.  session_id_hint is used when the in-memory
        state is missing (serverless cold start) to still release the
        Browserbase session."""
        page = self._pages.pop(tab_id, None)
        self._locks.pop(tab_id, None)
        session_id = self._sessions.pop(tab_id, None) or session_id_hint
        self._live_urls.pop(tab_id, None)
        cdp_browser = self._browsers_cdp.pop(tab_id, None)

        if page:
            try:
                await page.close()
            except Exception:
                pass

        if cdp_browser:
            try:
                await cdp_browser.close()
            except Exception:
                pass

        # Stop Browserbase session
        if session_id and self.is_cloud:
            try:
                bb = self._bb_client()
                bb.sessions.update(session_id, status="REQUEST_RELEASE")
            except Exception as e:
                logger.warning("Failed to release BB session %s: %s", session_id, e)

    async def shutdown(self) -> None:
        """Close all tabs and the browser."""
        for tab_id in list(self._pages.keys()):
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

    async def reconnect(self, tab_id: str, session_id: str) -> None:
        """Reconnect to an existing Browserbase session via CDP.

        On serverless platforms (Vercel), each request may hit a fresh
        instance where _pages is empty.  This method re-establishes
        the CDP connection using the stored session_id so that
        screenshot/snapshot/navigate continue to work.
        """
        if tab_id in self._pages:
            return  # already connected

        if not self.is_cloud:
            raise KeyError(f"Cannot reconnect to local tab: {tab_id}")

        async with self._global_lock:
            # Double-check after acquiring lock
            if tab_id in self._pages:
                return

            await self._ensure_playwright()

            bb = self._bb_client()

            # Get a fresh connect URL for the existing session
            debug = bb.sessions.debug(session_id)
            connect_url = debug.ws_url
            if not connect_url:
                raise KeyError(f"Cannot reconnect — session {session_id} has no connect URL")

            browser = await self._playwright.chromium.connect_over_cdp(connect_url)
            self._browsers_cdp[tab_id] = browser
            self._sessions[tab_id] = session_id

            # Get the live URL
            if debug.debugger_fullscreen_url:
                self._live_urls[tab_id] = debug.debugger_fullscreen_url

            # Get the existing page
            contexts = browser.contexts
            if contexts and contexts[0].pages:
                page = contexts[0].pages[0]
            else:
                ctx = contexts[0] if contexts else await browser.new_context()
                page = await ctx.new_page()

            self._pages[tab_id] = page

    # ------------------------------------------------------------------
    # Accessors
    # ------------------------------------------------------------------

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
        """Return the Browserbase live view URL if available."""
        return self._live_urls.get(tab_id)

    def get_session_id(self, tab_id: str) -> Optional[str]:
        """Return the Browserbase session ID for a tab."""
        return self._sessions.get(tab_id)

    async def get_current_url(self, tab_id: str) -> Optional[dict]:
        """Return the current {url, title} from the live Playwright page, or None."""
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
        return len(self._pages)
