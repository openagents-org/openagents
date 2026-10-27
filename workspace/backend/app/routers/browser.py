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
from typing import Literal, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Header, Query, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select, text, update
from sqlalchemy.orm import Session
from sqlalchemy.exc import OperationalError
from app.access import resolve_current_user
from starlette.concurrency import run_in_threadpool

from app import cache
from app.browser import BLANK_PAGE, BROWSERFABRIC_API_KEY, BrowserManager
from app.browser_maintenance import BROWSER_TAB_IDLE_MINUTES
from app.services.browser_frame import standard_browser_frame
from app.browser_creds import (
    SOURCE_GLOBAL,
    SOURCE_WORKSPACE,
    BrowserCredentialError,
    key_fingerprint,
    resolve_tab_key,
)
from app.database import get_db
from app.net_security import UnsafeURLError
from app.models import BrowserContext, BrowserTab, BrowserUsage, Channel, EventRecord, Workspace
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
    # Compatibility field: cloud tabs are always saved, even if an older
    # client explicitly sends false. Local browser behavior is unchanged.
    persistent: Optional[bool] = None
    name: Optional[str] = None                # label for the new context (defaults to the hostname)
    # Workspace channel (thread) this tab is being driven for. Optional and
    # attaches the live preview to this conversation and lets the Slack bridge
    # post page previews. Remembered per tab for later operations.
    channel: Optional[str] = None


class NavigateRequest(BaseModel):
    url: str
    source: Optional[str] = None  # who is navigating ("human:user" from the UI; agents may omit)
    channel: Optional[str] = None  # thread this navigation is for (see OpenTabRequest.channel)


class ClickRequest(BaseModel):
    channel: Optional[str] = None
    selector: str
    source: Optional[str] = None


class TypeRequest(BaseModel):
    channel: Optional[str] = None
    selector: str
    text: str
    append: bool = False  # If True, move cursor to end before typing (for contenteditable)
    source: Optional[str] = None


class PressKeyRequest(BaseModel):
    channel: Optional[str] = None
    key: str  # e.g. "Enter", "Tab", "End", "Control+a"
    source: Optional[str] = None


class EvaluateRequest(BaseModel):
    channel: Optional[str] = None
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
        "artifact_channels": tab.artifact_channels or [],
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


def _browser_conversation(db, workspace_id, actor, channel):
    """Resolve an explicit thread or DM, never infer one from agent presence."""
    if channel.startswith("dm:"):
        # Connectors use dm:<counterpart>; the UI uses the sorted full pair.
        addresses = channel[3:].split(",")
        if len(addresses) == 1:
            addresses.append(actor)
        if len(addresses) != 2 or actor not in addresses or len(set(addresses)) != 2:
            return None
        counterpart = next(address for address in addresses if address != actor)
        if not counterpart.startswith(("human:", "openagents:")) or not counterpart.split(":", 1)[1]:
            return None
        # A tab must refer to a real conversation in this workspace. Merely
        # claiming another person's address cannot announce work in their DM.
        exists = db.execute(select(EventRecord.id).where(
            EventRecord.network_id == str(workspace_id),
            EventRecord.type == "workspace.message.posted",
            or_((EventRecord.source == actor) & (EventRecord.target == counterpart),
                (EventRecord.source == counterpart) & (EventRecord.target == actor)),
        ).limit(1)).first()
        if not exists:
            return None
        return "dm:" + ",".join(sorted(addresses)), counterpart
    thread = db.execute(select(Channel).where(
        Channel.workspace_id == str(workspace_id),
        Channel.name == channel, Channel.status != "deleted",
    )).scalar_one_or_none()
    return (channel, f"channel/{channel}") if thread else None


async def _record_browser_work(db, workspace, tab, actor, channel, action):
    """Attach a stable live preview once per tab/thread, without agent wake-ups.

    Browser operations already happened externally. Preserve their metadata even
    if posting the informational card fails. Never guess a conversation from an
    agent's membership: it may be working in several private threads at once.
    """
    db.commit()
    if not actor or not actor.startswith("openagents:"):
        return
    _record_activity(tab.id, action, actor)
    from app.services.browser_preview import channel_for_tab, remember_tab_channel
    channel = channel or channel_for_tab(tab.id) or next(iter(tab.artifact_channels or []), None)
    if not channel:
        return
    try:
        conversation = _browser_conversation(db, workspace.id, actor, channel)
        if not conversation:
            return
        channel, target = conversation
        remember_tab_channel(tab.id, channel)
        # Serialize first-use announcements; a browser operation can overlap a
        # screenshot/snapshot. Reload the JSON after acquiring the row lock.
        db.refresh(tab, with_for_update=True)
        channels = list(tab.artifact_channels or [])
        if channel in channels:
            tab.artifact_channels = [channel, *[name for name in channels if name != channel]]
            db.commit()
            return
        tab.artifact_channels = [channel, *channels]
        event = Event(
            type="workspace.message.posted", source=actor, target=target,
            payload={"content": f"Using a [live browser tab](/v1/browser/tabs/{tab.id}). Preview it to follow along.", "message_type": "artifact"},
            metadata={"target_agents": ["__no_response__"], "explicit_targets": [], "browser_artifact": tab.id},
        )
        result = await _emit_event(event, workspace, db, token=workspace.password_hash)
        if result is None:
            db.rollback()
    except Exception:
        db.rollback()
        logger.warning("Could not attach browser preview for tab %s", tab.id, exc_info=True)


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


async def _attach_saved_context(tab, db, manager, *, name=None):
    """Attach a real BF context to this tab only after remote saving succeeds."""
    if tab.context_id or not tab.session_id:
        return
    context_id = await manager.create_bb_context(session_id=tab.session_id, tab_id=tab.id)
    from urllib.parse import urlparse
    context = BrowserContext(
        workspace_id=str(tab.workspace_id),
        name=_unique_context_name(db, str(tab.workspace_id), name or _default_context_name(tab.url, tab.title)),
        bb_context_id=context_id, domain=urlparse(tab.url or "").hostname,
        created_by=tab.created_by, shared_with=[],
    )
    with db.begin_nested():
        db.add(context)
        db.flush()
    tab.context_id = context.id


async def _open_restored_tab(manager, tab, *, bb_context_id, api_key):
    """Restore saved display state without navigating to Chromium internals."""
    # Chromium reports this internal document after a failed navigation. It is
    # not a restorable target; keep the saved context and start on a blank page.
    # The normal policy gate still refuses every arbitrary internal URL.
    error_page = tab.url == "chrome-error://chromewebdata/"
    url = BLANK_PAGE if error_page else (tab.url or BLANK_PAGE)
    result = await manager.open_tab(tab.id, url, bb_context_id=bb_context_id, api_key=api_key)
    if error_page:
        result = {**result, "warnings": [*(result.get("warnings") or []),
                  "The previous page failed to load; navigate to a website to continue."]}
    return result


async def _ensure_connected(tab: BrowserTab, db: Session = None, workspace: Workspace = None) -> None:
    """Adopt the authoritative session, without ever replacing an editor.

    Ordinary actions and reads may retry an unavailable provider, but cannot
    close/create sessions. Cookies and a URL cannot restore unsaved page state.
    """
    if db is not None:
        db.refresh(tab)
    if tab.status != "active":
        raise HTTPException(409, "This browser is no longer open. Refresh the browser list.")
    manager = BrowserManager.get()
    key = resolve_tab_key(tab, workspace) if tab.session_id else None
    if tab.session_id:
        await manager.reconnect(tab.id, tab.session_id, api_key=key)
    try:
        probe = await manager.probe_session(tab.id, api_key=key)
    except Exception:
        probe = {"status": "unknown"}
    if probe.get("status") != "alive":
        raise HTTPException(
            503,
            "Browser temporarily unavailable. Its session has not been replaced. "
            "Retry; replacing a browser loses unsaved page content.",
            headers={"Retry-After": "2"},
        )
    if probe.get("url"):
        tab.url = probe["url"]
    if probe.get("title"):
        tab.title = probe["title"]


def _lock_browser_lifecycle(db: Session, tab_id: str) -> BrowserTab:
    """Re-read and serialize explicit lifecycle changes across workers.

    NOWAIT prevents an async worker from blocking its event loop while another
    request holds the row during provider I/O. Callers must not commit until
    the lifecycle change is complete. Normal actions never acquire this lock.
    """
    try:
        tab = db.execute(
            select(BrowserTab).where(BrowserTab.id == tab_id)
            .execution_options(populate_existing=True).with_for_update(nowait=True)
        ).scalar_one_or_none()
    except OperationalError:
        db.rollback()
        raise HTTPException(409, "This browser is already being changed. Retry shortly.")
    if tab is None:
        raise HTTPException(404, "Browser tab not found")
    if db.get_bind().dialect.name == "postgresql":
        # Creation includes several provider calls (each has a 60s I/O timeout).
        # Allow them to finish without releasing the lock mid-operation; keep
        # the ordinary application transaction limits unchanged.
        db.execute(text("SET LOCAL idle_in_transaction_session_timeout = 300000"))
    return tab


def _replace_session_mapping(db, tab, expected_session_id, expected_status, session_id, live_url):
    """CAS the mapping before any ORM assignment can flush over a newer one."""
    with db.no_autoflush:
        changed = db.execute(
            update(BrowserTab).where(
                BrowserTab.id == tab.id,
                BrowserTab.session_id == expected_session_id,
                BrowserTab.status == expected_status,
            ).values(session_id=session_id, live_url=live_url)
            .execution_options(synchronize_session=False)
        ).rowcount
    if changed != 1:
        raise HTTPException(409, "Browser session changed. Refresh before replacing it.")
    # Refresh just the CAS fields; retain a newly saved context on this object.
    db.refresh(tab, attribute_names=["session_id", "live_url"])


# ---------------------------------------------------------------------------
# POST /v1/browser/tabs — open new tab
# ---------------------------------------------------------------------------

@router.post("/tabs")
async def open_tab(
    body: OpenTabRequest,
    background_tasks: BackgroundTasks,
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

    open_as_permanent = (manager.is_cloud_for(bf_key) or bool(body.persistent)) and not body.context_id

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
        if manager.is_cloud_for(bf_key):
            try:
                await _attach_saved_context(record, db, manager, name=body.name)
                new_context = db.get(BrowserContext, record.context_id) if record.context_id else None
            except Exception:
                # Keep the remote session tracked, but never invent a context
                # ID or claim that a failed save succeeded.
                warnings.append("context_save_failed: retry saving this browser context")
        else:
            from urllib.parse import urlparse
            new_context = BrowserContext(
                workspace_id=str(workspace.id),
                name=_unique_context_name(db, str(workspace.id), body.name or _default_context_name(record.url, record.title)),
                domain=urlparse(record.url or "").hostname,
                created_by=body.source or "human:user", shared_with=[],
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

    # Slack browser preview (best-effort, after the response): never lets a
    # bridge/Slack problem fail the tab operation.
    try:
        from app.services.browser_preview import schedule_browser_preview
        schedule_browser_preview(
            background_tasks, workspace, body.channel, record,
            body.source or "human:user", "opened",
        )
    except Exception as e:
        logger.debug("browser preview hook failed for %s: %s", tab_id, e)

    await _record_browser_work(db, workspace, record, body.source, body.channel, "open")

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
    include_closed: bool = False,
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    tab = _get_tab(db, tab_id)
    if not tab or (tab.status != "active" and not (include_closed and tab.status == "closed")):
        return json_response(ResponseCode.NOT_FOUND, "Tab not found")

    workspace = _resolve_workspace(db, str(tab.workspace_id))
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    data = _tab_to_dict(tab)
    if validate and tab.status == "active":
        # Polling must neither wake nor replace a saved browser. An inconclusive
        # provider response is not evidence that the user's session expired.
        manager = BrowserManager.get()
        try:
            key = resolve_tab_key(tab, workspace)
            if tab.session_id:
                await manager.reconnect(tab.id, tab.session_id, api_key=key)
            probe = await manager.probe_session(tab.id, api_key=key)
            data["connection_status"] = probe["status"]
            data["asleep"] = bool(probe.get("hibernated"))
        except Exception:
            logger.warning("Tab %s validation unavailable", tab_id)
            data["connection_status"] = "unknown"
    return success_response(data)


# ---------------------------------------------------------------------------
# POST /v1/browser/tabs/{tab_id}/navigate
# ---------------------------------------------------------------------------

def _control_active(tab):
    expiry = tab.control_expires_at
    if expiry and expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)
    return bool(tab.control_owner and expiry and expiry > datetime.now(timezone.utc))


def _lock_control_tab(db, tab_id, token, authorization):
    # Claims serialize across workers; never wait for another control update.
    try:
        tab = db.execute(select(BrowserTab).where(BrowserTab.id == tab_id).with_for_update(nowait=True)).scalar_one_or_none()
    except OperationalError:
        db.rollback()
        raise HTTPException(409, "The browser is finishing another action. Try again shortly.")
    if not tab:
        raise HTTPException(404, "Browser tab not found")
    workspace = _resolve_workspace(db, str(tab.workspace_id))
    if not workspace or not _verify_workspace_access(workspace, token, authorization):
        raise HTTPException(401, "Invalid workspace credentials")
    return tab


async def _guard_browser_control(tab_id: str, db: Session = Depends(get_db),
                                 x_workspace_token: Optional[str] = Header(None),
                                 authorization: Optional[str] = Header(None)):
    tab = _lock_control_tab(db, tab_id, x_workspace_token, authorization)
    if _control_active(tab):
        user = resolve_current_user(db, authorization)
        if not user or str(user.id) != tab.control_owner:
            raise HTTPException(409, "A teammate is controlling this browser. Wait until they hand it back.")
    # Do not hold SQL row locks across browser I/O. A previously admitted
    # action may finish; subsequent agent actions are refused until release.
    db.commit()


class BrowserControlRequest(BaseModel):
    token: uuid.UUID
    action: Literal['claim', 'renew', 'release']


class BrowserInputRequest(BaseModel):
    token: uuid.UUID
    kind: Literal['click', 'text', 'key', 'scroll']
    x: float = Field(default=0, ge=0, le=1)
    y: float = Field(default=0, ge=0, le=1)
    text: str = Field(default='', max_length=10000)
    key: str = Field(default='', max_length=80)
    delta_x: float = Field(default=0, ge=-2000, le=2000)
    delta_y: float = Field(default=0, ge=-2000, le=2000)


@router.post('/tabs/{tab_id}/control')
async def control_browser(tab_id: str, body: BrowserControlRequest, db: Session = Depends(get_db),
                          x_workspace_token: Optional[str] = Header(None), authorization: Optional[str] = Header(None)):
    tab = _lock_control_tab(db, tab_id, x_workspace_token, authorization)
    user = resolve_current_user(db, authorization)
    if not user:
        raise HTTPException(401, 'Sign in to take control of this browser.')
    owns = tab.control_owner == str(user.id) and tab.control_token == str(body.token)
    active = _control_active(tab)
    if active and not owns:
        raise HTTPException(409, 'Another viewer is controlling this browser.')
    if body.action == 'release':
        if owns:
            tab.control_owner = tab.control_token = tab.control_expires_at = None
    else:
        if tab.status != 'active':
            raise HTTPException(409, 'Reopen the browser before taking control.')
        if body.action == 'renew' and (not owns or not active):
            raise HTTPException(409, 'Browser control has expired. Take over again to continue.')
        tab.control_owner = str(user.id)
        tab.control_token = str(body.token)
        tab.control_expires_at = datetime.now(timezone.utc) + timedelta(seconds=60)
        _touch(tab)
    db.commit()
    return success_response({'controlling': body.action != 'release'})


@router.post('/tabs/{tab_id}/input')
async def browser_input(tab_id: str, body: BrowserInputRequest, db: Session = Depends(get_db),
                        x_workspace_token: Optional[str] = Header(None), authorization: Optional[str] = Header(None)):
    tab = _lock_control_tab(db, tab_id, x_workspace_token, authorization)
    user = resolve_current_user(db, authorization)
    if not user or not _control_active(tab) or tab.control_owner != str(user.id) or tab.control_token != str(body.token):
        raise HTTPException(409, 'Take over this browser before interacting with it.')
    if tab.status != 'active' or tab.live_url:
        raise HTTPException(409, 'This browser does not accept screenshot input.')
    # Release the row before browser I/O (screenshots also update tab metadata).
    # The page's input lock preserves gesture order with any in-flight action.
    db.commit()
    # Never silently replace the session during a human gesture.
    try:
        result = await BrowserManager.get().human_input(tab_id, body.model_dump(exclude={'token'}))
    except KeyError:
        raise HTTPException(409, 'The browser disconnected. Reconnect and take over again.')
    except Exception:
        logger.exception('Human browser input failed')
        raise HTTPException(400, 'The browser could not complete that action.')
    tab.url = result['url']
    tab.title = result['title']
    _touch(tab)
    db.commit()
    return success_response(result)


@router.post("/tabs/{tab_id}/navigate", dependencies=[Depends(_guard_browser_control)])
async def navigate_tab(
    tab_id: str,
    body: NavigateRequest,
    background_tasks: BackgroundTasks,
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
    except UnsafeURLError as e:
        return json_response(ResponseCode.BAD_REQUEST, str(e), data={"error_code": e.code})
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

    await _record_browser_work(db, workspace, tab, _actor_for(tab, body.source), body.channel, "navigate")

    # Slack browser preview (best-effort, after the response) — see open_tab.
    try:
        from app.services.browser_preview import schedule_browser_preview
        schedule_browser_preview(
            background_tasks, workspace, body.channel, tab,
            _actor_for(tab, body.source), "navigated",
        )
    except Exception as e:
        logger.debug("browser preview hook failed for %s: %s", tab_id, e)

    return success_response(_tab_to_dict(tab))


# ---------------------------------------------------------------------------
# POST /v1/browser/tabs/{tab_id}/reactivate — wake the existing saved session
# ---------------------------------------------------------------------------

@router.post("/tabs/{tab_id}/reactivate", dependencies=[Depends(_guard_browser_control)])
async def reactivate_tab(
    tab_id: str,
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    tab = _get_tab(db, tab_id)
    if not tab or tab.status != "active":
        return json_response(ResponseCode.NOT_FOUND, "Tab not found")
    workspace = _resolve_workspace(db, str(tab.workspace_id))
    if not workspace or not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")
    db.refresh(tab)
    if tab.status != "active":
        raise HTTPException(409, "This browser is no longer open.")
    manager = BrowserManager.get()
    if not tab.session_id:
        await _ensure_connected(tab, db, workspace)
        return success_response(_tab_to_dict(tab))
    session_id = tab.session_id
    try:
        key = resolve_tab_key(tab, workspace)
        await manager.reconnect(tab.id, tab.session_id, api_key=key)
        page = await manager.reactivate_tab(tab.id)
    except Exception:
        logger.warning("BrowserFabric reactivation failed for tab %s", tab_id)
        # Do not leak provider responses or replace sessions on transient errors.
        return json_response(ResponseCode.INTERNAL_ERROR,
                             "BrowserFabric could not reactivate this browser. Your saved session has not been replaced. Please retry.")
    db.refresh(tab)
    if tab.session_id != session_id or tab.status != "active":
        raise HTTPException(409, "Browser session changed. Refresh and retry.")
    tab.live_url = manager.get_live_url(tab.id)
    tab.url = page.get("url") or tab.url
    tab.title = page.get("title") or tab.title
    _touch(tab)
    db.commit()
    return success_response({**_tab_to_dict(tab), "asleep": False, "connection_status": "alive"})


# Explicit legacy replacement/reopen operation; live-view recovery uses reactivate.
@router.post("/tabs/{tab_id}/reconnect", dependencies=[Depends(_guard_browser_control)])
async def reconnect_tab(
    tab_id: str,
    reopen: bool = False,
    confirm_replace: bool = False,
    expected_session_id: Optional[str] = None,
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    tab = _get_tab(db, tab_id)
    if not tab or (tab.status != "active" and not (reopen and tab.status == "closed")):
        return json_response(ResponseCode.NOT_FOUND, "Tab not found")

    workspace = _resolve_workspace(db, str(tab.workspace_id))
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    # Resolve/provision credentials before taking a lifecycle lock: provisioning
    # may commit. After the lock, no helper may release this transaction.
    bf_key, bf_source = await _resolve_bf_key(workspace, db)
    tab = _lock_browser_lifecycle(db, tab_id)
    if tab.status != "active" and not (reopen and tab.status == "closed"):
        return json_response(ResponseCode.NOT_FOUND, "Tab not found")
    was_closed = tab.status == "closed"
    if reopen and not was_closed:
        # A concurrent reopen already completed. Never replace its new session.
        return success_response(_tab_to_dict(tab))
    if not was_closed and not confirm_replace:
        return json_response(ResponseCode.BAD_REQUEST,
                             "Replacing this browser loses unsaved page content and JavaScript state. "
                             "Use reactivate to retry, or explicitly confirm replacement.")
    if not was_closed and expected_session_id != tab.session_id:
        raise HTTPException(409, "Browser session changed. Refresh before replacing it.")
    original_session_id, original_status = tab.session_id, tab.status

    if was_closed and tab.context_id:
        existing = db.execute(select(BrowserTab).where(
            BrowserTab.workspace_id == tab.workspace_id,
            BrowserTab.context_id == tab.context_id,
            BrowserTab.status == "active",
            BrowserTab.id != tab.id,
        )).scalars().first()
        if existing:
            return json_response(ResponseCode.BAD_REQUEST, "This saved browser is already open in another tab")

    manager = BrowserManager.get()

    # Capture a legacy tab's current login before replacing its remote session.
    # This is an on-demand operation on this tab, not a database backfill.
    if not was_closed and tab.session_id and not tab.context_id:
        try:
            old_key = resolve_tab_key(tab, workspace)
            await manager.reconnect(tab.id, tab.session_id, api_key=old_key)
            await _attach_saved_context(tab, db, manager)
        except Exception:
            return json_response(ResponseCode.BAD_REQUEST, "Could not save the current browser session. Retry before reconnecting to avoid losing login state.")

    # Release the old session with ITS OWN credential; if the release can't
    # be confirmed (failure or rotated key), leave a tombstone so the
    # sweeper keeps the old session tracked instead of leaking it.
    db.refresh(tab, attribute_names=["session_id", "status"])
    if (tab.session_id, tab.status) != (original_session_id, original_status):
        raise HTTPException(409, "Browser session changed. Refresh before replacing it.")
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
            .where(BrowserContext.workspace_id == tab.workspace_id)
            .where(BrowserContext.status == "active")
        ).scalar_one_or_none()
        if ctx:
            bb_context_id = ctx.bb_context_id

    # Re-read under the held lock immediately before replacing. Never act on
    # a session selected by an earlier request or the process cache.
    db.refresh(tab, attribute_names=["session_id", "status"])
    if (tab.session_id, tab.status) != (original_session_id, original_status):
        raise HTTPException(409, "Browser session changed. Refresh before replacing it.")
    # Create a new session only for this explicit replacement/reopen request.
    try:
        result = await _open_restored_tab(manager, tab, bb_context_id=bb_context_id, api_key=bf_key)
    except UnsafeURLError as e:
        db.commit()  # keep any tombstone recorded above
        return json_response(ResponseCode.BAD_REQUEST, str(e), data={"error_code": e.code})
    except Exception as e:
        db.commit()  # keep any tombstone recorded above
        logger.error("Reconnect failed: %s", e)
        return json_response(ResponseCode.INTERNAL_ERROR, "Failed to reconnect browser tab")

    # Update DB record
    _replace_session_mapping(db, tab, original_session_id, original_status,
                             manager.get_session_id(tab_id), manager.get_live_url(tab_id))
    _stamp_credential(tab, bf_key, bf_source)
    tab.url = result.get("url", tab.url)
    tab.title = result.get("title", tab.title)
    warnings = result.get("warnings") or []
    if db is not None and not tab.context_id and manager.is_cloud_for(bf_key):
        try:
            await _attach_saved_context(tab, db, manager)
        except Exception:
            warnings.append("context_save_failed: retry saving this browser context")
    tab.last_error = "; ".join(warnings) if warnings else None
    tab.status = "active"
    _touch(tab)
    if was_closed:
        db.add(BrowserUsage(
            workspace_id=str(workspace.id), tab_id=tab.id,
            session_id=tab.session_id, opened_by="human:user",
        ))
    db.commit()

    data = _tab_to_dict(tab)
    if warnings:
        data["warnings"] = warnings
    return success_response(data)


# ---------------------------------------------------------------------------
# POST /v1/browser/tabs/{tab_id}/click
# ---------------------------------------------------------------------------

@router.post("/tabs/{tab_id}/click", dependencies=[Depends(_guard_browser_control)])
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
    except UnsafeURLError as e:
        return json_response(ResponseCode.BAD_REQUEST, str(e), data={"error_code": e.code})
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
    await _record_browser_work(db, workspace, tab, _actor_for(tab, body.source), body.channel, "click")

    return success_response({"tab_id": tab_id, "clicked": body.selector, "url": tab.url})


# ---------------------------------------------------------------------------
# POST /v1/browser/tabs/{tab_id}/type
# ---------------------------------------------------------------------------

@router.post("/tabs/{tab_id}/type", dependencies=[Depends(_guard_browser_control)])
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
    except UnsafeURLError as e:
        return json_response(ResponseCode.BAD_REQUEST, str(e), data={"error_code": e.code})
    manager = BrowserManager.get()
    try:
        await manager.type_text(tab_id, body.selector, body.text, append=body.append)
    except KeyError:
        return json_response(ResponseCode.NOT_FOUND, "Browser tab not found in browser")
    except Exception as e:
        logger.error("Type failed: %s", e)
        return json_response(ResponseCode.INTERNAL_ERROR, f"Type failed: {e}")

    _touch(tab)
    await _record_browser_work(db, workspace, tab, _actor_for(tab, body.source), body.channel, "type")

    return success_response({"tab_id": tab_id, "typed": body.selector})


# ---------------------------------------------------------------------------
# POST /v1/browser/tabs/{tab_id}/press_key
# ---------------------------------------------------------------------------

@router.post("/tabs/{tab_id}/press_key", dependencies=[Depends(_guard_browser_control)])
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
    except UnsafeURLError as e:
        return json_response(ResponseCode.BAD_REQUEST, str(e), data={"error_code": e.code})
    manager = BrowserManager.get()
    try:
        await manager.press_key(tab_id, body.key)
    except KeyError:
        return json_response(ResponseCode.NOT_FOUND, "Browser tab not found in browser")
    except Exception as e:
        logger.error("Press key failed: %s", e)
        return json_response(ResponseCode.INTERNAL_ERROR, f"Press key failed: {e}")

    _touch(tab)
    await _record_browser_work(db, workspace, tab, _actor_for(tab, body.source), body.channel, "press_key")

    return success_response({"tab_id": tab_id, "pressed": body.key})


# ---------------------------------------------------------------------------
# POST /v1/browser/tabs/{tab_id}/evaluate
# ---------------------------------------------------------------------------

@router.post("/tabs/{tab_id}/evaluate", dependencies=[Depends(_guard_browser_control)])
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
    except UnsafeURLError as e:
        return json_response(ResponseCode.BAD_REQUEST, str(e), data={"error_code": e.code})
    manager = BrowserManager.get()
    try:
        result = await manager.evaluate(tab_id, body.expression)
    except KeyError:
        return json_response(ResponseCode.NOT_FOUND, "Browser tab not found in browser")
    except Exception as e:
        logger.error("Evaluate failed: %s", e)
        return json_response(ResponseCode.INTERNAL_ERROR, f"Evaluate failed: {e}")

    _touch(tab)
    await _record_browser_work(db, workspace, tab, _actor_for(tab, body.source), body.channel, "evaluate")

    return success_response({"tab_id": tab_id, "result": result.get("result")})


# ---------------------------------------------------------------------------
# GET /v1/browser/tabs/{tab_id}/screenshot
# ---------------------------------------------------------------------------

@router.get("/tabs/{tab_id}/screenshot")
async def get_screenshot(
    tab_id: str,
    quality: Literal["sd", "original"] = Query("original"),
    source: Optional[str] = Query(None),
    channel: Optional[str] = Query(None),
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
    except UnsafeURLError as e:
        return json_response(ResponseCode.BAD_REQUEST, str(e), data={"error_code": e.code})
    manager = BrowserManager.get()
    try:
        data = await manager.screenshot(tab_id)
        if quality == "sd":
            data = await run_in_threadpool(standard_browser_frame, data)
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

    if source or channel:
        await _record_browser_work(db, workspace, tab, _actor_for(tab, source), channel, "screenshot")

    return Response(
        content=data,
        media_type="image/jpeg" if quality == "sd" else "image/png",
        headers={"Cache-Control": "no-cache, no-store"},
    )


# ---------------------------------------------------------------------------
# GET /v1/browser/tabs/{tab_id}/snapshot
# ---------------------------------------------------------------------------

@router.get("/tabs/{tab_id}/snapshot")
async def get_snapshot(
    tab_id: str,
    source: Optional[str] = Query(None),
    channel: Optional[str] = Query(None),
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
    except UnsafeURLError as e:
        return json_response(ResponseCode.BAD_REQUEST, str(e), data={"error_code": e.code})
    manager = BrowserManager.get()
    try:
        tree = await manager.snapshot(tab_id)
    except KeyError:
        return json_response(ResponseCode.NOT_FOUND, "Browser tab not found in browser")
    except Exception as e:
        logger.error("Snapshot failed: %s", e)
        return json_response(ResponseCode.INTERNAL_ERROR, "Snapshot failed")

    if source or channel:
        await _record_browser_work(db, workspace, tab, _actor_for(tab, source), channel, "snapshot")
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

@router.post("/tabs/{tab_id}/persist", dependencies=[Depends(_guard_browser_control)])
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
        except HTTPException:
            raise
        except BrowserCredentialError as e:
            return json_response(ResponseCode.BAD_REQUEST, str(e))
        except UnsafeURLError as e:
            return json_response(ResponseCode.BAD_REQUEST, str(e), data={"error_code": e.code})
        except Exception as e:
            logger.error("Failed to create persistent context: %s", e)
            return json_response(ResponseCode.INTERNAL_ERROR, "Failed to create persistent context")

    # Saving login state must not replace the live page. The context will be
    # restored on a future explicit reopen; unsaved editor state stays intact.

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

@router.post("/tabs/{tab_id}/unpersist", dependencies=[Depends(_guard_browser_control)])
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

    if tab.session_id or BrowserManager.get().is_cloud_for(_stored_bf_key(workspace)):
        return json_response(ResponseCode.BAD_REQUEST, "Cloud browser tabs are always saved. Close the tab to stop using it; delete its saved context only when you want to remove its login state.")

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

@router.delete("/tabs/{tab_id}", dependencies=[Depends(_guard_browser_control)])
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

    tab = _lock_browser_lifecycle(db, tab_id)
    if tab.status != "active":
        return json_response(ResponseCode.NOT_FOUND, "Tab not found")
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
