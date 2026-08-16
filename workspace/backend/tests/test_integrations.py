# -*- coding: utf-8 -*-
"""Tests for the Slack/Telegram chat-platform bridge.

Platform HTTP calls are monkeypatched; the bridge's own DB work runs against
the shared in-memory SQLite (``services/integrations`` opens sessions via its
module-level ``SessionLocal``, so we patch that symbol directly).
"""

import hashlib
import hmac
import json
import time

import pytest

import app.services.integrations as svc
from tests.conftest import TestingSessionLocal


@pytest.fixture(autouse=True)
def _patch_service_db(monkeypatch):
    monkeypatch.setattr(svc, "SessionLocal", TestingSessionLocal)
    # Redis is absent in tests — dedupe becomes a no-op pass-through, which is
    # fine except where a test asserts dedupe explicitly (it patches it there).


@pytest.fixture
def telegram_binding(client, workspace, monkeypatch):
    """A connected Telegram integration (platform calls mocked)."""
    monkeypatch.setattr(svc, "telegram_get_me", lambda token: {"username": "testbot", "id": 42})
    calls = {}

    def fake_set_webhook(token, url, secret):
        calls["url"] = url
        calls["secret"] = secret

    monkeypatch.setattr(svc, "telegram_set_webhook", fake_set_webhook)
    resp = client.post(
        f"/v1/workspaces/{workspace['id']}/integrations",
        json={"platform": "telegram", "bot_token": "123:ABCDEF", "default_agent": "agent-alpha"},
        headers={"X-Workspace-Token": workspace["token"]},
    )
    assert resp.status_code == 200, resp.text
    binding = resp.json()["data"]["integration"]
    binding["webhook_calls"] = calls
    return binding


def _get_binding_secret(binding_id):
    from app.models import IntegrationBinding
    db = TestingSessionLocal()
    try:
        return db.get(IntegrationBinding, binding_id).webhook_secret
    finally:
        db.close()


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

def test_create_telegram_binding_sets_webhook(telegram_binding):
    assert telegram_binding["platform"] == "telegram"
    assert telegram_binding["name"] == "@testbot"
    assert telegram_binding["defaultAgent"] == "agent-alpha"
    assert telegram_binding["botTokenMasked"].endswith("CDEF")
    assert telegram_binding["id"] in telegram_binding["webhook_calls"]["url"]
    assert telegram_binding["webhook_calls"]["secret"]


def test_create_requires_admin(client, workspace):
    resp = client.post(
        f"/v1/workspaces/{workspace['id']}/integrations",
        json={"platform": "telegram", "bot_token": "123:ABCDEF"},
    )
    assert resp.status_code in (401, 403)


def test_slack_requires_signing_secret(client, workspace):
    resp = client.post(
        f"/v1/workspaces/{workspace['id']}/integrations",
        json={"platform": "slack", "bot_token": "xoxb-123"},
        headers={"X-Workspace-Token": workspace["token"]},
    )
    assert resp.status_code == 400


def test_list_and_delete(client, workspace, telegram_binding, monkeypatch):
    monkeypatch.setattr(svc, "telegram_delete_webhook", lambda token: None)
    resp = client.get(
        f"/v1/workspaces/{workspace['id']}/integrations",
        headers={"X-Workspace-Token": workspace["token"]},
    )
    listed = resp.json()["data"]["integrations"]
    assert len(listed) == 1
    # Raw token must never appear in the listing payload.
    assert "123:ABCDEF" not in resp.text

    resp = client.delete(
        f"/v1/workspaces/{workspace['id']}/integrations/{telegram_binding['id']}",
        headers={"X-Workspace-Token": workspace["token"]},
    )
    assert resp.status_code == 200
    resp = client.get(
        f"/v1/workspaces/{workspace['id']}/integrations",
        headers={"X-Workspace-Token": workspace["token"]},
    )
    assert resp.json()["data"]["integrations"] == []


# ---------------------------------------------------------------------------
# Telegram webhook → workspace
# ---------------------------------------------------------------------------

def _telegram_update(text, chat_id=555, username="jane"):
    return {
        "update_id": int(time.time() * 1000) % 10**9,
        "message": {
            "message_id": 1,
            "from": {"id": 7, "is_bot": False, "first_name": "Jane", "username": username},
            "chat": {"id": chat_id, "type": "private"},
            "text": text,
        },
    }


def test_telegram_webhook_rejects_bad_secret(client, telegram_binding):
    resp = client.post(
        f"/v1/integrations/telegram/webhook/{telegram_binding['id']}",
        json=_telegram_update("hi"),
        headers={"X-Telegram-Bot-Api-Secret-Token": "wrong"},
    )
    assert resp.status_code == 401


def test_telegram_message_bridges_into_channel(client, workspace, telegram_binding):
    secret = _get_binding_secret(telegram_binding["id"])
    resp = client.post(
        f"/v1/integrations/telegram/webhook/{telegram_binding['id']}",
        json=_telegram_update("hello agents", chat_id=555),
        headers={"X-Telegram-Bot-Api-Secret-Token": secret},
    )
    assert resp.status_code == 200, resp.text

    channel_name = f"ext-telegram-{telegram_binding['id'][:8]}-555"
    resp = client.get(
        "/v1/events",
        params={"network": workspace["id"], "channel": channel_name,
                "type": "workspace.message.posted"},
        headers={"X-Workspace-Token": workspace["token"]},
    )
    events = resp.json()["data"]["events"]
    assert len(events) == 1
    assert events[0]["payload"]["content"] == "hello agents"
    assert events[0]["source"] == "human:telegram-jane"
    assert events[0]["metadata"]["integration"]["platform"] == "telegram"
    # default_agent routing: the auto-created channel is led by agent-alpha
    resp = client.get(
        f"/v1/workspaces/{workspace['id']}/channels/{channel_name}",
        headers={"X-Workspace-Token": workspace["token"]},
    )
    ch = resp.json()["data"]
    assert ch.get("masterAgent") == "agent-alpha" or ch.get("master_agent") == "agent-alpha"


def test_telegram_ignores_non_text_and_bots(client, telegram_binding):
    secret = _get_binding_secret(telegram_binding["id"])
    update = _telegram_update("hi")
    update["message"]["from"]["is_bot"] = True
    resp = client.post(
        f"/v1/integrations/telegram/webhook/{telegram_binding['id']}",
        json=update,
        headers={"X-Telegram-Bot-Api-Secret-Token": secret},
    )
    assert resp.json()["data"]["ignored"] is True

    resp = client.post(
        f"/v1/integrations/telegram/webhook/{telegram_binding['id']}",
        json={"update_id": 1, "message": {"chat": {"id": 5}, "photo": []}},
        headers={"X-Telegram-Bot-Api-Secret-Token": secret},
    )
    assert resp.json()["data"]["ignored"] is True


# ---------------------------------------------------------------------------
# Slack webhook → workspace
# ---------------------------------------------------------------------------

SLACK_SIGNING_SECRET = "8f742231b10e8888abcd99yyyzzz85a5"


@pytest.fixture
def slack_binding(client, workspace, monkeypatch):
    monkeypatch.setattr(
        svc, "slack_auth_test",
        lambda token: {"team": "Acme", "team_id": "T1", "user_id": "UBOT"},
    )
    resp = client.post(
        f"/v1/workspaces/{workspace['id']}/integrations",
        json={"platform": "slack", "bot_token": "xoxb-secret-token",
              "signing_secret": SLACK_SIGNING_SECRET, "default_agent": "agent-alpha"},
        headers={"X-Workspace-Token": workspace["token"]},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["data"]["integration"]


def _slack_post(client, binding_id, body: dict):
    raw = json.dumps(body).encode()
    ts = str(int(time.time()))
    sig = "v0=" + hmac.new(
        SLACK_SIGNING_SECRET.encode(), b"v0:" + ts.encode() + b":" + raw, hashlib.sha256
    ).hexdigest()
    return client.post(
        f"/v1/integrations/slack/events/{binding_id}",
        content=raw,
        headers={
            "Content-Type": "application/json",
            "X-Slack-Request-Timestamp": ts,
            "X-Slack-Signature": sig,
        },
    )


def test_slack_url_verification(client, slack_binding):
    resp = _slack_post(client, slack_binding["id"], {
        "type": "url_verification", "challenge": "chal-123",
    })
    assert resp.status_code == 200
    assert resp.json()["challenge"] == "chal-123"


def test_slack_rejects_bad_signature(client, slack_binding):
    resp = client.post(
        f"/v1/integrations/slack/events/{slack_binding['id']}",
        json={"type": "url_verification", "challenge": "x"},
        headers={"X-Slack-Request-Timestamp": str(int(time.time())),
                 "X-Slack-Signature": "v0=deadbeef"},
    )
    assert resp.status_code == 401


def test_slack_message_bridges_into_channel(client, workspace, slack_binding, monkeypatch):
    monkeypatch.setattr(svc, "slack_user_display_name", lambda tok, uid: "Jane Doe")
    resp = _slack_post(client, slack_binding["id"], {
        "type": "event_callback",
        "event_id": "Ev123",
        "event": {
            "type": "message",
            "text": "hello from slack <@UBOT>",
            "user": "U777",
            "channel": "D0AAA",
            "channel_type": "im",
        },
    })
    assert resp.status_code == 200, resp.text

    channel_name = f"ext-slack-{slack_binding['id'][:8]}-D0AAA"
    resp = client.get(
        "/v1/events",
        params={"network": workspace["id"], "channel": channel_name,
                "type": "workspace.message.posted"},
        headers={"X-Workspace-Token": workspace["token"]},
    )
    events = resp.json()["data"]["events"]
    assert len(events) == 1
    assert events[0]["payload"]["content"] == "hello from slack"
    assert events[0]["source"] == "human:slack-jane-doe"


def test_slack_ignores_bot_and_subtype_messages(client, slack_binding):
    for event in (
        {"type": "message", "text": "x", "channel": "C1", "bot_id": "B1"},
        {"type": "message", "text": "x", "channel": "C1", "subtype": "message_changed"},
        {"type": "reaction_added", "user": "U1"},
    ):
        resp = _slack_post(client, slack_binding["id"], {
            "type": "event_callback", "event_id": f"Ev-{id(event)}", "event": event,
        })
        assert resp.json()["data"]["ignored"] is True


# ---------------------------------------------------------------------------
# Official Slack app — Add to Slack OAuth + shared events endpoint
# ---------------------------------------------------------------------------

OFFICIAL_SIGNING_SECRET = "officialsecret-0123456789abcdef"


@pytest.fixture
def official_app(monkeypatch):
    from app.config import config
    monkeypatch.setattr(config, "SLACK_CLIENT_ID", "111.222")
    monkeypatch.setattr(config, "SLACK_CLIENT_SECRET", "client-secret-xyz")
    monkeypatch.setattr(config, "SLACK_SIGNING_SECRET", OFFICIAL_SIGNING_SECRET)


@pytest.fixture
def official_binding(client, workspace, official_app, monkeypatch):
    """Install the official app into the workspace via the OAuth callback."""
    monkeypatch.setattr(svc, "slack_oauth_access", lambda code: {
        "ok": True,
        "access_token": "xoxb-official-token",
        "bot_user_id": "UOFFBOT",
        "team": {"id": "TOFFICIAL", "name": "Acme Corp"},
    })
    url_resp = client.get(
        f"/v1/workspaces/{workspace['id']}/integrations/slack/install-url",
        headers={"X-Workspace-Token": workspace["token"]},
    )
    assert url_resp.status_code == 200, url_resp.text
    install_url = url_resp.json()["data"]["url"]
    state = dict(
        p.split("=", 1) for p in install_url.split("?", 1)[1].split("&")
    )["state"]
    from urllib.parse import unquote
    resp = client.get(
        "/v1/integrations/slack/oauth/callback",
        params={"code": "authcode", "state": unquote(state)},
        follow_redirects=False,
    )
    assert resp.status_code == 302, resp.text
    assert "slack=connected" in resp.headers["location"]
    listing = client.get(
        f"/v1/workspaces/{workspace['id']}/integrations",
        headers={"X-Workspace-Token": workspace["token"]},
    ).json()["data"]
    assert listing["slackAppConfigured"] is True
    return listing["integrations"][0]


def test_install_url_requires_configured_app(client, workspace):
    resp = client.get(
        f"/v1/workspaces/{workspace['id']}/integrations/slack/install-url",
        headers={"X-Workspace-Token": workspace["token"]},
    )
    assert resp.status_code == 400


def test_oauth_callback_creates_binding(official_binding):
    assert official_binding["platform"] == "slack"
    assert official_binding["name"] == "Acme Corp"
    assert official_binding["config"]["officialApp"] is True
    # No per-binding events URL — the official app uses the shared endpoint.
    assert official_binding["slackEventsUrl"] is None


def test_oauth_callback_rejects_tampered_state(client, workspace, official_app):
    resp = client.get(
        "/v1/integrations/slack/oauth/callback",
        params={"code": "authcode", "state": "forged.deadbeef"},
        follow_redirects=False,
    )
    assert resp.status_code == 302
    assert "slack_error=" in resp.headers["location"]


def test_oauth_reinstall_updates_binding_in_place(
    client, workspace, official_app, official_binding, monkeypatch,
):
    monkeypatch.setattr(svc, "slack_oauth_access", lambda code: {
        "ok": True,
        "access_token": "xoxb-rotated-token",
        "bot_user_id": "UOFFBOT",
        "team": {"id": "TOFFICIAL", "name": "Acme Corp"},
    })
    url = client.get(
        f"/v1/workspaces/{workspace['id']}/integrations/slack/install-url",
        headers={"X-Workspace-Token": workspace["token"]},
    ).json()["data"]["url"]
    from urllib.parse import unquote
    state = unquote(dict(p.split("=", 1) for p in url.split("?", 1)[1].split("&"))["state"])
    client.get(
        "/v1/integrations/slack/oauth/callback",
        params={"code": "authcode2", "state": state},
        follow_redirects=False,
    )
    listing = client.get(
        f"/v1/workspaces/{workspace['id']}/integrations",
        headers={"X-Workspace-Token": workspace["token"]},
    ).json()["data"]["integrations"]
    assert len(listing) == 1  # updated, not duplicated

    from app.models import IntegrationBinding
    db = TestingSessionLocal()
    try:
        binding = db.get(IntegrationBinding, listing[0]["id"])
        assert binding.bot_token == "xoxb-rotated-token"
    finally:
        db.close()


def _shared_slack_post(client, body: dict):
    raw = json.dumps(body).encode()
    ts = str(int(time.time()))
    sig = "v0=" + hmac.new(
        OFFICIAL_SIGNING_SECRET.encode(), b"v0:" + ts.encode() + b":" + raw, hashlib.sha256
    ).hexdigest()
    return client.post(
        "/v1/integrations/slack/events",
        content=raw,
        headers={
            "Content-Type": "application/json",
            "X-Slack-Request-Timestamp": ts,
            "X-Slack-Signature": sig,
        },
    )


def test_shared_events_routes_by_team_id(client, workspace, official_binding, monkeypatch):
    monkeypatch.setattr(svc, "slack_user_display_name", lambda tok, uid: "Bob")
    resp = _shared_slack_post(client, {
        "type": "event_callback",
        "event_id": "EvShared1",
        "team_id": "TOFFICIAL",
        "event": {
            "type": "message", "text": "ping from official app",
            "user": "U555", "channel": "D0BBB", "channel_type": "im",
        },
    })
    assert resp.status_code == 200, resp.text

    channel_name = f"ext-slack-{official_binding['id'][:8]}-D0BBB"
    events = client.get(
        "/v1/events",
        params={"network": workspace["id"], "channel": channel_name,
                "type": "workspace.message.posted"},
        headers={"X-Workspace-Token": workspace["token"]},
    ).json()["data"]["events"]
    assert len(events) == 1
    assert events[0]["payload"]["content"] == "ping from official app"


def test_shared_events_unknown_team_ignored(client, official_binding):
    resp = _shared_slack_post(client, {
        "type": "event_callback",
        "event_id": "EvShared2",
        "team_id": "TNOBODY",
        "event": {"type": "message", "text": "x", "user": "U1",
                  "channel": "C1", "channel_type": "channel"},
    })
    assert resp.json()["data"]["ignored"] is True


def test_shared_events_bad_signature_rejected(client, official_binding):
    resp = client.post(
        "/v1/integrations/slack/events",
        json={"type": "event_callback", "team_id": "TOFFICIAL"},
        headers={"X-Slack-Request-Timestamp": str(int(time.time())),
                 "X-Slack-Signature": "v0=deadbeef"},
    )
    assert resp.status_code == 401


def test_app_uninstalled_disables_binding(client, workspace, official_binding):
    resp = _shared_slack_post(client, {
        "type": "event_callback",
        "event_id": "EvShared3",
        "team_id": "TOFFICIAL",
        "event": {"type": "app_uninstalled"},
    })
    assert resp.json()["data"]["disabled"] == 1
    listing = client.get(
        f"/v1/workspaces/{workspace['id']}/integrations",
        headers={"X-Workspace-Token": workspace["token"]},
    ).json()["data"]["integrations"]
    assert listing[0]["status"] == "disabled"
    assert "uninstalled" in (listing[0]["lastError"] or "")


# ---------------------------------------------------------------------------
# Outbound relay
# ---------------------------------------------------------------------------

def test_agent_chat_reply_relays_to_telegram(client, workspace, telegram_binding, monkeypatch):
    secret = _get_binding_secret(telegram_binding["id"])
    client.post(
        f"/v1/integrations/telegram/webhook/{telegram_binding['id']}",
        json=_telegram_update("hello", chat_id=999),
        headers={"X-Telegram-Bot-Api-Secret-Token": secret},
    )

    sent = []
    monkeypatch.setattr(
        svc, "_send_telegram",
        lambda token, chat_id, sender, content: sent.append((chat_id, sender, content)),
    )
    channel_name = f"ext-telegram-{telegram_binding['id'][:8]}-999"
    resp = client.post(
        "/v1/events",
        json={
            "type": "workspace.message.posted",
            "source": "openagents:agent-alpha",
            "target": f"channel/{channel_name}",
            "payload": {"content": "42 is the answer", "message_type": "chat"},
            "network": workspace["id"],
        },
        headers={"X-Workspace-Token": workspace["token"]},
    )
    assert resp.status_code == 200, resp.text
    assert sent == [("999", "agent-alpha", "42 is the answer")]


def test_status_messages_are_not_relayed(client, workspace, telegram_binding, monkeypatch):
    secret = _get_binding_secret(telegram_binding["id"])
    client.post(
        f"/v1/integrations/telegram/webhook/{telegram_binding['id']}",
        json=_telegram_update("hello", chat_id=888),
        headers={"X-Telegram-Bot-Api-Secret-Token": secret},
    )
    sent = []
    monkeypatch.setattr(
        svc, "_send_telegram",
        lambda token, chat_id, sender, content: sent.append(content),
    )
    channel_name = f"ext-telegram-{telegram_binding['id'][:8]}-888"
    for message_type in ("status", "thinking", "todos"):
        client.post(
            "/v1/events",
            json={
                "type": "workspace.message.posted",
                "source": "openagents:agent-alpha",
                "target": f"channel/{channel_name}",
                "payload": {"content": "Bash › ls", "message_type": message_type},
                "network": workspace["id"],
            },
            headers={"X-Workspace-Token": workspace["token"]},
        )
    assert sent == []


def test_bridged_inbound_message_is_not_echoed_back(client, workspace, telegram_binding, monkeypatch):
    sent = []
    monkeypatch.setattr(
        svc, "_send_telegram",
        lambda token, chat_id, sender, content: sent.append(content),
    )
    secret = _get_binding_secret(telegram_binding["id"])
    client.post(
        f"/v1/integrations/telegram/webhook/{telegram_binding['id']}",
        json=_telegram_update("do not echo me", chat_id=777),
        headers={"X-Telegram-Bot-Api-Secret-Token": secret},
    )
    assert sent == []


def test_relay_ignores_non_integration_channels(client, workspace, monkeypatch):
    sent = []
    monkeypatch.setattr(
        svc, "_send_telegram",
        lambda token, chat_id, sender, content: sent.append(content),
    )
    client.post(
        "/v1/events",
        json={
            "type": "workspace.message.posted",
            "source": "openagents:agent-alpha",
            "target": f"channel/{workspace['channel']}",
            "payload": {"content": "normal thread message", "message_type": "chat"},
            "network": workspace["id"],
        },
        headers={"X-Workspace-Token": workspace["token"]},
    )
    assert sent == []


# ---------------------------------------------------------------------------
# Unit: helpers
# ---------------------------------------------------------------------------

def test_channel_name_roundtrip():
    class B:
        platform = "telegram"
        id = "abcd1234-5678-90ab-cdef-1234567890ab"

    name = svc.channel_name_for(B, "-100555")
    assert name == "ext-telegram-abcd1234--100555"
    assert svc.parse_channel_name(name) == ("telegram", "abcd1234", "-100555")
    assert svc.parse_channel_name("channel-xyz") is None


def test_clean_slack_text():
    from app.routers.integrations import _clean_slack_text
    assert _clean_slack_text("check <https://x.io|this> and <https://y.io>", None) \
        == "check this and https://y.io"
    cleaned = _clean_slack_text("hey <@UBOT> and <@UOTHER>", "UBOT")
    assert "@UOTHER" in cleaned and "UBOT" not in cleaned
