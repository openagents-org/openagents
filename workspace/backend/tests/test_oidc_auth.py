# -*- coding: utf-8 -*-
"""OIDC validation, identity mapping, and browser-flow tests."""

import asyncio
import base64
import json
import time
from urllib.parse import parse_qs, urlsplit

import jwt
import pytest
from app import access
from app import firebase_auth as firebase_auth_module
from app import main as main_module
from app import oidc_auth as oidc_auth_module
from app.config import config
from app.firebase_auth import mint_workspace_session, verify_workspace_session
from app.models import Workspace, WorkspaceMembership
from app.oidc_auth import (
    get_oidc_client,
    principal_from_claims,
    reset_oidc_client,
    validate_metadata,
    verify_oidc_token,
)
from app.routers import auth as auth_router
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

ISSUER = "https://login.microsoftonline.com/test-tenant/v2.0"
CLIENT_ID = "test-client"


@pytest.fixture
def oidc_settings(monkeypatch):
    values = {
        "AUTH_MODE": "oidc",
        "OIDC_ISSUER": ISSUER,
        "OIDC_CLIENT_ID": CLIENT_ID,
        "OIDC_CLIENT_SECRET": "test-secret",
        "OIDC_REDIRECT_URI": "https://api.example.test/v1/auth/oidc/callback",
        "WORKSPACE_SESSION_SECRET": "oidc-test-secret" * 4,
        "FRONTEND_BASE_URL": "https://workspace.example.test",
        "CORS_ORIGINS": "https://workspace.example.test",
    }
    targets = {
        id(config): config,
        id(firebase_auth_module.config): firebase_auth_module.config,
        id(oidc_auth_module.config): oidc_auth_module.config,
        id(main_module.config): main_module.config,
        id(auth_router.config): auth_router.config,
    }
    for target in targets.values():
        for name, value in values.items():
            monkeypatch.setattr(target, name, value)
    reset_oidc_client()
    yield
    reset_oidc_client()


def _key_pair(kid: str):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key()))
    jwk.update({"kid": kid, "use": "sig", "alg": "RS256"})
    return private, jwk


def _metadata(jwks):
    return {
        "issuer": ISSUER,
        "authorization_endpoint": f"{ISSUER}/authorize",
        "token_endpoint": f"{ISSUER}/token",
        "jwks_uri": f"{ISSUER}/keys",
        "id_token_signing_alg_values_supported": ["RS256"],
        "jwks": {"keys": [jwks]},
        "_loaded_at": time.time(),
    }


def _token(private, *, kid="key-1", **overrides):
    now = int(time.time())
    claims = {
        "iss": ISSUER,
        "aud": CLIENT_ID,
        "sub": "subject-1",
        "iat": now,
        "exp": now + 300,
        "email": "User@Example.com",
        "name": "Example User",
    }
    claims.update(overrides)
    return jwt.encode(claims, private, algorithm="RS256", headers={"kid": kid})


def _configure_client(jwks):
    client = get_oidc_client()
    client.server_metadata.clear()
    client.server_metadata.update(_metadata(jwks))
    return client


def test_oidc_client_uses_authlib_pkce_and_openid_scope(oidc_settings):
    client = get_oidc_client()

    assert client.client_kwargs["code_challenge_method"] == "S256"
    assert "openid" in client.client_kwargs["scope"].split()


def test_oidc_login_uses_pkce_state_and_nonce(client, oidc_settings):
    _private, jwk = _key_pair("key-1")
    client_config = get_oidc_client()
    client_config.server_metadata.clear()
    client_config.server_metadata.update(_metadata(jwk))

    response = client.get(
        "/v1/auth/oidc/login",
        params={"return_to": "https://workspace.example.test/team"},
        follow_redirects=False,
    )

    assert response.status_code == 302
    query = parse_qs(urlsplit(response.headers["location"]).query)
    assert query["code_challenge_method"] == ["S256"]
    assert query["state"] and query["nonce"] and query["code_challenge"]
    assert "oa_oidc_state=" in response.headers["set-cookie"]


def test_oidc_happy_path_maps_claims(oidc_settings):
    private, jwk = _key_pair("key-1")
    _configure_client(jwk)

    principal = asyncio.run(verify_oidc_token(_token(private)))

    assert principal["provider"] == "oidc"
    assert principal["issuer"] == ISSUER
    assert principal["subject"] == "subject-1"
    assert principal["email"] == "user@example.com"
    assert principal["display_name"] == "Example User"


def test_oidc_email_claim_is_required(oidc_settings):
    private, jwk = _key_pair("key-1")
    _configure_client(jwk)
    token = _token(private, email=None, name=None)
    token = jwt.decode(token, options={"verify_signature": False})
    token.pop("email", None)
    token = jwt.encode(token, private, algorithm="RS256", headers={"kid": "key-1"})

    assert asyncio.run(verify_oidc_token(token)) is None


def test_oidc_maps_entra_style_claims(oidc_settings, monkeypatch):
    monkeypatch.setattr(config, "OIDC_EMAIL_CLAIM", "preferred_username")
    private, jwk = _key_pair("key-1")
    _configure_client(jwk)
    token = _token(
        private,
        email="user@tenant.example",
        preferred_username="user@tenant.example",
        oid="object-1",
        tid="tenant-1",
        groups=["workspace-readers"],
    )

    principal = asyncio.run(verify_oidc_token(token))

    assert principal["email"] == "user@tenant.example"
    assert principal["claims"]["oid"] == "object-1"
    assert principal["claims"]["groups"] == ["workspace-readers"]


@pytest.mark.parametrize(
    "overrides",
    [
        {"iss": "https://unknown.example.test"},
        {"aud": "wrong-client"},
        {"exp": int(time.time()) - 120},
        {"nbf": int(time.time()) + 300},
    ],
)
def test_oidc_rejects_wrong_issuer_audience_and_expiry(oidc_settings, overrides):
    private, jwk = _key_pair("key-1")
    _configure_client(jwk)

    assert asyncio.run(verify_oidc_token(_token(private, **overrides))) is None


def test_oidc_rejects_invalid_signature_and_malformed_token(oidc_settings):
    private, jwk = _key_pair("key-1")
    _configure_client(jwk)
    other_private, _ = _key_pair("key-1")

    assert asyncio.run(verify_oidc_token(_token(other_private))) is None
    assert asyncio.run(verify_oidc_token("not-a-jwt")) is None


def test_oidc_rejects_alg_none_and_missing_subject(oidc_settings):
    private, jwk = _key_pair("key-1")
    _configure_client(jwk)
    header = base64.urlsafe_b64encode(json.dumps({"alg": "none", "typ": "JWT"}).encode()).rstrip(b"=")
    payload = base64.urlsafe_b64encode(json.dumps({"iss": ISSUER, "aud": CLIENT_ID}).encode()).rstrip(b"=")
    unsigned = f"{header.decode()}.{payload.decode()}."

    assert asyncio.run(verify_oidc_token(unsigned)) is None


def test_oidc_missing_subject_is_rejected_by_claim_normalization(oidc_settings):
    with pytest.raises(RuntimeError, match="subject"):
        principal_from_claims({"iss": ISSUER, "aud": CLIENT_ID}, ISSUER)


def test_oidc_discovery_issuer_mismatch_is_rejected(oidc_settings):
    private, jwk = _key_pair("key-1")
    client = get_oidc_client()
    client.server_metadata.clear()
    metadata = _metadata(jwk)
    metadata["issuer"] = "https://unknown.example.test"
    client.server_metadata.update(metadata)

    with pytest.raises(RuntimeError, match="issuer"):
        asyncio.run(validate_metadata(client))


def test_oidc_jwks_refreshes_for_rotated_kid(oidc_settings):
    _old_private, old_jwk = _key_pair("old-key")
    new_private, new_jwk = _key_pair("new-key")
    client = _configure_client(old_jwk)
    calls = []

    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {"keys": [new_jwk]}

    class Session:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def request(self, method, url, **kwargs):
            calls.append((method, url))
            return Response()

    client._get_session = lambda: Session()
    token = _token(new_private, kid="new-key")

    principal = asyncio.run(verify_oidc_token(token))

    assert principal["subject"] == "subject-1"
    assert calls == [("GET", f"{ISSUER}/keys")]


def test_oidc_identity_is_scoped_by_issuer(db):
    first = principal_from_claims({"sub": "same", "email": "same@example.test"}, ISSUER)
    second = principal_from_claims({"sub": "same", "email": "other@example.test"}, "https://other.example.test")

    first_user = access.get_or_create_user(db, first)
    second_user = access.get_or_create_user(db, second)
    db.commit()

    assert first_user.id != second_user.id
    assert first_user.oidc_subject == "same"
    assert second_user.oidc_subject == "same"


def test_oidc_claims_unclaimed_invitation_placeholder(db):
    placeholder = access.get_or_create_user_by_email(db, "invited@example.test")
    workspace = Workspace(name="Invited", slug="invited-placeholder", password_hash="machine", require_login=True)
    db.add(workspace)
    db.flush()
    db.add(WorkspaceMembership(workspace_id=workspace.id, user_id=placeholder.id, role="member"))
    db.commit()

    user = access.get_or_create_user(
        db,
        principal_from_claims({"sub": "invited-sub", "email": "invited@example.test"}, ISSUER),
    )
    db.commit()

    assert user.id == placeholder.id
    assert user.oidc_subject == "invited-sub"
    assert user.is_invite_placeholder is False


def test_oidc_team_add_placeholder_can_sign_in(client, oidc_settings):
    workspace = client.post("/v1/workspaces", json={"name": "Team placeholder"}).json()["data"]
    added = client.post(
        f"/v1/workspaces/{workspace['workspaceId']}/team",
        json={"email": "teammate@example.test", "role": "member"},
        headers={"X-Workspace-Token": workspace["token"]},
    )
    assert added.status_code == 200

    claims = principal_from_claims({"sub": "teammate-sub", "email": "teammate@example.test"}, ISSUER)
    session_token, _ = mint_workspace_session(claims)
    response = client.get(
        "/v1/account/workspaces",
        cookies={"oa_oidc_session": session_token},
    )

    assert response.status_code == 200
    assert any(item["workspaceId"] == workspace["workspaceId"] for item in response.json()["data"])


def test_verified_oidc_email_does_not_link_existing_account(db):
    existing = access.get_or_create_user(
        db,
        {
            "provider": "firebase",
            "email": "shared@example.test",
            "firebase_uid": "firebase-sub",
            "email_verified": True,
        },
    )
    workspace = Workspace(name="Existing", slug="existing-account", password_hash="machine", require_login=True)
    db.add(workspace)
    db.flush()
    db.add(WorkspaceMembership(workspace_id=workspace.id, user_id=existing.id, role="owner"))
    db.commit()

    oidc_user = access.get_or_create_user(
        db,
        principal_from_claims(
            {"sub": "new-sub", "email": "shared@example.test", "email_verified": True},
            ISSUER,
        ),
    )
    db.commit()

    assert oidc_user is None
    assert existing.email == "shared@example.test"


def test_legacy_identity_does_not_implicitly_link_to_oidc_user(db):
    oidc_user = access.get_or_create_user(
        db,
        principal_from_claims({"sub": "oidc-owner", "email": "shared@example.test"}, ISSUER),
    )
    db.commit()

    legacy_user = access.get_or_create_user(
        db,
        {
            "provider": "firebase",
            "email": "shared@example.test",
            "firebase_uid": "different-firebase-sub",
            "email_verified": True,
        },
    )

    assert legacy_user is None
    assert oidc_user.oidc_subject == "oidc-owner"


def test_legacy_role_does_not_match_oidc_user_email(db, monkeypatch):
    oidc_user = access.get_or_create_user(
        db,
        principal_from_claims({"sub": "oidc-role-sub", "email": "role@example.test"}, ISSUER),
    )
    workspace = Workspace(
        name="OIDC role",
        slug="oidc-role",
        password_hash="machine",
        require_login=True,
    )
    db.add(workspace)
    db.flush()
    db.add(WorkspaceMembership(workspace_id=workspace.id, user_id=oidc_user.id, role="member"))
    db.commit()
    legacy_claims = {
        "provider": "firebase",
        "email": "role@example.test",
        "firebase_uid": "firebase-role-sub",
        "email_verified": True,
    }
    monkeypatch.setattr(access, "verify_identity_claims", lambda value: legacy_claims)

    assert access.resolve_user_role(db, workspace, "Bearer legacy") is None


def test_oidc_membership_role_uses_existing_rbac(db, monkeypatch, oidc_settings):
    claims = principal_from_claims({"sub": "member-sub", "email": "member@example.test"}, ISSUER)
    user = access.get_or_create_user(db, claims)
    workspace = Workspace(name="OIDC", slug="oidc-membership", password_hash="machine", require_login=True)
    db.add(workspace)
    db.flush()
    db.add(WorkspaceMembership(workspace_id=workspace.id, user_id=user.id, role="member"))
    db.commit()
    token, _ = mint_workspace_session(claims)
    monkeypatch.setattr(access, "verify_identity_claims", lambda value: verify_workspace_session(value))

    assert access.verify_workspace_access(workspace, None, f"Bearer {token}", db=db, min_role="member") is True
    assert access.verify_workspace_access(workspace, None, f"Bearer {token}", db=db, min_role="admin") is False


def test_oidc_cookie_authenticates_workspace_requests_without_machine_token(client, oidc_settings):
    claims = principal_from_claims({"sub": "cookie-sub", "email": "cookie@example.test"}, ISSUER)
    token, _ = mint_workspace_session(claims)

    account = client.get("/v1/account/workspaces", cookies={"oa_oidc_session": token})
    assert account.status_code == 200
    workspace = account.json()["data"][0]
    assert workspace["token"] is None

    detail = client.get(
        f"/v1/workspaces/{workspace['workspaceId']}",
        cookies={"oa_oidc_session": token},
    )
    assert detail.status_code == 200


def test_oidc_session_keeps_issuer_and_subject(oidc_settings):
    claims = principal_from_claims({"sub": "session-sub", "email": "session@example.test"}, ISSUER)
    token, _ = mint_workspace_session(claims)
    verified = verify_workspace_session(token)

    assert verified["identity_provider"] == "oidc"
    assert verified["issuer"] == ISSUER
    assert verified["subject"] == "session-sub"


def test_oidc_login_rejects_open_redirect(client, oidc_settings):
    response = client.get(
        "/v1/auth/oidc/login",
        params={"return_to": "https://evil.example.test/steal"},
    )

    assert response.status_code == 400


def test_oidc_config_rejects_wildcard_cors(client, monkeypatch, oidc_settings):
    monkeypatch.setattr(config, "CORS_ORIGINS", "*")
    response = client.get("/v1/auth/config")

    data = response.json()["data"]
    assert data["oidc"]["enabled"] is False
    assert "CORS_ORIGINS" in data["oidc"]["configurationError"]


def test_oidc_config_normalizes_explicit_origins(client, monkeypatch, oidc_settings):
    monkeypatch.setattr(config, "CORS_ORIGINS", "https://workspace.example.test/")
    response = client.get("/v1/auth/config")

    assert response.json()["data"]["oidc"]["enabled"] is True


def test_oidc_config_reports_only_public_capabilities(client, oidc_settings):
    response = client.get("/v1/auth/config")

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["mode"] == "oidc"
    assert data["oidc"]["enabled"] is True
    assert "OIDC_CLIENT_SECRET" not in response.text


def test_oidc_cookie_mutation_requires_allowed_origin(client, oidc_settings):
    token, _ = mint_workspace_session(principal_from_claims({"sub": "csrf-sub", "email": "csrf@example.test"}, ISSUER))
    response = client.post("/v1/auth/oidc/logout", cookies={"oa_oidc_session": token})

    assert response.status_code == 403


def test_oidc_session_endpoint_and_logout(client, monkeypatch, oidc_settings):
    async def fake_logout(request):
        return None

    monkeypatch.setattr(auth_router, "provider_logout_redirect", fake_logout)
    claims = principal_from_claims({"sub": "restore-sub", "email": "restore@example.test"}, ISSUER)
    token, _ = mint_workspace_session(claims)

    response = client.get("/v1/auth/oidc/session", cookies={"oa_oidc_session": token})
    assert response.status_code == 200
    assert response.json()["data"]["email"] == "restore@example.test"
    assert "session_token" not in response.json()["data"]

    logout = client.post(
        "/v1/auth/oidc/logout",
        cookies={"oa_oidc_session": token},
        headers={"Origin": config.FRONTEND_BASE_URL},
    )
    assert logout.status_code == 200
    assert logout.json()["data"]["logoutUrl"] is None
    assert "oa_oidc_session=" in logout.headers["set-cookie"]


def test_deleted_oidc_identity_cannot_reactivate(client, oidc_settings):
    claims = principal_from_claims({"sub": "deleted-sub", "email": "deleted@example.test"}, ISSUER)
    token, _ = mint_workspace_session(claims)
    workspace = client.post(
        "/v1/workspaces",
        json={"name": "Delete OIDC"},
        cookies={"oa_oidc_session": token},
        headers={"Origin": config.FRONTEND_BASE_URL},
    )
    assert workspace.status_code == 200

    deleted = client.delete(
        "/v1/account",
        cookies={"oa_oidc_session": token},
        headers={"Origin": config.FRONTEND_BASE_URL},
    )
    assert deleted.status_code == 200

    restored = client.get(
        "/v1/account/workspaces",
        cookies={"oa_oidc_session": token},
    )
    assert restored.status_code == 401


def test_unverified_oidc_email_cannot_accept_email_invite(client, oidc_settings):
    workspace = client.post(
        "/v1/workspaces",
        json={"name": "Invite verification", "creator_email": "invitee@example.test"},
    ).json()["data"]
    invite = client.post(
        f"/v1/workspaces/{workspace['workspaceId']}/invites",
        json={"email": "invitee@example.test", "role": "member"},
        headers={"X-Workspace-Token": workspace["token"]},
    ).json()["data"]
    token, _ = mint_workspace_session(
        principal_from_claims({"sub": "invitee-sub", "email": "invitee@example.test"}, ISSUER)
    )

    invite_token = invite["url"].rstrip("/").rsplit("/", 1)[-1]
    response = client.post(
        f"/v1/invites/{invite_token}/accept",
        cookies={"oa_oidc_session": token},
        headers={"Origin": config.FRONTEND_BASE_URL},
    )

    assert response.status_code == 403


def test_entra_style_oidc_without_email_verified_can_accept_when_opted_in(client, monkeypatch, oidc_settings):
    monkeypatch.setattr(config, "OIDC_EMAIL_CLAIM", "preferred_username")
    monkeypatch.setattr(config, "OIDC_REQUIRE_EMAIL_VERIFICATION", False)
    workspace = client.post(
        "/v1/workspaces",
        json={"name": "Entra invite", "creator_email": "entra@example.test"},
    ).json()["data"]
    invite = client.post(
        f"/v1/workspaces/{workspace['workspaceId']}/invites",
        json={"email": "entra@example.test", "role": "member"},
        headers={"X-Workspace-Token": workspace["token"]},
    ).json()["data"]
    token, _ = mint_workspace_session(
        principal_from_claims(
            {"sub": "entra-sub", "preferred_username": "entra@example.test"},
            ISSUER,
        )
    )

    invite_token = invite["url"].rstrip("/").rsplit("/", 1)[-1]
    response = client.post(
        f"/v1/invites/{invite_token}/accept",
        cookies={"oa_oidc_session": token},
        headers={"Origin": config.FRONTEND_BASE_URL},
    )

    assert response.status_code == 200
    assert response.json()["data"]["role"] == "member"


def test_oidc_role_does_not_fall_back_to_claim_email(db, monkeypatch):
    claims = principal_from_claims({"sub": "email-only-sub", "email": "owner@example.test"}, ISSUER)
    access.get_or_create_user(db, claims)
    workspace = Workspace(
        name="Email fallback",
        slug="email-fallback",
        creator_email="owner@example.test",
        password_hash="machine",
        require_login=True,
    )
    db.add(workspace)
    db.commit()
    monkeypatch.setattr(access, "verify_identity_claims", lambda value: claims)

    assert access.resolve_user_role(db, workspace, "Bearer local") is None


def test_unverified_oidc_email_does_not_reconcile_legacy_access(db):
    claims = principal_from_claims({"sub": "unverified-sub", "email": "owner@example.test"}, ISSUER)
    user = access.get_or_create_user(db, claims)
    workspace = Workspace(
        name="Unverified",
        slug="unverified-email",
        creator_email="owner@example.test",
        password_hash="machine",
        require_login=True,
    )
    db.add(workspace)
    db.commit()

    access.reconcile_memberships(db, user)

    membership = (
        db.query(WorkspaceMembership)
        .filter(
            WorkspaceMembership.workspace_id == workspace.id,
            WorkspaceMembership.user_id == user.id,
        )
        .one_or_none()
    )
    assert membership is None


def test_oidc_user_cannot_rotate_machine_token(client, oidc_settings):
    claims = principal_from_claims({"sub": "rotate-sub", "email": "rotate@example.test"}, ISSUER)
    token, _ = mint_workspace_session(claims)
    workspace = client.post(
        "/v1/workspaces",
        json={"name": "OIDC rotation"},
        cookies={"oa_oidc_session": token},
        headers={"Origin": config.FRONTEND_BASE_URL},
    )
    assert workspace.status_code == 200
    workspace_id = workspace.json()["data"]["workspaceId"]

    response = client.post(
        f"/v1/workspaces/{workspace_id}/rotate-token",
        cookies={"oa_oidc_session": token},
        headers={"Origin": config.FRONTEND_BASE_URL},
    )

    assert response.status_code == 403


def test_oidc_callback_rejects_wrong_state(client, oidc_settings):
    _private, jwk = _key_pair("key-1")
    client_config = get_oidc_client()
    client_config.server_metadata.clear()
    client_config.server_metadata.update(_metadata(jwk))
    started = client.get(
        "/v1/auth/oidc/login",
        params={"return_to": "https://workspace.example.test/team"},
        follow_redirects=False,
    )
    assert started.status_code == 302

    response = client.get(
        "/v1/auth/oidc/callback",
        params={"code": "not-a-code", "state": "wrong-state"},
        follow_redirects=False,
    )

    assert response.status_code == 401


def test_oidc_callback_sets_session_cookie(client, monkeypatch, oidc_settings):
    async def fake_login(request):
        return {
            "provider": "oidc",
            "identity_provider": "oidc",
            "issuer": ISSUER,
            "subject": "callback-sub",
            "email": "callback@example.test",
            "display_name": "Callback User",
        }

    monkeypatch.setattr(auth_router, "complete_login", fake_login)
    response = client.get("/v1/auth/oidc/callback", follow_redirects=False)

    assert response.status_code == 302
    assert response.headers["location"] == config.FRONTEND_BASE_URL
    assert "oa_oidc_session=" in response.headers["set-cookie"]
    assert "HttpOnly" in response.headers["set-cookie"]
    assert "Secure" in response.headers["set-cookie"]


def test_oidc_callback_allows_cross_site_provider_redirect(client, monkeypatch, oidc_settings):
    async def fake_login(request):
        return {
            "provider": "oidc",
            "identity_provider": "oidc",
            "issuer": ISSUER,
            "subject": "cross-site-sub",
            "email": "cross-site@example.test",
        }

    monkeypatch.setattr(auth_router, "complete_login", fake_login)
    response = client.get(
        "/v1/auth/oidc/callback",
        cookies={"oa_oidc_session": "stale-session"},
        headers={"sec-fetch-site": "cross-site"},
        follow_redirects=False,
    )

    assert response.status_code == 302
    assert response.headers["location"] == config.FRONTEND_BASE_URL
