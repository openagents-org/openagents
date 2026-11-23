# -*- coding: utf-8 -*-
"""
Imported sessions — a person's own past agent CLI sessions (Claude Code,
Codex, OpenCode, Hermes), brought into the workspace as threads.

POST /v1/nodes/{node_id}/imported-sessions

Called by the device's daemon with its own connection credential, after the
device owner picked the session in the workspace (node command
`import_local_session`, owner-only). The device reads the session and sends
the conversation in batches:

  first call  {type, session_id, title, cwd, agent, messages, truncated, total}
              → creates a PRIVATE thread owned by the device owner, with the
                owner and `agent` in it; returns {channel, title}
  later calls {channel, messages}  → appends (at most 50 messages each)

Messages are stored as history: they never route to an agent, never wake one,
and read "Imported from Codex". What the person typed shows as theirs, what
the agent answered as the chosen agent's. Tool notes ("Ran: npm test") are
folded into the answer that follows them. The original time of each message
is kept in its payload; ordering follows the session.
"""

import json
import logging
import time
import uuid
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Channel, ChannelHumanMember, ChannelMember, EventRecord, Node, Workspace, WorkspaceMember
from app.response import ResponseCode, json_response, success_response
from app.routers.nodes import _machine_token_ok

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["Imported sessions"])

TOOLS = {"claude": "Claude Code", "codex": "Codex", "opencode": "OpenCode", "hermes": "Hermes"}
MAX_BATCH = 50
MAX_TEXT = 8000
MAX_MESSAGES = 400


class ImportedMessage(BaseModel):
    role: Literal["user", "assistant", "tool"]
    text: str = Field(max_length=MAX_TEXT + 16)
    at: Optional[str] = None


class ImportRequest(BaseModel):
    type: Optional[str] = None
    session_id: Optional[str] = Field(None, max_length=128)
    title: Optional[str] = Field(None, max_length=200)
    cwd: Optional[str] = Field(None, max_length=1024)
    agent: Optional[str] = Field(None, max_length=128)
    truncated: bool = False
    total: Optional[int] = None
    channel: Optional[str] = Field(None, max_length=128)
    messages: List[ImportedMessage] = Field(default_factory=list, max_length=MAX_BATCH)


def _fold_tool_notes(messages: List[ImportedMessage]) -> List[dict]:
    """[(role, text, at)] with each run of tool notes put in front of the
    agent answer that follows it, as an italic list."""
    out: List[dict] = []
    notes: List[str] = []
    for m in messages:
        if m.role == "tool":
            notes.append(m.text.strip())
            continue
        text = m.text.strip()
        if m.role == "assistant" and notes:
            text = "\n".join(f"_{n}_" for n in notes) + ("\n\n" + text if text else "")
            notes = []
        elif notes:
            out.append({"role": "assistant", "text": "\n".join(f"_{n}_" for n in notes), "at": m.at})
            notes = []
        if text:
            out.append({"role": m.role, "text": text[:MAX_TEXT], "at": m.at})
    if notes:
        out.append({"role": "assistant", "text": "\n".join(f"_{n}_" for n in notes), "at": messages[-1].at})
    return out


def _publish(workspace_id: str, record: EventRecord) -> None:
    try:
        from app import cache
        cache.publish_event(f"ws:{workspace_id}:events", json.dumps({
            "id": record.id, "type": record.type, "source": record.source, "target": record.target,
            "payload": record.payload, "metadata": record.metadata_, "timestamp": record.timestamp,
        }, default=str, separators=(",", ":")).encode())
    except Exception:  # noqa: BLE001 — a missed live update; clients still poll
        pass


def _store(db: Session, workspace: Workspace, channel: Channel, owner: str, agent: Optional[str],
           tool: str, messages: List[dict], start_ts: int) -> int:
    """Insert the messages as history events; returns the next timestamp."""
    ts = start_ts
    for m in messages:
        human = m["role"] == "user"
        source = f"human:{owner}" if human else (f"openagents:{agent}" if agent else "system:import")
        payload = {
            "content": m["text"],
            "message_type": "chat",
            "sender_type": "human" if human else ("agent" if agent else "system"),
            "sender_name": owner if human else (agent or tool),
            "imported": {"tool": tool, "at": m.get("at")},
        }
        if human:
            payload["sender_email"] = owner
        record = EventRecord(
            id=str(uuid.uuid4()), network_id=workspace.id, type="workspace.message.posted",
            source=source, target=f"channel/{channel.name}", payload=payload,
            # History, not a request: no agent is addressed, none responds.
            metadata_={"target_agents": ["__no_response__"], "imported": True},
            timestamp=ts, visibility="channel",
        )
        db.add(record)
        db.flush()
        _publish(str(workspace.id), record)
        ts += 1
    return ts


@router.post("/nodes/{node_id}/imported-sessions")
def import_session(
    node_id: str,
    body: ImportRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
):
    node = db.get(Node, node_id)
    if node is None:
        return json_response(ResponseCode.NOT_FOUND, "Node not found")
    workspace = db.get(Workspace, node.workspace_id)
    if workspace is None or workspace.status == "deleted":
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")
    # Only the device itself, with its own credential, on a connection that
    # belongs to a person: the thread is theirs.
    if not node.owner_email or not _machine_token_ok(x_workspace_token, workspace, node):
        return json_response(ResponseCode.FORBIDDEN, "Only the device's own connection can import its sessions")
    owner = node.owner_email.strip().lower()

    if body.channel:
        channel = db.execute(select(Channel).where(
            Channel.workspace_id == workspace.id, Channel.name == body.channel, Channel.status != "deleted",
        )).scalar_one_or_none()
        # Appending only into a thread an import created, for this owner: it
        # opens with the import notice.
        notice = db.execute(select(EventRecord).where(
            EventRecord.network_id == workspace.id, EventRecord.target == f"channel/{body.channel}",
            EventRecord.source == "system:import",
        ).limit(1)).scalar_one_or_none() if channel is not None else None
        if channel is None or channel.owner_email != owner or notice is None:
            return json_response(ResponseCode.NOT_FOUND, "Imported thread not found")
        tool = ((notice.payload or {}).get("imported") or {}).get("tool") or "a local agent"
        agent = channel.master_agent
        last = db.execute(select(EventRecord.timestamp).where(
            EventRecord.network_id == workspace.id, EventRecord.target == f"channel/{channel.name}",
        ).order_by(EventRecord.timestamp.desc()).limit(1)).scalar_one_or_none()
        count = db.query(EventRecord).filter(EventRecord.network_id == workspace.id,
                                             EventRecord.target == f"channel/{channel.name}").count()
        if count + len(body.messages) > MAX_MESSAGES + 2:
            return json_response(ResponseCode.BAD_REQUEST, "Too many messages for one imported session")
        _store(db, workspace, channel, owner, agent, tool, _fold_tool_notes(body.messages), (last or 0) + 1)
        db.commit()
        return success_response({"channel": channel.name, "title": channel.title})

    if body.type not in TOOLS:
        return json_response(ResponseCode.BAD_REQUEST, "Importing supports claude, codex, opencode and hermes")
    tool = TOOLS[body.type]
    agent = (body.agent or "").strip() or None
    if agent:
        member = db.execute(select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id, WorkspaceMember.agent_name == agent,
        )).scalar_one_or_none()
        if member is None or member.status == "removed":
            return json_response(ResponseCode.BAD_REQUEST, f"No agent named {agent} in this workspace")
        from app.services.access_model import Principal, can_use_agent, workspace_human_role
        role = workspace_human_role(db, workspace, owner)
        if not role or not can_use_agent(db, str(workspace.id), Principal("human", email=owner, role=role, workspace_id=str(workspace.id)), member):
            return json_response(ResponseCode.FORBIDDEN, f"You can't use {agent}")

    title = (body.title or "").strip()[:120] or f"Imported {tool} session"
    channel = Channel(
        workspace_id=workspace.id,
        name=f"channel-{uuid.uuid4().hex[:8]}",
        title=title,
        title_manually_set=True,
        created_by=f"human:{owner}",
        master_agent=agent,
        status="active",
        visibility="private",
        owner_email=owner,
        participants_can_invite=False,
        director_email=owner,
    )
    db.add(channel)
    db.flush()
    db.add(ChannelHumanMember(channel_id=channel.id, user_email=owner))
    if agent:
        db.add(ChannelMember(channel_id=channel.id, agent_name=agent))
    db.flush()

    ts = int(time.time() * 1000)
    intro = f"Imported from {tool}" + (f" · {body.cwd}" if body.cwd else "")
    if body.truncated and body.total:
        intro += f" · the most recent {MAX_MESSAGES} of {body.total} messages"
    notice = EventRecord(
        id=str(uuid.uuid4()), network_id=workspace.id, type="workspace.message.posted",
        source="system:import", target=f"channel/{channel.name}",
        payload={"content": intro, "message_type": "chat", "sender_type": "system", "sender_name": "System",
                 "imported": {"tool": tool, "session_id": body.session_id}},
        metadata_={"target_agents": ["__no_response__"], "imported": True},
        timestamp=ts, visibility="channel",
    )
    db.add(notice)
    db.flush()
    _store(db, workspace, channel, owner, agent, tool, _fold_tool_notes(body.messages), ts + 1)
    db.commit()
    return success_response({"channel": channel.name, "title": channel.title})
