# -*- coding: utf-8 -*-
"""Work briefs (v1.1 M5) — the persistent shared brief per thread.

GET /v1/channels/{channel}/brief?network=   read the brief (empty when unset)
PUT /v1/channels/{channel}/brief            partial upsert (only provided keys)

The brief is the one place a thread's state lives outside the transcript:
objective, who owns the next step, the latest result, open questions and the
next step. Agents keep it current (``workspace_update_brief``); people can
edit it inline. No event is emitted on edit — the brief is a summary, not a
message.

Who may write: a machine credential (agents/daemons), a workspace admin or
owner, or a human participant of the thread (``channel_human_members``).
Who may read: anyone who can view the thread (see ``services/visibility``).

Registered in app/main.py up front so milestone branches never touch main.py.
"""

from __future__ import annotations

import logging
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, Header, Path, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.access import resolve_user_role, role_at_least
from app.database import get_db
from app.models import Channel, ChannelBrief, ChannelHumanMember, Workspace
from app.response import ResponseCode, json_response, success_response
from app.routers.network import _resolve_workspace, _verify_workspace_access
from app.services.visibility import Viewer, can_view_channel_name, resolve_viewer

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["briefs"])

MAX_TEXT = 4000
MAX_QUESTIONS = 20
MAX_QUESTION_LEN = 500

_TEXT_FIELDS = ("objective", "owner", "latest_result", "next_step")


class BriefUpdate(BaseModel):
    """Partial update — a key that is absent is left untouched; an explicit
    ``null`` / empty string clears it."""
    network: str
    objective: Optional[str] = None
    owner: Optional[str] = None
    latest_result: Optional[str] = None
    open_questions: Optional[List[str]] = None
    next_step: Optional[str] = None
    source: Optional[str] = None            # "openagents:<agent>" for machine writers


def _norm_channel(name: str) -> str:
    return (name or "").strip().removeprefix("channel/")


def _load_channel(db: Session, workspace: Workspace, channel_name: str) -> Optional[Channel]:
    return db.execute(
        select(Channel).where(Channel.workspace_id == workspace.id, Channel.name == channel_name)
    ).scalar_one_or_none()


def _is_participant(db: Session, channel: Optional[Channel], email: Optional[str]) -> bool:
    if channel is None or not email:
        return False
    row = db.execute(
        select(ChannelHumanMember.user_email).where(
            ChannelHumanMember.channel_id == channel.id,
            ChannelHumanMember.user_email == email,
        )
    ).first()
    return row is not None


def _can_edit(db: Session, workspace: Workspace, viewer: Viewer, channel: Optional[Channel],
              authorization: Optional[str]) -> bool:
    if viewer.machine:
        return True
    if not viewer.email:
        return False
    if role_at_least(resolve_user_role(db, workspace, authorization), "admin"):
        return True
    return _is_participant(db, channel, viewer.email)


def serialize_brief(channel_name: str, row: Optional[ChannelBrief], *,
                    director_email: Optional[str] = None, can_edit: bool = False) -> dict:
    questions: Any = (row.open_questions if row is not None else None) or []
    if not isinstance(questions, list):
        questions = []
    return {
        "channel": channel_name,
        "objective": row.objective if row else None,
        "owner": row.owner if row else None,
        "latest_result": row.latest_result if row else None,
        "open_questions": [str(q) for q in questions],
        "next_step": row.next_step if row else None,
        "updated_by": row.updated_by if row else None,
        "updated_at": row.updated_at.isoformat() if (row and row.updated_at) else None,
        # Extras the thread UI needs alongside the brief (not part of the
        # brief itself): who directs the thread and whether the caller may edit.
        "director_email": director_email,
        "can_edit": can_edit,
    }


def _clean_text(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text[:MAX_TEXT] if text else None


def _clean_questions(items: List[str]) -> List[str]:
    out: List[str] = []
    for q in items:
        if not isinstance(q, str):
            continue
        q = q.strip()
        if q:
            out.append(q[:MAX_QUESTION_LEN])
        if len(out) >= MAX_QUESTIONS:
            break
    return out


@router.get("/channels/{channel}/brief")
def get_brief(
    channel: str = Path(...),
    network: str = Query(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace = _resolve_workspace(db, network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Unauthorized")

    channel_name = _norm_channel(channel)
    viewer = resolve_viewer(db, workspace, x_workspace_token, authorization)
    if viewer.is_human and not can_view_channel_name(db, str(workspace.id), viewer, channel_name):
        return json_response(ResponseCode.FORBIDDEN, "No access to this thread")

    ch = _load_channel(db, workspace, channel_name)
    row = db.execute(
        select(ChannelBrief).where(
            ChannelBrief.workspace_id == str(workspace.id),
            ChannelBrief.channel_name == channel_name,
        )
    ).scalar_one_or_none()
    return success_response(serialize_brief(
        channel_name, row,
        director_email=(ch.director_email if ch is not None else None),
        can_edit=_can_edit(db, workspace, viewer, ch, authorization),
    ))


@router.put("/channels/{channel}/brief")
def put_brief(
    body: BriefUpdate,
    channel: str = Path(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace = _resolve_workspace(db, body.network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Unauthorized")

    channel_name = _norm_channel(channel)
    if not channel_name:
        return json_response(ResponseCode.BAD_REQUEST, "channel is required")
    viewer = resolve_viewer(db, workspace, x_workspace_token, authorization)
    if viewer.is_human and not can_view_channel_name(db, str(workspace.id), viewer, channel_name):
        return json_response(ResponseCode.FORBIDDEN, "No access to this thread")

    ch = _load_channel(db, workspace, channel_name)
    if not _can_edit(db, workspace, viewer, ch, authorization):
        return json_response(ResponseCode.FORBIDDEN, "Only participants, admins, or agents can edit the brief")

    provided = body.model_dump(exclude_unset=True)
    provided.pop("network", None)
    provided.pop("source", None)
    if not provided:
        return json_response(ResponseCode.BAD_REQUEST, "Nothing to update")

    if viewer.machine:
        updated_by = (body.source or "").strip() or "openagents:unknown"
    else:
        updated_by = f"human:{viewer.email}"

    row = db.execute(
        select(ChannelBrief).where(
            ChannelBrief.workspace_id == str(workspace.id),
            ChannelBrief.channel_name == channel_name,
        )
    ).scalar_one_or_none()
    if row is None:
        row = ChannelBrief(workspace_id=str(workspace.id), channel_name=channel_name)
        db.add(row)

    for key in _TEXT_FIELDS:
        if key in provided:
            setattr(row, key, _clean_text(provided[key]))
    if "open_questions" in provided:
        qs = provided["open_questions"]
        row.open_questions = _clean_questions(qs) if isinstance(qs, list) else []
    row.updated_by = updated_by
    db.commit()
    db.refresh(row)

    logger.info("brief: %s updated %s/%s (%s)", updated_by, workspace.id, channel_name, ", ".join(sorted(provided)))
    return success_response(serialize_brief(
        channel_name, row,
        director_email=(ch.director_email if ch is not None else None),
        can_edit=True,
    ))
