"""Credentials for the agent hub: personal API keys and OAuth tokens.

Other apps act for a person through the hub API (`/v1/hub/*`) and the MCP
endpoint (`/mcp`). They present either a personal API key the person created
(`oa_pk_…`) or an OAuth access token from the consent flow (`oa_at_…`). Only
SHA-256 hashes are stored.

Hub handlers then call the ordinary workspace API code as that person, with a
minutes-long workspace session minted here, so every existing access rule
(memberships, private threads, agent sharing) applies unchanged. The raw
credential itself is never accepted outside the hub.
"""
import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select

from app.access import extract_bearer
from app.firebase_auth import mint_workspace_session, workspace_session_enabled
from app.models import PersonalAccessToken, User

API_KEY_PREFIX = "oa_pk_"
ACCESS_TOKEN_PREFIX = "oa_at_"
REFRESH_TOKEN_PREFIX = "oa_rt_"
ACCESS_TOKEN_TTL = timedelta(hours=1)
REFRESH_TOKEN_TTL = timedelta(days=60)
SESSION_TTL_SECONDS = 300
_LAST_USED_RESOLUTION = timedelta(minutes=1)
MAX_ACTIVE_KEYS = 20


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: Optional[datetime]) -> Optional[datetime]:
    return value if value is None or value.tzinfo else value.replace(tzinfo=timezone.utc)


def hash_secret(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def _new_secret(prefix: str) -> str:
    return prefix + secrets.token_urlsafe(32)


def _display_prefix(raw: str) -> str:
    return raw[: len(API_KEY_PREFIX) + 4]


def create_api_key(db, user: User, name: str) -> tuple[PersonalAccessToken, str]:
    raw = _new_secret(API_KEY_PREFIX)
    row = PersonalAccessToken(
        user_id=user.id, kind="api_key", name=name,
        token_hash=hash_secret(raw), token_prefix=_display_prefix(raw),
    )
    db.add(row)
    db.flush()
    return row, raw


def issue_oauth_tokens(db, user_id: str, client_id: str, client_name: str) -> dict:
    access, refresh = _new_secret(ACCESS_TOKEN_PREFIX), _new_secret(REFRESH_TOKEN_PREFIX)
    now = _now()
    db.add(PersonalAccessToken(
        user_id=user_id, kind="oauth", name=client_name, client_id=client_id,
        token_hash=hash_secret(access), token_prefix=_display_prefix(access),
        refresh_hash=hash_secret(refresh),
        expires_at=now + ACCESS_TOKEN_TTL, refresh_expires_at=now + REFRESH_TOKEN_TTL,
    ))
    db.flush()
    return {
        "access_token": access,
        "token_type": "Bearer",
        "expires_in": int(ACCESS_TOKEN_TTL.total_seconds()),
        "refresh_token": refresh,
        "scope": "agents",
    }


def rotate_refresh_token(db, refresh_raw: str, client_id: str) -> Optional[dict]:
    """Exchange a refresh token for new tokens; the old pair stops working."""
    row = db.execute(select(PersonalAccessToken).where(
        PersonalAccessToken.refresh_hash == hash_secret(refresh_raw),
        PersonalAccessToken.kind == "oauth",
    ).with_for_update()).scalar_one_or_none()
    if (row is None or row.revoked_at is not None or row.client_id != client_id
            or (row.refresh_expires_at and _aware(row.refresh_expires_at) <= _now())):
        return None
    row.revoked_at = _now()
    return issue_oauth_tokens(db, row.user_id, row.client_id, row.name)


def resolve_hub_credential(db, authorization: Optional[str]) -> Optional[tuple[User, PersonalAccessToken]]:
    """The person and credential behind a hub request, or None."""
    raw = extract_bearer(authorization)
    if not raw or not raw.startswith((API_KEY_PREFIX, ACCESS_TOKEN_PREFIX)):
        return None
    row = db.execute(select(PersonalAccessToken).where(
        PersonalAccessToken.token_hash == hash_secret(raw),
    )).scalar_one_or_none()
    now = _now()
    if row is None or row.revoked_at is not None or (row.expires_at and _aware(row.expires_at) <= now):
        return None
    user = db.get(User, row.user_id)
    if user is None:
        return None
    if row.last_used_at is None or now - _aware(row.last_used_at) > _LAST_USED_RESOLUTION:
        row.last_used_at = now
        db.commit()
    return user, row


def acting_authorization(user: User) -> str:
    """An Authorization header that lets hub code call the workspace API as `user`."""
    if not workspace_session_enabled():
        raise RuntimeError("WORKSPACE_SESSION_SECRET is not configured")
    token, _ = mint_workspace_session(
        {"email": user.email, "firebase_uid": user.firebase_uid, "display_name": user.display_name,
         "email_verified": user.email_verified_at is not None},
        ttl_seconds=SESSION_TTL_SECONDS,
    )
    return f"Bearer {token}"
