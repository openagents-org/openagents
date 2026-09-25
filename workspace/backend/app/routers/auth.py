# -*- coding: utf-8 -*-
"""
Login-session endpoints for the workspace web app.

POST /v1/auth/session   Exchange an openagents.org login-handoff custom token
                        for a workspace-issued session JWT.

The generic OIDC browser flow is exposed under /v1/auth/oidc/*.
"""

import logging
from datetime import datetime, timezone
from urllib.parse import urljoin, urlsplit, urlunsplit

import jwt
from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel, Field

from app.config import config
from app.firebase_auth import (
    exchange_custom_token,
    mint_workspace_session,
    verify_workspace_session,
    workspace_session_enabled,
)
from app.oidc_auth import (
    OIDC_SESSION_COOKIE,
    complete_login,
    configuration_error,
    is_allowed_browser_origin,
    oidc_enabled,
    start_login,
)
from app.oidc_auth import logout_redirect as provider_logout_redirect
from app.response import ResponseCode, json_response, success_response

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/v1/auth", tags=["Auth"])


class SessionRequest(BaseModel):
    custom_token: str = Field(..., min_length=1, max_length=4096)


def _safe_return_to(value: str | None) -> str | None:
    frontend = str(getattr(config, "FRONTEND_BASE_URL", "") or "").strip()
    if not frontend:
        return None
    if not value:
        return frontend
    try:
        parsed = urlsplit(value)
        if not parsed.scheme and not parsed.netloc:
            if value.startswith("//"):
                return None
            return urljoin(frontend.rstrip("/") + "/", value.lstrip("/"))
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            return None
        if not is_allowed_browser_origin(f"{parsed.scheme}://{parsed.netloc}"):
            return None
        return urlunsplit(parsed)
    except (TypeError, ValueError):
        return None


def _failure(message: str, status_code: int = 400):
    code = {
        400: ResponseCode.BAD_REQUEST,
        401: ResponseCode.UNAUTHORIZED,
        503: ResponseCode.INTERNAL_ERROR,
    }.get(status_code, ResponseCode.BAD_REQUEST)
    response = json_response(code, message, status_code=status_code)
    response.headers["Cache-Control"] = "no-store"
    return response


@router.post("/session")
def create_session(body: SessionRequest):
    """Exchange the existing OpenAgents login-handoff token for a session JWT."""
    if not workspace_session_enabled():
        return json_response(
            ResponseCode.INTERNAL_ERROR,
            "Workspace sessions are not enabled on this server",
            status_code=503,
        )
    claims = exchange_custom_token(body.custom_token)
    if not claims:
        return json_response(ResponseCode.UNAUTHORIZED, "Sign-in token was rejected. Please sign in again.")
    token, expires_at = mint_workspace_session(claims)
    return success_response(
        {
            "session_token": token,
            "expires_at": datetime.fromtimestamp(expires_at, tz=timezone.utc).isoformat(),
            "email": claims.get("email"),
            "display_name": claims.get("display_name"),
        }
    )


@router.get("/config")
def auth_config():
    """Expose only public browser-auth capabilities to the frontend."""
    mode = str(getattr(config, "AUTH_MODE", "workspace_token")).strip().lower()
    error = configuration_error() if mode == "oidc" else None
    return success_response(
        {
            "mode": mode,
            "oidc": {
                "enabled": mode == "oidc" and error is None,
                "providerName": str(getattr(config, "OIDC_PROVIDER_NAME", "Company SSO")),
                "loginPath": "/v1/auth/oidc/login",
                "sessionPath": "/v1/auth/oidc/session",
                "logoutPath": "/v1/auth/oidc/logout",
                "configurationError": error,
            },
        }
    )


@router.get("/oidc/login")
async def oidc_login(request: Request, return_to: str | None = Query(default=None)):
    """Start Authlib's OIDC Authorization Code Flow with PKCE."""
    error = configuration_error()
    if error:
        return _failure(error, 503)
    target = _safe_return_to(return_to)
    if not target:
        return _failure("The sign-in return URL is not allowed")
    try:
        return await start_login(request, target)
    except Exception:
        logger.warning("OIDC login could not start")
        return _failure("OIDC provider is unavailable", 503)


@router.get("/oidc/callback")
async def oidc_callback(request: Request):
    """Validate the Authlib state/nonce/code exchange and create a session."""
    try:
        principal = await complete_login(request)
    except Exception:
        logger.warning("OIDC callback rejected")
        return _failure("OIDC sign-in could not be completed", 401)
    target = _safe_return_to(request.session.pop("oidc_return_to", None))
    if not target:
        return _failure("The sign-in return URL is not allowed")
    try:
        session_token, expires_at = mint_workspace_session(principal)
    except RuntimeError:
        return _failure("OIDC browser sessions are not configured", 503)
    response = RedirectResponse(target, status_code=302)
    response.set_cookie(
        OIDC_SESSION_COOKIE,
        session_token,
        max_age=max(1, expires_at - int(datetime.now(tz=timezone.utc).timestamp())),
        httponly=True,
        secure=bool(getattr(config, "OIDC_COOKIE_SECURE", True)),
        samesite="lax",
        path="/",
    )
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


@router.get("/oidc/session")
def oidc_session(request: Request):
    """Return public metadata for the HttpOnly browser session."""
    token = request.cookies.get(OIDC_SESSION_COOKIE)
    claims = verify_workspace_session(token) if token else None
    if not claims or claims.get("identity_provider") != "oidc":
        return json_response(ResponseCode.UNAUTHORIZED, "No active OIDC session", status_code=401)
    try:
        decoded = jwt.decode(
            token,
            str(config.WORKSPACE_SESSION_SECRET),
            algorithms=["HS256"],
            issuer="openagents-workspace",
            options={"require": ["exp", "sub"]},
        )
    except Exception:
        return json_response(ResponseCode.UNAUTHORIZED, "OIDC session is invalid or expired", status_code=401)
    response = JSONResponse(
        content=success_response(
            {
                "expires_at": datetime.fromtimestamp(decoded["exp"], tz=timezone.utc).isoformat(),
                "email": claims.get("email"),
                "display_name": claims.get("display_name"),
                "provider": "oidc",
            }
        )
    )
    response.headers["Cache-Control"] = "no-store"
    return response


@router.post("/oidc/logout")
async def oidc_logout(request: Request):
    """Clear the local cookie and optionally start provider RP logout."""
    claims = verify_workspace_session(request.cookies.get(OIDC_SESSION_COOKIE, ""))
    logout_url = None
    if claims and claims.get("identity_provider") == "oidc" and oidc_enabled():
        try:
            logout_url = await provider_logout_redirect(request)
        except Exception:
            logout_url = None
    response = JSONResponse(content=success_response({"logoutUrl": logout_url}))
    response.delete_cookie(
        OIDC_SESSION_COOKIE,
        path="/",
        secure=bool(getattr(config, "OIDC_COOKIE_SECURE", True)),
        httponly=True,
        samesite="lax",
    )
    response.headers["Cache-Control"] = "no-store"
    return response
