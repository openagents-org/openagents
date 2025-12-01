"""
Network-level task delegation mod for OpenAgents.

This mod provides structured task delegation between agents with:
- Task delegation with assignee, description, and payload
- Status tracking (in_progress, completed, failed, timed_out)
- Progress reporting
- Automatic timeout handling
- Notifications for task lifecycle events
"""

import asyncio
import json
import logging
import time
import uuid
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Dict, List, Optional

from openagents.core.base_mod import BaseMod, mod_event_handler
from openagents.models.event import Event
from openagents.models.event_response import EventResponse

logger = logging.getLogger(__name__)

# Task status constants
STATUS_IN_PROGRESS = "in_progress"
STATUS_COMPLETED = "completed"
STATUS_FAILED = "failed"
STATUS_TIMED_OUT = "timed_out"

# Default timeout in seconds
DEFAULT_TIMEOUT_SECONDS = 300


@dataclass
class ProgressReport:
    """Represents a progress update for a task."""

    timestamp: float
    message: str
    data: Optional[Dict[str, Any]] = None


@dataclass
class Task:
    """Represents a delegated task."""

    task_id: str
    delegator_id: str
    assignee_id: str
    description: str
    payload: Dict[str, Any]
    status: str
    timeout_seconds: int
    created_at: float
    completed_at: Optional[float] = None
    progress_reports: List[Dict[str, Any]] = field(default_factory=list)
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert task to dictionary for JSON serialization."""
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Task":
        """Create a Task from a dictionary."""
        return cls(
            task_id=data["task_id"],
            delegator_id=data["delegator_id"],
            assignee_id=data["assignee_id"],
            description=data["description"],
            payload=data.get("payload", {}),
            status=data["status"],
            timeout_seconds=data.get("timeout_seconds", DEFAULT_TIMEOUT_SECONDS),
            created_at=data["created_at"],
            completed_at=data.get("completed_at"),
            progress_reports=data.get("progress_reports", []),
            result=data.get("result"),
            error=data.get("error"),
        )


class TaskDelegationMod(BaseMod):
    """
    Network-level mod for task delegation functionality.

    This mod manages task delegation state at the network level, including:
    - Task creation and assignment
    - Status tracking and updates
    - Progress reporting
    - Automatic timeout handling
    - Notifications for task lifecycle events
    """

    # Default interval for checking task timeouts (in seconds)
    DEFAULT_TIMEOUT_CHECK_INTERVAL = 10

    def __init__(self, mod_name: str = "openagents.mods.coordination.task_delegation"):
        """Initialize the task delegation mod."""
        super().__init__(mod_name)
        self.tasks: Dict[str, Task] = {}
        self._timeout_task: Optional[asyncio.Task] = None
        self._shutdown_event: asyncio.Event = asyncio.Event()
        # Timeout check interval can be configured via config
        self._timeout_check_interval = self.config.get(
            "timeout_check_interval", self.DEFAULT_TIMEOUT_CHECK_INTERVAL
        )
        logger.info("Initializing Task Delegation network mod")

    def bind_network(self, network) -> bool:
        """Bind the mod to a network and start background tasks."""
        result = super().bind_network(network)

        # Load persisted tasks
        self._load_tasks()

        # Start the timeout checker background task
        self._start_timeout_checker()

        return result

    def _start_timeout_checker(self):
        """Start the background task that checks for timed-out tasks.
        
        The task will only start if there is a running event loop.
        If no loop is available, logging will indicate this.
        """

        async def timeout_checker():
            """Background task to check for timed-out tasks."""
            logger.info("Task delegation timeout checker started")
            while not self._shutdown_event.is_set():
                try:
                    await asyncio.sleep(self._timeout_check_interval)
                    await self._check_timeouts()
                except asyncio.CancelledError:
                    logger.info("Timeout checker task cancelled")
                    break
                except Exception as e:
                    logger.error(f"Error in timeout checker: {e}")

        # Get or create an event loop and schedule the timeout checker
        try:
            loop = asyncio.get_running_loop()
            self._timeout_task = loop.create_task(timeout_checker())
            logger.debug("Timeout checker task created successfully")
        except RuntimeError:
            # No running event loop, will be started when network runs
            logger.debug("No running event loop, timeout checker will be started later")

    async def _check_timeouts(self):
        """Check for tasks that have exceeded their timeout duration."""
        current_time = time.time()
        timed_out_tasks = []

        for task_id, task in self.tasks.items():
            if task.status == STATUS_IN_PROGRESS:
                elapsed = current_time - task.created_at
                if elapsed > task.timeout_seconds:
                    timed_out_tasks.append(task)

        for task in timed_out_tasks:
            await self._timeout_task_handler(task)

    async def _timeout_task_handler(self, task: Task):
        """Mark a task as timed out and send notifications."""
        logger.info(f"Task {task.task_id} has timed out")

        task.status = STATUS_TIMED_OUT
        task.completed_at = time.time()
        self._save_task(task)

        # Notify delegator
        await self._send_notification(
            "task.notification.timeout",
            task.delegator_id,
            {
                "task_id": task.task_id,
                "delegator_id": task.delegator_id,
                "assignee_id": task.assignee_id,
                "description": task.description,
            },
        )

        # Notify assignee
        await self._send_notification(
            "task.notification.timeout",
            task.assignee_id,
            {
                "task_id": task.task_id,
                "delegator_id": task.delegator_id,
                "assignee_id": task.assignee_id,
                "description": task.description,
            },
        )

    async def _send_notification(
        self, event_name: str, destination_id: str, payload: Dict[str, Any]
    ):
        """Send a notification event to an agent."""
        if not self.network:
            logger.warning("Cannot send notification: network not bound")
            return

        notification = Event(
            event_name=event_name,
            source_id=self.network.network_id,
            destination_id=destination_id,
            payload=payload,
        )

        try:
            await self.network.process_event(notification)
            logger.debug(f"Sent {event_name} notification to {destination_id}")
        except Exception as e:
            logger.error(f"Failed to send {event_name} notification: {e}")

    def _get_storage_path(self) -> Path:
        """Get the storage path for tasks.
        
        This method creates the tasks directory if it doesn't exist.
        
        Returns:
            Path: The path to the tasks storage directory.
        """
        storage_path = self.get_storage_path() / "tasks"
        storage_path.mkdir(parents=True, exist_ok=True)
        return storage_path

    def _load_tasks(self):
        """Load tasks from persistent storage."""
        storage_path = self._get_storage_path()

        try:
            for task_file in storage_path.glob("*.json"):
                try:
                    with open(task_file, "r") as f:
                        task_data = json.load(f)
                        task = Task.from_dict(task_data)
                        self.tasks[task.task_id] = task
                except Exception as e:
                    logger.error(f"Failed to load task from {task_file}: {e}")

            logger.info(f"Loaded {len(self.tasks)} tasks from storage")
        except Exception as e:
            logger.error(f"Failed to load tasks: {e}")

    def _save_task(self, task: Task):
        """Save a task to persistent storage."""
        storage_path = self._get_storage_path()
        task_file = storage_path / f"{task.task_id}.json"

        try:
            with open(task_file, "w") as f:
                json.dump(task.to_dict(), f, indent=2)
            logger.debug(f"Saved task {task.task_id} to storage")
        except Exception as e:
            logger.error(f"Failed to save task {task.task_id}: {e}")

    def _create_response(
        self, success: bool, message: str, data: Optional[Dict[str, Any]] = None
    ) -> EventResponse:
        """Create a standardized event response."""
        return EventResponse(success=success, message=message, data=data or {})

    @mod_event_handler("task.delegate")
    async def _handle_task_delegate(self, event: Event) -> Optional[EventResponse]:
        """Handle task delegation requests."""
        payload = event.payload or {}
        delegator_id = event.source_id

        # Validate required fields
        assignee_id = payload.get("assignee_id")
        description = payload.get("description")

        if not assignee_id:
            return self._create_response(
                success=False,
                message="assignee_id is required",
                data={"error": "assignee_id is required"},
            )

        if not description:
            return self._create_response(
                success=False,
                message="description is required",
                data={"error": "description is required"},
            )

        # Get and validate timeout_seconds
        timeout_seconds = payload.get("timeout_seconds", DEFAULT_TIMEOUT_SECONDS)
        if not isinstance(timeout_seconds, (int, float)) or timeout_seconds <= 0:
            return self._create_response(
                success=False,
                message="timeout_seconds must be a positive number",
                data={"error": "timeout_seconds must be a positive number"},
            )

        # Create the task
        task_id = str(uuid.uuid4())
        current_time = time.time()

        task = Task(
            task_id=task_id,
            delegator_id=delegator_id,
            assignee_id=assignee_id,
            description=description,
            payload=payload.get("payload", {}),
            status=STATUS_IN_PROGRESS,
            timeout_seconds=timeout_seconds,
            created_at=current_time,
        )

        self.tasks[task_id] = task
        self._save_task(task)

        logger.info(
            f"Task {task_id} delegated from {delegator_id} to {assignee_id}: {description}"
        )

        # Notify assignee
        await self._send_notification(
            "task.notification.assigned",
            assignee_id,
            {
                "task_id": task_id,
                "delegator_id": delegator_id,
                "description": description,
                "payload": payload.get("payload", {}),
                "timeout_seconds": timeout_seconds,
            },
        )

        return self._create_response(
            success=True,
            message="Task delegated successfully",
            data={
                "task_id": task_id,
                "status": STATUS_IN_PROGRESS,
                "created_at": current_time,
            },
        )

    @mod_event_handler("task.report")
    async def _handle_task_report(self, event: Event) -> Optional[EventResponse]:
        """Handle progress report requests from assignees."""
        payload = event.payload or {}
        reporter_id = event.source_id

        task_id = payload.get("task_id")
        if not task_id:
            return self._create_response(
                success=False,
                message="task_id is required",
                data={"error": "task_id is required"},
            )

        task = self.tasks.get(task_id)
        if not task:
            return self._create_response(
                success=False,
                message="Task not found",
                data={"error": f"Task {task_id} not found"},
            )

        # Access control: only assignee can report progress
        if task.assignee_id != reporter_id:
            return self._create_response(
                success=False,
                message="Only the assignee can report progress",
                data={"error": "Unauthorized: only assignee can report progress"},
            )

        # Check task is still in progress
        if task.status != STATUS_IN_PROGRESS:
            return self._create_response(
                success=False,
                message=f"Cannot report progress: task status is {task.status}",
                data={"error": f"Task is not in progress (status: {task.status})"},
            )

        # Add progress report
        progress_data = payload.get("progress", {})
        progress_report = {
            "timestamp": time.time(),
            "message": progress_data.get("message", ""),
            "data": progress_data.get("data"),
        }
        task.progress_reports.append(progress_report)
        self._save_task(task)

        logger.info(f"Progress reported for task {task_id}: {progress_data.get('message', '')}")

        # Notify delegator
        await self._send_notification(
            "task.notification.progress",
            task.delegator_id,
            {
                "task_id": task_id,
                "assignee_id": task.assignee_id,
                "progress": progress_data,
            },
        )

        return self._create_response(
            success=True,
            message="Progress reported",
            data={
                "task_id": task_id,
                "progress_count": len(task.progress_reports),
            },
        )

    @mod_event_handler("task.complete")
    async def _handle_task_complete(self, event: Event) -> Optional[EventResponse]:
        """Handle task completion requests from assignees."""
        payload = event.payload or {}
        completer_id = event.source_id

        task_id = payload.get("task_id")
        if not task_id:
            return self._create_response(
                success=False,
                message="task_id is required",
                data={"error": "task_id is required"},
            )

        task = self.tasks.get(task_id)
        if not task:
            return self._create_response(
                success=False,
                message="Task not found",
                data={"error": f"Task {task_id} not found"},
            )

        # Access control: only assignee can complete
        if task.assignee_id != completer_id:
            return self._create_response(
                success=False,
                message="Only the assignee can complete the task",
                data={"error": "Unauthorized: only assignee can complete task"},
            )

        # Check task is still in progress
        if task.status != STATUS_IN_PROGRESS:
            return self._create_response(
                success=False,
                message=f"Cannot complete: task status is {task.status}",
                data={"error": f"Task is not in progress (status: {task.status})"},
            )

        # Update task status
        task.status = STATUS_COMPLETED
        task.completed_at = time.time()
        task.result = payload.get("result", {})
        self._save_task(task)

        logger.info(f"Task {task_id} completed by {completer_id}")

        # Notify delegator
        await self._send_notification(
            "task.notification.completed",
            task.delegator_id,
            {
                "task_id": task_id,
                "assignee_id": task.assignee_id,
                "result": task.result,
            },
        )

        return self._create_response(
            success=True,
            message="Task completed successfully",
            data={
                "task_id": task_id,
                "status": STATUS_COMPLETED,
                "completed_at": task.completed_at,
            },
        )

    @mod_event_handler("task.fail")
    async def _handle_task_fail(self, event: Event) -> Optional[EventResponse]:
        """Handle task failure requests from assignees."""
        payload = event.payload or {}
        failer_id = event.source_id

        task_id = payload.get("task_id")
        if not task_id:
            return self._create_response(
                success=False,
                message="task_id is required",
                data={"error": "task_id is required"},
            )

        task = self.tasks.get(task_id)
        if not task:
            return self._create_response(
                success=False,
                message="Task not found",
                data={"error": f"Task {task_id} not found"},
            )

        # Access control: only assignee can fail
        if task.assignee_id != failer_id:
            return self._create_response(
                success=False,
                message="Only the assignee can fail the task",
                data={"error": "Unauthorized: only assignee can fail task"},
            )

        # Check task is still in progress
        if task.status != STATUS_IN_PROGRESS:
            return self._create_response(
                success=False,
                message=f"Cannot fail: task status is {task.status}",
                data={"error": f"Task is not in progress (status: {task.status})"},
            )

        # Update task status
        task.status = STATUS_FAILED
        task.completed_at = time.time()
        task.error = payload.get("error", "Unknown error")
        self._save_task(task)

        logger.info(f"Task {task_id} failed by {failer_id}: {task.error}")

        # Notify delegator
        await self._send_notification(
            "task.notification.failed",
            task.delegator_id,
            {
                "task_id": task_id,
                "assignee_id": task.assignee_id,
                "error": task.error,
            },
        )

        return self._create_response(
            success=True,
            message="Task marked as failed",
            data={
                "task_id": task_id,
                "status": STATUS_FAILED,
                "completed_at": task.completed_at,
            },
        )

    @mod_event_handler("task.list")
    async def _handle_task_list(self, event: Event) -> Optional[EventResponse]:
        """Handle task listing requests."""
        payload = event.payload or {}
        requester_id = event.source_id

        filter_config = payload.get("filter", {})
        role = filter_config.get("role", "delegated_by_me")
        status_filter = filter_config.get("status", [])
        limit = payload.get("limit", 20)
        offset = payload.get("offset", 0)

        # Filter tasks based on role
        filtered_tasks = []
        for task in self.tasks.values():
            # Filter by role
            if role == "delegated_by_me" and task.delegator_id != requester_id:
                continue
            if role == "assigned_to_me" and task.assignee_id != requester_id:
                continue

            # Filter by status if specified
            if status_filter and task.status not in status_filter:
                continue

            filtered_tasks.append(task)

        # Sort by created_at descending
        filtered_tasks.sort(key=lambda t: t.created_at, reverse=True)

        # Apply pagination
        total_count = len(filtered_tasks)
        paginated_tasks = filtered_tasks[offset : offset + limit]

        # Convert to response format
        tasks_data = []
        for task in paginated_tasks:
            tasks_data.append(
                {
                    "task_id": task.task_id,
                    "delegator_id": task.delegator_id,
                    "assignee_id": task.assignee_id,
                    "description": task.description,
                    "status": task.status,
                    "timeout_seconds": task.timeout_seconds,
                    "created_at": task.created_at,
                }
            )

        return self._create_response(
            success=True,
            message="Tasks retrieved",
            data={
                "tasks": tasks_data,
                "total_count": total_count,
                "has_more": (offset + limit) < total_count,
            },
        )

    @mod_event_handler("task.get")
    async def _handle_task_get(self, event: Event) -> Optional[EventResponse]:
        """Handle individual task retrieval requests."""
        payload = event.payload or {}
        requester_id = event.source_id

        task_id = payload.get("task_id")
        if not task_id:
            return self._create_response(
                success=False,
                message="task_id is required",
                data={"error": "task_id is required"},
            )

        task = self.tasks.get(task_id)
        if not task:
            return self._create_response(
                success=False,
                message="Task not found",
                data={"error": f"Task {task_id} not found"},
            )

        # Access control: only delegator or assignee can view
        if task.delegator_id != requester_id and task.assignee_id != requester_id:
            return self._create_response(
                success=False,
                message="Not authorized to view this task",
                data={"error": "Unauthorized: not delegator or assignee"},
            )

        return self._create_response(
            success=True,
            message="Task retrieved",
            data=task.to_dict(),
        )

    def get_state(self) -> Dict[str, Any]:
        """Get the current state of the task delegation mod."""
        active_tasks = sum(
            1 for t in self.tasks.values() if t.status == STATUS_IN_PROGRESS
        )
        completed_tasks = sum(
            1 for t in self.tasks.values() if t.status == STATUS_COMPLETED
        )
        failed_tasks = sum(
            1 for t in self.tasks.values() if t.status == STATUS_FAILED
        )
        timed_out_tasks = sum(
            1 for t in self.tasks.values() if t.status == STATUS_TIMED_OUT
        )

        return {
            "total_tasks": len(self.tasks),
            "active_tasks": active_tasks,
            "completed_tasks": completed_tasks,
            "failed_tasks": failed_tasks,
            "timed_out_tasks": timed_out_tasks,
        }

    def shutdown(self) -> bool:
        """Shutdown the mod gracefully."""
        logger.info("Shutting down Task Delegation mod")

        # Signal the timeout checker to stop
        self._shutdown_event.set()

        # Cancel the timeout checker task
        if self._timeout_task and not self._timeout_task.done():
            self._timeout_task.cancel()

        # Save all tasks before shutdown
        for task in self.tasks.values():
            self._save_task(task)

        return super().shutdown()
