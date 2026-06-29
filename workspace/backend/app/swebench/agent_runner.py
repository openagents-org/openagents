# -*- coding: utf-8 -*-
"""
Driving a connected coding agent to solve one instance.

SWE-bench reuses the workspace's existing agent connection: we post the task
into the job's dedicated channel targeting the selected agent, the (locally
connected) agent polls/works in the prepared instance directory, and we watch
the channel for it to finish. The agent only ever receives ``public_view`` of
the instance — never the gold patch, test patch, or measured tests.

The :class:`AgentRunner` protocol is the seam tests replace with a fake that
writes a patch directly, so the whole pipeline runs without a real agent.
"""

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Any, Callable, Dict, Optional, Protocol

from sqlalchemy import select

from .config import config

logger = logging.getLogger(__name__)

# The agent is asked to end its final message with this exact line.
DONE_SENTINEL = "[[SWEBENCH_TASK_COMPLETE]]"


@dataclass
class AgentRunResult:
    completed: bool
    reason: str          # "sentinel" | "idle" | "timeout" | "cancelled"
    message_count: int


class AgentRunner(Protocol):
    async def run(
        self,
        *,
        workspace_id: str,
        token: Optional[str],
        job: Dict[str, Any],
        public_instance: Dict[str, Any],
        instance_rel_path: str,
        instance_abs_path: str,
        should_cancel: Callable[[], bool],
    ) -> AgentRunResult:
        ...


def build_task_prompt(
    *,
    public_instance: Dict[str, Any],
    instance_rel_path: str,
    instance_abs_path: str,
) -> str:
    """Construct the agent-facing task message from PUBLIC fields only."""
    repo = public_instance.get("repo", "")
    base_commit = public_instance.get("base_commit", "")
    problem = public_instance.get("problem_statement", "") or ""
    return (
        "You have been assigned a **SWE-bench software engineering task**.\n\n"
        f"A clean checkout of `{repo}` at base commit `{base_commit}` has been "
        f"prepared for you at:\n"
        f"  - absolute path: `{instance_abs_path}`\n"
        f"  - relative to your working directory: `{instance_rel_path}`\n\n"
        "Work ONLY inside that directory. Read the codebase and implement a "
        "fix that resolves the issue below.\n\n"
        "RULES (benchmark integrity — your changes are graded by an external "
        "harness):\n"
        "  1. Do NOT create, modify, or delete any test files.\n"
        "  2. Do NOT modify the existing test suite to make it pass.\n"
        "  3. Do NOT attempt to read evaluation results, hidden tests, or other "
        "instances.\n"
        "  4. Make the minimal source change needed to fix the issue.\n"
        "  5. Leave your changes uncommitted in the working tree (they are "
        "collected with `git diff`).\n\n"
        f"When you are finished, reply with a short summary and end your final "
        f"message with this exact line on its own:\n{DONE_SENTINEL}\n\n"
        "----- ISSUE -----\n"
        f"{problem}\n"
        "----- END ISSUE -----\n"
    )


class WorkspaceAgentRunner:
    """Real runner: posts the task and watches the channel for completion."""

    def __init__(self, session_factory):
        self._session_factory = session_factory

    async def run(
        self,
        *,
        workspace_id: str,
        token: Optional[str],
        job: Dict[str, Any],
        public_instance: Dict[str, Any],
        instance_rel_path: str,
        instance_abs_path: str,
        should_cancel: Callable[[], bool],
    ) -> AgentRunResult:
        channel = job["channel_name"]
        agent = job["selected_agent"]
        prompt = build_task_prompt(
            public_instance=public_instance,
            instance_rel_path=instance_rel_path,
            instance_abs_path=instance_abs_path,
        )
        start_ms = int(time.time() * 1000)
        await self._post_task(workspace_id, token, channel, agent, prompt)
        # We deliberately log only that a task was posted — never the prompt.
        logger.info("swebench task posted job=%s agent=%s", job["id"], agent)

        deadline = time.monotonic() + config.AGENT_TIMEOUT_SECONDS
        idle = config.AGENT_IDLE_SECONDS
        last_seen_ms = start_ms
        message_count = 0

        while True:
            if should_cancel():
                return AgentRunResult(False, "cancelled", message_count)
            msgs = await asyncio.to_thread(
                self._fetch_agent_messages, workspace_id, channel, agent, start_ms
            )
            message_count = len(msgs)
            if msgs:
                last_seen_ms = max(m["timestamp"] for m in msgs)
                if any(DONE_SENTINEL in (m.get("content") or "") for m in msgs):
                    return AgentRunResult(True, "sentinel", message_count)
            now = time.monotonic()
            if now >= deadline:
                return AgentRunResult(False, "timeout", message_count)
            # Idle completion: agent spoke, then went quiet for `idle` seconds.
            if message_count >= 1 and (int(time.time() * 1000) - last_seen_ms) >= idle * 1000:
                return AgentRunResult(True, "idle", message_count)
            await asyncio.sleep(min(5, max(1, idle // 10)))

    # ── internals ──

    async def _post_task(self, workspace_id, token, channel, agent, prompt):
        from app.models import Workspace
        from app.routers.network import _emit_event
        from openagents.core.onm_events import Event

        db = self._session_factory()
        try:
            workspace = db.execute(
                select(Workspace).where(Workspace.id == workspace_id)
            ).scalar_one_or_none()
            if workspace is None:
                raise RuntimeError("workspace vanished while posting task")
            event = Event(
                type="workspace.message.posted",
                source="system:evaluation",
                target=f"channel/{channel}",
                payload={"content": prompt, "message_type": "chat"},
                metadata={"target_agents": [agent]},
            )
            await _emit_event(event, workspace, db, token=token or workspace.password_hash)
        finally:
            db.close()

    def _fetch_agent_messages(self, workspace_id, channel, agent, since_ms):
        from app.models import EventRecord

        db = self._session_factory()
        try:
            rows = db.execute(
                select(EventRecord).where(
                    EventRecord.network_id == workspace_id,
                    EventRecord.target == f"channel/{channel}",
                    EventRecord.type == "workspace.message.posted",
                    EventRecord.source == f"openagents:{agent}",
                    EventRecord.timestamp > since_ms,
                ).order_by(EventRecord.timestamp.asc())
            ).scalars().all()
            return [
                {"timestamp": r.timestamp, "content": (r.payload or {}).get("content", "")}
                for r in rows
            ]
        finally:
            db.close()
