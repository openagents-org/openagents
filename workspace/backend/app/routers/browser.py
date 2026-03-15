# -*- coding: utf-8 -*-
"""
Shared browser endpoints — open, navigate, click, type, screenshot, snapshot.

POST   /v1/browser/tabs                    Open a new tab
GET    /v1/browser/tabs                    List active tabs
GET    /v1/browser/tabs/{tab_id}           Get tab info
POST   /v1/browser/tabs/{tab_id}/navigate  Navigate to URL
POST   /v1/browser/tabs/{tab_id}/click     Click element
POST   /v1/browser/tabs/{tab_id}/type      Type text
GET    /v1/browser/tabs/{tab_id}/screenshot Get PNG screenshot
GET    /v1/browser/tabs/{tab_id}/snapshot   Get accessibility tree
POST   /v1/browser/tabs/{tab_id}/share     Share with agent
DELETE /v1/browser/tabs/{tab_id}           Close tab
"""

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, Query
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.browser import BrowserManager
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


class ShareRequest(BaseModel):
    agent_name: str


class PersistTabRequest(BaseModel):
    name: str                                  # user-provided label, e.g. "LinkedIn Account"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _tab_to_dict(tab: BrowserTab) -> dict:
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


async def _ensure_connected(tab: BrowserTab) -> None:
    """Reconnect to the Browserbase session if the page is not in memory.

    On serverless (Vercel), each invocation may be a cold start with an
    empty BrowserManager._pages dict.  If the tab has a session_id we can
    reconnect via CDP.
    """
    manager = BrowserManager.get()
    if tab.id in manager._pages:
        return
    if not tab.session_id:
        return  # no remote session to reconnect to
    await manager.reconnect(tab.id, tab.session_id)


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

    tab_id = str(uuid.uuid4())
    manager = BrowserManager.get()

    try:
        result = await manager.open_tab(tab_id, body.url or "about:blank", bb_context_id=bb_context_id)
    except RuntimeError as e:
        return json_response(ResponseCode.BAD_REQUEST, str(e))
    except Exception as e:
        logger.error("Failed to open browser tab: %s", e)
        return json_response(ResponseCode.INTERNAL_ERROR, "Failed to open browser tab")

    # Update context last_used_at
    if context_record:
        context_record.last_used_at = datetime.now(timezone.utc)

    record = BrowserTab(
        id=tab_id,
        workspace_id=str(workspace.id),
        url=result.get("url", body.url or "about:blank"),
        title=result.get("title"),
        created_by=body.source or "human:user",
        shared_with=[],
        context_id=body.context_id,
        session_id=manager.get_session_id(tab_id),
        live_url=manager.get_live_url(tab_id),
    )
    db.add(record)

    # Track usage
    usage = BrowserUsage(
        workspace_id=str(workspace.id),
        tab_id=tab_id,
        session_id=manager.get_session_id(tab_id),
        opened_by=body.source or "human:user",
    )
    db.add(usage)

    event = Event(
        type="workspace.browser.tab.opened",
        source=body.source or "human:user",
        target="core",
        payload={"tab_id": tab_id, "url": record.url},
    )
    await _emit_event(event, workspace, db, token=x_workspace_token or workspace.password_hash)

    return success_response(_tab_to_dict(record))


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

    return success_response({
        "tabs": [_tab_to_dict(t) for t in rows],
        "total": len(rows),
    })


# ---------------------------------------------------------------------------
# GET /v1/browser/tabs/{tab_id} — get tab info
# ---------------------------------------------------------------------------

@router.get("/tabs/{tab_id}")
async def get_tab(
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

    await _ensure_connected(tab)
    manager = BrowserManager.get()
    try:
        result = await manager.navigate(tab_id, body.url)
    except KeyError:
        return json_response(ResponseCode.NOT_FOUND, "Browser tab not found in browser")
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
    try:
        result = await manager.open_tab(tab_id, tab.url or "about:blank", bb_context_id=bb_context_id)
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

    await _ensure_connected(tab)
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

    await _ensure_connected(tab)
    manager = BrowserManager.get()
    try:
        await manager.type_text(tab_id, body.selector, body.text)
    except KeyError:
        return json_response(ResponseCode.NOT_FOUND, "Browser tab not found in browser")
    except Exception as e:
        logger.error("Type failed: %s", e)
        return json_response(ResponseCode.INTERNAL_ERROR, f"Type failed: {e}")

    _touch(tab)
    db.flush()

    return success_response({"tab_id": tab_id, "typed": body.selector})


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

    await _ensure_connected(tab)
    manager = BrowserManager.get()
    try:
        data = await manager.screenshot(tab_id)
    except KeyError:
        return json_response(ResponseCode.NOT_FOUND, "Browser tab not found in browser")
    except Exception as e:
        logger.error("Screenshot failed: %s", e)
        return json_response(ResponseCode.INTERNAL_ERROR, "Screenshot failed")

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

    await _ensure_connected(tab)
    manager = BrowserManager.get()
    try:
        tree = await manager.snapshot(tab_id)
    except KeyError:
        return json_response(ResponseCode.NOT_FOUND, "Browser tab not found in browser")
    except Exception as e:
        logger.error("Snapshot failed: %s", e)
        return json_response(ResponseCode.INTERNAL_ERROR, "Snapshot failed")

    return Response(content=tree, media_type="text/plain")


# ---------------------------------------------------------------------------
# POST /v1/browser/tabs/{tab_id}/share
# ---------------------------------------------------------------------------

@router.post("/tabs/{tab_id}/share")
async def share_tab(
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

    # Create BrowserBase context (cloud mode)
    manager = BrowserManager.get()
    bb_context_id = None
    if manager.is_cloud:
        try:
            bb_context_id = manager.create_bb_context()
        except Exception as e:
            logger.error("Failed to create BB context: %s", e)
            return json_response(ResponseCode.INTERNAL_ERROR, "Failed to create persistent context")

    # Try to close the current session and reopen with the context so that
    # cookies are saved on next close. On serverless (Vercel), the in-memory
    # browser state may be gone — if reconnection fails, we just create the
    # context record anyway. The context will activate on next tab open.
    if manager.is_cloud and tab.session_id:
        try:
            await _ensure_connected(tab)
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
async def list_contexts(
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

    tab.status = "closed"

    # Finalize usage record
    usage = db.execute(
        select(BrowserUsage)
        .where(BrowserUsage.tab_id == tab_id)
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

    manager = BrowserManager.get()
    await manager.close_tab(tab_id, session_id_hint=tab.session_id)

    payload = {"tab_id": tab_id}
    if is_persistent:
        payload["context_id"] = tab.context_id
        payload["persistent"] = True

    event = Event(
        type="workspace.browser.tab.closed",
        source="system",
        target="core",
        payload=payload,
    )
    await _emit_event(event, workspace, db, token=x_workspace_token or workspace.password_hash)

    return success_response({"id": tab_id, "status": "closed", "context_preserved": is_persistent})


# ---------------------------------------------------------------------------
# GET /v1/browser/usage — usage summary
# ---------------------------------------------------------------------------

@router.get("/usage")
async def get_usage(
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
