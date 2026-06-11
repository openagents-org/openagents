# -*- coding: utf-8 -*-
"""
Apple Push Notification service (APNs) client — direct HTTP/2, no Firebase
intermediary.

Token-based auth: a single .p8 key generated at
developer.apple.com/account/resources/authkeys/list signs short-lived JWTs
that authenticate each request. The key + key_id + team_id come from env
vars (see app.config). The aioapns library handles JWT signing, HTTP/2
connection reuse, and APNs response framing.

The module exposes one function: `send_push` returns a `(success_tokens,
dead_tokens)` tuple so callers can prune the device_tokens table for
tokens APNs has rejected as Unregistered or BadDeviceToken.
"""

import logging
from dataclasses import dataclass
from typing import Iterable, Optional

from aioapns import APNs, NotificationRequest, PushType
from aioapns.exceptions import ConnectionClosed

from app.config import config

logger = logging.getLogger(__name__)


@dataclass
class APNsAlert:
    """The user-visible portion of a push: title + body + thread grouping."""
    title: str
    body: str
    thread_id: Optional[str] = None  # APNs uses this to group notifications


_client: Optional[APNs] = None


def _load_auth_key() -> Optional[str]:
    """Read the .p8 PEM. Prefer APNS_AUTH_KEY (raw contents) over
    APNS_AUTH_KEY_PATH (local dev) so production deploys don't need a
    writable filesystem."""
    if config.APNS_AUTH_KEY:
        return config.APNS_AUTH_KEY
    if config.APNS_AUTH_KEY_PATH:
        try:
            with open(config.APNS_AUTH_KEY_PATH, "r") as f:
                return f.read()
        except OSError as e:
            logger.warning("apns: could not read APNS_AUTH_KEY_PATH=%s: %s",
                           config.APNS_AUTH_KEY_PATH, e)
            return None
    return None


def _get_client() -> Optional[APNs]:
    """Lazy-init the singleton APNs client. Returns None when APNs is not
    configured — callers should treat that as 'skip push silently'."""
    global _client
    if _client is not None:
        return _client

    auth_key = _load_auth_key()
    if not auth_key or not config.APNS_KEY_ID or not config.APNS_TEAM_ID:
        logger.warning(
            "apns: not configured (key=%s key_id=%s team_id=%s)",
            "set" if auth_key else "missing",
            "set" if config.APNS_KEY_ID else "missing",
            "set" if config.APNS_TEAM_ID else "missing",
        )
        return None

    use_sandbox = config.APNS_ENVIRONMENT.lower() == "sandbox"
    try:
        _client = APNs(
            key=auth_key,
            key_id=config.APNS_KEY_ID,
            team_id=config.APNS_TEAM_ID,
            topic=config.APNS_BUNDLE_ID,
            use_sandbox=use_sandbox,
        )
        logger.info(
            "apns: client initialized (sandbox=%s topic=%s)",
            use_sandbox, config.APNS_BUNDLE_ID,
        )
        return _client
    except Exception as e:
        logger.exception("apns: failed to initialize client: %s", e)
        return None


# APNs response statuses that mean "this token is dead, never send to it again".
# https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns#3855081
_DEAD_TOKEN_REASONS = {
    "BadDeviceToken",
    "Unregistered",
    "DeviceTokenNotForTopic",
    "TopicDisallowed",
    "ExpiredProviderToken",  # not the token's fault but functionally the same
}


async def send_push(
    tokens: Iterable[str],
    alert: APNsAlert,
    data: Optional[dict[str, str]] = None,
) -> tuple[list[str], list[str]]:
    """Send `alert` to every token in parallel; return (sent_ok, dead).

    `dead` is the subset of tokens APNs flagged as Unregistered/Bad/etc.;
    callers should remove those from device_tokens. Other failures (network,
    timeout, throttled) are logged but the tokens are left alone so a later
    retry has a chance.
    """
    token_list = list(tokens)
    if not token_list:
        return [], []

    # Reset the cached client every call so a fresh one is built bound to
    # the current event loop. The fan-out caller uses `asyncio.run(...)`
    # which spins up a new loop per push; reusing a cached `APNs` whose
    # HTTP/2 streams are tied to a closed loop produced "Event loop is
    # closed" / RuntimeError silently dropping every push after the first.
    _reset_client()
    client = _get_client()
    if client is None:
        return [], []

    sent_ok: list[str] = []
    dead: list[str] = []

    for token in token_list:
        payload: dict = {
            "aps": {
                "alert": {
                    "title": alert.title,
                    "body": alert.body,
                },
                "sound": "default",
                "mutable-content": 1,
            },
        }
        if alert.thread_id:
            payload["aps"]["thread-id"] = alert.thread_id
        if data:
            # Top-level custom keys (siblings of "aps") become userInfo
            # entries on the iOS side, same as FCM's `data` payload was.
            for k, v in data.items():
                if k != "aps":
                    payload[k] = v

        request = NotificationRequest(
            device_token=token,
            message=payload,
            push_type=PushType.ALERT,
        )
        try:
            response = await client.send_notification(request)
        except ConnectionClosed:
            # APNs occasionally drops the HTTP/2 connection; reset so the
            # next send re-establishes it. Don't kill the token.
            logger.warning("apns: connection closed mid-send; will reconnect on next call")
            _reset_client()
            continue
        except Exception as e:
            logger.warning("apns: send raised %s for token=%s...", type(e).__name__, token[:8])
            continue

        if response.is_successful:
            sent_ok.append(token)
            continue

        reason = (response.description or "").strip()
        if reason in _DEAD_TOKEN_REASONS:
            dead.append(token)
            logger.info("apns: dead token (reason=%s) %s...", reason, token[:8])
        else:
            logger.warning(
                "apns: non-fatal failure (status=%s reason=%s) token=%s...",
                response.status, reason, token[:8],
            )

    return sent_ok, dead


def _reset_client() -> None:
    """Force the next call to rebuild the APNs client. Used after a
    connection drop or env-var refresh."""
    global _client
    _client = None
