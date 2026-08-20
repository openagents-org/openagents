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

import base64
import hashlib
import hmac
import json as _json
import logging
import re
import secrets
import time
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import quote, urlencode

from fastapi import APIRouter, BackgroundTasks, Depends, Header, Request
from fastapi.responses import RedirectResponse
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
_SLACK_STATE_TTL_S = 600

# Bot scopes the official app requests on install. The *:history scopes are
# what make Slack deliver message.im / message.channels / message.groups
# events for conversations the bot is in.
OFFICIAL_SLACK_SCOPES = ",".join([
    "chat:write",
    "chat:write.customize",
    "users:read",
    "im:history",
    "channels:history",
    "groups:history",
])


def _slack_app_configured() -> bool:
    return bool(
        config.SLACK_CLIENT_ID and config.SLACK_CLIENT_SECRET and config.SLACK_SIGNING_SECRET
    )


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class CreateIntegrationRequest(BaseModel):
    platform: str = Field(pattern=r"^(telegram|slack|lark)$")
    # Telegram: BotFather token. Slack: xoxb- bot token. Lark: App Secret.
    bot_token: str = Field(min_length=8)
    signing_secret: Optional[str] = None    # slack only
    default_agent: Optional[str] = None
    name: Optional[str] = None
    # Lark / Feishu custom-app fields
    app_id: Optional[str] = None            # lark: App ID (cli_…)
    verification_token: Optional[str] = None  # lark: event Verification Token
    encrypt_key: Optional[str] = None       # lark: event Encrypt Key (optional)


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
    # Only bring-your-own Slack apps have a per-binding events URL to paste;
    # the official app delivers to one shared, pre-configured endpoint.
    if b.platform == "slack" and b.signing_secret:
        events_url = f"{config.PUBLIC_API_BASE}/v1/integrations/slack/events/{b.id}"
    lark_events_url = None
    if b.platform == "lark":
        lark_events_url = f"{config.PUBLIC_API_BASE}/v1/integrations/lark/events/{b.id}"
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
        # What the user must paste into their Lark app's event subscription.
        "larkEventsUrl": lark_events_url,
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
    return success_response({
        "integrations": [_format_binding(b) for b in bindings],
        # Whether this deployment has the official OpenAgents Slack app —
        # drives the UI's one-click "Add to Slack" vs. bring-your-own-app.
        "slackAppConfigured": _slack_app_configured(),
    })


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
    if body.platform == "lark" and not (
        (body.app_id or "").strip() and (body.verification_token or "").strip()
    ):
        return json_response(
            ResponseCode.BAD_REQUEST,
            "Lark integrations require an App ID and a Verification Token",
        )

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
        elif body.platform == "slack":  # bring-your-own app
            auth = svc.slack_auth_test(binding.bot_token)
            binding.external_team_id = auth.get("team_id")
            binding.config = {
                "teamName": auth.get("team"),
                "teamId": auth.get("team_id"),
                "botUserId": auth.get("user_id"),
            }
            if not binding.name:
                binding.name = auth.get("team") or "Slack workspace"
            db.add(binding)
            db.flush()
        else:  # lark / feishu — bot_token holds the App Secret (see services)
            domain, bot = svc.lark_validate_app(body.app_id.strip(), binding.bot_token)
            binding.signing_secret = body.verification_token.strip()
            binding.webhook_secret = (body.encrypt_key or "").strip() or None
            binding.config = {
                "appId": body.app_id.strip(),
                "domain": domain,
                "botName": bot.get("app_name"),
                "botOpenId": bot.get("open_id"),
            }
            if not binding.name:
                binding.name = bot.get("app_name") or (
                    "Feishu app" if domain == "feishu" else "Lark app"
                )
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
# Official Slack app — one-click "Add to Slack" OAuth install
# ---------------------------------------------------------------------------

def _sign_state(payload: dict) -> str:
    """HMAC-signed OAuth state: carries the workspace through Slack's redirect
    without server-side storage. Keyed off the client secret."""
    raw = base64.urlsafe_b64encode(
        _json.dumps(payload, separators=(",", ":")).encode()
    ).decode().rstrip("=")
    sig = hmac.new(
        config.SLACK_CLIENT_SECRET.encode(), raw.encode(), hashlib.sha256
    ).hexdigest()[:32]
    return f"{raw}.{sig}"


def _verify_state(state: str) -> Optional[dict]:
    try:
        raw, sig = state.rsplit(".", 1)
        expected = hmac.new(
            config.SLACK_CLIENT_SECRET.encode(), raw.encode(), hashlib.sha256
        ).hexdigest()[:32]
        if not hmac.compare_digest(expected, sig):
            return None
        padded = raw + "=" * (-len(raw) % 4)
        payload = _json.loads(base64.urlsafe_b64decode(padded))
        if payload.get("exp", 0) < time.time():
            return None
        return payload
    except Exception:
        return None


@router.get("/workspaces/{workspace_id}/integrations/slack/install-url")
def slack_install_url(
    workspace_id: str,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Mint the Slack authorize URL for this workspace (owner/admin only).
    The frontend redirects the browser there; Slack redirects back to
    /v1/integrations/slack/oauth/callback with a code + our signed state."""
    workspace, err = _load_workspace_for_admin(db, workspace_id, x_workspace_token, authorization)
    if err:
        return err
    if not _slack_app_configured():
        return json_response(
            ResponseCode.BAD_REQUEST,
            "The official Slack app is not configured on this deployment",
        )
    state = _sign_state({
        "ws": str(workspace.id),
        "exp": int(time.time()) + _SLACK_STATE_TTL_S,
        "n": secrets.token_hex(8),
    })
    params = urlencode({
        "client_id": config.SLACK_CLIENT_ID,
        "scope": OFFICIAL_SLACK_SCOPES,
        "state": state,
        "redirect_uri": f"{config.PUBLIC_API_BASE}/v1/integrations/slack/oauth/callback",
    })
    return success_response({"url": f"https://slack.com/oauth/v2/authorize?{params}"})


@router.get("/integrations/slack/oauth/callback")
def slack_oauth_callback(
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Slack redirects the installer's browser here after the OAuth screen.
    Auth comes from the signed state (minted by an admin moments earlier),
    not from workspace headers — this is a top-level browser navigation."""

    def bounce(workspace_ref: Optional[str], ok: bool, detail: str = "") -> RedirectResponse:
        base = config.FRONTEND_BASE_URL.rstrip("/")
        path = f"/{workspace_ref}/settings/integrations" if workspace_ref else "/"
        query = "?slack=connected" if ok else f"?slack_error={quote(detail[:120])}"
        return RedirectResponse(url=f"{base}{path}{query}", status_code=302)

    payload = _verify_state(state or "")
    if payload is None:
        return bounce(None, ok=False, detail="invalid or expired state")
    workspace = db.get(Workspace, payload["ws"])
    if workspace is None or workspace.status == "deleted":
        return bounce(None, ok=False, detail="workspace not found")
    ws_ref = workspace.slug or str(workspace.id)

    if error or not code:
        return bounce(ws_ref, ok=False, detail=error or "missing code")

    try:
        grant = svc.slack_oauth_access(code)
    except ValueError as exc:
        return bounce(ws_ref, ok=False, detail=str(exc))
    except Exception:
        logger.exception("integrations: slack oauth exchange failed")
        return bounce(ws_ref, ok=False, detail="could not reach Slack")

    team = grant.get("team") or {}
    team_id = team.get("id")
    bot_token = grant.get("access_token")
    if not team_id or not bot_token:
        return bounce(ws_ref, ok=False, detail="incomplete OAuth grant")

    # Re-install of the same team into the same workspace updates in place
    # (Slack rotates the token on every install).
    binding = db.execute(
        select(IntegrationBinding).where(
            IntegrationBinding.workspace_id == str(workspace.id),
            IntegrationBinding.platform == "slack",
            IntegrationBinding.external_team_id == team_id,
        )
    ).scalars().first()
    if binding is None:
        binding = IntegrationBinding(
            workspace_id=str(workspace.id),
            platform="slack",
        )
        db.add(binding)
    binding.bot_token = bot_token
    binding.external_team_id = team_id
    binding.name = team.get("name") or "Slack workspace"
    binding.signing_secret = None  # official app verifies with the global secret
    binding.config = {
        "teamName": team.get("name"),
        "teamId": team_id,
        "botUserId": grant.get("bot_user_id"),
        "officialApp": True,
    }
    binding.status = "active"
    binding.last_error = None
    db.commit()
    return bounce(ws_ref, ok=True)


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


def _process_slack_event_callback(
    binding: IntegrationBinding, body: dict, background_tasks: BackgroundTasks,
) -> dict:
    """Handle one event_callback for one binding. Shared by the per-binding
    (custom app) and shared (official app) endpoints."""
    event = body.get("event") or {}
    event_id = body.get("event_id")
    if event_id and svc._seen_before(f"slack:{binding.id}:{event_id}"):
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
        str(binding.id),
        binding.bot_token,
        event.get("channel"),
        event.get("channel_type"),
        event.get("user") or "unknown",
        text,
    )
    return success_response({"ok": True})


@router.post("/integrations/slack/events/{binding_id}")
async def slack_events(
    binding_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Events endpoint for bring-your-own Slack apps (per-binding secret)."""
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

    try:
        body = _json.loads(raw)
    except Exception:
        return json_response(ResponseCode.BAD_REQUEST, "Invalid JSON")

    # URL-verification handshake when the user saves the events URL.
    if body.get("type") == "url_verification":
        return {"challenge": body.get("challenge", "")}

    if body.get("type") != "event_callback":
        return success_response({"ignored": True})

    return _process_slack_event_callback(binding, body, background_tasks)


@router.post("/integrations/slack/events")
async def slack_events_shared(
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Shared events endpoint for the OFFICIAL OpenAgents Slack app.

    One app serves every installed Slack team; events are matched to
    bindings by team id (a team may legitimately be bound to more than one
    workspace — each gets the message in its own bridged channel).
    """
    if not config.SLACK_SIGNING_SECRET:
        return json_response(ResponseCode.NOT_FOUND, "Official Slack app not configured")
    raw = await request.body()
    if not _verify_slack_signature(
        config.SLACK_SIGNING_SECRET,
        request.headers.get("X-Slack-Request-Timestamp", ""),
        raw,
        request.headers.get("X-Slack-Signature", ""),
    ):
        return json_response(ResponseCode.UNAUTHORIZED, "Bad Slack signature")

    try:
        body = _json.loads(raw)
    except Exception:
        return json_response(ResponseCode.BAD_REQUEST, "Invalid JSON")

    if body.get("type") == "url_verification":
        return {"challenge": body.get("challenge", "")}

    if body.get("type") != "event_callback":
        return success_response({"ignored": True})

    team_id = body.get("team_id")
    if not team_id:
        return success_response({"ignored": True})
    bindings = db.execute(
        select(IntegrationBinding).where(
            IntegrationBinding.platform == "slack",
            IntegrationBinding.external_team_id == team_id,
        )
    ).scalars().all()
    if not bindings:
        return success_response({"ignored": True})

    # Uninstall/revocation: mark the team's bindings so the UI shows why the
    # bridge went quiet, instead of silently dropping messages forever.
    event_type = (body.get("event") or {}).get("type")
    if event_type in ("app_uninstalled", "tokens_revoked"):
        for b in bindings:
            b.status = "disabled"
            b.last_error = "Slack app uninstalled or token revoked"
        db.commit()
        return success_response({"disabled": len(bindings)})

    results = [
        _process_slack_event_callback(b, body, background_tasks)
        for b in bindings
        if b.status == "active"
    ]
    return results[0] if results else success_response({"ignored": True})


def _ingest_slack_message(binding_id: str, bot_token: str, channel_id: str,
                          channel_type: Optional[str], user_id: str, text: str) -> None:
    sender_name = svc.slack_user_display_name(bot_token, user_id)
    chat_title = sender_name if channel_type == "im" else f"#{channel_id}"
    svc.ingest_external_message(
        binding_id, channel_id, chat_title, sender_name, text,
        {"slackUserId": user_id, "slackChannelType": channel_type},
    )


# ---------------------------------------------------------------------------
# Lark / Feishu events webhook
# ---------------------------------------------------------------------------

def _lark_text_from_message(message: dict, bot_open_id: Optional[str]) -> str:
    """Extract plain text; swap @_user_N placeholders for readable @names and
    drop the bot's own mention (it's routing noise once bridged)."""
    try:
        text = _json.loads(message.get("content") or "{}").get("text") or ""
    except Exception:
        return ""
    for mention in message.get("mentions") or []:
        key = mention.get("key")
        if not key:
            continue
        mention_open_id = ((mention.get("id") or {}).get("open_id"))
        if bot_open_id and mention_open_id == bot_open_id:
            replacement = ""
        else:
            replacement = f"@{mention.get('name') or 'user'}"
        text = text.replace(key, replacement)
    return text.strip()


@router.post("/integrations/lark/events/{binding_id}")
async def lark_events(
    binding_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Event subscription endpoint for Lark (larksuite.com) / Feishu (feishu.cn)
    custom apps. Handles the url_verification challenge, optional AES event
    encryption, and im.message.receive_v1 messages."""
    binding = db.get(IntegrationBinding, binding_id)
    if binding is None or binding.platform != "lark":
        return json_response(ResponseCode.NOT_FOUND, "Unknown integration")

    raw = await request.body()
    try:
        body = _json.loads(raw)
    except Exception:
        return json_response(ResponseCode.BAD_REQUEST, "Invalid JSON")

    # Encrypted mode wraps the real payload — decrypt before anything else.
    if "encrypt" in body:
        if not binding.webhook_secret:
            return json_response(ResponseCode.UNAUTHORIZED, "Event is encrypted but no Encrypt Key is configured")
        try:
            body = svc.lark_decrypt(binding.webhook_secret, body["encrypt"])
        except Exception:
            return json_response(ResponseCode.UNAUTHORIZED, "Could not decrypt event")

    # Verification token lives at the top level (v1 / challenge) or in the
    # v2 header. Constant-time compare against the binding's token.
    token = body.get("token") or (body.get("header") or {}).get("token") or ""
    if not binding.signing_secret or not hmac.compare_digest(binding.signing_secret, token):
        return json_response(ResponseCode.UNAUTHORIZED, "Bad verification token")

    # Endpoint-registration handshake.
    if body.get("type") == "url_verification":
        return {"challenge": body.get("challenge", "")}

    header = body.get("header") or {}
    if header.get("event_type") != "im.message.receive_v1":
        return success_response({"ignored": True})
    event_id = header.get("event_id")
    if event_id and svc._seen_before(f"lark:{binding_id}:{event_id}"):
        return success_response({"duplicate": True})

    event = body.get("event") or {}
    message = event.get("message") or {}
    sender = event.get("sender") or {}
    sender_open_id = (sender.get("sender_id") or {}).get("open_id")
    cfg = binding.config or {}
    bot_open_id = cfg.get("botOpenId")
    if (
        message.get("message_type") != "text"
        or not message.get("chat_id")
        or sender.get("sender_type") not in (None, "user")
        or (bot_open_id and sender_open_id == bot_open_id)
    ):
        return success_response({"ignored": True})

    text = _lark_text_from_message(message, bot_open_id)
    if not text:
        return success_response({"ignored": True})

    background_tasks.add_task(
        _ingest_lark_message,
        binding_id,
        message.get("chat_id"),
        message.get("chat_type"),
        sender_open_id or "unknown",
        text,
    )
    return success_response({"ok": True})


def _ingest_lark_message(binding_id: str, chat_id: str, chat_type: Optional[str],
                         open_id: str, text: str) -> None:
    # svc.SessionLocal (not app.database's) so tests patching the service's
    # session factory cover this path too.
    db = svc.SessionLocal()
    try:
        binding = db.get(IntegrationBinding, binding_id)
    finally:
        db.close()
    if binding is None:
        return
    sender_name = svc.lark_user_display_name(binding, open_id) if open_id != "unknown" else "user"
    chat_title = sender_name if chat_type == "p2p" else f"Group {chat_id[-6:]}"
    svc.ingest_external_message(
        binding_id, chat_id, chat_title, sender_name, text,
        {"larkOpenId": open_id, "larkChatType": chat_type},
    )
