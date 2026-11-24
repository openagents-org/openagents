# -*- coding: utf-8 -*-
"""
Imported sessions — a person's own past agent CLI sessions (Claude Code,
Codex, OpenCode, Hermes), brought into the workspace as threads.

POST /v1/nodes/{node_id}/imported-sessions

Called by the device's daemon while it carries out an `import_local_session`
command the device owner started from the workspace (owner-only to queue).
Every call names that command (`command_id`), and the session, tool and agent
come from the command, not from the request: the device's credential alone —
which every agent on the device holds — can't create or extend a thread. The
conversation arrives in batches:

  first call  {command_id, title, cwd, messages, truncated, total, final}
              → creates a PRIVATE thread owned by the device owner, with the
                owner and the chosen agent in it; returns {channel, title}
  later calls {command_id, channel, messages, final}  → appends (≤ 50 each)

The same session imported again by the same person returns the thread it
already made, unless that import never finished: then the half-made thread is
removed and the import starts over.

Messages are stored as history: they never route to an agent, never wake one,
and read "Imported from Codex". What the person typed shows as theirs, what
the agent answered as the chosen agent's. Tool notes ("Ran: npm test") are
put in front of the answer that follows them. The original time of each
message is kept in its payload; ordering follows the session.
"""

import json
import logging
import time
import uuid
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Channel, ChannelHumanMember, ChannelMember, EventRecord, Node, NodeCommand, Workspace, WorkspaceMember
from app.response import ResponseCode, json_response, success_response
from app.routers.nodes import _machine_token_ok

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["Imported sessions"])

TOOLS = {"claude": "Claude Code", "codex": "Codex", "opencode": "OpenCode", "hermes": "Hermes"}
MAX_BATCH = 50
MAX_TEXT = 8000
MAX_MESSAGES = 400
NOTICE_SOURCE = "system:import"


class ImportedMessage(BaseModel):
    role: Literal["user", "assistant", "tool"]
    text: str = Field(max_length=MAX_TEXT + 16)
    at: Optional[str] = None


class ImportRequest(BaseModel):
    command_id: str = Field(max_length=64)
    title: Optional[str] = Field(None, max_length=200)
    cwd: Optional[str] = Field(None, max_length=1024)
    truncated: bool = False
    total: Optional[int] = None
    channel: Optional[str] = Field(None, max_length=128)
    final: bool = False
    messages: List[ImportedMessage] = Field(default_factory=list, max_length=MAX_BATCH)


def _fold_tool_notes(messages: List[ImportedMessage]) -> List[dict]:
    """The messages with each run of tool notes put in front of the agent
    answer that follows it, as an italic list. The answer is trimmed before
    the notes are added, so notes never push it out."""
    out: List[dict] = []
    notes: List[str] = []

    def note_block() -> str:
        return "\n".join(f"_{n}_" for n in notes)[:2000]

    for m in messages:
        if m.role == "tool":
            notes.append(m.text.strip())
            continue
        text = m.text.strip()[:MAX_TEXT]
        if m.role == "assistant" and notes:
            text = note_block() + ("\n\n" + text if text else "")
            notes = []
        elif notes:
            out.append({"role": "assistant", "text": note_block(), "at": m.at})
            notes = []
        if text:
            out.append({"role": m.role, "text": text, "at": m.at})
    if notes:
        out.append({"role": "assistant", "text": note_block(), "at": messages[-1].at})
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


def _event(workspace: Workspace, channel: Channel, source: str, payload: dict, ts: int) -> EventRecord:
    return EventRecord(
        id=str(uuid.uuid4()), network_id=workspace.id, type="workspace.message.posted",
        source=source, target=f"channel/{channel.name}", payload=payload,
        # History, not a request: no agent is addressed, none responds.
        metadata_={"target_agents": ["__no_response__"], "imported": True},
        timestamp=ts, visibility="channel",
    )


def _store(db: Session, workspace: Workspace, channel: Channel, owner: str, agent: Optional[str],
           tool: str, messages: List[dict], start_ts: int) -> int:
    """Insert the messages as history events; returns the next timestamp."""
    ts = start_ts
    for m in messages:
        human = m["role"] == "user"
        source = f"human:{owner}" if human else (f"openagents:{agent}" if agent else NOTICE_SOURCE)
        payload = {
            "content": m["text"],
            "message_type": "chat",
            "sender_type": "human" if human else ("agent" if agent else "system"),
            "sender_name": owner if human else (agent or tool),
            "imported": {"tool": tool, "at": m.get("at")},
        }
        if human:
            payload["sender_email"] = owner
        record = _event(workspace, channel, source, payload, ts)
        db.add(record)
        db.flush()
        _publish(str(workspace.id), record)
        ts += 1
    if messages:
        db.execute(update(Channel).where(Channel.id == channel.id).values(last_event_at=ts - 1))
    return ts


def _notice(db: Session, workspace: Workspace, channel_name: str) -> Optional[EventRecord]:
    return db.execute(select(EventRecord).where(
        EventRecord.network_id == workspace.id, EventRecord.target == f"channel/{channel_name}",
        EventRecord.source == NOTICE_SOURCE,
    ).order_by(EventRecord.timestamp).limit(1)).scalar_one_or_none()


def _previous_import(db: Session, workspace: Workspace, owner: str, tool_type: str, session_id: str):
    """(channel, notice) of this person's earlier import of the same session."""
    notices = db.execute(select(EventRecord).where(
        EventRecord.network_id == workspace.id, EventRecord.source == NOTICE_SOURCE,
    )).scalars().all()
    for notice in notices:
        info = (notice.payload or {}).get("imported") or {}
        if info.get("type") != tool_type or info.get("session_id") != session_id:
            continue
        channel = db.execute(select(Channel).where(
            Channel.workspace_id == workspace.id, Channel.name == notice.target[len("channel/"):],
            Channel.status != "deleted", Channel.owner_email == owner,
        )).scalar_one_or_none()
        if channel is not None:
            return channel, notice
    return None, None


def _mark_complete(db: Session, notice: EventRecord) -> None:
    payload = dict(notice.payload or {})
    payload["imported"] = {**(payload.get("imported") or {}), "complete": True}
    notice.payload = payload


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
    if not node.owner_email or not _machine_token_ok(x_workspace_token, workspace, node):
        return json_response(ResponseCode.FORBIDDEN, "Only the device's own connection can import its sessions")
    owner = node.owner_email.strip().lower()
    # Bound to the owner's command: queued by them (owner-only), for this
    # device, and still being carried out.
    cmd = db.get(NodeCommand, body.command_id)
    if (cmd is None or str(cmd.node_id) != str(node.id) or cmd.action != "import_local_session"
            or cmd.status != "running"):
        return json_response(ResponseCode.FORBIDDEN, "No import in progress for this device")
    args = dict(cmd.command or {})
    from app.services.access_model import workspace_human_role
    if not workspace_human_role(db, workspace, owner):
        return json_response(ResponseCode.FORBIDDEN, "The device owner is no longer in this workspace")

    if body.channel:
        if args.get("channel") != body.channel:
            return json_response(ResponseCode.NOT_FOUND, "Imported thread not found")
        channel = db.execute(select(Channel).where(
            Channel.workspace_id == workspace.id, Channel.name == body.channel, Channel.status != "deleted",
        )).scalar_one_or_none()
        notice = _notice(db, workspace, body.channel) if channel is not None else None
        if channel is None or channel.owner_email != owner or notice is None:
            return json_response(ResponseCode.NOT_FOUND, "Imported thread not found")
        tool = ((notice.payload or {}).get("imported") or {}).get("tool") or "a local agent"
        count = db.query(EventRecord).filter(EventRecord.network_id == workspace.id,
                                             EventRecord.target == f"channel/{channel.name}").count()
        if count + len(body.messages) > MAX_MESSAGES + 2:
            return json_response(ResponseCode.BAD_REQUEST, "Too many messages for one imported session")
        last = db.execute(select(EventRecord.timestamp).where(
            EventRecord.network_id == workspace.id, EventRecord.target == f"channel/{channel.name}",
        ).order_by(EventRecord.timestamp.desc()).limit(1)).scalar_one_or_none()
        _store(db, workspace, channel, owner, channel.master_agent, tool, _fold_tool_notes(body.messages), (last or 0) + 1)
        if body.final:
            _mark_complete(db, notice)
        db.commit()
        return success_response({"channel": channel.name, "title": channel.title})

    tool_type, session_id = args.get("type"), str(args.get("id") or "")
    if tool_type not in TOOLS or not session_id:
        return json_response(ResponseCode.BAD_REQUEST, "Importing supports claude, codex, opencode and hermes")
    if args.get("channel"):
        return json_response(ResponseCode.BAD_REQUEST, "This import already made its thread")
    tool = TOOLS[tool_type]
    agent = (args.get("agent") or "").strip() or None
    if agent:
        member = db.execute(select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id, WorkspaceMember.agent_name == agent,
        )).scalar_one_or_none()
        if member is None or member.status == "removed":
            return json_response(ResponseCode.BAD_REQUEST, f"No agent named {agent} in this workspace")
        # A private session goes only to the owner's own agents: one someone
        # else runs would receive the whole history as context.
        if (member.owner_email or "").strip().lower() != owner:
            return json_response(ResponseCode.FORBIDDEN, f"{agent} isn't one of your agents")

    previous, previous_notice = _previous_import(db, workspace, owner, tool_type, session_id)
    if previous is not None:
        if ((previous_notice.payload or {}).get("imported") or {}).get("complete"):
            return success_response({"channel": previous.name, "title": previous.title, "existing": True})
        previous.status = "deleted"  # a half-made import: start over

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
    cmd.command = {**args, "channel": channel.name}

    ts = int(time.time() * 1000)
    intro = f"Imported from {tool}" + (f" · {body.cwd}" if body.cwd else "")
    if body.truncated and body.total:
        intro += f" · the most recent {MAX_MESSAGES} of {body.total} messages"
    notice = _event(workspace, channel, NOTICE_SOURCE, {
        "content": intro, "message_type": "chat", "sender_type": "system", "sender_name": "System",
        "imported": {"tool": tool, "type": tool_type, "session_id": session_id, "complete": False},
    }, ts)
    db.add(notice)
    db.flush()
    _publish(str(workspace.id), notice)
    db.execute(update(Channel).where(Channel.id == channel.id).values(last_event_at=ts))
    _store(db, workspace, channel, owner, agent, tool, _fold_tool_notes(body.messages), ts + 1)
    if body.final:
        _mark_complete(db, notice)
    db.commit()
    return success_response({"channel": channel.name, "title": channel.title})
