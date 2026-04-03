# -*- coding: utf-8 -*-
"""
SDK HTTP Transport bridge — implements the endpoints that the OpenAgents
SDK's HTTP connector expects for agent registration and message polling.

POST /api/register     → Accept agent, return secret + join workspace
POST /api/unregister   → Remove agent + leave workspace
GET  /api/poll         → Return new messages from the workspace events table
POST /api/send_event   → Accept events from the agent, persist to workspace
"""

import logging
import time
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Channel, ChannelMember, EventRecord, Workspace, WorkspaceMember

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["Transport"])

# In-memory agent registry — sufficient for single-workspace dev use.
# Maps agent_id → {"secret": str, "metadata": dict, "workspace_id": str, "last_seen_ts": int}
_registered_agents: dict[str, dict] = {}


def _get_workspace(db: Session) -> Optional[Workspace]:
    """Get the most recently created active workspace."""
    return db.execute(
        select(Workspace)
        .where(Workspace.status != "deleted")
        .order_by(Workspace.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()


# ---------------------------------------------------------------------------
# POST /api/register
# ---------------------------------------------------------------------------

@router.post("/register")
async def register_agent(request: Request, db: Session = Depends(get_db)):
    data = await request.json()
    agent_id = data.get("agent_id")
    if not agent_id:
        return JSONResponse(status_code=400, content={"success": False, "error_message": "agent_id is required"})

    secret = str(uuid.uuid4())
    now_ms = int(time.time() * 1000)

    # Join the workspace so the agent appears in discover/UI
    workspace = _get_workspace(db)
    workspace_id = None
    network_name = "ISAP Workspace"

    if workspace:
        workspace_id = str(workspace.id)
        network_name = workspace.name or network_name

        existing = db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace.id,
                WorkspaceMember.agent_name == agent_id,
            )
        ).scalar_one_or_none()

        if existing:
            existing.status = "online"
        else:
            from datetime import datetime, timezone
            member = WorkspaceMember(
                workspace_id=workspace.id,
                agent_name=agent_id,
                role="member",
                status="online",
                agent_type="worker",
                joined_at=datetime.now(timezone.utc),
                last_heartbeat=datetime.now(timezone.utc),
            )
            db.add(member)
        db.commit()

    _registered_agents[agent_id] = {
        "secret": secret,
        "metadata": data.get("metadata", {}),
        "workspace_id": workspace_id,
        "last_seen_ts": now_ms,
    }

    logger.info("Agent registered and joined workspace: %s", agent_id)

    return {
        "success": True,
        "network_name": network_name,
        "network_id": workspace_id or "isap-workspace",
        "secret": secret,
        "assigned_group": None,
    }


# ---------------------------------------------------------------------------
# POST /api/unregister
# ---------------------------------------------------------------------------

@router.post("/unregister")
async def unregister_agent(request: Request, db: Session = Depends(get_db)):
    data = await request.json()
    agent_id = data.get("agent_id")
    if not agent_id:
        return JSONResponse(status_code=400, content={"success": False, "error_message": "agent_id is required"})

    _registered_agents.pop(agent_id, None)

    # Mark agent offline in workspace
    workspace = _get_workspace(db)
    if workspace:
        member = db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace.id,
                WorkspaceMember.agent_name == agent_id,
            )
        ).scalar_one_or_none()
        if member:
            member.status = "offline"
            db.commit()

    logger.info("Agent unregistered: %s", agent_id)
    return {"success": True}


# ---------------------------------------------------------------------------
# GET /api/poll
# ---------------------------------------------------------------------------

@router.get("/poll")
async def poll_messages(
    agent_id: str = Query(...),
    secret: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    agent_state = _registered_agents.get(agent_id)
    if not agent_state:
        return {"success": False, "error_message": "Agent not registered"}

    workspace_id = agent_state.get("workspace_id")
    if not workspace_id:
        return {"success": True, "messages": []}

    last_seen_ts = agent_state["last_seen_ts"]

    # Find channels the agent is a member of
    channel_names = db.execute(
        select(Channel.name).where(
            Channel.workspace_id == workspace_id,
            Channel.id.in_(
                select(ChannelMember.channel_id).where(
                    ChannelMember.agent_name == agent_id
                )
            ),
        )
    ).scalars().all()

    if not channel_names:
        return {"success": True, "messages": []}

    channel_targets = [f"channel/{name}" for name in channel_names]

    # Query new events since last poll
    rows = db.execute(
        select(EventRecord)
        .where(
            EventRecord.network_id == workspace_id,
            EventRecord.timestamp > last_seen_ts,
            EventRecord.target.in_(channel_targets),
            EventRecord.type == "workspace.message.posted",
            EventRecord.source != f"openagents:{agent_id}",  # skip own messages
        )
        .order_by(EventRecord.timestamp.asc())
        .limit(50)
    ).scalars().all()

    if not rows:
        return {"success": True, "messages": []}

    # Update cursor
    agent_state["last_seen_ts"] = rows[-1].timestamp

    # Build thread context: recent messages per channel for the prompt template.
    # The orchestrator's user_prompt_template renders context.event_threads,
    # but we can't populate that from the transport bridge. Instead, we include
    # a summary of recent channel messages in the notification payload so the
    # agent has context even without the thread system.
    _channel_history_cache: dict[str, list[dict]] = {}
    for channel_name in channel_names:
        history_rows = db.execute(
            select(EventRecord)
            .where(
                EventRecord.network_id == workspace_id,
                EventRecord.target == f"channel/{channel_name}",
                EventRecord.type == "workspace.message.posted",
            )
            .order_by(EventRecord.timestamp.desc())
            .limit(20)
        ).scalars().all()
        _channel_history_cache[channel_name] = [
            {
                "sender": r.source,
                "content": (r.payload or {}).get("content", ""),
                "timestamp": r.timestamp,
            }
            for r in reversed(history_rows)
        ]

    # Convert workspace events to SDK thread.channel_message.notification format.
    # The WorkerAgent has @on_event handlers for this event name, not for
    # workspace.message.posted.
    messages = []
    for row in rows:
        metadata = row.metadata_ or {}
        # Only deliver if this agent is in target_agents (routing decision)
        target_agents = metadata.get("target_agents", [])
        if target_agents and agent_id not in target_agents:
            continue

        payload = row.payload or {}
        # Extract channel name from target (e.g. "channel/session-abc" → "session-abc")
        channel_name = row.target.removeprefix("channel/") if row.target else ""

        # Build the notification payload the WorkerAgent expects
        notification_payload = {
            "content": payload.get("content", ""),
            "sender_id": row.source,
            "message_id": row.id,
            "channel": channel_name,
            "message_type": "channel_message",
            "timestamp": row.timestamp,
        }

        # Propagate @mention info
        mentions = payload.get("mentions", [])
        if agent_id in mentions:
            notification_payload["mentioned_agent_id"] = agent_id

        # Include channel history so the agent has thread context
        notification_payload["channel_history"] = _channel_history_cache.get(channel_name, [])

        messages.append({
            "event_id": str(uuid.uuid4()),  # unique per notification
            "event_name": "thread.channel_message.notification",
            "source_id": row.source,
            "destination_id": agent_id,
            "payload": notification_payload,
            "metadata": metadata,
            "visibility": row.visibility or "channel",
        })

    if messages:
        logger.info("Delivering %d messages to %s", len(messages), agent_id)

    return {"success": True, "messages": messages}


# ---------------------------------------------------------------------------
# POST /api/send_event
# ---------------------------------------------------------------------------

@router.post("/send_event")
async def send_event(request: Request, db: Session = Depends(get_db)):
    data = await request.json()
    source_id = data.get("source_id", "")
    event_name = data.get("event_name", "")
    payload = data.get("payload", {})
    metadata = data.get("metadata", {})

    logger.info("Event from %s: %s", source_id, event_name)

    agent_state = _registered_agents.get(source_id)
    if not agent_state or not agent_state.get("workspace_id"):
        return {"success": True, "message": "Event accepted (no workspace)"}

    workspace_id = agent_state["workspace_id"]

    # Extract channel from payload (reply_message and channel_message both have it)
    channel_name = payload.get("channel", "")
    if not channel_name:
        return {"success": True, "message": "Event accepted (no channel)"}

    channel_target = f"channel/{channel_name}"

    # Extract text content — may be nested as {content: {text: "..."}} or {content: "..."}
    content = payload.get("content", "")
    if isinstance(content, dict):
        text = content.get("text", "")
    else:
        text = str(content)

    # Build a normalized payload for the events table
    normalized_payload = {
        "content": text,
        "message_type": payload.get("message_type", "chat"),
        "sender_type": "agent",
    }
    if payload.get("reply_to_id"):
        normalized_payload["reply_to_id"] = payload["reply_to_id"]

    now_ms = int(time.time() * 1000)
    source_addr = f"openagents:{source_id}" if not source_id.startswith("openagents:") else source_id

    event_record = EventRecord(
        id=data.get("event_id", str(uuid.uuid4())),
        network_id=workspace_id,
        type="workspace.message.posted",
        source=source_addr,
        target=channel_target,
        payload=normalized_payload,
        metadata_=metadata,
        timestamp=now_ms,
        visibility=data.get("visibility", "channel"),
    )
    db.add(event_record)
    db.commit()
    logger.info("Persisted agent message to %s: %s", channel_target, text[:80])

    return {"success": True, "message": "Event persisted"}
