# -*- coding: utf-8 -*-
"""Kanban task endpoints — a workspace-wide, GitHub-issue-like board.

GET    /v1/tasks              List all tasks on the board
POST   /v1/tasks             Create a task (defaults to the Backlog column)
PATCH  /v1/tasks/{id}         Update a task (edit fields, drag between columns)
POST   /v1/tasks/{id}/assign  Assign to an agent → spins up the hidden thread
DELETE /v1/tasks/{id}         Delete a task (and archive its thread)

Distinct from `todos.py` (agent-private in-thread checklists). Assigning a task
creates a dedicated hidden `task:<id>` channel where the assigned agent does the
long-running work; a fast-model classifier in `workspace_mod` moves the card
between columns as the agent reports progress.
"""

import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, Path, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Channel, KanbanTask, Workspace, WorkspaceMember
from app.response import ResponseCode, json_response, success_response
from app.routers.network import (
    _emit_event_blocking,
    _resolve_workspace,
    _verify_workspace_access,
)
from openagents.core.onm_events import Event

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["Tasks"])


# ---------------------------------------------------------------------------
# Columns / constants
# ---------------------------------------------------------------------------

# The Kanban columns, in board order. Kept in sync with the frontend.
TASK_STATUSES = ("backlog", "todo", "in_progress", "need_input", "done")
TASK_PRIORITIES = ("low", "normal", "high")

# Hidden task threads share this channel-name prefix. The thread list and nav
# count filter these out (mirrors the `routines:` / `dm:` precedents), so a
# task's working thread never clutters the regular thread list.
TASK_CHANNEL_PREFIX = "task:"


def _task_channel_name(task_id: str) -> str:
    return f"{TASK_CHANNEL_PREFIX}{task_id}"


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class CreateTaskRequest(BaseModel):
    title: str
    description: str = ""
    status: str = "backlog"
    priority: str = "normal"
    network: str
    source: Optional[str] = None  # "human:..." who created the card


class UpdateTaskRequest(BaseModel):
    network: str
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    position: Optional[int] = None


class AssignTaskRequest(BaseModel):
    network: str
    agent: str                       # bare agent name to assign
    source: Optional[str] = None     # human who assigned (for the kickoff message)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _serialize_task(t: KanbanTask) -> dict:
    return {
        "id": t.id,
        "title": t.title,
        "description": t.description,
        "status": t.status,
        "assignee": t.assignee,
        "created_by": t.created_by,
        "channel_name": t.channel_name,
        "priority": t.priority,
        "position": t.position,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "updated_at": t.updated_at.isoformat() if t.updated_at else None,
    }


def _next_position(db: Session, workspace_id: str, status: str) -> int:
    """Append to the bottom of the target column."""
    rows = db.execute(
        select(KanbanTask.position).where(
            KanbanTask.workspace_id == workspace_id,
            KanbanTask.status == status,
        )
    ).scalars().all()
    return (max(rows) + 1) if rows else 0


def _kickoff_message(task: KanbanTask, agent: str) -> str:
    """The first message posted into the task thread when an agent is assigned.

    Frames the work as a long-running task and tells the agent the board's
    column semantics so its replies classify cleanly (the fast-model
    classifier in workspace_mod reads these replies to move the card).
    """
    desc = task.description.strip()
    body = f"\n\n{desc}" if desc else ""
    return (
        f"@{agent} You've been assigned this Kanban task. Work on it to "
        f"completion — this is a long-running task.\n\n"
        f"**{task.title}**{body}\n\n"
        f"When you need information or a decision from a human to continue, "
        f"say so clearly and end your message asking for that input — the "
        f"board will move the card to **Need Input** and notify the team. "
        f"When the task is fully finished, say so clearly and the card moves "
        f"to **Done**. Otherwise keep working and posting progress here."
    )


# ---------------------------------------------------------------------------
# GET /v1/tasks
# ---------------------------------------------------------------------------

@router.get("/tasks")
def list_tasks(
    network: str = Query(...),
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """List all Kanban tasks for the workspace board."""
    workspace = _resolve_workspace(db, network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    query = select(KanbanTask).where(KanbanTask.workspace_id == str(workspace.id))
    if status:
        query = query.where(KanbanTask.status == status)
    query = query.order_by(KanbanTask.status, KanbanTask.position, KanbanTask.created_at)
    rows = db.execute(query).scalars().all()

    return success_response({"tasks": [_serialize_task(r) for r in rows]})


# ---------------------------------------------------------------------------
# POST /v1/tasks
# ---------------------------------------------------------------------------

@router.post("/tasks")
def create_task(
    body: CreateTaskRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Create a task card (defaults to the Backlog column)."""
    workspace = _resolve_workspace(db, body.network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    title = (body.title or "").strip()
    if not title:
        return json_response(ResponseCode.BAD_REQUEST, "title is required")
    status = body.status if body.status in TASK_STATUSES else "backlog"
    priority = body.priority if body.priority in TASK_PRIORITIES else "normal"

    task = KanbanTask(
        workspace_id=str(workspace.id),
        title=title,
        description=(body.description or "").strip(),
        status=status,
        priority=priority,
        created_by=body.source or "human:user",
        position=_next_position(db, str(workspace.id), status),
    )
    db.add(task)
    db.commit()

    return success_response(_serialize_task(task))


# ---------------------------------------------------------------------------
# PATCH /v1/tasks/{task_id}
# ---------------------------------------------------------------------------

@router.patch("/tasks/{task_id}")
def update_task(
    body: UpdateTaskRequest,
    task_id: str = Path(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Update task fields — edit text, change priority, or drag between columns.

    Assignment is deliberately NOT handled here (it has side effects: creating
    the thread and kicking the agent off). Use POST /v1/tasks/{id}/assign.
    """
    workspace = _resolve_workspace(db, body.network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    task = db.execute(
        select(KanbanTask).where(
            KanbanTask.id == task_id,
            KanbanTask.workspace_id == str(workspace.id),
        )
    ).scalar_one_or_none()
    if not task:
        return json_response(ResponseCode.NOT_FOUND, "Task not found")

    if body.title is not None:
        title = body.title.strip()
        if title:
            task.title = title
    if body.description is not None:
        task.description = body.description.strip()
    if body.priority is not None and body.priority in TASK_PRIORITIES:
        task.priority = body.priority
    if body.status is not None and body.status in TASK_STATUSES:
        # Moving to a new column: append to the bottom unless an explicit
        # position is supplied.
        if body.status != task.status and body.position is None:
            task.position = _next_position(db, str(workspace.id), body.status)
        task.status = body.status
    if body.position is not None:
        task.position = body.position

    db.commit()
    return success_response(_serialize_task(task))


# ---------------------------------------------------------------------------
# POST /v1/tasks/{task_id}/assign
# ---------------------------------------------------------------------------

@router.post("/tasks/{task_id}/assign")
def assign_task(
    body: AssignTaskRequest,
    task_id: str = Path(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Assign a task to an agent — creates the hidden thread and kicks it off.

    On assignment we (1) create (or reuse) the ``task:<id>`` channel with the
    agent as master + participant, (2) post a kickoff message describing the
    task, which routes to the agent and starts the long-running work, and
    (3) move the card to In Progress.
    """
    workspace = _resolve_workspace(db, body.network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    task = db.execute(
        select(KanbanTask).where(
            KanbanTask.id == task_id,
            KanbanTask.workspace_id == str(workspace.id),
        )
    ).scalar_one_or_none()
    if not task:
        return json_response(ResponseCode.NOT_FOUND, "Task not found")

    agent = (body.agent or "").strip()
    if agent.startswith("openagents:"):
        agent = agent[len("openagents:"):]
    if not agent:
        return json_response(ResponseCode.BAD_REQUEST, "agent is required")

    # The agent must actually be a member of this workspace.
    is_member = db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.agent_name == agent,
        )
    ).scalar_one_or_none()
    if not is_member:
        return json_response(
            ResponseCode.FORBIDDEN,
            f"agent '{agent}' is not a member of this workspace",
        )

    human_source = body.source or "human:user"
    channel_name = task.channel_name or _task_channel_name(task.id)

    # 1. Create the hidden task channel (idempotent — reuse if it exists).
    existing_channel = db.execute(
        select(Channel).where(
            Channel.workspace_id == workspace.id,
            Channel.name == channel_name,
        )
    ).scalar_one_or_none()
    if existing_channel is None:
        create_evt = Event(
            type="network.channel.create",
            source=human_source,
            target="core",
            payload={
                "name": channel_name,
                "title": task.title,
                "master": agent,
                "participants": [agent],
            },
            metadata={},
        )
        _emit_event_blocking(create_evt, workspace, db, token=x_workspace_token)
    else:
        # Reassignment — point the existing channel at the new agent.
        existing_channel.master_agent = agent

    # 2. Post the kickoff message (routes to the agent, starts the work).
    kickoff = Event(
        type="workspace.message.posted",
        source=human_source,
        target=f"channel/{channel_name}",
        payload={"content": _kickoff_message(task, agent), "message_type": "chat"},
        metadata={"target_agents": [agent]},
    )
    _emit_event_blocking(kickoff, workspace, db, token=x_workspace_token)

    # 3. Move the card to In Progress.
    task.assignee = agent
    task.channel_name = channel_name
    task.status = "in_progress"
    task.position = _next_position(db, str(workspace.id), "in_progress")

    db.commit()
    return success_response(_serialize_task(task))


# ---------------------------------------------------------------------------
# DELETE /v1/tasks/{task_id}
# ---------------------------------------------------------------------------

@router.delete("/tasks/{task_id}")
def delete_task(
    task_id: str = Path(...),
    network: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Delete a task and archive its working thread, if any."""
    task = db.execute(
        select(KanbanTask).where(KanbanTask.id == task_id)
    ).scalar_one_or_none()
    if not task:
        return json_response(ResponseCode.NOT_FOUND, "Task not found")

    workspace = db.execute(
        select(Workspace).where(Workspace.id == task.workspace_id)
    ).scalar_one_or_none()
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    # Archive the linked thread so it stops appearing anywhere.
    if task.channel_name:
        channel = db.execute(
            select(Channel).where(
                Channel.workspace_id == workspace.id,
                Channel.name == task.channel_name,
            )
        ).scalar_one_or_none()
        if channel is not None:
            channel.status = "deleted"

    db.delete(task)
    db.commit()
    return success_response({"id": task_id, "status": "deleted"})
