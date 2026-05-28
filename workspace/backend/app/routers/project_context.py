# -*- coding: utf-8 -*-
"""
Project context management — CRUD for context entries + OpenClaw query.

GET    /v1/projects/{pid}/context             List all context entries
GET    /v1/projects/{pid}/context/{key}       Get single entry
PUT    /v1/projects/{pid}/context/{key}       Create/update entry
DELETE /v1/projects/{pid}/context/{key}       Delete entry
POST   /v1/projects/{pid}/context/query       Query via OpenClaw
"""

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Project, ProjectContext, Workspace
from app.response import ResponseCode, json_response, success_response

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/projects", tags=["Project Context"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_project_with_access(db: Session, project_id: str, token: str) -> Optional[Project]:
    """Fetch project and verify workspace-level access via token."""
    project = db.execute(
        select(Project).where(Project.id == project_id)
    ).scalar_one_or_none()
    if not project:
        return None
    ws = db.execute(
        select(Workspace).where(Workspace.id == project.workspace_id)
    ).scalar_one_or_none()
    if not ws:
        return None
    if ws.password_hash and token != ws.password_hash:
        return None
    return project


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class ContextUpsertRequest(BaseModel):
    content: str
    content_type: str = "markdown"  # markdown | json | reference
    source_channel_id: Optional[str] = None
    updated_by: Optional[str] = None


class ContextQueryRequest(BaseModel):
    question: str
    include_keys: Optional[list] = None  # specific context keys to include


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/{project_id}/context")
def list_context(
    project_id: str,
    token: str = Header(alias="x-workspace-token", default=""),
    db: Session = Depends(get_db),
):
    project = _get_project_with_access(db, project_id, token)
    if not project:
        return json_response(ResponseCode.NOT_FOUND, "Project not found or unauthorized")

    entries = db.execute(
        select(ProjectContext)
        .where(ProjectContext.project_id == project_id)
        .order_by(ProjectContext.key)
    ).scalars().all()

    return success_response([{
        "id": e.id,
        "key": e.key,
        "content": e.content,
        "contentType": e.content_type,
        "sourceChannelId": e.source_channel_id,
        "updatedBy": e.updated_by,
        "createdAt": e.created_at.isoformat() if e.created_at else None,
        "updatedAt": e.updated_at.isoformat() if e.updated_at else None,
    } for e in entries])


@router.get("/{project_id}/context/{key}")
def get_context_entry(
    project_id: str,
    key: str,
    token: str = Header(alias="x-workspace-token", default=""),
    db: Session = Depends(get_db),
):
    project = _get_project_with_access(db, project_id, token)
    if not project:
        return json_response(ResponseCode.NOT_FOUND, "Project not found or unauthorized")

    entry = db.execute(
        select(ProjectContext).where(
            ProjectContext.project_id == project_id,
            ProjectContext.key == key,
        )
    ).scalar_one_or_none()
    if not entry:
        return json_response(ResponseCode.NOT_FOUND, f"Context key '{key}' not found")

    return success_response({
        "id": entry.id,
        "key": entry.key,
        "content": entry.content,
        "contentType": entry.content_type,
        "sourceChannelId": entry.source_channel_id,
        "updatedBy": entry.updated_by,
        "createdAt": entry.created_at.isoformat() if entry.created_at else None,
        "updatedAt": entry.updated_at.isoformat() if entry.updated_at else None,
    })


@router.put("/{project_id}/context/{key}")
def upsert_context_entry(
    project_id: str,
    key: str,
    body: ContextUpsertRequest,
    token: str = Header(alias="x-workspace-token", default=""),
    db: Session = Depends(get_db),
):
    project = _get_project_with_access(db, project_id, token)
    if not project:
        return json_response(ResponseCode.NOT_FOUND, "Project not found or unauthorized")

    existing = db.execute(
        select(ProjectContext).where(
            ProjectContext.project_id == project_id,
            ProjectContext.key == key,
        )
    ).scalar_one_or_none()

    now = datetime.now(timezone.utc)

    if existing:
        existing.content = body.content
        existing.content_type = body.content_type
        existing.source_channel_id = body.source_channel_id
        existing.updated_by = body.updated_by
        existing.updated_at = now
        db.commit()
        return success_response({"id": existing.id, "key": key, "action": "updated"})
    else:
        entry = ProjectContext(
            project_id=project_id,
            key=key,
            content=body.content,
            content_type=body.content_type,
            source_channel_id=body.source_channel_id,
            updated_by=body.updated_by,
        )
        db.add(entry)
        db.commit()
        db.refresh(entry)
        return success_response({"id": entry.id, "key": key, "action": "created"})


@router.delete("/{project_id}/context/{key}")
def delete_context_entry(
    project_id: str,
    key: str,
    token: str = Header(alias="x-workspace-token", default=""),
    db: Session = Depends(get_db),
):
    project = _get_project_with_access(db, project_id, token)
    if not project:
        return json_response(ResponseCode.NOT_FOUND, "Project not found or unauthorized")

    entry = db.execute(
        select(ProjectContext).where(
            ProjectContext.project_id == project_id,
            ProjectContext.key == key,
        )
    ).scalar_one_or_none()
    if not entry:
        return json_response(ResponseCode.NOT_FOUND, f"Context key '{key}' not found")

    db.delete(entry)
    db.commit()

    return success_response({"deleted": key})


@router.post("/{project_id}/context/query")
async def query_context(
    project_id: str,
    body: ContextQueryRequest,
    token: str = Header(alias="x-workspace-token", default=""),
    db: Session = Depends(get_db),
):
    """Query project context via OpenClaw. Falls back to local search if unavailable."""
    project = _get_project_with_access(db, project_id, token)
    if not project:
        return json_response(ResponseCode.NOT_FOUND, "Project not found or unauthorized")

    # Gather context entries
    query = select(ProjectContext).where(ProjectContext.project_id == project_id)
    if body.include_keys:
        query = query.where(ProjectContext.key.in_(body.include_keys))
    entries = db.execute(query).scalars().all()

    context_docs = [{"key": e.key, "content": e.content, "type": e.content_type} for e in entries]

    # Try OpenClaw
    try:
        from app.services.openclaw import get_openclaw_client
        client = get_openclaw_client()
        answer = await client.query(context_docs, body.question)
        return success_response({
            "answer": answer,
            "source": "openclaw",
            "contextKeysUsed": [e.key for e in entries],
        })
    except Exception as e:
        logger.warning("OpenClaw unavailable, falling back to local context: %s", e)
        # Fallback: simple keyword match in context
        relevant = []
        q_lower = body.question.lower()
        for doc in context_docs:
            if q_lower in doc["content"].lower() or q_lower in doc["key"].lower():
                relevant.append(doc)

        if not relevant:
            relevant = context_docs[:3]  # Return first 3 entries as fallback

        return success_response({
            "answer": "\n\n".join([f"**{d['key']}**:\n{d['content'][:500]}" for d in relevant]),
            "source": "local_fallback",
            "contextKeysUsed": [d["key"] for d in relevant],
        })
