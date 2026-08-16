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
