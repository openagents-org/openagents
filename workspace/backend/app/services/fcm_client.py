# -*- coding: utf-8 -*-
"""
Firebase Cloud Messaging (FCM) client — the single send path for every
mobile platform.

This replaces the previous direct-APNs client. iOS and Android both receive
pushes through FCM now: one credential to rotate, one delivery report to
read, and the iOS-specific knobs (sound, badge, thread grouping) are still
expressed via `messaging.APNSConfig`, which FCM forwards to APNs verbatim.

Auth: a Firebase **service account** JSON, supplied whole in the
`FIREBASE_CREDENTIALS_JSON` env var. The Admin SDK app is initialized once
by `app.firebase_auth._init_firebase()` and shared with the login-token
verification path — do not call `firebase_admin.initialize_app()` here, a
second call on the default app raises.

Note the credential requirement is stricter than login verification's:
`_init_firebase()` will happily come up with a no-op credential when only
`FIREBASE_PROJECT_ID` is set, because verifying an ID token needs nothing
but Google's public certs. *Sending* is an authenticated API call, so this
module additionally insists on a real service account and otherwise skips
silently (matching the old client's "not configured → log and move on").

The module exposes one function, `send_push`, returning a
`(sent_ok, dead_tokens)` tuple so callers can prune `device_tokens` of
registrations FCM has told us are gone for good.
"""

import logging
from dataclasses import dataclass
from typing import Iterable, Optional

from app.config import config

logger = logging.getLogger(__name__)

# The Android notification channel the mobile app declares as its default
# (`com.google.firebase.messaging.default_notification_channel_id` in
# AndroidManifest.xml). Sending a channel_id that doesn't exist on the
# device means the notification is dropped on Android 8+, so this string
# must stay in lockstep with the client.
ANDROID_CHANNEL_ID = "thread_updates"

# send_each_for_multicast accepts at most 500 tokens per call.
_MAX_TOKENS_PER_CALL = 500


@dataclass
class PushAlert:
    """The user-visible portion of a push: title + body + thread grouping.

    `thread_id` groups related notifications — it maps to APNs `thread-id`
    on iOS and to the Android notification `tag` (same channel, so an
    update to a thread replaces its previous entry rather than stacking).
    """
    title: str
    body: str
    thread_id: Optional[str] = None


# Backwards-compatible alias: push.py and its tests referred to the alert
# dataclass by the old APNs-flavored name.
APNsAlert = PushAlert


_configured_warning_logged = False


def _messaging_ready() -> bool:
    """True when the Admin SDK is initialized with credentials that can send.

    Returns False (after one warning) when the deployment has no service
    account configured — a self-hosted instance without Firebase should not
    see a traceback on every workspace message.
    """
    global _configured_warning_logged

    if not config.FIREBASE_CREDENTIALS_JSON:
        if not _configured_warning_logged:
            _configured_warning_logged = True
            logger.warning(
                "fcm: not configured — FIREBASE_CREDENTIALS_JSON is empty, "
                "push notifications are disabled"
            )
        return False

    from app.firebase_auth import _init_firebase

    if not _init_firebase():
        if not _configured_warning_logged:
            _configured_warning_logged = True
            logger.warning("fcm: Firebase Admin SDK failed to initialize; push disabled")
        return False
    return True


def _stringify(data: Optional[dict]) -> dict[str, str]:
    """FCM rejects a `data` map with non-string values, and the failure is a
    400 for the whole batch rather than a per-token error. Coerce everything
    and drop keys whose value is None so an absent field is simply absent
    rather than the literal string "None" on the client."""
    if not data:
        return {}
    out: dict[str, str] = {}
    for key, value in data.items():
        if value is None:
            continue
        out[str(key)] = value if isinstance(value, str) else str(value)
    return out


def _build_message(alert: PushAlert, data: dict[str, str], tokens: list[str]):
    from firebase_admin import messaging

    aps_alert = messaging.ApsAlert(title=alert.title, body=alert.body)
    return messaging.MulticastMessage(
        tokens=tokens,
        # `notification` is what lets the OS draw the banner with the app
        # dead — a data-only message would be handed to a background
        # isolate that never runs after force-quit on iOS.
        notification=messaging.Notification(title=alert.title, body=alert.body),
        data=data,
        android=messaging.AndroidConfig(
            priority="high",
            notification=messaging.AndroidNotification(
                channel_id=ANDROID_CHANNEL_ID,
                sound="default",
                tag=alert.thread_id or None,
            ),
        ),
        apns=messaging.APNSConfig(
            headers={"apns-priority": "10", "apns-push-type": "alert"},
            payload=messaging.APNSPayload(
                aps=messaging.Aps(
                    alert=aps_alert,
                    sound="default",
                    thread_id=alert.thread_id or None,
                    # Wakes the app's notification-service extension so it
                    # can enrich the banner, and lets a foregrounded app
                    # refresh the thread before the user taps.
                    mutable_content=True,
                    content_available=True,
                ),
            ),
        ),
    )


def _is_dead_token(exc: Exception) -> bool:
    """Whether `exc` means "this registration token will never work again".

    - UnregisteredError: the app was uninstalled or the token rotated.
    - SenderIdMismatchError: the token belongs to a different Firebase
      project (e.g. left over from a previous build's google-services file).
    - InvalidArgumentError: a malformed token — including every APNs device
      token still sitting in `device_tokens` from before this migration.
    Anything else (unavailable, internal, quota) is transient: keep the row
    and let the next event retry.
    """
    from firebase_admin import exceptions as fb_exceptions
    from firebase_admin import messaging

    return isinstance(
        exc,
        (
            messaging.UnregisteredError,
            messaging.SenderIdMismatchError,
            fb_exceptions.InvalidArgumentError,
        ),
    )


def send_push(
    tokens: Iterable[str],
    alert: PushAlert,
    data: Optional[dict] = None,
) -> tuple[list[str], list[str]]:
    """Send `alert` to every token; return (sent_ok, dead).

    Synchronous and blocking — the Admin SDK's messaging API is sync. The
    only caller is `push.fanout_for_event`, a plain `def` handed to FastAPI
    BackgroundTasks, which Starlette runs in a threadpool. Do not call this
    from a coroutine without `asyncio.to_thread`.

    `dead` is the subset of tokens FCM permanently rejected; callers should
    delete those rows. Transient failures are logged and the token left
    alone so a later event retries it.
    """
    token_list = [t for t in tokens if t]
    if not token_list:
        return [], []
    if not _messaging_ready():
        return [], []

    from firebase_admin import messaging

    payload = _stringify(data)
    sent_ok: list[str] = []
    dead: list[str] = []

    for start in range(0, len(token_list), _MAX_TOKENS_PER_CALL):
        chunk = token_list[start:start + _MAX_TOKENS_PER_CALL]
        try:
            batch = messaging.send_each_for_multicast(_build_message(alert, payload, chunk))
        except Exception as e:
            # A whole-batch failure (bad credentials, network) — nothing to
            # learn about individual tokens, so nothing gets pruned.
            logger.warning("fcm: batch send failed (%s): %s", type(e).__name__, e)
            continue

        for token, response in zip(chunk, batch.responses):
            if response.success:
                sent_ok.append(token)
                continue
            exc = response.exception
            if exc is not None and _is_dead_token(exc):
                dead.append(token)
                logger.info("fcm: dead token (%s) %s…", type(exc).__name__, token[:8])
            else:
                logger.warning(
                    "fcm: non-fatal failure (%s) token=%s…",
                    type(exc).__name__ if exc else "unknown", token[:8],
                )

    return sent_ok, dead
