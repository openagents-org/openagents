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
import threading
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


def verify_identity_token(token: str) -> Optional[str]:
    """
    Verify an end-user identity token from any supported login provider and
    return the user's email.

    Tries Firebase/Google first (the existing web + Google-Sign-In path), then
    Sign in with Apple. Returns None if neither accepts the token. This is the
    provider-agnostic entry point new callers should use.
    """
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
    claims = verify_firebase_claims(token)
    if claims:
        return claims
    return verify_apple_claims(token)
