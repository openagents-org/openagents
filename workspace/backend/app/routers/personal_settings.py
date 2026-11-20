# -*- coding: utf-8 -*-
"""
Personal settings — a signed-in person's own settings in a workspace, the
same on every device they use (web, desktop app, phone).

GET /v1/personal-settings/{key}?network=   {value, updated_at} (value null when unset)
PUT /v1/personal-settings/{key}            {network, value}

Only known keys are accepted:
  thread_projects   {projects: [{id, name, color}], assignments: {thread: project_id}}

A bare workspace token or an agent has no person to keep settings for: reads
come back empty and writes are refused.
"""

import json
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Body, Depends, Header, Path, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import PersonalSetting
from app.response import ResponseCode, json_response, success_response
from app.routers.network import _resolve_workspace, _verify_workspace_access
from app.services.read_state import person_email

# Synchronous SQLAlchemy sessions: keep handlers as `def` (threadpool).
router = APIRouter(prefix="/v1", tags=["Personal settings"])

KEYS = {"thread_projects"}
MAX_BYTES = 256 * 1024


def _authorize(db, network, x_workspace_token, authorization):
    workspace = _resolve_workspace(db, network)
    if not workspace:
        return None, None, json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return None, None, json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")
    from app.services.visibility import resolve_viewer
    viewer = resolve_viewer(db, workspace, x_workspace_token, authorization)
    return workspace, (person_email(viewer) if viewer.kind == "human" else None), None


def _valid_thread_projects(value: Any) -> bool:
    if not isinstance(value, dict) or not isinstance(value.get("projects"), list) or not isinstance(value.get("assignments", {}), dict):
        return False
    for p in value["projects"]:
        if not (isinstance(p, dict) and isinstance(p.get("id"), str) and isinstance(p.get("name"), str)
                and isinstance(p.get("color"), int) and not isinstance(p.get("color"), bool)):
            return False
    return all(isinstance(k, str) and isinstance(v, str) for k, v in value.get("assignments", {}).items())


def _serialize(row: Optional[PersonalSetting]) -> dict:
    return {"value": row.value if row else None,
            "updated_at": row.updated_at.isoformat() if row and row.updated_at else None}


@router.get("/personal-settings/{key}")
def get_personal_setting(
    key: str = Path(...),
    network: str = Query(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    if key not in KEYS:
        return json_response(ResponseCode.NOT_FOUND, "Unknown setting")
    workspace, email, error = _authorize(db, network, x_workspace_token, authorization)
    if error is not None:
        return error
    row = db.get(PersonalSetting, (str(workspace.id), email, key)) if email else None
    return success_response({**_serialize(row), "persisted": bool(email)})


@router.put("/personal-settings/{key}")
def put_personal_setting(
    key: str = Path(...),
    network: str = Body(...),
    value: Any = Body(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    if key not in KEYS:
        return json_response(ResponseCode.NOT_FOUND, "Unknown setting")
    workspace, email, error = _authorize(db, network, x_workspace_token, authorization)
    if error is not None:
        return error
    if not email:
        return json_response(ResponseCode.FORBIDDEN, "Sign in to save personal settings")
    if len(json.dumps(value)) > MAX_BYTES:
        return json_response(ResponseCode.BAD_REQUEST, "Setting is too large")
    if key == "thread_projects" and not _valid_thread_projects(value):
        return json_response(ResponseCode.BAD_REQUEST, "Invalid thread projects")
    row = db.get(PersonalSetting, (str(workspace.id), email, key))
    if row is None:
        row = PersonalSetting(workspace_id=str(workspace.id), user_email=email, key=key, value=value)
        db.add(row)
    else:
        row.value = value
        row.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return success_response({**_serialize(row), "persisted": True})
