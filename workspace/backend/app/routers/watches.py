# -*- coding: utf-8 -*-
"""
Agent watch endpoints — bounded subscriptions to other threads / agents.

POST   /v1/watches          Create (or refresh) a watch
GET    /v1/watches          List active watches in scope
DELETE /v1/watches/{id}     Stop a watch

Used by the built-in assistant's ``watch_thread`` / ``watch_agent`` /
``stop_watch`` tools (through the in-process workspace API), and open to any
agent holding the workspace token. See ``services/watches`` for semantics.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, Path, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AgentWatch, Channel, Workspace, WorkspaceMember
from app.response import ResponseCode, json_response, success_response
from app.routers.network import _resolve_workspace, _verify_workspace_access
from app.services import watches as svc

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["Watches"])


class CreateWatchRequest(BaseModel):
    network: str
    source: str                                   # "openagents:<watcher>"
    channel: str                                  # origin thread (where to wake the watcher)
    subject_kind: str = Field(pattern=r"^(thread|agent)$")
    subject: str = Field(min_length=1)            # thread id or bare agent name
    note: Optional[str] = None
    minutes: Optional[int] = None                 # default 120, max 1440
    max_fires: Optional[int] = None               # default 10, max 50


def _bare(name: str) -> str:
    return (name or "").strip().removeprefix("openagents:")


@router.post("/watches")
def create_watch(
    body: CreateWatchRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace = _resolve_workspace(db, body.network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    if not body.source.startswith("openagents:") or not _bare(body.source):
        return json_response(ResponseCode.BAD_REQUEST, "source must be an agent address (openagents:<name>)")
    watcher = _bare(body.source)
    origin = body.channel.strip().removeprefix("channel/")
    subject = body.subject.strip().removeprefix("channel/").removeprefix("openagents:")
    if not origin:
        return json_response(ResponseCode.BAD_REQUEST, "channel (origin thread) is required")
    ws_id = str(workspace.id)

    if body.subject_kind == "thread":
        if subject == origin:
            return json_response(ResponseCode.BAD_REQUEST, "You already see your own thread — watch a different one")
        exists = db.execute(
            select(Channel.id).where(Channel.workspace_id == ws_id, Channel.name == subject)
        ).scalar_one_or_none()
        if exists is None:
            return json_response(ResponseCode.NOT_FOUND, f"Thread not found: {subject}")
    else:
        if subject == watcher:
            return json_response(ResponseCode.BAD_REQUEST, "An agent cannot watch itself")
        exists = db.execute(
            select(WorkspaceMember.agent_name).where(
                WorkspaceMember.workspace_id == ws_id, WorkspaceMember.agent_name == subject,
            )
        ).scalar_one_or_none()
        if exists is None:
            return json_response(ResponseCode.NOT_FOUND, f"Agent not found in this workspace: {subject}")

    minutes = body.minutes if body.minutes is not None else svc.DEFAULT_MINUTES
    minutes = max(1, min(int(minutes), svc.MAX_MINUTES))
    max_fires = body.max_fires if body.max_fires is not None else svc.DEFAULT_MAX_FIRES
    max_fires = max(1, min(int(max_fires), svc.MAX_MAX_FIRES))
    note = (body.note or "").strip()[:500] or None
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=minutes)

    # Same watcher, origin and subject → refresh in place (idempotent re-arm).
    existing = db.execute(
        select(AgentWatch).where(
            AgentWatch.workspace_id == ws_id,
            AgentWatch.watcher_agent == watcher,
            AgentWatch.origin_channel == origin,
            AgentWatch.subject_kind == body.subject_kind,
            AgentWatch.subject == subject,
            AgentWatch.status == "active",
        )
    ).scalars().first()
    if existing is not None:
        existing.expires_at = expires_at
        existing.max_fires = max_fires
        existing.fires = 0
        if note:
            existing.note = note
        db.commit()
        return success_response({"watch": svc.serialize(existing), "refreshed": True})

    active = db.execute(
        select(AgentWatch.id).where(
            AgentWatch.workspace_id == ws_id,
            AgentWatch.watcher_agent == watcher,
            AgentWatch.status == "active",
        )
    ).scalars().all()
    if len(active) >= svc.MAX_ACTIVE_PER_WATCHER:
        return json_response(
            ResponseCode.BAD_REQUEST,
            f"Too many active watches ({svc.MAX_ACTIVE_PER_WATCHER}); stop one first",
        )

    watch = AgentWatch(
        workspace_id=ws_id,
        watcher_agent=watcher,
        origin_channel=origin,
        subject_kind=body.subject_kind,
        subject=subject,
        note=note,
        expires_at=expires_at,
        max_fires=max_fires,
        fires=0,
        status="active",
    )
    db.add(watch)
    db.commit()
    return success_response({"watch": svc.serialize(watch), "refreshed": False})


@router.get("/watches")
def list_watches(
    network: str = Query(...),
    source: Optional[str] = Query(None),
    channel: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace = _resolve_workspace(db, network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    query = select(AgentWatch).where(
        AgentWatch.workspace_id == str(workspace.id),
        AgentWatch.status == "active",
    )
    if source:
        query = query.where(AgentWatch.watcher_agent == _bare(source))
    if channel:
        query = query.where(AgentWatch.origin_channel == channel.removeprefix("channel/"))
    rows = db.execute(query.order_by(AgentWatch.expires_at.asc())).scalars().all()
    return success_response({"watches": [svc.serialize(w) for w in rows]})


@router.delete("/watches/{watch_id}")
def stop_watch(
    watch_id: str = Path(...),
    network: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    watch = db.get(AgentWatch, watch_id)
    if watch is None:
        return json_response(ResponseCode.NOT_FOUND, "Watch not found")
    workspace = db.get(Workspace, watch.workspace_id)
    if workspace is None:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")
    if watch.status != "active":
        return json_response(ResponseCode.BAD_REQUEST, f"Watch is already {watch.status}")
    watch.status = "stopped"
    db.commit()
    return success_response({"id": watch.id, "status": "stopped"})
