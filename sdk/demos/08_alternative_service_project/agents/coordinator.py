#!/usr/bin/env python3
"""
Python-based Coordinator Agent - No LLM
Extends WorkerAgent for clean event-driven handling.
"""
import asyncio
import logging
from typing import Dict, Any, Optional

from openagents.agents.worker_agent import WorkerAgent, on_event
from openagents.models.event_context import EventContext
from openagents.mods.coordination.task_delegation import TaskDelegationAdapter
from openagents.mods.workspace.project import DefaultProjectAgentAdapter

logger = logging.getLogger(__name__)


class CoordinatorAgent(WorkerAgent):
    """
    Pure Python coordinator that orchestrates searcher and comparer agents.

    Workflow:
    1. Receive project start → delegate to searcher
    2. Searcher completes → send results, delegate to comparer
    3. Comparer completes → send comparison, complete project
    """

    default_agent_id = "coordinator"

    def __init__(self, **kwargs):
        super().__init__(**kwargs)

        # Track task_id -> project_id mappings
        self.project_states: Dict[str, str] = {}
        # Track pending tasks: task_id -> asyncio.Event for completion notification
        self.pending_tasks: Dict[str, asyncio.Event] = {}
        # Store task results: task_id -> result
        self.task_results: Dict[str, Any] = {}

        # Initialize adapters but don't bind yet (client not ready)
        self.delegation_adapter = TaskDelegationAdapter()
        self.project_adapter = DefaultProjectAgentAdapter()

    async def on_startup(self):
        """Called after successful connection and setup."""
        # Now bind the adapters after client is initialized
        self.delegation_adapter.bind_client(self.client)
        self.delegation_adapter.bind_connector(self.client.connector)
        self.delegation_adapter.bind_agent(self.agent_id)
        self.project_adapter.bind_client(self.client)
        self.project_adapter.bind_connector(self.client.connector)
        self.project_adapter.bind_agent(self.agent_id)

        logger.info(f"Coordinator '{self.client.agent_id}' started")
        logger.info("Workflow: searcher → comparer → complete")
        logger.info("Adapters initialized and bound")

    async def _delegate_task(self, assignee_id: str, description: str, project_id: str) -> Optional[str]:
        """Delegate a task to an agent and track the mapping."""
        logger.info(f"Delegating to {assignee_id}")
        result = await self.delegation_adapter.delegate_task(
            assignee_id=assignee_id,
            description=description,
            payload={"project_id": project_id}
        )

        if result and result.get("success") and "task_id" in result.get("data", {}):
            task_id = result["data"]["task_id"]
            self.project_states[task_id] = project_id
            logger.info(f"Task {task_id} delegated to {assignee_id}")
            return task_id

        logger.error(f"Failed to delegate task: {result}")
        return None

    async def _send_project_message(self, project_id: str, text: str):
        """Send a message to a project."""
        try:
            # content must be a dict with 'text' key
            await self.project_adapter.send_project_message(
                project_id=project_id,
                content={"text": text}
            )
            logger.info(f"Sent message to project {project_id}")
        except Exception as e:
            logger.error(f"Failed to send project message: {e}")

    async def _complete_project(self, project_id: str, summary: str):
        """Complete a project with a summary."""
        try:
            await self.project_adapter.complete_project(project_id=project_id, summary=summary)
            logger.info(f"Project {project_id} completed!")
        except Exception as e:
            logger.error(f"Failed to complete project: {e}")

    async def _wait_for_task_completion(self, task_id: str, timeout: float = 60.0) -> Optional[Any]:
        """Wait for a task to complete and return the result."""
        event = await self.client.wait_event(
            condition=lambda e: (
                e.event_name == "task.notification.completed" and
                e.payload.get("task_id") == task_id
            ),
            timeout=timeout
        )
        if event:
            return event.payload.get("result")
        return None

    @on_event("project.notification.started")
    async def handle_project_start(self, context: EventContext):
        """Handle new project - delegate to searcher."""
        logger.info("=== RECEIVED PROJECT NOTIFICATION ===")
        data = context.incoming_event.payload
        logger.info(f"Payload: {data}")
        project_id = data.get("project_id")
        goal = data.get("goal", "")

        if not project_id or not goal:
            logger.warning(f"Missing project_id or goal: project_id={project_id}, goal={goal}")
            return

        logger.info(f"Project {project_id} started: {goal}")

        # Send confirmation message to project channel
        await self._send_project_message(
            project_id,
            f"Coordinator received project request: '{goal}'\nDelegating search task to searcher agent..."
        )

        # Delegate search task to searcher agent
        search_task_id = await self._delegate_task("searcher", f"Find alternatives to: {goal}", project_id)

        if not search_task_id:
            logger.error("Failed to delegate task to searcher")
            await self._send_project_message(project_id, "Error: Failed to delegate task to searcher agent.")
            await self._complete_project(project_id, "Project failed: Could not delegate to searcher agent.")
            return

        logger.info(f"Task {search_task_id} delegated to searcher. Waiting for completion (timeout: 60s)...")

        # Wait for the searcher to complete the task
        search_result = await self._wait_for_task_completion(search_task_id, timeout=180.0)

        if not search_result:
            logger.error("Searcher task timed out or failed")
            await self._send_project_message(project_id, "Error: Searcher task timed out.")
            await self._complete_project(project_id, "Project failed: Searcher task timed out.")
            return

        # Extract search result text
        if isinstance(search_result, dict):
            search_result_text = search_result.get("value", search_result.get("text", str(search_result)))
        else:
            search_result_text = str(search_result)

        logger.info(f"Searcher completed task with result: {search_result_text}")
        await self._send_project_message(project_id, f"Search results:\n{search_result_text}")

        # Delegate comparison task to comparer agent
        await self._send_project_message(project_id, "Delegating comparison task to comparer agent...")
        compare_task_id = await self._delegate_task(
            "comparer",
            f"Compare these alternatives for {goal}:\n{search_result_text}",
            project_id
        )

        if not compare_task_id:
            logger.error("Failed to delegate task to comparer")
            await self._send_project_message(project_id, "Error: Failed to delegate task to comparer agent.")
            await self._complete_project(project_id, f"Partial completion - Search results: {search_result_text}")
            return

        logger.info(f"Task {compare_task_id} delegated to comparer. Waiting for completion (timeout: 60s)...")

        # Wait for the comparer to complete the task
        compare_result = await self._wait_for_task_completion(compare_task_id, timeout=180.0)

        if not compare_result:
            logger.error("Comparer task timed out or failed")
            await self._send_project_message(project_id, "Error: Comparer task timed out.")
            await self._complete_project(project_id, f"Partial completion - Search results: {search_result_text}")
            return

        # Extract comparison result text
        if isinstance(compare_result, dict):
            compare_result_text = compare_result.get("value", compare_result.get("text", str(compare_result)))
        else:
            compare_result_text = str(compare_result)

        logger.info(f"Comparer completed task with result: {compare_result_text}")
        await self._send_project_message(project_id, f"Comparison results:\n{compare_result_text}")

        # Complete the project with full results
        await self._complete_project(
            project_id,
            f"Service alternatives analysis complete.\n\nSearch Results:\n{search_result_text}\n\nComparison:\n{compare_result_text}"
        )

async def main():
    """Run the coordinator agent."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    )

    import uuid
    agent_id = f"py-coord-{uuid.uuid4().hex[:6]}"
    coordinator = CoordinatorAgent(agent_id=agent_id)

    try:
        # Connection params are passed to start(), not __init__()
        # Use password_hash to authenticate as coordinators group
        await coordinator.async_start(
            network_host="localhost",
            network_port=8700,
            password_hash="bf24385098410391a81d92b2de72d3a2946d24f42ee387e51004a868281a2408",  # coordinators group
        )
        print("Python Coordinator running (no LLM)")
        print("Workflow: searcher → comparer → complete")

        while True:
            await asyncio.sleep(1)
    except KeyboardInterrupt:
        print("\nShutting down...")
    finally:
        await coordinator.async_stop()


if __name__ == "__main__":
    asyncio.run(main())
