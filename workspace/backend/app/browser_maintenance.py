# -*- coding: utf-8 -*-
"""
Shared-browser maintenance sweep — the backstop against BF session leaks.

Browser Fabric caps ephemeral sessions per API key (free tier: 3), so any
session the backend loses track of permanently eats a slot the user cannot
see or close from the UI. Each pass runs four steps:

0. Stale-claim recovery — rows stuck in close_status='closing' (a worker
   crashed mid-close) flip back to 'close_failed' so they can be retried.

1. Idle reaper — active ephemeral (non-persistent) tabs with no activity
   for BROWSER_TAB_IDLE_MINUTES are closed. Agent-opened tabs whose agent
   crashed mid-task are the main source of these.

2. Orphan release retry — tabs whose BF close failed (close_status=
   'close_failed', session_closed=FALSE) are retried with the key resolved
   from the credential reference persisted on the row.

3. Exhaust transition — rows still failing past
   BROWSER_CLOSE_RETRY_WINDOW_HOURS become close_status='retry_exhausted'
   with a searchable error log. session_closed stays FALSE: we do NOT
   pretend an unconfirmed session was released (there is no evidence BF
   expires them). These rows are left for manual review.

Concurrency: the backend runs multiple replicas, so every row is claimed
via a conditional UPDATE (compare-and-swap on close_status AND session_id)
committed BEFORE the slow BF HTTP call, and the outcome is written with the
same session_id guard — if persist/reconnect swapped in a new session in
the meantime, the outcome write is dropped instead of clobbering the new
session's state. No row lock is held across a BF call. Work per pass is
capped by BROWSER_SWEEP_MAX_ACTIONS per step.
"""

import logging
import os
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update

from app.browser import BrowserManager
from app.browser_creds import BrowserCredentialError, resolve_tab_key
from app.models import BrowserTab, BrowserUsage, Workspace

logger = logging.getLogger(__name__)

BROWSER_TAB_IDLE_MINUTES = int(os.environ.get("BROWSER_TAB_IDLE_MINUTES", "30"))
BROWSER_CLOSE_RETRY_WINDOW_HOURS = int(os.environ.get("BROWSER_CLOSE_RETRY_WINDOW_HOURS", "6"))
BROWSER_CLOSING_STALE_MINUTES = int(os.environ.get("BROWSER_CLOSING_STALE_MINUTES", "10"))
MAX_SWEEP_ACTIONS = int(os.environ.get("BROWSER_SWEEP_MAX_ACTIONS", "10"))


def _finalize_usage(db, tab_id: str, now: datetime) -> None:
    usage = db.execute(
        select(BrowserUsage)
        .where(BrowserUsage.tab_id == tab_id)
        .where(BrowserUsage.ended_at.is_(None))
    ).scalar_one_or_none()
    if usage:
        usage.ended_at = now
        if usage.started_at:
            started = usage.started_at
            if started.tzinfo is None:
                started = started.replace(tzinfo=timezone.utc)
            usage.duration_seconds = int((now - started).total_seconds())


async def _emit_tab_closed(db, workspace: Workspace, tab: BrowserTab) -> None:
    """Best-effort tab.closed event so connected UIs drop the tab."""
    try:
        from app.routers.network import _emit_event
        from openagents.core.onm_events import Event

        payload = {"tab_id": tab.id, "reason": "idle"}
        if tab.context_id:
            payload["context_id"] = tab.context_id
            payload["persistent"] = True
        event = Event(
            type="workspace.browser.tab.closed",
            source="system",
            target="core",
            payload=payload,
        )
        await _emit_event(event, workspace, db, token=workspace.password_hash)
    except Exception as e:
        logger.warning("tab.closed event failed for reaped tab %s: %s", tab.id, e)


def _workspace_for(db, tab: BrowserTab):
    return db.execute(
        select(Workspace).where(Workspace.id == tab.workspace_id)
    ).scalar_one_or_none()


async def _release_claimed(db, manager, tab: BrowserTab, session_snapshot: str, now: datetime) -> bool:
    """Close the claimed tab's BF session and CAS the outcome back.

    The tab row is already in close_status='closing' (claimed by us). The
    outcome UPDATE re-checks session_id so a concurrent persist/reconnect
    swap is never overwritten. Returns True when the release was confirmed.
    """
    workspace = _workspace_for(db, tab)
    try:
        key = resolve_tab_key(tab, workspace)
        released, close_err = await manager.close_tab(
            tab.id, session_id_hint=session_snapshot, api_key=key
        )
    except BrowserCredentialError as e:
        released, close_err = False, str(e)
    except Exception as e:
        logger.warning("Sweep close failed for tab %s: %s", tab.id, e)
        released, close_err = False, "unexpected close error"

    values = {
        "close_attempts": (tab.close_attempts or 0) + 1,
        "last_close_attempt_at": now,
    }
    if released:
        values.update({"close_status": "closed", "session_closed": True, "last_close_error": None})
    else:
        values.update({"close_status": "close_failed", "session_closed": False,
                       "last_close_error": close_err or "unknown close failure"})

    result = db.execute(
        update(BrowserTab)
        .where(BrowserTab.id == tab.id)
        .where(BrowserTab.close_status == "closing")
        .where(BrowserTab.session_id == session_snapshot)
        .values(**values)
    )
    if result.rowcount != 1:
        logger.warning(
            "Sweep outcome dropped for tab %s: session changed while closing "
            "(persist/reconnect swap) — not touching the new session's state", tab.id,
        )
    db.commit()
    return released


async def sweep_browser_tabs() -> dict:
    """One maintenance pass. Never raises; returns counters for logging/tests."""
    stats = {"reaped": 0, "released": 0, "release_failed": 0, "exhausted": 0, "stale_recovered": 0}
    manager = BrowserManager.get()
    # Call-time import so tests can monkeypatch app.database.SessionLocal
    # (same convention as app.main._run_maintenance).
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        retry_floor = now - timedelta(hours=BROWSER_CLOSE_RETRY_WINDOW_HOURS)
        stale_cutoff = now - timedelta(minutes=BROWSER_CLOSING_STALE_MINUTES)

        # ── 0. Recover stale 'closing' claims (crashed workers) ──
        recovered = db.execute(
            update(BrowserTab)
            .where(BrowserTab.close_status == "closing")
            .where(BrowserTab.last_close_attempt_at < stale_cutoff)
            .values(close_status="close_failed")
        )
        if recovered.rowcount:
            stats["stale_recovered"] = recovered.rowcount
            logger.info("Recovered %d stale closing claim(s)", recovered.rowcount)
        db.commit()

        # ── 1. Reap idle ephemeral tabs ──
        idle_cutoff = now - timedelta(minutes=BROWSER_TAB_IDLE_MINUTES)
        idle_tabs = db.execute(
            select(BrowserTab)
            .where(BrowserTab.status == "active")
            .where(BrowserTab.context_id.is_(None))
            .where(BrowserTab.last_active_at < idle_cutoff)
            .order_by(BrowserTab.last_active_at.asc())
            .limit(MAX_SWEEP_ACTIONS)
        ).scalars().all()

        for tab in idle_tabs:
            session_snapshot = tab.session_id
            # Claim: active → closed(closing). The status guard means only one
            # replica (and no user DELETE) wins this tab.
            claim = db.execute(
                update(BrowserTab)
                .where(BrowserTab.id == tab.id)
                .where(BrowserTab.status == "active")
                .values(status="closed", close_status="closing", last_close_attempt_at=now)
            )
            db.commit()
            if claim.rowcount != 1:
                continue  # another replica or a user close got there first

            db.refresh(tab)
            if session_snapshot:
                released = await _release_claimed(db, manager, tab, session_snapshot, now)
            else:
                db.execute(
                    update(BrowserTab)
                    .where(BrowserTab.id == tab.id)
                    .values(close_status="none", session_closed=True)
                )
                released = True
            _finalize_usage(db, tab.id, now)
            db.commit()
            stats["reaped"] += 1
            logger.info("Reaped idle browser tab %s (idle > %dm, released=%s)",
                        tab.id, BROWSER_TAB_IDLE_MINUTES, released)
            workspace = _workspace_for(db, tab)
            if workspace:
                await _emit_tab_closed(db, workspace, tab)

        # ── 2. Retry releasing orphaned BF sessions (within retry window) ──
        orphans = db.execute(
            select(BrowserTab)
            .where(BrowserTab.status != "active")
            .where(BrowserTab.close_status == "close_failed")
            .where(BrowserTab.session_closed.is_(False))
            .where(BrowserTab.session_id.is_not(None))
            .where(BrowserTab.last_active_at >= retry_floor)
            .order_by(BrowserTab.last_active_at.asc())
            .limit(MAX_SWEEP_ACTIONS)
        ).scalars().all()

        for tab in orphans:
            session_snapshot = tab.session_id
            # Claim via CAS on close_status + session_id: only one replica
            # retries, and never against a session that was since replaced.
            claim = db.execute(
                update(BrowserTab)
                .where(BrowserTab.id == tab.id)
                .where(BrowserTab.close_status == "close_failed")
                .where(BrowserTab.session_id == session_snapshot)
                .values(close_status="closing", last_close_attempt_at=now)
            )
            db.commit()
            if claim.rowcount != 1:
                continue

            db.refresh(tab)
            if await _release_claimed(db, manager, tab, session_snapshot, now):
                stats["released"] += 1
                logger.info("Released orphaned BF session %s (tab %s)", session_snapshot, tab.id)
            else:
                stats["release_failed"] += 1

        # ── 3. Exhaust transition: still failing past the retry window ──
        exhausted_rows = db.execute(
            select(BrowserTab.id, BrowserTab.session_id, BrowserTab.close_attempts,
                   BrowserTab.bf_key_fingerprint, BrowserTab.last_close_error)
            .where(BrowserTab.close_status == "close_failed")
            .where(BrowserTab.session_closed.is_(False))
            .where(BrowserTab.session_id.is_not(None))
            .where(BrowserTab.last_active_at < retry_floor)
            .limit(MAX_SWEEP_ACTIONS)
        ).all()
        for row in exhausted_rows:
            db.execute(
                update(BrowserTab)
                .where(BrowserTab.id == row.id)
                .where(BrowserTab.close_status == "close_failed")
                .values(close_status="retry_exhausted")
            )
            # session_closed stays FALSE: the release was never confirmed and
            # we have no evidence BF expires sessions on its own.
            logger.error(
                "browser.session.retry_exhausted tab=%s session=%s attempts=%s key_fp=%s last_error=%s "
                "— remote session unconfirmed after %dh of retries; needs manual review",
                row.id, row.session_id, row.close_attempts,
                (row.bf_key_fingerprint or "")[:12], row.last_close_error,
                BROWSER_CLOSE_RETRY_WINDOW_HOURS,
            )
            stats["exhausted"] += 1
        db.commit()

        if any(stats.values()):
            logger.info("Browser sweep: %s", stats)
        return stats
    except Exception:
        logger.exception("Browser maintenance sweep failed")
        return stats
    finally:
        db.close()
