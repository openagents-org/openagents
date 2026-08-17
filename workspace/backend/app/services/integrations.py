# -*- coding: utf-8 -*-
"""
Chat-platform bridge — Slack & Telegram.

Two directions:

Inbound  (platform → workspace): the webhook routes in ``routers/integrations``
    verify the request, then call :func:`ingest_external_message` in a
    background task. The message enters the normal event pipeline as a
    ``human:<platform>-<user>`` source, so routing (@mentions, leader, LLM
    router) applies unchanged. Each external conversation maps to a
    deterministic channel: ``ext-<platform>-<first 8 of binding id>-<chat id>``
    — no per-conversation mapping table.

Outbound (workspace → platform): ``routers/events.send_event`` and the cloud
    agent's ``_post_response`` schedule :func:`relay_for_event` (same pattern
    as push fan-out). It relays only final ``chat`` messages posted into an
    ``ext-…`` channel — never ``status``/``thinking`` spam — back to the
    platform conversation. On Slack the agent's name is carried via the
    ``username`` per-message override (needs ``chat:write.customize``; falls
    back to a ``*name*:`` prefix without it); Telegram has no per-message
    identity, so the name is always prefixed.

Failures are logged and recorded on the binding (``last_error``) but never
raised back into the request that triggered them.
"""

import asyncio
import hashlib
import logging
import re
from datetime import datetime, timezone
from typing import Optional

import httpx
from sqlalchemy import select

from app import cache
from app.database import SessionLocal
from app.models import Channel, ChannelMember, IntegrationBinding, Workspace

logger = logging.getLogger(__name__)

CHANNEL_PREFIX = "ext-"

# Telegram hard limit is 4096 chars/message; we chunk up to 3 messages.
_TELEGRAM_CHUNK = 4000
_TELEGRAM_MAX_CHUNKS = 3
# Slack's hard limit is ~40k; stay well under it.
_SLACK_MAX_CHARS = 12000


def channel_name_for(binding: IntegrationBinding, external_chat_id: str) -> str:
    """Deterministic workspace channel name for one external conversation."""
    return f"{CHANNEL_PREFIX}{binding.platform}-{str(binding.id)[:8]}-{external_chat_id}"


def parse_channel_name(name: str) -> Optional[tuple[str, str, str]]:
    """Inverse of :func:`channel_name_for` → (platform, binding8, chat_id)."""
    if not name.startswith(CHANNEL_PREFIX):
        return None
    parts = name[len(CHANNEL_PREFIX):].split("-", 2)
    if len(parts) != 3 or not all(parts[:2]):
        return None
    return parts[0], parts[1], parts[2]


def _slug(text: str) -> str:
    """Human-source slug: 'Jane Doe' → 'jane-doe' (mention-safe charset)."""
    slug = re.sub(r"[^\w\-]+", "-", (text or "").strip()).strip("-").lower()
    return slug[:48] or "user"


def _seen_before(key: str) -> bool:
    """Best-effort webhook dedupe via Redis (platforms retry on slow acks).

    Not atomic (GET then SET) — a duplicate slipping through under a race is
    acceptable; with Redis down we process everything rather than nothing.
    """
    full = "integr:dedupe:" + key
    if cache.get_bytes(full) is not None:
        return True
    cache.set_bytes(full, b"1", ttl_seconds=600.0)
    return False


def _record_binding_result(binding_id: str, error: Optional[str]) -> None:
    """Persist last_event_at / last_error on the binding (own session)."""
    db = SessionLocal()
    try:
        binding = db.get(IntegrationBinding, binding_id)
        if binding is None:
            return
        binding.last_event_at = datetime.now(timezone.utc)
        binding.last_error = error[:500] if error else None
        db.commit()
    except Exception:
        logger.exception("integrations: failed to record result for %s", binding_id)
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Inbound: platform message → workspace event pipeline
# ---------------------------------------------------------------------------

def _ensure_channel(db, workspace, binding: IntegrationBinding,
                    external_chat_id: str, chat_title: str) -> Channel:
    name = channel_name_for(binding, external_chat_id)
    channel = db.execute(
        select(Channel).where(
            Channel.workspace_id == str(workspace.id),
            Channel.name == name,
        )
    ).scalar_one_or_none()
    if channel is not None:
        return channel

    platform_label = "Slack" if binding.platform == "slack" else "Telegram"
    channel = Channel(
        workspace_id=str(workspace.id),
        name=name,
        title=f"{platform_label}: {chat_title}" if chat_title else f"{platform_label} chat",
        created_by=f"system:integration-{binding.platform}",
        master_agent=binding.default_agent,
        status="active",
    )
    db.add(channel)
    db.flush()
    if binding.default_agent:
        # Append via the relationship (not a bare db.add) so the routing
        # mod's membership auto-add — which reads channel.participants —
        # sees this row and doesn't insert a duplicate.
        channel.participants.append(ChannelMember(agent_name=binding.default_agent))
        db.flush()
    return channel


def ingest_external_message(
    binding_id: str,
    external_chat_id: str,
    chat_title: str,
    sender_name: str,
    text: str,
    external_meta: Optional[dict] = None,
) -> None:
    """Bridge one inbound platform message into the workspace.

    Runs in a background task (threadpool) — opens its own DB session and
    mirrors what ``POST /v1/events`` does after the pipeline: commit, poll-
    cache invalidation, Redis publish, cloud-agent + workflow hooks.
    """
    from app.pipeline_factory import pipeline
    from app.routers.events import _invalidate_poll_cache
    from openagents.core.onm_events import Event
    from openagents.core.onm_mods import EventRejected, PipelineContext

    if not (text or "").strip():
        return

    db = SessionLocal()
    error: Optional[str] = None
    try:
        binding = db.get(IntegrationBinding, binding_id)
        if binding is None or binding.status != "active":
            return
        workspace = db.get(Workspace, binding.workspace_id)
        if workspace is None or workspace.status == "deleted":
            return

        channel = _ensure_channel(db, workspace, binding, external_chat_id, chat_title)

        event = Event(
            type="workspace.message.posted",
            source=f"human:{binding.platform}-{_slug(sender_name)}",
            target=f"channel/{channel.name}",
            payload={"content": text, "message_type": "chat"},
            metadata={
                # Marks the event as bridged-in so relay_for_event never
                # echoes it back to the platform it came from.
                "integration": {
                    "binding_id": str(binding.id),
                    "platform": binding.platform,
                    "chat_id": external_chat_id,
                    **(external_meta or {}),
                },
            },
            visibility="channel",
            network=str(workspace.id),
        )
        context = PipelineContext(
            network_id=str(workspace.id),
            agent_address=event.source,
            db=db,
            workspace=workspace,
            token=workspace.password_hash,
        )
        try:
            asyncio.run(pipeline.process(event, context))
        except EventRejected as exc:
            logger.warning("integrations: inbound event rejected: %s", exc.reason)
            error = f"event rejected: {exc.reason}"
            db.rollback()
            return
        db.commit()

        snapshot = {
            "id": event.id,
            "type": event.type,
            "source": event.source,
            "target": event.target,
            "payload": event.payload,
            "metadata": event.metadata,
            "timestamp": event.timestamp,
        }
        try:
            _invalidate_poll_cache(str(workspace.id), event.type)
        except Exception:
            pass
        try:
            import json as _json
            cache.publish_event(
                f"ws:{workspace.id}:events",
                _json.dumps(snapshot, default=str, separators=(",", ":")).encode(),
            )
        except Exception:
            pass

        # Cloud agents / workflow runs never poll — invoke them like the
        # POST /v1/events route does.
        try:
            from app.services.cloud_agent import invoke_cloud_agents
            asyncio.run(invoke_cloud_agents(str(workspace.id), snapshot))
        except Exception:
            logger.exception("integrations: cloud agent invoke failed")
        try:
            from app.services.workflow import advance_workflow
            advance_workflow(str(workspace.id), snapshot)
        except Exception:
            logger.exception("integrations: workflow advance failed")
    except Exception as exc:
        logger.exception("integrations: inbound ingest failed for %s", binding_id)
        error = str(exc)
    finally:
        db.close()
        _record_binding_result(binding_id, error)


# ---------------------------------------------------------------------------
# Outbound: workspace chat message → platform
# ---------------------------------------------------------------------------

def _display_name(source: str) -> Optional[str]:
    """'openagents:coder' → 'coder'; 'human:jane' → 'jane'; system → None."""
    if source.startswith("openagents:"):
        return source[len("openagents:"):]
    if source.startswith("human:"):
        return source[len("human:"):]
    return None


def relay_for_event(workspace_id: str, event: dict) -> None:
    """Relay a workspace message to the external platform, if applicable.

    Scheduled as a background task on every posted event (cheap no-op for the
    ~all of them that aren't chat messages in an ``ext-…`` channel).
    """
    if event.get("type") != "workspace.message.posted":
        return
    payload = event.get("payload") or {}
    if (payload.get("message_type") or "chat") != "chat":
        return
    target = str(event.get("target") or "")
    if not target.startswith("channel/" + CHANNEL_PREFIX):
        return
    metadata = event.get("metadata") or {}
    if metadata.get("integration"):
        return  # bridged in from the platform — never echo back
    source = str(event.get("source") or "")
    sender = _display_name(source)
    if sender is None:
        return  # system chatter (timers etc.) stays internal
    content = str(payload.get("content") or "").strip()
    if not content:
        return

    parsed = parse_channel_name(target[len("channel/"):])
    if parsed is None:
        return
    platform, binding8, chat_id = parsed

    # Never raise out of a background task — a DB blip here must not surface
    # into the request (or test) that scheduled the relay.
    db = SessionLocal()
    try:
        bindings = db.execute(
            select(IntegrationBinding).where(
                IntegrationBinding.workspace_id == workspace_id,
                IntegrationBinding.platform == platform,
                IntegrationBinding.status == "active",
            )
        ).scalars().all()
        binding = next((b for b in bindings if str(b.id)[:8] == binding8), None)
    except Exception:
        logger.exception("integrations: relay binding lookup failed")
        return
    finally:
        db.close()
    if binding is None:
        return

    error: Optional[str] = None
    try:
        if platform == "telegram":
            _send_telegram(binding.bot_token, chat_id, sender, content)
        elif platform == "slack":
            _send_slack(binding.bot_token, chat_id, sender, content,
                        is_agent=source.startswith("openagents:"))
        elif platform == "lark":
            _send_lark(binding, chat_id, sender, content)
    except Exception as exc:
        logger.exception("integrations: relay to %s failed", platform)
        error = str(exc)
    _record_binding_result(str(binding.id), error)


def _send_telegram(bot_token: str, chat_id: str, sender: str, content: str) -> None:
    text = f"{sender}:\n{content}"
    chunks = [text[i:i + _TELEGRAM_CHUNK] for i in range(0, len(text), _TELEGRAM_CHUNK)]
    if len(chunks) > _TELEGRAM_MAX_CHUNKS:
        chunks = chunks[:_TELEGRAM_MAX_CHUNKS]
        chunks[-1] += "\n… (truncated)"
    with httpx.Client(timeout=15.0) as client:
        for chunk in chunks:
            resp = client.post(
                f"https://api.telegram.org/bot{bot_token}/sendMessage",
                json={"chat_id": chat_id, "text": chunk},
            )
            data = resp.json()
            if not data.get("ok"):
                raise RuntimeError(f"telegram sendMessage: {data.get('description', resp.status_code)}")


def _send_slack(bot_token: str, channel_id: str, sender: str, content: str,
                is_agent: bool) -> None:
    if len(content) > _SLACK_MAX_CHARS:
        content = content[:_SLACK_MAX_CHARS] + "\n… (truncated)"
    headers = {"Authorization": f"Bearer {bot_token}"}
    body = {"channel": channel_id, "text": content, "username": sender}
    with httpx.Client(timeout=15.0) as client:
        resp = client.post("https://slack.com/api/chat.postMessage", headers=headers, json=body)
        data = resp.json()
        if data.get("ok"):
            return
        if data.get("error") == "missing_scope":
            # No chat:write.customize — post under the app's own identity
            # with the sender name inlined instead.
            fallback = {"channel": channel_id, "text": f"*{sender}*: {content}"}
            resp = client.post("https://slack.com/api/chat.postMessage", headers=headers, json=fallback)
            data = resp.json()
            if data.get("ok"):
                return
        raise RuntimeError(f"slack chat.postMessage: {data.get('error', resp.status_code)}")


# ---------------------------------------------------------------------------
# Platform API helpers used by the router (validation / webhook management)
# ---------------------------------------------------------------------------

def telegram_get_me(bot_token: str) -> dict:
    with httpx.Client(timeout=15.0) as client:
        resp = client.get(f"https://api.telegram.org/bot{bot_token}/getMe")
        data = resp.json()
    if not data.get("ok"):
        raise ValueError(f"Telegram rejected the bot token: {data.get('description', 'getMe failed')}")
    return data["result"]


def telegram_set_webhook(bot_token: str, url: str, secret: str) -> None:
    with httpx.Client(timeout=15.0) as client:
        resp = client.post(
            f"https://api.telegram.org/bot{bot_token}/setWebhook",
            json={"url": url, "secret_token": secret, "allowed_updates": ["message"]},
        )
        data = resp.json()
    if not data.get("ok"):
        raise ValueError(f"Telegram setWebhook failed: {data.get('description', 'unknown error')}")


def telegram_delete_webhook(bot_token: str) -> None:
    try:
        with httpx.Client(timeout=15.0) as client:
            client.post(f"https://api.telegram.org/bot{bot_token}/deleteWebhook")
    except Exception:
        logger.warning("integrations: deleteWebhook failed", exc_info=True)


def slack_oauth_access(code: str) -> dict:
    """Exchange an OAuth code for a bot token (official Slack app install)."""
    from app.config import config
    with httpx.Client(timeout=15.0) as client:
        resp = client.post(
            "https://slack.com/api/oauth.v2.access",
            data={
                "client_id": config.SLACK_CLIENT_ID,
                "client_secret": config.SLACK_CLIENT_SECRET,
                "code": code,
            },
        )
        data = resp.json()
    if not data.get("ok"):
        raise ValueError(f"Slack OAuth failed: {data.get('error', 'oauth.v2.access failed')}")
    return data


def slack_auth_test(bot_token: str) -> dict:
    with httpx.Client(timeout=15.0) as client:
        resp = client.post(
            "https://slack.com/api/auth.test",
            headers={"Authorization": f"Bearer {bot_token}"},
        )
        data = resp.json()
    if not data.get("ok"):
        raise ValueError(f"Slack rejected the bot token: {data.get('error', 'auth.test failed')}")
    return data


# ---------------------------------------------------------------------------
# Lark / Feishu
# ---------------------------------------------------------------------------
#
# Column mapping for platform="lark" (reuses the Slack/Telegram columns —
# no schema change needed):
#   bot_token       → App Secret
#   signing_secret  → event Verification Token
#   webhook_secret  → event Encrypt Key (optional; AES-256-CBC when set)
#   config          → {appId, domain ("feishu"|"lark"), botName, botOpenId}

LARK_DOMAINS = {
    "feishu": "https://open.feishu.cn",
    "lark": "https://open.larksuite.com",
}

# Lark's hard cap on a text message is ~150KB; stay far under it.
_LARK_MAX_CHARS = 20000


def lark_tenant_token(binding_id: str, app_id: str, app_secret: str, domain: str) -> str:
    """tenant_access_token for API calls, cached in Redis (~2h validity)."""
    cache_key = f"integr:larktok:{binding_id}"
    cached = cache.get_bytes(cache_key)
    if cached:
        return cached.decode("utf-8")
    base = LARK_DOMAINS.get(domain, LARK_DOMAINS["feishu"])
    with httpx.Client(timeout=15.0) as client:
        resp = client.post(
            f"{base}/open-apis/auth/v3/tenant_access_token/internal",
            json={"app_id": app_id, "app_secret": app_secret},
        )
        data = resp.json()
    if data.get("code") != 0 or not data.get("tenant_access_token"):
        raise ValueError(f"Lark auth failed: {data.get('msg', 'tenant_access_token error')}")
    token = data["tenant_access_token"]
    expire = int(data.get("expire") or 3600)
    cache.set_bytes(cache_key, token.encode("utf-8"), ttl_seconds=max(60, expire - 300))
    return token


def lark_validate_app(app_id: str, app_secret: str) -> tuple[str, dict]:
    """Validate credentials and detect the API domain.

    A Feishu (China) app's credentials only work on open.feishu.cn and a Lark
    (international) app's only on open.larksuite.com, so trying both is a
    reliable domain probe. Returns (domain, bot_info).
    """
    last_error: Optional[Exception] = None
    for domain, base in LARK_DOMAINS.items():
        try:
            with httpx.Client(timeout=15.0) as client:
                resp = client.post(
                    f"{base}/open-apis/auth/v3/tenant_access_token/internal",
                    json={"app_id": app_id, "app_secret": app_secret},
                )
                data = resp.json()
                if data.get("code") != 0:
                    last_error = ValueError(data.get("msg", "auth failed"))
                    continue
                token = data["tenant_access_token"]
                bot = client.get(
                    f"{base}/open-apis/bot/v3/info",
                    headers={"Authorization": f"Bearer {token}"},
                ).json()
            if bot.get("code") != 0:
                last_error = ValueError(bot.get("msg", "bot/v3/info failed — is the Bot capability enabled?"))
                continue
            return domain, bot.get("bot") or {}
        except ValueError as exc:
            last_error = exc
        except Exception as exc:  # network trouble on this domain — try the other
            last_error = exc
    raise ValueError(f"Lark/Feishu rejected the app credentials: {last_error}")


def lark_decrypt(encrypt_key: str, encrypted_b64: str) -> dict:
    """Decrypt a Lark encrypted event: AES-256-CBC, key=SHA256(encrypt_key),
    IV = first 16 bytes of the decoded payload, PKCS7 padding."""
    import base64
    import json as _json
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

    data = base64.b64decode(encrypted_b64)
    key = hashlib.sha256(encrypt_key.encode("utf-8")).digest()
    decryptor = Cipher(algorithms.AES(key), modes.CBC(data[:16])).decryptor()
    plain = decryptor.update(data[16:]) + decryptor.finalize()
    plain = plain[: -plain[-1]]  # strip PKCS7 padding
    return _json.loads(plain.decode("utf-8"))


def _send_lark(binding, chat_id: str, sender: str, content: str) -> None:
    import json as _json
    cfg = binding.config or {}
    app_id = cfg.get("appId")
    domain = cfg.get("domain", "feishu")
    if not app_id:
        raise RuntimeError("lark binding missing appId")
    token = lark_tenant_token(str(binding.id), app_id, binding.bot_token, domain)
    text = f"{sender}:\n{content}"
    if len(text) > _LARK_MAX_CHARS:
        text = text[:_LARK_MAX_CHARS] + "\n… (truncated)"
    base = LARK_DOMAINS.get(domain, LARK_DOMAINS["feishu"])
    with httpx.Client(timeout=15.0) as client:
        resp = client.post(
            f"{base}/open-apis/im/v1/messages",
            params={"receive_id_type": "chat_id"},
            headers={"Authorization": f"Bearer {token}"},
            json={
                "receive_id": chat_id,
                "msg_type": "text",
                "content": _json.dumps({"text": text}),
            },
        )
        data = resp.json()
    if data.get("code") != 0:
        raise RuntimeError(f"lark im/v1/messages: {data.get('msg', resp.status_code)}")


def lark_user_display_name(binding, open_id: str) -> str:
    """Resolve an open_id to a name (needs a contact scope; falls back to a
    short anonymous handle without it). Redis-cached for 1h."""
    cache_key = f"integr:larkuser:{open_id}"
    cached = cache.get_bytes(cache_key)
    if cached:
        return cached.decode("utf-8", "replace")
    name = f"user-{open_id[-6:]}"
    try:
        cfg = binding.config or {}
        token = lark_tenant_token(
            str(binding.id), cfg.get("appId"), binding.bot_token, cfg.get("domain", "feishu")
        )
        base = LARK_DOMAINS.get(cfg.get("domain", "feishu"), LARK_DOMAINS["feishu"])
        with httpx.Client(timeout=10.0) as client:
            resp = client.get(
                f"{base}/open-apis/contact/v3/users/{open_id}",
                params={"user_id_type": "open_id"},
                headers={"Authorization": f"Bearer {token}"},
            )
            data = resp.json()
        if data.get("code") == 0:
            user = (data.get("data") or {}).get("user") or {}
            name = user.get("name") or name
    except Exception:
        logger.debug("integrations: lark user lookup failed for %s", open_id, exc_info=True)
    cache.set_bytes(cache_key, name.encode("utf-8"), ttl_seconds=3600.0)
    return name


def slack_user_display_name(bot_token: str, user_id: str) -> str:
    """Resolve a Slack user id to a display name, cached in Redis for 1h."""
    cache_key = f"integr:slackuser:{user_id}"
    cached = cache.get_bytes(cache_key)
    if cached:
        return cached.decode("utf-8", "replace")
    name = user_id
    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.get(
                "https://slack.com/api/users.info",
                headers={"Authorization": f"Bearer {bot_token}"},
                params={"user": user_id},
            )
            data = resp.json()
        if data.get("ok"):
            profile = (data.get("user") or {}).get("profile") or {}
            name = (
                profile.get("display_name")
                or profile.get("real_name")
                or (data.get("user") or {}).get("name")
                or user_id
            )
    except Exception:
        logger.debug("integrations: users.info failed for %s", user_id, exc_info=True)
    cache.set_bytes(cache_key, name.encode("utf-8"), ttl_seconds=3600.0)
    return name
