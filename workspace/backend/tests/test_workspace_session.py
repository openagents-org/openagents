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


APPLE_CLAIMS = {
    "provider": "apple",
    "email": "relay@privaterelay.appleid.com",
    "apple_sub": "001234.abcd",
    "display_name": None,
    "email_verified": True,
}


class TestAppleSessionEndpoint:
    def test_disabled_returns_503(self, client, monkeypatch):
        monkeypatch.setattr(firebase_auth.config, "WORKSPACE_SESSION_SECRET", "")
        resp = client.post("/v1/auth/apple-session", json={"identity_token": "at"})
        assert resp.status_code == 503

    def test_rejected_identity_token_401(self, client, session_secret):
        with patch("app.routers.auth.verify_apple_claims", return_value=None):
            resp = client.post("/v1/auth/apple-session", json={"identity_token": "bad"})
        assert resp.status_code == 401

    def test_success_issues_usable_bearer(self, client, session_secret):
        with patch("app.routers.auth.verify_apple_claims", return_value=APPLE_CLAIMS) as v:
            resp = client.post("/v1/auth/apple-session", json={"identity_token": "at-ok"})
        assert resp.status_code == 200, resp.text
        v.assert_called_once_with("at-ok")
        data = resp.json()["data"]
        assert data["email"] == APPLE_CLAIMS["email"]
        assert data["expires_at"].endswith("+00:00")

        # The session outlives Apple's ten-minute token: it is accepted as an
        # identity bearer with neither Firebase nor Apple consulted again.
        with patch("app.firebase_auth.verify_firebase_claims") as fb, patch(
            "app.firebase_auth.verify_apple_claims"
        ) as apple:
            me = client.get(
                "/v1/account/workspaces",
                headers={"Authorization": f"Bearer {data['session_token']}"},
            )
        assert me.status_code == 200, me.text
        fb.assert_not_called()
        apple.assert_not_called()

        decoded = firebase_auth.verify_workspace_session(data["session_token"])
        assert decoded["email"] == APPLE_CLAIMS["email"]
        assert decoded["email_verified"] is True

    def test_missing_body_422(self, client, session_secret):
        assert client.post("/v1/auth/apple-session", json={}).status_code == 422


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


class TestSessionRenewal:
    def _session(self, **overrides):
        now = int(time.time())
        payload = {
            "iss": "openagents-workspace", "sub": "uid-123",
            "email": "wei@example.com", "firebase_uid": "uid-123", "name": "Wei",
            "iat": now - 86400, "exp": now + 86400, "auth_time": now - 86400,
        }
        payload.update(overrides)
        payload = {k: v for k, v in payload.items() if v is not None}
        return jwt.encode(payload, SECRET, algorithm="HS256")

    def _renew(self, client, token):
        return client.post(
            "/v1/auth/session/renew", headers={"Authorization": f"Bearer {token}"}
        )

    def test_disabled_returns_503(self, client, monkeypatch):
        monkeypatch.setattr(firebase_auth.config, "WORKSPACE_SESSION_SECRET", "")
        assert self._renew(client, "anything").status_code == 503

    def test_missing_bearer_401(self, client, session_secret):
        assert client.post("/v1/auth/session/renew").status_code == 401

    def test_non_session_bearer_401(self, client, session_secret):
        assert self._renew(client, "opaque-firebase-token").status_code == 401

    def test_expired_session_401(self, client, session_secret):
        now = int(time.time())
        resp = self._renew(client, self._session(iat=now - 100, exp=now - 10))
        assert resp.status_code == 401

    def test_renewal_extends_expiry_and_keeps_identity(self, client, session_secret):
        old = self._session()
        resp = self._renew(client, old)
        assert resp.status_code == 200, resp.text
        data = resp.json()["data"]
        assert data["email"] == "wei@example.com"
        assert data["display_name"] == "Wei"

        before = jwt.decode(old, options={"verify_signature": False})
        after = jwt.decode(data["session_token"], options={"verify_signature": False})
        assert after["exp"] > before["exp"]
        assert after["email"] == before["email"]
        assert after["firebase_uid"] == before["firebase_uid"]
        # The original sign-in time survives, so the maximum age still counts
        # from the sign-in and not from the latest renewal.
        assert after["auth_time"] == before["auth_time"]
        assert firebase_auth.verify_identity_token(data["session_token"]) == "wei@example.com"

    def test_session_without_auth_time_counts_from_iat(self, client, session_secret):
        old = self._session(auth_time=None)
        resp = self._renew(client, old)
        assert resp.status_code == 200, resp.text
        before = jwt.decode(old, options={"verify_signature": False})
        after = jwt.decode(
            resp.json()["data"]["session_token"], options={"verify_signature": False}
        )
        assert after["auth_time"] == before["iat"]

    def test_past_maximum_age_401(self, client, session_secret, monkeypatch):
        monkeypatch.setattr(firebase_auth.config, "WORKSPACE_SESSION_MAX_AGE_DAYS", 10)
        now = int(time.time())
        resp = self._renew(client, self._session(auth_time=now - 11 * 86400))
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Sign in with Apple verification — real RS256 tokens against a local key
# ---------------------------------------------------------------------------
#
# Only Apple's JWKS fetch is replaced: the client hands back a PyJWK built from
# a locally generated RSA key, exactly what PyJWKClient returns, so signature,
# algorithm, issuer, audience and expiry checks all run for real.

import base64
import hashlib
import hmac
import json

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

APPLE_AUD = "org.openagents.workspace"
APPLE_ISS = "https://appleid.apple.com"
APPLE_KID = "test-kid"


def _rsa_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


_APPLE_KEY = _rsa_key()
_OTHER_KEY = _rsa_key()


class _FakeJWKClient:
    def __init__(self, public_key):
        jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(public_key))
        jwk.update({"kid": APPLE_KID, "alg": "RS256", "use": "sig"})
        self._jwk = jwt.PyJWK.from_dict(jwk)

    def get_signing_key_from_jwt(self, token):
        return self._jwk


@pytest.fixture
def apple_env(monkeypatch):
    monkeypatch.setattr(firebase_auth.config, "APPLE_CLIENT_IDS", f"{APPLE_AUD}, other.bundle")
    fake = _FakeJWKClient(_APPLE_KEY.public_key())
    monkeypatch.setattr(firebase_auth, "_get_apple_jwk_client", lambda: fake)
    yield


def _apple_payload(**over):
    now = int(time.time())
    payload = {
        "iss": APPLE_ISS,
        "aud": APPLE_AUD,
        "sub": "001234.abcd",
        "email": "Relay@PrivateRelay.AppleID.com",
        "iat": now,
        "exp": now + 600,
    }
    payload.update(over)
    return {k: v for k, v in payload.items() if v is not None}


def _apple_token(key=_APPLE_KEY, **over):
    return jwt.encode(_apple_payload(**over), key, algorithm="RS256", headers={"kid": APPLE_KID})


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _hs256_with_public_key():
    """Algorithm-confusion token: HS256, HMAC keyed with Apple's PUBLIC key PEM.
    PyJWT refuses to build this itself, so it is assembled by hand."""
    pem = _APPLE_KEY.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    header = _b64(json.dumps({"alg": "HS256", "typ": "JWT", "kid": APPLE_KID}).encode())
    body = _b64(json.dumps(_apple_payload()).encode())
    signing_input = f"{header}.{body}".encode()
    sig = _b64(hmac.new(pem, signing_input, hashlib.sha256).digest())
    return f"{header}.{body}.{sig}"


# Both entry points verify Apple tokens; each must accept and reject alike.
_VERIFIERS = [
    pytest.param(lambda t: firebase_auth.verify_apple_claims(t), id="verify_apple_claims"),
    pytest.param(lambda t: firebase_auth.verify_apple_token(t), id="verify_apple_token"),
]


class TestAppleVerificationReal:
    @pytest.mark.parametrize("verify", _VERIFIERS)
    def test_valid_token_accepted(self, apple_env, verify):
        assert verify(_apple_token())

    def test_valid_token_claims(self, apple_env):
        claims = firebase_auth.verify_apple_claims(_apple_token())
        assert claims["provider"] == "apple"
        assert claims["apple_sub"] == "001234.abcd"
        assert claims["email"].lower() == "relay@privaterelay.appleid.com"

    def test_second_configured_audience_accepted(self, apple_env):
        assert firebase_auth.verify_apple_claims(_apple_token(aud="other.bundle"))

    @pytest.mark.parametrize("verify", _VERIFIERS)
    @pytest.mark.parametrize(
        "token_factory",
        [
            pytest.param(lambda: _apple_token(aud="com.attacker.app"), id="wrong-aud"),
            pytest.param(lambda: _apple_token(iss="https://evil.example.com"), id="wrong-iss"),
            pytest.param(
                lambda: _apple_token(iat=int(time.time()) - 7200, exp=int(time.time()) - 3600),
                id="expired",
            ),
            pytest.param(lambda: _apple_token(key=_OTHER_KEY), id="bad-signature"),
            pytest.param(_hs256_with_public_key, id="hs256-alg-confusion"),
            pytest.param(lambda: _apple_token(exp=None), id="no-exp"),
            pytest.param(lambda: _apple_token(email=None), id="no-email"),
        ],
    )
    def test_rejected(self, apple_env, verify, token_factory):
        assert not verify(token_factory())

    @pytest.mark.parametrize("verify", _VERIFIERS)
    def test_empty_client_ids_rejects_everything(self, apple_env, monkeypatch, verify):
        monkeypatch.setattr(firebase_auth.config, "APPLE_CLIENT_IDS", "")
        assert not verify(_apple_token())

    def test_apple_session_endpoint_end_to_end(self, client, session_secret, apple_env):
        """The real verifier behind /v1/auth/apple-session; the session's email
        is lowercased (accounts are keyed by lowercase email)."""
        resp = client.post("/v1/auth/apple-session", json={"identity_token": _apple_token()})
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["email"] == "relay@privaterelay.appleid.com"
        raw = jwt.decode(data["session_token"], options={"verify_signature": False})
        assert raw["email"] == "relay@privaterelay.appleid.com"

    def test_apple_session_endpoint_rejects_wrong_audience(self, client, session_secret, apple_env):
        resp = client.post(
            "/v1/auth/apple-session", json={"identity_token": _apple_token(aud="com.attacker.app")}
        )
        assert resp.status_code == 401
