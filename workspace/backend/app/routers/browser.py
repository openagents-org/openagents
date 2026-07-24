# -*- coding: utf-8 -*-
"""
Shared browser endpoints — open, navigate, click, type, screenshot, snapshot.

POST   /v1/browser/tabs                       Open a new tab
GET    /v1/browser/tabs                       List active tabs
GET    /v1/browser/tabs/{tab_id}              Get tab info
POST   /v1/browser/tabs/{tab_id}/navigate     Navigate to URL
POST   /v1/browser/tabs/{tab_id}/click        Click element
POST   /v1/browser/tabs/{tab_id}/type         Type text (supports contenteditable append)
POST   /v1/browser/tabs/{tab_id}/press_key    Press a keyboard key
POST   /v1/browser/tabs/{tab_id}/evaluate     Execute JavaScript
GET    /v1/browser/tabs/{tab_id}/screenshot   Get PNG screenshot
GET    /v1/browser/tabs/{tab_id}/snapshot      Get accessibility tree
POST   /v1/browser/tabs/{tab_id}/share        Share with agent
DELETE /v1/browser/tabs/{tab_id}              Close tab
"""

import asyncio
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, Query
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.browser import BROWSERFABRIC_API_KEY, BrowserCapacityError, BrowserManager, BrowserNavigationError
from app.database import get_db
from app.models import BrowserContext, BrowserTab, BrowserUsage, Workspace
from app.response import ResponseCode, json_response, success_response
from app.routers.network import (
    _emit_event,
    _resolve_workspace,
    _verify_workspace_access,
)
from openagents.core.onm_events import Event

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/browser", tags=["Browser"])

# Per-workspace cap on concurrently open tabs. The process-wide
# MAX_BROWSER_TABS in app.browser remains as a server capacity backstop;
# this one is the quota agents actually hit, and it is enforced against the
# DB so it holds across workers/replicas.
MAX_TABS_PER_WORKSPACE = int(os.environ.get("MAX_TABS_PER_WORKSPACE", "5"))

# Tabs idle longer than this are closed by the background reaper.
BROWSER_TAB_IDLE_TTL_SECONDS = int(os.environ.get("BROWSER_TAB_IDLE_TTL_SECONDS", "600"))
BROWSER_REAPER_INTERVAL_SECONDS = int(os.environ.get("BROWSER_REAPER_INTERVAL_SECONDS", "60"))
# A tab claimed for closing (status "closing") whose remote close did not
# complete is retried by a later reaper pass once it has been stuck this long.
BROWSER_CLOSING_RETRY_AFTER_SECONDS = int(os.environ.get("BROWSER_CLOSING_RETRY_AFTER_SECONDS", "120"))
# Max tabs a single reaper pass claims, so one pass can't stall on a huge batch.
BROWSER_REAPER_BATCH = int(os.environ.get("BROWSER_REAPER_BATCH", "50"))


# ---------------------------------------------------------------------------
# Per-workspace BF API key resolution
# ---------------------------------------------------------------------------

async def _resolve_bf_key(workspace: Workspace, db: Session) -> Optional[str]:
    """Resolve the BF API key for a workspace.

    Priority:
      1. Custom key stored in workspace settings (user-provided)
      2. Auto-provisioned key stored in workspace settings
      3. Global BROWSERFABRIC_API_KEY env var (fallback)
      4. Auto-provision a new key from BF and store it
    """
    settings = workspace.settings or {}
    stored_key = settings.get("browserfabric_api_key")
    if stored_key:
        return stored_key

    if BROWSERFABRIC_API_KEY:
        return BROWSERFABRIC_API_KEY

    # Auto-provision from BF server
    new_key = await BrowserManager.provision_workspace_key(str(workspace.id))
    if new_key:
        current = dict(workspace.settings or {})
        current["browserfabric_api_key"] = new_key
        workspace.settings = current
        db.commit()
        logger.info("Auto-provisioned BF API key for workspace %s", workspace.id)
        return new_key

    return None


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class OpenTabRequest(BaseModel):
    url: Optional[str] = "about:blank"
    network: str
    source: Optional[str] = "human:user"
    context_id: Optional[str] = None          # open with a persistent context (already logged in)


class NavigateRequest(BaseModel):
    url: str


class ClickRequest(BaseModel):
    selector: str


class TypeRequest(BaseModel):
    selector: str
    text: str
    append: bool = False  # If True, move cursor to end before typing (for contenteditable)


class PressKeyRequest(BaseModel):
    key: str  # e.g. "Enter", "Tab", "End", "Control+a"


class EvaluateRequest(BaseModel):
    expression: str  # JavaScript to execute in page context


class ShareRequest(BaseModel):
    agent_name: str


class PersistTabRequest(BaseModel):
    name: str                                  # user-provided label, e.g. "LinkedIn Account"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _tab_to_dict(tab: BrowserTab, context_name: str = None) -> dict:
    d = {
        "id": tab.id,
        "url": tab.url,
        "title": tab.title,
        "status": tab.status,
        "created_by": tab.created_by,
        "shared_with": tab.shared_with or [],
        "created_at": tab.created_at.isoformat() if tab.created_at else None,
        "last_active_at": tab.last_active_at.isoformat() if tab.last_active_at else None,
    }
    if tab.live_url:
        d["live_url"] = tab.live_url
    if tab.session_id:
        d["session_id"] = tab.session_id
    if tab.context_id:
        d["context_id"] = tab.context_id
        d["persistent"] = True
        if context_name:
            d["context_name"] = context_name
    else:
        d["persistent"] = False
    return d


def _context_to_dict(ctx: BrowserContext) -> dict:
    return {
        "id": ctx.id,
        "name": ctx.name,
        "domain": ctx.domain,
        "status": ctx.status,
        "created_by": ctx.created_by,
        "shared_with": ctx.shared_with or [],
        "created_at": ctx.created_at.isoformat() if ctx.created_at else None,
        "last_used_at": ctx.last_used_at.isoformat() if ctx.last_used_at else None,
    }


def _get_tab(db: Session, tab_id: str) -> Optional[BrowserTab]:
    return db.execute(
        select(BrowserTab).where(BrowserTab.id == tab_id)
    ).scalar_one_or_none()


def _touch(tab: BrowserTab):
    tab.last_active_at = datetime.now(timezone.utc)


def _tab_idle_seconds(tab: BrowserTab) -> Optional[int]:
    last = tab.last_active_at or tab.created_at
    if not last:
        return None
    if last.tzinfo is None:  # SQLite stores naive datetimes
        last = last.replace(tzinfo=timezone.utc)
    return max(0, int((datetime.now(timezone.utc) - last).total_seconds()))


async def _ensure_connected(tab: BrowserTab, db: Session = None, workspace: Workspace = None) -> None:
    """Ensure the browser tab has a live Playwright page.

    Handles three cases:
    1. Page already in memory → no-op.
    2. Page missing (serverless cold start) but session alive → reconnect via CDP.
    3. Session expired/dead → create a brand-new session (preserving persistent
       context cookies if available) and update the tab record.

    After (re)connecting, syncs the live page URL/title back to the tab record
    so the DB reflects any in-iframe navigation that happened.
    """
    manager = BrowserManager.get()
    if tab.id in manager._pages:
        # Page in memory — but the CDP connection may be dead.  Do a quick
        # liveness check so we don't hand back a zombie page.
        try:
            page = manager._pages[tab.id]
            await page.title()  # lightweight CDP call
            return
        except Exception:
            logger.warning("Tab %s has a stale page object — will recreate session", tab.id)
            # Fall through to session recreation below
            manager._pages.pop(tab.id, None)
            manager._locks.pop(tab.id, None)
            manager._sessions.pop(tab.id, None)
            manager._live_urls.pop(tab.id, None)

    if not tab.session_id and not manager.is_cloud:
        return  # local mode, nothing to reconnect to

    # --- Try reconnecting to the existing session first ---
    if tab.session_id:
        try:
            await manager.reconnect(tab.id, tab.session_id)
            # Sync URL/title from the live page
            live = await manager.get_current_url(tab.id)
            if live:
                if live["url"] and live["url"] != tab.url:
                    tab.url = live["url"]
                if live["title"] and live["title"] != tab.title:
                    tab.title = live["title"]
                return
            # live is None — session is dead on BF side, fall through to recreate
            logger.info("Session %s appears dead (get_current_url returned None), will recreate", tab.session_id)
            manager._sessions.pop(tab.id, None)
            manager._live_urls.pop(tab.id, None)
        except Exception as e:
            logger.info("Reconnect failed for tab %s (session %s), will create new session: %s",
                        tab.id, tab.session_id, e)

    # --- Session is dead — create a fresh one ---
    # Clean up old session (best-effort)
    try:
        await manager.close_tab(tab.id, session_id_hint=tab.session_id)
    except Exception:
        pass

    # Resolve persistent context (cookies/localStorage) if available
    bb_context_id = None
    if tab.context_id and db:
        ctx = db.execute(
            select(BrowserContext)
            .where(BrowserContext.id == tab.context_id)
            .where(BrowserContext.status == "active")
        ).scalar_one_or_none()
        if ctx:
            bb_context_id = ctx.bb_context_id

    bf_key = await _resolve_bf_key(workspace, db) if workspace and db else None
    result = await manager.open_tab(tab.id, tab.url or "about:blank", bb_context_id=bb_context_id, api_key=bf_key)

    # Update the tab record with the new session info
    tab.session_id = manager.get_session_id(tab.id)
    tab.live_url = manager.get_live_url(tab.id)
    tab.url = result.get("url", tab.url)
    tab.title = result.get("title", tab.title)
    _touch(tab)
    logger.info("Tab %s auto-reconnected with new session %s", tab.id, tab.session_id)


# ---------------------------------------------------------------------------
# POST /v1/browser/tabs — open new tab
# ---------------------------------------------------------------------------

@router.post("/tabs")
async def open_tab(
    body: OpenTabRequest,
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    workspace = _resolve_workspace(db, body.network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    # Resolve persistent context if requested
    bb_context_id = None
    context_record = None
    if body.context_id:
        context_record = db.execute(
            select(BrowserContext)
            .where(BrowserContext.id == body.context_id)
            .where(BrowserContext.workspace_id == str(workspace.id))
            .where(BrowserContext.status == "active")
        ).scalar_one_or_none()
        if not context_record:
            return json_response(ResponseCode.NOT_FOUND, "Browser context not found")
        bb_context_id = context_record.bb_context_id

        # Prevent duplicate tabs for the same persistent context
        existing_tab = db.execute(
            select(BrowserTab)
            .where(BrowserTab.context_id == body.context_id)
            .where(BrowserTab.workspace_id == str(workspace.id))
            .where(BrowserTab.status == "active")
        ).scalar_one_or_none()
        if existing_tab:
            return json_response(
                ResponseCode.BAD_REQUEST,
                f"A tab for persistent context '{context_record.name}' is already open (tab {existing_tab.id})",
            )

    tab_id = str(uuid.uuid4())
    manager = BrowserManager.get()

    bf_key = await _resolve_bf_key(workspace, db)

    # Per-workspace quota. The workspace row lock serializes concurrent opens
    # (across workers too — the DB is shared), and inserting the tab record
    # before the slow session creation reserves the slot, so the check can't
    # be raced past. with_for_update is a no-op on SQLite (single writer).
    db.execute(
        select(Workspace.id).where(Workspace.id == workspace.id).with_for_update()
    ).scalar_one()
    active_tabs = db.execute(
        select(BrowserTab)
        .where(BrowserTab.workspace_id == str(workspace.id))
        .where(BrowserTab.status == "active")
    ).scalars().all()
    if len(active_tabs) >= MAX_TABS_PER_WORKSPACE:
        occupancy = [
            {
                "tab_id": t.id,
                "url": t.url,
                "created_by": t.created_by,
                "idle_seconds": _tab_idle_seconds(t),
            }
            for t in active_tabs
        ]
        db.rollback()
        return json_response(
            ResponseCode.BAD_REQUEST,
            f"Workspace browser tab limit ({MAX_TABS_PER_WORKSPACE}) reached",
            data={
                "error_code": "BROWSER_QUOTA_EXCEEDED",
                "open_tabs": occupancy,
                "hint": (
                    "Close a tab you no longer need (DELETE /v1/browser/tabs/{tab_id}) and retry. "
                    f"Idle tabs are auto-closed after {BROWSER_TAB_IDLE_TTL_SECONDS // 60} minutes."
                ),
            },
        )

    record = BrowserTab(
        id=tab_id,
        workspace_id=str(workspace.id),
        url=body.url or "about:blank",
        created_by=body.source or "human:user",
        shared_with=[],
        context_id=body.context_id,
    )
    db.add(record)
    db.commit()  # releases the lock; this row now holds the quota slot

    try:
        result = await manager.open_tab(tab_id, body.url or "about:blank", bb_context_id=bb_context_id, api_key=bf_key)
    except BrowserCapacityError as e:
        # Global per-process backstop, distinct from the workspace quota above.
        record.status = "closed"
        db.commit()
        return json_response(
            ResponseCode.INTERNAL_ERROR,
            str(e),
            data={"error_code": "BROWSER_CAPACITY", "retryable": True},
            status_code=503,
        )
    except RuntimeError as e:
        record.status = "closed"
        db.commit()
        return json_response(ResponseCode.BAD_REQUEST, str(e))
    except Exception as e:
        logger.error("Failed to open browser tab: %s", e)
        record.status = "closed"
        db.commit()
        return json_response(ResponseCode.INTERNAL_ERROR, "Failed to open browser tab")

    # Update context last_used_at
    if context_record:
        context_record.last_used_at = datetime.now(timezone.utc)

    record.url = result.get("url", body.url or "about:blank")
    record.title = result.get("title")
    record.session_id = manager.get_session_id(tab_id)
    record.live_url = manager.get_live_url(tab_id)

    # Track usage
    usage = BrowserUsage(
        workspace_id=str(workspace.id),
        tab_id=tab_id,
        session_id=manager.get_session_id(tab_id),
        opened_by=body.source or "human:user",
    )
    db.add(usage)
    db.commit()

    event = Event(
        type="workspace.browser.tab.opened",
        source=body.source or "human:user",
        target="core",
        payload={"tab_id": tab_id, "url": record.url},
    )
    await _emit_event(event, workspace, db, token=x_workspace_token or workspace.password_hash)

    data = _tab_to_dict(record)
    if result.get("navigation_error"):
        data["navigation_error"] = result["navigation_error"]
    return success_response(data)


# ---------------------------------------------------------------------------
# GET /v1/browser/tabs — list tabs
# ---------------------------------------------------------------------------

@router.get("/tabs")
async def list_tabs(
    network: str = Query(..., description="Network (workspace) ID or slug"),
    status: str = Query("active"),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    workspace = _resolve_workspace(db, network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    rows = db.execute(
        select(BrowserTab)
        .where(BrowserTab.workspace_id == str(workspace.id))
        .where(BrowserTab.status == status)
        .order_by(BrowserTab.last_active_at.desc())
    ).scalars().all()

    # Sync current URL/title from live Playwright pages (catches in-iframe navigation)
    manager = BrowserManager.get()
    dirty = False
    for tab in rows:
        live = await manager.get_current_url(tab.id)
        if live:
            if live["url"] and live["url"] != tab.url:
                tab.url = live["url"]
                dirty = True
            if live["title"] and live["title"] != tab.title:
                tab.title = live["title"]
                dirty = True
    if dirty:
        db.commit()

    # Build a map of context_id → name for persistent tabs
    context_ids = [t.context_id for t in rows if t.context_id]
    context_names = {}
    if context_ids:
        contexts = db.execute(
            select(BrowserContext.id, BrowserContext.name)
            .where(BrowserContext.id.in_(context_ids))
        ).all()
        context_names = {c.id: c.name for c in contexts}

    return success_response({
        "tabs": [_tab_to_dict(t, context_name=context_names.get(t.context_id)) for t in rows],
        "total": len(rows),
    })


# ---------------------------------------------------------------------------
# GET /v1/browser/tabs/{tab_id} — get tab info
# ---------------------------------------------------------------------------

@router.get("/tabs/{tab_id}")
async def get_tab(
    tab_id: str,
    validate: bool = False,
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    tab = _get_tab(db, tab_id)
    if not tab or tab.status != "active":
        return json_response(ResponseCode.NOT_FOUND, "Tab not found")

    workspace = _resolve_workspace(db, str(tab.workspace_id))
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    if validate:
        try:
            await _ensure_connected(tab, db, workspace)
            db.commit()
        except Exception as e:
            logger.warning("Tab %s validation/reconnect failed: %s", tab_id, e)

    return success_response(_tab_to_dict(tab))


# ---------------------------------------------------------------------------
# POST /v1/browser/tabs/{tab_id}/navigate
# ---------------------------------------------------------------------------

@router.post("/tabs/{tab_id}/navigate")
async def navigate_tab(
    tab_id: str,
    body: NavigateRequest,
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    tab = _get_tab(db, tab_id)
    if not tab or tab.status != "active":
        return json_response(ResponseCode.NOT_FOUND, "Tab not found")

    workspace = _resolve_workspace(db, str(tab.workspace_id))
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    await _ensure_connected(tab, db, workspace)
    manager = BrowserManager.get()
    try:
        result = await manager.navigate(tab_id, body.url)
    except KeyError:
        return json_response(ResponseCode.NOT_FOUND, "Browser tab not found in browser")
    except BrowserNavigationError as e:
        db.commit()  # keep any reconnect bookkeeping from _ensure_connected
        return json_response(
            ResponseCode.BAD_REQUEST,
            f"Navigation failed ({e.code}): {e}",
            data={"error_code": e.code, "url": body.url},
        )
    except Exception as e:
        logger.error("Navigate failed: %s", e)
        return json_response(ResponseCode.INTERNAL_ERROR, "Navigation failed")

    tab.url = result.get("url", body.url)
    tab.title = result.get("title")
    _touch(tab)

    event = Event(
        type="workspace.browser.tab.navigated",
        source="system",
        target="core",
        payload={"tab_id": tab_id, "url": tab.url, "title": tab.title},
    )
    await _emit_event(event, workspace, db, token=x_workspace_token or workspace.password_hash)

    return success_response(_tab_to_dict(tab))


# ---------------------------------------------------------------------------
# POST /v1/browser/tabs/{tab_id}/reconnect — create new session for expired tab
# ---------------------------------------------------------------------------

@router.post("/tabs/{tab_id}/reconnect")
async def reconnect_tab(
    tab_id: str,
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    tab = _get_tab(db, tab_id)
    if not tab or tab.status != "active":
        return json_response(ResponseCode.NOT_FOUND, "Tab not found")

    workspace = _resolve_workspace(db, str(tab.workspace_id))
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    manager = BrowserManager.get()

    # Close old session gracefully (ignore errors — it's likely already dead)
    try:
        await manager.close_tab(tab_id, session_id_hint=tab.session_id)
    except Exception:
        pass

    # Resolve persistent context if any
    bb_context_id = None
    if tab.context_id:
        ctx = db.execute(
            select(BrowserContext)
            .where(BrowserContext.id == tab.context_id)
            .where(BrowserContext.status == "active")
        ).scalar_one_or_none()
        if ctx:
            bb_context_id = ctx.bb_context_id

    # Create a new session
    bf_key = await _resolve_bf_key(workspace, db)
    try:
        result = await manager.open_tab(tab_id, tab.url or "about:blank", bb_context_id=bb_context_id, api_key=bf_key)
    except Exception as e:
        logger.error("Reconnect failed: %s", e)
        return json_response(ResponseCode.INTERNAL_ERROR, "Failed to reconnect browser tab")

    # Update DB record
    tab.session_id = manager.get_session_id(tab_id)
    tab.live_url = manager.get_live_url(tab_id)
    tab.url = result.get("url", tab.url)
    tab.title = result.get("title", tab.title)
    _touch(tab)
    db.commit()

    return success_response(_tab_to_dict(tab))


# ---------------------------------------------------------------------------
# POST /v1/browser/tabs/{tab_id}/click
# ---------------------------------------------------------------------------

@router.post("/tabs/{tab_id}/click")
async def click_tab(
    tab_id: str,
    body: ClickRequest,
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    tab = _get_tab(db, tab_id)
    if not tab or tab.status != "active":
        return json_response(ResponseCode.NOT_FOUND, "Tab not found")

    workspace = _resolve_workspace(db, str(tab.workspace_id))
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    await _ensure_connected(tab, db, workspace)
    manager = BrowserManager.get()
    try:
        result = await manager.click(tab_id, body.selector)
    except KeyError:
        return json_response(ResponseCode.NOT_FOUND, "Browser tab not found in browser")
    except Exception as e:
        logger.error("Click failed: %s", e)
        return json_response(ResponseCode.INTERNAL_ERROR, f"Click failed: {e}")

    tab.url = result.get("url", tab.url)
    tab.title = result.get("title", tab.title)
    _touch(tab)
    db.flush()

    return success_response({"tab_id": tab_id, "clicked": body.selector, "url": tab.url})


# ---------------------------------------------------------------------------
# POST /v1/browser/tabs/{tab_id}/type
# ---------------------------------------------------------------------------

@router.post("/tabs/{tab_id}/type")
async def type_in_tab(
    tab_id: str,
    body: TypeRequest,
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    tab = _get_tab(db, tab_id)
    if not tab or tab.status != "active":
        return json_response(ResponseCode.NOT_FOUND, "Tab not found")

    workspace = _resolve_workspace(db, str(tab.workspace_id))
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    await _ensure_connected(tab, db, workspace)
    manager = BrowserManager.get()
    try:
        await manager.type_text(tab_id, body.selector, body.text, append=body.append)
    except KeyError:
        return json_response(ResponseCode.NOT_FOUND, "Browser tab not found in browser")
    except Exception as e:
        logger.error("Type failed: %s", e)
        return json_response(ResponseCode.INTERNAL_ERROR, f"Type failed: {e}")

    _touch(tab)
    db.flush()

    return success_response({"tab_id": tab_id, "typed": body.selector})


# ---------------------------------------------------------------------------
# POST /v1/browser/tabs/{tab_id}/press_key
# ---------------------------------------------------------------------------

@router.post("/tabs/{tab_id}/press_key")
async def press_key_in_tab(
    tab_id: str,
    body: PressKeyRequest,
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    tab = _get_tab(db, tab_id)
    if not tab or tab.status != "active":
        return json_response(ResponseCode.NOT_FOUND, "Tab not found")

    workspace = _resolve_workspace(db, str(tab.workspace_id))
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    await _ensure_connected(tab, db, workspace)
    manager = BrowserManager.get()
    try:
        await manager.press_key(tab_id, body.key)
    except KeyError:
        return json_response(ResponseCode.NOT_FOUND, "Browser tab not found in browser")
    except Exception as e:
        logger.error("Press key failed: %s", e)
        return json_response(ResponseCode.INTERNAL_ERROR, f"Press key failed: {e}")

    _touch(tab)
    db.flush()

    return success_response({"tab_id": tab_id, "pressed": body.key})


# ---------------------------------------------------------------------------
# POST /v1/browser/tabs/{tab_id}/evaluate
# ---------------------------------------------------------------------------

@router.post("/tabs/{tab_id}/evaluate")
async def evaluate_in_tab(
    tab_id: str,
    body: EvaluateRequest,
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    tab = _get_tab(db, tab_id)
    if not tab or tab.status != "active":
        return json_response(ResponseCode.NOT_FOUND, "Tab not found")

    workspace = _resolve_workspace(db, str(tab.workspace_id))
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    await _ensure_connected(tab, db, workspace)
    manager = BrowserManager.get()
    try:
        result = await manager.evaluate(tab_id, body.expression)
    except KeyError:
        return json_response(ResponseCode.NOT_FOUND, "Browser tab not found in browser")
    except Exception as e:
        logger.error("Evaluate failed: %s", e)
        return json_response(ResponseCode.INTERNAL_ERROR, f"Evaluate failed: {e}")

    _touch(tab)
    db.flush()

    return success_response({"tab_id": tab_id, "result": result.get("result")})


# ---------------------------------------------------------------------------
# GET /v1/browser/tabs/{tab_id}/screenshot
# ---------------------------------------------------------------------------

@router.get("/tabs/{tab_id}/screenshot")
async def get_screenshot(
    tab_id: str,
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    tab = _get_tab(db, tab_id)
    if not tab or tab.status != "active":
        return json_response(ResponseCode.NOT_FOUND, "Tab not found")

    workspace = _resolve_workspace(db, str(tab.workspace_id))
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    await _ensure_connected(tab, db, workspace)
    manager = BrowserManager.get()
    try:
        data = await manager.screenshot(tab_id)
    except KeyError:
        return json_response(ResponseCode.NOT_FOUND, "Browser tab not found in browser")
    except Exception as e:
        logger.error("Screenshot failed: %s", e)
        return json_response(ResponseCode.INTERNAL_ERROR, "Screenshot failed")

    # A successful read is activity — refresh idle time so the reaper does
    # not close a tab an agent (or a human via live_url) is actively reading.
    _touch(tab)
    # Sync current URL/title from live page back to DB (catches in-iframe navigation)
    live = await manager.get_current_url(tab_id)
    if live:
        if live["url"] and live["url"] != tab.url:
            tab.url = live["url"]
        if live["title"] and live["title"] != tab.title:
            tab.title = live["title"]
    db.commit()

    return Response(
        content=data,
        media_type="image/png",
        headers={"Cache-Control": "no-cache, no-store"},
    )


# ---------------------------------------------------------------------------
# GET /v1/browser/tabs/{tab_id}/snapshot
# ---------------------------------------------------------------------------

@router.get("/tabs/{tab_id}/snapshot")
async def get_snapshot(
    tab_id: str,
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    tab = _get_tab(db, tab_id)
    if not tab or tab.status != "active":
        return json_response(ResponseCode.NOT_FOUND, "Tab not found")

    workspace = _resolve_workspace(db, str(tab.workspace_id))
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    await _ensure_connected(tab, db, workspace)
    manager = BrowserManager.get()
    try:
        tree = await manager.snapshot(tab_id)
    except KeyError:
        return json_response(ResponseCode.NOT_FOUND, "Browser tab not found in browser")
    except Exception as e:
        logger.error("Snapshot failed: %s", e)
        return json_response(ResponseCode.INTERNAL_ERROR, "Snapshot failed")

    # Reading the page is activity — refresh idle time so the reaper does not
    # close a tab that is being actively read (snapshot is the main read op).
    _touch(tab)
    db.commit()

    return Response(content=tree, media_type="text/plain")


# ---------------------------------------------------------------------------
# POST /v1/browser/tabs/{tab_id}/share
# ---------------------------------------------------------------------------

@router.post("/tabs/{tab_id}/share")
def share_tab(
    tab_id: str,
    body: ShareRequest,
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    tab = _get_tab(db, tab_id)
    if not tab or tab.status != "active":
        return json_response(ResponseCode.NOT_FOUND, "Tab not found")

    workspace = _resolve_workspace(db, str(tab.workspace_id))
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    shared = list(tab.shared_with or [])
    if body.agent_name not in shared:
        shared.append(body.agent_name)
        tab.shared_with = shared
    db.flush()

    return success_response(_tab_to_dict(tab))


# ---------------------------------------------------------------------------
# POST /v1/browser/tabs/{tab_id}/persist — mark tab as persistent
# ---------------------------------------------------------------------------

@router.post("/tabs/{tab_id}/persist")
async def persist_tab(
    tab_id: str,
    body: PersistTabRequest,
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """Mark a browser tab as persistent.

    Creates a BrowserBase context from the current session so that
    cookies/localStorage are preserved across tab close/reopen cycles.
    The user must provide a name (e.g. "LinkedIn Account").
    """
    tab = _get_tab(db, tab_id)
    if not tab or tab.status != "active":
        return json_response(ResponseCode.NOT_FOUND, "Tab not found")

    workspace = _resolve_workspace(db, str(tab.workspace_id))
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    if tab.context_id:
        return json_response(ResponseCode.BAD_REQUEST, "Tab is already persistent")

    # Check for duplicate name in this workspace
    existing = db.execute(
        select(BrowserContext)
        .where(BrowserContext.workspace_id == str(workspace.id))
        .where(BrowserContext.name == body.name)
        .where(BrowserContext.status == "active")
    ).scalar_one_or_none()
    if existing:
        return json_response(ResponseCode.BAD_REQUEST, f"A persistent context named '{body.name}' already exists")

    # Extract domain from current tab URL
    domain = None
    try:
        from urllib.parse import urlparse
        parsed = urlparse(tab.url)
        if parsed.hostname:
            domain = parsed.hostname
    except Exception:
        pass

    # Save current session state and create persistent context
    manager = BrowserManager.get()
    bb_context_id = None
    if manager.is_cloud:
        try:
            await _ensure_connected(tab, db, workspace)
            bb_context_id = await manager.create_bb_context(session_id=tab.session_id)
        except Exception as e:
            logger.error("Failed to create persistent context: %s", e)
            return json_response(ResponseCode.INTERNAL_ERROR, "Failed to create persistent context")

    # Close the current session and reopen with the context so that
    # future sessions restore cookies/localStorage from the saved state.
    if manager.is_cloud and tab.session_id:
        try:
            current_url = tab.url
            await manager.close_tab(tab_id, session_id_hint=tab.session_id)
            result = await manager.open_tab(tab_id, current_url, bb_context_id=bb_context_id)
            tab.session_id = manager.get_session_id(tab_id)
            tab.live_url = manager.get_live_url(tab_id)
            tab.url = result.get("url", current_url)
            tab.title = result.get("title", tab.title)
        except Exception as e:
            logger.warning("Could not swap session for context (will activate on next open): %s", e)

    context = BrowserContext(
        workspace_id=str(workspace.id),
        name=body.name,
        bb_context_id=bb_context_id,
        domain=domain,
        created_by=tab.created_by,
        shared_with=tab.shared_with or [],
    )
    db.add(context)
    db.flush()

    tab.context_id = context.id
    _touch(tab)

    event = Event(
        type="workspace.browser.context.created",
        source=tab.created_by,
        target="core",
        payload={"context_id": context.id, "name": body.name, "tab_id": tab_id, "domain": domain},
    )
    await _emit_event(event, workspace, db, token=x_workspace_token or workspace.password_hash)

    return success_response({
        "tab": _tab_to_dict(tab),
        "context": _context_to_dict(context),
    })


# ---------------------------------------------------------------------------
# POST /v1/browser/tabs/{tab_id}/unpersist — remove persistent state
# ---------------------------------------------------------------------------

@router.post("/tabs/{tab_id}/unpersist")
async def unpersist_tab(
    tab_id: str,
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """Remove persistent state from a browser tab.

    Deletes the associated BrowserBase context and reverts the tab
    to a regular (temporal) tab.
    """
    tab = _get_tab(db, tab_id)
    if not tab or tab.status != "active":
        return json_response(ResponseCode.NOT_FOUND, "Tab not found")

    workspace = _resolve_workspace(db, str(tab.workspace_id))
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    if not tab.context_id:
        return json_response(ResponseCode.BAD_REQUEST, "Tab is not persistent")

    # Find and delete the context
    ctx = db.execute(
        select(BrowserContext).where(BrowserContext.id == tab.context_id)
    ).scalar_one_or_none()

    if ctx:
        # Delete BrowserBase context
        if ctx.bb_context_id:
            manager = BrowserManager.get()
            manager.delete_bb_context(ctx.bb_context_id)
        ctx.status = "deleted"

    tab.context_id = None
    _touch(tab)

    event = Event(
        type="workspace.browser.context.deleted",
        source="system",
        target="core",
        payload={"tab_id": tab_id, "context_name": ctx.name if ctx else None},
    )
    await _emit_event(event, workspace, db, token=x_workspace_token or workspace.password_hash)

    return success_response(_tab_to_dict(tab))


# ---------------------------------------------------------------------------
# GET /v1/browser/contexts — list persistent contexts
# ---------------------------------------------------------------------------

@router.get("/contexts")
def list_contexts(
    network: str = Query(..., description="Network (workspace) ID or slug"),
    status: str = Query("active"),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    workspace = _resolve_workspace(db, network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    rows = db.execute(
        select(BrowserContext)
        .where(BrowserContext.workspace_id == str(workspace.id))
        .where(BrowserContext.status == status)
        .order_by(BrowserContext.last_used_at.desc())
    ).scalars().all()

    return success_response({
        "contexts": [_context_to_dict(c) for c in rows],
        "total": len(rows),
    })


# ---------------------------------------------------------------------------
# DELETE /v1/browser/contexts/{context_id} — delete persistent context
# ---------------------------------------------------------------------------

@router.delete("/contexts/{context_id}")
async def delete_context(
    context_id: str,
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    ctx = db.execute(
        select(BrowserContext).where(BrowserContext.id == context_id)
    ).scalar_one_or_none()
    if not ctx:
        return json_response(ResponseCode.NOT_FOUND, "Context not found")

    workspace = _resolve_workspace(db, str(ctx.workspace_id))
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    # Delete BrowserBase context
    if ctx.bb_context_id:
        manager = BrowserManager.get()
        manager.delete_bb_context(ctx.bb_context_id)

    # Unlink any tabs using this context
    tabs = db.execute(
        select(BrowserTab).where(BrowserTab.context_id == context_id)
    ).scalars().all()
    for tab in tabs:
        tab.context_id = None

    ctx.status = "deleted"

    event = Event(
        type="workspace.browser.context.deleted",
        source="system",
        target="core",
        payload={"context_id": context_id, "name": ctx.name},
    )
    await _emit_event(event, workspace, db, token=x_workspace_token or workspace.password_hash)

    return success_response({"id": context_id, "status": "deleted"})


# ---------------------------------------------------------------------------
# DELETE /v1/browser/tabs/{tab_id} — close tab
# ---------------------------------------------------------------------------

class RemoteCloseError(RuntimeError):
    """The browser session's remote close failed; the tab must not be marked
    closed so a later reaper pass can retry it."""


def _stored_bf_key(workspace: Workspace) -> Optional[str]:
    """Resolve the workspace's BF key WITHOUT auto-provisioning (read-only).

    Used when closing a session, possibly from a worker that did not open it,
    so the close uses the same key the session was created with rather than
    falling back to the global key (which would fail for provisioned keys).
    """
    settings = workspace.settings or {}
    return settings.get("browserfabric_api_key") or BROWSERFABRIC_API_KEY or None


async def _finalize_close(
    db: Session,
    workspace: Workspace,
    tab: BrowserTab,
    token: Optional[str] = None,
    reason: Optional[str] = None,
    require_remote: bool = False,
) -> bool:
    """Close a tab: release the browser session, then mark record, finalize
    usage, emit the closed event. Shared by the DELETE route and the idle reaper.
    Returns whether the tab had a persistent context.

    If `require_remote` and the remote close fails, raises RemoteCloseError
    BEFORE any DB change, so the caller can leave the row for retry instead of
    recording a close that did not actually happen (the reaper needs this; the
    interactive DELETE is best-effort so a user's tab always leaves their list).
    """
    manager = BrowserManager.get()
    bf_key = _stored_bf_key(workspace)
    remote_ok = await manager.close_tab(tab.id, session_id_hint=tab.session_id, api_key=bf_key)
    if not remote_ok and require_remote:
        raise RemoteCloseError(f"remote close failed for tab {tab.id}")

    tab.status = "closed"

    # Finalize usage record
    usage = db.execute(
        select(BrowserUsage)
        .where(BrowserUsage.tab_id == tab.id)
        .where(BrowserUsage.ended_at.is_(None))
    ).scalar_one_or_none()
    if usage:
        now = datetime.now(timezone.utc)
        usage.ended_at = now
        if usage.started_at:
            started = usage.started_at
            # Ensure both are offset-aware for subtraction (SQLite may store naive)
            if started.tzinfo is None:
                started = started.replace(tzinfo=timezone.utc)
            usage.duration_seconds = int((now - started).total_seconds())

    # If the tab has a persistent context, BrowserBase will auto-save
    # cookies/storage back to the context when the session ends (persist=True).
    # The context itself survives — only the session is released.
    is_persistent = bool(tab.context_id)

    payload = {"tab_id": tab.id}
    if reason:
        payload["reason"] = reason
    if is_persistent:
        payload["context_id"] = tab.context_id
        payload["persistent"] = True

    event = Event(
        type="workspace.browser.tab.closed",
        source="system",
        target="core",
        payload=payload,
    )
    await _emit_event(event, workspace, db, token=token or workspace.password_hash)
    return is_persistent


@router.delete("/tabs/{tab_id}")
async def close_tab(
    tab_id: str,
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    tab = _get_tab(db, tab_id)
    if not tab or tab.status != "active":
        return json_response(ResponseCode.NOT_FOUND, "Tab not found")

    workspace = _resolve_workspace(db, str(tab.workspace_id))
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    is_persistent = await _finalize_close(db, workspace, tab, token=x_workspace_token)

    return success_response({"id": tab_id, "status": "closed", "context_preserved": is_persistent})


# ---------------------------------------------------------------------------
# GET /v1/browser/usage — usage summary
# ---------------------------------------------------------------------------

@router.get("/usage")
def get_usage(
    network: str = Query(..., description="Network (workspace) ID or slug"),
    days: int = Query(30, description="Number of days to look back"),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """Browser usage summary: total minutes per user, with cost estimate."""
    workspace = _resolve_workspace(db, network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    # Per-source aggregation (who opened the tab)
    rows = db.execute(
        select(
            BrowserUsage.opened_by,
            func.count(BrowserUsage.id).label("sessions"),
            func.coalesce(func.sum(BrowserUsage.duration_seconds), 0).label("total_seconds"),
        )
        .where(BrowserUsage.workspace_id == str(workspace.id))
        .where(BrowserUsage.started_at >= cutoff)
        .group_by(BrowserUsage.opened_by)
        .order_by(func.sum(BrowserUsage.duration_seconds).desc())
    ).all()

    # Also count currently active (no ended_at)
    active_count = db.execute(
        select(func.count(BrowserUsage.id))
        .where(BrowserUsage.workspace_id == str(workspace.id))
        .where(BrowserUsage.ended_at.is_(None))
    ).scalar() or 0

    breakdown = []
    total_seconds = 0
    for row in rows:
        secs = int(row.total_seconds)
        total_seconds += secs
        breakdown.append({
            "opened_by": row.opened_by,
            "sessions": row.sessions,
            "total_seconds": secs,
            "total_minutes": round(secs / 60, 1),
            "total_hours": round(secs / 3600, 2),
        })

    total_hours = round(total_seconds / 3600, 2)
    # Developer plan: 100 free hours, then $0.12/hour
    free_hours = 100.0
    billable_hours = max(0, total_hours - free_hours)
    estimated_cost = round(billable_hours * 0.12, 2)

    return success_response({
        "period_days": days,
        "active_sessions": active_count,
        "total_seconds": total_seconds,
        "total_minutes": round(total_seconds / 60, 1),
        "total_hours": total_hours,
        "free_hours_remaining": round(max(0, free_hours - total_hours), 2),
        "billable_hours": billable_hours,
        "estimated_cost_usd": estimated_cost,
        "breakdown": breakdown,
    })


# ---------------------------------------------------------------------------
# Idle-tab reaper — abandoned tabs used to hold quota slots (and BF sessions)
# forever; dead sessions were only pruned lazily once the cap was hit.
# ---------------------------------------------------------------------------

async def reap_idle_tabs(session_factory=None) -> int:
    """Close tabs idle past BROWSER_TAB_IDLE_TTL_SECONDS.

    Runs on every worker. To stay correct with several workers hitting the
    same rows, it claims each tab atomically before doing any remote work:

      1. SELECT ... FOR UPDATE SKIP LOCKED the eligible rows (idle-active, or
         a "closing" tab whose remote close stalled) so no two workers grab
         the same row.
      2. Flip status active/closing → "closing" and bump last_active_at, then
         COMMIT. The claim is now visible and the row lock is released, so a
         sibling worker's query skips it for BROWSER_CLOSING_RETRY_AFTER_SECONDS.
      3. Only then perform the remote BF close + emit the closed event + finalize
         usage. If that fails the row stays "closing" and a later pass retries
         it — nothing is marked "closed" until the remote close succeeds.

    SKIP LOCKED / FOR UPDATE are no-ops on SQLite (single writer), which is
    fine for tests.
    """
    if session_factory is None:
        from app.database import SessionLocal
        session_factory = SessionLocal

    db = session_factory()
    closed = 0
    try:
        now = datetime.now(timezone.utc)
        idle_cutoff = now - timedelta(seconds=BROWSER_TAB_IDLE_TTL_SECONDS)
        closing_retry_cutoff = now - timedelta(seconds=BROWSER_CLOSING_RETRY_AFTER_SECONDS)

        rows = db.execute(
            select(BrowserTab)
            .where(
                or_(
                    and_(BrowserTab.status == "active", BrowserTab.last_active_at < idle_cutoff),
                    and_(BrowserTab.status == "closing", BrowserTab.last_active_at < closing_retry_cutoff),
                )
            )
            .order_by(BrowserTab.last_active_at.asc())
            .limit(BROWSER_REAPER_BATCH)
            .with_for_update(skip_locked=True)
        ).scalars().all()

        # Claim the batch first (status → "closing"), then release the lock so
        # remote calls don't hold DB row locks across the network.
        claimed = []
        for tab in rows:
            tab.status = "closing"
            tab.last_active_at = now  # reset the retry clock for this claim
            claimed.append(tab)
        if not claimed:
            return 0
        db.commit()

        for tab in claimed:
            workspace = db.get(Workspace, tab.workspace_id)
            if not workspace:
                tab.status = "closed"
                db.commit()
                continue
            try:
                await _finalize_close(db, workspace, tab, reason="idle_timeout", require_remote=True)
                db.commit()
                closed += 1
                logger.info("Reaped idle browser tab %s (created_by=%s)", tab.id, tab.created_by)
            except RemoteCloseError:
                # Remote close genuinely failed — leave the row "closing" so a
                # later pass retries after BROWSER_CLOSING_RETRY_AFTER_SECONDS.
                # (Never mark it "closed" on a failed close.)
                db.rollback()
                logger.warning("Idle tab %s remote close failed; will retry later", tab.id)
            except Exception:
                db.rollback()
                logger.exception("Failed to reap idle tab %s (will retry)", tab.id)
    finally:
        db.close()
    return closed


async def browser_reaper_loop():
    """Background loop: close idle tabs and prune dead BF sessions."""
    while True:
        try:
            await reap_idle_tabs()
            await BrowserManager.get().prune_dead_sessions()
        except Exception:
            logger.exception("Browser reaper error")
        await asyncio.sleep(BROWSER_REAPER_INTERVAL_SECONDS)
