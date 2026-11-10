# -*- coding: utf-8 -*-
"""Public "anyone with the link" view links for files.

Workspace links (/<ws>/files/<id>) only work for members who can already read
the file. These links are for everyone else: the person opening one needs no
account and no membership.

  GET    /v1/files/{file_id}/public-link?network=   the live link, if any
  POST   /v1/files/{file_id}/public-link            {network} create (idempotent)
  DELETE /v1/files/{file_id}/public-link?network=   revoke

  GET    /v1/public/files/{token}                   metadata, no auth
  GET    /v1/public/files/{token}/content           bytes, no auth

Only someone who can manage the file (owner, admin, or a holder of the share
right) may create or revoke a link, and only they get the token back. The
content route always answers as an attachment with nosniff, so a shared HTML
or SVG file never runs script in the API origin; the share page renders HTML
in a sandboxed iframe instead.
"""

import secrets
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, Header, Query
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import FileRecord, FileShareLink, Workspace
from app.response import ResponseCode, json_response, success_response
from app.routers.network import _resolve_workspace, _verify_workspace_access
from app.services.access_model import can_manage, can_read_file, resource_for_file
from app.services.visibility import resolve_viewer
from app.storage import get_file_store

router = APIRouter(prefix="/v1", tags=["File links"])

# A zipped web project needs its assets served from a ticketed origin; the
# public page can't render it from a single download.
WEB_PROJECT_TYPE = "application/vnd.openagents.web-project+zip"


class PublicLinkCreate(BaseModel):
    network: str


def _live_link(db: Session, file_id: str) -> Optional[FileShareLink]:
    return db.execute(
        select(FileShareLink).where(
            FileShareLink.file_id == file_id,
            FileShareLink.revoked_at.is_(None),
        ).order_by(FileShareLink.created_at.desc())
    ).scalars().first()


def _serialize(link: Optional[FileShareLink], manage: bool) -> dict:
    if link is None:
        return {"link": None, "can_manage": manage}
    body = {"active": True, "created_at": link.created_at.isoformat() if link.created_at else None}
    if manage:
        body.update({"token": link.token, "created_by": link.created_by})
    return {"link": body, "can_manage": manage}


def _authorize(db, file_id, network, token, authorization):
    """(record, workspace, viewer, error). The record must be active and live
    in the workspace the caller named; the viewer must be able to read it."""
    record = db.get(FileRecord, file_id)
    if not record or record.status != "active":
        return None, None, None, json_response(ResponseCode.NOT_FOUND, "File not found")
    workspace = _resolve_workspace(db, network)
    if not workspace or str(workspace.id) != str(record.workspace_id):
        return None, None, None, json_response(ResponseCode.NOT_FOUND, "File not found")
    if not _verify_workspace_access(workspace, token, authorization):
        return None, None, None, json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")
    viewer = resolve_viewer(db, workspace, token, authorization)
    if not can_read_file(db, str(workspace.id), viewer, record):
        return None, None, None, json_response(ResponseCode.FORBIDDEN, "No access to this file")
    return record, workspace, viewer, None


def _creator(viewer) -> str:
    if viewer.kind == "human" and viewer.email:
        return f"human:{viewer.email}"
    if viewer.kind == "agent" and viewer.agent_name:
        return f"openagents:{viewer.agent_name}"
    return "machine"


@router.get("/files/{file_id}/public-link")
def get_public_link(
    file_id: str,
    network: str = Query(...),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    record, workspace, viewer, error = _authorize(db, file_id, network, x_workspace_token, authorization)
    if error:
        return error
    manage = can_manage(db, viewer, resource_for_file(record), str(workspace.id))
    return success_response(_serialize(_live_link(db, record.id), manage))


@router.post("/files/{file_id}/public-link")
def create_public_link(
    file_id: str,
    body: PublicLinkCreate,
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    record, workspace, viewer, error = _authorize(db, file_id, body.network, x_workspace_token, authorization)
    if error:
        return error
    if not can_manage(db, viewer, resource_for_file(record), str(workspace.id)):
        return json_response(ResponseCode.FORBIDDEN, "Only the file's owner or an admin can create a public link")
    if (record.content_type or "").startswith(WEB_PROJECT_TYPE):
        return json_response(ResponseCode.BAD_REQUEST, "Web projects can't be shared by public link yet")
    link = _live_link(db, record.id)
    if link is None:
        link = FileShareLink(
            workspace_id=str(workspace.id),
            file_id=record.id,
            token=secrets.token_urlsafe(24),
            created_by=_creator(viewer),
        )
        db.add(link)
        db.commit()
        db.refresh(link)
    return success_response(_serialize(link, True))


@router.delete("/files/{file_id}/public-link")
def revoke_public_link(
    file_id: str,
    network: str = Query(...),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    record, workspace, viewer, error = _authorize(db, file_id, network, x_workspace_token, authorization)
    if error:
        return error
    if not can_manage(db, viewer, resource_for_file(record), str(workspace.id)):
        return json_response(ResponseCode.FORBIDDEN, "Only the file's owner or an admin can revoke a public link")
    now = datetime.now(timezone.utc)
    for link in db.execute(
        select(FileShareLink).where(FileShareLink.file_id == record.id, FileShareLink.revoked_at.is_(None))
    ).scalars():
        link.revoked_at = now
    db.commit()
    return success_response(_serialize(None, True))


def _shared_file(db: Session, token: str) -> Optional[FileRecord]:
    """The file behind a live link, or None. Trashed files, deleted
    workspaces and revoked links all read as "not found"."""
    link = db.execute(
        select(FileShareLink).where(FileShareLink.token == token, FileShareLink.revoked_at.is_(None))
    ).scalar_one_or_none()
    if link is None:
        return None
    record = db.get(FileRecord, link.file_id)
    if not record or record.status != "active" or str(record.workspace_id) != str(link.workspace_id):
        return None
    workspace = db.get(Workspace, record.workspace_id)
    if not workspace or workspace.status == "deleted":
        return None
    return record


@router.get("/public/files/{token}")
def public_file_info(token: str, db: Session = Depends(get_db)):
    record = _shared_file(db, token)
    if record is None:
        return json_response(ResponseCode.NOT_FOUND, "This link is no longer available")
    return success_response({
        "filename": (record.filename or "file").rsplit("/", 1)[-1],
        "content_type": record.content_type,
        "size": record.size,
        "created_at": record.created_at.isoformat() if record.created_at else None,
    })


@router.get("/public/files/{token}/content")
def public_file_content(token: str, db: Session = Depends(get_db)):
    record = _shared_file(db, token)
    if record is None:
        return json_response(ResponseCode.NOT_FOUND, "This link is no longer available")
    try:
        data = get_file_store().read(record.storage_key)
    except FileNotFoundError:
        return json_response(ResponseCode.NOT_FOUND, "File data not found in storage")
    filename = (record.filename or "file").rsplit("/", 1)[-1]
    ascii_fallback = filename.encode("ascii", "replace").decode("ascii").replace("?", "_")
    ascii_fallback = ascii_fallback.replace("\\", "_").replace('"', "_")
    return Response(
        content=data,
        media_type=record.content_type,
        headers={
            "Content-Disposition": f"attachment; filename=\"{ascii_fallback}\"; filename*=UTF-8''{quote(filename, safe='')}",
            "Content-Length": str(len(data)),
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox",
            "Cache-Control": "private, no-store",
        },
    )
