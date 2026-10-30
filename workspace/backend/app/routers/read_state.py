# -*- coding: utf-8 -*-
"""
Read state — a signed-in person's read markers, shared by all their devices.

GET  /v1/read-state    The caller's markers ({session_id: read_at_ms})
POST /v1/read-state    Move markers forward; other devices see the change
                       through discovery / DM listing and the event stream
                       (`workspace.read_state.updated`)
"""

from typing import Any, Optional

from fastapi import APIRouter, Body, Depends, Header, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.response import ResponseCode, json_response, success_response
from app.routers.network import _resolve_workspace, _verify_workspace_access
from app.services import read_state

# Synchronous SQLAlchemy sessions: keep handlers as `def` (threadpool).
router = APIRouter(prefix="/v1", tags=["Read state"])


def _authorize(db, network, x_workspace_token, authorization):
    workspace = _resolve_workspace(db, network)
    if not workspace:
        return None, None, json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return None, None, json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")
    from app.services.visibility import resolve_viewer
    return workspace, resolve_viewer(db, workspace, x_workspace_token, authorization), None


@router.get("/read-state")
def get_read_state(
    network: str = Query(...),
    since: Optional[int] = Query(None, ge=0, description="Only markers changed after this server time (ms)"),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace, viewer, error = _authorize(db, network, x_workspace_token, authorization)
    if error is not None:
        return error
    email = read_state.person_email(viewer)
    markers = read_state.stored_markers(db, workspace.id, email, since=since) if email else {}
    if email:
        from app.services.visibility import hidden_channel_names
        hidden = hidden_channel_names(db, str(workspace.id), viewer)
        markers = {k: v for k, v in markers.items() if k not in hidden}
    return success_response({"markers": markers, "server_time": read_state.now_ms(), "persisted": bool(email)})


@router.post("/read-state")
def update_read_state(
    network: str = Body(...),
    markers: Any = Body(..., description="{session_id: read_at_ms, or null for server now}"),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace, viewer, error = _authorize(db, network, x_workspace_token, authorization)
    if error is not None:
        return error
    try:
        updates = read_state.parse_marker_updates(markers)
    except ValueError as e:
        return json_response(ResponseCode.BAD_REQUEST, str(e))
    email = read_state.person_email(viewer)
    if not email:
        # Token-only callers have no person to remember the read for; their
        # local markers keep working exactly as before.
        return success_response({"markers": {}, "updated": [], "persisted": False})
    from app.services.visibility import hidden_channel_names
    hidden = hidden_channel_names(db, str(workspace.id), viewer)
    updates = {k: v for k, v in updates.items() if k not in hidden}
    if not updates:
        return success_response({"markers": {}, "updated": [], "persisted": True})
    effective, changed = read_state.advance_markers(db, workspace.id, email, updates)
    read_state.publish_changes(workspace.id, email, changed)
    return success_response({"markers": effective, "updated": sorted(changed), "persisted": True})
