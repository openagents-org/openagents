# -*- coding: utf-8 -*-
"""API credits campaign endpoints (see app/services/campaign.py).

GET /v1/campaign/status — the signed-in user's milestone checklist, API key
and gateway usage. First call lazily provisions the gateway key, which is the
signup milestone. Returns {"enabled": false} when the campaign is off
(self-hosted default) so the frontend hides the UI entirely.
"""

import time
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, Header
from sqlalchemy.orm import Session

from app.access import resolve_current_user
from app.config import config
from app.database import get_db
from app.response import ResponseCode, json_response, success_response
from app.services import campaign

router = APIRouter(prefix="/v1/campaign", tags=["campaign"])

# The gateway's model catalog changes rarely — cache it in-process so the
# "show all models" expander doesn't fan every click out to the gateway.
_models_cache: dict = {"at": 0.0, "ids": []}
_MODELS_TTL_S = 600


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


@router.get("/models")
def campaign_models(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """Model ids available on the campaign gateway (proxied — the gateway has
    no CORS, so the browser can't ask it directly)."""
    if not campaign.enabled():
        return success_response({"models": []})
    if not resolve_current_user(db, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Sign-in required")
    now = time.time()
    if now - _models_cache["at"] > _MODELS_TTL_S or not _models_cache["ids"]:
        try:
            r = httpx.get(f"{config.CAMPAIGN_GATEWAY_URL}/v1/models", timeout=10.0)
            r.raise_for_status()
            ids = sorted(
                m.get("id") for m in r.json().get("data", []) if m.get("id")
            )
            if ids:
                _models_cache["ids"] = ids
                _models_cache["at"] = now
        except Exception:  # noqa: BLE001 — serve the stale list if any
            pass
    return success_response({"models": _models_cache["ids"]})
