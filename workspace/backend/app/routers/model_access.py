# -*- coding: utf-8 -*-
"""
Model access — saved inference credentials for a workspace.

GET    /v1/model-access               List entries (keys masked)
POST   /v1/model-access               Save a provider + API key (+ base URL)
DELETE /v1/model-access/{id}          Remove an entry
POST   /v1/model-access/{id}/probe    List models / validate using the stored key

Entries are managed on the Model access settings page and referenced by id
from agent-config forms; the raw key stays server-side after creation (probes
and node-command enqueue resolve it here).
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, Header, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ModelAccess
from app.response import ResponseCode, json_response, success_response
from app.routers.network import _resolve_workspace, _verify_workspace_access

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["Model Access"])


def _mask(key: str) -> str:
    if len(key) <= 8:
        return "*" * len(key)
    return f"{key[:4]}…{key[-4:]}"


def _format(entry: ModelAccess) -> dict:
    return {
        "id": str(entry.id),
        "label": entry.label,
        "provider": entry.provider,
        "baseUrl": entry.base_url,
        "apiKeyMasked": _mask(entry.api_key),
        "createdBy": entry.created_by,
        "status": entry.status,
        "createdAt": entry.created_at.isoformat() if entry.created_at else None,
    }


def _get_workspace_or_error(db, network, x_workspace_token, authorization):
    workspace = _resolve_workspace(db, network)
    if not workspace:
        return None, json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return None, json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")
    return workspace, None


@router.get("/model-access")
def list_model_access(
    network: str = Query(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace, err = _get_workspace_or_error(db, network, x_workspace_token, authorization)
    if err:
        return err
    rows = db.execute(
        select(ModelAccess)
        .where(ModelAccess.workspace_id == str(workspace.id))
        .order_by(ModelAccess.created_at.desc())
    ).scalars().all()
    return success_response([_format(r) for r in rows])


class CreateModelAccessRequest(BaseModel):
    network: str
    provider: str
    api_key: str
    label: Optional[str] = None
    base_url: Optional[str] = None
    created_by: Optional[str] = None


@router.post("/model-access")
def create_model_access(
    body: CreateModelAccessRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    from app.services.cloud_providers import PROVIDERS

    workspace, err = _get_workspace_or_error(db, body.network, x_workspace_token, authorization)
    if err:
        return err

    provider = body.provider.strip()
    # Two credential-only kinds live outside the provider catalog: "custom"
    # (OpenAI-compatible URL) and "custom-anthropic" (Anthropic-compatible URL).
    custom_kinds = ("custom", "custom-anthropic")
    if provider not in custom_kinds and provider not in PROVIDERS:
        return json_response(ResponseCode.BAD_REQUEST, f"Unknown provider '{provider}'")
    if provider in custom_kinds and not (body.base_url or "").strip():
        return json_response(ResponseCode.BAD_REQUEST, "base_url is required for a custom provider")
    if not body.api_key.strip():
        return json_response(ResponseCode.BAD_REQUEST, "api_key is required")

    prov = PROVIDERS.get(provider)
    default_labels = {"custom": "Custom Endpoint", "custom-anthropic": "Custom (Anthropic)"}
    label = (body.label or "").strip() or (prov.label if prov else default_labels.get(provider, provider))
    entry = ModelAccess(
        workspace_id=str(workspace.id),
        label=label,
        provider=provider,
        base_url=(body.base_url or "").strip() or None,
        api_key=body.api_key.strip(),
        created_by=body.created_by,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return success_response(_format(entry))


@router.delete("/model-access/{access_id}")
def delete_model_access(
    access_id: str,
    network: str = Query(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace, err = _get_workspace_or_error(db, network, x_workspace_token, authorization)
    if err:
        return err
    entry = db.execute(
        select(ModelAccess).where(
            ModelAccess.id == access_id,
            ModelAccess.workspace_id == str(workspace.id),
        )
    ).scalar_one_or_none()
    if not entry:
        return json_response(ResponseCode.NOT_FOUND, "Model access not found")
    db.delete(entry)
    db.commit()
    return success_response({"deleted": True})


class ProbeModelAccessRequest(BaseModel):
    network: str
    model: Optional[str] = None   # None → list models; set → validate


@router.post("/model-access/{access_id}/probe")
async def probe_model_access(
    access_id: str,
    body: ProbeModelAccessRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Same semantics as /v1/model-probe, using the stored key — the browser
    only ever sends the entry id."""
    from app.services.model_probe import probe

    workspace, err = _get_workspace_or_error(db, body.network, x_workspace_token, authorization)
    if err:
        return err
    entry = db.execute(
        select(ModelAccess).where(
            ModelAccess.id == access_id,
            ModelAccess.workspace_id == str(workspace.id),
        )
    ).scalar_one_or_none()
    if not entry:
        return json_response(ResponseCode.NOT_FOUND, "Model access not found")
    return success_response(await probe(entry.provider, entry.api_key, entry.base_url, body.model))
