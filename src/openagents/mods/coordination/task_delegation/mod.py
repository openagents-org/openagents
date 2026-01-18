"""
Network-level task delegation mod for OpenAgents.

This mod provides structured task delegation between agents with:
- Task delegation with assignee, description, and payload
- A2A protocol compatibility (using A2A Task model)
- Status tracking using A2A TaskState
- Progress reporting via A2A message history
- Automatic timeout handling
- Bidirectional delegation (local and external A2A agents)
- Notifications for task lifecycle events
"""

import asyncio
import json
import logging
import random
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, TYPE_CHECKING

from openagents.core.base_mod import BaseMod, mod_event_handler
from openagents.core.a2a_task_store import TaskStore, InMemoryTaskStore
from openagents.models.event import Event
from openagents.models.event_response import EventResponse
from openagents.models.a2a import (
    A2AMessage,
    Artifact,
    DataPart,
    Role,
    Task,
    TaskState,
    TaskStatus,
    TextPart,
)

from .a2a_delegation import (
    DEFAULT_TIMEOUT_SECONDS,
    TERMINAL_STATES,
    create_delegation_metadata,
    create_delegation_task,
    create_progress_message,
    create_result_artifact,
    extract_delegation_metadata,
    increment_progress_count,
    is_task_expired,
    update_delegation_metadata,
)
from .capability_matcher import (
    DEFAULT_MATCHING_PROMPT,
    NormalizedCapability,
    build_llm_prompt,
    match_structured_capabilities,
    normalize_a2a_agent,
    normalize_local_agent,
    parse_llm_response,
)
from .external_delegator import ExternalDelegator

if TYPE_CHECKING:
    from openagents.core.a2a_registry import A2AAgentRegistry

logger = logging.getLogger(__name__)


class TaskDelegationMod(BaseMod):
    """
    Network-level mod for task delegation functionality.

    This mod manages task delegation state at the network level, including:
    - Task creation and assignment (using A2A Task model)
    - Status tracking using A2A TaskState
    - Progress reporting via task history
    - Automatic timeout handling
    - Bidirectional delegation (local and external A2A agents)
    - Notifications for task lifecycle events
    """

    # Default interval for checking task timeouts (in seconds)
    DEFAULT_TIMEOUT_CHECK_INTERVAL = 10

    def __init__(self, mod_name: str = "openagents.mods.coordination.task_delegation"):
        """Initialize the task delegation mod."""
        super().__init__(mod_name)

        # Task store - will be initialized on bind_network
        self.task_store: Optional[TaskStore] = None

        # External delegator for outbound A2A delegations
        self._external_delegator: Optional[ExternalDelegator] = None

        # Background task for timeout checking
        self._timeout_task: Optional[asyncio.Task] = None
        self._shutdown_event: asyncio.Event = asyncio.Event()

        # Timeout check interval can be configured via config
        self._timeout_check_interval = self.config.get(
            "timeout_check_interval", self.DEFAULT_TIMEOUT_CHECK_INTERVAL
        )

        logger.info("Initializing Task Delegation network mod (A2A-compatible)")

    def bind_network(self, network) -> bool:
        """Bind the mod to a network and start background tasks."""
        result = super().bind_network(network)

        # Initialize task store
        # Try to use network's task store if available, otherwise create one
        network_store = getattr(network, "a2a_task_store", None)
        if network_store:
            self.task_store = network_store
            logger.info("Using network's A2A task store")
        else:
            self.task_store = InMemoryTaskStore()
            logger.info("Created in-memory A2A task store")

        # Initialize external delegator
        a2a_registry = getattr(network, "a2a_registry", None)
        if not a2a_registry:
            topology = getattr(network, "topology", None)
            if topology:
                a2a_registry = getattr(topology, "a2a_registry", None)

        self._external_delegator = ExternalDelegator(a2a_registry=a2a_registry)

        # Load persisted tasks (with migration support)
        self._load_tasks()

        # Start the timeout checker background task
        self._start_timeout_checker()

        return result

    def _start_timeout_checker(self):
        """Start the background task that checks for timed-out tasks."""

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

        try:
            loop = asyncio.get_running_loop()
            self._timeout_task = loop.create_task(timeout_checker())
            logger.debug("Timeout checker task created successfully")
        except RuntimeError:
            logger.debug(
                "No running event loop, timeout checker will be started later"
            )

    async def _check_timeouts(self):
        """Check for tasks that have exceeded their timeout duration."""
        if not self.task_store:
            return

        # Get all working tasks
        working_tasks = await self.task_store.get_tasks_by_state(TaskState.WORKING)
        submitted_tasks = await self.task_store.get_tasks_by_state(TaskState.SUBMITTED)

        for task in working_tasks + submitted_tasks:
            if is_task_expired(task):
                await self._timeout_task_handler(task)

    async def _timeout_task_handler(self, task: Task):
        """Mark a task as timed out and send notifications."""
        logger.info(f"Task {task.id} has timed out")

        delegation = extract_delegation_metadata(task)

        # Update metadata with timeout info
        updated_metadata = update_delegation_metadata(
            task,
            completed_at=time.time(),
            error="Task timed out",
            is_timeout=True,
        )
        task.metadata = updated_metadata

        # Update task status to failed
        await self.task_store.update_status(
            task.id,
            TaskStatus(
                state=TaskState.FAILED,
                message=A2AMessage(
                    role=Role.AGENT,
                    parts=[TextPart(text="Task timed out")],
                ),
            ),
        )

        # Notify delegator
        await self._send_notification(
            "task.notification.timeout",
            delegation.get("delegator_id"),
            {
                "task_id": task.id,
                "delegator_id": delegation.get("delegator_id"),
                "assignee_id": delegation.get("assignee_id"),
                "description": delegation.get("description"),
            },
        )

        # Notify assignee
        await self._send_notification(
            "task.notification.timeout",
            delegation.get("assignee_id"),
            {
                "task_id": task.id,
                "delegator_id": delegation.get("delegator_id"),
                "assignee_id": delegation.get("assignee_id"),
                "description": delegation.get("description"),
            },
        )

    async def _send_notification(
        self, event_name: str, destination_id: str, payload: Dict[str, Any]
    ):
        """Send a notification event to an agent."""
        if not self.network or not destination_id:
            logger.warning("Cannot send notification: network not bound or no destination")
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
        """Get the storage path for tasks."""
        storage_path = self.get_storage_path() / "tasks"
        storage_path.mkdir(parents=True, exist_ok=True)
        return storage_path

    def _load_tasks(self):
        """Load tasks from persistent storage."""
        storage_path = self._get_storage_path()
        loaded_count = 0

        try:
            for task_file in storage_path.glob("*.json"):
                try:
                    with open(task_file, "r") as f:
                        task_data = json.load(f)

                    task = Task(**task_data)

                    # Store in TaskStore
                    asyncio.create_task(self.task_store.create_task(task))
                    loaded_count += 1

                except Exception as e:
                    logger.error(f"Failed to load task from {task_file}: {e}")

            logger.info(f"Loaded {loaded_count} tasks from storage")

        except Exception as e:
            logger.error(f"Failed to load tasks: {e}")

    async def _save_task(self, task: Task):
        """Save a task to persistent storage."""
        storage_path = self._get_storage_path()
        task_file = storage_path / f"{task.id}.json"

        try:
            task_dict = task.model_dump(by_alias=True, exclude_none=True)
            with open(task_file, "w") as f:
                json.dump(task_dict, f, indent=2)
            logger.debug(f"Saved task {task.id} to storage")
        except Exception as e:
            logger.error(f"Failed to save task {task.id}: {e}")

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

        # Check if assignee is an external A2A agent
        is_external = (
            self._external_delegator
            and self._external_delegator.is_external_assignee(assignee_id)
        )
        external_url = None
        if is_external:
            external_url = self._external_delegator.resolve_external_url(assignee_id)

        # Create the A2A task
        task = create_delegation_task(
            delegator_id=delegator_id,
            assignee_id=assignee_id,
            description=description,
            payload=payload.get("payload", {}),
            timeout_seconds=int(timeout_seconds),
            is_external_assignee=is_external,
            assignee_url=external_url,
        )

        # Store the task
        await self.task_store.create_task(task)
        await self._save_task(task)

        logger.info(
            f"Task {task.id} delegated from {delegator_id} to {assignee_id}: {description}"
        )

        # If external assignee, delegate via A2A
        if is_external and external_url and self._external_delegator:
            try:
                external_task = await self._external_delegator.delegate_to_external(
                    task=task,
                    external_url=external_url,
                )
                if external_task:
                    # Update local task to WORKING state
                    await self.task_store.update_task_state(task.id, TaskState.WORKING)
                    # Start background polling
                    await self._external_delegator.start_background_polling(
                        task.id,
                        callback=self._on_external_task_update,
                    )
                    logger.info(
                        f"Delegated task {task.id} to external agent at {external_url}"
                    )
            except Exception as e:
                logger.error(f"Failed to delegate to external agent: {e}")
                # Mark task as failed
                await self.task_store.update_status(
                    task.id,
                    TaskStatus(
                        state=TaskState.FAILED,
                        message=A2AMessage(
                            role=Role.AGENT,
                            parts=[TextPart(text=f"Failed to delegate: {e}")],
                        ),
                    ),
                )
                return self._create_response(
                    success=False,
                    message=f"Failed to delegate to external agent: {e}",
                    data={"error": str(e)},
                )
        else:
            # Local assignee - send notification
            await self._send_notification(
                "task.notification.assigned",
                assignee_id,
                {
                    "task_id": task.id,
                    "delegator_id": delegator_id,
                    "description": description,
                    "payload": payload.get("payload", {}),
                    "timeout_seconds": timeout_seconds,
                },
            )

        delegation = extract_delegation_metadata(task)
        return self._create_response(
            success=True,
            message="Task delegated successfully",
            data={
                "task_id": task.id,
                "status": task.status.state.value,
                "created_at": delegation.get("created_at"),
            },
        )

    def _on_external_task_update(self, external_task: Task, update_type: str):
        """Callback for external task updates."""
        # This is called by ExternalDelegator when external task updates
        logger.debug(
            f"External task update: {external_task.id} - {update_type} - "
            f"state={external_task.status.state.value}"
        )

    @mod_event_handler("task.accept")
    async def _handle_task_accept(self, event: Event) -> Optional[EventResponse]:
        """Handle task acceptance from assignees."""
        payload = event.payload or {}
        acceptor_id = event.source_id

        task_id = payload.get("task_id")
        if not task_id:
            return self._create_response(
                success=False,
                message="task_id is required",
                data={"error": "task_id is required"},
            )

        task = await self.task_store.get_task(task_id)
        if not task:
            return self._create_response(
                success=False,
                message="Task not found",
                data={"error": f"Task {task_id} not found"},
            )

        delegation = extract_delegation_metadata(task)

        # Access control: only assignee can accept
        if delegation.get("assignee_id") != acceptor_id:
            return self._create_response(
                success=False,
                message="Only the assignee can accept the task",
                data={"error": "Unauthorized: only assignee can accept task"},
            )

        # Check task is in submitted state
        if task.status.state != TaskState.SUBMITTED:
            return self._create_response(
                success=False,
                message=f"Cannot accept: task status is {task.status.state.value}",
                data={"error": f"Task is not in submitted state"},
            )

        # Update task status to working
        await self.task_store.update_task_state(task.id, TaskState.WORKING)
        task = await self.task_store.get_task(task_id)
        await self._save_task(task)

        logger.info(f"Task {task_id} accepted by {acceptor_id}")

        # Notify delegator
        await self._send_notification(
            "task.notification.accepted",
            delegation.get("delegator_id"),
            {
                "task_id": task_id,
                "assignee_id": delegation.get("assignee_id"),
            },
        )

        return self._create_response(
            success=True,
            message="Task accepted",
            data={
                "task_id": task_id,
                "status": TaskState.WORKING.value,
            },
        )

    @mod_event_handler("task.reject")
    async def _handle_task_reject(self, event: Event) -> Optional[EventResponse]:
        """Handle task rejection from assignees."""
        payload = event.payload or {}
        rejector_id = event.source_id

        task_id = payload.get("task_id")
        if not task_id:
            return self._create_response(
                success=False,
                message="task_id is required",
                data={"error": "task_id is required"},
            )

        task = await self.task_store.get_task(task_id)
        if not task:
            return self._create_response(
                success=False,
                message="Task not found",
                data={"error": f"Task {task_id} not found"},
            )

        delegation = extract_delegation_metadata(task)

        # Access control: only assignee can reject
        if delegation.get("assignee_id") != rejector_id:
            return self._create_response(
                success=False,
                message="Only the assignee can reject the task",
                data={"error": "Unauthorized: only assignee can reject task"},
            )

        # Check task is in submitted or working state
        if task.status.state not in [TaskState.SUBMITTED, TaskState.WORKING]:
            return self._create_response(
                success=False,
                message=f"Cannot reject: task status is {task.status.state.value}",
                data={"error": f"Task cannot be rejected in current state"},
            )

        reason = payload.get("reason", "Task rejected by assignee")

        # Update task status to rejected
        await self.task_store.update_status(
            task.id,
            TaskStatus(
                state=TaskState.REJECTED,
                message=A2AMessage(
                    role=Role.AGENT,
                    parts=[TextPart(text=reason)],
                ),
            ),
        )
        task = await self.task_store.get_task(task_id)

        # Update metadata
        task.metadata = update_delegation_metadata(
            task, completed_at=time.time(), error=reason
        )
        await self._save_task(task)

        logger.info(f"Task {task_id} rejected by {rejector_id}: {reason}")

        # Notify delegator
        await self._send_notification(
            "task.notification.rejected",
            delegation.get("delegator_id"),
            {
                "task_id": task_id,
                "assignee_id": delegation.get("assignee_id"),
                "reason": reason,
            },
        )

        return self._create_response(
            success=True,
            message="Task rejected",
            data={
                "task_id": task_id,
                "status": TaskState.REJECTED.value,
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

        task = await self.task_store.get_task(task_id)
        if not task:
            return self._create_response(
                success=False,
                message="Task not found",
                data={"error": f"Task {task_id} not found"},
            )

        delegation = extract_delegation_metadata(task)

        # Access control: only assignee can report progress
        if delegation.get("assignee_id") != reporter_id:
            return self._create_response(
                success=False,
                message="Only the assignee can report progress",
                data={"error": "Unauthorized: only assignee can report progress"},
            )

        # Check task is in working state
        if task.status.state not in [TaskState.SUBMITTED, TaskState.WORKING]:
            return self._create_response(
                success=False,
                message=f"Cannot report progress: task status is {task.status.state.value}",
                data={"error": f"Task is not in progress"},
            )

        # If task was submitted, move to working
        if task.status.state == TaskState.SUBMITTED:
            await self.task_store.update_task_state(task.id, TaskState.WORKING)

        # Add progress report as message in history
        progress_data = payload.get("progress", {})
        progress_message = create_progress_message(
            message=progress_data.get("message", ""),
            data=progress_data.get("data"),
            reporter_id=reporter_id,
        )
        await self.task_store.add_message(task_id, progress_message)

        # Update progress summary in metadata
        task = await self.task_store.get_task(task_id)
        task.metadata = increment_progress_count(task)
        await self._save_task(task)

        logger.info(
            f"Progress reported for task {task_id}: {progress_data.get('message', '')}"
        )

        # Notify delegator
        await self._send_notification(
            "task.notification.progress",
            delegation.get("delegator_id"),
            {
                "task_id": task_id,
                "assignee_id": delegation.get("assignee_id"),
                "progress": progress_data,
            },
        )

        return self._create_response(
            success=True,
            message="Progress reported",
            data={
                "task_id": task_id,
                "progress_count": task.metadata.get("progress_summary", {}).get(
                    "total_reports", 0
                ),
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

        task = await self.task_store.get_task(task_id)
        if not task:
            return self._create_response(
                success=False,
                message="Task not found",
                data={"error": f"Task {task_id} not found"},
            )

        delegation = extract_delegation_metadata(task)

        # Access control: only assignee can complete
        if delegation.get("assignee_id") != completer_id:
            return self._create_response(
                success=False,
                message="Only the assignee can complete the task",
                data={"error": "Unauthorized: only assignee can complete task"},
            )

        # Check task is in working or submitted state
        if task.status.state not in [TaskState.SUBMITTED, TaskState.WORKING]:
            return self._create_response(
                success=False,
                message=f"Cannot complete: task status is {task.status.state.value}",
                data={"error": f"Task is not in progress"},
            )

        # Create result artifact
        result = payload.get("result", {})
        artifact = create_result_artifact(result)
        await self.task_store.add_artifact(task_id, artifact)

        # Update task status to completed
        await self.task_store.update_task_state(task.id, TaskState.COMPLETED)

        # Update metadata
        task = await self.task_store.get_task(task_id)
        task.metadata = update_delegation_metadata(task, completed_at=time.time())
        await self._save_task(task)

        logger.info(f"Task {task_id} completed by {completer_id}")

        # Notify delegator
        await self._send_notification(
            "task.notification.completed",
            delegation.get("delegator_id"),
            {
                "task_id": task_id,
                "assignee_id": delegation.get("assignee_id"),
                "result": result,
            },
        )

        return self._create_response(
            success=True,
            message="Task completed successfully",
            data={
                "task_id": task_id,
                "status": TaskState.COMPLETED.value,
                "completed_at": delegation.get("completed_at"),
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

        task = await self.task_store.get_task(task_id)
        if not task:
            return self._create_response(
                success=False,
                message="Task not found",
                data={"error": f"Task {task_id} not found"},
            )

        delegation = extract_delegation_metadata(task)

        # Access control: only assignee can fail
        if delegation.get("assignee_id") != failer_id:
            return self._create_response(
                success=False,
                message="Only the assignee can fail the task",
                data={"error": "Unauthorized: only assignee can fail task"},
            )

        # Check task is in working or submitted state
        if task.status.state not in [TaskState.SUBMITTED, TaskState.WORKING]:
            return self._create_response(
                success=False,
                message=f"Cannot fail: task status is {task.status.state.value}",
                data={"error": f"Task is not in progress"},
            )

        error = payload.get("error", "Unknown error")

        # Update task status to failed
        await self.task_store.update_status(
            task.id,
            TaskStatus(
                state=TaskState.FAILED,
                message=A2AMessage(
                    role=Role.AGENT,
                    parts=[TextPart(text=error)],
                ),
            ),
        )

        # Update metadata
        task = await self.task_store.get_task(task_id)
        task.metadata = update_delegation_metadata(
            task, completed_at=time.time(), error=error
        )
        await self._save_task(task)

        logger.info(f"Task {task_id} failed by {failer_id}: {error}")

        # Notify delegator
        await self._send_notification(
            "task.notification.failed",
            delegation.get("delegator_id"),
            {
                "task_id": task_id,
                "assignee_id": delegation.get("assignee_id"),
                "error": error,
            },
        )

        return self._create_response(
            success=True,
            message="Task marked as failed",
            data={
                "task_id": task_id,
                "status": TaskState.FAILED.value,
                "completed_at": task.metadata.get("delegation", {}).get("completed_at"),
            },
        )

    @mod_event_handler("task.cancel")
    async def _handle_task_cancel(self, event: Event) -> Optional[EventResponse]:
        """Handle task cancellation requests from delegators."""
        payload = event.payload or {}
        canceler_id = event.source_id

        task_id = payload.get("task_id")
        if not task_id:
            return self._create_response(
                success=False,
                message="task_id is required",
                data={"error": "task_id is required"},
            )

        task = await self.task_store.get_task(task_id)
        if not task:
            return self._create_response(
                success=False,
                message="Task not found",
                data={"error": f"Task {task_id} not found"},
            )

        delegation = extract_delegation_metadata(task)

        # Access control: only delegator can cancel
        if delegation.get("delegator_id") != canceler_id:
            return self._create_response(
                success=False,
                message="Only the delegator can cancel the task",
                data={"error": "Unauthorized: only delegator can cancel task"},
            )

        # Check task is not in terminal state
        if task.status.state in TERMINAL_STATES:
            return self._create_response(
                success=False,
                message=f"Cannot cancel: task status is {task.status.state.value}",
                data={"error": f"Task is already in terminal state"},
            )

        # If external, cancel external task too
        if (
            delegation.get("is_external_assignee")
            and self._external_delegator
            and self._external_delegator.has_external_mapping(task_id)
        ):
            await self._external_delegator.cancel_external_task(task_id)

        # Update task status to canceled
        await self.task_store.update_task_state(task.id, TaskState.CANCELED)

        # Update metadata
        task = await self.task_store.get_task(task_id)
        task.metadata = update_delegation_metadata(
            task, completed_at=time.time(), error="Task canceled by delegator"
        )
        await self._save_task(task)

        logger.info(f"Task {task_id} canceled by {canceler_id}")

        # Notify assignee
        await self._send_notification(
            "task.notification.canceled",
            delegation.get("assignee_id"),
            {
                "task_id": task_id,
                "delegator_id": delegation.get("delegator_id"),
            },
        )

        return self._create_response(
            success=True,
            message="Task canceled",
            data={
                "task_id": task_id,
                "status": TaskState.CANCELED.value,
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

        # Get all tasks from store
        all_tasks = await self.task_store.list_tasks(limit=1000)

        # Filter tasks based on role and requester
        filtered_tasks = []
        for task in all_tasks:
            delegation = extract_delegation_metadata(task)

            # Filter by role
            if role == "delegated_by_me":
                if delegation.get("delegator_id") != requester_id:
                    continue
            elif role == "assigned_to_me":
                if delegation.get("assignee_id") != requester_id:
                    continue

            # Filter by status if specified
            if status_filter:
                if task.status.state.value not in status_filter:
                    continue

            filtered_tasks.append(task)

        # Sort by created_at descending
        filtered_tasks.sort(
            key=lambda t: extract_delegation_metadata(t).get("created_at", 0),
            reverse=True,
        )

        # Apply pagination
        total_count = len(filtered_tasks)
        paginated_tasks = filtered_tasks[offset : offset + limit]

        # Convert to response format
        tasks_data = []
        for task in paginated_tasks:
            delegation = extract_delegation_metadata(task)
            tasks_data.append(
                {
                    "task_id": task.id,
                    "delegator_id": delegation.get("delegator_id"),
                    "assignee_id": delegation.get("assignee_id"),
                    "description": delegation.get("description"),
                    "status": task.status.state.value,
                    "timeout_seconds": delegation.get("timeout_seconds"),
                    "created_at": delegation.get("created_at"),
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

        task = await self.task_store.get_task(task_id)
        if not task:
            return self._create_response(
                success=False,
                message="Task not found",
                data={"error": f"Task {task_id} not found"},
            )

        delegation = extract_delegation_metadata(task)

        # Access control: only delegator or assignee can view
        if (
            delegation.get("delegator_id") != requester_id
            and delegation.get("assignee_id") != requester_id
        ):
            return self._create_response(
                success=False,
                message="Not authorized to view this task",
                data={"error": "Unauthorized: not delegator or assignee"},
            )

        # Return A2A task data
        delegation = extract_delegation_metadata(task)
        task_data = {
            "task_id": task.id,
            "context_id": task.context_id,
            "delegator_id": delegation.get("delegator_id"),
            "assignee_id": delegation.get("assignee_id"),
            "description": delegation.get("description"),
            "payload": delegation.get("payload", {}),
            "status": task.status.state.value,
            "timeout_seconds": delegation.get("timeout_seconds"),
            "created_at": delegation.get("created_at"),
            "completed_at": delegation.get("completed_at"),
            "error": delegation.get("error"),
            "is_timeout": delegation.get("is_timeout", False),
            "history": [msg.model_dump(by_alias=True, exclude_none=True) for msg in task.history],
            "artifacts": [art.model_dump(by_alias=True, exclude_none=True) for art in task.artifacts],
        }

        return self._create_response(
            success=True,
            message="Task retrieved",
            data=task_data,
        )

    @mod_event_handler("task.route")
    async def _handle_task_route(self, event: Event) -> Optional[EventResponse]:
        """Handle capability-based task routing.

        Routes a task to an agent based on required capabilities instead of
        explicit agent ID. Supports both structured capability matching and
        natural language descriptions with LLM-based matching.
        """
        payload = event.payload or {}
        delegator_id = event.source_id

        # Validate required fields
        description = payload.get("description")
        if not description:
            return self._create_response(
                success=False,
                message="description is required",
                data={"error": "description is required"},
            )

        required_capabilities = payload.get("required_capabilities")
        capability_description = payload.get("capability_description")

        if not required_capabilities and not capability_description:
            return self._create_response(
                success=False,
                message="Either required_capabilities or capability_description is required",
                data={"error": "No capability filter provided"},
            )

        # Collect all agents with their normalized capabilities
        all_agents = await self._collect_all_agents()

        if not all_agents:
            fallback = payload.get("fallback_assignee_id")
            if fallback:
                # Use fallback directly
                return await self._delegate_routed_task(
                    delegator_id=delegator_id,
                    assignee_id=fallback,
                    description=description,
                    payload=payload,
                    matched_count=0,
                )
            return self._create_response(
                success=False,
                message="No agents available for routing",
                data={"error": "No agents found in registry"},
            )

        # Find matching agents
        if capability_description:
            # Use LLM-based matching
            llm_config = payload.get("llm_config", {})
            matching_agents = await self._match_agents_with_llm(
                capability_description=capability_description,
                agents=all_agents,
                llm_config=llm_config,
            )
        else:
            # Use structured matching
            matching_agents = self._match_agents_structured(
                required_capabilities=required_capabilities,
                agents=all_agents,
            )

        if not matching_agents:
            # Try fallback
            fallback = payload.get("fallback_assignee_id")
            if fallback:
                return await self._delegate_routed_task(
                    delegator_id=delegator_id,
                    assignee_id=fallback,
                    description=description,
                    payload=payload,
                    matched_count=0,
                )
            return self._create_response(
                success=False,
                message="No agents found matching required capabilities",
                data={
                    "required_capabilities": required_capabilities,
                    "capability_description": capability_description,
                },
            )

        # Apply selection strategy
        strategy = payload.get("selection_strategy", "first")
        selected_agent = self._select_agent(matching_agents, strategy)

        # Delegate to selected agent
        return await self._delegate_routed_task(
            delegator_id=delegator_id,
            assignee_id=selected_agent,
            description=description,
            payload=payload,
            matched_count=len(matching_agents),
        )

    async def _collect_all_agents(self) -> List[NormalizedCapability]:
        """Collect and normalize capabilities from all available agents."""
        all_agents: List[NormalizedCapability] = []

        # Get A2A agents from registry
        a2a_registry = getattr(self.network, "a2a_registry", None)
        if not a2a_registry:
            topology = getattr(self.network, "topology", None)
            if topology:
                a2a_registry = getattr(topology, "a2a_registry", None)

        if a2a_registry:
            try:
                from openagents.core.a2a_registry import RemoteAgentStatus

                for conn in a2a_registry.get_a2a_agents(status=RemoteAgentStatus.ACTIVE):
                    if conn.agent_card and conn.agent_card.skills:
                        normalized = normalize_a2a_agent(
                            agent_id=conn.agent_id,
                            skills=conn.agent_card.skills,
                            description=conn.agent_card.description,
                            agent_card_dict=conn.agent_card.model_dump(
                                by_alias=True, exclude_none=True
                            ),
                        )
                        all_agents.append(normalized)
            except Exception as e:
                logger.warning(f"Failed to collect A2A agents: {e}")

        # Get local agents from discovery mod
        try:
            discovery_event = Event(
                event_name="discovery.agents.list",
                source_id=self.network.network_id if self.network else "task_delegation",
                payload={},
            )
            response = await self.network.process_event(discovery_event)
            if response and response.success:
                for agent_info in response.data.get("agents", []):
                    agent_id = agent_info.get("agent_id")
                    capabilities = agent_info.get("capabilities", {})
                    if agent_id and capabilities:
                        normalized = normalize_local_agent(
                            agent_id=agent_id,
                            capabilities=capabilities,
                        )
                        # Avoid duplicates (prefer A2A if both exist)
                        if not any(a.agent_id == agent_id for a in all_agents):
                            all_agents.append(normalized)
        except Exception as e:
            logger.warning(f"Failed to collect local agents: {e}")

        return all_agents

    def _match_agents_structured(
        self,
        required_capabilities: Dict[str, Any],
        agents: List[NormalizedCapability],
    ) -> List[str]:
        """Match agents against structured capability requirements."""
        matching = []
        for agent in agents:
            if match_structured_capabilities(required_capabilities, agent):
                matching.append(agent.agent_id)
        return matching

    async def _match_agents_with_llm(
        self,
        capability_description: str,
        agents: List[NormalizedCapability],
        llm_config: Optional[Dict[str, Any]] = None,
    ) -> List[str]:
        """Match agents using LLM-based natural language matching."""
        results: List[Tuple[str, float]] = []

        model = llm_config.get("model") if llm_config else None
        custom_prompt = llm_config.get("prompt") if llm_config else None

        for agent in agents:
            try:
                prompt = build_llm_prompt(
                    capability_description=capability_description,
                    agent_id=agent.agent_id,
                    capabilities=agent.raw_capabilities,
                    custom_prompt=custom_prompt,
                )

                # Call LLM via network's model provider
                response = await self._call_llm(prompt, model=model)
                matches, confidence, reason = parse_llm_response(response)

                if matches:
                    results.append((agent.agent_id, confidence))
                    logger.debug(
                        f"Agent {agent.agent_id} matches with confidence {confidence}: {reason}"
                    )

            except Exception as e:
                logger.warning(f"LLM matching failed for agent {agent.agent_id}: {e}")

        # Sort by confidence descending and return agent IDs
        results.sort(key=lambda x: x[1], reverse=True)
        return [agent_id for agent_id, _ in results]

    async def _call_llm(self, prompt: str, model: Optional[str] = None) -> str:
        """Call LLM for capability matching.

        Uses the network's model provider if available.
        """
        # Try to get model provider from network
        model_provider = getattr(self.network, "model_provider", None)
        if not model_provider:
            topology = getattr(self.network, "topology", None)
            if topology:
                model_provider = getattr(topology, "model_provider", None)

        if model_provider:
            try:
                response = await model_provider.generate(
                    prompt=prompt,
                    model=model,
                    max_tokens=200,
                )
                return response.text if hasattr(response, "text") else str(response)
            except Exception as e:
                logger.error(f"Model provider call failed: {e}")
                raise

        # Fallback: try to use any available LLM integration
        raise RuntimeError(
            "No model provider available for LLM-based capability matching. "
            "Use structured matching (required_capabilities) instead."
        )

    def _select_agent(self, agents: List[str], strategy: str) -> str:
        """Select a single agent based on strategy."""
        if not agents:
            raise ValueError("No agents to select from")

        if strategy == "random":
            return random.choice(agents)
        else:  # "first" or default
            return agents[0]

    async def _delegate_routed_task(
        self,
        delegator_id: str,
        assignee_id: str,
        description: str,
        payload: Dict[str, Any],
        matched_count: int,
    ) -> EventResponse:
        """Create and delegate a task after routing."""
        timeout_seconds = payload.get("timeout_seconds", DEFAULT_TIMEOUT_SECONDS)

        # Check if assignee is external
        is_external = (
            self._external_delegator
            and self._external_delegator.is_external_assignee(assignee_id)
        )
        external_url = None
        if is_external:
            external_url = self._external_delegator.resolve_external_url(assignee_id)

        # Create the task
        task = create_delegation_task(
            delegator_id=delegator_id,
            assignee_id=assignee_id,
            description=description,
            payload=payload.get("payload", {}),
            timeout_seconds=int(timeout_seconds),
            is_external_assignee=is_external,
            assignee_url=external_url,
        )

        # Store the task
        await self.task_store.create_task(task)
        await self._save_task(task)

        logger.info(
            f"Task {task.id} routed from {delegator_id} to {assignee_id}: {description}"
        )

        # Handle external delegation
        if is_external and external_url and self._external_delegator:
            try:
                external_task = await self._external_delegator.delegate_to_external(
                    task=task,
                    external_url=external_url,
                )
                if external_task:
                    await self.task_store.update_task_state(task.id, TaskState.WORKING)
                    await self._external_delegator.start_background_polling(
                        task.id,
                        callback=self._on_external_task_update,
                    )
            except Exception as e:
                logger.error(f"Failed to delegate to external agent: {e}")
                await self.task_store.update_status(
                    task.id,
                    TaskStatus(
                        state=TaskState.FAILED,
                        message=A2AMessage(
                            role=Role.AGENT,
                            parts=[TextPart(text=f"Failed to delegate: {e}")],
                        ),
                    ),
                )
                return self._create_response(
                    success=False,
                    message=f"Failed to delegate to external agent: {e}",
                    data={"error": str(e)},
                )
        else:
            # Local assignee - send notification
            await self._send_notification(
                "task.notification.assigned",
                assignee_id,
                {
                    "task_id": task.id,
                    "delegator_id": delegator_id,
                    "description": description,
                    "payload": payload.get("payload", {}),
                    "timeout_seconds": timeout_seconds,
                    "routed_by_capability": True,
                },
            )

        delegation = extract_delegation_metadata(task)
        return self._create_response(
            success=True,
            message=f"Task routed to {assignee_id}",
            data={
                "task_id": task.id,
                "assignee_id": assignee_id,
                "status": task.status.state.value,
                "matched_count": matched_count,
                "created_at": delegation.get("created_at"),
            },
        )

    def get_state(self) -> Dict[str, Any]:
        """Get the current state of the task delegation mod."""
        if not self.task_store:
            return {"error": "Task store not initialized"}

        # This is a sync method, so we need to work with what we can access
        # For InMemoryTaskStore, we can access _tasks directly
        if isinstance(self.task_store, InMemoryTaskStore):
            tasks = list(self.task_store._tasks.values())
        else:
            # For other implementations, return basic info
            return {
                "total_tasks": getattr(self.task_store, "task_count", lambda: 0)(),
            }

        state_counts = {}
        for state in TaskState:
            state_counts[state.value] = sum(
                1 for t in tasks if t.status.state == state
            )

        return {
            "total_tasks": len(tasks),
            "by_state": state_counts,
            "active_tasks": state_counts.get(TaskState.WORKING.value, 0)
            + state_counts.get(TaskState.SUBMITTED.value, 0),
            "completed_tasks": state_counts.get(TaskState.COMPLETED.value, 0),
            "failed_tasks": state_counts.get(TaskState.FAILED.value, 0),
        }

    async def shutdown(self) -> bool:
        """Shutdown the mod gracefully."""
        logger.info("Shutting down Task Delegation mod")

        # Signal the timeout checker to stop
        self._shutdown_event.set()

        # Cancel the timeout checker task
        if self._timeout_task and not self._timeout_task.done():
            self._timeout_task.cancel()
            try:
                await self._timeout_task
            except asyncio.CancelledError:
                pass

        # Shutdown external delegator
        if self._external_delegator:
            await self._external_delegator.shutdown()

        # Save all tasks before shutdown
        if self.task_store and isinstance(self.task_store, InMemoryTaskStore):
            for task in self.task_store._tasks.values():
                await self._save_task(task)

        return super().shutdown()

    def get_tools(self) -> List[Dict[str, Any]]:
        """Get the tools provided by this mod for A2A skill exposure."""
        return [
            {
                "name": "delegate_task",
                "description": "Delegate a task to another agent",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "assignee_id": {"type": "string"},
                        "description": {"type": "string"},
                        "payload": {"type": "object"},
                        "timeout_seconds": {"type": "integer"},
                    },
                    "required": ["assignee_id", "description"],
                },
            },
            {
                "name": "complete_task",
                "description": "Mark a delegated task as completed",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "task_id": {"type": "string"},
                        "result": {"type": "object"},
                    },
                    "required": ["task_id"],
                },
            },
            {
                "name": "list_tasks",
                "description": "List delegated or assigned tasks",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "role": {"type": "string", "enum": ["delegated_by_me", "assigned_to_me"]},
                        "limit": {"type": "integer"},
                    },
                },
            },
        ]
