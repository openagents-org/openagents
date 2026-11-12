# -*- coding: utf-8 -*-
"""
QR-code login (app/routers/qr_login.py).

A computer starts a request and shows its URL as a QR code; a signed-in phone
scans and approves it; the computer's next poll collects a workspace session
for the phone's account — once, and only with the poll secret.
"""

import time
from unittest.mock import patch

import pytest

from app import firebase_auth, qr_login

SECRET = "test-session-secret-0123456789abcdef0123456789abcdef"
PHONE = {"provider": "firebase", "email": "Wei@Example.com", "firebase_uid": "uid-123", "display_name": "Wei"}
OTHER = {"provider": "firebase", "email": "mallory@example.com", "firebase_uid": "uid-999", "display_name": "M"}
CHROME_MAC = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)


@pytest.fixture(autouse=True)
def env(monkeypatch):
    monkeypatch.setattr(firebase_auth.config, "WORKSPACE_SESSION_SECRET", SECRET)
    # The in-process store (no REDIS_URL), emptied per test.
    monkeypatch.setattr(qr_login.cache, "_REDIS_URL", "")
    monkeypatch.setattr(qr_login, "_memory", qr_login._MemoryStore())


def _bearer_for(claims_by_token):
    return patch(
        "app.routers.qr_login.verify_identity_claims",
        side_effect=lambda token: claims_by_token.get(token),
    )


def _start(client, ua=CHROME_MAC, client_kind="web"):
    resp = client.post("/v1/auth/qr", json={"client": client_kind}, headers={"User-Agent": ua})
    assert resp.status_code == 200, resp.text
    return resp.json()["data"]


def _poll(client, data, secret=None):
    return client.post(f"/v1/auth/qr/{data['id']}/poll", json={"poll_secret": secret or data["poll_secret"]})


def _phone(client, action, request_id, token="phone"):
    return client.post(f"/v1/auth/qr/{request_id}/{action}", headers={"Authorization": f"Bearer {token}"})


class TestHappyPath:
    def test_scan_approve_then_one_session(self, client):
        data = _start(client)
        assert data["qr_url"].endswith(f"/qr-login?id={data['id']}")
        assert data["poll_interval_ms"] > 0
        assert _poll(client, data).json()["data"]["status"] == "pending"

        with _bearer_for({"phone": PHONE}):
            scanned = _phone(client, "scan", data["id"])
            assert scanned.status_code == 200, scanned.text
            assert scanned.json()["data"]["device"] == "Chrome on macOS"
            assert scanned.json()["data"]["client"] == "web"
            assert _poll(client, data).json()["data"]["status"] == "scanned"
            assert _phone(client, "approve", data["id"]).status_code == 200

        body = _poll(client, data).json()["data"]
        assert body["status"] == "approved"
        session = body["session"]
        assert session["email"] == "wei@example.com"
        assert session["display_name"] == "Wei"
        claims = firebase_auth.verify_workspace_session(session["session_token"])
        assert claims["email"] == "wei@example.com"
        assert claims["firebase_uid"] == "uid-123"

        # Collected once; the request is gone.
        assert _poll(client, data).json()["data"] == {"status": "expired"}

    def test_approve_without_separate_scan(self, client):
        data = _start(client, client_kind="desktop")
        with _bearer_for({"phone": PHONE}):
            assert _phone(client, "approve", data["id"]).json()["data"]["client"] == "desktop"
        assert _poll(client, data).json()["data"]["status"] == "approved"

    def test_phone_can_cancel(self, client):
        data = _start(client)
        with _bearer_for({"phone": PHONE}):
            _phone(client, "scan", data["id"])
            assert _phone(client, "cancel", data["id"]).json()["data"]["status"] == "cancelled"
            # A cancelled code cannot be approved afterwards.
            assert _phone(client, "approve", data["id"]).status_code == 409
        body = _poll(client, data).json()["data"]
        assert body["status"] == "cancelled" and "session" not in body


class TestRefusals:
    def test_poll_needs_the_secret(self, client):
        data = _start(client)
        with _bearer_for({"phone": PHONE}):
            _phone(client, "approve", data["id"])
        assert _poll(client, data, secret="guess").status_code == 403
        # The wrong secret did not consume it.
        assert _poll(client, data).json()["data"]["status"] == "approved"

    def test_phone_must_be_signed_in(self, client):
        data = _start(client)
        assert client.post(f"/v1/auth/qr/{data['id']}/scan").status_code == 401
        with _bearer_for({}):
            assert _phone(client, "approve", data["id"], token="junk").status_code == 401
        assert _poll(client, data).json()["data"]["status"] == "pending"

    def test_only_the_scanning_account_may_approve(self, client):
        data = _start(client)
        with _bearer_for({"phone": PHONE, "other": OTHER}):
            _phone(client, "scan", data["id"])
            assert _phone(client, "scan", data["id"], token="other").status_code == 409
            assert _phone(client, "approve", data["id"], token="other").status_code == 409
            assert _phone(client, "cancel", data["id"], token="other").status_code == 409
            assert _phone(client, "approve", data["id"]).status_code == 200
        assert _poll(client, data).json()["data"]["session"]["email"] == "wei@example.com"

    def test_used_code_cannot_be_approved_again(self, client):
        data = _start(client)
        with _bearer_for({"phone": PHONE}):
            assert _phone(client, "approve", data["id"]).status_code == 200
            assert _phone(client, "approve", data["id"]).status_code == 409

    def test_unknown_or_malformed_ids(self, client):
        with _bearer_for({"phone": PHONE}):
            assert _phone(client, "scan", "x" * 24).status_code == 410
            assert _phone(client, "scan", "bad id!").status_code == 410
        resp = client.post("/v1/auth/qr/" + "x" * 24 + "/poll", json={"poll_secret": "s"})
        assert resp.json()["data"] == {"status": "expired"}

    def test_codes_expire(self, client):
        data = _start(client)
        later = time.time() + qr_login.CODE_TTL_SECONDS + 1
        with patch("app.qr_login.time.time", return_value=later):
            assert _poll(client, data).json()["data"]["status"] == "expired"
            with _bearer_for({"phone": PHONE}):
                assert _phone(client, "scan", data["id"]).status_code == 410


class TestUnavailable:
    def test_without_session_secret(self, client, monkeypatch):
        monkeypatch.setattr(firebase_auth.config, "WORKSPACE_SESSION_SECRET", "")
        assert client.post("/v1/auth/qr").status_code == 503

    def test_configured_redis_that_is_down_does_not_fall_back_to_memory(self, client, monkeypatch):
        monkeypatch.setattr(qr_login.cache, "_REDIS_URL", "redis://nowhere:6379/0")
        monkeypatch.setattr(qr_login.cache, "_lazy_client", lambda: None)
        assert client.post("/v1/auth/qr").status_code == 503


class TestRedisStore:
    """The same flow against a Redis-shaped store (fakeredis when installed)."""

    def test_flow_on_redis(self, client, monkeypatch):
        fakeredis = pytest.importorskip("fakeredis")
        server = fakeredis.FakeRedis()
        monkeypatch.setattr(qr_login.cache, "_REDIS_URL", "redis://fake:6379/0")
        monkeypatch.setattr(qr_login.cache, "_lazy_client", lambda: server)
        data = _start(client)
        assert server.ttl(f"qr_login:{data['id']}") > 0
        with _bearer_for({"phone": PHONE, "other": OTHER}):
            _phone(client, "scan", data["id"])
            assert _phone(client, "approve", data["id"], token="other").status_code == 409
            _phone(client, "approve", data["id"])
        assert _poll(client, data).json()["data"]["status"] == "approved"
        assert _poll(client, data).json()["data"]["status"] == "expired"
        assert not server.exists(f"qr_login:{data['id']}")


def test_describe_device():
    from app.routers.qr_login import describe_device

    assert describe_device(CHROME_MAC) == "Chrome on macOS"
    assert describe_device("Mozilla/5.0 (Windows NT 10.0) Gecko/20100101 Firefox/133.0") == "Firefox on Windows"
    assert describe_device("Mozilla/5.0 (X11; Linux x86_64) Chrome/131 Safari/537.36 Electron/33 OpenAgentsLauncher/1.2") == "OpenAgents desktop app on Linux"
    assert describe_device("") == "A browser"
