# -*- coding: utf-8 -*-
"""
Login-session endpoints for the workspace web app.

POST /v1/auth/session   Exchange an openagents.org login-handoff custom token
                        for a workspace-issued session JWT.

Background: openagents.org logs the user in (Google/GitHub/Apple or our own
email+password accounts), mints a one-time Firebase custom token and redirects
to workspace.openagents.org/auth/callback?ct=... . Normally the browser calls
Firebase's signInWithCustomToken there, which needs Google's Identity Toolkit
— unreachable from mainland China, so those users could register but never
get into the workspace. This endpoint performs the same exchange server-side
(Railway can reach Google), verifies the resulting ID token with the Admin SDK
exactly as a browser-obtained token would be, and returns a session JWT the
client presents as `Authorization: Bearer` from then on. The rest of the API
already accepts that bearer via verify_identity_claims().

The custom token is short-lived (≤1h, single Firebase project) and is only
ever obtained by an already-authenticated openagents.org session, so no extra
proof is required here — the same token would be honoured by Firebase itself.
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.firebase_auth import (
    exchange_custom_token,
    mint_workspace_session,
    workspace_session_enabled,
)
from app.response import ResponseCode, json_response, success_response

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/auth", tags=["Auth"])


class SessionRequest(BaseModel):
    custom_token: str = Field(..., min_length=1, max_length=4096)


@router.post("/session")
def create_session(body: SessionRequest):
    """Exchange a login-handoff custom token for a workspace session.

    Responses:
      200 {session_token, expires_at, email, display_name}
      401 the custom token was rejected (expired, wrong project, tampered)
      503 WORKSPACE_SESSION_SECRET is not configured on this deployment
    """
    if not workspace_session_enabled():
        return json_response(
            ResponseCode.INTERNAL_ERROR,
            "Workspace sessions are not enabled on this server",
            status_code=503,
        )

    claims = exchange_custom_token(body.custom_token)
    if not claims:
        return json_response(
            ResponseCode.UNAUTHORIZED,
            "Sign-in token was rejected. Please sign in again.",
        )

    token, exp = mint_workspace_session(claims)
    logger.info("auth: issued workspace session for %s", claims["email"])
    return success_response({
        "session_token": token,
        "expires_at": datetime.fromtimestamp(exp, tz=timezone.utc).isoformat(),
        "email": claims["email"],
        "display_name": claims.get("display_name"),
    })
