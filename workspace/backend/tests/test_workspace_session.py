# -*- coding: utf-8 -*-
"""
Workspace-issued login sessions (POST /v1/auth/session + bearer acceptance).

The session exists so browsers that cannot reach Google (mainland China) can
still enter the workspace: the custom-token exchange happens server-side and
the resulting HS256 JWT is accepted as an identity bearer everywhere.
"""

import time
from unittest.mock import patch

import jwt
import pytest

from app import firebase_auth

# Always patch/read config through firebase_auth.config, never a separately
# imported handle: test_identity_defaults reloads app.config mid-session, so a
# module-level `from app.config import config` here would go stale.

# ≥32 bytes keeps PyJWT's HMAC key-length warning quiet.
SECRET = "test-session-secret-0123456789abcdef0123456789abcdef"
CLAIMS = {
    "provider": "firebase",
    "email": "Wei@Example.com",
    "firebase_uid": "uid-123",
    "display_name": "Wei",
}


@pytest.fixture
def session_secret(monkeypatch):
    monkeypatch.setattr(firebase_auth.config, "WORKSPACE_SESSION_SECRET", SECRET)
    yield SECRET


# ---------------------------------------------------------------------------
# Mint / verify
# ---------------------------------------------------------------------------

class TestMintVerify:
    def test_roundtrip_normalises_email(self, session_secret):
        token, exp = firebase_auth.mint_workspace_session(CLAIMS)
        assert exp > time.time()
        claims = firebase_auth.verify_workspace_session(token)
        assert claims == {
            "provider": "workspace_session",
            "email": "wei@example.com",
            "firebase_uid": "uid-123",
            "display_name": "Wei",
        }

    def test_mint_requires_secret(self, monkeypatch):
        monkeypatch.setattr(firebase_auth.config, "WORKSPACE_SESSION_SECRET", "")
        with pytest.raises(RuntimeError):
            firebase_auth.mint_workspace_session(CLAIMS)

    def test_tampered_signature_rejected(self, session_secret):
        token, _ = firebase_auth.mint_workspace_session(CLAIMS)
        forged = jwt.encode(
            jwt.decode(token, options={"verify_signature": False}),
            "another-secret",
            algorithm="HS256",
        )
        assert firebase_auth.verify_workspace_session(forged) is None

    def test_expired_rejected(self, session_secret):
        payload = {
            "iss": "openagents-workspace", "sub": "x", "email": "a@b.co",
            "iat": int(time.time()) - 100, "exp": int(time.time()) - 10,
        }
        token = jwt.encode(payload, SECRET, algorithm="HS256")
        assert firebase_auth.verify_workspace_session(token) is None

    def test_wrong_issuer_not_recognised(self, session_secret):
        payload = {"iss": "someone-else", "email": "a@b.co",
                   "exp": int(time.time()) + 100}
        token = jwt.encode(payload, SECRET, algorithm="HS256")
        assert firebase_auth.looks_like_workspace_session(token) is False
        assert firebase_auth.verify_workspace_session(token) is None

    def test_verify_disabled_without_secret(self, session_secret, monkeypatch):
        token, _ = firebase_auth.mint_workspace_session(CLAIMS)
        monkeypatch.setattr(firebase_auth.config, "WORKSPACE_SESSION_SECRET", "")
        assert firebase_auth.verify_workspace_session(token) is None

    def test_opaque_strings_are_not_sessions(self):
        assert firebase_auth.looks_like_workspace_session("tok-a") is False
        assert firebase_auth.looks_like_workspace_session("") is False


# ---------------------------------------------------------------------------
# Provider-agnostic routing
# ---------------------------------------------------------------------------

class TestIdentityRouting:
    def test_identity_claims_accepts_session_without_firebase(self, session_secret):
        token, _ = firebase_auth.mint_workspace_session(CLAIMS)
        with patch("app.firebase_auth.verify_firebase_claims") as fb, \
             patch("app.firebase_auth.verify_apple_claims") as ap:
            claims = firebase_auth.verify_identity_claims(token)
        assert claims["email"] == "wei@example.com"
        assert claims["provider"] == "workspace_session"
        fb.assert_not_called()
        ap.assert_not_called()

    def test_identity_token_returns_email(self, session_secret):
        token, _ = firebase_auth.mint_workspace_session(CLAIMS)
        with patch("app.firebase_auth.verify_firebase_token") as fb:
            assert firebase_auth.verify_identity_token(token) == "wei@example.com"
        fb.assert_not_called()

    def test_non_session_tokens_still_go_to_firebase(self, session_secret):
        with patch("app.firebase_auth.verify_firebase_token", return_value="g@x.io") as fb:
            assert firebase_auth.verify_identity_token("opaque-firebase-token") == "g@x.io"
        fb.assert_called_once()


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

class TestSessionEndpoint:
    def test_disabled_returns_503(self, client, monkeypatch):
        monkeypatch.setattr(firebase_auth.config, "WORKSPACE_SESSION_SECRET", "")
        resp = client.post("/v1/auth/session", json={"custom_token": "ct"})
        assert resp.status_code == 503

    def test_rejected_custom_token_401(self, client, session_secret):
        with patch("app.routers.auth.exchange_custom_token", return_value=None):
            resp = client.post("/v1/auth/session", json={"custom_token": "bad"})
        assert resp.status_code == 401

    def test_success_issues_usable_bearer(self, client, session_secret):
        with patch("app.routers.auth.exchange_custom_token", return_value=CLAIMS) as ex:
            resp = client.post("/v1/auth/session", json={"custom_token": "ct-ok"})
        assert resp.status_code == 200, resp.text
        ex.assert_called_once_with("ct-ok")
        data = resp.json()["data"]
        assert data["email"] == "Wei@Example.com"
        assert data["display_name"] == "Wei"
        assert data["expires_at"].endswith("+00:00")

        # The issued token works as an identity bearer on a real endpoint
        # (Membership Home) — with Firebase never consulted.
        with patch("app.firebase_auth.verify_firebase_claims") as fb:
            me = client.get(
                "/v1/account/workspaces",
                headers={"Authorization": f"Bearer {data['session_token']}"},
            )
        assert me.status_code == 200, me.text
        fb.assert_not_called()

    def test_missing_body_422(self, client, session_secret):
        assert client.post("/v1/auth/session", json={}).status_code == 422


# ---------------------------------------------------------------------------
# Custom-token exchange (Google call mocked)
# ---------------------------------------------------------------------------

class _Resp:
    def __init__(self, status, body):
        self.status_code = status
        self._body = body

    def json(self):
        return self._body


class TestExchange:
    def test_exchange_verifies_returned_id_token(self, monkeypatch):
        with patch("httpx.post", return_value=_Resp(200, {"idToken": "id-1"})) as post, \
             patch("app.firebase_auth.verify_firebase_claims", return_value=CLAIMS) as vf:
            assert firebase_auth.exchange_custom_token("ct") == CLAIMS
        vf.assert_called_once_with("id-1")
        sent = post.call_args.kwargs
        assert sent["json"] == {"token": "ct", "returnSecureToken": True}
        assert sent["params"]["key"] == firebase_auth.config.FIREBASE_WEB_API_KEY

    def test_exchange_rejection_returns_none(self):
        body = {"error": {"message": "INVALID_CUSTOM_TOKEN"}}
        with patch("httpx.post", return_value=_Resp(400, body)):
            assert firebase_auth.exchange_custom_token("ct") is None

    def test_exchange_network_error_returns_none(self):
        with patch("httpx.post", side_effect=OSError("boom")):
            assert firebase_auth.exchange_custom_token("ct") is None

    def test_exchange_empty_token_short_circuits(self):
        with patch("httpx.post") as post:
            assert firebase_auth.exchange_custom_token("") is None
        post.assert_not_called()
