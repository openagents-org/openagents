# -*- coding: utf-8 -*-
"""
Chat-platform integrations — connect Slack / Telegram bots to a workspace.

Admin CRUD (workspace-token or owner/admin bearer):
    GET    /v1/workspaces/{id}/integrations
    POST   /v1/workspaces/{id}/integrations
    PATCH  /v1/workspaces/{id}/integrations/{binding_id}
    DELETE /v1/workspaces/{id}/integrations/{binding_id}

Platform webhooks (called by Telegram / Slack, not by workspace clients —
authenticated by per-binding secrets, not workspace tokens):
    POST /v1/integrations/telegram/webhook/{binding_id}
    POST /v1/integrations/slack/events/{binding_id}

Webhook handlers ACK fast (Slack requires < 3s; Telegram retries on non-200)
and do the actual pipeline work in a background task. See
``services/integrations`` for the bridge logic itself.
"""

import hashlib
import hmac
import logging
import re
import secrets
import time
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Header, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.access import resolve_current_user, verify_workspace_access
from app.config import config
from app.database import get_db
from app.models import IntegrationBinding, Workspace
from app.response import ResponseCode, json_response, success_response
from app.routers.network import _workspace_filter
from app.services import integrations as svc

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["Integrations"])

_SLACK_SIGNATURE_TOLERANCE_S = 300


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class CreateIntegrationRequest(BaseModel):
    platform: str = Field(pattern=r"^(telegram|slack)$")
    bot_token: str = Field(min_length=8)
    signing_secret: Optional[str] = None    # slack only
    default_agent: Optional[str] = None
    name: Optional[str] = None


class UpdateIntegrationRequest(BaseModel):
    default_agent: Optional[str] = None
    name: Optional[str] = None
    status: Optional[str] = Field(default=None, pattern=r"^(active|disabled)$")


# ---------------------------------------------------------------------------
# Serialization
# ---------------------------------------------------------------------------

def _mask_token(token: Optional[str]) -> Optional[str]:
    if not token:
        return None
    return f"…{token[-4:]}" if len(token) > 4 else "…"


def _format_binding(b: IntegrationBinding) -> dict:
    events_url = None
    if b.platform == "slack":
        events_url = f"{config.PUBLIC_API_BASE}/v1/integrations/slack/events/{b.id}"
    return {
        "id": str(b.id),
        "platform": b.platform,
        "name": b.name,
        "botTokenMasked": _mask_token(b.bot_token),
        "defaultAgent": b.default_agent,
        "config": b.config or {},
        "status": b.status,
        "lastError": b.last_error,
        "lastEventAt": b.last_event_at.isoformat() if b.last_event_at else None,
        "createdAt": b.created_at.isoformat() if b.created_at else None,
        # What the user must paste into their Slack app's Event Subscriptions.
        "slackEventsUrl": events_url,
    }


def _load_workspace_for_admin(db, workspace_id, token, authorization):
    """Resolve workspace + enforce owner/admin. Returns (workspace, error)."""
    workspace = db.execute(
        select(Workspace).where(_workspace_filter(workspace_id))
    ).scalar_one_or_none()
    if not workspace or workspace.status == "deleted":
        return None, json_response(ResponseCode.NOT_FOUND, "Workspace not found")
    if not verify_workspace_access(workspace, token, authorization, db=db, min_role="admin"):
        return None, json_response(
            ResponseCode.FORBIDDEN, "Only an owner or admin can manage integrations"
        )
    return workspace, None


# ---------------------------------------------------------------------------
# Admin CRUD
# ---------------------------------------------------------------------------

@router.get("/workspaces/{workspace_id}/integrations")
def list_integrations(
    workspace_id: str,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace, err = _load_workspace_for_admin(db, workspace_id, x_workspace_token, authorization)
    if err:
        return err
    bindings = db.execute(
        select(IntegrationBinding)
        .where(IntegrationBinding.workspace_id == str(workspace.id))
        .order_by(IntegrationBinding.created_at.asc())
    ).scalars().all()
    return success_response({"integrations": [_format_binding(b) for b in bindings]})


@router.post("/workspaces/{workspace_id}/integrations")
def create_integration(
    workspace_id: str,
    body: CreateIntegrationRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace, err = _load_workspace_for_admin(db, workspace_id, x_workspace_token, authorization)
    if err:
        return err

    if body.platform == "slack" and not (body.signing_secret or "").strip():
        return json_response(ResponseCode.BAD_REQUEST, "Slack integrations require a signing secret")

    creator = resolve_current_user(db, authorization)
    binding = IntegrationBinding(
        workspace_id=str(workspace.id),
        platform=body.platform,
        name=(body.name or "").strip() or None,
        bot_token=body.bot_token.strip(),
        signing_secret=(body.signing_secret or "").strip() or None,
        default_agent=(body.default_agent or "").strip() or None,
        created_by=creator.email if creator else None,
        config={},
    )

    # Validate the token against the platform and finish platform-side setup
    # BEFORE committing, so a bad token never leaves a dead binding behind.
    try:
        if body.platform == "telegram":
            me = svc.telegram_get_me(binding.bot_token)
            binding.webhook_secret = secrets.token_urlsafe(24)
            binding.config = {"botUsername": me.get("username"), "botId": me.get("id")}
            if not binding.name:
                binding.name = f"@{me.get('username')}" if me.get("username") else "Telegram bot"
            db.add(binding)
            db.flush()  # need the id for the webhook URL
            svc.telegram_set_webhook(
                binding.bot_token,
                f"{config.PUBLIC_API_BASE}/v1/integrations/telegram/webhook/{binding.id}",
                binding.webhook_secret,
            )
        else:  # slack
            auth = svc.slack_auth_test(binding.bot_token)
            binding.config = {
                "teamName": auth.get("team"),
                "teamId": auth.get("team_id"),
                "botUserId": auth.get("user_id"),
            }
            if not binding.name:
                binding.name = auth.get("team") or "Slack workspace"
            db.add(binding)
            db.flush()
    except ValueError as exc:
        db.rollback()
        return json_response(ResponseCode.BAD_REQUEST, str(exc))
    except Exception:
        db.rollback()
        logger.exception("integrations: platform setup failed")
        return json_response(ResponseCode.INTERNAL_ERROR, "Could not reach the platform API")

    db.commit()
    db.refresh(binding)
    return success_response({"integration": _format_binding(binding)})


@router.patch("/workspaces/{workspace_id}/integrations/{binding_id}")
def update_integration(
    workspace_id: str,
    binding_id: str,
    body: UpdateIntegrationRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace, err = _load_workspace_for_admin(db, workspace_id, x_workspace_token, authorization)
    if err:
        return err
    binding = db.get(IntegrationBinding, binding_id)
    if binding is None or str(binding.workspace_id) != str(workspace.id):
        return json_response(ResponseCode.NOT_FOUND, "Integration not found")

    if body.default_agent is not None:
        binding.default_agent = body.default_agent.strip() or None
    if body.name is not None:
        binding.name = body.name.strip() or None
    if body.status is not None:
        binding.status = body.status
    db.commit()
    db.refresh(binding)
    return success_response({"integration": _format_binding(binding)})


@router.delete("/workspaces/{workspace_id}/integrations/{binding_id}")
def delete_integration(
    workspace_id: str,
    binding_id: str,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace, err = _load_workspace_for_admin(db, workspace_id, x_workspace_token, authorization)
    if err:
        return err
    binding = db.get(IntegrationBinding, binding_id)
    if binding is None or str(binding.workspace_id) != str(workspace.id):
        return json_response(ResponseCode.NOT_FOUND, "Integration not found")

    if binding.platform == "telegram":
        svc.telegram_delete_webhook(binding.bot_token)  # best effort

    db.delete(binding)
    db.commit()
    # Bridged channels are left in place — they hold conversation history.
    return success_response({"id": binding_id, "removed": True})


# ---------------------------------------------------------------------------
# Telegram webhook
# ---------------------------------------------------------------------------

@router.post("/integrations/telegram/webhook/{binding_id}")
def telegram_webhook(
    binding_id: str,
    update: dict,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    x_telegram_bot_api_secret_token: Optional[str] = Header(None),
):
    binding = db.get(IntegrationBinding, binding_id)
    if binding is None:
        return json_response(ResponseCode.NOT_FOUND, "Unknown integration")
    if not binding.webhook_secret or not hmac.compare_digest(
        binding.webhook_secret, x_telegram_bot_api_secret_token or ""
    ):
        return json_response(ResponseCode.UNAUTHORIZED, "Bad webhook secret")

    # Always ACK 200 from here on — Telegram redelivers on any other status,
    # and a malformed update would redeliver forever.
    message = update.get("message") or {}
    text = message.get("text")
    chat = message.get("chat") or {}
    chat_id = chat.get("id")
    if not text or chat_id is None:
        return success_response({"ignored": True})
    update_id = update.get("update_id")
    if update_id is not None and svc._seen_before(f"tg:{binding_id}:{update_id}"):
        return success_response({"duplicate": True})

    sender = message.get("from") or {}
    if sender.get("is_bot"):
        return success_response({"ignored": True})
    sender_name = sender.get("username") or sender.get("first_name") or "user"
    chat_title = chat.get("title") or sender_name

    if text.strip().startswith("/start"):
        # Greet directly; don't bridge the command into the workspace.
        background_tasks.add_task(
            _telegram_greet, binding.bot_token, str(chat_id), binding.default_agent
        )
        return success_response({"ok": True})

    background_tasks.add_task(
        svc.ingest_external_message,
        binding_id,
        str(chat_id),
        chat_title,
        sender_name,
        text,
        {"telegramUserId": sender.get("id")},
    )
    return success_response({"ok": True})


def _telegram_greet(bot_token: str, chat_id: str, default_agent: Optional[str]) -> None:
    who = f"You're talking to {default_agent}." if default_agent \
        else "Your messages are routed to the workspace's agents."
    try:
        import httpx
        with httpx.Client(timeout=15.0) as client:
            client.post(
                f"https://api.telegram.org/bot{bot_token}/sendMessage",
                json={"chat_id": chat_id,
                      "text": f"👋 Connected to your OpenAgents workspace. {who} Just send a message."},
            )
    except Exception:
        logger.warning("integrations: /start greeting failed", exc_info=True)


# ---------------------------------------------------------------------------
# Slack Events API webhook
# ---------------------------------------------------------------------------

def _verify_slack_signature(signing_secret: str, timestamp: str, body: bytes,
                            signature: str) -> bool:
    try:
        if abs(time.time() - float(timestamp)) > _SLACK_SIGNATURE_TOLERANCE_S:
            return False
    except (TypeError, ValueError):
        return False
    base = b"v0:" + timestamp.encode() + b":" + body
    expected = "v0=" + hmac.new(signing_secret.encode(), base, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature or "")


_SLACK_MENTION_RE = re.compile(r"<@([A-Z0-9]+)(?:\|[^>]*)?>")


def _clean_slack_text(text: str, bot_user_id: Optional[str]) -> str:
    """Strip the bot's own mention; keep other mentions readable."""
    def repl(m):
        return "" if bot_user_id and m.group(1) == bot_user_id else f"@{m.group(1)}"
    cleaned = _SLACK_MENTION_RE.sub(repl, text or "")
    # <https://url|label> → label, <https://url> → url
    cleaned = re.sub(r"<(https?://[^>|]+)\|([^>]+)>", r"\2", cleaned)
    cleaned = re.sub(r"<(https?://[^>]+)>", r"\1", cleaned)
    return cleaned.strip()


@router.post("/integrations/slack/events/{binding_id}")
async def slack_events(
    binding_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    raw = await request.body()
    binding = db.get(IntegrationBinding, binding_id)
    if binding is None:
        return json_response(ResponseCode.NOT_FOUND, "Unknown integration")
    if not binding.signing_secret or not _verify_slack_signature(
        binding.signing_secret,
        request.headers.get("X-Slack-Request-Timestamp", ""),
        raw,
        request.headers.get("X-Slack-Signature", ""),
    ):
        return json_response(ResponseCode.UNAUTHORIZED, "Bad Slack signature")

    import json as _json
    try:
        body = _json.loads(raw)
    except Exception:
        return json_response(ResponseCode.BAD_REQUEST, "Invalid JSON")

    # URL-verification handshake when the user saves the events URL.
    if body.get("type") == "url_verification":
        return {"challenge": body.get("challenge", "")}

    if body.get("type") != "event_callback":
        return success_response({"ignored": True})

    event = body.get("event") or {}
    event_id = body.get("event_id")
    if event_id and svc._seen_before(f"slack:{binding_id}:{event_id}"):
        return success_response({"duplicate": True})

    # Only plain user messages. Bot messages (incl. our own relays), edits,
    # joins etc. all carry a subtype or bot_id and are dropped here.
    if (
        event.get("type") != "message"
        or event.get("subtype")
        or event.get("bot_id")
        or not event.get("text")
        or not event.get("channel")
    ):
        return success_response({"ignored": True})

    cfg = binding.config or {}
    bot_user_id = cfg.get("botUserId")
    if event.get("user") and event.get("user") == bot_user_id:
        return success_response({"ignored": True})

    text = _clean_slack_text(event.get("text", ""), bot_user_id)
    if not text:
        return success_response({"ignored": True})

    background_tasks.add_task(
        _ingest_slack_message,
        binding_id,
        binding.bot_token,
        event.get("channel"),
        event.get("channel_type"),
        event.get("user") or "unknown",
        text,
    )
    return success_response({"ok": True})


def _ingest_slack_message(binding_id: str, bot_token: str, channel_id: str,
                          channel_type: Optional[str], user_id: str, text: str) -> None:
    sender_name = svc.slack_user_display_name(bot_token, user_id)
    chat_title = sender_name if channel_type == "im" else f"#{channel_id}"
    svc.ingest_external_message(
        binding_id, channel_id, chat_title, sender_name, text,
        {"slackUserId": user_id, "slackChannelType": channel_type},
    )
