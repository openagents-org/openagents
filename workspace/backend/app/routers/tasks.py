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
from app.models import Channel, KanbanTask, Workflow, Workspace, WorkspaceMember
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


def _bare_agent(name: Optional[str]) -> Optional[str]:
    """Normalize an agent reference to its bare name (strip `openagents:`).

    An empty/whitespace value returns None so callers can clear the assignee.
    """
    if not name:
        return None
    name = name.strip()
    if name.startswith("openagents:"):
        name = name[len("openagents:"):]
    return name or None


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class CreateTaskRequest(BaseModel):
    title: str
    description: str = ""
    status: str = "backlog"
    priority: str = "normal"
    assignee: Optional[str] = None  # pre-assign an agent WITHOUT running it
    workflow_id: Optional[str] = None  # run via a workflow instead of a single agent
    network: str
    source: Optional[str] = None  # "human:..." who created the card


class UpdateTaskRequest(BaseModel):
    network: str
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    position: Optional[int] = None
    # Set/change the assigned agent WITHOUT running it. "" clears the assignee.
    assignee: Optional[str] = None
    # Assign the task to a workflow ("" clears it, back to single-agent).
    workflow_id: Optional[str] = None


class AssignTaskRequest(BaseModel):
    network: str
    agent: Optional[str] = None      # bare agent to run; falls back to task.assignee
    source: Optional[str] = None     # human who ran it (for the kickoff message)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _serialize_task(t: KanbanTask, run: Optional[dict] = None, last_message: Optional[str] = None) -> dict:
    return {
        "id": t.id,
        "title": t.title,
        "description": t.description,
        "status": t.status,
        "assignee": t.assignee,
        "workflow_id": t.workflow_id,
        "created_by": t.created_by,
        "channel_name": t.channel_name,
        "priority": t.priority,
        "position": t.position,
        # Live workflow-run summary (step X of N, who's on it) — only for
        # workflow tasks with a run; see workflow.run_info.
        "run": run,
        # Latest chat message in the thread — surfaced on need_input cards so
        # the human can see the question without opening the popup.
        "last_message": last_message,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "updated_at": t.updated_at.isoformat() if t.updated_at else None,
    }


def _enrich(db: Session, workspace_id: str, tasks_list: list) -> list:
    """Serialize tasks with run summaries + need-input snippets, batched.

    One query for all runs, one for the latest chat message per need-input
    channel — not a query per task.
    """
    from app.models import EventRecord, WorkflowRun
    from app.services.workflow import run_info

    wf_channels = [t.channel_name for t in tasks_list if t.workflow_id and t.channel_name]
    runs_by_channel: dict = {}
    if wf_channels:
        runs = db.execute(
            select(WorkflowRun).where(
                WorkflowRun.workspace_id == workspace_id,
                WorkflowRun.channel_name.in_(wf_channels),
            ).order_by(WorkflowRun.created_at.asc())
        ).scalars().all()
        for r in runs:  # ascending → the latest run per channel wins
            runs_by_channel[r.channel_name] = r

    snippet_channels = [t.channel_name for t in tasks_list if t.status == "need_input" and t.channel_name]
    last_by_channel: dict = {}
    if snippet_channels:
        targets = [f"channel/{c}" for c in snippet_channels]
        events = db.execute(
            select(EventRecord).where(
                EventRecord.network_id == workspace_id,
                EventRecord.type == "workspace.message.posted",
                EventRecord.target.in_(targets),
            ).order_by(EventRecord.timestamp.asc())
        ).scalars().all()
        for e in events:  # ascending → last chat message per channel wins
            if (e.payload or {}).get("message_type", "chat") == "chat":
                content = (e.payload or {}).get("content") or ""
                if content:
                    last_by_channel[e.target[len("channel/"):]] = content[:280]

    return [
        _serialize_task(
            t,
            run=run_info(runs_by_channel.get(t.channel_name)) if t.channel_name else None,
            last_message=last_by_channel.get(t.channel_name) if t.channel_name else None,
        )
        for t in tasks_list
    ]


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

    return success_response({"tasks": _enrich(db, str(workspace.id), list(rows))})


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
        # Pre-assigning an agent (or workflow) here only records who *will* run
        # it — it does NOT start the work. Execution happens via POST /assign (Run).
        assignee=_bare_agent(body.assignee),
        workflow_id=(body.workflow_id or None),
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
    """Update task fields — edit text, move columns, or set the assignee.

    Setting ``assignee`` here only records who will run the task; it does NOT
    start the work (no thread, no kickoff). Execution is triggered separately
    by POST /v1/tasks/{id}/assign (the board's "Run" button).
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
        # Stopping a workflow task (→ backlog) must pause its run, or a late
        # agent reply would advance the run and yank the card back.
        if body.status == "backlog" and task.workflow_id and task.channel_name:
            from app.services.workflow import pause_run
            pause_run(db, str(workspace.id), task.channel_name)
        task.status = body.status
    if body.position is not None:
        task.position = body.position
    if body.assignee is not None:
        # "" clears the assignee; a name (bare or openagents:) sets it.
        task.assignee = _bare_agent(body.assignee)
    if body.workflow_id is not None:
        # "" clears (back to single-agent); a value assigns the task to a workflow.
        task.workflow_id = body.workflow_id or None

    db.commit()
    return success_response(_serialize_task(task))


# ---------------------------------------------------------------------------
# POST /v1/tasks/{task_id}/assign
# ---------------------------------------------------------------------------

def _run_workflow_task(db, workspace, task, human_source: str, token: Optional[str]):
    """Start a WorkflowRun for a task assigned to a workflow (the "Run" action).

    Creates the hidden task thread (with all agent-step agents as participants),
    then hands off to the engine to deliver step 1. Moving the card through
    columns is owned by the workflow engine from here on.
    """
    from app.services.workflow import resume_or_restart

    workflow = db.execute(
        select(Workflow).where(
            Workflow.id == task.workflow_id,
            Workflow.workspace_id == str(workspace.id),
        )
    ).scalar_one_or_none()
    if not workflow:
        return json_response(ResponseCode.NOT_FOUND, "Workflow not found")
    if not (workflow.steps or []):
        return json_response(ResponseCode.BAD_REQUEST, "workflow has no steps")

    channel_name = task.channel_name or _task_channel_name(task.id)

    # Create the hidden thread if it doesn't exist yet, seeding it with every
    # agent that appears as a step assignee.
    existing_channel = db.execute(
        select(Channel).where(
            Channel.workspace_id == workspace.id,
            Channel.name == channel_name,
        )
    ).scalar_one_or_none()
    if existing_channel is None:
        agents = []
        for step in workflow.steps:
            a = (step.get("assignee") or {})
            if a.get("kind") == "agent" and a.get("agent") and a["agent"] not in agents:
                agents.append(a["agent"])
        create_evt = Event(
            type="network.channel.create",
            source=human_source,
            target="core",
            payload={
                "name": channel_name,
                "title": task.title,
                "participants": agents or ["__no_response__"],
            },
            metadata={},
        )
        _emit_event_blocking(create_evt, workspace, db, token=token)

    task.channel_name = channel_name
    task.status = "in_progress"
    task.position = _next_position(db, str(workspace.id), "in_progress")
    db.flush()

    # Run semantics: no-op if already running, resume a paused run (re-deliver
    # the current step), or start fresh when the last run finished/was stopped.
    prev = task.title + (f"\n\n{task.description}" if task.description else "")
    resume_or_restart(db, workspace, channel_name, workflow, prev)

    db.commit()
    return success_response(_serialize_task(task))


@router.post("/tasks/{task_id}/assign")
def assign_task(
    body: AssignTaskRequest,
    task_id: str = Path(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Run a task on an agent — creates the hidden thread and kicks it off.

    This is the board's "Run" action. The agent comes from the request body or,
    if omitted, the task's pre-set ``assignee``. We (1) create (or reuse) the
    ``task:<id>`` channel with the agent as master + participant, (2) post a
    kickoff message that routes to the agent and starts the long-running work,
    and (3) move the card to In Progress.
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

    # ── Workflow task: start a WorkflowRun instead of a single-agent kickoff ──
    if task.workflow_id:
        return _run_workflow_task(db, workspace, task, body.source or "human:user", x_workspace_token)

    # Agent to run: explicit in the request, else the task's pre-set assignee.
    agent = _bare_agent(body.agent) or _bare_agent(task.assignee)
    if not agent:
        return json_response(ResponseCode.BAD_REQUEST, "no agent to run: assign one first")

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

    # Archive the linked thread so it stops appearing anywhere, and kill any
    # live workflow run so the engine can't keep acting on a deleted task.
    if task.channel_name:
        channel = db.execute(
            select(Channel).where(
                Channel.workspace_id == workspace.id,
                Channel.name == task.channel_name,
            )
        ).scalar_one_or_none()
        if channel is not None:
            channel.status = "deleted"
        from app.services.workflow import cancel_run
        cancel_run(db, str(workspace.id), task.channel_name)

    db.delete(task)
    db.commit()
    return success_response({"id": task_id, "status": "deleted"})
