# -*- coding: utf-8 -*-
"""Pilot User Program admin endpoints (internal console).

    GET  /v1/admin/pilot/eligibility?email=   — account, agents, active days, verdict
    POST /v1/admin/pilot/grant {email, actor} — apply the one-off pilot credits

Both require X-Admin-Secret == PILOT_ADMIN_SECRET. When the secret is unset
the endpoints refuse everything (self-hosted default). The grant amount is
fixed server-side; the endpoint re-checks eligibility unless force=true.
"""

import hmac
import time
from collections import deque
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import config
from app.database import get_db
from app.response import ResponseCode, json_response, success_response
from app.services import campaign, pilot

router = APIRouter(prefix="/v1/admin/pilot", tags=["pilot-admin"])

# Grants applied by this process in the last hour. The console proxy is the
# only expected caller, so a burst here means a leaked URL or a script —
# refuse further grants (429) rather than let it run.
_recent_grants: deque = deque()


def _grant_rate_ok() -> bool:
    now = time.monotonic()
    while _recent_grants and now - _recent_grants[0] > 3600:
        _recent_grants.popleft()
    return len(_recent_grants) < config.PILOT_MAX_GRANTS_PER_HOUR


def require_admin_secret(x_admin_secret: Optional[str] = Header(None, alias="X-Admin-Secret")) -> None:
    expected = config.PILOT_ADMIN_SECRET
    if not expected:
        raise HTTPException(status_code=404, detail="Pilot admin is not enabled on this deployment")
    if not x_admin_secret or not hmac.compare_digest(x_admin_secret, expected):
        raise HTTPException(status_code=401, detail="Invalid admin secret")


class GrantBody(BaseModel):
    email: str
    actor: Optional[str] = None
    force: bool = False


@router.get("/eligibility", dependencies=[Depends(require_admin_secret)])
def pilot_eligibility(email: str = Query(..., min_length=3), db: Session = Depends(get_db)):
    user = pilot.find_user(db, email)
    if not user:
        return success_response({"found": False, "email": email.strip().lower()})
    return success_response(pilot.eligibility(db, user))


@router.post("/grant", dependencies=[Depends(require_admin_secret)])
def pilot_grant(body: GrantBody, db: Session = Depends(get_db)):
    if not campaign.enabled():
        return json_response(ResponseCode.BAD_REQUEST, "Campaign/gateway is not enabled on this deployment")
    user = pilot.find_user(db, body.email)
    if not user:
        return json_response(ResponseCode.NOT_FOUND, "No account with that email")
    elig = pilot.eligibility(db, user)
    if elig["pilot"]["alreadyGranted"]:
        return success_response({**pilot.apply_grant(db, user), "eligibility": elig})
    if not elig["pilot"]["eligible"] and not body.force:
        return json_response(ResponseCode.BAD_REQUEST, "Not eligible: " + " ".join(elig["pilot"]["reasons"]),
                             data={"eligibility": elig})
    if not _grant_rate_ok():
        return json_response(ResponseCode.BAD_REQUEST, "Grant rate limit reached for this hour; try again later.", status_code=429)
    result = pilot.apply_grant(db, user, actor=(body.actor or "").strip()[:160])
    if result["status"] == "failed":
        return json_response(ResponseCode.BAD_REQUEST, "Gateway grant failed; nothing was recorded. Retry.", status_code=502)
    if result["status"] == "granted":
        _recent_grants.append(time.monotonic())
    return success_response({**result, "eligibility": pilot.eligibility(db, user)})
