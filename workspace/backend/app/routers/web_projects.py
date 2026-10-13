"""Static projects are one versioned file/ACL, including every referenced asset."""
import base64
import hashlib
import io
import json
import mimetypes
import secrets
import uuid
import zipfile
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Channel, FileRecord, ProjectPreviewTicket, Workspace, WorkspaceMember
from app.response import success_response
from app.routers.sharing import _load
from app.routers.network import _emit_event_blocking
from openagents.core.onm_events import Event
from app.routers.files import _owner_for, _viewer_for
from app.services.access_model import Principal, allowed, can_read_file, can_view_channel, resource_for_file, workspace_human_roles
from app.storage import get_file_store

router = APIRouter(prefix='/v1', tags=['web-projects'])
PROJECT_TYPE = 'application/vnd.openagents.web-project+zip'
MANIFEST = '__openagents_project__.json'
MAX_BYTES = 25 * 1024 * 1024
MAX_FILES = 500


class ProjectAsset(BaseModel):
    path: str = Field(max_length=512)
    content_base64: str = Field(max_length=MAX_BYTES * 4 // 3 + 4)


class PublishProject(BaseModel):
    network: str
    title: str = Field(min_length=1, max_length=120)
    entrypoint: str = 'index.html'
    files: list[ProjectAsset] = Field(min_length=1, max_length=MAX_FILES)
    channel_name: Optional[str] = None
    source: Optional[str] = None
    visibility: Literal['private', 'public', 'inherit'] = 'private'
    expected_revision: Optional[str] = None


def valid_path(path):
    if not isinstance(path, str): return False
    parts = path.split('/')
    return bool(path) and len(path) <= 512 and all(p and not p.startswith('.') and p not in ('node_modules', '__pycache__') for p in parts) and not any(c in path for c in '\\:%?#\x00') and not any(ord(c) < 32 for c in path) and path != MANIFEST


def bundle(body):
    if not valid_path(body.entrypoint) or not body.entrypoint.lower().endswith(('.html', '.htm')):
        raise HTTPException(400, 'Choose an HTML entry page inside the project.')
    out = io.BytesIO(); total = 0; paths = set()
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_STORED) as archive:
        for asset in body.files:
            if not valid_path(asset.path) or asset.path in paths:
                raise HTTPException(400, 'Project paths must be unique, relative, and exclude hidden files and dependency folders.')
            try:
                data = base64.b64decode(asset.content_base64, validate=True)
            except Exception:
                raise HTTPException(400, 'Invalid file content.')
            total += len(data)
            if total > MAX_BYTES:
                raise HTTPException(400, 'Projects may contain up to 25 MB of files.')
            archive.writestr(asset.path, data); paths.add(asset.path)
        if body.entrypoint not in paths:
            raise HTTPException(400, 'The entry page was not included in the project.')
        archive.writestr(MANIFEST, json.dumps({'entrypoint': body.entrypoint, 'files': sorted(paths)}))
    return out.getvalue()


def read_archive(record):
    """Validate even bundles uploaded through the generic file API."""
    try:
        data = get_file_store().read(record.storage_key)
        if len(data) > MAX_BYTES + 1024 * 1024: raise ValueError()
        archive = zipfile.ZipFile(io.BytesIO(data))
        infos = archive.infolist()
        if len(infos) > MAX_FILES + 1 or sum(i.file_size for i in infos if i.filename != MANIFEST) > MAX_BYTES: raise ValueError()
        names = [i.filename for i in infos]
        if len(set(names)) != len(names) or MANIFEST not in names: raise ValueError()
        if any(n != MANIFEST and not valid_path(n) for n in names): raise ValueError()
        if archive.getinfo(MANIFEST).file_size > 65536: raise ValueError()
        manifest = json.loads(archive.read(MANIFEST))
        entry = manifest['entrypoint']
        if not valid_path(entry) or not entry.lower().endswith(('.html', '.htm')) or entry not in names: raise ValueError()
        manifest['files'] = sorted(n for n in names if n != MANIFEST)
        return archive, manifest
    except (ValueError, KeyError, TypeError, zipfile.BadZipFile, RuntimeError, OSError):
        raise HTTPException(404, 'Project bundle is unavailable or invalid.')


def revision(record):
    return hashlib.sha256(record.storage_key.encode()).hexdigest()[:24]


def readable(db, ctx, project_id, lock=False):
    query = select(FileRecord).where(FileRecord.id == project_id)
    row = db.execute(query.with_for_update() if lock else query).scalar_one_or_none()
    if not row or str(row.workspace_id) != ctx.wid or row.status != 'active' or row.content_type != PROJECT_TYPE or not can_read_file(db, ctx.wid, ctx.viewer, row):
        raise HTTPException(404, 'Project not available.')
    return row


def publish(body, project_id, db, token, authorization):
    ctx, error = _load(db, body.network, token, authorization)
    if error: return error
    ctx.viewer = _viewer_for(db, ctx.workspace, token, authorization, body.source)
    row = readable(db, ctx, project_id, lock=True) if project_id else None
    if row:
        if not allowed(db, ctx.viewer, resource_for_file(row), 'act', workspace_id=ctx.wid):
            raise HTTPException(403, 'You cannot update this project.')
        if body.expected_revision != revision(row):
            raise HTTPException(409, 'The project changed. Refresh it before uploading an update.')
    elif body.channel_name:
        channel = db.execute(select(Channel).where(Channel.workspace_id == ctx.wid, Channel.name == body.channel_name, Channel.status != 'deleted')).scalar_one_or_none()
        if not channel or not can_view_channel(db, ctx.wid, ctx.viewer, channel):
            raise HTTPException(404, 'Thread not available.')
    if not row and body.visibility == 'inherit' and not body.channel_name:
        raise HTTPException(400, 'Select a thread to inherit its sharing.')
    if not body.title.strip(): raise HTTPException(400, 'Enter a project name.')
    data = bundle(body)
    store = get_file_store()
    key = store.save(ctx.wid, str(uuid.uuid4()), 'project.zip', data)
    old_key = row.storage_key if row else None
    if not row:
        row = FileRecord(id=str(uuid.uuid4()), workspace_id=ctx.wid, uploaded_by=ctx.viewer.label,
            owner=_owner_for(ctx.viewer, body.source), channel_name=body.channel_name,
            visibility=None if body.visibility == 'inherit' else body.visibility)
        db.add(row)
    row.filename = body.title.strip() + '.webproject.zip'
    row.content_type = PROJECT_TYPE; row.size = len(data); row.storage_key = key
    try:
        db.commit()
    except Exception:
        db.rollback(); store.delete(key); raise
    # Old preview tickets are invalidated by the version check below.
    if old_key:
        try: store.delete(old_key)
        except Exception: pass
    _emit_event_blocking(Event(type='workspace.file.uploaded', source=ctx.viewer.label, target=f'channel/{row.channel_name}' if row.channel_name else 'core', payload={'file_id':row.id, 'filename':row.filename, 'content_type':PROJECT_TYPE, 'size':row.size}), ctx.workspace, db, token=token or ctx.workspace.password_hash)
    return success_response({'id': row.id, 'filename': row.filename, 'revision': revision(row), 'entrypoint': body.entrypoint, 'file_count': len(body.files)})


@router.post('/web-projects')
def create_project(body: PublishProject, db: Session = Depends(get_db), x_workspace_token: Optional[str] = Header(None), authorization: Optional[str] = Header(None)):
    return publish(body, None, db, x_workspace_token, authorization)


@router.put('/web-projects/{project_id}')
def update_project(project_id: str, body: PublishProject, db: Session = Depends(get_db), x_workspace_token: Optional[str] = Header(None), authorization: Optional[str] = Header(None)):
    return publish(body, project_id, db, x_workspace_token, authorization)


@router.get('/web-projects/{project_id}')
def project_info(project_id: str, network: str = Query(...), db: Session = Depends(get_db), x_workspace_token: Optional[str] = Header(None), authorization: Optional[str] = Header(None)):
    ctx, error = _load(db, network, x_workspace_token, authorization)
    if error: return error
    row = readable(db, ctx, project_id)
    return success_response({'id':row.id, 'revision':revision(row)})


@router.post('/web-projects/{project_id}/preview')
def preview_project(project_id: str, network: str = Query(...), db: Session = Depends(get_db), x_workspace_token: Optional[str] = Header(None), authorization: Optional[str] = Header(None)):
    ctx, error = _load(db, network, x_workspace_token, authorization)
    if error: return error
    row = readable(db, ctx, project_id)
    archive, manifest = read_archive(row)
    archive.close()
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    db.execute(delete(ProjectPreviewTicket).where(ProjectPreviewTicket.expires_at < now))
    db.add(ProjectPreviewTicket(id=hashlib.sha256(token.encode()).hexdigest(), file_id=row.id,
        storage_key=row.storage_key, principal={'kind':ctx.viewer.kind, 'email':ctx.viewer.email, 'agent_name':ctx.viewer.agent_name},
        expires_at=now + timedelta(hours=1)))
    db.commit()
    return success_response({'id':row.id, 'revision':revision(row), 'entrypoint':manifest['entrypoint'],
        'files':manifest['files'], 'can_update':allowed(db, ctx.viewer, resource_for_file(row), 'act', workspace_id=ctx.wid),
        'preview_path':f"/v1/project-preview/{token}/{quote(manifest['entrypoint'], safe='/')}", 'expires_in':3600})


@router.get('/project-preview/{ticket}/{asset_path:path}')
def project_asset(ticket: str, asset_path: str, request: Request, db: Session = Depends(get_db)):
    denied = HTTPException(404, 'Preview expired or unavailable. Refresh the preview to continue.')
    grant = db.get(ProjectPreviewTicket, hashlib.sha256(ticket.encode()).hexdigest())
    if not grant or grant.expires_at.replace(tzinfo=timezone.utc) <= datetime.now(timezone.utc): raise denied
    row = db.get(FileRecord, grant.file_id)
    if not row or row.status != 'active' or row.storage_key != grant.storage_key: raise denied
    ws = db.get(Workspace, row.workspace_id)
    if not ws or ws.status == 'deleted': raise denied
    p = grant.principal
    viewer = Principal(p['kind'], email=p.get('email'), agent_name=p.get('agent_name'), workspace_id=ws.id)
    if viewer.kind == 'human':
        viewer.role = workspace_human_roles(db, ws).get(viewer.email)
        if not viewer.role: raise denied
    elif viewer.is_agent:
        member = db.execute(select(WorkspaceMember).where(WorkspaceMember.workspace_id == ws.id, WorkspaceMember.agent_name == viewer.agent_name)).scalar_one_or_none()
        if not member: raise denied
        viewer.owner_email = member.owner_email
    if not can_read_file(db, str(ws.id), viewer, row): raise denied
    if not valid_path(asset_path): raise denied
    archive, _ = read_archive(row)
    with archive:
        try: content = archive.read(asset_path)
        except KeyError: raise denied
    mime = mimetypes.guess_type(asset_path)[0] or 'application/octet-stream'
    if asset_path.endswith(('.js', '.mjs')): mime = 'text/javascript'
    # A host source inherits the page protocol, including behind TLS proxies.
    asset_base = request.url.netloc + f'/v1/project-preview/{ticket}/'
    # Also sandbox direct navigation: project scripts never gain the app origin.
    return Response(content, media_type=mime, headers={
        'Content-Security-Policy': f"sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' {asset_base}; style-src 'unsafe-inline' {asset_base}; img-src {asset_base} data: blob:; font-src {asset_base} data:; media-src {asset_base} blob: data:; connect-src {asset_base}; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'",
        'Access-Control-Allow-Origin':'*', 'Cache-Control':'no-store', 'Referrer-Policy':'no-referrer',
        'X-Content-Type-Options':'nosniff', 'Cross-Origin-Resource-Policy':'cross-origin'})
