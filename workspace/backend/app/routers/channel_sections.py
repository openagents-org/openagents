# -*- coding: utf-8 -*-
"""
Channel sections management — organize channels within a project.

POST   /v1/projects/{pid}/sections            Create section
GET    /v1/projects/{pid}/sections            List sections
PATCH  /v1/projects/{pid}/sections/{sid}      Update section
DELETE /v1/projects/{pid}/sections/{sid}      Delete section
PATCH  /v1/channels/{cid}/section             Move channel to section
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Channel, ChannelSection, Project, Workspace
from app.response import ResponseCode, json_response, success_response

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Channel Sections"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_project_with_access(db: Session, project_id: str, token: str) -> Optional[Project]:
    """Fetch project and verify workspace-level access."""
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

class SectionCreateRequest(BaseModel):
    name: str
    position: int = 0


class SectionUpdateRequest(BaseModel):
    name: Optional[str] = None
    position: Optional[int] = None
    collapsed: Optional[bool] = None


class ChannelSectionMoveRequest(BaseModel):
    section_id: Optional[str] = None  # null = remove from section
    position: Optional[int] = None


# ---------------------------------------------------------------------------
# Section CRUD
# ---------------------------------------------------------------------------

@router.post("/v1/projects/{project_id}/sections")
def create_section(
    project_id: str,
    body: SectionCreateRequest,
    token: str = Header(alias="x-workspace-token", default=""),
    db: Session = Depends(get_db),
):
    project = _get_project_with_access(db, project_id, token)
    if not project:
        return json_response(ResponseCode.NOT_FOUND, "Project not found or unauthorized")

    section = ChannelSection(
        project_id=project_id,
        name=body.name,
        position=body.position,
        created_by=token[:8] if token else None,
    )
    db.add(section)
    db.commit()
    db.refresh(section)

    return success_response({
        "sectionId": section.id,
        "name": section.name,
        "position": section.position,
    })


@router.get("/v1/projects/{project_id}/sections")
def list_sections(
    project_id: str,
    token: str = Header(alias="x-workspace-token", default=""),
    db: Session = Depends(get_db),
):
    project = _get_project_with_access(db, project_id, token)
    if not project:
        return json_response(ResponseCode.NOT_FOUND, "Project not found or unauthorized")

    sections = db.execute(
        select(ChannelSection)
        .where(ChannelSection.project_id == project_id)
        .order_by(ChannelSection.position)
    ).scalars().all()

    # For each section, count channels
    result = []
    for s in sections:
        channel_count = db.execute(
            select(Channel.id).where(Channel.section_id == s.id, Channel.status == "active")
        ).all()
        result.append({
            "sectionId": s.id,
            "name": s.name,
            "position": s.position,
            "collapsed": s.collapsed,
            "channelCount": len(channel_count),
        })

    return success_response(result)


@router.patch("/v1/projects/{project_id}/sections/{section_id}")
def update_section(
    project_id: str,
    section_id: str,
    body: SectionUpdateRequest,
    token: str = Header(alias="x-workspace-token", default=""),
    db: Session = Depends(get_db),
):
    project = _get_project_with_access(db, project_id, token)
    if not project:
        return json_response(ResponseCode.NOT_FOUND, "Project not found or unauthorized")

    section = db.execute(
        select(ChannelSection).where(
            ChannelSection.id == section_id,
            ChannelSection.project_id == project_id,
        )
    ).scalar_one_or_none()
    if not section:
        return json_response(ResponseCode.NOT_FOUND, "Section not found")

    if body.name is not None:
        section.name = body.name
    if body.position is not None:
        section.position = body.position
    if body.collapsed is not None:
        section.collapsed = body.collapsed

    db.commit()
    return success_response({"sectionId": section.id, "name": section.name})


@router.delete("/v1/projects/{project_id}/sections/{section_id}")
def delete_section(
    project_id: str,
    section_id: str,
    token: str = Header(alias="x-workspace-token", default=""),
    db: Session = Depends(get_db),
):
    project = _get_project_with_access(db, project_id, token)
    if not project:
        return json_response(ResponseCode.NOT_FOUND, "Project not found or unauthorized")

    section = db.execute(
        select(ChannelSection).where(
            ChannelSection.id == section_id,
            ChannelSection.project_id == project_id,
        )
    ).scalar_one_or_none()
    if not section:
        return json_response(ResponseCode.NOT_FOUND, "Section not found")

    # Unassign channels from this section
    channels_in_section = db.execute(
        select(Channel).where(Channel.section_id == section_id)
    ).scalars().all()
    for ch in channels_in_section:
        ch.section_id = None

    db.delete(section)
    db.commit()

    return success_response({"deleted": section_id})


# ---------------------------------------------------------------------------
# Move channel to/from section
# ---------------------------------------------------------------------------

@router.patch("/v1/channels/{channel_id}/section")
def move_channel_to_section(
    channel_id: str,
    body: ChannelSectionMoveRequest,
    token: str = Header(alias="x-workspace-token", default=""),
    db: Session = Depends(get_db),
):
    channel = db.execute(
        select(Channel).where(Channel.id == channel_id)
    ).scalar_one_or_none()
    if not channel:
        return json_response(ResponseCode.NOT_FOUND, "Channel not found")

    # Verify workspace access
    ws = db.execute(
        select(Workspace).where(Workspace.id == channel.workspace_id)
    ).scalar_one_or_none()
    if ws and ws.password_hash and token != ws.password_hash:
        return json_response(ResponseCode.UNAUTHORIZED, "Unauthorized")

    channel.section_id = body.section_id
    if body.position is not None:
        channel.position = body.position

    db.commit()

    return success_response({
        "channelId": channel_id,
        "sectionId": channel.section_id,
        "position": channel.position,
    })
