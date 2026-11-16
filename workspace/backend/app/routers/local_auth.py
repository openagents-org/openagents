# -*- coding: utf-8 -*-
"""Local email + password login for self-hosted instances.

GET  /v1/auth/config               Which sign-in methods this server offers (public).
POST /v1/auth/local/signup         Create an account -> session (201).
POST /v1/auth/local/login          Email + password -> session.
POST /v1/auth/local/password       Change password (Bearer session) -> 204.
POST /v1/auth/local/reset/request  Email a one-time reset link -> always 202.
POST /v1/auth/local/reset          Reset token + new password -> session.

Every /v1/auth/local/* route is 404 unless local auth is enabled
(LOCAL_AUTH_ENABLED; automatic = on iff FIREBASE_PROJECT_ID is empty), so the
hosted deployment exposes none of it. Sessions are the same workspace session
JWT /v1/auth/session issues, so the rest of the API needs no changes.
"""

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.access import extract_bearer, get_or_create_user_by_email
from app.config import config
from app.database import get_db
from app.firebase_auth import mint_workspace_session, verify_identity_claims, workspace_session_enabled
from app.response import ResponseCode, json_response, success_response
from app.services import email as email_service
from app.services import local_auth as la

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/auth", tags=["Auth"])


def _require_local_auth() -> None:
    if not la.local_auth_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


local_router = APIRouter(prefix="/v1/auth/local", tags=["Auth"], dependencies=[Depends(_require_local_auth)])


def _session_payload(user) -> dict:
    claims = la.session_claims(user)
    token, exp = mint_workspace_session(claims)
    return {
        "session_token": token,
        "expires_at": datetime.fromtimestamp(exp, tz=timezone.utc).isoformat(),
        "email": claims["email"],
        "display_name": claims.get("display_name"),
    }


def _sessions_unavailable():
    return json_response(
        ResponseCode.INTERNAL_ERROR,
        "Workspace sessions are not enabled on this server",
        status_code=503,
    )


def _invalid(message: str):
    return json_response(ResponseCode.BAD_REQUEST, message, status_code=422)


def _client_ip(request: Request) -> str:
    # The socket peer only: forwarded headers are client-controlled unless the
    # server runs with --proxy-headers, which then rewrites request.client.
    return request.client.host if request.client else "unknown"


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

@router.get("/config")
def auth_config(db: Session = Depends(get_db)):
    """Public: which sign-in methods the web app should render."""
    local = la.local_auth_enabled()
    if local:
        providers = ["local"]
        signup_open = la.signup_mode() == "open" or not la.any_local_credentials(db)
    else:
        providers = []
        if (config.FIREBASE_PROJECT_ID or "").strip():
            providers.append("firebase")
        if (config.APPLE_CLIENT_IDS or "").strip():
            providers.append("apple")
        signup_open = False
    return success_response({
        "local_auth": local,
        "signup_open": signup_open,
        "email_enabled": email_service.email_configured(),
        "providers": providers,
    })


# ---------------------------------------------------------------------------
# Signup / login
# ---------------------------------------------------------------------------

class SignupRequest(BaseModel):
    email: str
    password: str
    display_name: Optional[str] = None
    invite_token: Optional[str] = None


@local_router.post("/signup")
def signup(body: SignupRequest, db: Session = Depends(get_db)):
    """Create a local account and sign it in.

    Responses:
      201 session payload
      403 invite-only instance and no valid invite was presented
      409 the email already has a password, or belongs to an existing account
          (e.g. someone invited) and no invite for that address was presented
      422 invalid email / password too short
      503 sessions unavailable
    """
    if not workspace_session_enabled():
        return _sessions_unavailable()
    email = la.normalize_email(body.email)
    problem = la.email_problem(email) or la.password_problem(body.password)
    if problem:
        return _invalid(problem)

    user = la.find_user(db, email)
    if la.get_credential(db, user) is not None:
        return json_response(ResponseCode.CONFLICT, "An account with this email already exists. Sign in instead.")

    invite = la.find_valid_invite(db, body.invite_token, email)
    if body.invite_token and invite is None:
        return json_response(
            ResponseCode.FORBIDDEN,
            "This invite link is invalid, expired, or meant for a different email address",
        )
    bound_invite = invite if invite is not None and invite.email else None
    first_account = not la.any_local_credentials(db)

    if la.signup_mode() == "invite" and not first_account and invite is None:
        return json_response(ResponseCode.FORBIDDEN, "Sign-up on this server is by invitation only")

    # Claiming an address that already carries access (a users row created when
    # it was invited/added, or legacy creator/collaborator rows) needs proof the
    # caller was sent that address's invite — otherwise anyone could sign up as
    # an invitee and inherit their memberships.
    claim_message = (
        "This email already has access on this server. Sign up from the invite link sent to it, "
        "use \"Forgot password\" to set a password by email, or ask the server admin."
    )
    if user is not None and bound_invite is None:
        return json_response(ResponseCode.CONFLICT, claim_message)
    if user is None and bound_invite is None and not first_account and la.has_legacy_access(db, email):
        return json_response(ResponseCode.CONFLICT, claim_message)

    try:
        user = get_or_create_user_by_email(db, email)
        if la.get_credential(db, user) is not None:
            db.rollback()
            return json_response(ResponseCode.CONFLICT, "An account with this email already exists. Sign in instead.")
        name = (body.display_name or "").strip()[:200]
        if name and not user.display_name:
            user.display_name = name
        user.last_login_at = datetime.now(timezone.utc)
        la.set_password(db, user, body.password)
        db.commit()
    except IntegrityError:
        db.rollback()
        return json_response(ResponseCode.CONFLICT, "An account with this email already exists. Sign in instead.")

    logger.info("local_auth: signup %s%s", email, " (first account)" if first_account else "")
    return json_response(ResponseCode.SUCCESS, "ok", _session_payload(user), status_code=201)


class LoginRequest(BaseModel):
    email: str
    password: str


@local_router.post("/login")
def login(body: LoginRequest, request: Request, db: Session = Depends(get_db)):
    """Responses: 200 session payload; 401 invalid email or password; 429 throttled."""
    if not workspace_session_enabled():
        return _sessions_unavailable()
    email = la.normalize_email(body.email)
    key = ("login", email, _client_ip(request))
    if la.throttled(key):
        return json_response(ResponseCode.TOO_MANY_REQUESTS, "Too many failed sign-in attempts. Try again later.")

    password = body.password if isinstance(body.password, str) else ""
    user = la.find_user(db, email) if email else None
    cred = la.get_credential(db, user)
    if cred is None or len(password) > la.MAX_PASSWORD_LENGTH:
        la.burn_dummy_verify(password[: la.MAX_PASSWORD_LENGTH])
        ok = False
    else:
        ok = la.verify_password(password, cred.password_hash)
    if not ok:
        la.record_failure(key)
        return json_response(ResponseCode.UNAUTHORIZED, "invalid email or password")

    la.clear_failures(key)
    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    logger.info("local_auth: login %s", email)
    return success_response(_session_payload(user))


# ---------------------------------------------------------------------------
# Password change / reset
# ---------------------------------------------------------------------------

class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str


@local_router.post("/password")
def change_password(
    body: PasswordChangeRequest,
    request: Request,
    db: Session = Depends(get_db),
    authorization: Optional[str] = Header(None),
):
    """Responses: 204; 401 no/invalid session or wrong current password;
    422 new password too short; 429 throttled."""
    bearer = extract_bearer(authorization)
    claims = verify_identity_claims(bearer) if bearer else None
    if not claims:
        return json_response(ResponseCode.UNAUTHORIZED, "Sign in to change your password")
    email = la.normalize_email(claims.get("email"))
    key = ("password", email, _client_ip(request))
    if la.throttled(key):
        return json_response(ResponseCode.TOO_MANY_REQUESTS, "Too many failed attempts. Try again later.")
    problem = la.password_problem(body.new_password)
    if problem:
        return _invalid(problem)
    user = la.find_user(db, email)
    cred = la.get_credential(db, user)
    if cred is None or not la.verify_password(body.current_password or "", cred.password_hash):
        la.record_failure(key)
        return json_response(ResponseCode.UNAUTHORIZED, "Current password is incorrect")
    la.clear_failures(key)
    la.set_password(db, user, body.new_password)
    db.commit()
    logger.info("local_auth: password changed for %s", email)
    return Response(status_code=204)


class ResetRequestBody(BaseModel):
    email: str


RESET_REQUESTS_PER_WINDOW = 5


@local_router.post("/reset/request")
def request_reset(body: ResetRequestBody, request: Request, db: Session = Depends(get_db)):
    """Always 202, whether or not the account exists, so this can't be used to
    probe for accounts. When email is configured, sends a one-time link to an
    address that has a password — or that already has an account without one
    (invited/added by an admin), which lets that person claim it by proving
    they read the mailbox."""
    accepted = json_response(ResponseCode.SUCCESS, "If that account exists, a reset link has been sent.", status_code=202)
    email = la.normalize_email(body.email)
    if not email or la.email_problem(email) or not workspace_session_enabled() or not email_service.email_configured():
        return accepted
    # Cap mails per address (and per caller) so the endpoint can't be used to flood an inbox.
    for key in (("reset-mail", email, ""), ("reset-ip", "", _client_ip(request))):
        if la.throttled(key, limit=RESET_REQUESTS_PER_WINDOW):
            return accepted
    user = la.find_user(db, email)
    if user is None:
        return accepted
    cred = la.get_credential(db, user)
    link = la.reset_link(la.mint_reset_token(user, cred))
    email_service.send_password_reset_email(email, link, ttl_minutes=la.RESET_TOKEN_TTL_SECONDS // 60)
    la.record_failure(("reset-mail", email, ""))
    la.record_failure(("reset-ip", "", _client_ip(request)))
    logger.info("local_auth: reset link sent to %s", email)
    return accepted


class ResetBody(BaseModel):
    token: str
    new_password: str


@local_router.post("/reset")
def reset_password(body: ResetBody, db: Session = Depends(get_db)):
    """Responses: 200 session payload; 400 invalid/expired/used token; 422 weak password."""
    if not workspace_session_enabled():
        return _sessions_unavailable()
    problem = la.password_problem(body.new_password)
    if problem:
        return _invalid(problem)
    user = la.verify_reset_token(db, body.token)
    if user is None:
        return json_response(ResponseCode.BAD_REQUEST, "This reset link is invalid, expired, or already used")
    la.set_password(db, user, body.new_password)
    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    la.clear_failures_for_email(user.email)
    logger.info("local_auth: password reset for %s", user.email)
    return success_response(_session_payload(user))
