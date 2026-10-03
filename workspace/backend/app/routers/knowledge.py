# -*- coding: utf-8 -*-
"""
Knowledge base endpoints — shared markdown documents for the workspace.

POST   /v1/knowledge                  Create a knowledge entry
GET    /v1/knowledge                  List knowledge entries
GET    /v1/knowledge/{entry_id}       Read entry with content
GET    /v1/knowledge/by-slug/{slug}   Read entry by slug
PUT    /v1/knowledge/{entry_id}       Update entry
DELETE /v1/knowledge/{entry_id}       Soft-delete entry
"""

import logging
import re
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, Path, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import KnowledgeEntry, Workspace
from app.response import ResponseCode, json_response, success_response
from app.routers.network import (
    _emit_event,
    _resolve_workspace,
    _verify_workspace_access,
)
from app.services.access_model import (
    agent_name_from_source,
    allowed,
    can_manage,
    can_read_knowledge,
    filter_knowledge,
    normalize_visibility,
    resource_for_knowledge,
    resource_meta,
)
from app.services.visibility import resolve_viewer
from app.storage import get_file_store
from openagents.core.onm_events import Event

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["Knowledge"])


# ---------------------------------------------------------------------------
# Permission model (v1.1): owner + visibility on every entry.
# ---------------------------------------------------------------------------

def _viewer_for(db, workspace, token, authorization, source=None):
    return resolve_viewer(db, workspace, token, authorization, agent_name=agent_name_from_source(source))


def _owner_for(viewer, source: Optional[str]) -> Optional[str]:
    if viewer.kind == "human" and viewer.email:
        return f"human:{viewer.email}"
    if viewer.kind == "agent":
        return f"openagents:{viewer.agent_name}"
    src = (source or "").strip()
    return src or None


def _visibility_for(viewer, requested: Optional[str]) -> str:
    v = normalize_visibility(requested)
    if v in ("private", "public"):
        return v
    return "public" if viewer.machine else "private"


def _meta(db, workspace_id, viewer, entry: KnowledgeEntry) -> dict:
    return resource_meta(db, str(workspace_id), viewer, resource_for_knowledge(entry))

MAX_CONTENT_SIZE = 1 * 1024 * 1024  # 1 MB


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class CreateKnowledgeRequest(BaseModel):
    network: str
    title: str
    content: str
    description: Optional[str] = None
    source: Optional[str] = "human:user"
    visibility: Optional[str] = None     # private | public | None = default


class UpdateKnowledgeRequest(BaseModel):
    network: str
    title: Optional[str] = None
    content: Optional[str] = None
    description: Optional[str] = None
    source: Optional[str] = "human:user"
    visibility: Optional[str] = None     # private | public (owner / admin)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _slugify(title: str) -> str:
    slug = re.sub(r"[^\w\s-]", "", title.lower())
    slug = re.sub(r"[\s_]+", "-", slug).strip("-")
    return slug[:80] or "untitled"


def _unique_slug(db: Session, workspace_id: str, base_slug: str, exclude_id: str | None = None) -> str:
    slug = base_slug
    suffix = 1
    while True:
        query = select(KnowledgeEntry).where(
            KnowledgeEntry.workspace_id == workspace_id,
            KnowledgeEntry.slug == slug,
            KnowledgeEntry.status == "active",
        )
        if exclude_id:
            query = query.where(KnowledgeEntry.id != exclude_id)
        if not db.execute(query).scalar_one_or_none():
            return slug
        suffix += 1
        slug = f"{base_slug}-{suffix}"


def _serialize(entry: KnowledgeEntry, meta: Optional[dict] = None) -> dict:
    return {
        **(meta or {}),
        "id": entry.id,
        "slug": entry.slug,
        "title": entry.title,
        "description": entry.description,
        "content_size": entry.content_size,
        "storage_key": entry.storage_key,
        "created_by": entry.created_by,
        "updated_by": entry.updated_by,
        "status": entry.status,
        "created_at": entry.created_at.isoformat() if entry.created_at else None,
        "updated_at": entry.updated_at.isoformat() if entry.updated_at else None,
    }


# ---------------------------------------------------------------------------
# POST /v1/knowledge
# ---------------------------------------------------------------------------

@router.post("/knowledge")
async def create_knowledge(
    body: CreateKnowledgeRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace = _resolve_workspace(db, body.network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    content_bytes = body.content.encode("utf-8")
    if len(content_bytes) > MAX_CONTENT_SIZE:
        return json_response(ResponseCode.BAD_REQUEST, f"Content too large (max {MAX_CONTENT_SIZE // 1024}KB)")

    ws_id = str(workspace.id)
    base_slug = _slugify(body.title)
    slug = _unique_slug(db, ws_id, base_slug)

    from uuid import uuid4
    entry_id = str(uuid4())

    store = get_file_store()
    storage_filename = f"{slug}.md"
    storage_key = store.save(ws_id, entry_id, storage_filename, content_bytes)

    _viewer = _viewer_for(db, workspace, x_workspace_token, authorization, body.source)
    entry = KnowledgeEntry(
        id=entry_id,
        workspace_id=ws_id,
        slug=slug,
        title=body.title,
        description=body.description,
        storage_key=storage_key,
        content_size=len(content_bytes),
        created_by=body.source or "human:user",
        owner=_owner_for(_viewer, body.source),
        visibility=_visibility_for(_viewer, body.visibility),
    )
    db.add(entry)
    db.commit()

    event = Event(
        type="workspace.knowledge.created",
        source=body.source or "human:user",
        target="core",
        payload={"entry_id": entry_id, "slug": slug, "title": body.title},
    )
    await _emit_event(event, workspace, db, token=x_workspace_token)

    result = _serialize(entry, _meta(db, ws_id, _viewer, entry))
    result["content"] = body.content
    return success_response(result)


# ---------------------------------------------------------------------------
# GET /v1/knowledge
# Read handlers use synchronous DB/storage I/O and run in the threadpool.
# ---------------------------------------------------------------------------

@router.get("/knowledge")
def list_knowledge(
    network: str = Query(...),
    status: Optional[str] = Query("active"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace = _resolve_workspace(db, network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    ws_id = str(workspace.id)
    query = select(KnowledgeEntry).where(KnowledgeEntry.workspace_id == ws_id)
    if status:
        query = query.where(KnowledgeEntry.status == status)
    query = query.order_by(KnowledgeEntry.updated_at.desc())

    _viewer = _viewer_for(db, workspace, x_workspace_token, authorization)
    if _viewer.machine:
        rows = db.execute(query.offset(offset).limit(limit)).scalars().all()
        total = db.execute(
            select(func.count(KnowledgeEntry.id)).where(
                KnowledgeEntry.workspace_id == ws_id,
                KnowledgeEntry.status == (status or "active"),
            )
        ).scalar() or 0
    else:
        visible = filter_knowledge(db, ws_id, _viewer, db.execute(query).scalars().all())
        total = len(visible)
        rows = visible[offset:offset + limit]

    return success_response({
        "entries": [_serialize(e, _meta(db, ws_id, _viewer, e)) for e in rows],
        "total": total,
    })


# ---------------------------------------------------------------------------
# GET /v1/knowledge/{entry_id}
# ---------------------------------------------------------------------------

@router.get("/knowledge/{entry_id}")
def get_knowledge(
    entry_id: str = Path(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    entry = db.execute(
        select(KnowledgeEntry).where(KnowledgeEntry.id == entry_id)
    ).scalar_one_or_none()
    if not entry:
        return json_response(ResponseCode.NOT_FOUND, "Knowledge entry not found")

    workspace = db.execute(
        select(Workspace).where(Workspace.id == entry.workspace_id)
    ).scalar_one_or_none()
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    _viewer = _viewer_for(db, workspace, x_workspace_token, authorization)
    if not can_read_knowledge(db, str(workspace.id), _viewer, entry):
        return json_response(ResponseCode.FORBIDDEN, "No access to this knowledge entry")

    content = ""
    if entry.storage_key:
        store = get_file_store()
        try:
            content = store.read(entry.storage_key).decode("utf-8")
        except FileNotFoundError:
            content = ""

    result = _serialize(entry, _meta(db, workspace.id, _viewer, entry))
    result["content"] = content
    return success_response(result)


# ---------------------------------------------------------------------------
# GET /v1/knowledge/by-slug/{slug}
# ---------------------------------------------------------------------------

@router.get("/knowledge/by-slug/{slug}")
def get_knowledge_by_slug(
    slug: str = Path(...),
    network: str = Query(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace = _resolve_workspace(db, network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    ws_id = str(workspace.id)
    entry = db.execute(
        select(KnowledgeEntry).where(
            KnowledgeEntry.workspace_id == ws_id,
            KnowledgeEntry.slug == slug,
            KnowledgeEntry.status == "active",
        )
    ).scalar_one_or_none()
    if not entry:
        return json_response(ResponseCode.NOT_FOUND, "Knowledge entry not found")

    _viewer = _viewer_for(db, workspace, x_workspace_token, authorization)
    if not can_read_knowledge(db, ws_id, _viewer, entry):
        return json_response(ResponseCode.FORBIDDEN, "No access to this knowledge entry")

    content = ""
    if entry.storage_key:
        store = get_file_store()
        try:
            content = store.read(entry.storage_key).decode("utf-8")
        except FileNotFoundError:
            content = ""

    result = _serialize(entry, _meta(db, ws_id, _viewer, entry))
    result["content"] = content
    return success_response(result)


# ---------------------------------------------------------------------------
# PUT /v1/knowledge/{entry_id}
# ---------------------------------------------------------------------------

@router.put("/knowledge/{entry_id}")
async def update_knowledge(
    body: UpdateKnowledgeRequest,
    entry_id: str = Path(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    entry = db.execute(
        select(KnowledgeEntry).where(
            KnowledgeEntry.id == entry_id,
            KnowledgeEntry.status == "active",
        )
    ).scalar_one_or_none()
    if not entry:
        return json_response(ResponseCode.NOT_FOUND, "Knowledge entry not found")

    workspace = _resolve_workspace(db, body.network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    ws_id = str(workspace.id)
    now = datetime.now(timezone.utc)

    # Permission model: editing takes the `act` right (owner, admin, machine,
    # a grant with act, or public); changing visibility takes a manager.
    _viewer = _viewer_for(db, workspace, x_workspace_token, authorization, body.source)
    if not allowed(db, _viewer, resource_for_knowledge(entry), "act", ws_id):
        return json_response(ResponseCode.FORBIDDEN, "No access to this knowledge entry")
    if body.visibility is not None:
        vis = normalize_visibility(body.visibility)
        if vis not in ("private", "public"):
            return json_response(ResponseCode.BAD_REQUEST, "visibility must be 'private' or 'public'")
        if not can_manage(db, _viewer, resource_for_knowledge(entry), ws_id):
            return json_response(ResponseCode.FORBIDDEN, "Only the entry's owner or an admin can change who sees it")
        entry.visibility = vis

    if body.title is not None and body.title != entry.title:
        base_slug = _slugify(body.title)
        entry.slug = _unique_slug(db, ws_id, base_slug, exclude_id=entry_id)
        entry.title = body.title

    if body.description is not None:
        entry.description = body.description

    if body.content is not None:
        content_bytes = body.content.encode("utf-8")
        if len(content_bytes) > MAX_CONTENT_SIZE:
            return json_response(ResponseCode.BAD_REQUEST, f"Content too large (max {MAX_CONTENT_SIZE // 1024}KB)")

        store = get_file_store()
        # Delete old file if storage_key changed due to slug change
        if entry.storage_key:
            try:
                store.delete(entry.storage_key)
            except Exception:
                pass
        storage_filename = f"{entry.slug}.md"
        entry.storage_key = store.save(ws_id, entry.id, storage_filename, content_bytes)
        entry.content_size = len(content_bytes)

    entry.updated_by = body.source or "human:user"
    entry.updated_at = now
    db.commit()

    event = Event(
        type="workspace.knowledge.updated",
        source=body.source or "human:user",
        target="core",
        payload={"entry_id": entry_id, "slug": entry.slug, "title": entry.title},
    )
    await _emit_event(event, workspace, db, token=x_workspace_token)

    result = _serialize(entry, _meta(db, ws_id, _viewer, entry))
    if body.content is not None:
        result["content"] = body.content
    return success_response(result)


# ---------------------------------------------------------------------------
# DELETE /v1/knowledge/{entry_id}
# ---------------------------------------------------------------------------

@router.delete("/knowledge/{entry_id}")
async def delete_knowledge(
    entry_id: str = Path(...),
    network: str = Query(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    entry = db.execute(
        select(KnowledgeEntry).where(
            KnowledgeEntry.id == entry_id,
            KnowledgeEntry.status == "active",
        )
    ).scalar_one_or_none()
    if not entry:
        return json_response(ResponseCode.NOT_FOUND, "Knowledge entry not found")

    workspace = _resolve_workspace(db, network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    _viewer = _viewer_for(db, workspace, x_workspace_token, authorization)
    if not allowed(db, _viewer, resource_for_knowledge(entry), "act", str(workspace.id)):
        return json_response(ResponseCode.FORBIDDEN, "No access to this knowledge entry")

    entry.status = "deleted"
    entry.updated_at = datetime.now(timezone.utc)
    db.commit()

    event = Event(
        type="workspace.knowledge.deleted",
        source="human:user",
        target="core",
        payload={"entry_id": entry_id, "slug": entry.slug},
    )
    await _emit_event(event, workspace, db, token=x_workspace_token)

    return success_response({"id": entry_id, "status": "deleted"})
