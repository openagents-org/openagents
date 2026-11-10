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

Only a signed-in person who can manage the file (owner, admin, or a holder of
the share right) may create a link — never an agent or a bare workspace token:
an agent steered by a prompt injection could otherwise publish any private
file it can reach. Managers may revoke, and only they get the token back.

A link stays good only while its creator could still create it: someone who
left the workspace, or lost the right to manage the file, takes their links
with them. Trashing, deleting or replacing the file revokes its links for good
(app/services/file_share_links.py), so a restore does not revive them.

The content route always answers as an attachment with nosniff, a sandbox CSP
and no referrer, so a shared HTML or SVG file never runs script in the API
origin and the token does not leak through a Referer header.
"""

import logging
import secrets
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, Header, Query
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import FileRecord, FileShareLink, Workspace
from app.response import ResponseCode, json_response, success_response
from app.routers.network import _resolve_workspace, _verify_workspace_access
from app.services.access_model import Principal, can_manage, can_read_file, resource_for_file, workspace_human_role
from app.services.visibility import resolve_viewer
from app.storage import get_file_store

logger = logging.getLogger(__name__)

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
    if viewer.kind != "human" or not viewer.email:
        return json_response(ResponseCode.FORBIDDEN, "Only a signed-in person can create a public link")
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
        try:
            db.commit()
        except IntegrityError:
            # A second create won the race (uq_file_share_links_live): hand
            # back the link it made rather than a second one nobody can see.
            db.rollback()
            link = _live_link(db, record.id)
            if link is None:
                return json_response(ResponseCode.INTERNAL_ERROR, "Couldn't create the public link")
        else:
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


def _creator_can_still_share(db: Session, workspace: Workspace, link: FileShareLink, record: FileRecord) -> bool:
    """Whether whoever created the link could still create it now: still a
    member of the workspace, still able to manage the file."""
    created_by = link.created_by or ""
    if not created_by.startswith("human:"):
        return False
    email = created_by[len("human:"):]
    role = workspace_human_role(db, workspace, email)
    if not role:
        return False
    creator = Principal("human", email=email, role=role, workspace_id=str(workspace.id))
    return can_manage(db, creator, resource_for_file(record), str(workspace.id))


def _shared_file(db: Session, token: str):
    """(record, link) behind a live link, or (None, None). Trashed files,
    deleted workspaces, revoked links and creators who could no longer share
    all read as "not found"."""
    link = db.execute(
        select(FileShareLink).where(FileShareLink.token == token, FileShareLink.revoked_at.is_(None))
    ).scalar_one_or_none()
    if link is None:
        return None, None
    record = db.get(FileRecord, link.file_id)
    if not record or record.status != "active" or str(record.workspace_id) != str(link.workspace_id):
        return None, None
    workspace = db.get(Workspace, record.workspace_id)
    if not workspace or workspace.status == "deleted":
        return None, None
    if not _creator_can_still_share(db, workspace, link, record):
        return None, None
    return record, link


# Every public response: the token is in the page URL, so no Referer may carry
# it to whatever the shared file links to.
_NO_REFERRER = {"Referrer-Policy": "no-referrer"}


def _public_error(code: ResponseCode, message: str):
    response = json_response(code, message)
    response.headers.update(_NO_REFERRER)
    return response


@router.get("/public/files/{token}")
def public_file_info(token: str, db: Session = Depends(get_db)):
    record, link = _shared_file(db, token)
    if record is None:
        return _public_error(ResponseCode.NOT_FOUND, "This link is no longer available")
    return JSONResponse(success_response({
        "filename": (record.filename or "file").rsplit("/", 1)[-1],
        "content_type": record.content_type,
        "size": record.size,
        # When it was shared, not when it was uploaded.
        "shared_at": link.created_at.isoformat() if link.created_at else None,
    }), headers=_NO_REFERRER)


@router.get("/public/files/{token}/content")
def public_file_content(token: str, db: Session = Depends(get_db)):
    record, _ = _shared_file(db, token)
    if record is None:
        return _public_error(ResponseCode.NOT_FOUND, "This link is no longer available")
    try:
        data = get_file_store().read(record.storage_key)
    except Exception:  # noqa: BLE001 — S3 reports a missing object as its own error type
        logger.warning("Public link: could not read %s", record.storage_key, exc_info=True)
        return _public_error(ResponseCode.NOT_FOUND, "File data not found in storage")
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
            **_NO_REFERRER,
        },
    )
