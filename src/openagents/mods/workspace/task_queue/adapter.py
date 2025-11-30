"""
Agent-side adapter for Task Queue mod.

Provides convenient methods for agents to interact with the task queue:
- Creating and scheduling tasks
- Claiming and executing tasks as workers
- Monitoring task status
"""

import logging
from typing import Dict, Any, List, Optional

logger = logging.getLogger(__name__)


class TaskQueueAdapter:
    """Agent-side adapter for task queue operations.

    This adapter provides convenient methods for agents to:
    - Create and schedule tasks
    - Register as workers and claim tasks
    - Monitor task status and queue statistics
    """

    def __init__(self, agent_client):
        """Initialize the adapter.

        Args:
            agent_client: AgentClient instance
        """
        self.agent_client = agent_client
        self.mod_name = "task_queue"

    # ===== Task Creation Methods =====

    async def create_task(
        self,
        name: str,
        payload: Dict[str, Any],
        priority: str = "normal",
        timeout_seconds: Optional[int] = None,
        tags: Optional[List[str]] = None,
        depends_on: Optional[List[str]] = None,
        allowed_workers: Optional[List[str]] = None,
        allowed_groups: Optional[List[str]] = None,
        retry_policy: Optional[Dict[str, Any]] = None
    ) -> Optional[str]:
        """Create a new task.

        Args:
            name: Human-readable task name
            payload: Task data/parameters
            priority: Priority level (low, normal, high, urgent)
            timeout_seconds: Task timeout in seconds
            tags: Task tags for categorization
            depends_on: List of task IDs this task depends on
            allowed_workers: List of worker IDs that can execute this task
            allowed_groups: List of agent groups that can execute this task
            retry_policy: Retry configuration dict

        Returns:
            Task ID if successful, None otherwise
        """
        event_payload = {
            "name": name,
            "payload": payload,
            "priority": priority
        }

        if timeout_seconds is not None:
            event_payload["timeout_seconds"] = timeout_seconds
        if tags:
            event_payload["tags"] = tags
        if depends_on:
            event_payload["depends_on"] = depends_on
        if allowed_workers:
            event_payload["allowed_workers"] = allowed_workers
        if allowed_groups:
            event_payload["allowed_groups"] = allowed_groups
        if retry_policy:
            event_payload["retry_policy"] = retry_policy

        response = await self.agent_client.send_mod_event(
            mod_name=self.mod_name,
            event_name="task.create",
            payload=event_payload
        )

        if response and response.get("success"):
            return response.get("data", {}).get("task_id")
        else:
            logger.error(f"Failed to create task: {response.get('message') if response else 'No response'}")
            return None

    async def schedule_task(
        self,
        name: str,
        payload: Dict[str, Any],
        cron_expression: Optional[str] = None,
        interval_seconds: Optional[int] = None,
        start_time: Optional[float] = None,
        end_time: Optional[float] = None,
        priority: str = "normal",
        **kwargs
    ) -> Optional[str]:
        """Create a scheduled or recurring task.

        Args:
            name: Human-readable task name
            payload: Task data/parameters
            cron_expression: Cron expression (e.g., "0 */2 * * *")
            interval_seconds: Interval in seconds for recurring tasks
            start_time: Unix timestamp to start (optional)
            end_time: Unix timestamp to end (optional)
            priority: Priority level
            **kwargs: Additional task parameters (tags, retry_policy, etc.)

        Returns:
            Task ID if successful, None otherwise
        """
        # Build schedule config
        schedule = {}

        if cron_expression:
            schedule["schedule_type"] = "cron"
            schedule["cron_expression"] = cron_expression
        elif interval_seconds:
            schedule["schedule_type"] = "interval"
            schedule["interval_seconds"] = interval_seconds
        else:
            schedule["schedule_type"] = "one_time"

        if start_time:
            schedule["start_time"] = start_time
        if end_time:
            schedule["end_time"] = end_time

        event_payload = {
            "name": name,
            "payload": payload,
            "priority": priority,
            "schedule": schedule,
            **kwargs
        }

        response = await self.agent_client.send_mod_event(
            mod_name=self.mod_name,
            event_name="task.create",
            payload=event_payload
        )

        if response and response.get("success"):
            return response.get("data", {}).get("task_id")
        else:
            logger.error(f"Failed to schedule task: {response.get('message') if response else 'No response'}")
            return None

    # ===== Worker Methods =====

    async def register_as_worker(
        self,
        capabilities: Optional[List[str]] = None,
        max_concurrent: int = 1
    ) -> bool:
        """Register current agent as a task worker.

        Args:
            capabilities: List of capabilities (task tags worker can handle)
            max_concurrent: Maximum concurrent tasks this worker can handle

        Returns:
            True if registration successful
        """
        response = await self.agent_client.send_mod_event(
            mod_name=self.mod_name,
            event_name="worker.register",
            payload={
                "capabilities": capabilities or [],
                "max_concurrent": max_concurrent
            }
        )

        if response and response.get("success"):
            logger.info(f"Registered as worker with capabilities: {capabilities}")
            return True
        else:
            logger.error(f"Failed to register as worker: {response.get('message') if response else 'No response'}")
            return False

    async def unregister_as_worker(self) -> bool:
        """Unregister current agent as a worker.

        Returns:
            True if unregistration successful
        """
        response = await self.agent_client.send_mod_event(
            mod_name=self.mod_name,
            event_name="worker.unregister",
            payload={}
        )

        return response and response.get("success", False)

    async def send_heartbeat(self) -> bool:
        """Send worker heartbeat to indicate this worker is still alive.

        Returns:
            True if heartbeat was recorded
        """
        response = await self.agent_client.send_mod_event(
            mod_name=self.mod_name,
            event_name="worker.heartbeat",
            payload={}
        )

        return response and response.get("success", False)

    async def claim_next_task(
        self,
        capabilities: Optional[List[str]] = None
    ) -> Optional[Dict[str, Any]]:
        """Claim the next available task for this worker.

        Args:
            capabilities: Worker capabilities (optional, overrides registration)

        Returns:
            Task dict if a task was claimed, None if no tasks available
        """
        payload = {}
        if capabilities:
            payload["capabilities"] = capabilities

        response = await self.agent_client.send_mod_event(
            mod_name=self.mod_name,
            event_name="worker.claim_next",
            payload=payload
        )

        if response and response.get("success"):
            return response.get("data", {}).get("task")
        else:
            return None

    # ===== Task Execution Methods =====

    async def claim_task(self, task_id: str) -> bool:
        """Claim a specific task.

        Args:
            task_id: Task ID to claim

        Returns:
            True if task was claimed
        """
        response = await self.agent_client.send_mod_event(
            mod_name=self.mod_name,
            event_name="task.claim",
            payload={"task_id": task_id}
        )

        return response and response.get("success", False)

    async def start_task(self, task_id: str) -> Optional[str]:
        """Mark task as started.

        Args:
            task_id: Task ID to start

        Returns:
            Execution ID if successful
        """
        response = await self.agent_client.send_mod_event(
            mod_name=self.mod_name,
            event_name="task.start",
            payload={"task_id": task_id}
        )

        if response and response.get("success"):
            return response.get("data", {}).get("execution_id")
        else:
            return None

    async def complete_task(
        self,
        task_id: str,
        result: Optional[Any] = None
    ) -> bool:
        """Mark task as successfully completed.

        Args:
            task_id: Task ID to complete
            result: Task execution result (optional)

        Returns:
            True if task was marked as completed
        """
        response = await self.agent_client.send_mod_event(
            mod_name=self.mod_name,
            event_name="task.complete",
            payload={
                "task_id": task_id,
                "result": result
            }
        )

        return response and response.get("success", False)

    async def fail_task(
        self,
        task_id: str,
        error: str,
        error_details: Optional[Dict[str, Any]] = None
    ) -> Optional[Dict[str, Any]]:
        """Mark task as failed.

        Args:
            task_id: Task ID to fail
            error: Error message
            error_details: Additional error details (optional)

        Returns:
            Dict with failure info (will_retry, next_retry_at, etc.) if successful
        """
        response = await self.agent_client.send_mod_event(
            mod_name=self.mod_name,
            event_name="task.fail",
            payload={
                "task_id": task_id,
                "error": error,
                "error_details": error_details
            }
        )

        if response and response.get("success"):
            return response.get("data")
        else:
            return None

    async def cancel_task(self, task_id: str) -> bool:
        """Cancel a pending task.

        Args:
            task_id: Task ID to cancel

        Returns:
            True if task was cancelled
        """
        response = await self.agent_client.send_mod_event(
            mod_name=self.mod_name,
            event_name="task.cancel",
            payload={"task_id": task_id}
        )

        return response and response.get("success", False)

    # ===== Query Methods =====

    async def get_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        """Get task details.

        Args:
            task_id: Task ID

        Returns:
            Task dict if found, None otherwise
        """
        response = await self.agent_client.send_mod_event(
            mod_name=self.mod_name,
            event_name="task.get",
            payload={"task_id": task_id}
        )

        if response and response.get("success"):
            return response.get("data", {}).get("task")
        else:
            return None

    async def list_tasks(
        self,
        status: Optional[str] = None,
        creator_id: Optional[str] = None,
        tags: Optional[List[str]] = None,
        limit: int = 50,
        offset: int = 0
    ) -> List[Dict[str, Any]]:
        """List tasks with filters.

        Args:
            status: Filter by status (pending, running, completed, etc.)
            creator_id: Filter by creator agent ID
            tags: Filter by tags (any match)
            limit: Maximum number of tasks to return
            offset: Offset for pagination

        Returns:
            List of task dicts
        """
        payload = {
            "limit": limit,
            "offset": offset
        }

        if status:
            payload["status"] = status
        if creator_id:
            payload["creator_id"] = creator_id
        if tags:
            payload["tags"] = tags

        response = await self.agent_client.send_mod_event(
            mod_name=self.mod_name,
            event_name="task.list",
            payload=payload
        )

        if response and response.get("success"):
            return response.get("data", {}).get("tasks", [])
        else:
            return []

    async def list_my_tasks(
        self,
        status: Optional[str] = None,
        tags: Optional[List[str]] = None,
        limit: int = 50,
        offset: int = 0
    ) -> List[Dict[str, Any]]:
        """List tasks created by current agent.

        Args:
            status: Filter by status
            tags: Filter by tags
            limit: Maximum number of tasks
            offset: Offset for pagination

        Returns:
            List of task dicts
        """
        return await self.list_tasks(
            status=status,
            creator_id=self.agent_client.agent_id,
            tags=tags,
            limit=limit,
            offset=offset
        )

    async def get_task_executions(self, task_id: str) -> List[Dict[str, Any]]:
        """Get execution history for a task.

        Args:
            task_id: Task ID

        Returns:
            List of execution dicts
        """
        response = await self.agent_client.send_mod_event(
            mod_name=self.mod_name,
            event_name="task.executions.list",
            payload={"task_id": task_id}
        )

        if response and response.get("success"):
            return response.get("data", {}).get("executions", [])
        else:
            return []

    async def list_workers(self) -> List[Dict[str, Any]]:
        """List all registered workers.

        Returns:
            List of worker dicts
        """
        response = await self.agent_client.send_mod_event(
            mod_name=self.mod_name,
            event_name="worker.list",
            payload={}
        )

        if response and response.get("success"):
            return response.get("data", {}).get("workers", [])
        else:
            return []

    async def get_queue_stats(self) -> Optional[Dict[str, Any]]:
        """Get queue statistics.

        Returns:
            Dict with queue stats (pending, running, completed, etc.)
        """
        response = await self.agent_client.send_mod_event(
            mod_name=self.mod_name,
            event_name="queue.stats",
            payload={}
        )

        if response and response.get("success"):
            return response.get("data", {}).get("stats")
        else:
            return None

    async def list_dead_letter(
        self,
        limit: int = 50,
        offset: int = 0
    ) -> List[Dict[str, Any]]:
        """List tasks in dead letter queue.

        Args:
            limit: Maximum number of tasks
            offset: Offset for pagination

        Returns:
            List of dead letter task dicts
        """
        response = await self.agent_client.send_mod_event(
            mod_name=self.mod_name,
            event_name="queue.dead_letter.list",
            payload={
                "limit": limit,
                "offset": offset
            }
        )

        if response and response.get("success"):
            return response.get("data", {}).get("tasks", [])
        else:
            return []

    # ===== Convenience Methods =====

    async def execute_task(
        self,
        task: Dict[str, Any],
        executor_func
    ) -> bool:
        """Execute a task with automatic status management.

        This is a convenience method that handles the full task execution lifecycle:
        1. Mark task as started
        2. Execute the provided function
        3. Mark task as completed or failed

        Args:
            task: Task dict (from claim_next_task)
            executor_func: Async function that takes task payload and returns result

        Returns:
            True if task executed successfully

        Example:
            async def process_data(payload):
                # Your task logic here
                return {"processed": True}

            task = await adapter.claim_next_task()
            if task:
                await adapter.execute_task(task, process_data)
        """
        task_id = task["task_id"]

        try:
            # Start task
            execution_id = await self.start_task(task_id)
            if not execution_id:
                logger.error(f"Failed to start task {task_id}")
                return False

            # Execute task
            result = await executor_func(task["payload"])

            # Complete task
            success = await self.complete_task(task_id, result)
            if success:
                logger.info(f"Task {task_id} completed successfully")
            return success

        except Exception as e:
            # Fail task
            logger.error(f"Task {task_id} execution failed: {e}")
            await self.fail_task(
                task_id,
                error=str(e),
                error_details={"exception_type": type(e).__name__}
            )
            return False
