# -*- coding: utf-8 -*-
"""Fork a thread: a new thread with the same settings, agents and history.

The copy is a snapshot. Messages are inserted directly as event rows rather
than posted through the pipeline, so nothing is routed and no agent wakes up;
agents in the fork read the copied history the same way they read any thread
they join. Later activity in either thread never reaches the other.
"""

import copy
import uuid
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Channel,
    ChannelAgentSharing,
    ChannelBrief,
    ChannelHumanMember,
    ChannelMember,
    EventRecord,
    ReadMarker,
)

# Transient rows (typing, status lines, live todo lists, approval cards) are
# not conversation; an approval card in the fork would also act on the
# original request. Decisions on approvals arrive as ordinary chat messages.
_SKIPPED_MESSAGE_TYPES = {"thinking", "status", "todos", "approval"}

FORK_TITLE_SUFFIX = " (fork)"


def _forkable(record: EventRecord) -> bool:
    payload = record.payload or {}
    if payload.get("message_type", "chat") in _SKIPPED_MESSAGE_TYPES:
        return False
    return not (record.metadata_ or {}).get("recalled")


def _remap_reply(metadata: dict, id_map: dict) -> dict:
    metadata = copy.deepcopy(metadata or {})
    if metadata.get("in_reply_to") in id_map:
        metadata["in_reply_to"] = id_map[metadata["in_reply_to"]]
    reply = metadata.get("reply_to")
    if isinstance(reply, dict) and reply.get("message_id") in id_map:
        metadata["reply_to"] = {**reply, "message_id": id_map[reply["message_id"]]}
    return metadata


def fork_channel(db: Session, source: Channel, owner_email: str, *, title: Optional[str] = None) -> Channel:
    """Create and flush the fork of `source`, owned by `owner_email`."""
    fork = Channel(
        workspace_id=source.workspace_id,
        name=f"channel-{uuid.uuid4().hex[:8]}",
        service_id=source.service_id,
        icon=source.icon,
        title=(title or "").strip() or f"{source.title or 'Untitled thread'}{FORK_TITLE_SUFFIX}",
        title_manually_set=True,
        created_by=f"human:{owner_email}",
        master_agent=source.master_agent,
        # A workflow run belongs to the thread it ran in; the fork starts idle.
        orchestration_mode="dynamic",
        response_mode=source.response_mode or "proactive",
        orchestration_instruction=source.orchestration_instruction,
        status="active",
        is_channel=False,
        # Only the person forking is in the fork, so it is theirs and private.
        visibility="private",
        owner_email=owner_email,
        participants_can_invite=bool(source.participants_can_invite),
        members_can_add_agents=bool(source.members_can_add_agents),
        director_email=owner_email,
        forked_from=source.name,
    )
    db.add(fork)
    db.flush()

    db.add(ChannelHumanMember(channel_id=fork.id, user_email=owner_email))
    for member in db.execute(select(ChannelMember).where(ChannelMember.channel_id == source.id)).scalars():
        db.add(ChannelMember(channel_id=fork.id, agent_name=member.agent_name))
    for sharing in db.execute(select(ChannelAgentSharing).where(ChannelAgentSharing.channel_id == source.id)).scalars():
        db.add(ChannelAgentSharing(channel_id=fork.id, owner_email=sharing.owner_email,
                                   enabled=sharing.enabled, mode=sharing.mode))

    brief = db.get(ChannelBrief, (source.workspace_id, source.name))
    if brief is not None:
        db.add(ChannelBrief(
            workspace_id=source.workspace_id, channel_name=fork.name, objective=brief.objective,
            owner=brief.owner, latest_result=brief.latest_result,
            open_questions=copy.deepcopy(brief.open_questions), next_step=brief.next_step,
            updated_by=brief.updated_by,
        ))

    records = db.execute(
        select(EventRecord).where(
            EventRecord.network_id == source.workspace_id,
            EventRecord.target == f"channel/{source.name}",
            EventRecord.type == "workspace.message.posted",
        ).order_by(EventRecord.timestamp, EventRecord.id)
    ).scalars().all()
    records = [r for r in records if _forkable(r)]
    id_map = {r.id: str(uuid.uuid4()) for r in records}
    for record in records:
        metadata = _remap_reply(record.metadata_, id_map)
        metadata["forked_from_event_id"] = record.id
        db.add(EventRecord(
            id=id_map[record.id],
            network_id=record.network_id,
            type=record.type,
            source=record.source,
            target=f"channel/{fork.name}",
            payload=copy.deepcopy(record.payload),
            metadata_=metadata,
            timestamp=record.timestamp,
            visibility=record.visibility,
        ))
    if records:
        fork.forked_at_event_id = records[-1].id
        fork.last_event_at = records[-1].timestamp
        # The copied history is already read by the person who forked it.
        db.add(ReadMarker(workspace_id=source.workspace_id, user_email=owner_email,
                          session_id=fork.name, read_at=records[-1].timestamp,
                          updated_at=records[-1].timestamp))
    db.flush()
    return fork
