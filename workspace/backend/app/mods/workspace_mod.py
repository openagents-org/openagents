# -*- coding: utf-8 -*-
"""
mod/workspace — session routing, presence tracking, delegation.

Transform mod (priority 50). Handles workspace-specific event processing:
- Agent join/leave/ping → update WorkspaceMember
- Channel create/join/leave → manage Channel + ChannelMember rows
- Message posted by human → route to channel master
- Message posted by agent → LLM router decides next speaker or stop

Expects context.extra to contain:
  - db: SQLAlchemy Session
  - workspace: Workspace ORM object
"""

import logging
import re
from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import select

from openagents.core.onm_events import Event, WorkspaceEventTypes
from openagents.core.onm_mods import PipelineContext, TransformMod

logger = logging.getLogger(__name__)

# Lazy-initialized LLM client for the router
_llm_client = None
_llm_provider = None


class WorkspaceMod(TransformMod):
    """Workspace-specific event processing."""
    name = "workspace"
    intercepts: List[str] = []  # Match all events — we dispatch internally
    priority = 50

    async def process(self, event: Event, context: PipelineContext) -> Optional[Event]:
        handler = _HANDLERS.get(event.type)
        if handler:
            return await handler(event, context)
        # Pass through unhandled event types unchanged
        return event


# ---------------------------------------------------------------------------
# Per-type handlers
# ---------------------------------------------------------------------------

async def _handle_agent_join(event: Event, ctx: PipelineContext) -> Optional[Event]:
    """network.agent.join → upsert WorkspaceMember, set online."""
    from app.models import WorkspaceMember

    db = ctx.extra["db"]
    workspace = ctx.extra["workspace"]
    agent_name = event.payload.get("agent_name") if event.payload else None
    if not agent_name:
        logger.warning("workspace_mod: agent.join missing agent_name in payload")
        return None

    existing = db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.agent_name == agent_name,
        )
    ).scalar_one_or_none()

    now = datetime.now(timezone.utc)

    agent_type = event.payload.get("agent_type") if event.payload else None
    server_host = event.payload.get("server_host") if event.payload else None
    working_dir = event.payload.get("working_dir") if event.payload else None

    if existing:
        existing.status = "online"
        existing.last_heartbeat = now
        if agent_type and not existing.agent_type:
            existing.agent_type = agent_type
        if server_host:
            existing.server_host = server_host
        if working_dir:
            existing.working_dir = working_dir
    else:
        role = event.payload.get("role", "member")
        member = WorkspaceMember(
            workspace_id=workspace.id,
            agent_name=agent_name,
            role=role,
            agent_type=agent_type,
            server_host=server_host,
            working_dir=working_dir,
            status="online",
            last_heartbeat=now,
        )
        db.add(member)

    workspace.last_activity_at = now
    db.flush()

    # Enrich event metadata with resolved info
    event.metadata["role"] = existing.role if existing else event.payload.get("role", "member")
    event.metadata["network_id"] = str(workspace.id)
    return event


async def _handle_agent_leave(event: Event, ctx: PipelineContext) -> Optional[Event]:
    """network.agent.leave → set member offline."""
    from app.models import WorkspaceMember

    db = ctx.extra["db"]
    workspace = ctx.extra["workspace"]
    agent_name = event.payload.get("agent_name") if event.payload else None
    if not agent_name:
        return None

    member = db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.agent_name == agent_name,
        )
    ).scalar_one_or_none()

    if not member:
        return None

    member.status = "offline"
    db.flush()
    return event


async def _handle_agent_remove(event: Event, ctx: PipelineContext) -> Optional[Event]:
    """network.agent.remove → delete WorkspaceMember, reassign master if needed."""
    from app.models import Channel, WorkspaceMember

    db = ctx.extra["db"]
    workspace = ctx.extra["workspace"]
    agent_name = event.payload.get("agent_name") if event.payload else None
    if not agent_name:
        logger.warning("workspace_mod: agent.remove missing agent_name in payload")
        return None

    member = db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.agent_name == agent_name,
        )
    ).scalar_one_or_none()

    if not member:
        return None

    was_master = member.role == "master"
    db.delete(member)
    db.flush()

    new_master_name = None

    # If removed agent was master, promote the next available agent
    if was_master:
        next_master = db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace.id,
            ).order_by(WorkspaceMember.joined_at.asc())
        ).scalar_one_or_none()

        if next_master:
            next_master.role = "master"
            new_master_name = next_master.agent_name
            db.flush()

    # Reassign channel masters: any channel where removed agent was master
    channels = db.execute(
        select(Channel).where(
            Channel.workspace_id == workspace.id,
            Channel.master_agent == agent_name,
        )
    ).scalars().all()

    for ch in channels:
        ch.master_agent = new_master_name
    db.flush()

    event.metadata["removed_agent"] = agent_name
    if new_master_name:
        event.metadata["new_master"] = new_master_name
    return event


async def _handle_ping(event: Event, ctx: PipelineContext) -> Optional[Event]:
    """network.ping → update heartbeat timestamp."""
    from app.models import WorkspaceMember

    db = ctx.extra["db"]
    workspace = ctx.extra["workspace"]
    agent_name = event.payload.get("agent_name") if event.payload else None
    if not agent_name:
        return None

    member = db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.agent_name == agent_name,
        )
    ).scalar_one_or_none()

    if not member:
        return None

    now = datetime.now(timezone.utc)
    member.status = "online"
    member.last_heartbeat = now
    db.flush()
    return event


async def _handle_channel_create(event: Event, ctx: PipelineContext) -> Optional[Event]:
    """network.channel.create → create Channel + initial ChannelMember rows."""
    from app.models import Channel, ChannelMember

    db = ctx.extra["db"]
    workspace = ctx.extra["workspace"]
    payload = event.payload or {}

    channel = Channel(
        workspace_id=workspace.id,
        name=payload.get("name", f"channel-{event.id[:8]}"),
        title=payload.get("title"),
        created_by=event.source,
        master_agent=payload.get("master"),
        resume_from=payload.get("resume_from"),
        status="active",
    )
    db.add(channel)
    db.flush()  # get channel.id

    # Add initial participants
    participants = payload.get("participants", [])
    for agent_name in participants:
        db.add(ChannelMember(channel_id=channel.id, agent_name=agent_name))

    db.flush()

    # Enrich event with created channel info
    event.metadata["channel_id"] = str(channel.id)
    event.metadata["channel_name"] = channel.name
    event.target = f"channel/{channel.name}"
    return event


async def _handle_channel_join(event: Event, ctx: PipelineContext) -> Optional[Event]:
    """network.channel.join → add ChannelMember."""
    from app.models import Channel, ChannelMember

    db = ctx.extra["db"]
    workspace = ctx.extra["workspace"]
    payload = event.payload or {}
    channel_name = payload.get("channel")
    agent_name = payload.get("agent_name")
    if not channel_name or not agent_name:
        return None

    channel = db.execute(
        select(Channel).where(
            Channel.workspace_id == workspace.id,
            Channel.name == channel_name,
        )
    ).scalar_one_or_none()
    if not channel:
        return None

    # Check if already a member
    existing = db.execute(
        select(ChannelMember).where(
            ChannelMember.channel_id == channel.id,
            ChannelMember.agent_name == agent_name,
        )
    ).scalar_one_or_none()

    if not existing:
        db.add(ChannelMember(channel_id=channel.id, agent_name=agent_name))
        # Auto-promote first agent to channel master if none set
        if not channel.master_agent:
            channel.master_agent = agent_name
        db.flush()

    return event


async def _handle_channel_leave(event: Event, ctx: PipelineContext) -> Optional[Event]:
    """network.channel.leave → remove ChannelMember."""
    from app.models import Channel, ChannelMember

    db = ctx.extra["db"]
    workspace = ctx.extra["workspace"]
    payload = event.payload or {}
    channel_name = payload.get("channel")
    agent_name = payload.get("agent_name")
    if not channel_name or not agent_name:
        return None

    channel = db.execute(
        select(Channel).where(
            Channel.workspace_id == workspace.id,
            Channel.name == channel_name,
        )
    ).scalar_one_or_none()
    if not channel:
        return None

    member = db.execute(
        select(ChannelMember).where(
            ChannelMember.channel_id == channel.id,
            ChannelMember.agent_name == agent_name,
        )
    ).scalar_one_or_none()

    if member:
        db.delete(member)
        db.flush()

    return event


def _extract_mentions(content: str, known_agents: List[str]) -> List[str]:
    """Parse @agent-name mentions from message text, validated against known agents."""
    if not content or not known_agents:
        return []
    # Match @word patterns (agent names are alphanumeric + hyphens)
    raw_mentions = re.findall(r"@([\w-]+)", content)
    # Only return mentions that match actual workspace members
    known_set = set(known_agents)
    return [m for m in raw_mentions if m in known_set]


def _extract_leading_mention(content: str, known_agents: List[str]) -> Optional[str]:
    """Return the agent name if the message starts with @agent-name, else None."""
    if not content or not known_agents:
        return None
    m = re.match(r"^\s*@([\w-]+)", content)
    if m and m.group(1) in set(known_agents):
        return m.group(1)
    return None


def _fallback_targets(event, channel, mentions: List[str]) -> List[str]:
    """Determine target agents when LLM router is unavailable.

    Priority: explicit @mentions → master (for human/member msgs) → all participants.
    """
    if mentions:
        return [mentions[0]]
    if channel.master_agent:
        if event.source.startswith("openagents:"):
            sender = event.source[len("openagents:"):]
            # Master's own messages: no self-trigger
            if sender == channel.master_agent:
                return []
        return [channel.master_agent]
    # No master — target the first participant
    participants = [p.agent_name for p in (channel.participants or [])]
    return [participants[0]] if participants else []


_ROUTER_PROMPT = """\
You are a conversation router for a multi-agent workspace. Your job is to \
decide which agent(s) should respond next.

Channel participants:
{participants}
Master agent: {master}

Recent conversation:
{history}

New message from {sender}:
{content}

Rules:
- If the message contains @agent-name mentions, those are strong hints — route to the mentioned agent(s).
- If the sender (human or agent) is delegating a task, route to the most appropriate agent for that task.
- If the sender is reporting results and the master should review or synthesize, output the master.
- If a human asks a general question or gives a broad instruction, route to the master agent.
- If the response is a final answer or conclusion meant for the human user, output STOP.
- If the task appears complete and no further agent action is needed, output STOP.
- When in doubt between STOP and routing, prefer routing to the master agent.

Output EXACTLY one line, no explanation:
- "next:<agent_name>" to trigger exactly one agent
- "stop" if no agent should be triggered"""


def _get_router_api_key() -> str:
    """Resolve the API key: ROUTER_LLM_API_KEY takes priority, then ANTHROPIC_API_KEY."""
    from app.config import config
    return config.ROUTER_LLM_API_KEY or config.ANTHROPIC_API_KEY


def _get_router_model() -> str:
    """Resolve the model: explicit config or provider default."""
    from app.config import config
    if config.ROUTER_LLM_MODEL:
        return config.ROUTER_LLM_MODEL
    if config.ROUTER_LLM_PROVIDER == "openai":
        return "gpt-4o-mini"
    return "claude-haiku-4-5-20251001"


def _get_llm_client():
    """Lazy-init the LLM client based on provider config."""
    global _llm_client, _llm_provider
    from app.config import config

    provider = config.ROUTER_LLM_PROVIDER
    if _llm_client is not None and _llm_provider == provider:
        return _llm_client, provider

    api_key = _get_router_api_key()

    if provider == "openai":
        from openai import OpenAI
        kwargs = {"api_key": api_key}
        if config.ROUTER_LLM_BASE_URL:
            kwargs["base_url"] = config.ROUTER_LLM_BASE_URL
        _llm_client = OpenAI(**kwargs)
    else:
        import anthropic
        _llm_client = anthropic.Anthropic(api_key=api_key)

    _llm_provider = provider
    return _llm_client, provider


async def _route_with_llm(channel, new_event: Event, db, workspace) -> List[str]:
    """Use a small LLM to decide which agent(s) should respond next.

    Returns a list of agent names to target, or an empty list (stop).
    Falls back to empty list on any error.
    """
    from app.config import config
    from app.models import EventRecord

    if not _get_router_api_key():
        logger.warning("LLM router: no API key set (ROUTER_LLM_API_KEY or ANTHROPIC_API_KEY), defaulting to stop")
        return []

    # Fetch last 5 chat messages from this channel
    channel_target = f"channel/{channel.name}"
    recent = db.execute(
        select(EventRecord)
        .where(
            EventRecord.network_id == workspace.id,
            EventRecord.target == channel_target,
            EventRecord.type == "workspace.message.posted",
        )
        .order_by(EventRecord.timestamp.desc())
        .limit(5)
    ).scalars().all()

    # Build conversation history (oldest first)
    recent.reverse()
    history_lines = []
    for evt in recent:
        payload = evt.payload or {}
        msg_type = payload.get("message_type", "chat")
        if msg_type in ("thinking", "status"):
            continue
        source = evt.source
        if source.startswith("human:"):
            label = "human"
        elif source.startswith("openagents:"):
            label = source[len("openagents:"):]
        else:
            label = source
        text = (payload.get("content") or "")[:500]  # Truncate long messages
        history_lines.append(f"[{label}] {text}")

    history = "\n".join(history_lines) if history_lines else "(no prior messages)"

    # Participant list with role/description for better routing
    from app.models import WorkspaceMember
    participant_names = [p.agent_name for p in (channel.participants or [])]
    members = {
        m.agent_name: m for m in db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace.id,
                WorkspaceMember.agent_name.in_(participant_names),
            )
        ).scalars().all()
    }
    participant_lines = []
    for name in participant_names:
        m = members.get(name)
        role = m.role if m else "member"
        desc = m.description if m and m.description else ""
        line = f"  - {name} (role: {role})"
        if desc:
            line += f" — {desc}"
        participant_lines.append(line)
    participants_str = "\n".join(participant_lines) if participant_lines else "  (none)"

    master = channel.master_agent or "(none)"
    sender = new_event.source
    if sender.startswith("openagents:"):
        sender = sender[len("openagents:"):]

    content = (new_event.payload or {}).get("content", "")[:500]

    prompt = _ROUTER_PROMPT.format(
        participants=participants_str,
        master=master,
        history=history,
        sender=sender,
        content=content,
    )

    try:
        client, provider = _get_llm_client()
        model = _get_router_model()

        # Synchronous LLM call — fast (~500ms) router decision
        if provider == "openai":
            response = client.chat.completions.create(
                model=model,
                max_tokens=30,
                messages=[{"role": "user", "content": prompt}],
            )
            result = response.choices[0].message.content.strip().lower()
        else:
            response = client.messages.create(
                model=model,
                max_tokens=30,
                messages=[{"role": "user", "content": prompt}],
            )
            result = response.content[0].text.strip().lower()

        logger.info("LLM router decision: %s (channel=%s, sender=%s, provider=%s)", result, channel.name, sender, provider)

        if result.startswith("next:"):
            agent_name = result[len("next:"):].strip().split(",")[0].strip()
            # Validate against actual participants
            valid_participants = {p.agent_name for p in (channel.participants or [])}
            if agent_name in valid_participants:
                return [agent_name]
            logger.warning("LLM router returned unknown agent: %s (valid: %s)", agent_name, valid_participants)
            return []
        else:
            # "stop" or any unrecognized output → stop
            return []

    except Exception as e:
        logger.error("LLM router failed, defaulting to stop: %s", e)
        return []


_DEFAULT_TITLES = {"New Thread", "Session 1", None, ""}


def _auto_title_channel(channel, content: str, db) -> None:
    """Set channel title from message content if still using a default title."""
    if channel.title not in _DEFAULT_TITLES:
        return
    if not content or not content.strip():
        return
    # Use first line, truncated to 60 chars
    first_line = content.strip().split("\n")[0]
    title = first_line[:60].rstrip()
    if len(first_line) > 60:
        title += "..."
    channel.title = title
    db.flush()


async def _handle_message_posted(event: Event, ctx: PipelineContext) -> Optional[Event]:
    """
    workspace.message.posted → route messages to the right agents.

    Routing rules (human messages):
    - Starts with @agent-name → route to that agent only
    - No leading @mention → channel master (or all participants if no master)

    Routing rules (agent messages in multi-agent threads):
    - LLM router (Haiku) evaluates the last few messages and decides:
      - "next:agent-name" → route to that agent
      - "stop" → no targeting, conversation rests until human speaks
    - Fallback (single-agent threads or router disabled): no routing needed.
    """
    from app.models import Channel, WorkspaceMember

    db = ctx.extra["db"]
    workspace = ctx.extra["workspace"]
    payload = event.payload or {}
    content = payload.get("content", "")
    message_type = payload.get("message_type", "chat")

    # "thinking" and "status" messages are intermediate agent output —
    # they should NOT trigger other agents.
    if message_type in ("thinking", "status"):
        return event

    # Parse @mentions from message content (used for human message routing)
    known_agents = [
        m.agent_name for m in db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace.id,
            )
        ).scalars().all()
    ]
    mentions = _extract_mentions(content, known_agents)

    # Resolve channel (needed for both agent and human message routing)
    channel = None
    if event.target.startswith("channel/"):
        channel_name = event.target[len("channel/"):]
        channel = db.execute(
            select(Channel).where(
                Channel.workspace_id == workspace.id,
                Channel.name == channel_name,
            )
        ).scalar_one_or_none()

    # Auto-name channel from first human message if title is default/empty
    if event.source.startswith("human:") and channel:
        _auto_title_channel(channel, content, db)

    # Skip non-human, non-agent sources
    if not event.source.startswith("human:") and not event.source.startswith("openagents:"):
        return event

    if not channel:
        return event

    # ── Multi-agent channel: always use LLM router ──────────────────
    if len(channel.participants or []) >= 2:
        from app.config import config
        if config.ROUTER_LLM_ENABLED and _get_router_api_key():
            targets = await _route_with_llm(channel, event, db, workspace)
            if targets:
                event.metadata["target_agents"] = targets
            # else: stop — conversation rests, no targeting
        else:
            # LLM router not available — fallback to mention or master
            targets = _fallback_targets(event, channel, mentions)
            if targets:
                event.metadata["target_agents"] = targets
    # ── Single-agent channel ────────────────────────────────────────
    else:
        targets = _fallback_targets(event, channel, mentions)
        if targets:
            event.metadata["target_agents"] = targets

    # Auto-add targeted agents as channel participants so they can poll
    # for messages on this channel.
    from app.models import ChannelMember
    existing = {p.agent_name for p in (channel.participants or [])}
    for agent_name in event.metadata.get("target_agents", []):
        if agent_name not in existing:
            db.add(ChannelMember(channel_id=channel.id, agent_name=agent_name))
            existing.add(agent_name)
    db.flush()

    return event


# ---------------------------------------------------------------------------
# Handler dispatch table
# ---------------------------------------------------------------------------

_HANDLERS = {
    "network.agent.join": _handle_agent_join,
    "network.agent.leave": _handle_agent_leave,
    "network.agent.remove": _handle_agent_remove,
    "network.ping": _handle_ping,
    "network.channel.create": _handle_channel_create,
    "network.channel.join": _handle_channel_join,
    "network.channel.leave": _handle_channel_leave,
    WorkspaceEventTypes.MESSAGE_POSTED: _handle_message_posted,
}
