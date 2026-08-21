# -*- coding: utf-8 -*-
"""API credits campaign endpoints (see app/services/campaign.py).

GET /v1/campaign/status — the signed-in user's milestone checklist, API key
and gateway usage. First call lazily provisions the gateway key, which is the
signup milestone. Returns {"enabled": false} when the campaign is off
(self-hosted default) so the frontend hides the UI entirely.
"""

from typing import Optional

from fastapi import APIRouter, Depends, Header
from sqlalchemy.orm import Session

from app.access import resolve_current_user
from app.database import get_db
from app.response import ResponseCode, json_response, success_response
from app.services import campaign

router = APIRouter(prefix="/v1/campaign", tags=["campaign"])


@router.get("/status")
def campaign_status(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    if not campaign.enabled():
        return success_response({"enabled": False})
    user = resolve_current_user(db, authorization)
    if not user:
        return json_response(ResponseCode.UNAUTHORIZED, "Sign-in required")
    db.commit()  # persist any user upsert from resolve_current_user
    return success_response(campaign.status_payload(db, user))
