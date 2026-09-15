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
   single chat round-trip, so it can actually help the user set things up.

Tool calls go through the REAL workspace HTTP API via an in-process ASGI
client (``WorkspaceApi``) — never direct DB queries — so auth, validation,
serialization, and side effects (SSE publish, background tasks) behave exactly
as they do for any other client.

The built-in identity is the reserved provider ``"openagents"`` — that is what
``builtin`` is derived from everywhere (discover/workspace serializers,
frontend gating).
"""

import logging
import re
from typing import Any, Optional

import httpx
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


def resolve_model(cloud_config: CloudAgentConfig) -> str:
    """The model to run a cloud agent with.

    Built-in Yumi is server-managed end to end: the model comes from
    ``config.YUMI_MODEL`` at call time (like the key), NOT from the row
    persisted at provision time — so one env/config change switches every
    workspace's Yumi at the next deploy, with no backfill.
    """
    if cloud_config.provider == YUMI_PROVIDER and config.YUMI_MODEL:
        return config.YUMI_MODEL
    return cloud_config.model


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

    # Namespace lock BEFORE the reads, so a concurrent rename/join can't
    # invalidate what we read here before we write.
    from app import naming
    naming.lock_member_namespace(db, workspace.id)

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

    # The name may be taken by a REAL agent (a user's daemon that happens to
    # be called "yumi"). Backfilling would rewrite its agent_type/description
    # and attach the built-in config — a takeover, not a repair. Only a member
    # that already is the built-in type may be repaired; a removed real agent
    # counts too, since backfill would resurrect it as the built-in.
    if existing_member and (existing_member.agent_type or "") != YUMI_AGENT_TYPE:
        logger.warning(
            "yumi: skipped backfill in %s — a %s agent (status=%s) already "
            "owns the name",
            workspace_id, existing_member.agent_type, existing_member.status,
        )
        return False

    # Namespace guard runs BEFORE any session mutation: the backfill loop
    # shares one session across workspaces, so bailing out after a db.add()
    # would leave an orphan pending object that the next workspace's commit
    # persists.
    if existing_member is None:
        alias_clash = naming.find_alias_clash(
            db, workspace_id, YUMI_AGENT_NAME, exclude_agent=YUMI_AGENT_NAME,
        )
        if alias_clash:
            logger.warning(
                "yumi: skipped backfill in %s — name clashes with display "
                "name of member %s", workspace_id, alias_clash,
            )
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


# Tappable prompts shown under the seeded greeting (frontend renders
# ``metadata.suggestions`` as one-tap chips — typing on a phone is the most
# expensive thing we can ask of a brand-new user).
WELCOME_SUGGESTIONS = [
    "Give me a quick tour of this workspace",
    "What can agents do for me?",
    "How do I connect a coding agent?",
]

WELCOME_GREETING = (
    "\U0001F44B Hi, I'm **Yumi** — your built-in assistant. I already live in "
    "this workspace, so there's nothing to install.\n\n"
    "Ask me anything, or tap a suggestion below to see what agents can do "
    "here. When you're ready, I can also walk you through connecting full "
    "coding agents like Claude Code from your computer."
)


def seed_welcome_thread(db, workspace) -> bool:
    """Create the first thread with a proactive greeting from Yumi.

    Identity-created workspaces get zero channels and Yumi only ever *reacts*,
    so a brand-new user lands in an empty room — a dead end on mobile, where
    the launcher can't be installed. Seed one Yumi-led thread with a greeting
    and tappable suggestions so the first minute delivers a working agent
    conversation instead. Caller commits; call inside try/except — this must
    never block workspace creation.
    """
    import time
    import uuid

    from app.models import Channel, ChannelMember, EventRecord

    if not should_provision():
        return False

    # Only ever for a truly fresh workspace — if any channel exists we're not
    # first-run (re-provisioning, backfill, agent-created workspace…).
    has_channel = db.execute(
        select(Channel.id).where(Channel.workspace_id == workspace.id).limit(1)
    ).scalar_one_or_none()
    if has_channel:
        return False

    channel = Channel(
        workspace_id=workspace.id,
        name="welcome",
        title="Welcome",
        created_by=YUMI_AGENT_NAME,
        master_agent=YUMI_AGENT_NAME,
        status="active",
    )
    db.add(channel)
    db.flush()
    db.add(ChannelMember(channel_id=channel.id, agent_name=YUMI_AGENT_NAME))

    # Persist the greeting directly (same shape as a pipeline-posted Yumi chat
    # message). No SSE publish needed: the workspace was created milliseconds
    # ago, nobody is subscribed yet — the first page load reads it from the DB.
    db.add(EventRecord(
        id=str(uuid.uuid4()),
        network_id=workspace.id,
        type="workspace.message.posted",
        source=f"openagents:{YUMI_AGENT_NAME}",
        target=f"channel/{channel.name}",
        payload={"content": WELCOME_GREETING, "message_type": "chat"},
        metadata_={
            "target_agents": ["__no_response__"],
            "suggestions": WELCOME_SUGGESTIONS,
        },
        timestamp=int(time.time() * 1000),
        visibility="channel",
    ))
    db.flush()
    logger.info("yumi: seeded welcome thread in workspace %s", workspace.id)
    return True


# ---------------------------------------------------------------------------
# In-process API client
# ---------------------------------------------------------------------------

class WorkspaceApi:
    """Calls the workspace's own HTTP API in-process (ASGI transport).

    Every Yumi tool goes through the real FastAPI app — routing, auth
    (X-Workspace-Token), validation, serialization, and side effects like SSE
    publishes — instead of querying the database directly. No network hop.
    """

    def __init__(self, workspace_id: str, token: str):
        self.workspace_id = workspace_id
        self.token = token

    async def request(
        self, method: str, path: str, *,
        json: Optional[dict] = None, params: Optional[dict] = None,
    ) -> dict:
        """Perform a request; return {"ok": True, "data": ...} or
        {"ok": False, "error": ...}. Never raises."""
        # Imported lazily: app.main transitively imports this module.
        from app.main import app

        try:
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(
                transport=transport,
                base_url="http://yumi.internal",
                timeout=30,
            ) as client:
                resp = await client.request(
                    method, path,
                    json=json, params=params,
                    headers={"X-Workspace-Token": self.token},
                )
        except Exception as exc:
            logger.exception("yumi api: %s %s failed", method, path)
            return {"ok": False, "error": f"internal request failed: {exc}"[:200]}

        try:
            body = resp.json()
        except Exception:
            body = {}
        if resp.status_code == 200:
            return {"ok": True, "data": body.get("data")}
        return {
            "ok": False,
            "error": body.get("message") or f"HTTP {resp.status_code}",
            "status": resp.status_code,
        }

    async def get(self, path: str, **params: Any) -> dict:
        return await self.request("GET", path, params=params or None)

    async def post(self, path: str, json: Optional[dict] = None) -> dict:
        return await self.request("POST", path, json=json)

    async def patch(self, path: str, json: Optional[dict] = None) -> dict:
        return await self.request("PATCH", path, json=json)


# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

YUMI_SYSTEM_PROMPT = """\
You are Yumi, the built-in assistant and workspace manager for OpenAgents — a
multi-agent workspace where humans collaborate with AI agents in chat threads.

Your two jobs:
1. ONBOARDING — welcome new users, explain how OpenAgents works, help them
connect nodes and agents and take their first steps.
2. MANAGING THE WORKSPACE — keep an accurate picture of agents, nodes,
threads and tasks; get the human's requests to the right agent; coordinate
agents inside a thread; manage thread membership and leadership.

You are a CLOUD agent on the OpenAgents server: no shell, no filesystem, no
code execution. You act only through your tools; for everything else you give
precise instructions. You are NOT a coding or research agent — you never do
the specialist work yourself; you route it to an agent that can.

Be warm, concise and concrete. Prefer short replies with clear next actions.

READING THE CONVERSATION: every message is prefixed with its author in
brackets — `[Raphael]` is a human, `[claude-dev]` is an agent. The transcript
is a group chat, not a 1:1: attribute each statement to the right speaker and
never mistake another agent's words for the human's. The "THIS THREAD" block
below tells you who is in this thread, who is online, and who leads it.

Core concepts (explain when helpful):
- A *workspace* contains *threads* (chat channels). In a thread the human
talks with one or more *agents*. A message that @mentions an agent goes to
that agent; a message with no @mention goes to the thread's *leader*.
- A *node* is a device (laptop, desktop, server) running the OpenAgents
launcher/daemon. Local agents (Claude Code, Codex, Gemini CLI, ...) run on
nodes. *Cloud agents* (like you) run server-side and need no node.

DELEGATING — getting another agent to do something:
- IN THIS THREAD you hand off by REPLYING, never by calling a tool: your
reply text must contain `@agent-name` followed by a clear, self-contained
instruction. That reply is delivered ONLY to the agents you @mention; they
answer in this thread, where the human sees them directly. There is no tool
for handing off in the current thread — `post_to_thread` is for OTHER threads
only and refuses the current one. @mention one agent per reply unless the
human asked for more.
- Only @mention when you intend to hand off. When you merely talk ABOUT an
agent, write its name without "@".
- Before delegating: the agent must be in this thread and online (see THIS
THREAD / `list_agents`). If it is in the workspace but not in this thread,
call `add_agent_to_thread`, then hand off in the SAME reply's text with
`@agent-name` + instruction. Never delegate to an offline agent — tell the
human it's offline and how to bring it back.
- If the human asks for something outside your role (write code, do research,
analyze data, ...) and a capable agent is in the thread, don't call tools —
reply with one line saying who you're handing it to and why, then the
@mention and instruction. If no capable agent is in the thread but one exists
in the workspace, add it and hand off. If none exists, help the human connect
one.
- To start work in ANOTHER thread: `create_thread` with the right agents,
then `post_to_thread` (with that thread's id) the kickoff message that
@mentions the agent with a clear instruction. Creating a thread alone starts
nothing.
- Never say you "asked" or "handed off" unless your reply text contains the
@mention (this thread) or `post_to_thread` returned ok (another thread), and
never claim an agent is working on something unless you actually delegated
it or can see that work in a thread.

WHEN AN AGENT REPORTS BACK (to you or to the thread): summarize the outcome
for the human in plain terms and stop — do not @mention the agent again
unless the human asks for the next step. Delegation is always started by the
human, never by you on your own initiative.

HELPING THE HUMAN TALK TO AGENTS: recommend which agent fits a request (use
their descriptions), turn a vague ask into a clear instruction before
delegating, check that an agent is online before the human waits on it, and
remind them that a message with no @mention goes to the thread's leader.

YOUR PRESENCE IN THREADS: you live only in your own threads — your Welcome
thread and threads the human deliberately created with you or added you to
from that thread's agent menu. Nothing pulls you into other threads (not even
an @mention there), so never assume you are anywhere else. Posting into
another thread with `post_to_thread` does NOT add you to it and you will not
see the replies there: say so, and offer to check on it later with
`read_thread` or point the human to that thread. Never promise that an agent
will "report back here" from another thread. If the human wants you in
another thread, tell them to add you from that thread's agent menu.

THREAD MANAGEMENT tools: `add_agent_to_thread` (bring a workspace agent into
this thread), `set_thread_leader` (the leader gets every un-mentioned
message; the agent must be in the thread), `read_thread` (catch up on or
summarize another thread by its thread_id from `list_threads`),
`post_to_thread` (send a message into another thread), `create_thread`,
`list_threads`. Confirm before changing a leader unless the human asked for
exactly that.

CONNECTING A NEW NODE (a whole device):
1. Call `create_pairing_code` to mint a code (format XXXX-XXXX, valid 30
minutes, single use) and show it to the user.
2. Tell them, on the device: EITHER install the OpenAgents Desktop app
(download at openagents.org — macOS Apple Silicon/Intel or Windows) and pick
"Connect a node", then enter the code — OR in a terminal: install the CLI
(`curl -fsSL https://openagents.org/install.sh | bash`, on Windows
`irm https://openagents.org/install.ps1 | iex`) and run
`agn node connect XXXX-XXXX`.
3. The node appears in `list_nodes` within moments of pairing. Offer to check.

CONNECTING A SINGLE LOCAL AGENT MANUALLY (no pairing): give instructions
only — Desktop app: add an agent from its Agents screen. CLI on the node:
`agn install <type>` → `agn create my-<type> --type <type>` →
`agn connect my-<type> <workspace token>` → `agn up`. The workspace token is
shown in the workspace's Connect Agent view (Local tab). NEVER print the
workspace token in chat — threads can be shared; point the user to the
Connect Agent view to copy it.

CLOUD AGENTS (OpenAI, Anthropic, Google, ...): added in the Connect Agent
view → Cloud tab, where the user picks a provider/model and pastes their API
key. You can't enter keys for them; guide them there.

MANAGING AGENTS ON CONNECTED NODES (your tools, run remotely by the node's
daemon): use `manage_node_agent` to create/install an agent of some type on
a node (`create_agent` — needs name + type), start it (`start_agent`), stop
it (`stop_agent`), or re-detect installed runtimes (`detect_runtimes`).
Rules: pick the node from `list_nodes` (ask if ambiguous); ALWAYS confirm
with the user before a create/start/stop; commands run on the node's next
heartbeat (seconds up to ~a minute) — verify afterwards with
`get_node_commands` and `list_nodes` instead of assuming success.

TASKS: the workspace has a Tasks board (Kanban). You can add cards with
`create_task` (goes to Backlog; optionally pre-assign an agent) and read the
board with `list_tasks`. Creating a task does NOT start any agent — the user
runs it from the Tasks board. Don't move/delete cards; point users to the
board for that.

REMOVALS: you never remove anything — no nodes, no agents, no threads.
Instead, tell the user how: a cloud agent — click it in the roster, then
"Remove" in its profile panel (or the Connect view's Cloud tab trash icon);
a node — the Connect view's node list (owner/admin only), after stopping the
daemon on the device (`agn down`); a local agent — `agn disconnect <name>`
on its node, or the Desktop app.

DEBUGGING CONNECTIONS — when something "doesn't respond", work through this
with tools, not guesses:
1. `list_agents`: does the agent exist, and is it online? A stale/absent
heartbeat means its daemon isn't running or lost connection.
2. If it lives on a node: `list_nodes` — is the node online? An offline node
means the launcher/daemon is down on that device → have the user start the
Desktop app or run `agn up` (check with `agn status`).
3. `get_node_commands`: did a recent create/start command fail? Read the error.
4. Is the agent actually in this thread, and was it @mentioned? Suggest
mentioning it explicitly.
5. Still stuck: ask what the user sees on the device (`agn status` output)
and iterate.

Rules:
- Use read tools (`list_agents`, `list_threads`, `list_nodes`,
`get_agent_catalog`, `read_thread`) before making claims about what exists
or what was said elsewhere. Never invent agents, nodes, threads, messages,
or features.
- Only call `create_thread` when the user asks to create/start a thread.
- Keep replies to a few sentences unless the user asks for more detail.
"""


async def workspace_state_summary(api: WorkspaceApi) -> str:
    """A short, live snapshot (via the API) injected into the system prompt so
    Yumi is grounded in what actually exists. Never raises — on API failure it
    returns a minimal note rather than blocking the reply."""
    lines = ["Current workspace state (live):"]

    discover = await api.get("/v1/discover", network=api.workspace_id)
    if discover["ok"] and discover["data"]:
        agents = discover["data"].get("agents") or []
        real = []
        for a in agents:
            if a.get("builtin"):
                continue
            name = (a.get("address") or "").removeprefix("openagents:")
            desc = (a.get("description") or "").strip().replace("\n", " ")
            entry = f"{name} ({a.get('status')})"
            if desc:
                entry += f" — {desc[:70]}"
            real.append(entry)
        if real:
            lines.append(f"- Connected agents (besides you): {', '.join(real)}")
        else:
            lines.append(
                "- No other agents are connected yet — the user has only you "
                "(Yumi). Offer to help them connect a node or their first agent."
            )
        channels = discover["data"].get("channels") or []
        if channels:
            titles = [c.get("title") or c.get("address", "") for c in channels[:15]]
            lines.append(f"- Existing threads: {', '.join(t for t in titles if t)}")
        else:
            lines.append("- No threads created yet.")
    else:
        lines.append("- (agent/thread state unavailable right now)")

    nodes = await api.get("/v1/nodes", network=api.workspace_id)
    if nodes["ok"] and isinstance(nodes["data"], list):
        if nodes["data"]:
            descs = [
                f"{n.get('name') or n.get('hostname') or n.get('nodeId')} ({n.get('status')})"
                for n in nodes["data"][:10]
            ]
            lines.append(f"- Connected nodes: {', '.join(descs)}")
        else:
            lines.append("- No nodes (devices) connected yet.")

    return "\n".join(lines)


async def thread_context(
    api: WorkspaceApi, channel_name: Optional[str],
    trigger_source: str = "", trigger_payload: Optional[dict] = None,
) -> str:
    """Live facts about the thread Yumi is replying in — title, who is in it
    (with online status and role description), who leads it, and who the
    human is. Without this the assistant can't tell whether an agent it is
    asked about is even in the room. Never raises."""
    if not channel_name:
        return ""
    from app.services.cloud_agent import speaker_label

    lines = ["THIS THREAD (live):"]
    statuses: dict = {}
    descs: dict = {}
    disc = await api.get("/v1/discover", network=api.workspace_id)
    if disc["ok"] and disc["data"]:
        for a in disc["data"].get("agents") or []:
            name = (a.get("address") or "").removeprefix("openagents:")
            statuses[name] = a.get("status") or "unknown"
            descs[name] = (a.get("description") or "").strip().replace("\n", " ")

    ch = await api.get(f"/v1/workspaces/{api.workspace_id}/channels/{channel_name}")
    if ch["ok"] and ch["data"]:
        d = ch["data"]
        lines.append(f"- Title: {d.get('title') or channel_name} (thread id: {channel_name})")
        parts = []
        for p in d.get("participants") or []:
            if p == "__no_response__":
                continue
            if p == YUMI_AGENT_NAME:
                parts.append("yumi (you)")
                continue
            entry = f"{p} ({statuses.get(p, 'unknown')})"
            if descs.get(p):
                entry += f" — {descs[p][:70]}"
            parts.append(entry)
        lines.append("- Agents in this thread: " + (", ".join(parts) if parts else "(only you)"))
        leader = d.get("masterAgent")
        if leader == YUMI_AGENT_NAME:
            lines.append("- Leader: you — messages with no @mention come to you.")
        elif leader:
            lines.append(f"- Leader: {leader} — messages with no @mention go to it.")
        else:
            lines.append("- Leader: none set.")
    else:
        lines.append(f"- thread id: {channel_name} (details unavailable right now)")

    if (trigger_source or "").startswith("human:"):
        who = speaker_label(trigger_source, trigger_payload or {})
        lines.append(f"- You are talking with: {who} (human)")
    return "\n".join(lines)


async def is_thread_participant(api: WorkspaceApi, channel_name: str, agent_name: str) -> bool:
    """Whether ``agent_name`` is a participant of the thread. Fails OPEN on an
    API error so a lookup hiccup can't silence a legitimate reply."""
    ch = await api.get(f"/v1/workspaces/{api.workspace_id}/channels/{channel_name}")
    if not (ch["ok"] and ch["data"]):
        return True
    return agent_name in ((ch["data"] or {}).get("participants") or [])


async def workspace_member_names(api: WorkspaceApi) -> list[str]:
    """Agent names in the workspace (for validating @mentions)."""
    disc = await api.get("/v1/discover", network=api.workspace_id)
    if not (disc["ok"] and disc["data"]):
        return []
    return [
        (a.get("address") or "").removeprefix("openagents:")
        for a in disc["data"].get("agents") or []
    ]


_MENTION_RE = re.compile(r"@([\w-]+)")


def delegation_targets(text: str, member_names, self_name: str = YUMI_AGENT_NAME) -> list[str]:
    """Agents a reply hands off to: its @mentions that are real workspace
    members, excluding the sender, in order, de-duplicated."""
    known = set(member_names or [])
    out: list[str] = []
    for m in _MENTION_RE.findall(text or ""):
        if m in known and m != self_name and m not in out:
            out.append(m)
    return out


# ---------------------------------------------------------------------------
# Tools (OpenAI function-calling schemas + executor)
# ---------------------------------------------------------------------------

# Remote actions Yumi may enqueue. Deliberately excludes remove_agent —
# removals are user-only (Yumi gives UI instructions instead).
YUMI_NODE_ACTIONS = ("create_agent", "start_agent", "stop_agent", "detect_runtimes")


def build_tools() -> list[dict]:
    """OpenAI-style tool schemas Yumi may call. Onboarding-focused."""
    return [
        {
            "type": "function",
            "function": {
                "name": "list_agents",
                "description": (
                    "List the agents in this workspace (name, type, online "
                    "status, which host/node they run on). Use before "
                    "describing who is available or debugging connectivity."
                ),
                "parameters": {"type": "object", "properties": {}},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "list_threads",
                "description": (
                    "List the existing threads (channels) in this workspace."
                ),
                "parameters": {"type": "object", "properties": {}},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "list_nodes",
                "description": (
                    "List the nodes (devices running the OpenAgents launcher/"
                    "daemon) connected to this workspace, with online status, "
                    "OS, the agents on each node, and detected runtimes."
                ),
                "parameters": {"type": "object", "properties": {}},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_agent_catalog",
                "description": (
                    "List the local agent types that can be installed on a "
                    "node (claude, codex, gemini, ...), with descriptions."
                ),
                "parameters": {"type": "object", "properties": {}},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "create_pairing_code",
                "description": (
                    "Mint a short-lived, single-use pairing code the user "
                    "enters on a new device to connect it to this workspace "
                    "as a node. Only call when the user wants to connect a "
                    "new node/device."
                ),
                "parameters": {"type": "object", "properties": {}},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "manage_node_agent",
                "description": (
                    "Queue an agent-management command on a connected node "
                    "(runs on the node's next heartbeat). Actions: "
                    "create_agent (install/create an agent — requires "
                    "agent_name + agent_type), start_agent, stop_agent "
                    "(require agent_name), detect_runtimes. Confirm with the "
                    "user before calling. Cannot remove agents."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "node_id": {
                            "type": "string",
                            "description": "nodeId from list_nodes.",
                        },
                        "action": {
                            "type": "string",
                            "enum": list(YUMI_NODE_ACTIONS),
                        },
                        "agent_name": {
                            "type": "string",
                            "description": "Agent to create/start/stop.",
                        },
                        "agent_type": {
                            "type": "string",
                            "description": (
                                "For create_agent: a type from "
                                "get_agent_catalog (e.g. 'claude')."
                            ),
                        },
                    },
                    "required": ["node_id", "action"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_node_commands",
                "description": (
                    "Recent remote commands for a node with their status "
                    "(pending/running/done/error). Use to verify a "
                    "manage_node_agent command or debug a failure."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "node_id": {
                            "type": "string",
                            "description": "nodeId from list_nodes.",
                        },
                    },
                    "required": ["node_id"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "create_task",
                "description": (
                    "Create a task card on the workspace's Tasks board "
                    "(Kanban). Defaults to the Backlog column. Optionally "
                    "pre-assign an agent (does NOT start it running — the "
                    "user runs it from the Tasks board)."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "description": {"type": "string"},
                        "priority": {
                            "type": "string",
                            "enum": ["low", "normal", "high"],
                        },
                        "assignee": {
                            "type": "string",
                            "description": (
                                "Optional agent name from list_agents to "
                                "pre-assign."
                            ),
                        },
                    },
                    "required": ["title"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "list_tasks",
                "description": (
                    "List the task cards on the workspace's Tasks board "
                    "(title, status column, priority, assignee)."
                ),
                "parameters": {"type": "object", "properties": {}},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "add_agent_to_thread",
                "description": (
                    "Add an agent that exists in this workspace to the CURRENT "
                    "thread, so it can be @mentioned and receive messages here. "
                    "Use it before delegating to an agent that isn't in the thread."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "agent_name": {
                            "type": "string",
                            "description": "Agent name from list_agents.",
                        },
                    },
                    "required": ["agent_name"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "set_thread_leader",
                "description": (
                    "Make an agent the leader of the CURRENT thread. The leader "
                    "receives every message that has no @mention. The agent must "
                    "already be in the thread."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "agent_name": {
                            "type": "string",
                            "description": "Agent name (a participant of this thread).",
                        },
                    },
                    "required": ["agent_name"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "read_thread",
                "description": (
                    "Read the most recent messages of ANOTHER thread (by its "
                    "thread_id from list_threads), speaker-attributed and oldest "
                    "first, to catch up on or summarize it."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "thread": {"type": "string", "description": "thread_id from list_threads."},
                        "limit": {
                            "type": "integer",
                            "description": "How many recent messages (1-60, default 30).",
                        },
                    },
                    "required": ["thread"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "post_to_thread",
                "description": (
                    "For ANOTHER thread only (refuses the current one): post a "
                    "message as yourself into that thread by thread_id, e.g. to kick "
                    "off work in a thread you created — @mention the agent and give "
                    "a clear, self-contained instruction. Only when the human asked "
                    "for it. To hand off in the CURRENT thread, do not use a tool: "
                    "just write @agent-name + instruction in your reply."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "thread": {"type": "string", "description": "thread_id from list_threads."},
                        "message": {"type": "string"},
                    },
                    "required": ["thread", "message"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "create_thread",
                "description": (
                    "Create a new thread (channel). Only call when the user "
                    "explicitly asks to create/start a thread."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "title": {
                            "type": "string",
                            "description": "Short human-readable title.",
                        },
                        "agents": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": (
                                "Optional agent names to add as participants."
                            ),
                        },
                    },
                    "required": ["title"],
                },
            },
        },
    ]


async def execute_tool(
    api: WorkspaceApi, agent_name: str, name: str, args: dict,
    channel_name: Optional[str] = None, allow_delegation: bool = True,
) -> dict:
    """Execute one tool call via the workspace API; JSON-serialisable result.

    ``channel_name`` is the thread the assistant is replying in (needed by
    the thread-management tools). ``allow_delegation`` is False when the
    trigger came from another agent: hand-offs are human-initiated only.
    """
    try:
        if name == "list_agents":
            return await _tool_list_agents(api)
        if name == "list_threads":
            return await _tool_list_threads(api)
        if name == "list_nodes":
            return await _tool_list_nodes(api)
        if name == "get_agent_catalog":
            return await _tool_get_agent_catalog(api)
        if name == "create_pairing_code":
            return await _tool_create_pairing_code(api)
        if name == "manage_node_agent":
            return await _tool_manage_node_agent(api, args)
        if name == "get_node_commands":
            return await _tool_get_node_commands(api, args)
        if name == "create_task":
            return await _tool_create_task(api, agent_name, args)
        if name == "list_tasks":
            return await _tool_list_tasks(api)
        if name == "add_agent_to_thread":
            return await _tool_add_agent_to_thread(api, agent_name, channel_name, args)
        if name == "set_thread_leader":
            return await _tool_set_thread_leader(api, channel_name, args)
        if name == "read_thread":
            return await _tool_read_thread(api, args)
        if name == "post_to_thread":
            return await _tool_post_to_thread(api, agent_name, channel_name, args, allow_delegation)
        if name == "create_thread":
            return await _tool_create_thread(api, agent_name, args)
        return {"ok": False, "error": f"Unknown tool: {name}"}
    except Exception as exc:  # never let a tool crash the loop
        logger.exception("yumi: tool %s failed", name)
        return {"ok": False, "error": str(exc)[:200]}


async def _tool_list_agents(api: WorkspaceApi) -> dict:
    res = await api.get("/v1/discover", network=api.workspace_id)
    if not res["ok"]:
        return res
    agents = []
    for a in (res["data"] or {}).get("agents") or []:
        skills = a.get("enabled_skills") or {}
        agents.append({
            "name": (a.get("address") or "").removeprefix("openagents:"),
            "type": a.get("agent_type"),
            "status": a.get("status"),
            "builtin": bool(a.get("builtin")),
            "description": a.get("description"),
            "host": a.get("server_host"),
            "working_dir": a.get("working_dir"),
            "installed_skills": skills.get("installed") or [],
            "last_heartbeat_at": a.get("last_heartbeat_at"),
        })
    return {"ok": True, "agents": agents}


async def _tool_list_threads(api: WorkspaceApi) -> dict:
    res = await api.get("/v1/discover", network=api.workspace_id)
    if not res["ok"]:
        return res
    threads = []
    for c in (res["data"] or {}).get("channels") or []:
        name = (c.get("address") or "").removeprefix("channel/")
        if name.startswith("routines:") or (c.get("status") or "active") == "deleted":
            continue
        threads.append({
            "thread_id": name,
            "title": c.get("title"),
            "leader": c.get("master"),
            "agents": [p for p in (c.get("participants") or []) if p != "__no_response__"],
            "last_activity_at": c.get("last_event_at"),
        })
    return {"ok": True, "threads": threads[:40]}


async def _tool_list_nodes(api: WorkspaceApi) -> dict:
    res = await api.get("/v1/nodes", network=api.workspace_id)
    if not res["ok"]:
        return res
    nodes = []
    for n in res["data"] or []:
        nodes.append({
            "node_id": n.get("nodeId"),
            "name": n.get("name"),
            "hostname": n.get("hostname"),
            "status": n.get("status"),
            "os": n.get("os"),
            "device_type": n.get("deviceType"),
            "agents": n.get("agents") or [],
            "runtimes": n.get("runtimes") or [],
            "last_heartbeat_at": n.get("lastHeartbeatAt"),
        })
    return {"ok": True, "nodes": nodes}


async def _tool_get_agent_catalog(api: WorkspaceApi) -> dict:
    res = await api.get("/v1/agent-catalog")
    if not res["ok"]:
        return res
    data = res["data"] or []
    entries = data if isinstance(data, list) else data.get("agents") or []
    catalog = []
    for entry in entries:
        if isinstance(entry, dict):
            catalog.append({
                "type": entry.get("name"),
                "label": entry.get("label"),
                "description": entry.get("description"),
                "featured": bool(entry.get("featured")),
            })
    return {"ok": True, "agent_types": catalog}


async def _tool_create_pairing_code(api: WorkspaceApi) -> dict:
    res = await api.post(f"/v1/workspaces/{api.workspace_id}/pairing-codes")
    if not res["ok"]:
        return res
    data = res["data"] or {}
    return {
        "ok": True,
        "code": data.get("code"),
        "expires_in_minutes": int((data.get("expiresInSeconds") or 1800) / 60),
        "note": (
            "Single use. On the device: Desktop app → 'Connect a node' → enter "
            "the code, or CLI: agn node connect <code>."
        ),
    }


async def _tool_manage_node_agent(api: WorkspaceApi, args: dict) -> dict:
    node_id = (args.get("node_id") or "").strip()
    action = (args.get("action") or "").strip()
    if action not in YUMI_NODE_ACTIONS:
        return {"ok": False, "error": f"Action not allowed: {action}"}
    if not node_id:
        return {"ok": False, "error": "Missing node_id (see list_nodes)"}

    cmd_args: dict = {}
    if args.get("agent_name"):
        cmd_args["name"] = args["agent_name"]
    if args.get("agent_type"):
        cmd_args["type"] = args["agent_type"]

    res = await api.post(
        f"/v1/nodes/{node_id}/commands",
        json={"action": action, "args": cmd_args},
    )
    if not res["ok"]:
        return res
    data = res["data"] or {}
    return {
        "ok": True,
        "command_id": data.get("commandId"),
        "status": data.get("status"),
        "note": (
            "Queued — the node runs it on its next heartbeat (seconds up to "
            "~a minute). Check get_node_commands for the result."
        ),
    }


async def _tool_get_node_commands(api: WorkspaceApi, args: dict) -> dict:
    node_id = (args.get("node_id") or "").strip()
    if not node_id:
        return {"ok": False, "error": "Missing node_id (see list_nodes)"}
    res = await api.get(f"/v1/nodes/{node_id}/commands", limit=10)
    if not res["ok"]:
        return res
    return {"ok": True, "commands": res["data"] or []}


async def _tool_create_task(api: WorkspaceApi, agent_name: str, args: dict) -> dict:
    title = (args.get("title") or "").strip()
    if not title:
        return {"ok": False, "error": "Missing task title"}
    priority = args.get("priority") if args.get("priority") in ("low", "normal", "high") else "normal"
    payload: dict = {
        "network": api.workspace_id,
        "title": title,
        "description": (args.get("description") or "").strip(),
        "priority": priority,
        "source": f"openagents:{agent_name}",
    }
    if args.get("assignee"):
        payload["assignee"] = args["assignee"]
    res = await api.post("/v1/tasks", json=payload)
    if not res["ok"]:
        return res
    data = res["data"] or {}
    return {
        "ok": True,
        "task_id": data.get("id"),
        "title": data.get("title"),
        "status": data.get("status"),
        "note": "Created in the Backlog column of the Tasks board.",
    }


async def _tool_list_tasks(api: WorkspaceApi) -> dict:
    res = await api.get("/v1/tasks", network=api.workspace_id)
    if not res["ok"]:
        return res
    tasks = [
        {
            "title": t.get("title"),
            "status": t.get("status"),
            "priority": t.get("priority"),
            "assignee": t.get("assignee"),
        }
        for t in (res["data"] or {}).get("tasks") or []
    ]
    return {"ok": True, "tasks": tasks}


async def _tool_create_thread(api: WorkspaceApi, agent_name: str, args: dict) -> dict:
    title = (args.get("title") or "").strip() or "New thread"
    participants = [a for a in (args.get("agents") or []) if isinstance(a, str) and a]

    res = await api.post("/v1/events", json={
        "type": "network.channel.create",
        "source": f"openagents:{agent_name}",
        "target": "core",
        "payload": {"title": title, "participants": participants},
        "metadata": {},
        "network": api.workspace_id,
    })
    if not res["ok"]:
        return res
    metadata = (res["data"] or {}).get("metadata") or {}
    return {"ok": True, "channel_name": metadata.get("channel_name"), "title": title}


async def _tool_add_agent_to_thread(
    api: WorkspaceApi, agent_name: str, channel_name: Optional[str], args: dict,
) -> dict:
    target = (args.get("agent_name") or "").strip()
    if not channel_name:
        return {"ok": False, "error": "No current thread"}
    if not target:
        return {"ok": False, "error": "Missing agent_name"}
    if target not in await workspace_member_names(api):
        return {"ok": False, "error": f"'{target}' is not an agent in this workspace (see list_agents)"}
    res = await api.post("/v1/events", json={
        "type": "network.channel.join",
        "source": f"openagents:{agent_name}",
        "target": f"channel/{channel_name}",
        "payload": {"channel": channel_name, "agent_name": target},
        "metadata": {},
        "network": api.workspace_id,
    })
    if not res["ok"]:
        return res
    return {
        "ok": True, "thread_id": channel_name, "added": target,
        "note": f"{target} is now in this thread; @mention it to hand off work.",
    }


async def _tool_set_thread_leader(api: WorkspaceApi, channel_name: Optional[str], args: dict) -> dict:
    target = (args.get("agent_name") or "").strip()
    if not channel_name:
        return {"ok": False, "error": "No current thread"}
    if not target:
        return {"ok": False, "error": "Missing agent_name"}
    ch = await api.get(f"/v1/workspaces/{api.workspace_id}/channels/{channel_name}")
    if not ch["ok"]:
        return ch
    if target not in ((ch["data"] or {}).get("participants") or []):
        return {"ok": False, "error": f"'{target}' is not in this thread — add_agent_to_thread first"}
    res = await api.patch(
        f"/v1/workspaces/{api.workspace_id}/channels/{channel_name}",
        json={"master_agent": target},
    )
    if not res["ok"]:
        return res
    return {
        "ok": True, "thread_id": channel_name, "leader": target,
        "note": "Messages with no @mention now go to the leader.",
    }


async def _tool_read_thread(api: WorkspaceApi, args: dict) -> dict:
    from app.services.cloud_agent import speaker_label

    thread = (args.get("thread") or "").strip().removeprefix("channel/")
    if not thread:
        return {"ok": False, "error": "Missing thread id (see list_threads)"}
    try:
        limit = max(1, min(int(args.get("limit") or 30), 60))
    except (TypeError, ValueError):
        limit = 30
    res = await api.get(
        "/v1/events", network=api.workspace_id, channel=thread,
        type="workspace.message.posted", sort="desc", limit=limit * 2,
    )
    if not res["ok"]:
        return res
    data = res["data"]
    evs = data if isinstance(data, list) else (data or {}).get("events") or []
    lines = []
    for e in evs:
        payload = e.get("payload") or {}
        if payload.get("message_type", "chat") != "chat":
            continue
        text = (payload.get("content") or "").strip()
        if not text:
            continue
        lines.append({"speaker": speaker_label(e.get("source") or "", payload), "text": text[:400]})
        if len(lines) >= limit:
            break
    lines.reverse()
    return {"ok": True, "thread_id": thread, "messages": lines}


async def _tool_post_to_thread(
    api: WorkspaceApi, agent_name: str, channel_name: Optional[str],
    args: dict, allow_delegation: bool,
) -> dict:
    thread = (args.get("thread") or "").strip().removeprefix("channel/")
    message = (args.get("message") or "").strip()
    if not thread or not message:
        return {"ok": False, "error": "Missing thread id or message"}
    if channel_name and thread == channel_name:
        return {"ok": False, "error": "That's the current thread — just reply here instead"}
    if not allow_delegation:
        return {"ok": False, "error": (
            "Hand-offs are only made when the human asks for them; another "
            "agent's message can't trigger one"
        )}
    members = await workspace_member_names(api)
    targets = delegation_targets(message, members, agent_name)
    res = await api.post("/v1/events", json={
        "type": "workspace.message.posted",
        "source": f"openagents:{agent_name}",
        "target": f"channel/{thread}",
        "payload": {"content": message, "message_type": "chat"},
        "metadata": {"explicit_targets": targets},
        "network": api.workspace_id,
    })
    if not res["ok"]:
        return res
    note = (
        ("Delivered to " + ", ".join(targets) + ". ") if targets else
        "Posted, but it @mentions no agent so nobody will act on it — "
        "@mention the agent to hand off. "
    ) + "You are not in that thread and won't see replies there; use read_thread to check on it."
    return {"ok": True, "thread_id": thread, "delivered_to": targets, "note": note}
