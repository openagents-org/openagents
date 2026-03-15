# -*- coding: utf-8 -*-
"""
ONM Event endpoints — the core of the event-native API.

POST /v1/events    Send any event into the mod pipeline
GET  /v1/events    Poll events (filter by after, target, channel, type)
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, Header, Query
from pydantic import BaseModel
from sqlalchemy import and_, case, cast, func, or_, select, Text
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Channel, ChannelMember, EventRecord, Workspace
from app.pipeline_factory import pipeline
from app.response import ResponseCode, json_response, success_response
from app.routers.network import _verify_workspace_access, _workspace_filter
from openagents.core.onm_events import Event
from openagents.core.onm_mods import EventRejected, PipelineContext

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["Events"])


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class SendEventRequest(BaseModel):
    type: str
    source: str
    target: str
    payload: Optional[dict] = None
    metadata: Optional[dict] = None
    visibility: Optional[str] = "channel"
    network: Optional[str] = None   # workspace ID or slug


# ---------------------------------------------------------------------------
# POST /v1/events — send an event through the pipeline
# ---------------------------------------------------------------------------

def _extract_bearer(authorization: Optional[str]) -> Optional[str]:
    """Extract bearer token from Authorization header."""
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return None


@router.post("/events")
async def send_event(
    body: SendEventRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """
    Send an event into the network pipeline.

    The event flows through mod/auth → mod/workspace → mod/persistence
    before delivery to the target.
    """
    if not body.network:
        return json_response(ResponseCode.BAD_REQUEST, "Missing required field: network")

    # Resolve workspace
    workspace = db.execute(
        select(Workspace).where(_workspace_filter(body.network))
    ).scalar_one_or_none()

    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")

    # Build ONM Event
    event = Event(
        type=body.type,
        source=body.source,
        target=body.target,
        payload=body.payload,
        metadata=body.metadata or {},
        visibility=body.visibility or "channel",
        network=str(workspace.id),
    )

    # Build pipeline context — extra kwargs become context.extra dict
    context = PipelineContext(
        network_id=str(workspace.id),
        agent_address=body.source,
        db=db,
        workspace=workspace,
        token=x_workspace_token,
        bearer_token=_extract_bearer(authorization),
    )

    # Run through pipeline
    try:
        result = await pipeline.process(event, context)
    except EventRejected:
        return json_response(ResponseCode.UNAUTHORIZED, "Event rejected by pipeline")

    db.commit()

    return success_response({
        "id": result.id,
        "type": result.type,
        "source": result.source,
        "target": result.target,
        "timestamp": result.timestamp,
        "metadata": result.metadata,
    })


# ---------------------------------------------------------------------------
# GET /v1/events — poll events
# ---------------------------------------------------------------------------

@router.get("/events")
async def poll_events(
    network: str = Query(..., description="Network (workspace) ID or slug"),
    after: Optional[str] = Query(None, description="Return events after this event ID"),
    before: Optional[str] = Query(None, description="Return events before this event ID"),
    target: Optional[str] = Query(None, description="Filter by target address"),
    channel: Optional[str] = Query(None, description="Filter by channel name"),
    type: Optional[str] = Query(None, description="Filter by event type prefix"),
    conversation: Optional[str] = Query(None, description="Filter to DM conversation between two agents (comma-separated addresses)"),
    search: Optional[str] = Query(None, description="Search message content (case-insensitive)"),
    member: Optional[str] = Query(None, description="Filter to channels where this agent is a member"),
    sort: Optional[str] = Query(None, description="Sort order: 'asc' (default) or 'desc'"),
    limit: int = Query(50, ge=1, le=200, description="Max events to return"),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """
    Poll events from the network.

    Supports filtering by target, channel, type, and cursor-based pagination
    using the `after` parameter (event ID — events are sorted by timestamp).
    """
    # Resolve workspace
    workspace = db.execute(
        select(Workspace).where(_workspace_filter(network))
    ).scalar_one_or_none()

    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")

    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    query = select(EventRecord).where(EventRecord.network_id == workspace.id)

    # Filter events to only channels where the agent is a member
    if member:
        member_channel_names = db.execute(
            select(Channel.name).where(
                Channel.workspace_id == workspace.id,
                Channel.id.in_(
                    select(ChannelMember.channel_id).where(ChannelMember.agent_name == member)
                ),
            )
        ).scalars().all()
        channel_targets = [f"channel/{name}" for name in member_channel_names]
        if channel_targets:
            query = query.where(EventRecord.target.in_(channel_targets))
        else:
            # Agent is not a member of any channel — return empty
            return success_response({"events": [], "has_more": False})

    if conversation:
        parts = [p.strip() for p in conversation.split(",", 1)]
        if len(parts) != 2 or not parts[0] or not parts[1]:
            return json_response(ResponseCode.BAD_REQUEST, "conversation must be two comma-separated addresses")
        a, b = parts
        query = query.where(
            EventRecord.visibility == "direct",
            ~EventRecord.target.startswith("channel/"),
            or_(
                and_(EventRecord.source == a, EventRecord.target == b),
                and_(EventRecord.source == b, EventRecord.target == a),
            ),
        )

    if after:
        cursor_row = db.execute(
            select(EventRecord.timestamp, EventRecord.id).where(EventRecord.id == after)
        ).one_or_none()
        if cursor_row is not None:
            # Use (timestamp, id) tuple to avoid skipping/duplicating events with the same timestamp
            query = query.where(
                or_(
                    EventRecord.timestamp > cursor_row.timestamp,
                    and_(EventRecord.timestamp == cursor_row.timestamp, EventRecord.id > cursor_row.id),
                )
            )

    if before:
        cursor_row = db.execute(
            select(EventRecord.timestamp, EventRecord.id).where(EventRecord.id == before)
        ).one_or_none()
        if cursor_row is not None:
            query = query.where(
                or_(
                    EventRecord.timestamp < cursor_row.timestamp,
                    and_(EventRecord.timestamp == cursor_row.timestamp, EventRecord.id < cursor_row.id),
                )
            )

    if target:
        query = query.where(EventRecord.target == target)

    if channel:
        query = query.where(EventRecord.target == f"channel/{channel}")

    if type:
        query = query.where(EventRecord.type.startswith(type))

    if search:
        # Search within payload JSON for content field (works with both JSONB and JSON)
        query = query.where(
            cast(EventRecord.payload, Text).ilike(f"%{search}%")
        )

    if sort == "desc":
        query = query.order_by(EventRecord.timestamp.desc(), EventRecord.id.desc()).limit(limit + 1)
    else:
        query = query.order_by(EventRecord.timestamp.asc(), EventRecord.id.asc()).limit(limit + 1)
    rows = db.execute(query).scalars().all()

    has_more = len(rows) > limit
    events = rows[:limit]

    return success_response({
        "events": [
            {
                "id": e.id,
                "type": e.type,
                "source": e.source,
                "target": e.target,
                "payload": e.payload,
                "metadata": e.metadata_,
                "timestamp": e.timestamp,
                "visibility": e.visibility,
            }
            for e in events
        ],
        "has_more": has_more,
        "oldest_id": (events[-1].id if sort == "desc" else events[0].id) if events else None,
        "newest_id": (events[0].id if sort == "desc" else events[-1].id) if events else None,
    })


# ---------------------------------------------------------------------------
# GET /v1/events/conversations — discover agent-to-agent DM conversations
# ---------------------------------------------------------------------------

@router.get("/events/conversations")
async def list_conversations(
    network: str = Query(..., description="Network (workspace) ID or slug"),
    agent: Optional[str] = Query(None, description="Filter to conversations involving this agent"),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """
    List active agent-to-agent DM conversations.

    Returns distinct conversation pairs with their latest message,
    ordered by most recent activity.
    """
    workspace = db.execute(
        select(Workspace).where(_workspace_filter(network))
    ).scalar_one_or_none()

    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")

    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    # Build a subquery to find the latest event per conversation pair.
    # Normalize pairs so (A→B) and (B→A) are the same conversation.
    # Use case() instead of func.least/greatest for SQLite compatibility.
    lesser = case(
        (EventRecord.source <= EventRecord.target, EventRecord.source),
        else_=EventRecord.target,
    )
    greater = case(
        (EventRecord.source > EventRecord.target, EventRecord.source),
        else_=EventRecord.target,
    )

    base = (
        select(
            lesser.label("agent_a"),
            greater.label("agent_b"),
            func.max(EventRecord.timestamp).label("last_ts"),
            func.count().label("msg_count"),
        )
        .where(
            EventRecord.network_id == workspace.id,
            EventRecord.visibility == "direct",
            # Exclude channel targets — those are not DMs
            ~EventRecord.target.startswith("channel/"),
        )
    )

    if agent:
        base = base.where(
            or_(EventRecord.source == agent, EventRecord.target == agent)
        )

    base = base.group_by("agent_a", "agent_b").order_by(func.max(EventRecord.timestamp).desc()).limit(limit)

    pairs = db.execute(base).all()

    # For each pair, fetch the actual latest event
    conversations = []
    for row in pairs:
        latest_event = db.execute(
            select(EventRecord)
            .where(
                EventRecord.network_id == workspace.id,
                EventRecord.timestamp == row.last_ts,
                or_(
                    and_(EventRecord.source == row.agent_a, EventRecord.target == row.agent_b),
                    and_(EventRecord.source == row.agent_b, EventRecord.target == row.agent_a),
                ),
            )
            .limit(1)
        ).scalar_one_or_none()

        if latest_event:
            payload = latest_event.payload or {}
            conversations.append({
                "agents": [row.agent_a, row.agent_b],
                "last_message": {
                    "content": payload.get("content", ""),
                    "sender": latest_event.source,
                    "timestamp": latest_event.timestamp,
                },
                "message_count": row.msg_count,
            })

    return success_response({"conversations": conversations})


# ---------------------------------------------------------------------------
# GET /v1/events/latest-per-channel — bulk thread preview endpoint
# ---------------------------------------------------------------------------

@router.get("/events/latest-per-channel")
async def latest_per_channel(
    network: str = Query(..., description="Network (workspace) ID or slug"),
    type: Optional[str] = Query("workspace.message", description="Event type prefix to filter"),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """
    Return the most recent event per channel in a single query.

    Replaces N separate pollEvents calls for thread list previews.
    Uses a SQL window function to efficiently pick the latest event per target.
    """
    workspace = db.execute(
        select(Workspace).where(_workspace_filter(network))
    ).scalar_one_or_none()

    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")

    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    # Window function: ROW_NUMBER() OVER (PARTITION BY target ORDER BY timestamp DESC)
    row_num = func.row_number().over(
        partition_by=EventRecord.target,
        order_by=EventRecord.timestamp.desc(),
    ).label("rn")

    inner = (
        select(EventRecord, row_num)
        .where(
            EventRecord.network_id == workspace.id,
            EventRecord.target.startswith("channel/"),
        )
    )

    if type:
        inner = inner.where(EventRecord.type.startswith(type))

    inner = inner.subquery()

    # Select only the first row per partition
    query = select(inner).where(inner.c.rn == 1)
    rows = db.execute(query).all()

    channels = {}
    for row in rows:
        channel_name = row.target.replace("channel/", "", 1)
        channels[channel_name] = {
            "id": row.id,
            "type": row.type,
            "source": row.source,
            "target": row.target,
            "payload": row.payload,
            "metadata": row.metadata,
            "timestamp": row.timestamp,
            "visibility": row.visibility,
        }

    return success_response({"channels": channels})
