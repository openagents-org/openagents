# -*- coding: utf-8 -*-
"""Public "anyone with the link" links to snapshots of thread artifacts.

Workspace links (/<ws>/files/<id>, /<ws>/knowledge/<id>) only work for
members who can already read the artifact. These links are for everyone else:
the person opening one needs no account and no membership, and sees a copy of
the artifact taken when the link was made (app/services/public_shares.py).

  GET    /v1/public-shares?network=&kind=&id=      the live link, if any
  POST   /v1/public-shares                         {network, kind, id, expires_at?} create or refresh
  DELETE /v1/public-shares?network=&kind=&id=      revoke
  POST   /v1/public-shares/requests                an agent asks; a person approves in the thread

  GET    /v1/public/shares/{token}                 metadata, no auth
  GET    /v1/public/shares/{token}/content         the snapshot's bytes (Range supported), no auth
  GET    /v1/public/shares/{token}/assets/{n}      an image a shared document embeds, no auth
  GET    /v1/public/shares/{token}/site/{path}     an HTML page or web project, rendered —
                                                   only on the separate share domain

Only a signed-in person who can manage the artifact (owner, admin, or a holder
of the share right) may create, refresh or revoke a link, and only they get the
token back. ``kind`` is "file" (any file, web projects included) or
"knowledge".

Every public response carries no-referrer, so the token in the page URL never
leaks through a Referer header. Downloads answer as attachments with nosniff
and a sandbox CSP, so a shared HTML or SVG file never runs script in the API
origin. Rendering is served only when the request arrives on
SHARE_CONTENT_HOST, with a CSP that blocks every network request outside the
page's own snapshot and every form submission.
"""

import logging
import re
from datetime import datetime
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, Header, Query, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import config
from app.database import get_db
from app.models import Channel, PublicShare
from app.response import ResponseCode, json_response, success_response
from app.routers.network import _resolve_workspace, _verify_workspace_access
from app.services import public_shares as shares
from app.services.access_model import agent_name_from_source
from app.services.visibility import resolve_viewer
from app.storage import get_file_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["Public shares"])

_STATUS = {400: ResponseCode.BAD_REQUEST, 403: ResponseCode.FORBIDDEN, 404: ResponseCode.NOT_FOUND,
           500: ResponseCode.INTERNAL_ERROR}


class PublicShareCreate(BaseModel):
    network: str
    kind: str
    id: str
    expires_at: Optional[datetime] = None


class PublicShareRequest(BaseModel):
    network: str
    channel: str
    kind: str
    id: str
    expires_at: Optional[datetime] = None
    reason: Optional[str] = None
    source: Optional[str] = None             # "openagents:<agent>"
    requester_email: Optional[str] = None


def _authorize(db, network, kind, resource_id, token, authorization, source=None):
    """(obj, workspace, viewer, error). The artifact must be active and live in
    the workspace the caller named; the viewer must be able to read it."""
    if kind not in shares.KINDS:
        return None, None, None, json_response(ResponseCode.BAD_REQUEST, "kind must be file or knowledge")
    workspace = _resolve_workspace(db, network)
    if not workspace or workspace.status == "deleted":
        return None, None, None, json_response(ResponseCode.NOT_FOUND, "Not found")
    obj = shares.load_artifact(db, str(workspace.id), kind, resource_id)
    if obj is None:
        return None, None, None, json_response(ResponseCode.NOT_FOUND, "Not found")
    if not _verify_workspace_access(workspace, token, authorization):
        return None, None, None, json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")
    viewer = resolve_viewer(db, workspace, token, authorization, agent_name=agent_name_from_source(source))
    if not shares.can_read_artifact(db, str(workspace.id), viewer, kind, obj):
        return None, None, None, json_response(ResponseCode.FORBIDDEN, "No access to this artifact")
    return obj, workspace, viewer, None


def _person(viewer) -> bool:
    return viewer.kind == "human" and bool(viewer.email)


@router.get("/public-shares")
def get_public_share(
    network: str = Query(...),
    kind: str = Query(...),
    id: str = Query(...),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    obj, workspace, viewer, error = _authorize(db, network, kind, id, x_workspace_token, authorization)
    if error:
        return error
    manage = _person(viewer) and shares.can_manage_artifact(db, str(workspace.id), viewer, kind, obj)
    return success_response(shares.serialize(shares.current_share(db, workspace, kind, obj), manage))


@router.post("/public-shares")
def create_public_share(
    body: PublicShareCreate,
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    obj, workspace, viewer, error = _authorize(db, body.network, body.kind, body.id, x_workspace_token, authorization)
    if error:
        return error
    try:
        link = shares.publish(db, workspace, viewer, body.kind, obj, body.expires_at)
    except shares.ShareError as exc:
        return json_response(_STATUS.get(exc.status, ResponseCode.BAD_REQUEST), exc.message)
    return success_response(shares.serialize(link, True))


@router.delete("/public-shares")
def revoke_public_share(
    network: str = Query(...),
    kind: str = Query(...),
    id: str = Query(...),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    obj, workspace, viewer, error = _authorize(db, network, kind, id, x_workspace_token, authorization)
    if error:
        return error
    if not _person(viewer) or not shares.can_manage_artifact(db, str(workspace.id), viewer, kind, obj):
        return json_response(ResponseCode.FORBIDDEN, "Only the artifact's owner or an admin can revoke a public link")
    shares.revoke(db, kind, [obj.id])
    db.commit()
    return success_response(shares.serialize(None, True))


@router.post("/public-shares/requests")
def request_public_share(
    body: PublicShareRequest,
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """An agent asks for a public link. Nothing is published: an approval card
    is posted in the thread, and a person who can manage the artifact decides."""
    obj, workspace, viewer, error = _authorize(db, body.network, body.kind, body.id,
                                               x_workspace_token, authorization, source=body.source)
    if error:
        return error
    channel_name = (body.channel or "").strip()
    channel = db.execute(select(Channel).where(
        Channel.workspace_id == str(workspace.id), Channel.name == channel_name, Channel.status != "deleted",
    )).scalar_one_or_none()
    if channel is None:
        return json_response(ResponseCode.NOT_FOUND, "Thread not found")
    agent = viewer.agent_name or agent_name_from_source(body.source)
    if not agent:
        return json_response(ResponseCode.BAD_REQUEST,
                             "Only an agent files a request; a signed-in person creates the link directly")
    if body.expires_at is not None and shares._aware(body.expires_at) <= shares._now():
        return json_response(ResponseCode.BAD_REQUEST, "Choose an expiry date in the future")
    from app.services import approvals
    request = shares.create_request(
        db, workspace, channel_name=channel_name, agent=agent, kind=body.kind, obj=obj,
        expires_at=body.expires_at, reason=body.reason, requester_email=body.requester_email,
    )
    db.commit()
    return success_response(approvals.serialize_with_owner(db, request))


# ---------------------------------------------------------------------------
# Public, no auth
# ---------------------------------------------------------------------------

_NO_REFERRER = {"Referrer-Policy": "no-referrer"}


def _public_error(code: ResponseCode, message: str):
    response = json_response(code, message)
    response.headers.update(_NO_REFERRER)
    return response


def _read(key: str) -> Optional[bytes]:
    try:
        return get_file_store().read(key)
    except Exception:  # noqa: BLE001 — S3 reports a missing object as its own error type
        logger.warning("Public share: could not read %s", key, exc_info=True)
        return None


@router.get("/public/shares/{token}")
def public_share_info(token: str, db: Session = Depends(get_db)):
    link, why = shares.resolve_public(db, token)
    if link is None:
        return _public_error(ResponseCode.NOT_FOUND, why)
    render_url = None
    base = shares.render_base(token)
    if base:
        if link.entrypoint:
            render_url = base + quote(link.entrypoint, safe="/")
    return JSONResponse(success_response({
        "kind": link.resource_kind,
        "title": link.title,
        "filename": link.title,
        "content_type": link.content_type,
        "size": link.size,
        # When the copy was taken, not when the artifact was made.
        "shared_at": link.snapshot_at.isoformat() if link.snapshot_at else None,
        "expires_at": shares._aware(link.expires_at).isoformat() if link.expires_at else None,
        "web_project": shares.is_web_project(link.content_type),
        "render_url": render_url,
    }), headers=_NO_REFERRER)


_RANGE = re.compile(r"bytes=(\d*)-(\d*)$")


def _download(data: bytes, filename: str, content_type: Optional[str], range_header: Optional[str]) -> Response:
    # A title may hold a newline, which no header can carry.
    filename = re.sub(r"[\x00-\x1f\x7f]", " ", filename).strip() or "download"
    ascii_fallback = filename.encode("ascii", "replace").decode("ascii").replace("?", "_")
    ascii_fallback = ascii_fallback.replace("\\", "_").replace('"', "_")
    headers = {
        "Content-Disposition": f"attachment; filename=\"{ascii_fallback}\"; filename*=UTF-8''{quote(filename, safe='')}",
        "Accept-Ranges": "bytes",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
        "Cache-Control": "private, no-store",
        **_NO_REFERRER,
    }
    total = len(data)
    m = _RANGE.match((range_header or "").strip())
    if m and (m.group(1) or m.group(2)):
        # Video and audio seek with ranges; one range is all a player asks for.
        if m.group(1):
            start = int(m.group(1))
            end = min(int(m.group(2)), total - 1) if m.group(2) else total - 1
        else:
            start, end = max(total - int(m.group(2)), 0), total - 1
        if start >= total or start > end:
            return Response(status_code=416, headers={**headers, "Content-Range": f"bytes */{total}"})
        chunk = data[start:end + 1]
        return Response(content=chunk, status_code=206, media_type=content_type, headers={
            **headers, "Content-Range": f"bytes {start}-{end}/{total}", "Content-Length": str(len(chunk))})
    return Response(content=data, media_type=content_type, headers={**headers, "Content-Length": str(total)})


@router.get("/public/shares/{token}/content")
def public_share_content(token: str, request: Request, db: Session = Depends(get_db)):
    link, why = shares.resolve_public(db, token)
    if link is None:
        return _public_error(ResponseCode.NOT_FOUND, why)
    data = _read(link.storage_key)
    if data is None:
        return _public_error(ResponseCode.NOT_FOUND, "The shared copy could not be read")
    filename = link.title if link.resource_kind == "file" else f"{link.title}.md"
    return _download(data, filename, link.content_type, request.headers.get("range"))


@router.get("/public/shares/{token}/assets/{index}")
def public_share_asset(token: str, index: int, db: Session = Depends(get_db)):
    link, why = shares.resolve_public(db, token)
    if link is None:
        return _public_error(ResponseCode.NOT_FOUND, why)
    assets = link.assets or []
    if index < 0 or index >= len(assets):
        return _public_error(ResponseCode.NOT_FOUND, "Not found")
    asset = assets[index]
    data = _read(asset["storage_key"])
    if data is None:
        return _public_error(ResponseCode.NOT_FOUND, "The shared copy could not be read")
    return _download(data, asset.get("filename") or f"image-{index}", asset.get("content_type"), None)


@router.get("/public/shares/{token}/site/{asset_path:path}")
def public_share_site(token: str, asset_path: str, request: Request, db: Session = Depends(get_db)):
    """A shared HTML page or web project, rendered. Only on the share domain:
    on the API's own host this is a 404, so a shared page never runs there."""
    host = (request.headers.get("host") or "").split(":")[0].lower()
    if not config.SHARE_CONTENT_HOST or host != config.SHARE_CONTENT_HOST:
        return _public_error(ResponseCode.NOT_FOUND, "Not found")
    link, why = shares.resolve_public(db, token)
    if link is None:
        return _public_error(ResponseCode.NOT_FOUND, why)
    data = _read(link.storage_key)
    if data is None:
        return _public_error(ResponseCode.NOT_FOUND, "The shared copy could not be read")
    from app.routers.web_projects import open_archive, valid_path, with_storage_shim
    if shares.is_web_project(link.content_type):
        from fastapi import HTTPException
        if not valid_path(asset_path):
            return _public_error(ResponseCode.NOT_FOUND, "Not found")
        try:
            archive, _ = open_archive(data)
        except HTTPException:
            return _public_error(ResponseCode.NOT_FOUND, "Not found")
        with archive:
            try:
                content = archive.read(asset_path)
            except KeyError:
                return _public_error(ResponseCode.NOT_FOUND, "Not found")
        mime = shares.guess_type(asset_path)
    elif shares.is_html(link.content_type, link.title) and asset_path == "index.html":
        content, mime = data, "text/html"
    else:
        return _public_error(ResponseCode.NOT_FOUND, "Not found")
    if mime == "text/html":
        content = with_storage_shim(content)
    asset_base = f"{config.SHARE_CONTENT_HOST}/v1/public/shares/{token}/site/"
    # The same lockdown members' previews get (web_projects.project_asset):
    # scripts run, but nothing may be fetched or submitted outside the copy.
    return Response(content, media_type=mime, headers={
        "Content-Security-Policy": (
            f"sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' {asset_base}; "
            f"style-src 'unsafe-inline' {asset_base}; img-src {asset_base} data: blob:; "
            f"font-src {asset_base} data:; media-src {asset_base} blob: data:; connect-src {asset_base}; "
            "frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'"),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "cross-origin",
        **_NO_REFERRER,
    })
