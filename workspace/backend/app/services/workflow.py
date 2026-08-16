# -*- coding: utf-8 -*-
"""Workflow execution engine.

A ``WorkflowRun`` drives one thread (channel) through a snapshot of workflow
steps. The engine is event-driven: after each ``workspace.message.posted`` the
router schedules :func:`advance_workflow` (like ``invoke_cloud_agents``), which

  1. checks the message is the current step's output (from its assignee),
  2. asks the fast model whether the step is complete,
  3. evaluates the step's gate ("go to step X if <condition>") to pick the next
     step — forward (skip) or backward (loop),
  4. enforces the loop budget (``max_iterations``), and
  5. delivers the next step to its assignee (agent → a targeted message; human →
     an Inbox notification + Need Input), or completes the run.

Routing to the current step's agent is handled in ``workspace_mod`` by keying
off the presence of a running ``WorkflowRun`` for the channel; this module owns
the state machine and step delivery.
"""

import json as _json
import logging
from typing import Optional

from sqlalchemy import select

from app.database import SessionLocal
from app.models import (
    Channel,
    ChannelMember,
    CloudAgentConfig,
    KanbanTask,
    NotificationRecord,
    Workflow,
    WorkflowRun,
    Workspace,
)
from openagents.core.onm_events import Event

logger = logging.getLogger(__name__)

# Step-instruction messages are posted under this source so the router targets
# the step's agent (rather than re-running the generic router).
WORKFLOW_SOURCE = "system:workflow"


def _spawn(fn, *args) -> None:
    """Fire-and-forget a callable on a daemon thread.

    Step messages are emitted through the pipeline directly (not the
    POST /v1/events route), so the route's ``invoke_cloud_agents`` /
    ``advance_workflow`` hooks never see them. Daemon agents are unaffected
    (they poll for the step and reply through the route), but cloud/built-in
    agents like Yumi must be invoked explicitly — and without blocking the
    caller (a full tool loop takes seconds; /assign must return immediately).
    """
    import threading

    def _run():
        try:
            fn(*args)
        except Exception:
            logger.exception("workflow: background dispatch failed")

    threading.Thread(target=_run, daemon=True).start()


def _run_coro(coro_fn, *args) -> None:
    """Run an async function to completion in this (daemon) thread."""
    import asyncio
    asyncio.run(coro_fn(*args))


def _maybe_invoke_cloud_agent(db, workspace, channel_name: str, content: str, agent: str) -> None:
    """If the step's agent is a cloud agent, invoke it (detached, non-blocking)."""
    cfg = db.execute(
        select(CloudAgentConfig).where(
            CloudAgentConfig.workspace_id == str(workspace.id),
            CloudAgentConfig.agent_name == agent,
            CloudAgentConfig.status == "active",
        )
    ).scalar_one_or_none()
    if cfg is None:
        return  # daemon agent — it polls for the step and replies via the route
    from app.services.cloud_agent import invoke_cloud_agents
    snapshot = {
        "target": f"channel/{channel_name}",
        "source": WORKFLOW_SOURCE,
        "payload": {"content": content, "message_type": "chat"},
        "metadata": {"target_agents": [agent]},
    }
    _spawn(_run_coro, invoke_cloud_agents, str(workspace.id), snapshot)


# ---------------------------------------------------------------------------
# Snapshot helpers
# ---------------------------------------------------------------------------

def get_active_run(db, workspace_id: str, channel_name: str) -> Optional[WorkflowRun]:
    return db.execute(
        select(WorkflowRun).where(
            WorkflowRun.workspace_id == str(workspace_id),
            WorkflowRun.channel_name == channel_name,
            WorkflowRun.status == "running",
        )
    ).scalar_one_or_none()


def get_latest_run(db, workspace_id: str, channel_name: str) -> Optional[WorkflowRun]:
    """The channel's most recent run, whatever its status."""
    return db.execute(
        select(WorkflowRun).where(
            WorkflowRun.workspace_id == str(workspace_id),
            WorkflowRun.channel_name == channel_name,
        ).order_by(WorkflowRun.created_at.desc()).limit(1)
    ).scalar_one_or_none()


def pause_run(db, workspace_id: str, channel_name: str) -> bool:
    """Pause the channel's running workflow (the Stop button).

    A paused run is invisible to ``get_active_run``, so late agent replies no
    longer advance it or flip the task's column. Returns True if paused.
    """
    run = get_active_run(db, workspace_id, channel_name)
    if run is None:
        return False
    run.status = "paused"
    db.flush()
    return True


def cancel_run(db, workspace_id: str, channel_name: str) -> bool:
    """Terminally cancel any live (running/paused) run — e.g. task deleted."""
    run = get_latest_run(db, workspace_id, channel_name)
    if run is None or run.status not in ("running", "paused"):
        return False
    run.status = "cancelled"
    db.flush()
    return True


def resume_or_restart(db, workspace, channel_name: str, workflow, prev_output: str) -> Optional[WorkflowRun]:
    """The Run button's semantics for a channel that may already have a run.

    - running → leave it alone (idempotent Run).
    - paused  → resume: back to running and re-deliver the current step, so
      the assignee gets nudged rather than silently waiting.
    - done/stalled/cancelled/none → start a fresh run from step 1.
    """
    run = get_latest_run(db, str(workspace.id), channel_name)
    if run is not None and run.status == "running":
        return run
    if run is not None and run.status == "paused":
        run.status = "running"
        db.flush()
        step = _step_by_id(run, run.current_step)
        if step is not None:
            _deliver_step(db, workspace, run, step, prev_output)
            return run
        # Snapshot lost its step somehow — fall through to a fresh run.
    return start_run(db, workspace, channel_name, workflow, prev_output)


def _steps(run: WorkflowRun) -> list:
    return (run.snapshot or {}).get("steps", []) or []


def _step_by_id(run: WorkflowRun, step_id: Optional[str]) -> Optional[dict]:
    return next((s for s in _steps(run) if s.get("id") == step_id), None)


def _step_index(run: WorkflowRun, step_id: Optional[str]) -> int:
    for i, s in enumerate(_steps(run)):
        if s.get("id") == step_id:
            return i
    return -1


def run_info(run: Optional[WorkflowRun]) -> Optional[dict]:
    """Compact run-state summary for API serialization (task cards)."""
    if run is None:
        return None
    steps = _steps(run)
    idx = _step_index(run, run.current_step)
    step = steps[idx] if 0 <= idx < len(steps) else None
    assignee = (step or {}).get("assignee") or {}
    return {
        "status": run.status,
        "step_index": idx,                       # -1 when done/cancelled
        "step_count": len(steps),
        "step_name": (step or {}).get("name"),
        "step_assignee": assignee.get("agent") or assignee.get("human"),
        "step_assignee_kind": assignee.get("kind"),
        "iterations": run.iterations,
        "max_iterations": int((run.snapshot or {}).get("max_iterations", 5)),
    }


def _linked_task(db, workspace_id: str, channel_name: str) -> Optional[KanbanTask]:
    return db.execute(
        select(KanbanTask).where(
            KanbanTask.workspace_id == str(workspace_id),
            KanbanTask.channel_name == channel_name,
        )
    ).scalar_one_or_none()


# ---------------------------------------------------------------------------
# Fast-model judges (reuse the router client)
# ---------------------------------------------------------------------------

def _judge(prompt: str) -> Optional[str]:
    """Run a one-token judgment on the router model; None if no LLM/available."""
    from app.mods.workspace_mod import _get_llm_client, _get_router_api_key, _get_router_model

    if not _get_router_api_key():
        return None
    try:
        client, provider = _get_llm_client()
        model = _get_router_model()
        if provider == "openai":
            resp = client.chat.completions.create(
                model=model, max_tokens=10, messages=[{"role": "user", "content": prompt}],
            )
            return resp.choices[0].message.content.strip().lower()
        resp = client.messages.create(
            model=model, max_tokens=10, messages=[{"role": "user", "content": prompt}],
        )
        return resp.content[0].text.strip().lower()
    except Exception as exc:
        logger.warning("workflow judge failed: %s", exc)
        return None


_STEP_DONE_PROMPT = """\
An agent was asked to perform one step of a workflow. Decide whether the step is \
COMPLETE (the agent delivered the requested output) or still IN PROGRESS \
(intermediate note, or asking to continue).

Step instruction:
{instruction}

Agent's latest message:
{output}

Answer with exactly one word: done | working"""

_GATE_PROMPT = """\
Evaluate whether the following condition is TRUE given the step output.

Condition: {condition}

Step output:
{output}

Answer with exactly one word: yes | no"""


def _step_complete(step: dict, output: str) -> bool:
    # A human's reply IS the step output — never judged.
    if (step.get("assignee") or {}).get("kind") == "human":
        return True
    verdict = _judge(_STEP_DONE_PROMPT.format(
        instruction=step.get("instruction", ""), output=(output or "")[:1500],
    ))
    if verdict is None:
        return True  # no LLM configured → advance rather than stall
    return "done" in verdict


def _gate_met(step: dict, output: str) -> bool:
    gate = step.get("gate")
    if not gate:
        return False
    verdict = _judge(_GATE_PROMPT.format(
        condition=gate.get("condition", ""), output=(output or "")[:1500],
    ))
    if verdict is None:
        return False  # can't judge the loop condition → fall through, don't loop
    return verdict.startswith("yes")


# ---------------------------------------------------------------------------
# Delivery
# ---------------------------------------------------------------------------

def _emit(db, workspace, channel_name: str, content: str, metadata: Optional[dict] = None,
          source: str = WORKFLOW_SOURCE) -> None:
    from app.routers.network import _emit_event_blocking

    event = Event(
        type="workspace.message.posted",
        source=source,
        target=f"channel/{channel_name}",
        payload={"content": content, "message_type": "chat"},
        metadata=metadata or {},
    )
    _emit_event_blocking(event, workspace, db, token=workspace.password_hash)


def _ensure_member(db, channel: Channel, agent: str) -> None:
    exists = db.execute(
        select(ChannelMember).where(
            ChannelMember.channel_id == channel.id,
            ChannelMember.agent_name == agent,
        )
    ).scalar_one_or_none()
    if not exists:
        db.add(ChannelMember(channel_id=channel.id, agent_name=agent))
        db.flush()


def _deliver_step(db, workspace, run: WorkflowRun, step: dict, prev_output: str) -> None:
    channel = db.execute(
        select(Channel).where(
            Channel.workspace_id == workspace.id,
            Channel.name == run.channel_name,
        )
    ).scalar_one_or_none()

    name = step.get("name") or "Step"
    instruction = step.get("instruction", "")
    context = f"\n\nContext from the previous step:\n{prev_output[:1500]}" if prev_output else ""
    body = f"**Workflow step — {name}**\n\n{instruction}{context}"

    assignee = step.get("assignee") or {}
    task = _linked_task(db, str(workspace.id), run.channel_name)

    if assignee.get("kind") == "agent" and assignee.get("agent"):
        agent = assignee["agent"]
        if channel is not None:
            _ensure_member(db, channel, agent)
        if task is not None:
            task.status = "in_progress"
            task.assignee = agent
        db.flush()
        _emit(db, workspace, run.channel_name, body, metadata={"workflow_step": step["id"]})
        # Cloud agents (e.g. Yumi) don't poll — invoke them explicitly.
        _maybe_invoke_cloud_agent(db, workspace, run.channel_name, body, agent)
    else:
        # Human step — nobody is auto-targeted; notify + park on Need Input.
        human = assignee.get("human")
        mention = f"@{human} " if human else ""
        if task is not None:
            task.status = "need_input"
        db.flush()
        _emit(db, workspace, run.channel_name, f"{mention}{body}",
              metadata={"workflow_step": step["id"], "workflow_human": True})
        db.add(NotificationRecord(
            workspace_id=str(workspace.id),
            created_by=WORKFLOW_SOURCE,
            title="Workflow step needs you",
            message=(f"{human}: " if human else "") + f"“{(run.snapshot or {}).get('name', 'Workflow')}” — {name}",
            priority="high",
            channel_name=run.channel_name,
        ))
        db.flush()


def _complete(db, workspace, run: WorkflowRun) -> None:
    run.status = "done"
    run.current_step = None
    task = _linked_task(db, str(workspace.id), run.channel_name)
    if task is not None:
        task.status = "done"
    db.flush()
    _emit(db, workspace, run.channel_name,
          f"✅ Workflow “{(run.snapshot or {}).get('name', '')}” complete.", metadata={})


def _stall(db, workspace, run: WorkflowRun) -> None:
    run.status = "stalled"
    task = _linked_task(db, str(workspace.id), run.channel_name)
    if task is not None:
        task.status = "need_input"
    db.add(NotificationRecord(
        workspace_id=str(workspace.id),
        created_by=WORKFLOW_SOURCE,
        title="Workflow needs review",
        message=f"“{(run.snapshot or {}).get('name', 'Workflow')}” hit its max iterations and paused for review.",
        priority="high",
        channel_name=run.channel_name,
    ))
    db.flush()
    _emit(db, workspace, run.channel_name,
          "⚠️ This workflow reached its maximum iterations and paused for human review.", metadata={})


# ---------------------------------------------------------------------------
# Start + advance
# ---------------------------------------------------------------------------

def start_run(db, workspace, channel_name: str, workflow: Workflow, prev_output: str) -> Optional[WorkflowRun]:
    """Create a run from a template snapshot and deliver its first step."""
    steps = workflow.steps or []
    if not steps:
        return None
    run = WorkflowRun(
        workspace_id=str(workspace.id),
        workflow_id=workflow.id,
        channel_name=channel_name,
        snapshot={"name": workflow.name, "steps": steps, "max_iterations": workflow.max_iterations},
        current_step=steps[0]["id"],
        iterations=0,
        status="running",
    )
    db.add(run)
    db.flush()
    _deliver_step(db, workspace, run, steps[0], prev_output)
    return run


def run_advance(db, workspace_id: str, event_data: dict) -> bool:
    """Core state-machine step for one message. Returns True if it advanced.

    Session-injected so it's testable; :func:`advance_workflow` wraps it with a
    fresh session for the background-task path.
    """
    target = event_data.get("target", "") or ""
    if not target.startswith("channel/"):
        return False
    channel_name = target[len("channel/"):]

    run = get_active_run(db, workspace_id, channel_name)
    if not run or not run.current_step:
        return False
    step = _step_by_id(run, run.current_step)
    if not step:
        return False

    # Only the current step's assignee's message counts as the step output.
    source = event_data.get("source", "") or ""
    kind = (step.get("assignee") or {}).get("kind")
    if kind == "agent":
        if source != f"openagents:{(step['assignee'].get('agent') or '')}":
            return False
    else:  # human step
        if not source.startswith("human:"):
            return False

    output = (event_data.get("payload") or {}).get("content", "") or ""

    workspace = db.execute(
        select(Workspace).where(Workspace.id == workspace_id)
    ).scalar_one_or_none()
    if not workspace:
        return False

    if not _step_complete(step, output):
        return False  # still working — wait for the next message

    # Resolve the next step: gate target (skip/loop) or the following step.
    steps = _steps(run)
    idx = _step_index(run, step["id"])
    if _gate_met(step, output):
        target_id = step["gate"]["target"]
        tgt_idx = _step_index(run, target_id)
    else:
        tgt_idx = idx + 1
        target_id = steps[tgt_idx]["id"] if tgt_idx < len(steps) else None

    # Loop budget: a backward/self jump counts as an iteration.
    if target_id is not None and tgt_idx <= idx:
        run.iterations += 1
        if run.iterations > int((run.snapshot or {}).get("max_iterations", 5)):
            _stall(db, workspace, run)
            return True

    if target_id is None:
        _complete(db, workspace, run)
    else:
        run.current_step = target_id
        db.flush()
        _deliver_step(db, workspace, run, _step_by_id(run, target_id), output)
    return True


def advance_workflow(workspace_id: str, event_data: dict) -> None:
    """Background hook: react to a message in a workflow channel and advance.

    Opens its own DB session (the request session is gone by now), mirroring
    ``invoke_cloud_agents``. Never raises — a workflow bug must not break the
    event that triggered it.
    """
    db = SessionLocal()
    try:
        if run_advance(db, workspace_id, event_data):
            db.commit()
    except Exception:
        logger.exception("advance_workflow failed for %s", event_data.get("target"))
    finally:
        db.close()
