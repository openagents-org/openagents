# -*- coding: utf-8 -*-
"""
File storage endpoints — upload, list, download, delete shared files.

POST   /v1/files                 Upload a file (multipart or base64 JSON)
POST   /v1/files/upload           Upload into a folder, keeping the filename
GET    /v1/files                  List files in a workspace
GET    /v1/files/browse           Browse one folder: subfolders, files, counts
GET    /v1/files/{file_id}        Download a file
DELETE /v1/files/{file_id}        Soft-delete a file
POST   /v1/files/trash            Move files/folders to the trash
GET    /v1/files/trash            List the trash
POST   /v1/files/trash/restore    Restore trash entries
POST   /v1/files/trash/purge      Delete trash entries permanently
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
from app.file_types import FILTER_GROUPS, KIND_GROUPS, kind_for
from app.net_security import OUTBOUND_USER_AGENT, UnsafeURLError, safe_fetch
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


class FolderCreateRequest(BaseModel):
    """Create an (empty) folder."""
    network: str
    path: str
    source: Optional[str] = "human:user"


class FolderRenameRequest(BaseModel):
    """Rename or move a folder and everything under it."""
    network: str
    path: str
    new_path: str
    source: Optional[str] = "human:user"


# ---------------------------------------------------------------------------
# Folders
#
# Folders are purely logical: there is no folder table, only the path prefix in
# `FileRecord.filename`. An empty folder is kept alive by a zero-byte `.keep`
# record, the same convention the UI used to write by hand.
# ---------------------------------------------------------------------------

KEEP_FILE = ".keep"


def _basename(path: str) -> str:
    return path.rsplit("/", 1)[-1]


def _dirname(path: str) -> str:
    """The folder a path lives in — '' for a file at the root."""
    return path.rsplit("/", 1)[0] if "/" in path else ""


def _normalize_folder_path(path: str) -> Optional[str]:
    """Strip stray slashes and reject anything that could escape the workspace."""
    cleaned = (path or "").strip().strip("/")
    if not cleaned:
        return None
    segments = cleaned.split("/")
    for segment in segments:
        if not segment or segment in (".", "..") or "\\" in segment:
            return None
    return "/".join(segments)


def _folder_records(db: Session, workspace_id: str, path: str) -> list[FileRecord]:
    """Every active record inside `path` (at any depth)."""
    return list(
        db.execute(
            select(FileRecord)
            .where(FileRecord.workspace_id == workspace_id)
            .where(FileRecord.status == "active")
            # autoescape: `startswith` compiles to LIKE, where `_` matches any
            # single character — and "uploaded_files/" is a real folder here.
            .where(FileRecord.filename.startswith(f"{path}/", autoescape=True))
        ).scalars().all()
    )


@router.post("/files/folders")
async def create_folder(
    request: FolderCreateRequest,
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """Create an empty folder, materialised as a zero-byte `.keep` record."""
    path = _normalize_folder_path(request.path)
    if not path:
        return json_response(ResponseCode.BAD_REQUEST, "Invalid folder path")

    workspace = _resolve_workspace(db, request.network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")

    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    if _folder_records(db, str(workspace.id), path):
        return json_response(ResponseCode.BAD_REQUEST, f'Folder "{path}" already exists')

    file_id = str(uuid.uuid4())
    store = get_file_store()
    loop = asyncio.get_event_loop()
    try:
        storage_key = await loop.run_in_executor(
            None, store.save, str(workspace.id), file_id, KEEP_FILE, b"",
        )
    except ValueError as exc:
        return json_response(ResponseCode.BAD_REQUEST, str(exc))

    db.add(FileRecord(
        id=file_id,
        workspace_id=str(workspace.id),
        filename=f"{path}/{KEEP_FILE}",
        content_type="text/plain",
        size=0,
        storage_key=storage_key,
        uploaded_by=request.source or "human:user",
    ))

    # Commit the mutation before emitting: _emit_event only commits on the
    # success path and rolls back on EventRejected, which would silently drop
    # this write while still returning 200. Matches the trash routes.
    db.commit()

    await _emit_event(
        Event(
            type="workspace.folder.created",
            source=request.source or "human:user",
            target="core",
            payload={"path": path},
        ),
        workspace,
        db,
        token=x_workspace_token or workspace.password_hash,
    )

    return success_response({"path": path})


@router.patch("/files/folders")
async def rename_folder(
    request: FolderRenameRequest,
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """Rename or move a folder by rewriting the path prefix of its contents."""
    path = _normalize_folder_path(request.path)
    new_path = _normalize_folder_path(request.new_path)
    if not path or not new_path:
        return json_response(ResponseCode.BAD_REQUEST, "Invalid folder path")
    if path == new_path:
        return success_response({"path": new_path, "updated": 0})
    # Moving a folder inside itself would orphan every record under it
    if new_path.startswith(f"{path}/"):
        return json_response(ResponseCode.BAD_REQUEST, "Cannot move a folder into itself")

    workspace = _resolve_workspace(db, request.network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")

    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    records = _folder_records(db, str(workspace.id), path)
    if not records:
        return json_response(ResponseCode.NOT_FOUND, f'Folder "{path}" not found')

    if _folder_records(db, str(workspace.id), new_path):
        return json_response(ResponseCode.BAD_REQUEST, f'Folder "{new_path}" already exists')

    for record in records:
        record.filename = f"{new_path}/{record.filename[len(path) + 1:]}"

    # Commit before emitting (see create_folder) so an EventRejected can't
    # silently discard the prefix rewrite while returning 200.
    db.commit()

    await _emit_event(
        Event(
            type="workspace.folder.renamed",
            source=request.source or "human:user",
            target="core",
            payload={"path": path, "new_path": new_path, "count": len(records)},
        ),
        workspace,
        db,
        token=x_workspace_token or workspace.password_hash,
    )

    return success_response({"path": new_path, "updated": len(records)})


@router.delete("/files/folders")
async def delete_folder(
    network: str = Query(..., description="Network (workspace) ID or slug"),
    path: str = Query(..., description="Folder path to delete"),
    source: Optional[str] = Query("human:user"),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """Soft-delete a folder and everything inside it."""
    folder = _normalize_folder_path(path)
    if not folder:
        return json_response(ResponseCode.BAD_REQUEST, "Invalid folder path")

    workspace = _resolve_workspace(db, network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")

    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    records = _folder_records(db, str(workspace.id), folder)
    if not records:
        return json_response(ResponseCode.NOT_FOUND, f'Folder "{folder}" not found')

    for record in records:
        record.status = "deleted"

    # Commit before emitting (see create_folder) so an EventRejected can't
    # silently discard the soft-delete while returning 200.
    db.commit()

    await _emit_event(
        Event(
            type="workspace.folder.deleted",
            source=source or "human:user",
            target="core",
            payload={"path": folder, "count": len(records)},
        ),
        workspace,
        db,
        token=x_workspace_token or workspace.password_hash,
    )

    return success_response({"path": folder, "deleted": len(records)})


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
# Shared with /v1/fetch — see OUTBOUND_USER_AGENT for why the two must match.
_DOWNLOAD_UA = OUTBOUND_USER_AGENT


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
# POST /v1/files/upload — upload into a folder, keeping the name
#
# `POST /files` was written for agents dropping a file into the workspace: a
# bare name is rewritten to uploaded_files/<timestamp>_<name> so nothing ever
# collides and everything lands in one bucket. A file browser needs the
# opposite — the file goes where the user is standing, under the name they
# recognise — so this is a separate endpoint rather than a flag on that one,
# and the old behaviour stays exactly as agents rely on it.
# ---------------------------------------------------------------------------

CONFLICT_MODES = ("rename", "replace", "error")


def _sanitize_upload_name(raw: str) -> Optional[str]:
    """
    A safe leaf name, or None if there isn't one.

    Browsers send bare names, but a client can send anything — the folder comes
    from `path`, so any directory part here is dropped rather than trusted.
    """
    name = (raw or "").replace("\\", "/").rsplit("/", 1)[-1]
    name = "".join(ch for ch in name if ch.isprintable()).strip()
    if not name or name in (".", "..") or name == KEEP_FILE:
        return None
    return name


def _next_free_name(taken: set[str], folder: str, name: str) -> str:
    """`report.pdf` → `report (2).pdf` → `report (3).pdf`, the way Finder does."""
    def full(leaf: str) -> str:
        return f"{folder}/{leaf}" if folder else leaf

    if full(name) not in taken:
        return full(name)

    stem, dot, ext = name.rpartition(".")
    if not stem:
        # A dotfile like ".env" has no stem — suffix the whole name instead of
        # producing " (2).env".
        stem, dot, ext = name, "", ""
    suffix = f".{ext}" if dot else ""

    counter = 2
    while True:
        candidate = full(f"{stem} ({counter}){suffix}")
        if candidate not in taken:
            return candidate
        counter += 1


@router.post("/files/upload")
async def upload_files_to_folder(
    files: list[UploadFile] = File(..., description="One or more files"),
    network: str = Form(...),
    path: str = Form("", description="Destination folder; empty is the root"),
    source: Optional[str] = Form(None),
    channel_name: Optional[str] = Form(None),
    on_conflict: str = Form("rename", description="rename | replace | error"),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """
    Upload one or more files into a folder, under their own names.

    Every file is handled on its own: one that's too large or badly named is
    reported in `skipped` while the rest still land, because failing a whole
    drag-and-drop over one bad file in it is worse than a partial result the
    client can show.

    `on_conflict` decides what an existing name means — `rename` picks the next
    free "(2)" name, `replace` soft-deletes the old record, `error` skips the
    file and says so.
    """
    if on_conflict not in CONFLICT_MODES:
        return json_response(
            ResponseCode.BAD_REQUEST, f"on_conflict must be one of: {', '.join(CONFLICT_MODES)}"
        )

    folder = _normalize_folder_path(path) if path else None
    if path and folder is None:
        return json_response(ResponseCode.BAD_REQUEST, "Invalid path")

    workspace = _resolve_workspace(db, network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")

    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    if not files:
        return json_response(ResponseCode.BAD_REQUEST, "No files in the request")

    uploaded_by = source or "human:user"
    store = get_file_store()
    loop = asyncio.get_event_loop()

    # Names already in use, plus the ones this request hands out — two files
    # named report.pdf in one drop must not both become report.pdf.
    taken = set(db.execute(
        select(FileRecord.filename)
        .where(FileRecord.workspace_id == str(workspace.id))
        .where(FileRecord.status == "active")
    ).scalars().all())

    uploaded: list[dict] = []
    skipped: list[dict] = []
    pending_events: list[Event] = []

    for upload in files:
        name = _sanitize_upload_name(upload.filename or "")
        if not name:
            skipped.append({"filename": upload.filename, "reason": "invalid_name"})
            continue

        data = await upload.read()
        if len(data) > config.MAX_FILE_SIZE:
            skipped.append({
                "filename": name,
                "reason": "too_large",
                "detail": f"Maximum size: {config.MAX_FILE_SIZE // (1024 * 1024)}MB",
            })
            continue

        target = f"{folder}/{name}" if folder else name
        replaced = False

        if target in taken:
            if on_conflict == "error":
                skipped.append({"filename": name, "reason": "exists"})
                continue
            if on_conflict == "rename":
                target = _next_free_name(taken, folder or "", name)
            else:
                for old in db.execute(
                    select(FileRecord)
                    .where(FileRecord.workspace_id == str(workspace.id))
                    .where(FileRecord.filename == target)
                    .where(FileRecord.status == "active")
                ).scalars().all():
                    old.status = "deleted"
                replaced = True

        content_type = upload.content_type or "application/octet-stream"
        file_id = str(uuid.uuid4())
        try:
            storage_key = await loop.run_in_executor(
                None, store.save, str(workspace.id), file_id, _basename(target), data,
            )
        except ValueError as exc:
            skipped.append({"filename": name, "reason": "storage_error", "detail": str(exc)})
            continue

        record = FileRecord(
            id=file_id,
            workspace_id=str(workspace.id),
            filename=target,
            content_type=content_type,
            size=len(data),
            storage_key=storage_key,
            uploaded_by=uploaded_by,
            channel_name=channel_name,
        )
        db.add(record)
        db.flush()
        taken.add(target)

        # Same event as POST /files — existing listeners shouldn't have to
        # learn about a second upload route. They're emitted after the commit
        # below: a rejected event must not cost the user their upload.
        pending_events.append(Event(
            type="workspace.file.uploaded",
            source=uploaded_by,
            target=f"channel/{channel_name}" if channel_name else "core",
            payload={
                "file_id": file_id,
                "filename": target,
                "content_type": content_type,
                "size": len(data),
            },
        ))

        kind = kind_for(target, content_type)
        payload = _file_payload(record, _basename(target), kind, KIND_GROUPS[kind])
        payload["replaced"] = replaced
        payload["renamed_from"] = name if _basename(target) != name else None
        uploaded.append(payload)

    db.commit()

    for event in pending_events:
        await _emit_event(event, workspace, db, token=x_workspace_token or workspace.password_hash)

    return success_response({
        "path": folder or "",
        "files": uploaded,
        "skipped": skipped,
        "uploaded_count": len(uploaded),
        "skipped_count": len(skipped),
    })


# ---------------------------------------------------------------------------
# Trash
#
# Deleting has always been soft — status flips to "deleted" and the bytes stay
# — but nothing recorded *when*, or that ten records went away as one folder,
# so a deleted thing could be neither shown nor brought back. These endpoints
# add that layer without touching the existing DELETE routes:
#
#   POST /files/trash          move files/folders to the trash
#   GET  /files/trash          list what's in it
#   POST /files/trash/restore  put entries back
#   POST /files/trash/purge    delete entries for real, bytes included
#
# Purging is the only thing here that destroys anything.
#
# Records deleted by the older DELETE routes have no trash metadata; the
# listing treats each as its own single-file entry, so nothing is stranded.
#
# All of these must be declared before /files/{file_id}.
# ---------------------------------------------------------------------------

class TrashRequest(BaseModel):
    """Move files and/or folders to the trash."""
    network: str
    file_ids: Optional[list[str]] = None
    paths: Optional[list[str]] = None
    source: Optional[str] = "human:user"


class TrashActionRequest(BaseModel):
    """Restore or purge trash entries — by id, or the lot."""
    network: str
    trash_ids: Optional[list[str]] = None
    all: bool = False
    source: Optional[str] = "human:user"


#: Files listed inline on a trash entry before it just reports a count.
TRASH_PREVIEW_FILES = 10


def _trash_key(record: FileRecord) -> str:
    """The entry a deleted record belongs to — its own id if it predates trash."""
    return record.trash_id or record.id


def _trashed_records(db: Session, workspace_id: str) -> list[FileRecord]:
    return list(db.execute(
        select(FileRecord)
        .where(FileRecord.workspace_id == workspace_id)
        .where(FileRecord.status == "deleted")
    ).scalars().all())


def _trash_entries(records: list[FileRecord]) -> list[dict]:
    """Group deleted records into the entries a user recognises."""
    grouped: dict[str, list[FileRecord]] = {}
    for record in records:
        grouped.setdefault(_trash_key(record), []).append(record)

    entries = []
    for trash_id, group in grouped.items():
        first = group[0]
        # A folder delete tags every record with the folder it came from; a
        # file delete tags it with the file itself. Untagged (pre-trash)
        # records are single files by construction.
        path = first.trash_path or first.filename
        is_folder = len(group) > 1 or path != first.filename
        files = [f for f in group if _basename(f.filename) != KEEP_FILE]
        deleted_at = max((r.deleted_at for r in group if r.deleted_at), default=None)

        entries.append({
            "trash_id": trash_id,
            "kind": "folder" if is_folder else "file",
            "path": path,
            "name": _basename(path),
            "deleted_at": deleted_at.isoformat() if deleted_at else None,
            "file_count": len(files),
            "size": sum(f.size or 0 for f in files),
            "files": [
                {
                    "id": f.id,
                    "filename": f.filename,
                    "name": _basename(f.filename),
                    "size": f.size,
                    "content_type": f.content_type,
                    "kind": kind_for(f.filename, f.content_type),
                }
                for f in sorted(files, key=lambda f: f.filename)[:TRASH_PREVIEW_FILES]
            ],
        })

    # Newest first; entries with no timestamp (pre-trash deletes) sort last.
    entries.sort(key=lambda e: (e["deleted_at"] is not None, e["deleted_at"] or ""), reverse=True)
    return entries


@router.post("/files/trash")
async def move_to_trash(
    request: TrashRequest,
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """
    Move files and folders to the trash.

    Each folder becomes one entry however many files it holds, so restoring is
    the same gesture as deleting was. Anything already gone is reported in
    `not_found` rather than failing the request — a stale list on the client
    shouldn't block deleting the rest.
    """
    if not request.file_ids and not request.paths:
        return json_response(ResponseCode.BAD_REQUEST, "Nothing to delete: pass file_ids or paths")

    workspace = _resolve_workspace(db, request.network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")

    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    source = request.source or "human:user"
    now = datetime.now(timezone.utc)
    entries: list[dict] = []
    not_found: list[str] = []
    pending_events: list[Event] = []

    def _trash(records: list[FileRecord], path: str, kind: str) -> None:
        trash_id = str(uuid.uuid4())
        for record in records:
            record.status = "deleted"
            record.deleted_at = now
            record.trash_id = trash_id
            record.trash_path = path
        counted = [r for r in records if _basename(r.filename) != KEEP_FILE]
        entries.append({
            "trash_id": trash_id,
            "kind": kind,
            "path": path,
            "name": _basename(path),
            "file_count": len(counted),
            "size": sum(r.size or 0 for r in counted),
        })

    for file_id in request.file_ids or []:
        record = db.execute(
            select(FileRecord)
            .where(FileRecord.id == file_id)
            .where(FileRecord.workspace_id == str(workspace.id))
            .where(FileRecord.status == "active")
        ).scalar_one_or_none()
        if not record:
            not_found.append(file_id)
            continue
        _trash([record], record.filename, "file")
        pending_events.append(Event(
            type="workspace.file.deleted",
            source=source,
            target="core",
            payload={"file_id": record.id, "filename": record.filename},
        ))

    for raw_path in request.paths or []:
        folder = _normalize_folder_path(raw_path)
        if not folder:
            not_found.append(raw_path)
            continue
        records = _folder_records(db, str(workspace.id), folder)
        records = [r for r in records if r.status == "active"]
        if not records:
            not_found.append(raw_path)
            continue
        _trash(records, folder, "folder")
        pending_events.append(Event(
            type="workspace.folder.deleted",
            source=source,
            target="core",
            payload={"path": folder, "count": len(records)},
        ))

    db.commit()

    for event in pending_events:
        await _emit_event(event, workspace, db, token=x_workspace_token or workspace.password_hash)

    return success_response({
        "entries": entries,
        "not_found": not_found,
        "trashed_count": sum(e["file_count"] for e in entries),
    })


@router.get("/files/trash")
def list_trash(
    network: str = Query(..., description="Network (workspace) ID or slug"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """
    What's in the trash, newest first.

    One entry per delete action: a deleted folder is a single row holding its
    files, not N loose ones. `files` previews the first few; `file_count` is
    the real number. Empty-folder `.keep` placeholders never count.
    """
    workspace = _resolve_workspace(db, network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")

    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    entries = _trash_entries(_trashed_records(db, str(workspace.id)))
    page = entries[offset:offset + limit]

    return success_response({
        "entries": page,
        "total": len(entries),
        "file_total": sum(e["file_count"] for e in entries),
        "size_total": sum(e["size"] for e in entries),
        "limit": limit,
        "offset": offset,
    })


@router.post("/files/trash/restore")
async def restore_from_trash(
    request: TrashActionRequest,
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """
    Put trash entries back where they were.

    If something has taken the name in the meantime, the restored file lands
    beside it as "report (2).pdf" rather than overwriting or failing — the
    trash's job is to give things back, not to adjudicate names.
    """
    workspace = _resolve_workspace(db, request.network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")

    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    if not request.all and not request.trash_ids:
        return json_response(ResponseCode.BAD_REQUEST, "Pass trash_ids or all=true")

    wanted = None if request.all else set(request.trash_ids or [])
    records = [
        r for r in _trashed_records(db, str(workspace.id))
        if wanted is None or _trash_key(r) in wanted
    ]
    if not records:
        return success_response({"entries": [], "restored_count": 0, "not_found": list(wanted or [])})

    taken = set(db.execute(
        select(FileRecord.filename)
        .where(FileRecord.workspace_id == str(workspace.id))
        .where(FileRecord.status == "active")
    ).scalars().all())

    grouped: dict[str, list[FileRecord]] = {}
    for record in records:
        grouped.setdefault(_trash_key(record), []).append(record)

    entries = []
    for trash_id, group in grouped.items():
        renamed = 0
        for record in group:
            target = record.filename
            if target in taken:
                target = _next_free_name(taken, _dirname(record.filename), _basename(record.filename))
                renamed += 1
            record.filename = target
            record.status = "active"
            record.deleted_at = None
            record.trash_id = None
            record.trash_path = None
            taken.add(target)

        counted = [r for r in group if _basename(r.filename) != KEEP_FILE]
        entries.append({
            "trash_id": trash_id,
            "file_count": len(counted),
            "renamed_count": renamed,
            "files": [{"id": r.id, "filename": r.filename} for r in counted],
        })

    db.commit()

    found = set(grouped)
    for entry in entries:
        await _emit_event(
            Event(
                type="workspace.file.restored",
                source=request.source or "human:user",
                target="core",
                payload={"trash_id": entry["trash_id"], "count": entry["file_count"]},
            ),
            workspace,
            db,
            token=x_workspace_token or workspace.password_hash,
        )

    return success_response({
        "entries": entries,
        "restored_count": sum(e["file_count"] for e in entries),
        "not_found": sorted((wanted or set()) - found),
    })


@router.post("/files/trash/purge")
async def purge_trash(
    request: TrashActionRequest,
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """
    Delete trash entries for real — records and stored bytes, unrecoverable.

    `all=true` is the "empty trash" button. Storage failures don't stop the
    sweep: a missing object is exactly what we were trying to achieve, and a
    record left pointing at bytes that can't be removed is worse than an
    orphaned object.
    """
    workspace = _resolve_workspace(db, request.network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")

    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    if not request.all and not request.trash_ids:
        return json_response(ResponseCode.BAD_REQUEST, "Pass trash_ids or all=true")

    wanted = None if request.all else set(request.trash_ids or [])
    records = [
        r for r in _trashed_records(db, str(workspace.id))
        if wanted is None or _trash_key(r) in wanted
    ]

    store = get_file_store()
    loop = asyncio.get_event_loop()
    purged_ids = set()
    storage_errors = 0

    for record in records:
        try:
            await loop.run_in_executor(None, store.delete, record.storage_key)
        except Exception:  # noqa: BLE001 — see docstring
            storage_errors += 1
            logger.warning("Trash purge: could not delete %s", record.storage_key, exc_info=True)
        purged_ids.add(_trash_key(record))
        db.delete(record)

    db.commit()

    if records:
        await _emit_event(
            Event(
                type="workspace.trash.purged",
                source=request.source or "human:user",
                target="core",
                payload={"count": len(records)},
            ),
            workspace,
            db,
            token=x_workspace_token or workspace.password_hash,
        )

    return success_response({
        "purged_count": len(records),
        "entry_count": len(purged_ids),
        "storage_errors": storage_errors,
        "not_found": sorted((wanted or set()) - purged_ids),
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
# Browsing
#
# `GET /files` hands back one flat page of records and leaves the caller to
# rebuild the folder tree from filename prefixes. That works until the page
# limit cuts in: the client then derives its folders, counts and type filters
# from an arbitrary slice of the workspace and has no way to know it.
#
# `GET /files/browse` does that derivation server-side, over every record in
# scope: one folder's worth of subfolders and files, so a client can open the
# root and walk down a level at a time instead of loading the whole workspace
# to draw a tree.
#
# It must be declared before /files/{file_id}, or FastAPI matches "browse" as
# a file ID.
# ---------------------------------------------------------------------------

def _file_payload(record: FileRecord, relative: str, kind: str, group: str) -> dict:
    return {
        "id": record.id,
        "filename": record.filename,
        "relative_name": relative,
        "name": _basename(relative),
        "content_type": record.content_type,
        "size": record.size,
        "uploaded_by": record.uploaded_by,
        "channel_name": record.channel_name,
        "status": record.status,
        "created_at": record.created_at.isoformat() if record.created_at else None,
        "kind": kind,
        "type_group": group,
    }


@router.get("/files/browse")
def browse_files(
    network: str = Query(..., description="Network (workspace) ID or slug"),
    path: str = Query("", description="Folder to browse; empty is the root"),
    recursive: bool = Query(
        False, description="False lists this level only; true flattens the whole subtree"
    ),
    include: str = Query("both", description="both | files | folders"),
    q: Optional[str] = Query(None, description="Filter entries by name, case-insensitive"),
    type_group: Optional[str] = Query(
        None, alias="type", description=f"Filter files by group: {', '.join(FILTER_GROUPS)}"
    ),
    sort: str = Query("name", description="name | recent | size"),
    order: Optional[str] = Query(None, description="asc | desc; defaults per sort key"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """
    What's inside one folder: its subfolders and its files.

    Default (`recursive=false`) is one level, the way a file browser opens a
    directory — the root call gives a client every top-level folder, and each
    expand is another call. `recursive=true` flattens the whole subtree
    instead, which is what a search or a "every image under here" filter wants.

    Counts are the point of the endpoint, so they're deliberate:

      per folder   `file_count` sits directly inside, `total_count` includes
                   its subtree, `folder_count` is how many subfolders it has —
                   enough to decide whether a node can be expanded
      `total`      files matching everything (path, q, type), before paging
      `scope_total` files matching path and q, before the type filter
      `type_counts` the same set broken down by type, so a filter menu can say
                   what picking each type would give you

    `.keep` placeholders keep empty folders alive and never count as files.
    Paging applies to files only; folders come back whole.
    """
    workspace = _resolve_workspace(db, network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")

    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    if include not in ("both", "files", "folders"):
        return json_response(ResponseCode.BAD_REQUEST, "include must be both, files or folders")
    if sort not in ("name", "recent", "size"):
        return json_response(ResponseCode.BAD_REQUEST, "sort must be name, recent or size")
    if order not in (None, "asc", "desc"):
        return json_response(ResponseCode.BAD_REQUEST, "order must be asc or desc")
    if type_group and type_group not in FILTER_GROUPS:
        return json_response(
            ResponseCode.BAD_REQUEST, f"type must be one of: {', '.join(FILTER_GROUPS)}"
        )

    folder = _normalize_folder_path(path) if path else None
    if path and folder is None:
        return json_response(ResponseCode.BAD_REQUEST, "Invalid path")

    query = (
        select(FileRecord)
        .where(FileRecord.workspace_id == str(workspace.id))
        .where(FileRecord.status == "active")
    )
    if folder:
        # autoescape: `startswith` compiles to LIKE, where `_` matches any
        # single character — and "uploaded_files/" is a real folder here.
        query = query.where(FileRecord.filename.startswith(f"{folder}/", autoescape=True))

    records = db.execute(query).scalars().all()

    # The subtree is fetched whole and walked here. Folder counts need every
    # descendant record anyway, and type classification can't be expressed in
    # SQL — the alternative, a `kind` column, would have to be backfilled and
    # kept in step with the frontend's mapping by hand.
    prefix = f"{folder}/" if folder else ""
    needle = q.lower() if q else None
    want_files = include in ("both", "files")
    want_folders = include in ("both", "folders")

    direct_counts: dict[str, int] = {}    # relative folder -> files sitting in it
    total_counts: dict[str, int] = {}     # relative folder -> files in its subtree
    child_folders: dict[str, set[str]] = {}
    type_counts: dict[str, int] = {}
    matched: list[tuple[FileRecord, str, str, str]] = []  # record, relative, kind, group

    for record in records:
        relative = record.filename[len(prefix):] if prefix else record.filename
        is_keep = _basename(relative) == KEEP_FILE
        rel_folder = _dirname(relative)

        if want_folders and rel_folder:
            segments = rel_folder.split("/")
            for i in range(len(segments)):
                ancestor = "/".join(segments[: i + 1])
                direct_counts.setdefault(ancestor, 0)
                total_counts.setdefault(ancestor, 0)
                child_folders.setdefault(ancestor, set())
                if i > 0:
                    child_folders["/".join(segments[:i])].add(ancestor)
                if not is_keep:
                    total_counts[ancestor] += 1
            if not is_keep:
                direct_counts[rel_folder] += 1

        if not want_files or is_keep:
            continue
        if not recursive and rel_folder:
            continue
        if needle and needle not in relative.lower():
            continue

        kind = kind_for(record.filename, record.content_type)
        group = KIND_GROUPS[kind]
        type_counts[group] = type_counts.get(group, 0) + 1

        if type_group and group != type_group:
            continue
        matched.append((record, relative, kind, group))

    descending = (order == "desc") if order else sort in ("recent", "size")
    if sort == "size":
        matched.sort(key=lambda m: m[0].size or 0, reverse=descending)
    elif sort == "recent":
        matched.sort(
            key=lambda m: m[0].created_at.timestamp() if m[0].created_at else 0.0,
            reverse=descending,
        )
    else:
        matched.sort(key=lambda m: m[1].lower(), reverse=descending)

    page = matched[offset:offset + limit]

    # Folders are matched by their own name, not by what's inside them: a
    # search for "report" should surface a folder called reports, not every
    # folder that happens to hold a report.
    folders = []
    for relative_path in sorted(direct_counts):
        if not recursive and "/" in relative_path:
            continue
        if needle and needle not in _basename(relative_path).lower():
            continue
        folders.append({
            "name": _basename(relative_path),
            "path": f"{folder}/{relative_path}" if folder else relative_path,
            "relative_path": relative_path,
            "depth": relative_path.count("/"),
            "file_count": direct_counts[relative_path],
            "folder_count": len(child_folders.get(relative_path, ())),
            "total_count": total_counts[relative_path],
        })

    return success_response({
        "path": folder or "",
        "recursive": recursive,
        "folders": folders,
        "folder_total": len(folders),
        "files": [_file_payload(*entry) for entry in page],
        "total": len(matched),
        "scope_total": sum(type_counts.values()),
        "type_counts": type_counts,
        "limit": limit,
        "offset": offset,
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
