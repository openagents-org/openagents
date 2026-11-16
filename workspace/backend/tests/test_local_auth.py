# -*- coding: utf-8 -*-
"""Local email + password login for self-hosted instances (/v1/auth/local/*)."""

import os
import stat
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest

from app.config import config
from app.firebase_auth import verify_identity_claims
from app.models import LocalCredential, User, Workspace, WorkspaceInvite
from app.services import local_auth as la

SECRET = "local-auth-test-secret-at-least-32-bytes!"


@pytest.fixture(autouse=True)
def local_env(monkeypatch):
    # Other tests reload app.config, so modules may hold different Config
    # instances; point every module at the one these tests mutate.
    import app.cli.local_auth as cli_mod
    import app.firebase_auth as firebase_auth
    import app.routers.local_auth as router_mod
    import app.services.email as email_mod
    for mod in (cli_mod, firebase_auth, router_mod, email_mod, la):
        monkeypatch.setattr(mod, "config", config)
    monkeypatch.setattr(config, "WORKSPACE_SESSION_SECRET", SECRET)
    monkeypatch.setattr(config, "FIREBASE_PROJECT_ID", "")
    monkeypatch.setattr(config, "APPLE_CLIENT_IDS", "")
    monkeypatch.setattr(config, "LOCAL_AUTH_ENABLED", "")
    monkeypatch.setattr(config, "LOCAL_SIGNUP", "open")
    monkeypatch.setattr(config, "RESEND_API_KEY", "")
    la.reset_throttle()
    yield
    la.reset_throttle()


def _signup(client, email="alice@example.com", password="correct horse", **extra):
    return client.post("/v1/auth/local/signup", json={"email": email, "password": password, **extra})


def _login(client, email="alice@example.com", password="correct horse"):
    return client.post("/v1/auth/local/login", json={"email": email, "password": password})


def _workspace(db, slug="ws1", creator_email=None):
    ws = Workspace(name="WS", slug=slug, creator_email=creator_email)
    db.add(ws)
    db.commit()
    return ws


def _invite(db, ws, email, **kw):
    inv = WorkspaceInvite(
        workspace_id=ws.id, token=kw.pop("token", "tok-" + (email or "open")), email=email,
        expires_at=datetime.now(timezone.utc) + timedelta(days=1), **kw,
    )
    db.add(inv)
    db.commit()
    return inv


# ---------------------------------------------------------------------------
# Hashing
# ---------------------------------------------------------------------------

def test_hash_format_and_verify():
    h = la.hash_password("s3cret-pass")
    parts = h.split("$")
    assert parts[:4] == ["scrypt", "16384", "8", "1"]
    assert la.verify_password("s3cret-pass", h)
    assert not la.verify_password("wrong-pass", h)
    assert la.hash_password("s3cret-pass") != h  # fresh salt
    assert not la.verify_password("x", "garbage")
    assert not la.verify_password("x", "scrypt$99999999$8$1$AA==$AA==")


# ---------------------------------------------------------------------------
# Config / gate
# ---------------------------------------------------------------------------

def test_config_local(client):
    data = client.get("/v1/auth/config").json()["data"]
    assert data == {"local_auth": True, "signup_open": True, "email_enabled": False, "providers": ["local"]}


def test_config_invite_mode_closes_after_first_account(client, monkeypatch):
    monkeypatch.setattr(config, "LOCAL_SIGNUP", "invite")
    assert client.get("/v1/auth/config").json()["data"]["signup_open"] is True
    assert _signup(client).status_code == 201
    assert client.get("/v1/auth/config").json()["data"]["signup_open"] is False


def test_disabled_when_firebase_configured(client, monkeypatch):
    monkeypatch.setattr(config, "FIREBASE_PROJECT_ID", "openagents-prod")
    monkeypatch.setattr(config, "APPLE_CLIENT_IDS", "org.openagents.app")
    data = client.get("/v1/auth/config").json()["data"]
    assert data == {"local_auth": False, "signup_open": False, "email_enabled": False,
                    "providers": ["firebase", "apple"]}
    for path, body in [
        ("/v1/auth/local/signup", {"email": "a@b.co", "password": "12345678"}),
        ("/v1/auth/local/login", {"email": "a@b.co", "password": "12345678"}),
        ("/v1/auth/local/password", {"current_password": "x", "new_password": "12345678"}),
        ("/v1/auth/local/reset/request", {"email": "a@b.co"}),
        ("/v1/auth/local/reset", {"token": "x", "new_password": "12345678"}),
    ]:
        assert client.post(path, json=body).status_code == 404, path


def test_explicit_flag_overrides_auto(monkeypatch):
    monkeypatch.setattr(config, "FIREBASE_PROJECT_ID", "p")
    assert not la.local_auth_enabled()
    monkeypatch.setattr(config, "LOCAL_AUTH_ENABLED", "true")
    assert la.local_auth_enabled()
    monkeypatch.setattr(config, "FIREBASE_PROJECT_ID", "")
    monkeypatch.setattr(config, "LOCAL_AUTH_ENABLED", "false")
    assert not la.local_auth_enabled()


# ---------------------------------------------------------------------------
# Signup / login
# ---------------------------------------------------------------------------

def test_signup_returns_working_session(client, db):
    resp = _signup(client, email="  Alice@Example.COM ", display_name="Alice")
    assert resp.status_code == 201
    data = resp.json()["data"]
    assert set(data) == {"session_token", "email", "display_name", "expires_at"}
    assert data["email"] == "alice@example.com"
    assert data["display_name"] == "Alice"
    claims = verify_identity_claims(data["session_token"])
    assert claims["email"] == "alice@example.com"
    assert claims["email_verified"] is False
    user = db.query(User).filter_by(email="alice@example.com").one()
    cred = db.get(LocalCredential, user.id)
    assert cred.password_hash.startswith("scrypt$") and "correct horse" not in cred.password_hash
    # The session is accepted by the rest of the API.
    me = client.get("/v1/account/workspaces", headers={"Authorization": f"Bearer {data['session_token']}"})
    assert me.status_code == 200


def test_signup_validation(client):
    assert _signup(client, password="short").status_code == 422
    assert _signup(client, email="not-an-email").status_code == 422


def test_signup_duplicate_409(client):
    assert _signup(client).status_code == 201
    assert _signup(client, email="ALICE@example.com", password="another pass").status_code == 409


def test_login(client):
    _signup(client)
    ok = _login(client, email="ALICE@example.com")
    assert ok.status_code == 200
    assert verify_identity_claims(ok.json()["data"]["session_token"])["email"] == "alice@example.com"
    bad = _login(client, password="wrong password")
    unknown = _login(client, email="nobody@example.com")
    assert bad.status_code == unknown.status_code == 401
    assert bad.json()["message"] == unknown.json()["message"] == "invalid email or password"


def test_login_throttle(client):
    _signup(client)
    for _ in range(la.THROTTLE_MAX_FAILURES):
        assert _login(client, password="wrong password").status_code == 401
    # Even the right password is refused while throttled.
    assert _login(client).status_code == 429
    # Another account from the same client is unaffected.
    _signup(client, email="bob@example.com")
    assert _login(client, email="bob@example.com").status_code == 200


# ---------------------------------------------------------------------------
# Invite-only mode and claim protection
# ---------------------------------------------------------------------------

def test_invite_mode(client, db, monkeypatch):
    monkeypatch.setattr(config, "LOCAL_SIGNUP", "invite")
    assert _signup(client, email="admin@example.com").status_code == 201  # first account
    assert _signup(client, email="eve@example.com").status_code == 403
    ws = _workspace(db)
    _invite(db, ws, "carol@example.com", token="carol-tok")
    # Invite bound to another address doesn't help.
    assert _signup(client, email="eve@example.com", invite_token="carol-tok").status_code == 403
    assert _signup(client, email="carol@example.com", invite_token="carol-tok").status_code == 201
    # Open links admit a new address.
    _invite(db, ws, None, token="open-tok")
    assert _signup(client, email="dave@example.com", invite_token="open-tok").status_code == 201


def test_invite_mode_rejects_expired_or_revoked(client, db, monkeypatch):
    monkeypatch.setattr(config, "LOCAL_SIGNUP", "invite")
    _signup(client, email="admin@example.com")
    ws = _workspace(db)
    inv = _invite(db, ws, "carol@example.com", token="t1")
    inv.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db.commit()
    assert _signup(client, email="carol@example.com", invite_token="t1").status_code == 403
    inv2 = _invite(db, ws, "carol@example.com", token="t2", revoked_at=datetime.now(timezone.utc))
    assert inv2.revoked_at is not None
    assert _signup(client, email="carol@example.com", invite_token="t2").status_code == 403


def test_cannot_claim_invited_user_without_invite(client, db):
    _signup(client, email="admin@example.com")
    ws = _workspace(db)
    db.add(User(email="victim@example.com"))  # row created when they were invited/added
    db.commit()
    _invite(db, ws, "victim@example.com", token="victim-tok")
    _invite(db, ws, None, token="open-tok")

    assert _signup(client, email="victim@example.com").status_code == 409
    # An open link is not proof of owning this address.
    assert _signup(client, email="victim@example.com", invite_token="open-tok").status_code == 409
    assert _signup(client, email="victim@example.com", invite_token="victim-tok").status_code == 201
    assert _login(client, email="victim@example.com").status_code == 200


def test_cannot_claim_legacy_creator_email(client, db):
    _signup(client, email="admin@example.com")
    _workspace(db, creator_email="owner@example.com")
    assert _signup(client, email="owner@example.com").status_code == 409


def test_first_account_may_claim_legacy_creator_email(client, db):
    _workspace(db, creator_email="owner@example.com")
    assert _signup(client, email="owner@example.com").status_code == 201


# ---------------------------------------------------------------------------
# Password change
# ---------------------------------------------------------------------------

def test_change_password(client):
    token = _signup(client).json()["data"]["session_token"]
    auth = {"Authorization": f"Bearer {token}"}
    url = "/v1/auth/local/password"
    assert client.post(url, json={"current_password": "x", "new_password": "new password"}).status_code == 401
    assert client.post(url, json={"current_password": "wrong one", "new_password": "new password"},
                       headers=auth).status_code == 401
    assert client.post(url, json={"current_password": "correct horse", "new_password": "short"},
                       headers=auth).status_code == 422
    resp = client.post(url, json={"current_password": "correct horse", "new_password": "new password"}, headers=auth)
    assert resp.status_code == 204
    assert _login(client).status_code == 401
    assert _login(client, password="new password").status_code == 200


# ---------------------------------------------------------------------------
# Reset
# ---------------------------------------------------------------------------

def test_reset_request_always_202_and_sends_when_configured(client, monkeypatch):
    assert client.post("/v1/auth/local/reset/request", json={"email": "nobody@example.com"}).status_code == 202
    _signup(client)
    # No email configured: nothing is sent.
    with patch("app.services.email.send_password_reset_email") as send:
        assert client.post("/v1/auth/local/reset/request", json={"email": "alice@example.com"}).status_code == 202
        send.assert_not_called()
    monkeypatch.setattr(config, "RESEND_API_KEY", "re_test")
    monkeypatch.setattr(config, "FRONTEND_BASE_URL", "https://ws.example.com")
    assert client.get("/v1/auth/config").json()["data"]["email_enabled"] is True
    with patch("app.services.email.send_password_reset_email") as send:
        assert client.post("/v1/auth/local/reset/request", json={"email": "nobody@example.com"}).status_code == 202
        send.assert_not_called()
        assert client.post("/v1/auth/local/reset/request", json={"email": "Alice@example.com"}).status_code == 202
        send.assert_called_once()
        to, link = send.call_args[0][:2]
    assert to == "alice@example.com"
    assert link.startswith("https://ws.example.com/reset-password?token=")


def test_reset_flow_single_use(client, db):
    _signup(client)
    user = db.query(User).filter_by(email="alice@example.com").one()
    token = la.mint_reset_token(user, db.get(LocalCredential, user.id))
    # A reset token is not a session.
    assert verify_identity_claims(token) is None
    resp = client.post("/v1/auth/local/reset", json={"token": token, "new_password": "brand new pass"})
    assert resp.status_code == 200
    assert verify_identity_claims(resp.json()["data"]["session_token"])["email"] == "alice@example.com"
    assert _login(client, password="brand new pass").status_code == 200
    # Second use fails: the password fingerprint changed.
    again = client.post("/v1/auth/local/reset", json={"token": token, "new_password": "another pass"})
    assert again.status_code == 400
    # A session token is not a reset token.
    session = _login(client, password="brand new pass").json()["data"]["session_token"]
    assert client.post("/v1/auth/local/reset", json={"token": session, "new_password": "x" * 10}).status_code == 400


def test_reset_token_expires(client, db):
    _signup(client)
    user = db.query(User).filter_by(email="alice@example.com").one()
    with patch("app.services.local_auth.time.time", return_value=1_000_000_000):
        token = la.mint_reset_token(user, db.get(LocalCredential, user.id))
    assert client.post("/v1/auth/local/reset", json={"token": token, "new_password": "brand new pass"}).status_code == 400


def test_reset_lets_invited_user_claim_by_email(client, db):
    """An admin-added user without a credential can set a first password via a
    mailed link (proof of mailbox ownership)."""
    db.add(User(email="added@example.com"))
    db.commit()
    user = db.query(User).filter_by(email="added@example.com").one()
    token = la.mint_reset_token(user, None)
    assert client.post("/v1/auth/local/reset", json={"token": token, "new_password": "first pass!"}).status_code == 200
    assert _login(client, email="added@example.com", password="first pass!").status_code == 200
    # Used up once a credential exists.
    assert client.post("/v1/auth/local/reset", json={"token": token, "new_password": "other pass"}).status_code == 400


# ---------------------------------------------------------------------------
# Session secret bootstrap
# ---------------------------------------------------------------------------

def test_session_secret_generated_and_persisted(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "WORKSPACE_SESSION_SECRET", "")
    monkeypatch.setattr(config, "DATA_DIR", str(tmp_path / "data"))
    la.ensure_session_secret()
    secret = config.WORKSPACE_SESSION_SECRET
    assert len(secret) >= 32
    path = tmp_path / "data" / "session_secret"
    assert path.read_text().strip() == secret
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600
    monkeypatch.setattr(config, "WORKSPACE_SESSION_SECRET", "")
    la.ensure_session_secret()
    assert config.WORKSPACE_SESSION_SECRET == secret  # reused across restarts


def test_session_secret_untouched_when_set_or_disabled(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA_DIR", str(tmp_path))
    la.ensure_session_secret()
    assert config.WORKSPACE_SESSION_SECRET == SECRET
    monkeypatch.setattr(config, "WORKSPACE_SESSION_SECRET", "")
    monkeypatch.setattr(config, "FIREBASE_PROJECT_ID", "prod")
    la.ensure_session_secret()
    assert config.WORKSPACE_SESSION_SECRET == ""
    assert not (tmp_path / "session_secret").exists()


def test_session_secret_fallback_when_unwritable(tmp_path, monkeypatch):
    blocker = tmp_path / "file"
    blocker.write_text("x")
    monkeypatch.setattr(config, "WORKSPACE_SESSION_SECRET", "")
    monkeypatch.setattr(config, "DATA_DIR", str(blocker / "sub"))
    la.ensure_session_secret()
    assert len(config.WORKSPACE_SESSION_SECRET) >= 32


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def test_cli_set_and_reset_password(client, db, monkeypatch, capsys):
    from app.cli import local_auth as cli
    import io

    monkeypatch.setattr("sys.stdin", io.StringIO("cli password\n"))
    assert cli.main(["set-password", "Ops@Example.com"]) == 0
    assert _login(client, email="ops@example.com", password="cli password").status_code == 200

    monkeypatch.setattr(config, "FRONTEND_BASE_URL", "https://ws.example.com")
    assert cli.main(["reset-password", "ops@example.com"]) == 0
    link = capsys.readouterr().out.strip().splitlines()[-1]
    token = link.split("token=", 1)[1]
    assert client.post("/v1/auth/local/reset", json={"token": token, "new_password": "reset by cli"}).status_code == 200
    assert cli.main(["reset-password", "missing@example.com"]) == 1
