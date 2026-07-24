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
import re
import uuid
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import quote, urlparse

import httpx

from fastapi import APIRouter, Depends, File, Form, Header, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import config
from app.database import get_db
from app.net_security import UnsafeURLError, safe_fetch
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

# Content types safe to render inline in the workspace origin. Raster images
# only — NOT image/svg+xml (scriptable) and NOT text/html.
INLINE_SAFE_CONTENT_TYPES = {
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/bmp",
    "image/x-icon",
}


def _organize_filename(filename: str, content_type: str) -> str:
    """Put uploaded files into uploaded_files/ with a timestamped name."""
    # Already in a folder — don't reorganize
    if "/" in filename:
        return filename

    now = datetime.now(timezone.utc)
    timestamp = now.strftime("%Y%m%d_%H%M%S")

    # Extract extension from original filename
    dot_idx = filename.rfind(".")
    if dot_idx > 0:
        name_part = filename[:dot_idx]
        ext = filename[dot_idx:]
    else:
        name_part = filename
        ext = ""

    # Clean up the name part (keep it short, remove special chars)
    clean_name = re.sub(r"[^\w\-.]", "_", name_part)[:60]

    return f"uploaded_files/{timestamp}_{clean_name}{ext}"


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
    post_to_channel: bool = False       # also post a chat message with the file attached
    caption: Optional[str] = None       # message text when post_to_channel is set


class FromUrlUploadRequest(BaseModel):
    """Download a file from a URL into workspace storage (for agents).

    Lets agents persist an image found via /v1/search/images (or any direct
    file URL) and, with post_to_channel, share it in the chat as an inline
    attachment in one call.
    """
    url: str
    network: str
    filename: Optional[str] = None
    channel_name: Optional[str] = None
    source: Optional[str] = "human:user"
    post_to_channel: bool = False
    caption: Optional[str] = None


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
        content_type = file.content_type or "application/octet-stream"
        filename = _organize_filename(file.filename, content_type)
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

    # Save to storage backend (use basename for physical storage, full path for DB)
    file_id = str(uuid.uuid4())
    store = get_file_store()
    storage_name = filename.rsplit("/", 1)[-1] if "/" in filename else filename
    loop = asyncio.get_event_loop()
    try:
        storage_key = await loop.run_in_executor(
            None, store.save, str(workspace.id), file_id, storage_name, data,
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


async def _post_attachment_message(
    db: Session,
    workspace: Workspace,
    record: FileRecord,
    caption: Optional[str],
    token: Optional[str],
) -> bool:
    """Post a chat message carrying the file as an inline attachment.

    Same payload shape as the cloud image agents (services/cloud_agent.py),
    which the frontend already renders inline. Returns False when the file
    has no channel to post into.
    """
    if not record.channel_name:
        return False
    event = Event(
        type="workspace.message.posted",
        source=record.uploaded_by,
        target=f"channel/{record.channel_name}",
        payload={
            "content": caption or record.filename.rsplit("/", 1)[-1],
            "message_type": "chat",
            "attachments": [{
                "file_id": record.id,
                "filename": record.filename,
                "content_type": record.content_type,
                "size": record.size,
            }],
        },
    )
    await _emit_event(event, workspace, db, token=token or workspace.password_hash)
    return True


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

    organized_filename = _organize_filename(body.filename, body.content_type)

    file_id = str(uuid.uuid4())
    store = get_file_store()
    storage_name = organized_filename.rsplit("/", 1)[-1] if "/" in organized_filename else organized_filename
    loop = asyncio.get_event_loop()
    try:
        storage_key = await loop.run_in_executor(
            None, store.save, str(workspace.id), file_id, storage_name, data,
        )
    except ValueError as exc:
        return json_response(ResponseCode.BAD_REQUEST, str(exc))

    record = FileRecord(
        id=file_id,
        workspace_id=str(workspace.id),
        filename=organized_filename,
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
            "filename": organized_filename,
            "content_type": body.content_type,
            "size": len(data),
        },
    )
    await _emit_event(event, workspace, db, token=x_workspace_token or workspace.password_hash)

    posted = False
    if body.post_to_channel:
        posted = await _post_attachment_message(db, workspace, record, body.caption, x_workspace_token)

    return success_response({
        "id": file_id,
        "filename": organized_filename,
        "content_type": body.content_type,
        "size": len(data),
        "uploaded_by": body.source or "human:user",
        "created_at": record.created_at.isoformat() if record.created_at else None,
        "posted_to_channel": posted,
    })


# ---------------------------------------------------------------------------
# POST /v1/files/from_url — download a URL into workspace storage (for agents)
# ---------------------------------------------------------------------------

DOWNLOAD_TIMEOUT_SECONDS = 30.0
_DOWNLOAD_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0.0.0 Safari/537.36 OpenAgentsFetch/1.0"
)


@router.post("/files/from_url")
async def upload_file_from_url(
    body: FromUrlUploadRequest,
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """Download a file (typically an image search result) into workspace
    storage; with post_to_channel it is also shared in the chat as an
    inline attachment."""
    workspace = _resolve_workspace(db, body.network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    parsed = urlparse(body.url)

    # SSRF-safe streamed download: validates the URL (and every redirect hop)
    # against internal/metadata addresses and caps the body size while reading.
    try:
        result = await safe_fetch(
            body.url,
            max_bytes=config.MAX_FILE_SIZE,
            timeout=DOWNLOAD_TIMEOUT_SECONDS,
            headers={"User-Agent": _DOWNLOAD_UA},
            truncate=False,  # a file download must be complete, not truncated
        )
    except UnsafeURLError as e:
        code = e.code
        if code == "RESPONSE_TOO_LARGE":
            return json_response(
                ResponseCode.BAD_REQUEST,
                f"File too large. Maximum size: {config.MAX_FILE_SIZE // (1024*1024)}MB",
                data={"error_code": code},
            )
        return json_response(ResponseCode.BAD_REQUEST, str(e), data={"error_code": code})
    except httpx.HTTPError as e:
        return json_response(
            ResponseCode.BAD_REQUEST,
            f"Download failed: {e}",
            data={"error_code": "DOWNLOAD_FAILED"},
        )

    if result.status_code >= 400:
        return json_response(
            ResponseCode.BAD_REQUEST,
            f"Download failed with HTTP {result.status_code}",
            data={"error_code": "DOWNLOAD_FAILED", "status": result.status_code},
        )

    data = result.content
    content_type = result.content_type or "application/octet-stream"
    if content_type.startswith("text/html"):
        # An HTML response means the URL is a web page, not a file — saving
        # it as an "image" would just produce a broken attachment.
        return json_response(
            ResponseCode.BAD_REQUEST,
            "URL returned a web page, not a downloadable file",
            data={"error_code": "NOT_A_FILE", "hint": "Use the page's direct image/file URL."},
        )

    filename = body.filename or (parsed.path.rsplit("/", 1)[-1] or "download")
    organized_filename = _organize_filename(filename, content_type)

    file_id = str(uuid.uuid4())
    store = get_file_store()
    storage_name = organized_filename.rsplit("/", 1)[-1] if "/" in organized_filename else organized_filename
    loop = asyncio.get_event_loop()
    try:
        storage_key = await loop.run_in_executor(
            None, store.save, str(workspace.id), file_id, storage_name, data,
        )
    except ValueError as exc:
        return json_response(ResponseCode.BAD_REQUEST, str(exc))

    record = FileRecord(
        id=file_id,
        workspace_id=str(workspace.id),
        filename=organized_filename,
        content_type=content_type,
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
            "filename": organized_filename,
            "content_type": content_type,
            "size": len(data),
            "source_url": body.url,
        },
    )
    await _emit_event(event, workspace, db, token=x_workspace_token or workspace.password_hash)

    posted = False
    if body.post_to_channel:
        posted = await _post_attachment_message(db, workspace, record, body.caption, x_workspace_token)

    return success_response({
        "id": file_id,
        "filename": organized_filename,
        "content_type": content_type,
        "size": len(data),
        "uploaded_by": body.source or "human:user",
        "source_url": body.url,
        "posted_to_channel": posted,
    })


# ---------------------------------------------------------------------------
# GET /v1/files — list files
# ---------------------------------------------------------------------------

@router.get("/files")
def list_files(
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
def file_info(
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

    # Only render a narrow allowlist of raster image types inline. SVG (which
    # can carry <script>) and HTML are served as downloads, not inline, so a
    # stored file can't execute script in the workspace origin (stored XSS).
    # Combined with X-Content-Type-Options: nosniff below, this closes the
    # inline-SVG / MIME-sniff XSS vector for agent-ingested files.
    ct = (record.content_type or "").split(";")[0].strip().lower()
    disposition = "inline" if ct in INLINE_SAFE_CONTENT_TYPES else "attachment"

    # RFC 6266 / RFC 5987: HTTP headers are Latin-1 only, so non-ASCII
    # filenames (e.g. "多媒体文件.txt") have to go through the
    # filename*=UTF-8''<percent-encoded> form with an ASCII fallback.
    # Without this, Starlette raises during header encoding and the
    # whole response becomes a 500.
    filename = record.filename or "file"
    ascii_fallback = filename.encode("ascii", "replace").decode("ascii").replace("?", "_")
    # Quotes and backslashes break the quoted-string in filename="..."
    ascii_fallback = ascii_fallback.replace("\\", "_").replace('"', "_")
    encoded = quote(filename, safe="")
    disposition_header = (
        f'{disposition}; filename="{ascii_fallback}"; '
        f"filename*=UTF-8''{encoded}"
    )

    return Response(
        content=data,
        media_type=record.content_type,
        headers={
            "Content-Disposition": disposition_header,
            "Content-Length": str(len(data)),
            # Never let the browser MIME-sniff a download into an executable
            # type (e.g. sniff a "text/plain" file as HTML).
            "X-Content-Type-Options": "nosniff",
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
