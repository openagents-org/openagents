# -*- coding: utf-8 -*-
"""
Routine endpoints — recurring scheduled tasks.

POST   /v1/routines          Create a routine
GET    /v1/routines          List routines in scope
DELETE /v1/routines/{id}     Cancel a routine
"""

import logging
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, Path, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.mods.workspace_mod import emit_agent_bootstrap_event
from app.models import Channel, ChannelMember, RoutineRecord, Workspace, WorkspaceMember
from app.response import ResponseCode, json_response, success_response
from app.routers.network import _resolve_workspace, _verify_workspace_access

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["Routines"])


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class CreateRoutineRequest(BaseModel):
    name: str
    message: str
    context: Optional[str] = None
    conversation_history: Optional[str] = None
    # Daily mode (hour + minute, optional days). interval_minutes is the other mode.
    hour: Optional[int] = None
    minute: Optional[int] = None
    days: Optional[List[int]] = None
    interval_minutes: Optional[int] = None
    network: str
    source: str
    channel: Optional[str] = None
    thread_id: Optional[str] = None


# Minute-interval mode bounds (1 minute floor matches scheduler tick;
# 1-day ceiling — for anything longer, use daily hour/minute mode).
MIN_INTERVAL_MINUTES = 1
MAX_INTERVAL_MINUTES = 1440


# ---------------------------------------------------------------------------
# Routine channel — one per agent, per workspace.
# Routines from any thread always fire into the agent's routine channel.
# ---------------------------------------------------------------------------

ROUTINE_CHANNEL_PREFIX = "routines:"


def _normalize_agent_name(source: str) -> str:
    """Strip the `openagents:` prefix if present; routines store the bare name."""
    if source and source.startswith("openagents:"):
        return source[len("openagents:"):]
    return source or ""


def _routine_channel_name(agent: str) -> str:
    return f"{ROUTINE_CHANNEL_PREFIX}{agent}"


def _get_or_create_routine_channel(db: Session, workspace: Workspace, agent: str) -> Channel:
    """Find-or-create the per-agent routine channel for this workspace.

    Single channel per agent — every routine the agent owns fires into
    this one queue. master_agent is set so the existing routing /
    discovery code treats this as the agent's own thread. (The previous
    per-routine `routine:<id>` design fragmented activity across many
    threads; reverted because the product surface — Inbox tab — is
    organized per-agent.)
    """
    name = _routine_channel_name(agent)
    existing = db.execute(
        select(Channel).where(
            Channel.workspace_id == str(workspace.id),
            Channel.name == name,
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    channel = Channel(
        workspace_id=str(workspace.id),
        name=name,
        title=agent,
        master_agent=agent,
        created_by="system:routine",
        status="active",
    )
    db.add(channel)
    db.flush()
    db.add(ChannelMember(channel_id=channel.id, agent_name=agent))
    emit_agent_bootstrap_event(
        db,
        workspace.id,
        channel.name,
        agent,
        timestamp=int(datetime.now(timezone.utc).timestamp() * 1000),
        reason="routine_create",
    )
    return channel


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _compute_next_fires_at(
    hour: Optional[int],
    minute: Optional[int],
    days: Optional[List[int]],
    interval_minutes: Optional[int] = None,
) -> datetime:
    """Compute the next UTC datetime that matches the given schedule."""
    from datetime import timedelta

    now = datetime.now(timezone.utc)

    if interval_minutes is not None:
        return now + timedelta(minutes=interval_minutes)

    today = now.replace(hour=hour, minute=minute, second=0, microsecond=0)

    if days is None:
        if today > now:
            return today
        return today + timedelta(days=1)

    current_weekday = now.weekday()  # 0=Mon
    for offset in range(8):
        candidate = today + timedelta(days=offset)
        wd = (current_weekday + offset) % 7
        if wd in days:
            if offset == 0 and candidate <= now:
                continue
            return candidate

    return today + timedelta(days=1)


def _describe_schedule(
    hour: Optional[int],
    minute: Optional[int],
    days: Optional[List[int]],
    interval_minutes: Optional[int] = None,
) -> str:
    """Human-readable schedule description for the LLM prompt."""
    if interval_minutes is not None:
        if interval_minutes >= 60:
            h = interval_minutes // 60
            m = interval_minutes % 60
            return f"Every {h}h{f' {m}m' if m else ''}"
        return f"Every {interval_minutes} minutes"
    time_str = f"{hour:02d}:{minute:02d} UTC"
    if days is None:
        return f"Every day at {time_str}"
    day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    day_labels = [day_names[d] for d in sorted(days) if 0 <= d <= 6]
    return f"{', '.join(day_labels)} at {time_str}"


MAX_CONVERSATION_CHARS = 8000

def _generate_routine_context_sync(
    name: str, message: str, schedule_desc: str,
    conversation_history: Optional[str] = None,
) -> str:
    """Call the LLM to expand a brief task description into comprehensive routine context."""
    from app.mods.workspace_mod import _get_llm_client, _get_router_api_key, _get_router_model

    fallback = f"Routine: {name}\n\nTask: {message}\nSchedule: {schedule_desc}"

    if not _get_router_api_key():
        logger.warning("No LLM API key for routine context generation, using fallback")
        return fallback

    conversation_block = ""
    if conversation_history:
        truncated = conversation_history[:MAX_CONVERSATION_CHARS]
        conversation_block = (
            "\n\nRecent conversation history (use this to understand the full context "
            "behind the task — what was discussed, any specific details, URLs, tools, "
            "or preferences mentioned):\n"
            "---\n"
            f"{truncated}\n"
            "---\n"
        )

    prompt = (
        "You are helping set up a recurring automated task for an AI agent in a workspace. "
        "Based on the task description and conversation context below, write comprehensive "
        "instructions that the agent will receive each time this routine fires. The instructions "
        "should be clear, specific, and actionable. Incorporate relevant details from the "
        "conversation history if available.\n\n"
        f"Task name: {name}\n"
        f"Task description: {message}\n"
        f"Schedule: {schedule_desc}"
        f"{conversation_block}\n"
        "Write the routine context (2-4 paragraphs). Be specific about what the agent should do, "
        "what to check, and what format to use for any output. "
        "Do not include any preamble — just the context instructions."
    )

    try:
        client, provider = _get_llm_client()
        model = _get_router_model()

        if provider == "openai":
            resp = client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=1024,
            )
            return resp.choices[0].message.content.strip()
        else:
            resp = client.messages.create(
                model=model,
                max_tokens=1024,
                messages=[{"role": "user", "content": prompt}],
            )
            return resp.content[0].text.strip()
    except Exception as exc:
        logger.warning("LLM context generation failed (%s), using fallback", exc)
        return fallback


def _serialize_routine(r: RoutineRecord) -> dict:
    return {
        "id": r.id,
        "name": r.name,
        "message": r.message,
        "context": r.context,
        "schedule_hour": r.schedule_hour,
        "schedule_minute": r.schedule_minute,
        "schedule_days": r.schedule_days,
        "schedule_interval_minutes": r.schedule_interval_minutes,
        "timezone": r.timezone,
        "next_fires_at": r.next_fires_at.isoformat() if r.next_fires_at else None,
        "last_fired_at": r.last_fired_at.isoformat() if r.last_fired_at else None,
        "status": r.status,
        "created_by": r.created_by,
        "channel_name": r.channel_name,
        "thread_id": r.thread_id,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


# ---------------------------------------------------------------------------
# POST /v1/routines
# ---------------------------------------------------------------------------

@router.post("/routines")
async def create_routine(
    body: CreateRoutineRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Create a recurring scheduled routine."""
    workspace = _resolve_workspace(db, body.network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    is_interval = body.interval_minutes is not None
    is_daily = body.hour is not None or body.minute is not None
    if is_interval and is_daily:
        return json_response(
            ResponseCode.BAD_REQUEST,
            "Specify either interval_minutes OR hour/minute, not both",
        )
    if not is_interval and not is_daily:
        return json_response(
            ResponseCode.BAD_REQUEST,
            "Specify either interval_minutes OR hour/minute",
        )

    if is_interval:
        if not (MIN_INTERVAL_MINUTES <= body.interval_minutes <= MAX_INTERVAL_MINUTES):
            return json_response(
                ResponseCode.BAD_REQUEST,
                f"interval_minutes must be {MIN_INTERVAL_MINUTES}-{MAX_INTERVAL_MINUTES}",
            )
        if body.days is not None:
            return json_response(
                ResponseCode.BAD_REQUEST,
                "days is not allowed in interval mode",
            )
    else:
        if body.hour is None or body.minute is None:
            return json_response(ResponseCode.BAD_REQUEST, "hour and minute are both required in daily mode")
        if not (0 <= body.hour <= 23):
            return json_response(ResponseCode.BAD_REQUEST, "hour must be 0-23")
        if not (0 <= body.minute <= 59):
            return json_response(ResponseCode.BAD_REQUEST, "minute must be 0-59")
        if body.days is not None:
            if not body.days or not all(0 <= d <= 6 for d in body.days):
                return json_response(ResponseCode.BAD_REQUEST, "days must be array of 0-6 (Mon=0, Sun=6)")

    # The caller's `channel` is intentionally ignored — every routine lives
    # in the target agent's dedicated routine channel. This gives each
    # (workspace, agent) pair a single canonical job queue and keeps regular
    # conversation threads from being spammed by scheduled output.
    target_agent = _normalize_agent_name(body.source)
    if not target_agent:
        return json_response(ResponseCode.BAD_REQUEST, "source is required")

    # Identity check: `source` must reference an agent that is actually a
    # member of this workspace. Routines fire under the source's identity
    # and post into that agent's dedicated channel — accepting arbitrary
    # source values would let any caller inject scheduled messages
    # attributed to anyone they invented. Membership is the strongest
    # identity guarantee available with the shared workspace-token auth
    # model; per-agent auth is tracked separately.
    is_member = db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.agent_name == target_agent,
        )
    ).scalar_one_or_none()
    if not is_member:
        return json_response(
            ResponseCode.FORBIDDEN,
            f"source '{body.source}' is not a member of this workspace",
        )

    # Auto-generate context via LLM if not provided (UI-created routines)
    if not body.context:
        import asyncio
        schedule_desc = _describe_schedule(body.hour, body.minute, body.days, body.interval_minutes)
        body.context = await asyncio.to_thread(
            _generate_routine_context_sync, body.name, body.message, schedule_desc,
            body.conversation_history,
        )

    import uuid as _uuid_mod
    routine_id = str(_uuid_mod.uuid4())
    routine_channel = _get_or_create_routine_channel(db, workspace, target_agent)
    next_fire = _compute_next_fires_at(body.hour, body.minute, body.days, body.interval_minutes)

    routine = RoutineRecord(
        id=routine_id,
        workspace_id=str(workspace.id),
        channel_name=routine_channel.name,
        thread_id=body.thread_id,
        created_by=target_agent,
        name=body.name,
        message=body.message,
        context=body.context,
        schedule_hour=body.hour,
        schedule_minute=body.minute,
        schedule_days=body.days,
        schedule_interval_minutes=body.interval_minutes,
        next_fires_at=next_fire,
    )
    db.add(routine)
    db.commit()

    return success_response(_serialize_routine(routine))


# ---------------------------------------------------------------------------
# GET /v1/routines
# ---------------------------------------------------------------------------

@router.get("/routines")
async def list_routines(
    network: str = Query(...),
    channel: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """List routines in scope."""
    workspace = _resolve_workspace(db, network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    query = select(RoutineRecord).where(
        RoutineRecord.workspace_id == str(workspace.id),
    )
    if status:
        query = query.where(RoutineRecord.status == status)
    else:
        query = query.where(RoutineRecord.status == "active")
    if channel:
        query = query.where(RoutineRecord.channel_name == channel)

    query = query.order_by(RoutineRecord.next_fires_at.asc())
    rows = db.execute(query).scalars().all()

    return success_response({"routines": [_serialize_routine(r) for r in rows]})


# ---------------------------------------------------------------------------
# DELETE /v1/routines/{routine_id}
# ---------------------------------------------------------------------------

@router.delete("/routines/{routine_id}")
async def cancel_routine(
    routine_id: str = Path(...),
    network: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Cancel an active routine."""
    routine = db.execute(
        select(RoutineRecord).where(RoutineRecord.id == routine_id)
    ).scalar_one_or_none()
    if not routine:
        return json_response(ResponseCode.NOT_FOUND, "Routine not found")

    workspace = db.execute(
        select(Workspace).where(Workspace.id == routine.workspace_id)
    ).scalar_one_or_none()
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    if routine.status != "active":
        return json_response(ResponseCode.BAD_REQUEST, f"Routine is already {routine.status}")

    routine.status = "cancelled"
    db.commit()

    return success_response({"id": routine.id, "status": "cancelled"})
