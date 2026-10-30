# -*- coding: utf-8 -*-
"""Mobile onboarding helpers.

POST /v1/workspaces/{workspace_id}/setup-email
    Email the signed-in caller a "finish on your computer" link to their own
    workspace. The mobile app can create a workspace but can't run agents on
    the phone — this hands the user a one-click path to the desktop flow
    (download the launcher, pair the machine).

Auth is the user's identity bearer (like the /v1/account routes); the caller
must be a member of the workspace. Rate-limited per workspace via a small
counter in `Workspace.settings` — no extra table for a 3/day cap.
"""

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.access import resolve_current_user
from app.config import config
from app.database import get_db
from app.models import WorkspaceMembership
from app.response import ResponseCode, json_response, success_response
from app.routers.network import _resolve_workspace
from app.services.email import email_configured, send_setup_email

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["Onboarding"])

# Max setup emails per workspace per (UTC) day. Tracked under
# workspace.settings["setup_email"] = {"date": "YYYY-MM-DD", "count": n}.
SETUP_EMAIL_MAX_PER_DAY = 3
SETUP_EMAIL_SETTINGS_KEY = "setup_email"


@router.post("/workspaces/{workspace_id}/setup-email")
def send_workspace_setup_email(
    workspace_id: str,
    db: Session = Depends(get_db),
    authorization: Optional[str] = Header(None),
):
    """Email the caller a link to open their workspace on a computer.

    `workspace_id` may be the workspace UUID or its slug. Responds
    `{"emailSent": false}` (not an error) when no email provider is
    configured, so self-hosted deployments degrade gracefully.
    """
    user = resolve_current_user(db, authorization)
    if not user:
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid identity token")

    workspace = _resolve_workspace(db, workspace_id)
    if workspace is None or workspace.status == "deleted":
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")

    membership = db.execute(
        select(WorkspaceMembership).where(
            WorkspaceMembership.workspace_id == workspace.id,
            WorkspaceMembership.user_id == user.id,
        )
    ).scalar_one_or_none()
    if membership is None:
        return json_response(ResponseCode.FORBIDDEN, "Not a member of this workspace")

    # ── Per-workspace daily cap, tracked inside the settings JSON ──
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    settings = dict(workspace.settings or {})
    counter = settings.get(SETUP_EMAIL_SETTINGS_KEY) or {}
    count = counter.get("count", 0) if counter.get("date") == today else 0
    if count >= SETUP_EMAIL_MAX_PER_DAY:
        # 429 isn't in ResponseCode; emit the standard envelope by hand.
        return JSONResponse(
            status_code=429,
            content={
                "code": 429,
                "message": "Daily limit reached for setup emails — try again tomorrow",
                "data": None,
            },
        )

    if not email_configured():
        return success_response({"emailSent": False})

    link = f"{config.FRONTEND_BASE_URL}/{workspace.slug}"
    sent = send_setup_email(user.email, workspace.name, link)

    # Reassign a fresh dict (and flag) so SQLAlchemy persists the JSON change.
    settings[SETUP_EMAIL_SETTINGS_KEY] = {"date": today, "count": count + 1}
    workspace.settings = settings
    flag_modified(workspace, "settings")
    db.commit()

    logger.info(
        "onboarding: setup email to %s for workspace %s (sent=%s, count=%s)",
        user.email, workspace.slug, sent, count + 1,
    )
    return success_response({"emailSent": sent})
