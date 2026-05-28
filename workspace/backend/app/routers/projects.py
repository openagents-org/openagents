# -*- coding: utf-8 -*-
"""
Project management endpoints — CRUD for projects and project members.

POST   /v1/workspaces/{wid}/projects              Create a project
GET    /v1/workspaces/{wid}/projects              List projects
GET    /v1/workspaces/{wid}/projects/{pid}        Get project details
PATCH  /v1/workspaces/{wid}/projects/{pid}        Update project
DELETE /v1/workspaces/{wid}/projects/{pid}        Archive/delete project
POST   /v1/workspaces/{wid}/projects/{pid}/members     Add member
DELETE /v1/workspaces/{wid}/projects/{pid}/members/{email}  Remove member
"""

import logging
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.models import (
    Channel,
    ChannelSection,
    Project,
    ProjectMember,
    Workspace,
)
from app.response import ResponseCode, json_response, success_response

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/workspaces", tags=["Projects"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_workspace(db: Session, workspace_id: str, token: str) -> Optional[Workspace]:
    """Fetch workspace and verify token access."""
    ws = db.execute(
        select(Workspace).where(Workspace.id == workspace_id)
    ).scalar_one_or_none()
    if not ws:
        return None
    if ws.password_hash and token != ws.password_hash:
        return None
    return ws


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class ProjectCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None
    context_bot_name: Optional[str] = "project-context-bot"
    settings: Optional[dict] = None


class ProjectUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    context_bot_name: Optional[str] = None
    settings: Optional[dict] = None


class ProjectMemberAddRequest(BaseModel):
    user_email: str
    role: str = "editor"  # owner | editor | viewer


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/{workspace_id}/projects")
def create_project(
    workspace_id: str,
    body: ProjectCreateRequest,
    token: str = Header(alias="x-workspace-token", default=""),
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    ws = _get_workspace(db, workspace_id, token)
    if not ws:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found or unauthorized")

    # Check for duplicate name
    existing = db.execute(
        select(Project).where(
            Project.workspace_id == workspace_id,
            Project.name == body.name,
        )
    ).scalar_one_or_none()
    if existing:
        return json_response(ResponseCode.CONFLICT, f"Project '{body.name}' already exists")

    project = Project(
        workspace_id=workspace_id,
        name=body.name,
        description=body.description,
        context_bot_name=body.context_bot_name or "project-context-bot",
        settings=body.settings or {},
        created_by=token[:8] if token else None,
    )
    db.add(project)
    db.commit()
    db.refresh(project)

    return success_response({
        "projectId": project.id,
        "name": project.name,
        "description": project.description,
        "status": project.status,
        "contextBotName": project.context_bot_name,
        "settings": project.settings,
        "createdAt": project.created_at.isoformat() if project.created_at else None,
    })


@router.get("/{workspace_id}/projects")
def list_projects(
    workspace_id: str,
    status: Optional[str] = Query(default=None),
    token: str = Header(alias="x-workspace-token", default=""),
    db: Session = Depends(get_db),
):
    ws = _get_workspace(db, workspace_id, token)
    if not ws:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found or unauthorized")

    query = select(Project).where(Project.workspace_id == workspace_id)
    if status:
        query = query.where(Project.status == status)
    query = query.order_by(Project.created_at.desc())

    projects = db.execute(query).scalars().all()

    result = []
    for p in projects:
        # Count channels per project
        channel_count = db.execute(
            select(Channel.id).where(Channel.project_id == p.id, Channel.status == "active")
        ).all()
        result.append({
            "projectId": p.id,
            "name": p.name,
            "description": p.description,
            "status": p.status,
            "contextBotName": p.context_bot_name,
            "channelCount": len(channel_count),
            "members": [{"email": m.user_email, "role": m.role} for m in (p.members or [])],
            "createdAt": p.created_at.isoformat() if p.created_at else None,
        })

    return success_response(result)


@router.get("/{workspace_id}/projects/{project_id}")
def get_project(
    workspace_id: str,
    project_id: str,
    token: str = Header(alias="x-workspace-token", default=""),
    db: Session = Depends(get_db),
):
    ws = _get_workspace(db, workspace_id, token)
    if not ws:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found or unauthorized")

    project = db.execute(
        select(Project).where(Project.id == project_id, Project.workspace_id == workspace_id)
    ).scalar_one_or_none()
    if not project:
        return json_response(ResponseCode.NOT_FOUND, "Project not found")

    # Get channels
    channels = db.execute(
        select(Channel).where(Channel.project_id == project_id, Channel.status != "deleted")
        .order_by(Channel.position, Channel.created_at)
    ).scalars().all()

    # Get sections
    sections = db.execute(
        select(ChannelSection).where(ChannelSection.project_id == project_id)
        .order_by(ChannelSection.position)
    ).scalars().all()

    return success_response({
        "projectId": project.id,
        "name": project.name,
        "description": project.description,
        "status": project.status,
        "contextBotName": project.context_bot_name,
        "settings": project.settings,
        "members": [{"email": m.user_email, "role": m.role, "joinedAt": m.joined_at.isoformat() if m.joined_at else None} for m in (project.members or [])],
        "channels": [{
            "channelId": c.id,
            "name": c.name,
            "title": c.title,
            "channelType": c.channel_type,
            "sectionId": c.section_id,
            "position": c.position,
            "starred": c.starred,
            "status": c.status,
            "agentRoles": c.agent_roles,
        } for c in channels],
        "sections": [{
            "sectionId": s.id,
            "name": s.name,
            "position": s.position,
            "collapsed": s.collapsed,
        } for s in sections],
        "createdAt": project.created_at.isoformat() if project.created_at else None,
        "updatedAt": project.updated_at.isoformat() if project.updated_at else None,
    })


@router.patch("/{workspace_id}/projects/{project_id}")
def update_project(
    workspace_id: str,
    project_id: str,
    body: ProjectUpdateRequest,
    token: str = Header(alias="x-workspace-token", default=""),
    db: Session = Depends(get_db),
):
    ws = _get_workspace(db, workspace_id, token)
    if not ws:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found or unauthorized")

    project = db.execute(
        select(Project).where(Project.id == project_id, Project.workspace_id == workspace_id)
    ).scalar_one_or_none()
    if not project:
        return json_response(ResponseCode.NOT_FOUND, "Project not found")

    if body.name is not None:
        project.name = body.name
    if body.description is not None:
        project.description = body.description
    if body.status is not None:
        project.status = body.status
    if body.context_bot_name is not None:
        project.context_bot_name = body.context_bot_name
    if body.settings is not None:
        project.settings = body.settings
    project.updated_at = datetime.now(timezone.utc)

    db.commit()
    return success_response({"projectId": project.id, "status": project.status})


@router.delete("/{workspace_id}/projects/{project_id}")
def delete_project(
    workspace_id: str,
    project_id: str,
    token: str = Header(alias="x-workspace-token", default=""),
    db: Session = Depends(get_db),
):
    ws = _get_workspace(db, workspace_id, token)
    if not ws:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found or unauthorized")

    project = db.execute(
        select(Project).where(Project.id == project_id, Project.workspace_id == workspace_id)
    ).scalar_one_or_none()
    if not project:
        return json_response(ResponseCode.NOT_FOUND, "Project not found")

    project.status = "archived"
    project.updated_at = datetime.now(timezone.utc)
    db.commit()

    return success_response({"projectId": project.id, "status": "archived"})


# ---------------------------------------------------------------------------
# Project Members
# ---------------------------------------------------------------------------

@router.post("/{workspace_id}/projects/{project_id}/members")
def add_project_member(
    workspace_id: str,
    project_id: str,
    body: ProjectMemberAddRequest,
    token: str = Header(alias="x-workspace-token", default=""),
    db: Session = Depends(get_db),
):
    ws = _get_workspace(db, workspace_id, token)
    if not ws:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found or unauthorized")

    project = db.execute(
        select(Project).where(Project.id == project_id, Project.workspace_id == workspace_id)
    ).scalar_one_or_none()
    if not project:
        return json_response(ResponseCode.NOT_FOUND, "Project not found")

    # Check if already a member
    existing = db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_email == body.user_email.lower(),
        )
    ).scalar_one_or_none()
    if existing:
        return json_response(ResponseCode.CONFLICT, "User is already a member of this project")

    member = ProjectMember(
        project_id=project_id,
        user_email=body.user_email.lower(),
        role=body.role,
    )
    db.add(member)
    db.commit()

    return success_response({"email": member.user_email, "role": member.role})


@router.delete("/{workspace_id}/projects/{project_id}/members/{email}")
def remove_project_member(
    workspace_id: str,
    project_id: str,
    email: str,
    token: str = Header(alias="x-workspace-token", default=""),
    db: Session = Depends(get_db),
):
    ws = _get_workspace(db, workspace_id, token)
    if not ws:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found or unauthorized")

    member = db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_email == email.lower(),
        )
    ).scalar_one_or_none()
    if not member:
        return json_response(ResponseCode.NOT_FOUND, "Member not found")

    db.delete(member)
    db.commit()

    return success_response({"removed": email.lower()})
