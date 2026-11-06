# -*- coding: utf-8 -*-
"""Public links to files — reach people outside the workspace.

    GET    /v1/files/{file_id}/public-link?network=   the live link, or null
    POST   /v1/files/{file_id}/public-link?network=   create one (or return the live one)
    DELETE /v1/files/{file_id}/public-link?network=   stop sharing
    GET    /v1/public/files/{token}                    the file itself, no sign-in

A grant only reaches workspace members; a public link is for everyone else.
Only a manager of the file (owner, admin, holder of the `share` right) may
create, see or revoke it. A trashed file stops being served; restoring it
brings the same link back.
"""

import logging
import secrets
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import config
from app.database import get_db
from app.models import FileRecord, FilePublicLink, Workspace
from app.response import ResponseCode, json_response, success_response
from app.routers.files import INLINE_SAFE_CONTENT_TYPES, file_response
from app.routers.sharing import _load
from app.services.access_model import can_manage, resource_for_file
from app.storage import get_file_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["Files"])

# What a browser may show in place rather than download. Media and PDF carry
# no script that runs in this origin; SVG and HTML still download.
_PUBLIC_INLINE = INLINE_SAFE_CONTENT_TYPES | {
    "application/pdf",
    "video/mp4",
    "video/webm",
    "video/quicktime",
    "audio/mpeg",
    "audio/mp4",
    "audio/wav",
    "audio/ogg",
}


def public_url(token: str) -> str:
    return f"{config.PUBLIC_API_BASE.rstrip('/')}/v1/public/files/{token}"


def _serialize(link: Optional[FilePublicLink]) -> Optional[dict]:
    if link is None:
        return None
    return {
        "token": link.token,
        "url": public_url(link.token),
        "created_by": link.created_by,
        "created_at": link.created_at.isoformat() if link.created_at else None,
    }


def _live_link(db: Session, file_id: str) -> Optional[FilePublicLink]:
    return db.execute(
        select(FilePublicLink).where(
            FilePublicLink.file_id == file_id,
            FilePublicLink.revoked_at.is_(None),
        )
    ).scalars().first()


def _managed_file(db: Session, network: str, file_id: str, token, authorization):
    """→ (ctx, record, None) or (None, None, error_response)."""
    ctx, err = _load(db, network, token, authorization)
    if err:
        return None, None, err
    record = db.execute(
        select(FileRecord).where(FileRecord.id == file_id, FileRecord.workspace_id == ctx.wid)
    ).scalar_one_or_none()
    if record is None or record.status != "active":
        return None, None, json_response(ResponseCode.NOT_FOUND, "File not found")
    if not can_manage(db, ctx.viewer, resource_for_file(record), ctx.wid):
        return None, None, json_response(
            ResponseCode.FORBIDDEN, "Only the owner, an admin, or someone with the share right can share this file"
        )
    return ctx, record, None


@router.get("/files/{file_id}/public-link")
def get_public_link(
    file_id: str,
    network: str = Query(...),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    _, record, err = _managed_file(db, network, file_id, x_workspace_token, authorization)
    if err:
        return err
    return success_response({"link": _serialize(_live_link(db, record.id))})


@router.post("/files/{file_id}/public-link")
def create_public_link(
    file_id: str,
    network: str = Query(...),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    ctx, record, err = _managed_file(db, network, file_id, x_workspace_token, authorization)
    if err:
        return err
    link = _live_link(db, record.id)
    if link is None:
        link = FilePublicLink(
            workspace_id=ctx.wid,
            file_id=record.id,
            token=secrets.token_urlsafe(16),
            created_by=ctx.viewer.email or ctx.viewer.label,
        )
        db.add(link)
        db.commit()
        db.refresh(link)
        logger.info("file_links: %s opened a public link to %s", link.created_by, record.id)
    return success_response({"link": _serialize(link)})


@router.delete("/files/{file_id}/public-link")
def revoke_public_link(
    file_id: str,
    network: str = Query(...),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    ctx, record, err = _managed_file(db, network, file_id, x_workspace_token, authorization)
    if err:
        return err
    link = _live_link(db, record.id)
    if link is not None:
        link.revoked_at = datetime.now(timezone.utc)
        db.commit()
        logger.info("file_links: %s revoked the public link to %s", ctx.viewer.email or ctx.viewer.label, record.id)
    return success_response({"link": None})


@router.get("/public/files/{token}")
def open_public_link(token: str, db: Session = Depends(get_db)):
    link = db.execute(
        select(FilePublicLink).where(FilePublicLink.token == token, FilePublicLink.revoked_at.is_(None))
    ).scalar_one_or_none()
    record = db.get(FileRecord, link.file_id) if link else None
    workspace = db.get(Workspace, record.workspace_id) if record else None
    if record is None or record.status != "active" or workspace is None or workspace.status == "deleted":
        return json_response(ResponseCode.NOT_FOUND, "This link is no longer available")
    try:
        data = get_file_store().read(record.storage_key)
    except FileNotFoundError:
        return json_response(ResponseCode.NOT_FOUND, "This link is no longer available")
    ct = (record.content_type or "").split(";")[0].strip().lower()
    return file_response(record, data, "inline" if ct in _PUBLIC_INLINE else "attachment")
