# -*- coding: utf-8 -*-
"""
Yumi — the first-party, built-in onboarding assistant.

Yumi is a *cloud agent* (runs in-process on the backend, see
``services/cloud_agent.py``) but differs from user-added cloud agents in three
ways:

1. It is **auto-provisioned** into every workspace (see ``provision_yumi``),
   rather than added by hand via ``POST /v1/cloud-agents``.
2. Its credentials are **server-held** and shared across all workspaces
   (``config.YUMI_*``) — never entered by the user, never persisted per
   workspace (the ``api_key`` column stores only a placeholder).
3. It runs a **tool-calling loop** (category ``"assistant"``) instead of a
   single chat round-trip, so it can actually help the user set things up
   (e.g. create a thread).

The built-in identity is the reserved provider ``"openagents"`` — that is what
``builtin`` is derived from everywhere (discover/workspace serializers,
frontend gating). See [[project_yumi_cloud_agent]].
"""

import json as _json
import logging
from typing import Optional

from sqlalchemy import select

from app.config import config
from app.models import CloudAgentConfig, WorkspaceMember

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Identity constants — the single source of truth for "what is the built-in".
# ---------------------------------------------------------------------------

YUMI_AGENT_NAME = "yumi"
YUMI_PROVIDER = "openagents"
YUMI_AGENT_TYPE = f"cloud:{YUMI_PROVIDER}"     # stored on the WorkspaceMember row
YUMI_CATEGORY = "assistant"                    # triggers the tool loop
# Placeholder stored in CloudAgentConfig.api_key (NOT NULL). The real key is
# resolved from config at call time so it can be rotated in one place.
YUMI_KEY_PLACEHOLDER = "__server_managed__"


def is_builtin_agent_type(agent_type: Optional[str]) -> bool:
    """True if a WorkspaceMember.agent_type belongs to the built-in assistant."""
    return (agent_type or "") == YUMI_AGENT_TYPE


def resolve_credentials(cloud_config: CloudAgentConfig) -> tuple[str, Optional[str]]:
    """Return (api_key, base_url) to use for a cloud agent.

    For the built-in ``openagents`` provider the key/base_url come from
    server config (shared, rotatable), NOT from the stored row.
    """
    if cloud_config.provider == YUMI_PROVIDER:
        return config.YUMI_API_KEY, (config.YUMI_BASE_URL or None)
    return cloud_config.api_key, cloud_config.base_url


# ---------------------------------------------------------------------------
# Provisioning
# ---------------------------------------------------------------------------

def should_provision() -> bool:
    """Only seed Yumi when enabled AND a server key is configured, so
    self-hosted deployments without a key don't get a broken agent."""
    return bool(config.YUMI_ENABLED and config.YUMI_API_KEY)


def provision_yumi(db, workspace) -> bool:
    """Idempotently add the built-in Yumi agent to a workspace.

    Creates the ``WorkspaceMember`` + ``CloudAgentConfig`` rows (mirroring
    ``POST /v1/cloud-agents``) if Yumi isn't already present. Caller is
    responsible for committing. Returns True if a row was added.

    NOTE: does not run when ``should_provision()`` is False.
    """
    if not should_provision():
        return False

    workspace_id = str(workspace.id)

    existing_member = db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.agent_name == YUMI_AGENT_NAME,
        )
    ).scalar_one_or_none()

    existing_cfg = db.execute(
        select(CloudAgentConfig).where(
            CloudAgentConfig.workspace_id == workspace_id,
            CloudAgentConfig.agent_name == YUMI_AGENT_NAME,
        )
    ).scalar_one_or_none()

    # A live Yumi already exists — nothing to do. (If the user removed Yumi it's
    # a hard delete, so both rows are gone and we'd re-provision; that's only on
    # explicit re-add, not here.)
    if existing_member and existing_member.status != "removed" and existing_cfg:
        return False

    if existing_cfg is None:
        db.add(CloudAgentConfig(
            workspace_id=workspace_id,
            agent_name=YUMI_AGENT_NAME,
            provider=YUMI_PROVIDER,
            model=config.YUMI_MODEL,
            category=YUMI_CATEGORY,
            api_key=YUMI_KEY_PLACEHOLDER,
            base_url=None,
            system_prompt=None,
            max_tokens=None,
        ))
    else:
        existing_cfg.provider = YUMI_PROVIDER
        existing_cfg.model = config.YUMI_MODEL
        existing_cfg.category = YUMI_CATEGORY
        existing_cfg.api_key = YUMI_KEY_PLACEHOLDER
        existing_cfg.status = "active"

    description = "OpenAgents built-in assistant — helps you get started"
    if existing_member is None:
        db.add(WorkspaceMember(
            workspace_id=workspace.id,
            agent_name=YUMI_AGENT_NAME,
            role="member",
            agent_type=YUMI_AGENT_TYPE,
            status="online",
            description=description,
        ))
    else:
        existing_member.status = "online"
        existing_member.last_heartbeat = None
        existing_member.agent_type = YUMI_AGENT_TYPE
        existing_member.description = description

    logger.info("yumi: provisioned built-in assistant in workspace %s", workspace_id)
    return True


# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

YUMI_SYSTEM_PROMPT = """\
You are Yumi, the friendly built-in assistant for OpenAgents — a multi-agent \
workspace where a human collaborates with AI agents in chat threads.

Your job in this v1 is ONBOARDING: welcome new users, explain how OpenAgents \
works, and help them take their first steps. Be warm, concise, and concrete. \
Prefer short messages with clear next actions over long walls of text.

What you can help with right now:
- Explain core concepts: a *workspace* contains *threads* (channels); in each \
thread a human talks with one or more *agents*. Messages route to agents by \
@mention or to the thread's leader.
- Explain how to bring in more agents: the user connects agents from the \
"Connect Agent" view — either a local agent (their own machine, via the \
desktop launcher / CLI) or a cloud agent (an API-backed model). You, Yumi, \
are a built-in cloud agent and need no setup.
- Help the user create their first thread when they ask, using the \
`create_thread` tool.
- Answer "what's here already?" using the `list_agents` and `list_threads` \
tools before making claims about the workspace.

Rules:
- Use tools to READ current state (list_agents/list_threads) instead of \
guessing. Only call `create_thread` when the user actually asks to make one.
- Never invent agents, threads, or features that don't exist.
- You cannot manage files, run code, or install skills yet — if asked, say \
that's coming soon and point them to connecting a capable agent.
- Keep replies to a few sentences unless the user asks for more detail.
"""


def workspace_state_summary(db, workspace_id: str) -> str:
    """A short, live snapshot of the workspace injected into the system prompt
    so Yumi is grounded in what actually exists (roster + threads)."""
    from app.models import Channel

    members = db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.status != "removed",
        )
    ).scalars().all()

    real_agents = [
        m.agent_name for m in members if not is_builtin_agent_type(m.agent_type)
    ]

    channels = db.execute(
        select(Channel).where(
            Channel.workspace_id == workspace_id,
            Channel.status != "deleted",
        )
    ).scalars().all()
    thread_titles = [c.title or c.name for c in channels]

    lines = ["Current workspace state (live):"]
    if real_agents:
        lines.append(f"- Connected agents (besides you): {', '.join(real_agents)}")
    else:
        lines.append(
            "- No other agents are connected yet — the user has only you (Yumi). "
            "A great first step is to help them connect their first agent or "
            "create a thread."
        )
    if thread_titles:
        lines.append(f"- Existing threads: {', '.join(thread_titles[:15])}")
    else:
        lines.append("- No threads created yet.")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Tools (OpenAI function-calling schemas + executor)
# ---------------------------------------------------------------------------

def build_tools() -> list[dict]:
    """OpenAI-style tool schemas Yumi may call. Kept minimal for onboarding."""
    return [
        {
            "type": "function",
            "function": {
                "name": "list_agents",
                "description": (
                    "List the agents currently in this workspace (name, type, "
                    "online status). Use before describing who is available."
                ),
                "parameters": {"type": "object", "properties": {}},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "list_threads",
                "description": (
                    "List the existing threads (channels) in this workspace "
                    "(name + title). Use before describing what threads exist."
                ),
                "parameters": {"type": "object", "properties": {}},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "create_thread",
                "description": (
                    "Create a new thread (channel) in this workspace. Only call "
                    "this when the user explicitly asks to create/start a thread."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "title": {
                            "type": "string",
                            "description": "A short human-readable title for the thread.",
                        },
                        "agents": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": (
                                "Optional agent names to add as participants. "
                                "Omit for an empty thread the user will populate."
                            ),
                        },
                    },
                    "required": ["title"],
                },
            },
        },
    ]


async def execute_tool(
    db, workspace_id: str, channel_target: str, agent_name: str,
    name: str, args: dict,
) -> dict:
    """Execute one tool call and return a JSON-serialisable result dict."""
    try:
        if name == "list_agents":
            return _tool_list_agents(db, workspace_id)
        if name == "list_threads":
            return _tool_list_threads(db, workspace_id)
        if name == "create_thread":
            return await _tool_create_thread(db, workspace_id, agent_name, args)
        return {"ok": False, "error": f"Unknown tool: {name}"}
    except Exception as exc:  # never let a tool crash the loop
        logger.exception("yumi: tool %s failed", name)
        return {"ok": False, "error": str(exc)[:200]}


def _tool_list_agents(db, workspace_id: str) -> dict:
    members = db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.status != "removed",
        )
    ).scalars().all()
    agents = [
        {
            "name": m.agent_name,
            "type": m.agent_type,
            "status": m.status,
            "builtin": is_builtin_agent_type(m.agent_type),
            "description": m.description,
        }
        for m in members
    ]
    return {"ok": True, "agents": agents}


def _tool_list_threads(db, workspace_id: str) -> dict:
    from app.models import Channel

    channels = db.execute(
        select(Channel).where(
            Channel.workspace_id == workspace_id,
            Channel.status != "deleted",
        )
    ).scalars().all()
    threads = [{"name": c.name, "title": c.title} for c in channels]
    return {"ok": True, "threads": threads}


async def _tool_create_thread(db, workspace_id: str, agent_name: str, args: dict) -> dict:
    """Create a thread by emitting a network.channel.create event through the
    pipeline — the same path the clients use — so all side effects (membership,
    naming) are consistent."""
    from app.models import Workspace
    from app.pipeline_factory import pipeline
    from openagents.core.onm_events import Event
    from openagents.core.onm_mods import EventRejected, PipelineContext

    title = (args.get("title") or "").strip() or "New thread"
    participants = [a for a in (args.get("agents") or []) if isinstance(a, str) and a]

    workspace = db.execute(
        select(Workspace).where(Workspace.id == workspace_id)
    ).scalar_one_or_none()
    if not workspace:
        return {"ok": False, "error": "Workspace not found"}

    event = Event(
        type="network.channel.create",
        source=f"openagents:{agent_name}",
        target="core",
        payload={"title": title, "participants": participants},
        metadata={},
        network=workspace_id,
    )
    context = PipelineContext(
        network_id=workspace_id,
        agent_address=event.source,
        db=db,
        workspace=workspace,
        token=workspace.password_hash,
    )
    try:
        await pipeline.process(event, context)
    except EventRejected as exc:
        return {"ok": False, "error": f"Thread creation rejected: {exc.reason}"}

    db.commit()

    channel_name = event.metadata.get("channel_name")
    # Publish so SSE clients see the new thread immediately.
    try:
        from app import cache
        snapshot = {
            "id": event.id,
            "type": event.type,
            "source": event.source,
            "target": event.target,
            "payload": event.payload,
            "metadata": event.metadata,
            "timestamp": event.timestamp,
        }
        cache.publish_event(
            f"ws:{workspace_id}:events",
            _json.dumps(snapshot, default=str, separators=(",", ":")).encode(),
        )
    except Exception:
        pass

    return {"ok": True, "channel_name": channel_name, "title": title}
