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
from typing import List, Optional, Tuple

from sqlalchemy import select

from openagents.core.onm_events import Event, WorkspaceEventTypes
from openagents.core.onm_mods import EventRejected, PipelineContext, TransformMod

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
    """network.agent.join → upsert WorkspaceMember, set online, rotate session."""
    import uuid as _uuid
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

    # A removed agent must not resurrect itself by re-joining. Its daemon
    # reconnects and re-POSTs /v1/join, which would otherwise upsert the row
    # back to status='online' — exactly the "removed agent still appears" bug.
    # Re-adding is a human action (POST /v1/cloud-agents reactivates the row).
    # Raising EventRejected makes _emit_event return None → /v1/join 401s.
    # (issue #347)
    if existing and existing.status == "removed":
        logger.info(
            "workspace_mod: refused re-join of removed agent %s in %s",
            agent_name, workspace.id,
        )
        raise EventRejected("workspace_mod", "agent_removed")

    now = datetime.now(timezone.utc)

    agent_type = event.payload.get("agent_type") if event.payload else None
    server_host = event.payload.get("server_host") if event.payload else None
    working_dir = event.payload.get("working_dir") if event.payload else None

    # Rotate session on every join. Any prior client holding the old
    # session_id (ghost adapter, duplicate daemon) gets rejected when it
    # next heartbeats or posts, which tells it to stop.
    new_session_id = _uuid.uuid4().hex

    if existing:
        prior_session = existing.session_id
        existing.status = "online"
        existing.last_heartbeat = now
        existing.session_id = new_session_id
        existing.session_started_at = now
        if agent_type and not existing.agent_type:
            existing.agent_type = agent_type
        if server_host:
            existing.server_host = server_host
        if working_dir:
            existing.working_dir = working_dir
        if prior_session and prior_session != new_session_id:
            logger.info(
                "workspace_mod: rotated session for %s in %s (prior session revoked)",
                agent_name, workspace.id,
            )
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
            session_id=new_session_id,
            session_started_at=now,
        )
        db.add(member)

    workspace.last_activity_at = now
    db.flush()

    # Enrich event metadata with resolved info + session_id so the
    # router returns it to the joining client.
    event.metadata["role"] = existing.role if existing else event.payload.get("role", "member")
    event.metadata["network_id"] = str(workspace.id)
    event.metadata["session_id"] = new_session_id
    return event


def _validate_session(db, workspace_id, agent_name: str, claimed_session: Optional[str]) -> Optional[str]:
    """Check that claimed_session matches the current session for this agent.

    Returns None if valid or legacy (nothing to enforce), else an error code
    string ("session_revoked" | "session_missing") that callers can surface.

    Semantics:
      - stored=None      → legacy member, accept anything (transition)
      - stored=X, claim=None → legacy client, accept (transition)
      - stored=X, claim=X → valid
      - stored=X, claim=Y → revoked: another client joined as this agent
    """
    from app.models import WorkspaceMember

    member = db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.agent_name == agent_name,
        )
    ).scalar_one_or_none()
    if not member or not member.session_id:
        return None  # legacy or not-yet-joined
    if not claimed_session:
        return None  # legacy client that hasn't learned session_id yet
    if claimed_session != member.session_id:
        return "session_revoked"
    return None


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
    # Soft-delete: keep the row (status='removed') so a re-add can reactivate
    # the agent and so _handle_agent_join can refuse to resurrect it. Hard-
    # deleting left nothing to stop a still-running daemon from re-joining and
    # upserting the membership back to online — the removed agent reappeared.
    # (issue #347)
    member.status = "removed"
    db.flush()

    new_master_name = None

    # If removed agent was master, promote the next available (non-removed) agent
    if was_master:
        next_master = db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace.id,
                WorkspaceMember.status != "removed",
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
    """network.ping → update heartbeat timestamp.

    Validates session_id if the client sent one. A mismatch means a newer
    client has joined as this agent; we drop this heartbeat and mark the
    event metadata so the caller can surface session_revoked to the
    stale client, which will then stop.
    """
    from app.models import WorkspaceMember

    db = ctx.extra["db"]
    workspace = ctx.extra["workspace"]
    agent_name = event.payload.get("agent_name") if event.payload else None
    if not agent_name:
        return None

    claimed_session = (event.payload or {}).get("session_id")
    err = _validate_session(db, workspace.id, agent_name, claimed_session)
    if err == "session_revoked":
        event.metadata["session_error"] = err
        logger.info(
            "workspace_mod: rejected heartbeat for %s in %s (stale session_id)",
            agent_name, workspace.id,
        )
        return event

    member = db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.agent_name == agent_name,
        )
    ).scalar_one_or_none()

    if not member:
        return None

    # A removed agent's still-running daemon keeps heartbeating; without this
    # guard the line below would flip it back to status='online'. Surface
    # session_revoked so the caller stops its adapter for this agent. (issue #347)
    if member.status == "removed":
        event.metadata["session_error"] = "session_revoked"
        logger.info(
            "workspace_mod: rejected heartbeat for removed agent %s in %s",
            agent_name, workspace.id,
        )
        return event

    now = datetime.now(timezone.utc)
    member.status = "online"
    member.last_heartbeat = now
    db.flush()
    return event


async def _handle_channel_create(event: Event, ctx: PipelineContext) -> Optional[Event]:
    """network.channel.create → create Channel + initial ChannelMember rows."""
    from app.models import Channel, ChannelMember, ChannelHumanMember, WorkspaceCollaborator

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

    # Add initial agent participants (filter out routing sentinels)
    participants = payload.get("participants", [])
    for agent_name in participants:
        if agent_name == "__no_response__":
            continue
        db.add(ChannelMember(channel_id=channel.id, agent_name=agent_name))

    # Add initial human participants. Each email gets both a workspace
    # collaborator row (so the mention picker shows them everywhere) and
    # a channel_human_members row (so push fan-out for any message in
    # this channel reaches their devices, not just @-mentions).
    human_participants = payload.get("human_participants", []) or []
    for email_raw in human_participants:
        email = (email_raw or "").strip().lower()
        if not email or "@" not in email:
            continue
        # Upsert collaborator — same trust model as _upsert_human_collaborator
        existing_collab = db.execute(
            select(WorkspaceCollaborator).where(
                WorkspaceCollaborator.workspace_id == str(workspace.id),
                WorkspaceCollaborator.email == email,
            )
        ).scalar_one_or_none()
        if not existing_collab:
            db.add(WorkspaceCollaborator(
                workspace_id=str(workspace.id),
                email=email,
                role="editor",
                added_by=event.source or email,
            ))
        # Upsert channel membership so chat-path pushes go to them.
        existing_member = db.execute(
            select(ChannelHumanMember).where(
                ChannelHumanMember.channel_id == channel.id,
                ChannelHumanMember.user_email == email,
            )
        ).scalar_one_or_none()
        if not existing_member:
            db.add(ChannelHumanMember(channel_id=channel.id, user_email=email))

    db.flush()

    # Enrich event with created channel info
    event.metadata["channel_id"] = str(channel.id)
    event.metadata["channel_name"] = channel.name
    event.target = f"channel/{channel.name}"
    return event


def _is_channel_admin(event_source: str, channel, agent_name: str) -> bool:
    """Who is allowed to manage channel membership.

    Three sources are accepted:
      • a human user (`human:<name>`) — workspace clients act on behalf
        of the logged-in human
      • the channel's master agent (`openagents:<master>`) — owner can
        manage their own thread
      • the agent being added/removed itself (`openagents:<agent_name>`) —
        agents can join channels they've been invited to and leave on
        their own initiative
    """
    src = event_source or ""
    if src.startswith("human:"):
        return True
    if channel.master_agent and src == f"openagents:{channel.master_agent}":
        return True
    if src == f"openagents:{agent_name}":
        return True
    return False


async def _handle_channel_join(event: Event, ctx: PipelineContext) -> Optional[Event]:
    """network.channel.join → add ChannelMember.

    Routine channels (`routines:<agent>`) are locked single-agent queues —
    we raise EventRejected so clients can roll back any optimistic UI.
    The owner is added in-line when the channel is first created (see
    app/routers/routines.py).
    """
    from app.models import Channel, ChannelMember

    db = ctx.extra["db"]
    workspace = ctx.extra["workspace"]
    payload = event.payload or {}
    channel_name = payload.get("channel")
    agent_name = payload.get("agent_name")
    if not channel_name or not agent_name:
        return None

    if channel_name.startswith("routines:"):
        raise EventRejected(
            "workspace_mod",
            "routine_channel_locked: membership of routines:* is managed by the system",
        )

    channel = db.execute(
        select(Channel).where(
            Channel.workspace_id == workspace.id,
            Channel.name == channel_name,
        )
    ).scalar_one_or_none()
    if not channel:
        raise EventRejected("workspace_mod", "channel_not_found")

    if not _is_channel_admin(event.source or "", channel, agent_name):
        raise EventRejected(
            "workspace_mod",
            "channel_join_forbidden: only humans, the channel master, or "
            "the agent being added may invite",
        )

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
    """network.channel.leave → remove ChannelMember.

    Routine channels are locked — removing the owner is rejected so the
    queue keeps its single-agent invariant. Returns EventRejected so
    clients can roll back optimistic UI.
    """
    from app.models import Channel, ChannelMember

    db = ctx.extra["db"]
    workspace = ctx.extra["workspace"]
    payload = event.payload or {}
    channel_name = payload.get("channel")
    agent_name = payload.get("agent_name")
    if not channel_name or not agent_name:
        return None

    if channel_name.startswith("routines:"):
        raise EventRejected(
            "workspace_mod",
            "routine_channel_locked: membership of routines:* is managed by the system",
        )

    channel = db.execute(
        select(Channel).where(
            Channel.workspace_id == workspace.id,
            Channel.name == channel_name,
        )
    ).scalar_one_or_none()
    if not channel:
        raise EventRejected("workspace_mod", "channel_not_found")

    if not _is_channel_admin(event.source or "", channel, agent_name):
        raise EventRejected(
            "workspace_mod",
            "channel_leave_forbidden: only humans, the channel master, or "
            "the agent being removed may leave",
        )

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


def _member_is_online(m) -> bool:
    """True when a WorkspaceMember is actually live.

    A crashed daemon leaves ``status='online'`` forever — the column is only
    flipped to 'offline' on a *clean* leave/heartbeat-timeout path — so the
    column alone is unreliable. We additionally require a fresh heartbeat,
    matching how /v1/discover and the agents list compute liveness. Cloud
    agents have no heartbeat loop, so for them the status column is trusted.
    """
    from app.config import config
    from datetime import timedelta
    if (m.status or "").lower() != "online":
        return False
    if (getattr(m, "agent_type", "") or "").startswith("cloud:"):
        return True
    hb = m.last_heartbeat
    if not hb:
        return False
    if hb.tzinfo is None:
        hb = hb.replace(tzinfo=timezone.utc)
    timeout = timedelta(seconds=config.AGENT_TIMEOUT_SECONDS)
    return (datetime.now(timezone.utc) - hb) <= timeout


def _online_participant_names(db, workspace, channel) -> set:
    """Agent names of channel participants that are actually live (online column
    + fresh heartbeat). Routing prefers these so a thread whose previous agent
    went offline (e.g. a dead daemon) doesn't keep targeting it and stranding
    messages. Returns an empty set when status can't be resolved (callers then
    fall back to treating all participants as candidates)."""
    from app.models import WorkspaceMember
    names = [p.agent_name for p in (channel.participants or [])]
    if not names:
        return set()
    try:
        rows = db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace.id,
                WorkspaceMember.agent_name.in_(names),
            )
        ).scalars().all()
        return {m.agent_name for m in rows if _member_is_online(m)}
    except Exception:
        return set()


def _fallback_targets(event, channel, mentions: List[str], online_names: set = None) -> List[str]:
    """Determine target agents when LLM router is unavailable.

    Priority: explicit @mentions → master (for human/member msgs) → online
    participant → any participant. When ``online_names`` is provided, an online
    participant is chosen over an offline one so messages aren't stranded on a
    dead agent. An explicit @mention is always honored as-is (the user chose it).
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
    # No master — prefer an online participant, else the first participant.
    participants = [p.agent_name for p in (channel.participants or [])]
    if online_names:
        online_first = [p for p in participants if p in online_names]
        if online_first:
            return [online_first[0]]
    return [participants[0]] if participants else []


def _master_targets(event, channel, mentions: List[str]) -> List[str]:
    """Deterministic routing for "master" orchestration mode (star topology).

    The channel master is the single hub:
      • human message      → the master (the master owns the request and
        decides whether to answer or delegate)
      • sub-agent message  → back to the master (results always return to
        the hub, which decides the next hop)
      • master's message   → if it @mentions sub-agents, delegate to them;
        otherwise stop (the master answered the human directly)

    Falls back to nothing (empty → sentinel) when the channel has no master;
    callers may substitute the generic fallback in that case.
    """
    master = channel.master_agent
    if not master:
        return []

    source = event.source or ""
    if source.startswith("openagents:"):
        sender = source[len("openagents:"):]
        if sender == master:
            # Master is delegating. Route to any mentioned sub-agents
            # (never itself); no mention → the master answered, so stop.
            participants = {p.agent_name for p in (channel.participants or [])}
            delegated = [
                m for m in mentions if m != master and m in participants
            ]
            return delegated
        # A sub-agent spoke → return control to the master hub.
        return [master]

    # Human (or system) message → always the master.
    return [master]


# ---------------------------------------------------------------------------
# Delegation receipts — deterministic "result returns to the delegator"
# ---------------------------------------------------------------------------

# reply_kind values a connector may stamp on a terminal reply. Anything else
# (missing, empty, unknown) means the message is NOT a structured receipt and
# must fall through to normal routing.
_RECEIPT_REPLY_KINDS = frozenset({"result", "error", "needs_input", "cancelled"})

# Metadata keys owned by this mod. Event metadata arrives verbatim from the
# client, so an agent could submit a forged delegation chain; these keys are
# stripped from every inbound message and only written back by the routing
# logic below.
_SERVER_OWNED_METADATA = (
    "delegated_by", "delegated_to", "receipt_from", "needs_input_from",
)

# How many deterministic needs_input wake-ups one delegation event may produce
# per replier. needs_input is non-consuming (the real result must still be
# deliverable afterwards), so without a bound a single stale E1 would be an
# unlimited router bypass. Multiple questions within one turn are legitimate
# (e.g. Cline can surface several asks); past the cap the delegator is
# suppressed like a duplicate receipt.
_NEEDS_INPUT_LIMIT = 3


def _receipt_route(event: Event, channel, mentions: List[str], db, workspace) -> Optional[Tuple[List[str], List[str]]]:
    """Deterministically route a structured receipt back to its delegator.

    A receipt is an agent chat message stamped (by the connector) with
    ``in_reply_to`` — the event id of the delegation message E1 — and a valid
    ``reply_kind``. When every check below passes, the reply bypasses the LLM
    router and is routed straight to the delegating agent, so a delegated
    task's outcome can never be swallowed by a router "stop".

    Returns ``(targets, onward_delegates)`` on a hit — ``targets`` normally
    starts with the delegator; ``onward_delegates`` are additional agents the
    reply @mentions (an onward delegation, dual-routed so the delegator still
    sees the outcome). Returns ``None`` ONLY when the message is not an
    authenticated receipt, in which case the caller falls through to normal
    routing. An authenticated receipt whose delegator is undeliverable (left
    the channel, removed from the workspace) or already served returns
    ``(onward, onward)`` — possibly empty — so it can never re-enter
    master/LLM orchestration and be misrouted back to a stale delegator.
    Onward delegates are filtered the same way: a removed agent can never
    become a deterministic target.

    Delivery to the delegator is at-most-once per (E1, replier): the first
    terminal receipt stamps E1 with ``receipt_from`` (under a row lock, so
    concurrent duplicates cannot both claim it), and a later duplicate is
    still handled deterministically but with the delegator SUPPRESSED —
    returning it to the LLM router could re-route to the delegator and break
    the at-most-once guarantee. An explicit onward @mention in the duplicate
    is still honoured. ``needs_input`` receipts are non-consuming: an agent
    may surface a question mid-turn and still owe the real result (e.g.
    Cline's ask event followed by the final text), so only result / error /
    cancelled claim the single terminal slot. needs_input is still bounded
    (``_NEEDS_INPUT_LIMIT`` deterministic wake-ups per (E1, replier), tracked
    in server-owned ``needs_input_from``) so a stale E1 cannot become an
    unlimited router bypass. A replier that is itself no longer a live
    channel + workspace member gets nothing at all — not even onward — since
    the message entry point does not verify membership and a departed agent
    must not mint new delegations. If the delegator needs more work done it
    delegates again, creating a new E1.
    """
    from app.models import EventRecord

    source = event.source or ""
    if not source.startswith("openagents:"):
        return None
    replier = source[len("openagents:"):]

    meta = event.metadata or {}
    if meta.get("reply_kind") not in _RECEIPT_REPLY_KINDS:
        return None
    ref = meta.get("in_reply_to")
    if not ref or not isinstance(ref, str):
        return None

    # Row-lock E1 for the rest of the transaction: the duplicate check and
    # the receipt_from stamp below are a read-modify-write, and two replies
    # referencing the same E1 processed concurrently must not both claim the
    # single terminal receipt. SQLite (tests) ignores FOR UPDATE; Postgres
    # serializes the claim.
    e1 = db.execute(
        select(EventRecord).where(
            EventRecord.id == ref,
            EventRecord.network_id == workspace.id,
        ).with_for_update()
    ).scalar_one_or_none()
    if e1 is None or e1.type != WorkspaceEventTypes.MESSAGE_POSTED:
        return None
    # Same channel only — a receipt must not redirect traffic across channels.
    if e1.target != event.target:
        return None

    e1_meta = e1.metadata_ or {}
    delegator = e1_meta.get("delegated_by")
    # delegated_by is server-written, but still cross-check it against the
    # stored source so a routing bug can't be amplified into a misdelivery.
    if not delegator or e1.source != f"openagents:{delegator}":
        return None
    if delegator == replier:
        return None
    if replier not in (e1_meta.get("delegated_to") or []):
        return None

    # The delegation chain is authenticated from here on. Any further check
    # that fails means the receipt is REAL but must not be delivered to the
    # delegator — and it must NOT fall back into normal orchestration either:
    # _master_targets would route a sub-agent's message straight back to a
    # removed/stale master and the LLM router can re-select the delegator,
    # bypassing exactly the guard that just failed. Those cases return
    # (onward, onward): the delegator is suppressed (empty targets → the
    # caller's no-response sentinel) while an explicit onward @mention is
    # still honoured.
    participants = {p.agent_name for p in (channel.participants or [])}

    # Onward delegation: mentions other than the original delegator. A "@A
    # I'm done" style report must NOT count as a new delegation back to A —
    # that would bounce A's acknowledgement to the replier and re-create the
    # ping-pong this whole mechanism exists to prevent. In master mode the
    # star topology stays authoritative: sub-agents cannot delegate onward,
    # so mentions are ignored (matching _master_targets).
    mode = (getattr(channel, "orchestration_mode", None) or "dynamic").lower()
    onward: List[str] = []
    if mode != "master":
        seen = {delegator, replier}
        for m in mentions:
            if m not in seen and m in participants:
                onward.append(m)
                seen.add(m)

    # Everyone the receipt would target — the delegator AND any onward
    # delegates — must be a live workspace member. ChannelMember rows are
    # not cleaned up when a workspace member is removed (remove_member
    # deletes only the WorkspaceMember row; network removal soft-deletes
    # with status "removed") and mention parsing does not exclude removed
    # members, so a stale channel participant could otherwise become a
    # deterministic target that can no longer poll the workspace.
    from app.models import WorkspaceMember
    names_to_check = list({delegator, replier, *onward})
    live_members = {
        m.agent_name for m in db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace.id,
                WorkspaceMember.agent_name.in_(names_to_check),
            )
        ).scalars().all()
        if (m.status or "") != "removed"
    }
    onward = [c for c in onward if c in live_members]

    # A replier that is no longer a live channel + workspace member must not
    # be able to mint new delegations from a stale E1: the message entry
    # point validates only the workspace token/session, not membership
    # (_validate_session passes for removed members). Suppress EVERYTHING,
    # onward included.
    if replier not in participants or replier not in live_members:
        return [], []

    # A gone delegator only loses their own delivery — the (valid, live)
    # onward delegation in the same reply is still honoured.
    if delegator not in participants or delegator not in live_members:
        return list(onward), onward

    already = e1_meta.get("receipt_from") or []
    if replier in already:
        # Duplicate terminal receipt: the delegator already got their one
        # delivery.
        return list(onward), onward

    # No TTL gate: an authenticated receipt deterministically delivers once
    # and claims the (E1, replier) slot regardless of E1's age. receipt_from
    # already caps delivery at once, so an age cutoff would add nothing
    # except a window where a LATE first result bypasses the claim — its
    # duplicates would then be re-delivered forever via fallback routing.
    # Long-running tasks finishing days later are the normal case this
    # feature exists for, not abuse.

    if meta.get("reply_kind") == "needs_input":
        # Non-consuming (the real result must still be deliverable), but
        # bounded — see _NEEDS_INPUT_LIMIT.
        asked = dict(e1_meta.get("needs_input_from") or {})
        count = int(asked.get(replier, 0) or 0)
        if count >= _NEEDS_INPUT_LIMIT:
            return list(onward), onward
        asked[replier] = count + 1
        stamped = dict(e1_meta)
        stamped["needs_input_from"] = asked
        e1.metadata_ = stamped
        db.flush()
    else:
        # Claim the single terminal receipt.
        stamped = dict(e1_meta)
        stamped["receipt_from"] = already + [replier]
        e1.metadata_ = stamped
        db.flush()

    return [delegator] + onward, onward


_ROUTER_PROMPT = """\
You are a conversation router for a multi-agent workspace. Decide which \
agent should respond next to the LATEST message. Use judgment — read the \
message carefully and think about who is actually being addressed.

Channel participants:
{participants}
Master agent: {master}
{plan}
Recent conversation (oldest → newest):
{history}

LATEST message from {sender}:
{content}

HOW TO DECIDE:

A. Identify who (if anyone) is being directly addressed.
   Treat @agent-name as ADDRESSING that agent only when the agent is the \
subject being asked to do/say something. If the agent is merely referenced \
("check @Alice's note, Bob" — Alice is referred to, Bob is addressed), \
pick the addressed agent, not the mentioned one.

B. If the LATEST message is from a HUMAN:
   - Always pick exactly one agent. Humans expect a reply — never output \
"stop" for a human message.
   - Prefer whoever is directly addressed.
   - If nobody is directly addressed, check CONVERSATIONAL CONTINUITY: \
if the user was just conversing with a specific agent (the last agent \
reply was from agent X, or X asked the user a question that this message \
appears to answer), continue with that agent X.
   - Otherwise pick the agent whose role/description best fits the topic; \
fall back to the master agent.

C. If the LATEST message is from an AGENT:
   - If it delegates or hands off to another agent ("@Alice please do X", \
"Alice, could you check X"), route to that agent.
   - If it reports back to the master or asks the master to decide, route to the master.
   - If it is a FINAL answer to the previous human question or an \
acknowledgement ("done", "saved", "sounds good"), output "stop".
   - Never route back to the same agent that just spoke (no self-loops).
   - When unsure, prefer "stop" to avoid infinite agent-to-agent loops.

EXAMPLES:
  Human: "@alice what's the status?"                → next:alice
  Human: "check @alice's notes, @bob"                → next:bob       (bob is addressed)
  Human: "how about julia?"  (julia is not an agent) → next:<master>  (who owns that topic)
  Agent alice: "@bob can you verify?"                → next:bob
  Agent alice: "Done — results attached."            → stop
  Agent bob (master): "Here's the final answer ..."  → stop

  Conversational continuity examples:
    alice: "I'm here. What do you need?"
    Human: "do you know about X?"                    → next:alice     (continuing with alice)

    alice: "I pulled these results: [...]."
    Human: "thanks, can you also check Y?"           → next:alice     (follow-up to alice)

Output EXACTLY one line, lowercase, no punctuation or explanation:
  next:<agent_name>
  stop"""


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


async def _route_with_llm(
    channel, new_event: Event, db, workspace, workflow_instruction: Optional[str] = None
) -> List[str]:
    """Use a small LLM to decide which agent(s) should respond next.

    Returns a list of agent names to target, or an empty list (stop).
    Falls back to empty list on any error.

    ``workflow_instruction`` (set in "workflow" orchestration mode) is a
    user-authored natural-language collaboration plan. When present it is
    injected into the prompt as the authoritative routing policy, so the
    same router engine steers the thread according to the user's plan
    instead of the generic heuristics.
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
    # Only offer ONLINE participants to the router when any are online — an
    # offline agent (dead daemon) can't reply, so routing to it by
    # conversational continuity just strands the message. If none are online,
    # present all participants (the chosen one will pick the message up when it
    # reconnects).
    online_set = {
        n for n in participant_names
        if members.get(n) and _member_is_online(members[n])
    }
    candidate_names = [n for n in participant_names if n in online_set] if online_set else participant_names
    participant_lines = []
    for name in candidate_names:
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

    # In "workflow" mode, the user-authored plan is the authoritative routing
    # policy. Injected as its own block so the model weighs it above the
    # generic heuristics below.
    plan = ""
    if workflow_instruction and workflow_instruction.strip():
        plan = (
            "\nCOLLABORATION PLAN (authoritative — follow this exactly when "
            "deciding who speaks next; it overrides the generic guidance "
            "below):\n"
            f"{workflow_instruction.strip()}\n"
        )

    prompt = _ROUTER_PROMPT.format(
        participants=participants_str,
        master=master,
        plan=plan,
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
            raw_result = response.choices[0].message.content.strip()
        else:
            response = client.messages.create(
                model=model,
                max_tokens=30,
                messages=[{"role": "user", "content": prompt}],
            )
            raw_result = response.content[0].text.strip()

        # Case-insensitive keyword detection but preserve original case
        # of the agent name so we can match it against participants
        # (agent names are case-sensitive in the workspace).
        result = raw_result.lower()

        logger.info("LLM router decision: %s (channel=%s, sender=%s, provider=%s)", raw_result, channel.name, sender, provider)

        if result.startswith("next:"):
            # Preserve the original case from the model output so we can
            # match against participant names, which ARE case-sensitive.
            agent_name = raw_result[len("next:"):].strip().split(",")[0].strip()
            # Case-insensitive participant lookup, then canonicalize to
            # the stored case.
            # Validate against the candidate set (online participants when any
            # are online) so the router can't route to an offline agent while a
            # live one is available.
            participants_by_lower = {
                name.lower(): name for name in candidate_names
            }
            canonical = participants_by_lower.get(agent_name.lower())
            if canonical is None:
                logger.warning(
                    "LLM router returned unknown agent: %r (valid: %s)",
                    agent_name, list(participants_by_lower.values()),
                )
                # For human senders, fall through to the safety net below
                # so the user always gets a reply.
                if not (new_event.source or "").startswith("human:"):
                    return []
                agent_name = None
            else:
                agent_name = canonical
                # Reject self-loops — router sometimes picks the agent
                # who just spoke. Sender's adapter skips own messages but
                # legacy clients would still see the target and retry.
                if (new_event.source or "").startswith("openagents:"):
                    sender = new_event.source[len("openagents:"):]
                    if agent_name == sender:
                        logger.info("LLM router self-loop rejected: %s", sender)
                        return []
                return [agent_name]
        else:
            agent_name = None  # "stop" or unrecognized

        # Safety net: humans ALWAYS get a response. If the router said
        # "stop" (or returned an invalid agent) for a human message,
        # fall back to the master/fallback target. Without this, the
        # router can silently drop a legitimate follow-up question like
        # "how about Julia?" after a previous "final answer" message.
        if (new_event.source or "").startswith("human:"):
            fallback = _fallback_targets(new_event, channel, [], online_set)
            if fallback:
                logger.info(
                    "LLM router returned stop/invalid for human message — "
                    "routing to fallback %s instead", fallback,
                )
                return fallback
        return []

    except Exception as e:
        logger.error("LLM router failed, defaulting to fallback: %s", e)
        # Same safety net on exception: humans still get a reply.
        if (new_event.source or "").startswith("human:"):
            try:
                fallback = _fallback_targets(new_event, channel, [], online_set)
                if fallback:
                    return fallback
            except Exception:
                pass
        return []


_DEFAULT_TITLES = {"New Thread", "Session 1", None, ""}


def _upsert_human_collaborator(workspace, payload: dict, db) -> None:
    """First-write registration of a signed-in human into the workspace
    roster, used downstream by the push fan-out to resolve `@bary` →
    bary's device tokens. Reads `sender_email` and `sender_display_name`
    from the event payload (web/Swift clients pass them on every human
    chat post); does nothing if the email is missing — older clients
    that don't yet identify themselves can't be mention-pushed.
    """
    email = (payload.get("sender_email") or "").strip().lower()
    if not email:
        return
    display_name = (payload.get("sender_display_name") or "").strip() or None
    from app.models import WorkspaceCollaborator
    existing = db.execute(
        select(WorkspaceCollaborator).where(
            WorkspaceCollaborator.workspace_id == str(workspace.id),
            WorkspaceCollaborator.email == email,
        )
    ).scalar_one_or_none()
    if existing:
        # Keep display_name fresh in case the user renamed their Google
        # profile since last post.
        if display_name and existing.display_name != display_name:
            existing.display_name = display_name
        return
    db.add(WorkspaceCollaborator(
        workspace_id=str(workspace.id),
        email=email,
        display_name=display_name,
        role="editor",
        added_by=email,
    ))
    db.flush()


def _join_channel_as_human(channel, payload: dict, db) -> None:
    """Slack-style implicit join: the first time a human posts in a
    channel, add them to `channel_human_members` so future chat in this
    channel pushes to their devices. Idempotent — no-op when the row
    already exists. Needs `sender_email` on the payload; anonymous
    token-only visitors leave no membership trail and so don't get
    pushed for non-mention chat.
    """
    email = (payload.get("sender_email") or "").strip().lower()
    if not email or channel is None:
        return
    from app.models import ChannelHumanMember
    existing = db.execute(
        select(ChannelHumanMember).where(
            ChannelHumanMember.channel_id == channel.id,
            ChannelHumanMember.user_email == email,
        )
    ).scalar_one_or_none()
    if existing:
        return
    db.add(ChannelHumanMember(channel_id=channel.id, user_email=email))
    db.flush()


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

    # Event metadata is client-supplied verbatim — drop any inbound values for
    # the server-owned delegation keys so a forged delegation chain can never
    # enter the routing logic. They are re-written below when this handler
    # itself recognises an explicit delegation.
    for _key in _SERVER_OWNED_METADATA:
        event.metadata.pop(_key, None)

    # Reject posts from stale agent sessions. If the sender is an agent
    # and its claimed session_id does not match the current one in
    # WorkspaceMember, drop the event and flag it so the router can
    # return session_revoked to the client.
    if event.source and event.source.startswith("openagents:"):
        sender = event.source[len("openagents:"):]
        claimed_session = event.metadata.get("session_id") if event.metadata else None
        err = _validate_session(db, workspace.id, sender, claimed_session)
        if err == "session_revoked":
            event.metadata["session_error"] = err
            logger.info(
                "workspace_mod: rejected message from %s in %s (stale session_id)",
                sender, workspace.id,
            )
            # Return the event with the error flag but no content changes;
            # the router checks session_error and returns an error response.
            return event

    # "thinking", "status", and "todos" messages are intermediate agent output
    # — they should NOT trigger other agents.
    if message_type in ("thinking", "status", "todos"):
        return event

    # Parse @mentions from message content (used for human message routing).
    # Soft-removed members are excluded up front: a removed agent must not be
    # a mention candidate anywhere — not in routing, not in delegation marks.
    live_agents = {
        m.agent_name for m in db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace.id,
            )
        ).scalars().all()
        if (m.status or "") != "removed"
    }
    mentions = _extract_mentions(content, sorted(live_agents))

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
        # First post from a human → make sure they're in the workspace
        # roster so @-mention pushes can find their device tokens later.
        _upsert_human_collaborator(workspace, event.payload or {}, db)
        # First post in *this* channel → auto-join so future non-mention
        # chat in the channel pushes to this human's devices.
        _join_channel_as_human(channel, event.payload or {}, db)

    # Skip non-human, non-agent sources
    if not event.source.startswith("human:") and not event.source.startswith("openagents:"):
        return event

    if not channel:
        return event

    # Online participants — used so routing prefers a live agent over one whose
    # daemon is down (an offline target just strands the message).
    online_names = _online_participant_names(db, workspace, channel)

    # ── Multi-agent channel: route per the thread's orchestration mode ──
    real_participants = [
        p for p in (channel.participants or [])
        if p.agent_name != "__no_response__"
    ]
    participant_names = {p.agent_name for p in real_participants}

    # ── Sender gate for agent messages ──
    # The events entry point validates only the workspace token/session
    # (_validate_session passes for missing and soft-removed members), so a
    # departed agent can still post. Its messages must not enter routing at
    # all — via the receipt path OR a plain "@C do X" — or it could keep
    # minting server-marked delegations after removal. Live workspace
    # membership AND current channel membership are both required (routine
    # channels register their owner as a ChannelMember on creation).
    if event.source.startswith("openagents:"):
        _sender = event.source[len("openagents:"):]
        if _sender not in live_agents or _sender not in participant_names:
            logger.info(
                "workspace_mod: dropped message from departed agent %s in %s",
                _sender, channel.name,
            )
            event.metadata["target_agents"] = ["__no_response__"]
            return event

    # ── Structured delegation receipt: deterministic return to delegator ──
    # Checked before the participant-count branch so a receipt still lands
    # even when the channel has meanwhile shrunk around the pair (the helper
    # itself verifies both ends are current participants).
    receipt = None
    receipt_onward: List[str] = []
    # "error" is included: some adapters post terminal failures with
    # message_type="error" (e.g. OpenCode's classified errors), and a failed
    # delegation must still return to its delegator.
    if message_type in ("chat", "error"):
        receipt = _receipt_route(event, channel, mentions, db, workspace)

    if receipt is not None:
        targets, receipt_onward = receipt
        logger.info(
            "workspace_mod: receipt from %s routed to %s in %s",
            event.source, targets, channel.name,
        )
    elif len(real_participants) >= 2:
        from app.config import config
        mode = (getattr(channel, "orchestration_mode", None) or "dynamic").lower()

        if mode == "master":
            # Deterministic star topology — no LLM. If the channel somehow
            # has no master, fall back to the generic mention/online logic
            # so messages aren't stranded.
            if channel.master_agent:
                targets = _master_targets(event, channel, mentions)
            else:
                targets = _fallback_targets(event, channel, mentions, online_names)
        elif mode == "workflow" and config.ROUTER_LLM_ENABLED and _get_router_api_key():
            # LLM router steered by the user's natural-language plan.
            targets = await _route_with_llm(
                channel, event, db, workspace,
                workflow_instruction=getattr(channel, "orchestration_instruction", None),
            )
        elif config.ROUTER_LLM_ENABLED and _get_router_api_key():
            # "dynamic" (default) — generic LLM router.
            targets = await _route_with_llm(channel, event, db, workspace)
        else:
            # LLM router not available — fallback to mention or master.
            targets = _fallback_targets(event, channel, mentions, online_names)
    # ── Single-agent channel ────────────────────────────────────────
    else:
        targets = _fallback_targets(event, channel, mentions, online_names)

    # Agent-sourced routing may only target live, current participants: the
    # mention fallback can name a live agent outside the channel, and the
    # router/master candidate lists can include the stale ChannelMember row
    # of a removed agent. Human messages keep the wider net — agents a human
    # targets are auto-added to the channel below.
    if event.source.startswith("openagents:") and targets:
        targets = [t for t in targets if t in participant_names and t in live_agents]

    # ── Mark explicit delegations (server-owned metadata) ──
    # Only agent messages whose routed targets came from the sender's own
    # @mentions count as delegations; router-inferred hops (e.g. "report to
    # the master") are NOT marked, otherwise the recipient's acknowledgement
    # would bounce back as a receipt. Inside a receipt, only the onward
    # targets (mentions minus the original delegator) form a new delegation.
    if event.source.startswith("openagents:") and targets:
        sender = event.source[len("openagents:"):]
        if receipt is not None:
            delegates = [d for d in receipt_onward if d != sender]
        elif mentions and all(t in mentions for t in targets):
            delegates = [t for t in targets if t != sender]
        else:
            delegates = []
        if delegates:
            event.metadata["delegated_by"] = sender
            event.metadata["delegated_to"] = delegates

    # ALWAYS set target_agents, even when nobody should respond.
    #
    # Use a non-empty sentinel list ["__no_response__"] instead of []
    # because legacy clients (pre-0.2.106) check `!targets.length ||
    # targets.includes(agentName)` — an empty list is truthy-skipped
    # and falls through to broadcast, so every agent in the channel
    # replies at once. A non-empty list that contains no real agent
    # name causes old clients to reject (they fail the includes check)
    # and new clients to treat it as "nobody" (the sentinel is ignored).
    event.metadata["target_agents"] = targets if targets else ["__no_response__"]

    # Auto-add targeted agents as channel participants so they can poll
    # for messages on this channel. Three guards:
    #   1. Never add the `__no_response__` sentinel — it's a routing
    #      signal, not a real agent.
    #   2. Only auto-add when the sender is a human. Agent→agent routing
    #      decisions (from the LLM router or master-fallback) used to
    #      drag bystander agents into channels they didn't belong in.
    #   3. Routine channels (`routines:<agent>`) are locked single-agent
    #      job queues — never add anyone but the owner.
    if event.source and event.source.startswith("human:") and \
            not channel.name.startswith("routines:"):
        from app.models import ChannelMember
        existing = {p.agent_name for p in (channel.participants or [])}
        # Clean up any __no_response__ sentinels that leaked into participants
        if "__no_response__" in existing:
            bogus = db.execute(
                select(ChannelMember).where(
                    ChannelMember.channel_id == channel.id,
                    ChannelMember.agent_name == "__no_response__",
                )
            ).scalar_one_or_none()
            if bogus:
                db.delete(bogus)
            existing.discard("__no_response__")
        for agent_name in event.metadata.get("target_agents", []):
            if agent_name == "__no_response__":
                continue
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
