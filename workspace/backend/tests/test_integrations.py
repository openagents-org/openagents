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
# Lark / Feishu
# ---------------------------------------------------------------------------

LARK_VERIFICATION_TOKEN = "v_token_123"
LARK_ENCRYPT_KEY = "test-encrypt-key"


def _make_lark_binding(client, workspace, monkeypatch, encrypt_key=None):
    monkeypatch.setattr(svc, "lark_validate_app", lambda app_id, secret: (
        "feishu", {"app_name": "OpenAgents Bot", "open_id": "ou_BOT"},
    ))
    body = {
        "platform": "lark",
        "bot_token": "app-secret-value",
        "app_id": "cli_a1b2c3",
        "verification_token": LARK_VERIFICATION_TOKEN,
        "default_agent": "agent-alpha",
    }
    if encrypt_key:
        body["encrypt_key"] = encrypt_key
    resp = client.post(
        f"/v1/workspaces/{workspace['id']}/integrations",
        json=body,
        headers={"X-Workspace-Token": workspace["token"]},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["data"]["integration"]


@pytest.fixture
def lark_binding(client, workspace, monkeypatch):
    return _make_lark_binding(client, workspace, monkeypatch)


def _lark_message_body(text, chat_id="oc_chat1", event_id="LkEv1",
                       mentions=None, sender_open_id="ou_USER1"):
    return {
        "schema": "2.0",
        "header": {
            "event_id": event_id,
            "event_type": "im.message.receive_v1",
            "token": LARK_VERIFICATION_TOKEN,
        },
        "event": {
            "sender": {"sender_type": "user", "sender_id": {"open_id": sender_open_id}},
            "message": {
                "chat_id": chat_id,
                "chat_type": "p2p",
                "message_type": "text",
                "content": json.dumps({"text": text}),
                "mentions": mentions or [],
            },
        },
    }


def test_create_lark_binding(lark_binding):
    assert lark_binding["platform"] == "lark"
    assert lark_binding["name"] == "OpenAgents Bot"
    assert lark_binding["config"]["domain"] == "feishu"
    assert lark_binding["larkEventsUrl"].endswith(f"/v1/integrations/lark/events/{lark_binding['id']}")
    assert lark_binding["slackEventsUrl"] is None


def test_lark_requires_app_id_and_token(client, workspace):
    resp = client.post(
        f"/v1/workspaces/{workspace['id']}/integrations",
        json={"platform": "lark", "bot_token": "app-secret-value"},
        headers={"X-Workspace-Token": workspace["token"]},
    )
    assert resp.status_code == 400


def test_lark_url_verification_challenge(client, lark_binding):
    resp = client.post(
        f"/v1/integrations/lark/events/{lark_binding['id']}",
        json={"type": "url_verification", "challenge": "lark-chal",
              "token": LARK_VERIFICATION_TOKEN},
    )
    assert resp.json()["challenge"] == "lark-chal"


def test_lark_rejects_bad_token(client, lark_binding):
    resp = client.post(
        f"/v1/integrations/lark/events/{lark_binding['id']}",
        json={"type": "url_verification", "challenge": "x", "token": "wrong"},
    )
    assert resp.status_code == 401


def test_lark_message_bridges_into_channel(client, workspace, lark_binding, monkeypatch):
    monkeypatch.setattr(svc, "lark_user_display_name", lambda binding, oid: "Li Lei")
    body = _lark_message_body(
        "@_user_1 hello from feishu @_user_2",
        mentions=[
            {"key": "@_user_1", "id": {"open_id": "ou_BOT"}, "name": "OpenAgents Bot"},
            {"key": "@_user_2", "id": {"open_id": "ou_OTHER"}, "name": "Han Meimei"},
        ],
    )
    resp = client.post(f"/v1/integrations/lark/events/{lark_binding['id']}", json=body)
    assert resp.status_code == 200, resp.text

    channel_name = f"ext-lark-{lark_binding['id'][:8]}-oc_chat1"
    events = client.get(
        "/v1/events",
        params={"network": workspace["id"], "channel": channel_name,
                "type": "workspace.message.posted"},
        headers={"X-Workspace-Token": workspace["token"]},
    ).json()["data"]["events"]
    assert len(events) == 1
    # Bot's own mention stripped; other user's mention readable.
    assert events[0]["payload"]["content"] == "hello from feishu @Han Meimei"
    assert events[0]["source"] == "human:lark-li-lei"


def test_lark_ignores_non_text_and_bot_senders(client, lark_binding):
    body = _lark_message_body("x", event_id="LkEv2")
    body["event"]["message"]["message_type"] = "image"
    resp = client.post(f"/v1/integrations/lark/events/{lark_binding['id']}", json=body)
    assert resp.json()["data"]["ignored"] is True

    body = _lark_message_body("x", event_id="LkEv3", sender_open_id="ou_BOT")
    resp = client.post(f"/v1/integrations/lark/events/{lark_binding['id']}", json=body)
    assert resp.json()["data"]["ignored"] is True


def test_lark_encrypted_event_roundtrip(client, workspace, monkeypatch):
    import base64
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

    binding = _make_lark_binding(client, workspace, monkeypatch, encrypt_key=LARK_ENCRYPT_KEY)

    def encrypt(payload: dict) -> str:
        data = json.dumps(payload).encode()
        pad = 16 - len(data) % 16
        data += bytes([pad]) * pad
        key = hashlib.sha256(LARK_ENCRYPT_KEY.encode()).digest()
        iv = b"0123456789abcdef"
        enc = Cipher(algorithms.AES(key), modes.CBC(iv)).encryptor()
        return base64.b64encode(iv + enc.update(data) + enc.finalize()).decode()

    challenge = {"type": "url_verification", "challenge": "enc-chal",
                 "token": LARK_VERIFICATION_TOKEN}
    resp = client.post(
        f"/v1/integrations/lark/events/{binding['id']}",
        json={"encrypt": encrypt(challenge)},
    )
    assert resp.json()["challenge"] == "enc-chal"


def test_agent_chat_reply_relays_to_lark(client, workspace, lark_binding, monkeypatch):
    monkeypatch.setattr(svc, "lark_user_display_name", lambda binding, oid: "Li Lei")
    client.post(
        f"/v1/integrations/lark/events/{lark_binding['id']}",
        json=_lark_message_body("ni hao", chat_id="oc_relay", event_id="LkEv4"),
    )
    sent = []
    monkeypatch.setattr(
        svc, "_send_lark",
        lambda binding, chat_id, sender, content, **kw: sent.append((chat_id, sender, content)),
    )
    channel_name = f"ext-lark-{lark_binding['id'][:8]}-oc_relay"
    client.post(
        "/v1/events",
        json={
            "type": "workspace.message.posted",
            "source": "openagents:agent-alpha",
            "target": f"channel/{channel_name}",
            "payload": {"content": "你好!", "message_type": "chat"},
            "network": workspace["id"],
        },
        headers={"X-Workspace-Token": workspace["token"]},
    )
    assert sent == [("oc_relay", "agent-alpha", "你好!")]


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


# ---------------------------------------------------------------------------
# One workspace thread per Slack thread / Lark topic
# ---------------------------------------------------------------------------

def _channel_events(client, workspace, channel_name):
    return client.get(
        "/v1/events",
        params={"network": workspace["id"], "channel": channel_name, "type": "workspace.message.posted"},
        headers={"X-Workspace-Token": workspace["token"]},
    ).json()["data"]["events"]


def test_each_slack_thread_is_its_own_workspace_thread(client, db, workspace, slack_binding, monkeypatch):
    from app.models import Channel
    monkeypatch.setattr(svc, "slack_user_display_name", lambda tok, uid: "Jane Doe")

    def post(event_id, text, ts, thread_ts=None):
        event = {"type": "message", "text": text, "user": "U777", "channel": "C0CHAN",
                 "channel_type": "channel", "ts": ts, **({"thread_ts": thread_ts} if thread_ts else {})}
        resp = _slack_post(client, slack_binding["id"], {"type": "event_callback", "event_id": event_id, "event": event})
        assert resp.status_code == 200, resp.text

    post("EvA", "Fix the login bug", "111.1")
    post("EvB", "It fails on Safari", "111.2", thread_ts="111.1")
    post("EvC", "Draft the release notes", "222.1")
    prefix = f"ext-slack-{slack_binding['id'][:8]}-C0CHAN"
    first, second = f"{prefix}~111.1", f"{prefix}~222.1"
    assert [e["payload"]["content"] for e in _channel_events(client, workspace, first)] == [
        "Fix the login bug", "It fails on Safari"]
    assert len(_channel_events(client, workspace, second)) == 1
    titles = {c.name: c.title for c in db.query(Channel).filter(Channel.name.in_([first, second]))}
    assert titles == {first: "Slack: Fix the login bug", second: "Slack: Draft the release notes"}


def test_slack_relay_answers_in_the_thread(monkeypatch, slack_binding):
    calls = []
    monkeypatch.setattr(svc, "resolve_binding_for_channel",
                        lambda ws, name: (type("B", (), {"platform": "slack", "bot_token": "xoxb", "id": "b1"})(), "C0CHAN~111.1"))
    monkeypatch.setattr(svc, "_send_slack", lambda token, chat, sender, content, is_agent, thread_ts=None:
                        calls.append((chat, thread_ts, content)))
    monkeypatch.setattr(svc, "_record_binding_result", lambda *a: None)
    svc.relay_for_event("ws", {"type": "workspace.message.posted", "source": "openagents:agent-alpha",
                               "target": "channel/ext-slack-b1xxxxxx-C0CHAN~111.1",
                               "payload": {"content": "Fixed", "message_type": "chat"}})
    assert calls == [("C0CHAN", "111.1", "Fixed")]


def test_send_slack_and_lark_target_the_thread(monkeypatch):
    posted = []

    class FakeClient:
        def __init__(self, *a, **k): pass
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def post(self, url, **kw):
            posted.append((url, kw.get("json")))
            return type("R", (), {"json": lambda self: {"ok": True, "code": 0}, "status_code": 200})()

    monkeypatch.setattr(svc.httpx, "Client", FakeClient)
    svc._send_slack("xoxb", "C0CHAN", "agent-alpha", "Done", is_agent=True, thread_ts="111.1")
    assert posted[-1][1]["thread_ts"] == "111.1"
    monkeypatch.setattr(svc, "lark_tenant_token", lambda *a: "t")
    binding = type("B", (), {"config": {"appId": "cli_x", "domain": "feishu"}, "id": "b1", "bot_token": "s"})()
    svc._send_lark(binding, "oc_chat1", "agent-alpha", "完成", root_message_id="om_root")
    url, body = posted[-1]
    assert url.endswith("/im/v1/messages/om_root/reply") and body["reply_in_thread"] is True
    svc._send_lark(binding, "oc_chat1", "agent-alpha", "完成")
    assert posted[-1][0].endswith("/im/v1/messages") and posted[-1][1]["receive_id"] == "oc_chat1"


def test_each_lark_topic_is_its_own_workspace_thread(client, workspace, lark_binding, monkeypatch):
    monkeypatch.setattr(svc, "lark_user_display_name", lambda binding, oid: "Li Lei")

    def post(event_id, text, message_id, root_id=None):
        body = _lark_message_body(text, event_id=event_id)
        body["event"]["message"].update({"message_id": message_id, **({"root_id": root_id} if root_id else {})})
        assert client.post(f"/v1/integrations/lark/events/{lark_binding['id']}", json=body).status_code == 200

    post("LkT1", "整理本周问题", "om_1")
    post("LkT2", "按标签分组", "om_2", root_id="om_1")
    post("LkT3", "写发布说明", "om_3")
    prefix = f"ext-lark-{lark_binding['id'][:8]}-oc_chat1"
    assert len(_channel_events(client, workspace, f"{prefix}~om_1")) == 2
    assert len(_channel_events(client, workspace, f"{prefix}~om_3")) == 1


def test_conversation_keys_round_trip():
    assert svc.split_conversation_key(svc.conversation_key("C1", "111.1")) == ("C1", "111.1")
    assert svc.split_conversation_key("C1") == ("C1", None)


# ---------------------------------------------------------------------------
# Telegram markdown rendering
# ---------------------------------------------------------------------------

def test_send_telegram_uses_html_parse_mode_and_escapes(
    client, telegram_binding, monkeypatch
):
    """sendMessage must request parse_mode=HTML and escape raw special chars."""
    sent = []

    class _Resp:
        def json(self):
            return {"ok": True}

    def fake_post(url, json=None):
        sent.append((url, json))
        return _Resp()

    class _Client:
        def __init__(self, timeout=None):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, json=None):
            return fake_post(url, json=json)

    monkeypatch.setattr(svc.httpx, "Client", _Client)
    svc._send_telegram("123:ABCDEF", "555", "agent-alpha", "a < b & **bold** `code`")
    assert len(sent) == 1
    url, payload = sent[0]
    assert payload["parse_mode"] == "HTML"
    assert "&lt;" in payload["text"] and "&amp;" in payload["text"]
    assert "<b>bold</b>" in payload["text"]
    assert "<code>code</code>" in payload["text"]


def test_fenced_code_block_becomes_pre_and_is_not_reformatted():
    md = "before\n```python\nif a < b & c:\n    print('**not bold**')\n```\nafter"
    html = svc._markdown_to_telegram_html(md)
    assert "<pre>" in html and "</pre>" in html
    assert "if a &lt; b &amp; c:" in html
    # markdown inside a code block must stay literal
    assert "**not bold**" in html
    block = html.split("<pre>")[1].split("</pre>")[0]
    assert "<b>" not in block


def test_italic_converts_but_snake_case_stays_literal():
    assert "<i>win</i>" in svc._markdown_to_telegram_html("a *win* here")
    assert "file_name_here" in svc._markdown_to_telegram_html(
        "the file_name_here stays"
    )
    assert "<i>" not in svc._markdown_to_telegram_html("the file_name_here stays")


def test_links_become_html_anchors():
    html = svc._markdown_to_telegram_html("see [docs](https://x.io) now")
    assert '<a href="https://x.io">docs</a>' in html


def test_headings_degrade_to_bold_lines():
    assert "<b>Title</b>" in svc._markdown_to_telegram_html("## Title")
    assert "<b>Deep</b>" in svc._markdown_to_telegram_html("#### Deep")


def test_strikethrough_converts():
    assert "<s>gone</s>" in svc._markdown_to_telegram_html("a ~~gone~~ b")


def test_blockquote_becomes_telegram_blockquote():
    html = svc._markdown_to_telegram_html("> quoted line")
    assert "<blockquote>quoted line</blockquote>" in html


def test_table_degrades_to_pre_block():
    md = "| a | b |\n|---|---|\n| 1 | 2 |"
    html = svc._markdown_to_telegram_html(md)
    assert "<pre>" in html and "| a | b |" in html


def test_chunks_never_leave_unclosed_tags():
    """A >4000-char fenced block must be split with tags re-balanced per chunk."""
    md = "intro\n```\n" + "x" * 5000 + "\n```\noutro"
    chunks = svc._telegram_chunks(svc._markdown_to_telegram_html(md))
    assert len(chunks) >= 2, "should have split"
    for ch in chunks:
        for tag in ("pre", "code", "b", "i", "s", "blockquote"):
            assert ch.count(f"<{tag}>") + ch.count(f"<{tag} ") == ch.count(
                f"</{tag}>"
            ), f"unbalanced <{tag}> in chunk: {ch[:80]!r}"
    assert "".join(chunks).count("x") == 5000  # content survives


def test_short_message_is_single_chunk():
    html = svc._markdown_to_telegram_html("just **one** short message")
    assert svc._telegram_chunks(html) == [html]
