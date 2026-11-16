# -*- coding: utf-8 -*-
"""Local email + password accounts for self-hosted instances.

The hosted deployment signs people in through openagents.org (Firebase) or
Sign in with Apple. A self-hosted instance has neither, so this module lets it
keep its own credentials: a `local_credentials` row (scrypt hash) per User,
exchanged at /v1/auth/local/* for the same workspace session JWT the hosted
flows mint (app/firebase_auth.mint_workspace_session). Everything downstream —
user resolution, memberships, invites — is unchanged, because a session JWT is
already a full identity there.

Gate: LOCAL_AUTH_ENABLED ("true"/"false"; unset = on iff FIREBASE_PROJECT_ID
is empty). With it off nothing here runs and the routes answer 404.
"""

import base64
import hashlib
import hmac
import logging
import os
import re
import secrets
import tempfile
import threading
import time
from collections import deque
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import exists, func, select
from sqlalchemy.orm import Session

from app.config import config
from app.models import LocalCredential, User, Workspace, WorkspaceCollaborator, WorkspaceInvite

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Gate
# ---------------------------------------------------------------------------

def local_auth_enabled() -> bool:
    raw = (config.LOCAL_AUTH_ENABLED or "").strip().lower()
    if raw in ("true", "1", "yes", "on"):
        return True
    if raw in ("false", "0", "no", "off"):
        return False
    return not (config.FIREBASE_PROJECT_ID or "").strip()


def signup_mode() -> str:
    return "invite" if (config.LOCAL_SIGNUP or "").strip().lower() == "invite" else "open"


def any_local_credentials(db: Session) -> bool:
    return bool(db.execute(select(exists().where(LocalCredential.user_id.isnot(None)))).scalar())


# ---------------------------------------------------------------------------
# Password hashing (stdlib scrypt, versioned encoding)
# ---------------------------------------------------------------------------

MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_LENGTH = 1024
_SCRYPT_N, _SCRYPT_R, _SCRYPT_P = 2 ** 14, 8, 1
_SCRYPT_DKLEN = 32
_SALT_BYTES = 16


def _b64e(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def _scrypt(password: str, salt: bytes, n: int, r: int, p: int, dklen: int) -> bytes:
    return hashlib.scrypt(
        password.encode("utf-8"), salt=salt, n=n, r=r, p=p, dklen=dklen,
        maxmem=128 * r * (n + p + 2) + 1024 * 1024,
    )


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(_SALT_BYTES)
    digest = _scrypt(password, salt, _SCRYPT_N, _SCRYPT_R, _SCRYPT_P, _SCRYPT_DKLEN)
    return f"scrypt${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${_b64e(salt)}${_b64e(digest)}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        scheme, n, r, p, salt_b64, hash_b64 = encoded.split("$")
        if scheme != "scrypt":
            return False
        n, r, p = int(n), int(r), int(p)
        # Refuse absurd parameters from a tampered row instead of exhausting memory.
        if not (2 <= n <= 2 ** 20 and 1 <= r <= 32 and 1 <= p <= 16):
            return False
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(hash_b64)
        actual = _scrypt(password, salt, n, r, p, len(expected))
    except Exception:  # noqa: BLE001 — a malformed hash is simply "no match"
        return False
    return hmac.compare_digest(actual, expected)


# A real hash to verify against when the account doesn't exist, so a login for
# an unknown email costs the same scrypt work as one with a wrong password.
_DUMMY_HASH: Optional[str] = None


def burn_dummy_verify(password: str) -> None:
    global _DUMMY_HASH
    if _DUMMY_HASH is None:
        _DUMMY_HASH = hash_password(secrets.token_urlsafe(16))
    verify_password(password, _DUMMY_HASH)


# ---------------------------------------------------------------------------
# Input validation
# ---------------------------------------------------------------------------

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def normalize_email(email: Optional[str]) -> str:
    return (email or "").strip().lower()


def email_problem(email: str) -> Optional[str]:
    if not email or len(email) > 320 or not _EMAIL_RE.match(email):
        return "Enter a valid email address"
    return None


def password_problem(password: Optional[str]) -> Optional[str]:
    if not isinstance(password, str) or len(password) < MIN_PASSWORD_LENGTH:
        return f"Password must be at least {MIN_PASSWORD_LENGTH} characters"
    if len(password) > MAX_PASSWORD_LENGTH:
        return f"Password must be at most {MAX_PASSWORD_LENGTH} characters"
    return None


# ---------------------------------------------------------------------------
# Accounts
# ---------------------------------------------------------------------------

def _now() -> datetime:
    return datetime.now(timezone.utc)


def find_user(db: Session, email: str) -> Optional[User]:
    return db.execute(select(User).where(User.email == email)).scalar_one_or_none()


def get_credential(db: Session, user: Optional[User]) -> Optional[LocalCredential]:
    if user is None:
        return None
    return db.get(LocalCredential, user.id)


def set_password(db: Session, user: User, password: str) -> LocalCredential:
    """Create or replace the user's credential. Does NOT commit."""
    cred = db.get(LocalCredential, user.id)
    encoded = hash_password(password)
    if cred is None:
        cred = LocalCredential(user_id=user.id, password_hash=encoded)
        db.add(cred)
    else:
        cred.password_hash = encoded
        cred.updated_at = _now()
    return cred


def has_legacy_access(db: Session, email: str) -> bool:
    """Would signing in as `email` inherit pre-existing access?

    reconcile_memberships (app/access.py) turns workspaces whose creator_email
    matches, and legacy collaborator rows, into memberships the first time that
    email signs in — so claiming such an email is as sensitive as claiming an
    existing users row."""
    owned = db.execute(select(exists().where(
        func.lower(Workspace.creator_email) == email,
        Workspace.status != "deleted",
    ))).scalar()
    if owned:
        return True
    return bool(db.execute(select(exists().where(WorkspaceCollaborator.email == email))).scalar())


def _invite_pending(invite: WorkspaceInvite) -> bool:
    if invite.revoked_at is not None:
        return False
    if invite.email and invite.accepted_at is not None:
        return False
    expires = invite.expires_at
    if expires is not None and expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    return not (expires is not None and expires < _now())


def find_valid_invite(db: Session, token: Optional[str], email: str) -> Optional[WorkspaceInvite]:
    """The pending invite `token` names, if it may be used by `email`.

    Email-bound invites must match the address; open links (no email) are
    returned too — callers decide whether an open link is enough."""
    if not token or len(token) > 512:
        return None
    invite = db.execute(select(WorkspaceInvite).where(WorkspaceInvite.token == token)).scalar_one_or_none()
    if invite is None or not _invite_pending(invite):
        return None
    workspace = db.get(Workspace, invite.workspace_id)
    if workspace is None or workspace.status == "deleted":
        return None
    if invite.email and invite.email.strip().lower() != email:
        return None
    return invite


def session_claims(user: User) -> dict:
    """Claims for mint_workspace_session. Local accounts never prove control of
    their address, so the session is not marked email-verified."""
    return {"email": user.email, "display_name": user.display_name, "email_verified": False}


# ---------------------------------------------------------------------------
# Password reset tokens
# ---------------------------------------------------------------------------

RESET_TOKEN_TTL_SECONDS = 3600
# A different issuer from the session JWT ("openagents-workspace"), so a reset
# token can never be presented as a session and vice versa.
_RESET_ISSUER = "openagents-workspace-password-reset"
_RESET_AUDIENCE = "local-auth-reset"


def _fingerprint(user: User, cred: Optional[LocalCredential]) -> str:
    """Changes whenever the password does (each hash has a fresh salt) and when
    a first password is set, which is what makes a reset token single-use."""
    material = cred.password_hash if cred is not None else f"unset:{user.id}"
    return hashlib.sha256(material.encode("utf-8")).hexdigest()[:32]


def mint_reset_token(user: User, cred: Optional[LocalCredential]) -> str:
    import jwt

    now = int(time.time())
    payload = {
        "iss": _RESET_ISSUER,
        "aud": _RESET_AUDIENCE,
        "sub": str(user.id),
        "email": user.email,
        "fp": _fingerprint(user, cred),
        "iat": now,
        "exp": now + RESET_TOKEN_TTL_SECONDS,
    }
    return jwt.encode(payload, config.WORKSPACE_SESSION_SECRET, algorithm="HS256")


def verify_reset_token(db: Session, token: str) -> Optional[User]:
    """Return the user a still-valid, unused reset token belongs to."""
    if not token or not config.WORKSPACE_SESSION_SECRET:
        return None
    try:
        import jwt

        decoded = jwt.decode(
            token,
            config.WORKSPACE_SESSION_SECRET,
            algorithms=["HS256"],
            issuer=_RESET_ISSUER,
            audience=_RESET_AUDIENCE,
            options={"require": ["exp", "iss", "aud", "sub", "fp"]},
        )
    except Exception as e:  # noqa: BLE001
        logger.info("local_auth: reset token rejected: %s", e)
        return None
    user = db.get(User, decoded["sub"])
    if user is None or user.email != decoded.get("email"):
        return None
    if not hmac.compare_digest(str(decoded["fp"]), _fingerprint(user, get_credential(db, user))):
        return None
    return user


def reset_link(token: str) -> str:
    return f"{config.FRONTEND_BASE_URL.rstrip('/')}/reset-password?token={token}"


# ---------------------------------------------------------------------------
# Failed-login throttle (in-memory, per process)
# ---------------------------------------------------------------------------

THROTTLE_MAX_FAILURES = 10
THROTTLE_WINDOW_SECONDS = 15 * 60
_failures: dict = {}
_failures_lock = threading.Lock()


def _prune(q: deque, now: float) -> None:
    while q and now - q[0] > THROTTLE_WINDOW_SECONDS:
        q.popleft()


def throttled(key: tuple, limit: int = THROTTLE_MAX_FAILURES) -> bool:
    now = time.monotonic()
    with _failures_lock:
        q = _failures.get(key)
        if not q:
            return False
        _prune(q, now)
        if not q:
            _failures.pop(key, None)
            return False
        return len(q) >= limit


def record_failure(key: tuple) -> None:
    now = time.monotonic()
    with _failures_lock:
        # Bound memory against a flood of distinct keys.
        if len(_failures) > 50_000:
            for k in [k for k, q in _failures.items() if not q or now - q[-1] > THROTTLE_WINDOW_SECONDS]:
                _failures.pop(k, None)
        q = _failures.setdefault(key, deque())
        _prune(q, now)
        q.append(now)


def clear_failures(key: tuple) -> None:
    with _failures_lock:
        _failures.pop(key, None)


def clear_failures_for_email(email: str) -> None:
    """Forget every throttle entry for an address (after a successful reset)."""
    with _failures_lock:
        for k in [k for k in _failures if len(k) > 1 and k[1] == email]:
            _failures.pop(k, None)


def reset_throttle() -> None:
    """Testing hook."""
    with _failures_lock:
        _failures.clear()


# ---------------------------------------------------------------------------
# Session secret bootstrap
# ---------------------------------------------------------------------------

def ensure_session_secret() -> None:
    """Give a local-auth instance a WORKSPACE_SESSION_SECRET if it has none.

    Never runs when the variable is set (the hosted deployment sets it) or when
    local auth is off. The generated secret is persisted to
    ${DATA_DIR}/session_secret (0600) so sessions survive restarts and every
    worker process agrees on it; if that directory is unusable, falls back to a
    process-local random secret.
    """
    if config.WORKSPACE_SESSION_SECRET or not local_auth_enabled():
        return
    data_dir = config.DATA_DIR or "/data"
    path = os.path.join(data_dir, "session_secret")
    try:
        os.makedirs(data_dir, mode=0o700, exist_ok=True)
        secret = _read_secret(path)
        if not secret:
            secret = _create_secret(data_dir, path)
        config.WORKSPACE_SESSION_SECRET = secret
        logger.info("local_auth: using session secret from %s", path)
    except OSError as e:
        config.WORKSPACE_SESSION_SECRET = secrets.token_urlsafe(48)
        logger.error(
            "local_auth: cannot persist a session secret at %s (%s). Using a process-local "
            "random secret: sign-ins will NOT survive a restart and will not work across "
            "multiple workers. Set WORKSPACE_SESSION_SECRET or make DATA_DIR writable.",
            path, e,
        )


def _read_secret(path: str) -> str:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read().strip()
    except FileNotFoundError:
        return ""


def _create_secret(data_dir: str, path: str) -> str:
    """Write a fresh secret atomically; if another worker won the race, use theirs."""
    secret = secrets.token_urlsafe(48)
    fd, tmp = tempfile.mkstemp(prefix=".session_secret.", dir=data_dir)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(secret + "\n")
            f.flush()
            os.fsync(f.fileno())
        try:
            os.link(tmp, path)  # atomic; fails if the file already exists
        except FileExistsError:
            existing = _read_secret(path)
            if existing:
                return existing
            raise
        except OSError:
            # Filesystem without hard links: exclusive create instead.
            try:
                out = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            except FileExistsError:
                existing = _read_secret(path)
                if existing:
                    return existing
                raise
            with os.fdopen(out, "w", encoding="utf-8") as f:
                f.write(secret + "\n")
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass
    logger.warning("local_auth: generated a new session secret at %s", path)
    return secret
