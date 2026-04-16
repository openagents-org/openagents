# -*- coding: utf-8 -*-
"""
File storage endpoints — upload, list, download, delete shared files.

POST   /v1/files          Upload a file (multipart or base64 JSON)
GET    /v1/files           List files in a workspace
GET    /v1/files/{file_id} Download a file
DELETE /v1/files/{file_id} Soft-delete a file
"""

import asyncio
import base64
import logging
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, Header, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import config
from app.database import get_db
from app.models import FileRecord, Workspace
from app.response import ResponseCode, json_response, success_response
from app.routers.network import (
    _emit_event,
    _resolve_workspace,
    _verify_workspace_access,
)
from app.storage import get_file_store
from openagents.core.onm_events import Event

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["Files"])


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class Base64UploadRequest(BaseModel):
    """JSON upload request (for agents)."""
    filename: str
    content_base64: str
    content_type: Optional[str] = "application/octet-stream"
    channel_name: Optional[str] = None
    network: str
    source: Optional[str] = "human:user"


# ---------------------------------------------------------------------------
# POST /v1/files — upload (multipart or base64 JSON)
# ---------------------------------------------------------------------------

@router.post("/files")
async def upload_file(
    # Multipart fields
    file: Optional[UploadFile] = File(None),
    network: Optional[str] = Form(None),
    channel_name: Optional[str] = Form(None),
    source: Optional[str] = Form(None),
    # Auth headers
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """
    Upload a file to the workspace shared storage.

    Accepts multipart/form-data (UI uploads) or JSON body (agent uploads).
    """
    # Determine if this is multipart or we need to parse JSON from body
    if file and file.filename and network:
        # Multipart upload
        data = await file.read()
        filename = file.filename
        content_type = file.content_type or "application/octet-stream"
        uploaded_by = source or "human:user"
        network_id = network
    else:
        return json_response(ResponseCode.BAD_REQUEST, "Missing required fields: file and network")

    # Validate size
    if len(data) > config.MAX_FILE_SIZE:
        return json_response(
            ResponseCode.BAD_REQUEST,
            f"File too large. Maximum size: {config.MAX_FILE_SIZE // (1024*1024)}MB",
        )

    # Resolve workspace
    workspace = _resolve_workspace(db, network_id)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")

    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    # Save to storage backend
    file_id = str(uuid.uuid4())
    store = get_file_store()
    loop = asyncio.get_event_loop()
    try:
        storage_key = await loop.run_in_executor(
            None, store.save, str(workspace.id), file_id, filename, data,
        )
    except ValueError as exc:
        return json_response(ResponseCode.BAD_REQUEST, str(exc))

    # Insert DB record
    record = FileRecord(
        id=file_id,
        workspace_id=str(workspace.id),
        filename=filename,
        content_type=content_type,
        size=len(data),
        storage_key=storage_key,
        uploaded_by=uploaded_by,
        channel_name=channel_name,
    )
    db.add(record)

    # Emit event
    event = Event(
        type="workspace.file.uploaded",
        source=uploaded_by,
        target=f"channel/{channel_name}" if channel_name else "core",
        payload={
            "file_id": file_id,
            "filename": filename,
            "content_type": content_type,
            "size": len(data),
        },
    )
    await _emit_event(event, workspace, db, token=x_workspace_token or workspace.password_hash)

    return success_response({
        "id": file_id,
        "filename": filename,
        "content_type": content_type,
        "size": len(data),
        "uploaded_by": uploaded_by,
        "created_at": record.created_at.isoformat() if record.created_at else None,
    })


# ---------------------------------------------------------------------------
# POST /v1/files/base64 — JSON base64 upload (for agents)
# ---------------------------------------------------------------------------

@router.post("/files/base64")
async def upload_file_base64(
    body: Base64UploadRequest,
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """Upload a file via JSON with base64-encoded content (for agent uploads)."""
    try:
        data = base64.b64decode(body.content_base64)
    except Exception:
        return json_response(ResponseCode.BAD_REQUEST, "Invalid base64 content")

    if len(data) > config.MAX_FILE_SIZE:
        return json_response(
            ResponseCode.BAD_REQUEST,
            f"File too large. Maximum size: {config.MAX_FILE_SIZE // (1024*1024)}MB",
        )

    workspace = _resolve_workspace(db, body.network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")

    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    file_id = str(uuid.uuid4())
    store = get_file_store()
    loop = asyncio.get_event_loop()
    try:
        storage_key = await loop.run_in_executor(
            None, store.save, str(workspace.id), file_id, body.filename, data,
        )
    except ValueError as exc:
        return json_response(ResponseCode.BAD_REQUEST, str(exc))

    record = FileRecord(
        id=file_id,
        workspace_id=str(workspace.id),
        filename=body.filename,
        content_type=body.content_type,
        size=len(data),
        storage_key=storage_key,
        uploaded_by=body.source or "human:user",
        channel_name=body.channel_name,
    )
    db.add(record)

    event = Event(
        type="workspace.file.uploaded",
        source=body.source or "human:user",
        target=f"channel/{body.channel_name}" if body.channel_name else "core",
        payload={
            "file_id": file_id,
            "filename": body.filename,
            "content_type": body.content_type,
            "size": len(data),
        },
    )
    await _emit_event(event, workspace, db, token=x_workspace_token or workspace.password_hash)

    return success_response({
        "id": file_id,
        "filename": body.filename,
        "content_type": body.content_type,
        "size": len(data),
        "uploaded_by": body.source or "human:user",
        "created_at": record.created_at.isoformat() if record.created_at else None,
    })


# ---------------------------------------------------------------------------
# GET /v1/files — list files
# ---------------------------------------------------------------------------

@router.get("/files")
async def list_files(
    network: str = Query(..., description="Network (workspace) ID or slug"),
    status: str = Query("active", description="Filter by status"),
    channel_name: Optional[str] = Query(None, description="Filter by channel name"),
    uploaded_by: Optional[str] = Query(None, description="Filter by uploader (e.g. openagents:agent-name)"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """List files in a workspace."""
    workspace = _resolve_workspace(db, network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")

    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    query = (
        select(FileRecord)
        .where(FileRecord.workspace_id == str(workspace.id))
        .where(FileRecord.status == status)
    )
    if channel_name:
        query = query.where(FileRecord.channel_name == channel_name)
    if uploaded_by:
        query = query.where(FileRecord.uploaded_by == uploaded_by)
    query = query.order_by(FileRecord.created_at.desc()).offset(offset).limit(limit)
    rows = db.execute(query).scalars().all()

    total = db.execute(
        select(func.count())
        .select_from(FileRecord)
        .where(FileRecord.workspace_id == str(workspace.id))
        .where(FileRecord.status == status)
    ).scalar()

    return success_response({
        "files": [
            {
                "id": f.id,
                "filename": f.filename,
                "content_type": f.content_type,
                "size": f.size,
                "uploaded_by": f.uploaded_by,
                "channel_name": f.channel_name,
                "status": f.status,
                "created_at": f.created_at.isoformat() if f.created_at else None,
            }
            for f in rows
        ],
        "total": total,
    })


# ---------------------------------------------------------------------------
# GET /v1/files/{file_id}/info — file metadata (no download)
# ---------------------------------------------------------------------------

@router.get("/files/{file_id}/info")
async def file_info(
    file_id: str,
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """Get file metadata without downloading content."""
    record = db.execute(
        select(FileRecord).where(FileRecord.id == file_id)
    ).scalar_one_or_none()

    if not record or record.status != "active":
        return json_response(ResponseCode.NOT_FOUND, "File not found")

    workspace = _resolve_workspace(db, str(record.workspace_id))
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")

    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    return success_response({
        "id": record.id,
        "filename": record.filename,
        "content_type": record.content_type,
        "size": record.size,
        "uploaded_by": record.uploaded_by,
        "channel_name": record.channel_name,
        "created_at": record.created_at.isoformat() if record.created_at else None,
    })


# ---------------------------------------------------------------------------
# GET /v1/files/{file_id} — download
# ---------------------------------------------------------------------------

@router.get("/files/{file_id}")
async def download_file(
    file_id: str,
    token: Optional[str] = Query(None),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """Download a file by ID."""
    record = db.execute(
        select(FileRecord).where(FileRecord.id == file_id)
    ).scalar_one_or_none()

    if not record or record.status != "active":
        return json_response(ResponseCode.NOT_FOUND, "File not found")

    workspace = _resolve_workspace(db, str(record.workspace_id))
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")

    effective_token = x_workspace_token or token
    if not _verify_workspace_access(workspace, effective_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    store = get_file_store()
    loop = asyncio.get_event_loop()
    try:
        data = await loop.run_in_executor(None, store.read, record.storage_key)
    except FileNotFoundError:
        return json_response(ResponseCode.NOT_FOUND, "File data not found in storage")

    # Use inline disposition for images and HTML so browsers can render them
    ct = record.content_type or ""
    disposition = "inline" if ct.startswith("image/") or ct == "text/html" else "attachment"

    return Response(
        content=data,
        media_type=record.content_type,
        headers={
            "Content-Disposition": f'{disposition}; filename="{record.filename}"',
            "Content-Length": str(len(data)),
        },
    )


# ---------------------------------------------------------------------------
# DELETE /v1/files/{file_id} — soft delete
# ---------------------------------------------------------------------------

@router.delete("/files/{file_id}")
async def delete_file(
    file_id: str,
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """Soft-delete a file."""
    record = db.execute(
        select(FileRecord).where(FileRecord.id == file_id)
    ).scalar_one_or_none()

    if not record or record.status != "active":
        return json_response(ResponseCode.NOT_FOUND, "File not found")

    workspace = _resolve_workspace(db, str(record.workspace_id))
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")

    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    record.status = "deleted"

    event = Event(
        type="workspace.file.deleted",
        source="human:user",
        target="core",
        payload={
            "file_id": file_id,
            "filename": record.filename,
        },
    )
    await _emit_event(event, workspace, db, token=x_workspace_token or workspace.password_hash)

    return success_response({"id": file_id, "status": "deleted"})
