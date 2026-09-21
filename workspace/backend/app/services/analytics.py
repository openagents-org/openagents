# -*- coding: utf-8 -*-
"""Server-side product analytics (PostHog) keyed by account email.

Why server-side: the browser snippet misses a large share of real activity —
ad blockers, mainland-China reachability of the ingestion proxy, the desktop
Launcher's embedded workspace (a Vite bundle without the snippet), and human
messages recorded under non-email identities. Emitting the three funnel
checkpoints here makes them authoritative and identity-consistent
(distinct_id = lowercased email, the same key the web clients ``identify``).

Events (all carry ``source: "server"`` so they can be told apart from the
client-side events of the same journey):

* ``account_created``   — a User row was created (first verified sign-in, or
                          an invite pre-created the row).
* ``workspace_created`` — a workspace was created (explicit or auto-provisioned).
* ``message_posted``    — a human posted a message (one event per message).

Delivery is fire-and-forget on a daemon thread: never blocks a request, never
raises. With no API key configured every call is a no-op.
"""

import logging
import threading
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import httpx

from app.config import config

logger = logging.getLogger(__name__)

LIB_NAME = "openagents-backend"


def analytics_enabled() -> bool:
    return bool(config.POSTHOG_API_KEY) and config.ANALYTICS_ENABLED


def _capture_url() -> str:
    return config.POSTHOG_HOST.rstrip("/") + "/capture/"


def build_payload(
    distinct_id: str,
    event: str,
    properties: Optional[Dict[str, Any]] = None,
    set_props: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """The exact JSON body sent to PostHog (pure; unit-tested)."""
    props: Dict[str, Any] = {"$lib": LIB_NAME, "source": "server"}
    props.update({k: v for k, v in (properties or {}).items() if v is not None})
    if set_props:
        props["$set"] = {k: v for k, v in set_props.items() if v is not None}
    return {
        "api_key": config.POSTHOG_API_KEY,
        "event": event,
        "distinct_id": distinct_id,
        "properties": props,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def _post(payload: Dict[str, Any]) -> bool:
    try:
        resp = httpx.post(_capture_url(), json=payload, timeout=5.0)
        if resp.status_code < 300:
            return True
        logger.warning("analytics: %s rejected %s %s", payload.get("event"), resp.status_code, resp.text[:200])
    except Exception as e:  # noqa: BLE001 — telemetry must never break a request
        logger.warning("analytics: %s failed: %s", payload.get("event"), e)
    return False


def capture(
    distinct_id: Optional[str],
    event: str,
    properties: Optional[Dict[str, Any]] = None,
    set_props: Optional[Dict[str, Any]] = None,
    *,
    blocking: bool = False,
) -> bool:
    """Queue one event. Returns True if it was dispatched (or sent, if blocking)."""
    if not analytics_enabled():
        return False
    distinct_id = (distinct_id or "").strip().lower()
    if not distinct_id:
        return False
    payload = build_payload(distinct_id, event, properties, set_props)
    if blocking:
        return _post(payload)
    threading.Thread(target=_post, args=(payload,), daemon=True, name="posthog-capture").start()
    return True


# ---------------------------------------------------------------------------
# Funnel checkpoints
# ---------------------------------------------------------------------------

def track_account_created(email: str, *, provider: Optional[str], email_verified: bool, via: str = "sign_in") -> bool:
    return capture(
        email,
        "account_created",
        {"provider": provider or "unknown", "email_verified": email_verified, "via": via},
        set_props={"email": email, "auth_provider": provider},
    )


def track_workspace_created(email: Optional[str], workspace_slug: str, *, auto_provisioned: bool, with_agent: bool = False) -> bool:
    return capture(
        email,
        "workspace_created",
        {"workspace_id": workspace_slug, "auto_provisioned": auto_provisioned, "with_agent": with_agent},
    )


def sender_email_for_event(source: Optional[str], payload: Optional[dict], metadata: Optional[dict]) -> Optional[str]:
    """Resolve the human account behind a posted message, or None for agents/system.

    Order: ``human:<email>`` source → payload/metadata email (mobile, launcher,
    embedded clients send it there while ``source`` may be a display name).
    """
    if not source or not source.startswith("human:"):
        return None
    ident = source[len("human:"):].strip().lower()
    if "@" in ident and " " not in ident:
        return ident
    from app.services.message_identity import human_sender_email
    return human_sender_email(payload, metadata)


def track_message_posted(workspace_id: str, event_snapshot: dict) -> None:
    """BackgroundTasks entry: one ``message_posted`` per human message."""
    try:
        email = sender_email_for_event(
            event_snapshot.get("source"), event_snapshot.get("payload"), event_snapshot.get("metadata")
        )
        if not email:
            return
        payload = event_snapshot.get("payload") or {}
        target = event_snapshot.get("target") or ""
        capture(
            email,
            "message_posted",
            {
                "workspace_id": workspace_id,
                "target_kind": target.split("/", 1)[0] if target else None,
                "has_attachments": bool(payload.get("attachments")),
                "has_mentions": bool(payload.get("mentions")),
                "message_type": payload.get("message_type"),
            },
        )
    except Exception:  # noqa: BLE001
        logger.debug("analytics: message_posted skipped", exc_info=True)
