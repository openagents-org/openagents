# -*- coding: utf-8 -*-
"""
Identity token verification for workspace user authentication.

Verifies the ID token an end user obtained from their login provider — either
Google (via Firebase, used on workspace.openagents.org) or Sign in with Apple
(used by the OpenAgents Go iOS app for App Store guideline 4.8 login parity) —
and resolves it to the user's email. Used alongside workspace-token auth, not
as a replacement.

Call `verify_identity_token()` for the provider-agnostic path; the
`verify_firebase_token()` / `verify_apple_token()` helpers remain for callers
that already know which provider issued the token.
"""

import json
import logging
import secrets
import threading
import time
from typing import Optional

from app.config import config

logger = logging.getLogger(__name__)

_firebase_initialized = False

# Apple's JWKS endpoint + issuer for Sign in with Apple identity tokens.
_APPLE_ISSUER = "https://appleid.apple.com"
_APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys"
_apple_jwk_client = None
_apple_jwk_lock = threading.Lock()


def _make_noop_credential():
    """Create a minimal Firebase credential for token verification only.

    verify_id_token fetches Google's public certs via HTTP and doesn't need
    real credentials. This avoids ADC lookup failures in Docker/non-GCP envs.
    """
    from firebase_admin import credentials as fb_credentials
    import google.auth.credentials

    class _Cred(fb_credentials.Base):
        def get_credential(self):
            return google.auth.credentials.AnonymousCredentials()

    return _Cred()


def _init_firebase() -> bool:
    """Initialize Firebase Admin SDK. Returns True if successful."""
    global _firebase_initialized
    if _firebase_initialized:
        return True

    try:
        import firebase_admin
        from firebase_admin import credentials

        # Check if already initialized
        try:
            firebase_admin.get_app()
            _firebase_initialized = True
            return True
        except ValueError:
            pass

        if config.FIREBASE_CREDENTIALS_JSON:
            cred_dict = json.loads(config.FIREBASE_CREDENTIALS_JSON)
            cred = credentials.Certificate(cred_dict)
            firebase_admin.initialize_app(cred)
        elif config.FIREBASE_PROJECT_ID:
            # No service account — use no-op credential.
            # verify_id_token only needs the project ID + Google's public certs.
            firebase_admin.initialize_app(_make_noop_credential(), options={
                "projectId": config.FIREBASE_PROJECT_ID,
            })
        else:
            logger.info("firebase_auth: No Firebase config, skipping init")
            return False

        _firebase_initialized = True
        logger.info("firebase_auth: Firebase Admin SDK initialized (project=%s)", config.FIREBASE_PROJECT_ID)
        return True
    except Exception as e:
        logger.warning("firebase_auth: Firebase init failed: %s", e)
        return False


def verify_firebase_token(token: str) -> Optional[str]:
    """
    Verify a Firebase ID token and return the user's email.

    Returns None if verification fails or Firebase is not configured.
    """
    if not _init_firebase():
        logger.warning("firebase_auth: Firebase not initialized, cannot verify token")
        return None

    try:
        from firebase_admin import auth
        decoded = auth.verify_id_token(token, check_revoked=False)
        email = decoded.get("email")
        if not email:
            logger.warning("firebase_auth: Token valid but no email claim")
            return None
        logger.info("firebase_auth: Verified token for %s", email)
        return email
    except Exception as e:
        logger.warning("firebase_auth: Token verification failed: %s", e)
        return None


def _apple_client_ids() -> list:
    """Allowed `aud` values for Apple identity tokens (native bundle id + any
    Services IDs), parsed from the comma-separated APPLE_CLIENT_IDS config."""
    return [c.strip() for c in config.APPLE_CLIENT_IDS.split(",") if c.strip()]


def _get_apple_jwk_client():
    """Lazily build (and cache) a PyJWKClient for Apple's signing keys.

    PyJWKClient caches fetched keys in-process and re-fetches on a cache miss
    (e.g. after Apple rotates keys), so one client instance is reused for the
    life of the process."""
    global _apple_jwk_client
    if _apple_jwk_client is None:
        with _apple_jwk_lock:
            if _apple_jwk_client is None:
                from jwt import PyJWKClient
                _apple_jwk_client = PyJWKClient(_APPLE_JWKS_URL)
    return _apple_jwk_client


def verify_apple_token(token: str) -> Optional[str]:
    """
    Verify a Sign in with Apple identity token and return the user's email.

    Validates the RS256 signature against Apple's published JWKS, the issuer
    (`https://appleid.apple.com`) and the audience (the app's bundle id /
    Services ID from APPLE_CLIENT_IDS). Returns None on any failure.

    Note: Apple only includes the `email` claim when the app requested the
    email scope at first consent; it continues to return it on later sign-ins.
    A user who chose "Hide My Email" gets a private relay address, which is
    still a stable per-app identifier we can key on.
    """
    client_ids = _apple_client_ids()
    if not client_ids:
        logger.warning("firebase_auth: APPLE_CLIENT_IDS not configured, cannot verify Apple token")
        return None

    try:
        import jwt

        signing_key = _get_apple_jwk_client().get_signing_key_from_jwt(token)
        decoded = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=client_ids,
            issuer=_APPLE_ISSUER,
            options={"require": ["exp", "iss", "aud"]},
        )
        email = decoded.get("email")
        if not email:
            logger.warning("firebase_auth: Apple token valid but no email claim")
            return None
        logger.info("firebase_auth: Verified Apple token for %s", email)
        return email
    except Exception as e:
        logger.warning("firebase_auth: Apple token verification failed: %s", e)
        return None


# ---------------------------------------------------------------------------
# Workspace-issued login session
# ---------------------------------------------------------------------------
#
# The browser normally turns the openagents.org login-handoff custom token into
# a Firebase session itself (signInWithCustomToken) and then keeps refreshing
# Firebase ID tokens. Both steps need Google (identitytoolkit / securetoken),
# which is blocked in mainland China, so such users could register but never
# enter the workspace. This server-side alternative exchanges the custom token
# from Railway (which can reach Google), verifies the resulting ID token with
# the Admin SDK exactly like a browser-obtained one, and mints a workspace
# session JWT the client can present as its identity bearer without ever
# contacting Google.

_SESSION_ISSUER = "openagents-workspace"
_SESSION_ALG = "HS256"
_IDENTITY_TOOLKIT_SIGN_IN_URL = (
    "https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken"
)


def workspace_session_enabled() -> bool:
    return bool(config.WORKSPACE_SESSION_SECRET)


def exchange_custom_token(custom_token: str) -> Optional[dict]:
    """Exchange a Firebase custom token for verified identity claims.

    Calls Identity Toolkit's signInWithCustomToken with the project's web API
    key (the same public key the browser would use), then verifies the returned
    ID token through verify_firebase_claims so revocation, project binding and
    signature checks are identical to the browser path. Returns the claims dict
    ({"provider", "email", "firebase_uid", "display_name"}) or None on any
    failure. Never raises.
    """
    if not custom_token or not config.FIREBASE_WEB_API_KEY:
        return None
    try:
        import httpx

        resp = httpx.post(
            _IDENTITY_TOOLKIT_SIGN_IN_URL,
            params={"key": config.FIREBASE_WEB_API_KEY},
            json={"token": custom_token, "returnSecureToken": True},
            timeout=10.0,
        )
        if resp.status_code != 200:
            detail = ""
            try:
                detail = (resp.json().get("error") or {}).get("message", "")
            except Exception:
                pass
            logger.warning(
                "firebase_auth: custom token exchange rejected (%s %s)",
                resp.status_code, detail,
            )
            return None
        id_token = resp.json().get("idToken")
        if not id_token:
            logger.warning("firebase_auth: custom token exchange returned no idToken")
            return None
    except Exception as e:
        logger.warning("firebase_auth: custom token exchange failed: %s", e)
        return None

    return verify_firebase_claims(id_token)


def mint_workspace_session(claims: dict) -> tuple:
    """Mint a workspace session JWT for verified identity claims.

    Returns (token, expires_at_epoch_seconds). Raises RuntimeError when no
    WORKSPACE_SESSION_SECRET is configured — callers must check
    workspace_session_enabled() first and respond 503 instead.
    """
    if not workspace_session_enabled():
        raise RuntimeError("WORKSPACE_SESSION_SECRET is not configured")
    import jwt

    now = int(time.time())
    exp = now + max(1, config.WORKSPACE_SESSION_TTL_DAYS) * 86400
    payload = {
        "iss": _SESSION_ISSUER,
        "sub": claims.get("firebase_uid") or claims["email"],
        "email": claims["email"],
        "iat": now,
        "exp": exp,
        "jti": secrets.token_urlsafe(16),
    }
    if claims.get("firebase_uid"):
        payload["firebase_uid"] = claims["firebase_uid"]
    if claims.get("display_name"):
        payload["name"] = claims["display_name"]
    token = jwt.encode(payload, config.WORKSPACE_SESSION_SECRET, algorithm=_SESSION_ALG)
    return token, exp


def looks_like_workspace_session(token: str) -> bool:
    """Cheap, signature-free check of the `iss` claim so the provider-agnostic
    verifiers can route a workspace session without first paying for (and
    logging a warning from) a doomed Firebase verification. Any parse failure
    means "not ours"."""
    if not token or token.count(".") != 2:
        return False
    try:
        import jwt

        claims = jwt.decode(token, options={"verify_signature": False})
        return claims.get("iss") == _SESSION_ISSUER
    except Exception:
        return False


def verify_workspace_session(token: str) -> Optional[dict]:
    """Verify a workspace session JWT and return persisted identity claims
    ({"provider": "workspace_session", "email", "firebase_uid", "display_name"}),
    or None if the secret is unset, the signature/expiry fails, or the email
    claim is missing."""
    if not workspace_session_enabled():
        return None
    try:
        import jwt

        decoded = jwt.decode(
            token,
            config.WORKSPACE_SESSION_SECRET,
            algorithms=[_SESSION_ALG],
            issuer=_SESSION_ISSUER,
            options={"require": ["exp", "iss", "email"]},
        )
    except Exception as e:
        logger.warning("firebase_auth: workspace session verification failed: %s", e)
        return None
    email = (decoded.get("email") or "").strip().lower()
    if not email:
        return None
    return {
        "provider": "workspace_session",
        "email": email,
        "firebase_uid": decoded.get("firebase_uid"),
        "display_name": decoded.get("name"),
    }


def verify_identity_token(token: str) -> Optional[str]:
    """
    Verify an end-user identity token from any supported login provider and
    return the user's email.

    A workspace-issued session (see mint_workspace_session) is recognised by
    its issuer and verified locally; otherwise tries Firebase/Google first (the
    existing web + Google-Sign-In path), then Sign in with Apple. Returns None
    if no provider accepts the token. This is the provider-agnostic entry point
    new callers should use.
    """
    if looks_like_workspace_session(token):
        claims = verify_workspace_session(token)
        return claims["email"] if claims else None
    email = verify_firebase_token(token)
    if email:
        return email
    return verify_apple_token(token)


def verify_firebase_claims(token: str) -> Optional[dict]:
    """Verify a Firebase ID token and return the identity claims we persist.

    Returns {"provider", "email", "firebase_uid", "display_name"} or None.

    The email — the field access decisions depend on — is obtained via
    verify_firebase_token, keeping that the single verification seam (so
    existing callers and their test mocks continue to work). The stable `uid`
    and `name` claims are augmented best-effort, only when the Admin SDK is
    actually initialized, so a mocked/uninitialized environment still yields
    email-only claims instead of failing outright.
    """
    email = verify_firebase_token(token)
    if not email:
        return None

    firebase_uid = None
    display_name = None
    if _init_firebase():
        try:
            from firebase_admin import auth
            decoded = auth.verify_id_token(token, check_revoked=False)
            firebase_uid = decoded.get("uid")
            display_name = decoded.get("name") or decoded.get("displayName")
        except Exception as e:
            logger.warning("firebase_auth: Firebase claims augmentation failed: %s", e)

    return {
        "provider": "firebase",
        "email": email,
        "firebase_uid": firebase_uid,
        "display_name": display_name,
    }


def verify_apple_claims(token: str) -> Optional[dict]:
    """Verify a Sign in with Apple identity token and return persisted claims.

    Returns {"provider", "email", "apple_sub", "display_name"} or None. Apple
    identity tokens carry no name claim (the name is only returned once, in the
    authorization response, not the token), so display_name is always None here.
    """
    client_ids = _apple_client_ids()
    if not client_ids:
        return None
    try:
        import jwt

        signing_key = _get_apple_jwk_client().get_signing_key_from_jwt(token)
        decoded = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=client_ids,
            issuer=_APPLE_ISSUER,
            options={"require": ["exp", "iss", "aud"]},
        )
        email = decoded.get("email")
        if not email:
            return None
        return {
            "provider": "apple",
            "email": email,
            "apple_sub": decoded.get("sub"),
            "display_name": None,
        }
    except Exception as e:
        logger.warning("firebase_auth: Apple claims verification failed: %s", e)
        return None


def verify_identity_claims(token: str) -> Optional[dict]:
    """Provider-agnostic identity verification returning persisted claims.

    Tries Firebase/Google then Sign in with Apple. Returns a dict with keys
    email, firebase_uid, apple_sub, display_name, provider (missing-provider
    ids are None), or None if neither provider accepts the token. This is the
    entry point for user-row resolution (app/access.py)."""
    if looks_like_workspace_session(token):
        return verify_workspace_session(token)
    claims = verify_firebase_claims(token)
    if claims:
        return claims
    return verify_apple_claims(token)
