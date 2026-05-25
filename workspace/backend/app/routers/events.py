# -*- coding: utf-8 -*-
"""
ONM Event endpoints — the core of the event-native API.

POST /v1/events    Send any event into the mod pipeline
GET  /v1/events    Poll events (filter by after, target, channel, type)
"""

import hashlib
import logging
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Header, Query
from pydantic import BaseModel
from sqlalchemy import and_, case, cast, func, or_, select, Text
from sqlalchemy.orm import Session

from app import cache
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
    background_tasks: BackgroundTasks,
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
    except EventRejected as exc:
        # Surface the reason so clients can roll back optimistic UI on
        # specific failures (e.g. routine_channel_locked,
        # channel_join_forbidden). 403 distinguishes "you can't do this"
        # from generic auth failures.
        reason = exc.reason or "rejected"
        code = ResponseCode.FORBIDDEN if "forbidden" in reason or "locked" in reason \
            else ResponseCode.UNAUTHORIZED
        return json_response(code, reason)

    # Session revocation: another client has since joined as this agent.
    # Return a clear error so the stale client can stop its adapter.
    if result.metadata.get("session_error") == "session_revoked":
        db.rollback()
        return json_response(
            ResponseCode.UNAUTHORIZED,
            "session_revoked: another client is now running as this agent",
        )

    db.commit()

    # Fan out push notifications for relevant events. Runs after the
    # response is sent (FastAPI BackgroundTasks); never blocks event
    # creation; failures are logged but never raised. The service opens
    # its own short-lived DB session because `db` here is request-scoped.
    from app.services.push import fanout_for_event
    background_tasks.add_task(
        fanout_for_event,
        str(workspace.id),
        {
            "id": result.id,
            "type": result.type,
            "source": result.source,
            "target": result.target,
            "payload": result.payload,
            "timestamp": result.timestamp,
        },
    )

    return success_response({
        "id": result.id,
        "type": result.type,
        "source": result.source,
        "target": result.target,
        "payload": result.payload,
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
    limit: int = Query(50, ge=1, le=500, description="Max events to return"),
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

    # Two-level read-through cache for poll traffic.
    #
    # Level 1: FULL key (includes `after`/`before` cursor). Dedupes identical
    # polls from the same agent within the TTL window. Correct for any
    # parameters.
    #
    # Level 2: HEAD-CURSOR tracking. When a non-empty poll returns events,
    # we remember the newest event id for these filters. When a subsequent
    # poll comes in with `after = cached_head_id` (i.e. the client is
    # already caught up to the most recent event we've seen), its "give me
    # anything newer" query is equivalent to a no-cursor "give me the empty
    # set". Many agents sharing the head cursor all hash to the same
    # Level-2 key and share a single DB hit.
    #
    # This is a strict correctness guarantee: we only route to Level 2 when
    # the caller's cursor is EQUAL to the tracked head. Agents that are
    # behind (historical backfill) fall through to Level 1 / DB.
    cache_key = None
    at_head_key = None
    head_tracker_key = None
    incoming_after = after or ""
    if not search and not member:
        key_parts = [
            str(workspace.id), target or "", channel or "",
            type or "", conversation or "",
            after or "", before or "",
            sort or "asc", str(limit),
        ]
        cache_key = "v1events:full:" + hashlib.sha1(
            "|".join(key_parts).encode("utf-8")
        ).hexdigest()

        # Per-filter head cursor marker (what the newest event id was for
        # this filter the last time we saw any events). Cursor-free.
        filter_parts = [
            str(workspace.id), target or "", channel or "",
            type or "", conversation or "",
            sort or "asc", str(limit),
        ]
        filter_hash = hashlib.sha1("|".join(filter_parts).encode("utf-8")).hexdigest()
        head_tracker_key = "v1events:head:" + filter_hash

        import json as _json

        # Level 1: exact-match cache
        cached = cache.get_bytes(cache_key)
        if cached is not None:
            try:
                return _json.loads(cached)
            except Exception:
                pass

        # Level 2: if client is at head (after == last-known head), route
        # to a shared cached-empty response. Only fires when we already know
        # the head AND client's cursor matches it — so agents behind head
        # cannot receive this cached empty by mistake.
        if before is None:
            head_id = cache.get_bytes(head_tracker_key)
            if head_id is not None:
                head_id_str = head_id.decode("utf-8") if isinstance(head_id, bytes) else str(head_id)
                if head_id_str and head_id_str == incoming_after:
                    at_head_key = "v1events:athead:" + filter_hash
                    cached_empty = cache.get_bytes(at_head_key)
                    if cached_empty is not None:
                        try:
                            return _json.loads(cached_empty)
                        except Exception:
                            pass

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

    composing = False
    if not search and not conversation:
        from app.composing import has_any_composing
        composing = has_any_composing(str(workspace.id))

    response_data = {
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
    }
    if composing:
        response_data["composing"] = True

    response = success_response(response_data)

    # Populate cache for subsequent polls within the TTL window.
    # success_response returns a dict; Redis stores the serialized JSON.
    if cache_key is not None and isinstance(response, dict):
        try:
            import json as _json
            serialized = _json.dumps(
                response, default=str, separators=(",", ":")
            ).encode("utf-8")
            # Level 1: exact-match cache (includes cursor). Slightly
            # longer TTL helps dedup adjacent polls from the same agent.
            cache.set_bytes(cache_key, serialized, ttl_seconds=1.5)

            # Level 2 maintenance — track the head cursor for these
            # filters, and cache the "empty" response when the client was
            # already at head.
            if head_tracker_key is not None:
                newest_id = response.get("data", {}).get("newest_id")
                if events and newest_id:
                    # Update head tracker — newest_id is the tip we just saw.
                    # Longer TTL because head updates are cheap and we want
                    # subsequent at-head checks to find it.
                    cache.set_bytes(
                        head_tracker_key,
                        str(newest_id).encode("utf-8"),
                        ttl_seconds=30.0,
                    )
                elif not events and incoming_after:
                    # DB returned empty AND the client had a cursor. This
                    # confirms "after = head" for this filter. Populate
                    # both the head tracker (so other clients can match)
                    # and the shared at-head empty response.
                    filter_hash = head_tracker_key.split(":")[-1]
                    cache.set_bytes(
                        head_tracker_key,
                        incoming_after.encode("utf-8"),
                        ttl_seconds=30.0,
                    )
                    cache.set_bytes(
                        "v1events:athead:" + filter_hash,
                        serialized,
                        ttl_seconds=1.5,
                    )
        except Exception:
            pass

    return response


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
