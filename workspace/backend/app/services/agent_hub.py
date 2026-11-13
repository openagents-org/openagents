"""Agent hub: delegate work to a person's OpenAgents agents from another app.

One implementation behind both the hub REST API (`/v1/hub/*`) and the MCP
endpoint (`/mcp`). Every operation runs the ordinary workspace handlers as the
person (see `hub_auth.acting_authorization`), so thread visibility, agent
sharing and membership rules are the same as in the web app.

Agents take minutes, while a tool call has to answer in seconds, so delegation
is fire-and-forget: `delegate` returns the new thread at once and the caller
checks back with `check_thread`.
"""
import json
import time
from typing import Optional

from fastapi import BackgroundTasks
from sqlalchemy import select

from app.config import config
from app.models import Channel, User, Workspace, WorkspaceMembership
from app.services.hub_auth import acting_authorization

MAX_TASK_CHARS = 20000
MESSAGE_PREVIEW_CHARS = 4000
# An agent that posted progress this recently is treated as still working.
WORKING_WINDOW_MS = 3 * 60 * 1000
_HIDDEN_MESSAGE_TYPES = "thinking,todos"


class HubError(Exception):
    """A problem the calling app (or the model driving it) can act on."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


def _data(response):
    """Unwrap a workspace handler's result, raising its error as a HubError."""
    if isinstance(response, dict):
        return response.get("data")
    body = json.loads(response.body or b"{}")
    if response.status_code >= 400 or body.get("code", 0) >= 400:
        raise HubError(body.get("message") or "Request failed", response.status_code if response.status_code >= 400 else body.get("code", 400))
    return body.get("data")


def thread_url(workspace: Workspace, thread: str) -> str:
    return f"{config.FRONTEND_BASE_URL.rstrip('/')}/{workspace.slug or workspace.id}/threads/{thread}"


def list_workspaces(db, user: User) -> list[dict]:
    rows = db.execute(
        select(Workspace, WorkspaceMembership.role)
        .join(WorkspaceMembership, WorkspaceMembership.workspace_id == Workspace.id)
        .where(WorkspaceMembership.user_id == user.id, Workspace.status != "deleted")
        .order_by(Workspace.created_at)
    ).all()
    return [{"id": str(ws.id), "slug": ws.slug, "name": ws.name, "role": role} for ws, role in rows]


def resolve_workspace(db, user: User, ref: Optional[str]) -> Workspace:
    """A workspace the person belongs to, by id, slug or name; optional when they have one."""
    options = list_workspaces(db, user)
    if not options:
        raise HubError("You are not a member of any workspace yet. Create one at " + config.FRONTEND_BASE_URL, 404)
    if not ref:
        if len(options) == 1:
            match = options[0]
        else:
            raise HubError("Choose a workspace: " + ", ".join(f"{o['name']} ({o['slug']})" for o in options))
    else:
        needle = ref.strip().lower()
        found = [o for o in options if needle in (o["id"].lower(), (o["slug"] or "").lower(), (o["name"] or "").lower())]
        if not found:
            raise HubError(f"No workspace '{ref}'. Yours: " + ", ".join(f"{o['name']} ({o['slug']})" for o in options), 404)
        match = found[0]
    return db.get(Workspace, match["id"])


def list_agents(db, user: User, workspace: Workspace) -> list[dict]:
    from app.routers.network import discover
    data = _data(discover(network=str(workspace.id), read_at=None, db=db, x_workspace_token=None,
                          authorization=acting_authorization(user)))
    agents = []
    for agent in (data or {}).get("agents", []):
        name = (agent.get("address") or "").removeprefix("openagents:")
        if not name:
            continue
        agents.append({
            "name": name,
            "status": agent.get("status") or "unknown",
            "type": agent.get("agent_type"),
            "description": agent.get("description") or "",
        })
    return agents


def _send(db, user: User, workspace: Workspace, background_tasks: BackgroundTasks, **event) -> dict:
    from app.routers.events import SendEventRequest, send_event
    request = SendEventRequest(network=str(workspace.id), source=f"human:{user.email}", **event)
    return _data(send_event(request, background_tasks, db=db, x_workspace_token=None,
                            authorization=acting_authorization(user))) or {}


def _message_payload(user: User, content: str, agents: list[str], via: str) -> dict:
    payload = {
        "content": content,
        "sender_type": "human",
        "sender_id": user.email,
        "sender_email": user.email,
        "sender_name": user.display_name or user.email,
        "hub_client": via,
    }
    if agents:
        payload["mentions"] = agents
    return payload


def _clean_agents(db, user: User, workspace: Workspace, agents: Optional[list[str]]) -> list[str]:
    names = [a.strip().removeprefix("@").removeprefix("openagents:") for a in (agents or []) if a and a.strip()]
    names = list(dict.fromkeys(names))
    if not names:
        return []
    known = {a["name"]: a for a in list_agents(db, user, workspace)}
    missing = [n for n in names if n not in known]
    if missing:
        raise HubError(f"Unknown agent(s): {', '.join(missing)}. Available: " + (", ".join(known) or "none"), 404)
    return names


def _check_task(text: str) -> str:
    text = (text or "").strip()
    if not text:
        raise HubError("The task is empty")
    if len(text) > MAX_TASK_CHARS:
        raise HubError(f"The task is longer than {MAX_TASK_CHARS} characters")
    return text


def delegate(db, user: User, workspace: Workspace, background_tasks: BackgroundTasks, task: str,
             agents: Optional[list[str]] = None, title: Optional[str] = None, via: str = "API") -> dict:
    """Start a new thread with the chosen agents and post the task to them."""
    task = _check_task(task)
    names = _clean_agents(db, user, workspace, agents)
    offline = []
    if names:
        status = {a["name"]: a["status"] for a in list_agents(db, user, workspace)}
        offline = [n for n in names if status.get(n) != "online"]
    create = {"sender_id": user.email, "title": (title or "").strip()[:120] or f"Via {via}: {task[:60]}"}
    if names:
        create.update({"participants": names, "master": names[0]})
    created = _send(db, user, workspace, background_tasks, type="network.channel.create",
                    target="core", payload=create)
    thread = (created.get("metadata") or {}).get("channel_name")
    if not thread:
        raise HubError("The thread could not be created", 500)
    mentions = " ".join(f"@{n}" for n in names)
    content = f"{mentions} {task}" if mentions and not all(f"@{n}" in task for n in names) else task
    _send(db, user, workspace, background_tasks, type="workspace.message.posted", target=f"channel/{thread}",
          payload=_message_payload(user, content, names, via), metadata={"hub_client": via})
    return {
        "workspace": workspace.slug or str(workspace.id),
        "thread": thread,
        "url": thread_url(workspace, thread),
        "agents": names,
        "offline_agents": offline,
        "note": ("These agents are offline and will pick the task up when they come back online: " + ", ".join(offline))
        if offline else "The agents are working on it. Check back with check_thread.",
    }


def _channel(db, workspace: Workspace, thread: str) -> Channel:
    channel = db.execute(select(Channel).where(
        Channel.workspace_id == workspace.id, Channel.name == thread,
    )).scalar_one_or_none()
    if channel is None:
        raise HubError(f"No thread '{thread}' in this workspace", 404)
    return channel


def check_thread(db, user: User, workspace: Workspace, thread: str, limit: int = 20) -> dict:
    """The thread's recent messages and whether its agents are still working."""
    from app.routers.events import poll_events
    channel = _channel(db, workspace, thread)
    data = _data(poll_events(
        network=str(workspace.id), after=None, before=None, target=None, channel=thread,
        type="workspace.message", target_agents=None, conversation=None, search=None, member=None,
        exclude_message_types=_HIDDEN_MESSAGE_TYPES, sort="desc", limit=max(1, min(limit, 100)) * 2,
        db=db, x_workspace_token=None, authorization=acting_authorization(user),
    )) or {}
    events = list(reversed(data.get("events") or []))
    messages, last_human, last_agent_reply, last_agent_progress = [], 0, 0, 0
    for event in events:
        if event.get("type") != "workspace.message.posted":
            continue
        payload = event.get("payload") or {}
        kind = payload.get("message_type") or "chat"
        source = event.get("source") or ""
        ts = int(event.get("timestamp") or 0)
        if source.startswith("human:"):
            last_human = max(last_human, ts)
        elif kind == "chat":
            last_agent_reply = max(last_agent_reply, ts)
        else:
            last_agent_progress = max(last_agent_progress, ts)
        if kind not in ("chat", "status"):
            continue
        content = payload.get("content") or ""
        messages.append({
            "id": event.get("id"),
            "from": payload.get("sender_name") or source.split(":", 1)[-1],
            "kind": "agent" if source.startswith("openagents:") else "person" if source.startswith("human:") else "system",
            "type": kind,
            "content": content[:MESSAGE_PREVIEW_CHARS] + ("…" if len(content) > MESSAGE_PREVIEW_CHARS else ""),
            "attachments": [a.get("filename") for a in payload.get("attachments") or [] if isinstance(a, dict)],
            "time": ts,
        })
    now_ms = int(time.time() * 1000)
    if last_agent_progress > last_agent_reply and now_ms - last_agent_progress < WORKING_WINDOW_MS:
        state = "working"
    elif last_agent_reply and last_agent_reply >= last_human:
        state = "replied"
    else:
        state = "waiting"
    return {
        "workspace": workspace.slug or str(workspace.id),
        "thread": thread,
        "title": channel.title,
        "url": thread_url(workspace, thread),
        "state": state,
        "messages": [m for m in messages if m["type"] == "chat" or m is messages[-1]][-limit:],
    }


def reply(db, user: User, workspace: Workspace, background_tasks: BackgroundTasks, thread: str, content: str,
          agents: Optional[list[str]] = None, via: str = "API") -> dict:
    """Post a follow-up in a thread, optionally @mentioning agents."""
    content = _check_task(content)
    _channel(db, workspace, thread)
    names = _clean_agents(db, user, workspace, agents)
    mentions = " ".join(f"@{n}" for n in names if f"@{n}" not in content)
    _send(db, user, workspace, background_tasks, type="workspace.message.posted", target=f"channel/{thread}",
          payload=_message_payload(user, f"{mentions} {content}".strip(), names, via), metadata={"hub_client": via})
    return {"workspace": workspace.slug or str(workspace.id), "thread": thread, "url": thread_url(workspace, thread),
            "posted": True}


def list_threads(db, user: User, workspace: Workspace, limit: int = 20) -> list[dict]:
    """Threads this person started, newest first."""
    rows = db.execute(
        select(Channel).where(
            Channel.workspace_id == workspace.id,
            Channel.created_by.in_([f"human:{user.email}", user.email]),
            Channel.status != "deleted",
        ).order_by(Channel.created_at.desc()).limit(max(1, min(limit, 100)))
    ).scalars().all()
    return [{"thread": c.name, "title": c.title, "url": thread_url(workspace, c.name),
             "created_at": c.created_at.isoformat() if c.created_at else None} for c in rows]
