"""More agents in a jam (OpenAgents Share): the owner's own, and guests' own.

The owner adds agents the usual way: they run on the owner's computer with the
jam's workspace token, like the agent that was shared first.

A guest brings an agent through a **limited connection**: a Node with
``scope_channel``/``scope_agent`` set. It is minted for one guest, one jam
thread and one agent name, and the backend accepts it only to

- join, heartbeat and leave as that agent,
- read that thread (and the agent's own control events), with people's
  addresses hidden,
- post into that thread as that agent.

Everything else refuses it, because ``verify_workspace_access`` never counts a
limited connection as workspace trust. The connection stops working as soon as
the guest is removed, the link is turned off or expires, or the agent is
removed from the jam (``scoped_node``).

Who may ask a guest's agent: anyone in the jam. Its own guest's turns run
normally on the guest's computer; everyone else's run as guest turns
(read-only), which the guest's launcher enforces — the server routes others'
requests only to a launcher advertising ``scoped_turns``, and the join reply
tells it whose agent it is (``owner_address``). A guest's agent never starts
other agents: what it posts is a reply, not a request.
"""
from __future__ import annotations

import json
import logging
import os
import re
import secrets
from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Channel, ChannelMember, Node, ThreadGuest, ThreadGuestLink, Workspace, WorkspaceMember
from app.services.guest_links import (
    AGENT_NAME_RE, GUEST_CAPABILITY, LinkError, _aware, _now, guest_address, guest_for_session,
    guest_for_user, is_guest_email, live_link, viewer_email,
)

logger = logging.getLogger(__name__)

SCOPED_CAPABILITY = "scoped_turns"
MAX_AGENTS_PER_GUEST = 3
MAX_AGENTS_PER_ROOM = 12
AGENT_TYPES = ("claude", "codex", "opencode", "openclaw", "hermes", "gemini", "cursor", "aider", "goose")


# ---------------------------------------------------------------------------
# Limited connections
# ---------------------------------------------------------------------------

def _guest_id(email: Optional[str]) -> Optional[str]:
    local = (email or "").strip().lower().split("@", 1)[0]
    return local[len("guest-"):] if is_guest_email(email) and local.startswith("guest-") else None


def guest_agent_live(db: Session, workspace_id, channel_name: str, member: Optional[WorkspaceMember]) -> bool:
    """True while a guest's agent may act in its jam: guest, link and membership all still live."""
    if member is None or member.status == "removed":
        return False
    gid = _guest_id(member.owner_email)
    guest = db.get(ThreadGuest, gid) if gid else None
    if guest is None or guest.revoked_at is not None:
        return False
    link = db.get(ThreadGuestLink, guest.link_id)
    if (link is None or link.revoked_at is not None or str(link.workspace_id) != str(workspace_id)
            or link.channel_name != channel_name or not link.can_post or not link.allow_guest_agents
            or (link.expires_at is not None and _aware(link.expires_at) <= _now())):
        return False
    channel = db.execute(select(Channel).where(
        Channel.workspace_id == str(workspace_id), Channel.name == channel_name)).scalar_one_or_none()
    return channel is not None and db.get(ChannelMember, (channel.id, member.agent_name)) is not None


def scoped_node(db: Session, workspace_id, token: Optional[str]) -> Optional[Node]:
    """The live limited connection this token is in this workspace, or None."""
    if not token or len(token) > 256:
        return None
    node = db.execute(select(Node).where(Node.token == token, Node.workspace_id == str(workspace_id),
                                         Node.scope_channel.isnot(None))).scalar_one_or_none()
    if node is None:
        return None
    member = db.get(WorkspaceMember, (str(workspace_id), node.scope_agent))
    return node if guest_agent_live(db, workspace_id, node.scope_channel, member) else None


def scoped_node_for_network(db: Session, network: str, token: Optional[str]) -> Optional[Node]:
    if not token or not network:
        return None
    from app.routers.network import _resolve_workspace
    workspace = _resolve_workspace(db, network)
    if workspace is None or workspace.status == "deleted":
        return None
    return scoped_node(db, workspace.id, token)


def scoped_poll_node(db: Session, network: str, token: Optional[str], authorization: Optional[str]) -> Optional[Node]:
    """For GET /v1/events: the limited connection polling, when nothing else authorized the call."""
    if authorization:
        return None
    return scoped_node_for_network(db, network, token)


def scoped_event_allowed(node: Node, event) -> bool:
    """What a limited connection may send through the event pipeline."""
    agent = node.scope_agent
    if event.source != f"openagents:{agent}":
        return False
    payload = event.payload or {}
    if event.type in ("network.agent.join", "network.agent.leave", "network.ping"):
        return payload.get("agent_name") == agent
    if event.type == "workspace.message.posted":
        return event.target == f"channel/{node.scope_channel}" and (event.visibility or "") != "direct"
    return False


# Metadata a guest's agent may set on its posts: display only. Everything that
# routes, attributes or links a message (target_agents, in_reply_to, acting_for,
# share_*, guest, watch, …) is dropped, and nothing it posts is addressed to
# another agent.
SAFE_POST_METADATA = frozenset({"agent_mode", "stop_notice", "status_kind", "model", "todos", "session_id", "client_key"})
SAFE_POST_PAYLOAD_DROP = ("attachments", "acting_for", "mentions", "target_agents", "sender_email", "requester_email")


def sanitize_scoped_post(event) -> None:
    """Make a guest agent's post a plain reply: no routing, no attachments, no borrowed identity."""
    if event.type != "workspace.message.posted":
        return
    meta = {k: v for k, v in (event.metadata or {}).items() if k in SAFE_POST_METADATA}
    meta["target_agents"] = ["__no_response__"]
    event.metadata = meta
    payload = dict(event.payload or {})
    for key in SAFE_POST_PAYLOAD_DROP:
        payload.pop(key, None)
    event.payload = payload


# Anything shaped like an address: local part and domain without spaces or
# delimiters (also dotless/self-hosted domains and non-ASCII ones).
_EMAIL = re.compile(r"[^\s\"'<>@,;:()\[\]{}\\/]+@[^\s\"'<>@,;:()\[\]{}\\/]+")


def _scrub_text(text: str) -> str:
    def repl(m):
        addr = m.group(0)
        return addr if is_guest_email(addr) or addr.lower().endswith("@hidden.invalid") else "someone@hidden.invalid"
    return _EMAIL.sub(repl, text)


def scrub_for_scoped(response, node: Node):
    """People's addresses (other than guests') never reach a guest's agent."""
    try:
        from fastapi.responses import JSONResponse
        if isinstance(response, JSONResponse):
            body = _scrub_text(response.body.decode("utf-8"))
            return JSONResponse(status_code=response.status_code, content=json.loads(body))
        return json.loads(_scrub_text(json.dumps(response, default=str, ensure_ascii=False)))
    except Exception:
        logger.exception("room_agents: could not scrub a scoped poll; refusing it")
        from app.response import ResponseCode, json_response
        return json_response(ResponseCode.INTERNAL_ERROR, "Try again")


def join_extras(db: Session, workspace, token: Optional[str], agent_name: str) -> dict:
    """Extra fields for the join reply of an agent on a limited connection."""
    node = scoped_node(db, workspace.id, token) if token else None
    if node is None or node.scope_agent != agent_name:
        return {}
    member = db.get(WorkspaceMember, (str(workspace.id), agent_name))
    # The launcher runs only this person's turns with full rights; everyone
    # else in the jam gets read-only guest turns.
    return {"scoped": {"channel": node.scope_channel, "owner_address": (member.owner_email or "").lower()}}


# ---------------------------------------------------------------------------
# Who may ask a guest's agent
# ---------------------------------------------------------------------------

def is_guest_agent(member) -> bool:
    return member is not None and is_guest_email(getattr(member, "owner_email", None))


def guest_agent_may_run(db: Session, workspace_id, channel: Optional[Channel], member, email: str) -> bool:
    if channel is None or not guest_agent_live(db, workspace_id, channel.name, member):
        return False
    caps = getattr(member, "capabilities", None) or []
    if (email or "").strip().lower() == (member.owner_email or "").lower():
        return True   # the guest who brought it: their own agent, on their own computer
    # Anyone else in the jam: only if the launcher holds their turns read-only.
    return GUEST_CAPABILITY in caps and SCOPED_CAPABILITY in caps


# ---------------------------------------------------------------------------
# Adding and removing agents
# ---------------------------------------------------------------------------

def _launcher() -> str:
    return os.environ.get("SHARE_LAUNCHER_PACKAGE") or "@openagents-org/agent-launcher@latest"


def _api() -> str:
    import app.config as app_config
    return (app_config.config.PUBLIC_API_BASE or "").rstrip("/")


def connect_commands(agent_name: str, agent_type: str, token: str) -> List[str]:
    launcher, api = _launcher(), _api()
    return [
        f"npx -y {launcher} create {agent_name} --type {agent_type} --endpoint {api}",
        f"npx -y {launcher} connect {agent_name} {token} --endpoint {api}",
        f"npx -y {launcher} up --endpoint {api}",
    ]


def _check_new_agent(db: Session, workspace: Workspace, channel: Channel, name: str, agent_type: str):
    name = (name or "").strip()
    if not AGENT_NAME_RE.match(name):
        raise LinkError(400, "Agent names use letters, digits, '-' or '_', no spaces (up to 48)")
    agent_type = (agent_type or "claude").strip().lower()
    if agent_type not in AGENT_TYPES:
        raise LinkError(400, "Unknown agent type")
    existing = db.get(WorkspaceMember, (str(workspace.id), name))
    if existing is not None and existing.status != "removed":
        raise LinkError(409, f"There's already an agent named {name} here. Pick another name.")
    taken = db.execute(select(WorkspaceMember).where(
        WorkspaceMember.workspace_id == str(workspace.id), WorkspaceMember.display_name == name,
        WorkspaceMember.status != "removed")).first()
    if taken:
        raise LinkError(409, f"There's already an agent named {name} here. Pick another name.")
    in_room = [p for p in (channel.participants or []) if p.agent_name != "__no_response__"]
    if len(in_room) >= MAX_AGENTS_PER_ROOM:
        raise LinkError(429, "This jam has as many agents as it can take")
    return name, agent_type, existing


def _place(db: Session, workspace: Workspace, channel: Channel, name: str, agent_type: str,
           owner_email: Optional[str], existing) -> WorkspaceMember:
    if existing is not None:
        db.delete(existing)   # a removed agent of the same name: start clean
        db.flush()
    member = WorkspaceMember(
        workspace_id=str(workspace.id), agent_name=name, display_name=None, owner_email=owner_email,
        role="member", agent_type=agent_type, status="offline",
    )
    db.add(member)
    if db.get(ChannelMember, (channel.id, name)) is None:
        db.add(ChannelMember(channel_id=channel.id, agent_name=name))
    return member


def add_owner_agent(db: Session, workspace: Workspace, channel: Channel, name: str, agent_type: str) -> dict:
    """The owner adds another of their agents; it connects with the jam's workspace token."""
    from app.services.legacy_ownership import workspace_owner_email
    name, agent_type, existing = _check_new_agent(db, workspace, channel, name, agent_type)
    _place(db, workspace, channel, name, agent_type, workspace_owner_email(db, workspace), existing)
    db.commit()
    return {"agent": {"name": name, "type": agent_type, "broughtBy": None},
            "commands": connect_commands(name, agent_type, workspace.password_hash)}


def _guest_of(db: Session, link: ThreadGuestLink, session: Optional[str], authorization: Optional[str]) -> ThreadGuest:
    guest = guest_for_session(db, link, session)
    if guest is None and (link.access or "link") == "invited":
        email = viewer_email(db, authorization)
        g = guest_for_user(db, link, email) if email else None
        guest = g if g is not None and g.revoked_at is None else None
    if guest is None:
        raise LinkError(401, "Pick a name first")
    return guest


def _bring_allowed(link: ThreadGuestLink):
    if not link.can_post:
        raise LinkError(403, "This link is read-only")
    if not link.allow_guest_agents:
        raise LinkError(403, "The owner doesn't let guests bring agents into this jam")


def bring_guest_agent(db: Session, token: str, session: Optional[str], authorization: Optional[str],
                      name: str, agent_type: str) -> dict:
    """A guest brings their own agent: a limited connection for that one agent in this one jam."""
    link, workspace, channel = live_link(db, token, authorization)
    _bring_allowed(link)
    guest = _guest_of(db, link, session, authorization)
    address = guest_address(guest.id)
    mine = db.execute(select(WorkspaceMember).where(
        WorkspaceMember.workspace_id == str(workspace.id), WorkspaceMember.owner_email == address,
        WorkspaceMember.status != "removed")).scalars().all()
    if len(mine) >= MAX_AGENTS_PER_GUEST:
        raise LinkError(429, f"You can bring up to {MAX_AGENTS_PER_GUEST} agents into a jam")
    name, agent_type, existing = _check_new_agent(db, workspace, channel, name, agent_type)
    if existing is not None:
        # A name used here before carries that agent's history (its control
        # events); a guest's agent always starts with a fresh one.
        raise LinkError(409, f"The name {name} was used here before. Pick another name.")
    _place(db, workspace, channel, name, agent_type, address, existing)
    for old in db.execute(select(Node).where(Node.workspace_id == str(workspace.id),
                                             Node.scope_agent == name)).scalars():
        db.delete(old)
    secret = "oag_" + secrets.token_urlsafe(32)
    db.add(Node(workspace_id=str(workspace.id), node_key=f"jam-guest-{secrets.token_hex(8)}",
                owner_email=address, name=f"{name} ({guest.display_name})", token=secret,
                scope_channel=channel.name, scope_agent=name))
    db.commit()
    return {"agent": {"name": name, "type": agent_type, "broughtBy": guest.display_name, "mine": True},
            "token": secret, "commands": connect_commands(name, agent_type, secret)}


def _remove(db: Session, workspace: Workspace, channel: Channel, member: WorkspaceMember) -> None:
    cm = db.get(ChannelMember, (channel.id, member.agent_name))
    if cm is not None:
        db.delete(cm)
    member.status = "removed"
    member.session_id = None
    for node in db.execute(select(Node).where(Node.workspace_id == str(workspace.id),
                                              Node.scope_agent == member.agent_name)).scalars():
        db.delete(node)
    if member.node_id:
        member.node_id = None


def remove_owner_agent(db: Session, workspace: Workspace, channel: Channel, name: str) -> dict:
    """The owner removes any agent but the one the jam was shared for."""
    member = db.get(WorkspaceMember, (str(workspace.id), name))
    if member is None or member.status == "removed" or db.get(ChannelMember, (channel.id, name)) is None:
        raise LinkError(404, "Agent not found")
    if name == channel.master_agent:
        raise LinkError(400, "This is the agent the jam was shared for; turn the link off instead")
    _remove(db, workspace, channel, member)
    db.commit()
    return {"name": name, "removed": True}


def remove_guest_agent(db: Session, token: str, session: Optional[str], authorization: Optional[str], name: str) -> dict:
    link, workspace, channel = live_link(db, token, authorization)
    guest = _guest_of(db, link, session, authorization)
    member = db.get(WorkspaceMember, (str(workspace.id), name))
    if member is None or member.status == "removed" or (member.owner_email or "").lower() != guest_address(guest.id):
        raise LinkError(404, "Agent not found")
    _remove(db, workspace, channel, member)
    db.commit()
    return {"name": name, "removed": True}


def remove_agents_of_guest(db: Session, workspace: Workspace, channel: Channel, guest_id: str) -> None:
    """When the owner removes a guest, their agents leave with them (caller commits)."""
    for member in db.execute(select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == str(workspace.id),
            WorkspaceMember.owner_email == guest_address(guest_id),
            WorkspaceMember.status != "removed")).scalars().all():
        _remove(db, workspace, channel, member)


def brought_by(db: Session, members) -> dict:
    """agent name → the display name of the guest who brought it (only guests' agents)."""
    ids = {m.agent_name: _guest_id(m.owner_email) for m in members if is_guest_agent(m)}
    names = {}
    for agent, gid in ids.items():
        guest = db.get(ThreadGuest, gid) if gid else None
        names[agent] = guest.display_name if guest else "a guest"
    return names


def set_allow_guest_agents(db: Session, workspace_id: str, link_id: str, allow: bool) -> ThreadGuestLink:
    from app.services.guest_links import _owned_link
    link = _owned_link(db, workspace_id, link_id)
    link.allow_guest_agents = bool(allow)
    db.commit()
    return link
