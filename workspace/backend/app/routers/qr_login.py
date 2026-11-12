# -*- coding: utf-8 -*-
"""
QR-code login: sign in on a computer by scanning a code with a phone that is
already signed in, as in WeChat and Lark.

    computer                         backend                        phone
    POST /v1/auth/qr          ─────▶ new request (2 min)
      ◀── id, poll_secret, qr_url
    shows qr_url as a QR code
                                                   ◀─── POST /v1/auth/qr/{id}/scan     (Bearer)
    POST /{id}/poll  ─────▶ "scanned"                   ─── who is asking (device, time)
                                                   ◀─── POST /v1/auth/qr/{id}/approve  (Bearer)
    POST /{id}/poll  ─────▶ "approved" + session (once)

The code carries only the request id (inside a workspace URL, so a phone
camera without the app opens the confirm page). Collecting the session needs
the poll secret, which never leaves the computer that asked — a photo of the
code is not enough to sign in. The session minted is the same 30-day
workspace session as /v1/auth/session, for the account that approved.

The phone must be signed in already; scan and approve take its bearer, and
the account that scanned is the only one that may approve or cancel.
"""

import logging
import re
import time
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Header, Request
from pydantic import BaseModel, Field

from app import qr_login
from app.config import config
from app.firebase_auth import mint_workspace_session, verify_identity_claims, workspace_session_enabled
from app.response import ResponseCode, json_response, success_response
from app.routers.network import _extract_bearer

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/auth/qr", tags=["Auth"])

POLL_INTERVAL_MS = 1500

_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{16,64}$")


def _iso(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat()


def describe_device(user_agent: str) -> str:
    """'Chrome on macOS' from a User-Agent — what the phone shows before approving."""
    ua = user_agent or ""
    if "OpenAgentsLauncher" in ua or "Electron" in ua:
        browser = "OpenAgents desktop app"
    elif "Edg/" in ua:
        browser = "Edge"
    elif "Firefox/" in ua:
        browser = "Firefox"
    elif "Chrome/" in ua or "CriOS/" in ua:
        browser = "Chrome"
    elif "Safari/" in ua:
        browser = "Safari"
    else:
        browser = "A browser"
    if "Windows" in ua:
        system = "Windows"
    elif "iPhone" in ua or "iPad" in ua:
        system = "iOS"
    elif "Mac OS X" in ua or "Macintosh" in ua:
        system = "macOS"
    elif "Android" in ua:
        system = "Android"
    elif "Linux" in ua:
        system = "Linux"
    else:
        return browser
    return f"{browser} on {system}"


def _unavailable():
    return json_response(
        ResponseCode.INTERNAL_ERROR,
        "QR login is not available right now. Please sign in another way.",
        status_code=503,
    )


def _expired():
    return json_response(ResponseCode.GONE, "This QR code has expired. Show a new one and scan again.")


def _caller(authorization: Optional[str]) -> Optional[dict]:
    bearer = _extract_bearer(authorization)
    return verify_identity_claims(bearer) if bearer else None


def _request_summary(record: dict) -> dict:
    return {
        "status": record["status"],
        "client": record.get("client", "web"),
        "device": record.get("device", ""),
        "created_at": _iso(record["created_at"]),
        "expires_at": _iso(record["expires_at"]),
    }


class CreateRequest(BaseModel):
    client: Literal["web", "desktop"] = "web"


@router.post("")
def create_qr_login(request: Request, body: Optional[CreateRequest] = None):
    """Start a QR login on the computer that wants to sign in.

    Responses:
      200 {id, poll_secret, qr_url, expires_at, poll_interval_ms}
      503 workspace sessions or the shared store are unavailable
    """
    if not workspace_session_enabled():
        return _unavailable()
    now = time.time()
    request_id = qr_login.new_id()
    secret = qr_login.new_secret()
    record = {
        "id": request_id,
        "secret_hash": qr_login.hash_secret(secret),
        "status": qr_login.PENDING,
        "client": (body.client if body else "web"),
        "device": describe_device(request.headers.get("user-agent", "")),
        "created_at": now,
        "expires_at": now + qr_login.CODE_TTL_SECONDS,
    }
    try:
        qr_login.create(record)
    except qr_login.Unavailable:
        return _unavailable()
    base = config.FRONTEND_BASE_URL.rstrip("/")
    return success_response({
        "id": request_id,
        "poll_secret": secret,
        "qr_url": f"{base}/qr-login?id={request_id}",
        "expires_at": _iso(record["expires_at"]),
        "poll_interval_ms": POLL_INTERVAL_MS,
    })


class PollRequest(BaseModel):
    poll_secret: str = Field(..., min_length=1, max_length=256)


@router.post("/{request_id}/poll")
def poll_qr_login(request_id: str, body: PollRequest):
    """Ask how the QR login is going, from the computer that started it.

    `status` is pending, scanned, approved, cancelled or expired. The first
    poll that sees `approved` also gets `session` {session_token, expires_at,
    email, display_name}; the request is gone after that.

    Responses:
      200 {status, expires_at?, session?}
      403 wrong poll_secret
      503 store unavailable
    """
    if not _ID_PATTERN.match(request_id):
        return success_response({"status": qr_login.EXPIRED})
    try:
        record = qr_login.get(request_id)
        if record is None:
            return success_response({"status": qr_login.EXPIRED})
        if not qr_login.secrets_match(record, body.poll_secret):
            return json_response(ResponseCode.FORBIDDEN, "Not your QR code.")
        if record["status"] != qr_login.APPROVED:
            return success_response({"status": record["status"], "expires_at": _iso(record["expires_at"])})
        taken = qr_login.take(request_id)
    except qr_login.Unavailable:
        return _unavailable()
    # Another poll may have collected it between the read and the take.
    if not taken or taken.get("status") != qr_login.APPROVED or not qr_login.secrets_match(taken, body.poll_secret):
        return success_response({"status": qr_login.EXPIRED})

    claims = taken["claims"]
    token, exp = mint_workspace_session(claims)
    logger.info("auth: issued workspace session for %s (qr login, %s)", claims["email"], taken.get("client"))
    return success_response({
        "status": qr_login.APPROVED,
        "session": {
            "session_token": token,
            "expires_at": _iso(exp),
            "email": claims["email"],
            "display_name": claims.get("display_name"),
        },
    })


def _phone_step(request_id: str, authorization: Optional[str], step):
    """Shared shape of scan / approve / cancel: signed-in caller, live request."""
    if not workspace_session_enabled():
        return _unavailable()
    claims = _caller(authorization)
    if not claims or not claims.get("email"):
        return json_response(ResponseCode.UNAUTHORIZED, "Sign in on this device first.")
    email = claims["email"].strip().lower()
    if not _ID_PATTERN.match(request_id):
        return _expired()

    def change(record: dict) -> tuple:
        return step(record, email, claims)

    try:
        record = qr_login.update(request_id, change)
    except qr_login.Conflict as e:
        return json_response(ResponseCode.CONFLICT, str(e) if str(e) != "busy" else "Please try again.")
    except qr_login.Unavailable:
        return _unavailable()
    if record is None:
        return _expired()
    return success_response(_request_summary(record))


def _check_owner(record: dict, email: str) -> None:
    if record["status"] in (qr_login.APPROVED, qr_login.CANCELLED):
        raise qr_login.Conflict("This QR code has already been used.")
    if record.get("scanned_by") and record["scanned_by"] != email:
        raise qr_login.Conflict("This QR code was scanned by another account.")


@router.post("/{request_id}/scan")
def scan_qr_login(request_id: str, authorization: Optional[str] = Header(None)):
    """The phone read the code: claim it for this account and say who is asking.

    Responses:
      200 {status: "scanned", client, device, created_at, expires_at}
      401 no or invalid bearer
      409 already scanned by another account, approved or cancelled
      410 expired or unknown
    """
    def step(record: dict, email: str, claims: dict) -> tuple:
        _check_owner(record, email)
        now = time.time()
        record.update(status=qr_login.SCANNED, scanned_by=email, expires_at=now + qr_login.CONFIRM_TTL_SECONDS)
        return record, qr_login.CONFIRM_TTL_SECONDS

    return _phone_step(request_id, authorization, step)


@router.post("/{request_id}/approve")
def approve_qr_login(request_id: str, authorization: Optional[str] = Header(None)):
    """Sign the computer in to this account. Scanning first is implied.

    Responses:
      200 {status: "approved", ...}
      401 / 409 / 410 as for scan
    """
    def step(record: dict, email: str, claims: dict) -> tuple:
        _check_owner(record, email)
        now = time.time()
        record.update(
            status=qr_login.APPROVED,
            scanned_by=email,
            expires_at=now + qr_login.CLAIM_TTL_SECONDS,
            claims={
                "email": email,
                "firebase_uid": claims.get("firebase_uid"),
                "display_name": claims.get("display_name"),
                "email_verified": claims.get("email_verified") is True,
            },
        )
        return record, qr_login.CLAIM_TTL_SECONDS

    response = _phone_step(request_id, authorization, step)
    if isinstance(response, dict):
        logger.info("auth: qr login %s approved", request_id[:6])
    return response


@router.post("/{request_id}/cancel")
def cancel_qr_login(request_id: str, authorization: Optional[str] = Header(None)):
    """Refuse the sign-in; the computer is told and can show a new code.

    Responses:
      200 {status: "cancelled", ...}
      401 / 409 / 410 as for scan
    """
    def step(record: dict, email: str, claims: dict) -> tuple:
        _check_owner(record, email)
        record.update(status=qr_login.CANCELLED, scanned_by=email)
        return record, max(1, qr_login.remaining(record))

    return _phone_step(request_id, authorization, step)
