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
import json
import logging
import os
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, Query
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app import cache
from app.browser import BROWSERFABRIC_API_KEY, BrowserManager
from app.browser_maintenance import BROWSER_TAB_IDLE_MINUTES
from app.browser_creds import (
    SOURCE_GLOBAL,
    SOURCE_WORKSPACE,
    BrowserCredentialError,
    key_fingerprint,
    resolve_tab_key,
)
from app.database import get_db
from app.net_security import UnsafeURLError
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

# Browser Fabric caps ephemeral (non-persistent) sessions per API key.
# Enforce it at the DB level BEFORE calling BF so the user gets an
# actionable error listing which tabs to close, instead of the raw BF 400.
#
# NOTE: this count-based pre-check is advisory only (display + early UX);
# two workers can race past it and the BF server remains the final quota
# arbiter (its 3/3 error is mapped to a structured 400 below).
# Phase-2 follow-ups, deliberately NOT in this change:
#   TODO(browser-quota): atomic DB quota slots keyed on bf_key_fingerprint
#     (unique-constraint claim), replacing this advisory count.
#   TODO(browser-quota): PostgreSQL test — two replicas racing the last
#     ephemeral slot, exactly one create_session allowed.
#   TODO(browser-bf-api): investigate BF create_session request_id /
#     idempotent creation (would make create timeouts trackable).
#   TODO(browser-bf-api): investigate BF list_sessions / admin cleanup API
#     (would allow reclaiming orphans that have no DB record at all).
# One BrowserFabric limit per key on concurrently AWAKE tabs (free plan: 5).
# BF hibernates idle persistent tabs after 15 min and wakes them on demand
# with the same session id, so sleeping tabs cost nothing and are unlimited.
# BF is authoritative: it evicts idle tabs itself before refusing, and its
# "Concurrent tab limit reached" error is surfaced as a structured 400.
BF_CONCURRENT_TAB_LIMIT = int(os.environ.get("BF_CONCURRENT_TAB_LIMIT", "5"))
# Deprecated aliases (kept so nothing importing the old names breaks).
BF_EPHEMERAL_TAB_LIMIT = BF_CONCURRENT_TAB_LIMIT
BF_PERSISTENT_TAB_LIMIT = BF_CONCURRENT_TAB_LIMIT

# "Who is driving this tab right now" is deliberately NOT a column: it is a
# few-seconds-old signal the UI uses to show the agent-is-browsing state and
# the enlarged cursor, and it must never outlive the action that produced it.
# It lives in Redis with a short TTL (multi-replica safe) with an in-process
# fallback for local/single-replica runs where Redis is not configured.
BROWSER_ACTIVITY_TTL_SECONDS = int(os.environ.get("BROWSER_ACTIVITY_TTL_SECONDS", "20"))
_local_activity: dict = {}

# Live metadata is best-effort. Bound the whole list refresh, not each tab,
# so a slow browser cannot make latency grow with the number of open tabs.
TAB_LIST_REFRESH_TIMEOUT_SECONDS = 1.0
TAB_LIST_REFRESH_CONCURRENCY = 4


# ---------------------------------------------------------------------------
# Per-workspace BF API key resolution
# ---------------------------------------------------------------------------

def _stored_bf_key(workspace) -> Optional[str]:
    """The BF key this workspace already holds (custom or auto-provisioned),
    without provisioning a new one. Used for operations on resources that
    were created with that key (e.g. deleting a persistent context)."""
    return (((workspace.settings or {}) if workspace else {}).get("browserfabric_api_key")) or None


async def _resolve_bf_key(workspace: Workspace, db: Session) -> tuple:
    """Resolve the BF API key for a workspace, for creating NEW sessions.

    Returns (key, source) where source is 'workspace' | 'global' | None.
    Priority (unchanged from the original deployment behaviour):
      1. Custom key stored in workspace settings (user-provided)
      2. Auto-provisioned key stored in workspace settings
      3. Global BROWSERFABRIC_API_KEY env var (fallback)
      4. Auto-provision a new key from BF and store it
    """
    settings = workspace.settings or {}
    stored_key = settings.get("browserfabric_api_key")
    if stored_key:
        return stored_key, SOURCE_WORKSPACE

    if BROWSERFABRIC_API_KEY:
        return BROWSERFABRIC_API_KEY, SOURCE_GLOBAL

    # Auto-provision from BF server
    new_key = await BrowserManager.provision_workspace_key(str(workspace.id))
    if new_key:
        current = dict(workspace.settings or {})
        current["browserfabric_api_key"] = new_key
        workspace.settings = current
        db.commit()
        logger.info("Auto-provisioned BF API key for workspace %s", workspace.id)
        return new_key, SOURCE_WORKSPACE

    return None, None


def _stamp_credential(tab: BrowserTab, key: Optional[str], source: Optional[str]) -> None:
    """Record the credential reference for a freshly created session.
    Stores source + fingerprint only — never the key itself."""
    tab.bf_key_source = source if key else None
    tab.bf_key_fingerprint = key_fingerprint(key)
    tab.session_closed = False
    tab.close_status = "open"
    tab.close_attempts = 0
    tab.last_close_error = None


def _record_close_outcome(tab: BrowserTab, released: bool, error: Optional[str]) -> None:
    """Apply the result of a BF close attempt to the tab's release state.
    A failed/unknown outcome keeps session_closed=False so the maintenance
    sweeper retries; only a confirmed release marks the session closed."""
    now = datetime.now(timezone.utc)
    if not tab.session_id:
        tab.session_closed = True
        tab.close_status = "none"
        return
    tab.close_attempts = (tab.close_attempts or 0) + 1
    tab.last_close_attempt_at = now
    if released:
        tab.session_closed = True
        tab.close_status = "closed"
        tab.last_close_error = None
    else:
        tab.session_closed = False
        tab.close_status = "close_failed"
        tab.last_close_error = error or "unknown close failure"


def _orphan_session_tombstone(db: Session, tab: BrowserTab, error: str) -> None:
    """When a tab's old remote session could not be confirmed released before
    being replaced (reconnect/persist swap), record it as a closed tab row so
    the maintenance sweeper keeps retrying the release instead of the session
    silently leaking against the per-key quota."""
    if not tab.session_id:
        return
    now = datetime.now(timezone.utc)
    db.add(BrowserTab(
        id=str(uuid.uuid4()),
        workspace_id=tab.workspace_id,
        url=tab.url or "about:blank",
        title=tab.title,
        status="closed",
        created_by="system:orphaned-session",
        shared_with=[],
        session_id=tab.session_id,
        bf_key_source=tab.bf_key_source,
        bf_key_fingerprint=tab.bf_key_fingerprint,
        session_closed=False,
        close_status="close_failed",
        close_attempts=1,
        last_close_attempt_at=now,
        last_close_error=error,
        last_active_at=now,
    ))
    logger.warning("browser.session.orphaned tab=%s session=%s: %s", tab.id, tab.session_id, error)


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class OpenTabRequest(BaseModel):
    url: Optional[str] = "about:blank"
    network: str
    source: Optional[str] = "human:user"
    context_id: Optional[str] = None          # open with a persistent context (already logged in)
    # Open as a *permanent* tab straight away: the session is created as a
    # BrowserFabric persistent session and a saved context is attached, so
    # login state is kept without the close-and-reopen swap /persist does.
    persistent: Optional[bool] = None
    name: Optional[str] = None                # label for the new context (defaults to the hostname)


class NavigateRequest(BaseModel):
    url: str
    source: Optional[str] = None  # who is navigating ("human:user" from the UI; agents may omit)


class ClickRequest(BaseModel):
    selector: str
    source: Optional[str] = None


class TypeRequest(BaseModel):
    selector: str
    text: str
    append: bool = False  # If True, move cursor to end before typing (for contenteditable)
    source: Optional[str] = None


class PressKeyRequest(BaseModel):
    key: str  # e.g. "Enter", "Tab", "End", "Control+a"
    source: Optional[str] = None


class EvaluateRequest(BaseModel):
    expression: str  # JavaScript to execute in page context
    source: Optional[str] = None


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
    if tab.last_error:
        d["last_error"] = tab.last_error
    # Deliberately NOT exposed: bf_key_source, bf_key_fingerprint and the
    # close-retry bookkeeping — credential internals stay out of the API.
    if tab.context_id:
        d["context_id"] = tab.context_id
        d["persistent"] = True
        d["kind"] = "permanent"
        if context_name:
            d["context_name"] = context_name
    else:
        d["persistent"] = False
        d["kind"] = "temporary"
    d["activity"] = _read_activity(tab.id)
    return d


def _tab_limits(open_tabs: list, awake: int = None) -> dict:
    """Quota snapshot for the UI.

    `concurrent` is the one real limit: tabs currently AWAKE vs the per-key
    cap. `permanent`/`temporary` are kept for older clients (their `max` is
    the same concurrent cap). `awake` defaults to every open tab; list_tabs
    refines it after probing BF for which tabs are asleep.
    """
    permanent = sum(1 for t in open_tabs if t.context_id)
    temporary = len(open_tabs) - permanent
    return {
        "concurrent": {"used": len(open_tabs) if awake is None else awake, "max": BF_CONCURRENT_TAB_LIMIT},
        "permanent": {"used": permanent, "max": BF_CONCURRENT_TAB_LIMIT},
        "temporary": {"used": temporary, "max": BF_CONCURRENT_TAB_LIMIT},
        "idle_minutes": BROWSER_TAB_IDLE_MINUTES,
        "temporary_idle_minutes": BROWSER_TAB_IDLE_MINUTES,
    }


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


def _actor_for(tab: BrowserTab, source: Optional[str]) -> str:
    """Best-effort identity of whoever is acting on a tab.

    The tab-action endpoints are called with the shared workspace token, so
    unless the caller says who it is (`source`), the only identity we have is
    the tab's creator. Humans act through the live view (BrowserFabric's
    WebSocket), not these endpoints, so an unattributed action is an agent's.
    """
    if source:
        return source
    created_by = tab.created_by or ""
    if created_by.startswith("openagents:"):
        return created_by
    return "openagents:agent"


def _record_activity(tab_id: str, action: str, actor: str) -> None:
    payload = {"action": action, "actor": actor, "at": datetime.now(timezone.utc).isoformat()}
    _local_activity[tab_id] = (time.monotonic() + BROWSER_ACTIVITY_TTL_SECONDS, payload)
    try:
        cache.set_bytes(
            f"browser:activity:{tab_id}",
            json.dumps(payload).encode("utf-8"),
            ttl_seconds=BROWSER_ACTIVITY_TTL_SECONDS,
        )
    except Exception:
        pass


def _read_activity(tab_id: str) -> Optional[dict]:
    try:
        raw = cache.get_bytes(f"browser:activity:{tab_id}")
    except Exception:
        raw = None
    if raw:
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return None
    entry = _local_activity.get(tab_id)
    if entry and entry[0] > time.monotonic():
        return entry[1]
    _local_activity.pop(tab_id, None)
    return None


def _unique_context_name(db: Session, workspace_id: str, wanted: str) -> str:
    """Return `wanted`, or `wanted (2)`, `wanted (3)`… — whichever is free."""
    base = (wanted or "").strip()[:80] or "Tab"
    taken = set(
        db.execute(
            select(BrowserContext.name)
            .where(BrowserContext.workspace_id == workspace_id)
            .where(BrowserContext.status == "active")
            .where(BrowserContext.name.like(f"{base}%"))
        ).scalars().all()
    )
    if base not in taken:
        return base
    n = 2
    while f"{base} ({n})" in taken:
        n += 1
    return f"{base} ({n})"


def _default_context_name(url: Optional[str], title: Optional[str]) -> str:
    try:
        from urllib.parse import urlparse
        host = urlparse(url or "").hostname
    except Exception:
        host = None
    if host:
        return host[4:] if host.startswith("www.") else host
    if title:
        return title[:80]
    return "New tab"


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

    # --- Resolve the credential reference for the EXISTING session ---
    session_key = None
    credential_rotated = False
    if tab.session_id:
        try:
            session_key = resolve_tab_key(tab, workspace)
        except BrowserCredentialError as e:
            if e.reason == "credential_missing":
                raise  # no key at all — surface, don't guess
            # credential_mismatch: the key was rotated. The old session must
            # NOT be touched with the new key — record it for the sweeper
            # (it will exhaust retries visibly) and recreate below.
            credential_rotated = True

    # --- Try reconnecting to the existing session first ---
    if tab.session_id and not credential_rotated:
        try:
            await manager.reconnect(tab.id, tab.session_id, api_key=session_key)
            # Probe liveness. Only a definitive "dead" verdict tears the session
            # down; a transient error (timeout / 5xx) keeps the healthy session
            # so a slow get_page_info on a heavy SPA can't kill a logged-in tab.
            probe = await manager.probe_session(tab.id, api_key=session_key)
            status = probe.get("status")
            if status == "alive":
                if probe.get("url") and probe["url"] != tab.url:
                    tab.url = probe["url"]
                if probe.get("title") and probe["title"] != tab.title:
                    tab.title = probe["title"]
                return
            if status == "unknown":
                # Inconclusive (transient BF error). Reconnect already restored
                # the session mapping; keep it rather than churning the tab.
                logger.warning(
                    "Tab %s liveness probe inconclusive; keeping session %s",
                    tab.id, tab.session_id,
                )
                return
            # status == "dead" — session is really gone, fall through to recreate.
            logger.info("Session %s is dead (liveness probe), will recreate", tab.session_id)
            manager._sessions.pop(tab.id, None)
            manager._live_urls.pop(tab.id, None)
        except Exception as e:
            logger.info("Reconnect failed for tab %s (session %s), will create new session: %s",
                        tab.id, tab.session_id, e)

    # --- Session is dead or unreachable — create a fresh one ---
    if credential_rotated:
        if db is not None:
            _orphan_session_tombstone(db, tab, "credential_mismatch: key rotated before release")
        tab.session_id = None
    else:
        # Clean up old session (best-effort); if the release isn't confirmed,
        # keep it tracked so the sweeper retries instead of leaking it.
        released, close_err = await manager.close_tab(
            tab.id, session_id_hint=tab.session_id, api_key=session_key
        )
        if tab.session_id and not released and db is not None:
            _orphan_session_tombstone(db, tab, close_err or "close failed during session recreate")

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

    if workspace is not None and db is not None:
        bf_key, bf_source = await _resolve_bf_key(workspace, db)
    else:
        bf_key, bf_source = session_key, tab.bf_key_source
    result = await manager.open_tab(tab.id, tab.url or "about:blank", bb_context_id=bb_context_id, api_key=bf_key)

    # Update the tab record with the new session info
    tab.session_id = manager.get_session_id(tab.id)
    tab.live_url = manager.get_live_url(tab.id)
    _stamp_credential(tab, bf_key, bf_source)
    tab.url = result.get("url", tab.url)
    tab.title = result.get("title", tab.title)
    warnings = result.get("warnings") or []
    tab.last_error = "; ".join(warnings) if warnings else None
    _touch(tab)
    # Persist the new session/live_url NOW, in its own transaction. Otherwise a
    # later failure in the same request rolls this back and the live pane keeps
    # polling the dead share token ("Invalid or expired share link").
    if db is not None:
        try:
            db.add(tab)
            db.commit()
            db.refresh(tab)
        except Exception as commit_err:
            db.rollback()
            logger.warning("Failed to persist recreated session for tab %s: %s", tab.id, commit_err)
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

    bf_key, bf_source = await _resolve_bf_key(workspace, db)

    open_as_permanent = bool(body.persistent) and not body.context_id

    # No per-kind quota pre-check here: BrowserFabric enforces one limit on
    # concurrently AWAKE tabs, puts idle tabs to sleep itself to make room,
    # and only refuses when nothing is evictable (surfaced as a 400 below).

    try:
        result = await manager.open_tab(
            tab_id, body.url or "about:blank",
            bb_context_id=bb_context_id, api_key=bf_key,
            persist=open_as_permanent,
        )
    except UnsafeURLError as e:
        return json_response(ResponseCode.BAD_REQUEST, str(e), data={"error_code": e.code})
    except RuntimeError as e:
        return json_response(ResponseCode.BAD_REQUEST, str(e))
    except Exception as e:
        logger.error("Failed to open browser tab: %s", e)
        return json_response(ResponseCode.INTERNAL_ERROR, "Failed to open browser tab")

    # Update context last_used_at
    if context_record:
        context_record.last_used_at = datetime.now(timezone.utc)

    session_id = manager.get_session_id(tab_id)
    warnings = result.get("warnings") or []
    record = BrowserTab(
        id=tab_id,
        workspace_id=str(workspace.id),
        url=result.get("url", body.url or "about:blank"),
        title=result.get("title"),
        created_by=body.source or "human:user",
        shared_with=[],
        context_id=body.context_id,
        session_id=session_id,
        live_url=manager.get_live_url(tab_id),
        bf_key_source=bf_source if (bf_key and session_id) else None,
        bf_key_fingerprint=key_fingerprint(bf_key) if session_id else None,
        session_closed=not session_id,
        close_status="open" if session_id else "none",
        last_error="; ".join(warnings) if warnings else None,
    )
    db.add(record)

    # Permanent-from-birth: attach a saved context now. The BF session was
    # created with persist=True, so BF keeps updating this context on close;
    # capturing it here (instead of on close) gives the tab an identity the
    # UI can show — and wake up later — even if the session dies.
    new_context = None
    if open_as_permanent:
        new_bb_context_id = None
        if manager.is_cloud_for(bf_key) and session_id:
            try:
                new_bb_context_id = await manager.create_bb_context(session_id=session_id, tab_id=tab_id)
            except Exception as e:
                warnings.append(f"context_save_failed: {e}")
                logger.warning("save_context failed for new permanent tab %s: %s", tab_id, e)
        wanted = body.name or _default_context_name(record.url, record.title)
        domain = None
        try:
            from urllib.parse import urlparse
            domain = urlparse(record.url or "").hostname
        except Exception:
            pass
        new_context = BrowserContext(
            workspace_id=str(workspace.id),
            name=_unique_context_name(db, str(workspace.id), wanted),
            bb_context_id=new_bb_context_id,
            domain=domain,
            created_by=body.source or "human:user",
            shared_with=[],
        )
        db.add(new_context)
        db.flush()
        record.context_id = new_context.id
        if warnings:
            record.last_error = "; ".join(warnings)

    # Track usage
    usage = BrowserUsage(
        workspace_id=str(workspace.id),
        tab_id=tab_id,
        session_id=manager.get_session_id(tab_id),
        opened_by=body.source or "human:user",
    )
    db.add(usage)

    # Commit BEFORE emitting the event: the BF session already exists, and a
    # rejected/failed event pipeline must not roll back the only record of it
    # (that's a leaked session the sweeper could never find).
    db.commit()

    try:
        event = Event(
            type="workspace.browser.tab.opened",
            source=body.source or "human:user",
            target="core",
            payload={
                "tab_id": tab_id,
                "url": record.url,
                "kind": "permanent" if record.context_id else "temporary",
                **({"context_id": record.context_id} if record.context_id else {}),
            },
        )
        await _emit_event(event, workspace, db, token=x_workspace_token or workspace.password_hash)
    except Exception as e:
        logger.warning("tab.opened event failed for %s (tab kept): %s", tab_id, e)

    # A partially failed init (session created, navigate/page-info failed) is
    # still a created tab — the caller gets the tab plus explicit warnings.
    data = _tab_to_dict(record, context_name=new_context.name if new_context else (context_record.name if context_record else None))
    if new_context:
        data["context"] = _context_to_dict(new_context)
    if warnings:
        data["warnings"] = warnings
    return success_response(data)


# ---------------------------------------------------------------------------
# GET /v1/browser/tabs — list tabs
# ---------------------------------------------------------------------------

def _load_tab_list(db, network, status, x_workspace_token, authorization):
    # Return plain data and close the read transaction before any browser I/O.
    # No ORM objects (including expired attributes) may reach the event loop.
    with db:
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

        context_ids = [t.context_id for t in rows if t.context_id]
        context_names = {}
        if context_ids:
            contexts = db.execute(
                select(BrowserContext.id, BrowserContext.name)
                .where(BrowserContext.id.in_(context_ids))
            ).all()
            context_names = {c.id: c.name for c in contexts}

        data = {
            "tabs": [_tab_to_dict(t, context_name=context_names.get(t.context_id)) for t in rows],
            "total": len(rows),
        }
        if status == "active":
            data["limits"] = _tab_limits(rows)
        return data


def _save_live_tab_metadata(db, changes):
    with db, db.begin():
        for tab_id, status, field, previous, current in changes:
            # Browser I/O runs outside the transaction. Don't overwrite a
            # concurrent navigation or a tab closed while that I/O was pending.
            db.execute(
                update(BrowserTab)
                .where(BrowserTab.id == tab_id, BrowserTab.status == status,
                       getattr(BrowserTab, field) == previous)
                .values({field: current})
            )


@router.get("/tabs")
async def list_tabs(
    network: str = Query(..., description="Network (workspace) ID or slug"),
    status: str = Query("active"),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    data = await run_in_threadpool(
        _load_tab_list, db, network, status, x_workspace_token, authorization,
    )
    if isinstance(data, Response):
        return data

    # Sync current URL/title from live Playwright pages (catches in-iframe navigation)
    manager = BrowserManager.get()
    changes = []
    limiter = asyncio.Semaphore(TAB_LIST_REFRESH_CONCURRENCY)

    async def refresh(tab):
        async with limiter:
            try:
                live = await manager.get_current_url(tab["id"])
            except Exception:
                return  # Keep the saved metadata if the live browser is unavailable.
        if live:
            tab["asleep"] = bool(live.get("hibernated"))
            for field in ("url", "title"):
                if live[field] and live[field] != tab[field]:
                    changes.append((tab["id"], tab["status"], field, tab[field], live[field]))
                    tab[field] = live[field]

    try:
        # wait_for (not asyncio.timeout) keeps this runnable on Python 3.10,
        # which is still in the CI matrix; the semantics are the same here.
        await asyncio.wait_for(
            asyncio.gather(*(refresh(tab) for tab in data["tabs"])),
            timeout=TAB_LIST_REFRESH_TIMEOUT_SECONDS,
        )
    except (TimeoutError, asyncio.TimeoutError):
        # Completed refreshes are retained; gather cancels unfinished lookups.
        pass
    if changes:
        await run_in_threadpool(_save_live_tab_metadata, db, changes)
    if isinstance(data.get("limits"), dict) and "concurrent" in data["limits"]:
        data["limits"]["concurrent"]["used"] = sum(1 for t in data["tabs"] if not t.get("asleep"))

    return success_response(data)


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

    try:
        await _ensure_connected(tab, db, workspace)
    except BrowserCredentialError as e:
        return json_response(ResponseCode.BAD_REQUEST, str(e))
    manager = BrowserManager.get()
    try:
        result = await manager.navigate(tab_id, body.url)
    except UnsafeURLError as e:
        return json_response(ResponseCode.BAD_REQUEST, str(e), data={"error_code": e.code})
    except KeyError:
        return json_response(ResponseCode.NOT_FOUND, "Browser tab not found in browser")
    except Exception as e:
        logger.error("Navigate failed: %s", e)
        return json_response(ResponseCode.INTERNAL_ERROR, "Navigation failed")

    tab.url = result.get("url", body.url)
    tab.title = result.get("title")
    _touch(tab)
    _record_activity(tab_id, "navigate", _actor_for(tab, body.source))

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

    # Release the old session with ITS OWN credential; if the release can't
    # be confirmed (failure or rotated key), leave a tombstone so the
    # sweeper keeps the old session tracked instead of leaking it.
    if tab.session_id:
        try:
            old_key = resolve_tab_key(tab, workspace)
            released, close_err = await manager.close_tab(tab_id, session_id_hint=tab.session_id, api_key=old_key)
        except BrowserCredentialError as e:
            released, close_err = False, str(e)
            manager._sessions.pop(tab_id, None)
            manager._live_urls.pop(tab_id, None)
            manager._tab_keys.pop(tab_id, None)
        if not released:
            _orphan_session_tombstone(db, tab, close_err or "close failed during reconnect")

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
    bf_key, bf_source = await _resolve_bf_key(workspace, db)
    try:
        result = await manager.open_tab(tab_id, tab.url or "about:blank", bb_context_id=bb_context_id, api_key=bf_key)
    except Exception as e:
        db.commit()  # keep any tombstone recorded above
        logger.error("Reconnect failed: %s", e)
        return json_response(ResponseCode.INTERNAL_ERROR, "Failed to reconnect browser tab")

    # Update DB record
    tab.session_id = manager.get_session_id(tab_id)
    tab.live_url = manager.get_live_url(tab_id)
    _stamp_credential(tab, bf_key, bf_source)
    tab.url = result.get("url", tab.url)
    tab.title = result.get("title", tab.title)
    warnings = result.get("warnings") or []
    tab.last_error = "; ".join(warnings) if warnings else None
    _touch(tab)
    db.commit()

    data = _tab_to_dict(tab)
    if warnings:
        data["warnings"] = warnings
    return success_response(data)


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

    try:
        await _ensure_connected(tab, db, workspace)
    except BrowserCredentialError as e:
        return json_response(ResponseCode.BAD_REQUEST, str(e))
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
    _record_activity(tab_id, "click", _actor_for(tab, body.source))
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

    try:
        await _ensure_connected(tab, db, workspace)
    except BrowserCredentialError as e:
        return json_response(ResponseCode.BAD_REQUEST, str(e))
    manager = BrowserManager.get()
    try:
        await manager.type_text(tab_id, body.selector, body.text, append=body.append)
    except KeyError:
        return json_response(ResponseCode.NOT_FOUND, "Browser tab not found in browser")
    except Exception as e:
        logger.error("Type failed: %s", e)
        return json_response(ResponseCode.INTERNAL_ERROR, f"Type failed: {e}")

    _touch(tab)
    _record_activity(tab_id, "type", _actor_for(tab, body.source))
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

    try:
        await _ensure_connected(tab, db, workspace)
    except BrowserCredentialError as e:
        return json_response(ResponseCode.BAD_REQUEST, str(e))
    manager = BrowserManager.get()
    try:
        await manager.press_key(tab_id, body.key)
    except KeyError:
        return json_response(ResponseCode.NOT_FOUND, "Browser tab not found in browser")
    except Exception as e:
        logger.error("Press key failed: %s", e)
        return json_response(ResponseCode.INTERNAL_ERROR, f"Press key failed: {e}")

    _touch(tab)
    _record_activity(tab_id, "press_key", _actor_for(tab, body.source))
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

    try:
        await _ensure_connected(tab, db, workspace)
    except BrowserCredentialError as e:
        return json_response(ResponseCode.BAD_REQUEST, str(e))
    manager = BrowserManager.get()
    try:
        result = await manager.evaluate(tab_id, body.expression)
    except KeyError:
        return json_response(ResponseCode.NOT_FOUND, "Browser tab not found in browser")
    except Exception as e:
        logger.error("Evaluate failed: %s", e)
        return json_response(ResponseCode.INTERNAL_ERROR, f"Evaluate failed: {e}")

    _touch(tab)
    _record_activity(tab_id, "evaluate", _actor_for(tab, body.source))
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

    try:
        await _ensure_connected(tab, db, workspace)
    except BrowserCredentialError as e:
        return json_response(ResponseCode.BAD_REQUEST, str(e))
    manager = BrowserManager.get()
    try:
        data = await manager.screenshot(tab_id)
    except KeyError:
        return json_response(ResponseCode.NOT_FOUND, "Browser tab not found in browser")
    except Exception as e:
        logger.error("Screenshot failed: %s", e)
        return json_response(ResponseCode.INTERNAL_ERROR, "Screenshot failed")

    # Sync current URL/title from live page back to DB (catches in-iframe navigation)
    live = await manager.get_current_url(tab_id)
    if live:
        changed = False
        if live["url"] and live["url"] != tab.url:
            tab.url = live["url"]
            changed = True
        if live["title"] and live["title"] != tab.title:
            tab.title = live["title"]
            changed = True
        if changed:
            _touch(tab)
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

    try:
        await _ensure_connected(tab, db, workspace)
    except BrowserCredentialError as e:
        return json_response(ResponseCode.BAD_REQUEST, str(e))
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
    bf_key, bf_source = await _resolve_bf_key(workspace, db)
    bb_context_id = None
    if manager.is_cloud_for(bf_key):
        try:
            await _ensure_connected(tab, db, workspace)
            bb_context_id = await manager.create_bb_context(session_id=tab.session_id, tab_id=tab_id)
        except BrowserCredentialError as e:
            return json_response(ResponseCode.BAD_REQUEST, str(e))
        except Exception as e:
            logger.error("Failed to create persistent context: %s", e)
            return json_response(ResponseCode.INTERNAL_ERROR, "Failed to create persistent context")

    # Close the current session and reopen with the context so that
    # future sessions restore cookies/localStorage from the saved state.
    # The old and new sessions are distinct identities: the old one is
    # released (or tombstoned for the sweeper) BEFORE tab.session_id is
    # overwritten with the new one.
    if manager.is_cloud_for(bf_key) and tab.session_id:
        try:
            current_url = tab.url
            try:
                old_key = resolve_tab_key(tab, workspace)
                released, close_err = await manager.close_tab(tab_id, session_id_hint=tab.session_id, api_key=old_key)
            except BrowserCredentialError as e:
                released, close_err = False, str(e)
                manager._sessions.pop(tab_id, None)
                manager._live_urls.pop(tab_id, None)
                manager._tab_keys.pop(tab_id, None)
            if not released:
                _orphan_session_tombstone(db, tab, close_err or "close failed during persist swap")
            result = await manager.open_tab(tab_id, current_url, bb_context_id=bb_context_id, api_key=bf_key)
            tab.session_id = manager.get_session_id(tab_id)
            tab.live_url = manager.get_live_url(tab_id)
            _stamp_credential(tab, bf_key, bf_source)
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
            manager.delete_bb_context(ctx.bb_context_id, api_key=_stored_bf_key(workspace))
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
        manager.delete_bb_context(ctx.bb_context_id, api_key=_stored_bf_key(workspace))

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
    try:
        close_key = resolve_tab_key(tab, workspace)
        released, close_err = await manager.close_tab(tab_id, session_id_hint=tab.session_id, api_key=close_key)
    except BrowserCredentialError as e:
        # Never touch the old session with a wrong/rotated key. Record the
        # failure; the sweeper will surface it as retry_exhausted.
        released, close_err = False, str(e)
        manager._sessions.pop(tab_id, None)
        manager._live_urls.pop(tab_id, None)
        manager._tab_keys.pop(tab_id, None)
    # A failed/unknown BF close keeps session_closed=False so the maintenance
    # sweeper retries — otherwise the session silently eats the per-key
    # ephemeral quota while the UI shows no open tabs.
    _record_close_outcome(tab, released, close_err)
    db.commit()

    payload = {"tab_id": tab_id}
    if is_persistent:
        payload["context_id"] = tab.context_id
        payload["persistent"] = True

    try:
        event = Event(
            type="workspace.browser.tab.closed",
            source="system",
            target="core",
            payload=payload,
        )
        await _emit_event(event, workspace, db, token=x_workspace_token or workspace.password_hash)
    except Exception as e:
        logger.warning("tab.closed event failed for %s: %s", tab_id, e)

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
