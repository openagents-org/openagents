"""
Network-level Task Queue mod for OpenAgents.

This mod provides distributed task queue and job scheduling functionality with:
- Priority-based task execution
- Cron and interval-based scheduling
- Worker pool management
- Retry logic with exponential backoff
- Task dependencies (DAG support)
- Dead letter queue
"""

import logging
import asyncio
import time
import json
import uuid
from typing import Dict, Any, List, Optional, Set
from pathlib import Path

from openagents.config.globals import BROADCAST_AGENT_ID
from openagents.core.base_mod import BaseMod, mod_event_handler
from openagents.models.event import Event
from openagents.models.event_response import EventResponse

from .task_manager import TaskManager
from .models import (
    Task, Worker, TaskStatus, TaskPriority, RetryPolicy, Schedule, ScheduleType
)

logger = logging.getLogger(__name__)


class TaskQueueNetworkMod(BaseMod):
    """Network-level task queue mod implementation.

    Provides distributed task execution with:
    - Priority queues (4 levels)
    - Scheduled/recurring tasks (cron + interval)
    - Worker pool with capability matching
    - Automatic retries with exponential backoff
    - Task dependencies (DAG)
    - Dead letter queue for failed tasks
    """

    def __init__(self, mod_name: str = "task_queue"):
        """Initialize the task queue mod."""
        super().__init__(mod_name=mod_name)

        # Core task manager
        self.task_manager = TaskManager()

        # Active agents tracking
        self.active_agents: Set[str] = set()

        # Cleanup task
        self._cleanup_task: Optional[asyncio.Task] = None
        self._cleanup_interval: float = 300.0  # 5 minutes
        self._is_running: bool = False

        # Configuration
        self.worker_timeout: float = 300.0  # 5 minutes
        self.task_claim_timeout: float = 60.0  # 1 minute
        self.enable_dead_letter: bool = True
        self.archive_completed_after: int = 604800  # 7 days

        logger.info(f"Initialized Task Queue Network Mod: {self.mod_name}")

    def initialize(self) -> bool:
        """Initialize the mod and load persisted state.

        Returns:
            bool: True if initialization was successful
        """
        try:
            # Load configuration
            config = self.config or {}
            self.worker_timeout = config.get("worker_timeout", 300.0)
            self.task_claim_timeout = config.get("task_claim_timeout", 60.0)
            self.enable_dead_letter = config.get("enable_dead_letter", True)
            self.archive_completed_after = config.get("archive_completed_after", 604800)
            self._cleanup_interval = config.get("cleanup_interval", 300.0)

            # Apply config to task manager
            self.task_manager.worker_timeout = self.worker_timeout
            self.task_manager.task_claim_timeout = self.task_claim_timeout
            self.task_manager.enable_dead_letter = self.enable_dead_letter

            # Ensure storage directories exist
            storage_path = self.get_storage_path()
            (storage_path / "tasks").mkdir(parents=True, exist_ok=True)
            (storage_path / "workers").mkdir(parents=True, exist_ok=True)
            (storage_path / "dead_letter").mkdir(parents=True, exist_ok=True)

            # Load persisted tasks and workers
            self._load_tasks()
            self._load_workers()

            # Start cleanup background task
            self._is_running = True
            self._cleanup_task = asyncio.create_task(self._periodic_cleanup())

            logger.info(
                f"Task queue mod initialized with {len(self.task_manager.tasks)} tasks, "
                f"{len(self.task_manager.workers)} workers"
            )
            return True

        except Exception as e:
            logger.error(f"Task queue mod initialization failed: {e}")
            import traceback
            traceback.print_exc()
            return False

    def shutdown(self) -> bool:
        """Shutdown the mod gracefully.

        Returns:
            bool: True if shutdown was successful
        """
        try:
            # Stop cleanup task
            self._is_running = False
            if self._cleanup_task:
                self._cleanup_task.cancel()

            # Save all state
            self._save_all_tasks()
            self._save_all_workers()

            # Clear in-memory state
            self.active_agents.clear()

            logger.info("Task queue mod shutdown complete")
            return True

        except Exception as e:
            logger.error(f"Task queue mod shutdown failed: {e}")
            return False

    async def handle_register_agent(
        self, agent_id: str, metadata: Optional[Dict[str, Any]] = None
    ) -> Optional[EventResponse]:
        """Handle agent registration."""
        self.active_agents.add(agent_id)
        logger.info(f"Registered agent {agent_id} with task queue mod")
        return None

    async def handle_unregister_agent(self, agent_id: str) -> Optional[EventResponse]:
        """Handle agent unregistration."""
        # Unregister as worker if registered
        if agent_id in self.task_manager.workers:
            self.task_manager.unregister_worker(agent_id)
            self._delete_worker_file(agent_id)

        if agent_id in self.active_agents:
            self.active_agents.remove(agent_id)

        logger.info(f"Unregistered agent {agent_id} from task queue mod")
        return None

    # ===== Task Lifecycle Event Handlers =====

    @mod_event_handler("task.create")
    async def _handle_task_create(self, event: Event) -> Optional[EventResponse]:
        """Handle task creation."""
        try:
            payload = event.payload
            creator_id = event.source_id

            # Validate required fields
            if not payload.get("name"):
                return EventResponse(success=False, message="Task name is required")
            if not payload.get("payload"):
                return EventResponse(success=False, message="Task payload is required")

            # Parse priority
            priority_str = payload.get("priority", "normal")
            try:
                priority = TaskPriority(priority_str)
            except ValueError:
                return EventResponse(
                    success=False,
                    message=f"Invalid priority: {priority_str}. Must be: low, normal, high, urgent"
                )

            # Parse schedule if provided
            schedule = None
            if payload.get("schedule"):
                schedule_data = payload["schedule"]
                try:
                    schedule = Schedule.from_dict(schedule_data)
                except Exception as e:
                    return EventResponse(
                        success=False,
                        message=f"Invalid schedule configuration: {str(e)}"
                    )

            # Parse retry policy if provided
            retry_policy = None
            if payload.get("retry_policy"):
                retry_policy = RetryPolicy.from_dict(payload["retry_policy"])

            # Create task
            task = Task(
                task_id=str(uuid.uuid4()),
                name=payload["name"],
                payload=payload["payload"],
                creator_id=creator_id,
                priority=priority,
                schedule=schedule,
                scheduled_time=payload.get("scheduled_time"),
                retry_policy=retry_policy,
                timeout_seconds=payload.get("timeout_seconds"),
                tags=payload.get("tags", []),
                metadata=payload.get("metadata", {}),
                depends_on=payload.get("depends_on", []),
                allowed_workers=payload.get("allowed_workers", []),
                allowed_groups=payload.get("allowed_groups", [])
            )

            # Add to task manager
            self.task_manager.create_task(task)

            # Save to storage
            self._save_task(task)

            # Send notification
            await self._send_notification(
                "task.notification.created",
                {
                    "task_id": task.task_id,
                    "name": task.name,
                    "creator_id": task.creator_id,
                    "priority": task.priority.value,
                    "tags": task.tags
                }
            )

            logger.info(f"Created task {task.task_id}: {task.name}")

            return EventResponse(
                success=True,
                message="Task created successfully",
                data={
                    "task_id": task.task_id,
                    "name": task.name,
                    "priority": task.priority.value,
                    "status": task.status.value,
                    "created_at": task.created_at
                }
            )

        except Exception as e:
            logger.error(f"Error creating task: {e}")
            import traceback
            traceback.print_exc()
            return EventResponse(success=False, message=f"Error creating task: {str(e)}")

    @mod_event_handler("task.claim")
    async def _handle_task_claim(self, event: Event) -> Optional[EventResponse]:
        """Handle task claim by worker."""
        try:
            payload = event.payload
            task_id = payload.get("task_id")
            worker_id = event.source_id

            if not task_id:
                return EventResponse(success=False, message="task_id is required")

            # Claim the task
            success = self.task_manager.claim_task(task_id, worker_id)

            if not success:
                return EventResponse(
                    success=False,
                    message="Could not claim task (may already be claimed or not pending)"
                )

            # Update storage
            task = self.task_manager.get_task(task_id)
            if task:
                self._save_task(task)

            return EventResponse(
                success=True,
                message="Task claimed successfully",
                data={
                    "task_id": task_id,
                    "claimed_by": worker_id,
                    "claimed_at": task.claimed_at if task else None
                }
            )

        except Exception as e:
            logger.error(f"Error claiming task: {e}")
            return EventResponse(success=False, message=f"Error claiming task: {str(e)}")

    @mod_event_handler("task.start")
    async def _handle_task_start(self, event: Event) -> Optional[EventResponse]:
        """Handle task start."""
        try:
            payload = event.payload
            task_id = payload.get("task_id")
            worker_id = event.source_id

            if not task_id:
                return EventResponse(success=False, message="task_id is required")

            # Start the task
            execution = self.task_manager.start_task(task_id, worker_id)

            if not execution:
                return EventResponse(
                    success=False,
                    message="Could not start task (may not be claimed)"
                )

            # Update storage
            task = self.task_manager.get_task(task_id)
            if task:
                self._save_task(task)

            # Send notification
            await self._send_notification(
                "task.notification.started",
                {
                    "task_id": task_id,
                    "worker_id": worker_id,
                    "execution_id": execution.execution_id,
                    "started_at": execution.started_at
                },
                recipients=[task.creator_id] if task else []
            )

            return EventResponse(
                success=True,
                message="Task started successfully",
                data={
                    "task_id": task_id,
                    "execution_id": execution.execution_id,
                    "started_at": execution.started_at,
                    "attempt_number": execution.attempt_number
                }
            )

        except Exception as e:
            logger.error(f"Error starting task: {e}")
            return EventResponse(success=False, message=f"Error starting task: {str(e)}")

    @mod_event_handler("task.complete")
    async def _handle_task_complete(self, event: Event) -> Optional[EventResponse]:
        """Handle task completion."""
        try:
            payload = event.payload
            task_id = payload.get("task_id")
            result = payload.get("result")
            worker_id = event.source_id

            if not task_id:
                return EventResponse(success=False, message="task_id is required")

            # Get task before completing
            task = self.task_manager.get_task(task_id)
            if not task:
                return EventResponse(success=False, message="Task not found")

            # Complete the task
            success = self.task_manager.complete_task(task_id, result, worker_id)

            if not success:
                return EventResponse(
                    success=False,
                    message="Could not complete task"
                )

            # Update storage
            self._save_task(task)

            # Send notification
            await self._send_notification(
                "task.notification.completed",
                {
                    "task_id": task_id,
                    "worker_id": worker_id,
                    "result": result,
                    "completed_at": task.completed_at
                },
                recipients=[task.creator_id]
            )

            return EventResponse(
                success=True,
                message="Task completed successfully",
                data={
                    "task_id": task_id,
                    "completed_at": task.completed_at,
                    "result": result
                }
            )

        except Exception as e:
            logger.error(f"Error completing task: {e}")
            return EventResponse(success=False, message=f"Error completing task: {str(e)}")

    @mod_event_handler("task.fail")
    async def _handle_task_fail(self, event: Event) -> Optional[EventResponse]:
        """Handle task failure."""
        try:
            payload = event.payload
            task_id = payload.get("task_id")
            error = payload.get("error", "Unknown error")
            error_details = payload.get("error_details")
            worker_id = event.source_id

            if not task_id:
                return EventResponse(success=False, message="task_id is required")

            # Get task before failing
            task = self.task_manager.get_task(task_id)
            if not task:
                return EventResponse(success=False, message="Task not found")

            # Check if will retry
            will_retry = task.can_retry()

            # Fail the task
            success = self.task_manager.fail_task(task_id, error, error_details, worker_id)

            if not success:
                return EventResponse(success=False, message="Could not fail task")

            # Update storage
            self._save_task(task)
            if task.status == TaskStatus.DEAD_LETTER:
                self._move_to_dead_letter(task)

            # Send notification
            await self._send_notification(
                "task.notification.failed",
                {
                    "task_id": task_id,
                    "worker_id": worker_id,
                    "error": error,
                    "will_retry": will_retry,
                    "next_retry_at": task.scheduled_time if will_retry else None,
                    "attempt_number": task.current_attempt
                },
                recipients=[task.creator_id]
            )

            return EventResponse(
                success=True,
                message="Task failed",
                data={
                    "task_id": task_id,
                    "error": error,
                    "will_retry": will_retry,
                    "next_retry_at": task.scheduled_time if will_retry else None,
                    "attempts": task.current_attempt
                }
            )

        except Exception as e:
            logger.error(f"Error failing task: {e}")
            return EventResponse(success=False, message=f"Error failing task: {str(e)}")

    @mod_event_handler("task.cancel")
    async def _handle_task_cancel(self, event: Event) -> Optional[EventResponse]:
        """Handle task cancellation."""
        try:
            payload = event.payload
            task_id = payload.get("task_id")

            if not task_id:
                return EventResponse(success=False, message="task_id is required")

            # Cancel the task
            success = self.task_manager.cancel_task(task_id)

            if not success:
                return EventResponse(
                    success=False,
                    message="Could not cancel task (may already be running or completed)"
                )

            # Update storage
            task = self.task_manager.get_task(task_id)
            if task:
                self._save_task(task)

            return EventResponse(
                success=True,
                message="Task cancelled successfully",
                data={"task_id": task_id}
            )

        except Exception as e:
            logger.error(f"Error cancelling task: {e}")
            return EventResponse(success=False, message=f"Error cancelling task: {str(e)}")

    @mod_event_handler("task.get")
    async def _handle_task_get(self, event: Event) -> Optional[EventResponse]:
        """Handle getting task details."""
        try:
            payload = event.payload
            task_id = payload.get("task_id")

            if not task_id:
                return EventResponse(success=False, message="task_id is required")

            task = self.task_manager.get_task(task_id)
            if not task:
                return EventResponse(success=False, message="Task not found")

            return EventResponse(
                success=True,
                message="Task retrieved successfully",
                data={"task": task.to_dict()}
            )

        except Exception as e:
            logger.error(f"Error getting task: {e}")
            return EventResponse(success=False, message=f"Error getting task: {str(e)}")

    @mod_event_handler("task.list")
    async def _handle_task_list(self, event: Event) -> Optional[EventResponse]:
        """Handle listing tasks with filters."""
        try:
            payload = event.payload

            # Parse filters
            status_str = payload.get("status")
            status = TaskStatus(status_str) if status_str else None

            creator_id = payload.get("creator_id")
            tags = payload.get("tags")
            limit = int(payload.get("limit", 50))
            offset = int(payload.get("offset", 0))

            # List tasks
            tasks = self.task_manager.list_tasks(
                status=status,
                creator_id=creator_id,
                tags=tags,
                limit=limit,
                offset=offset
            )

            tasks_data = [task.to_dict() for task in tasks]

            return EventResponse(
                success=True,
                message=f"Retrieved {len(tasks_data)} tasks",
                data={
                    "tasks": tasks_data,
                    "count": len(tasks_data),
                    "limit": limit,
                    "offset": offset
                }
            )

        except Exception as e:
            logger.error(f"Error listing tasks: {e}")
            return EventResponse(success=False, message=f"Error listing tasks: {str(e)}")

    @mod_event_handler("task.executions.list")
    async def _handle_task_executions_list(self, event: Event) -> Optional[EventResponse]:
        """Handle listing task execution history."""
        try:
            payload = event.payload
            task_id = payload.get("task_id")

            if not task_id:
                return EventResponse(success=False, message="task_id is required")

            task = self.task_manager.get_task(task_id)
            if not task:
                return EventResponse(success=False, message="Task not found")

            executions_data = [ex.to_dict() for ex in task.executions]

            return EventResponse(
                success=True,
                message=f"Retrieved {len(executions_data)} executions",
                data={
                    "task_id": task_id,
                    "executions": executions_data
                }
            )

        except Exception as e:
            logger.error(f"Error listing executions: {e}")
            return EventResponse(success=False, message=f"Error listing executions: {str(e)}")

    # ===== Worker Event Handlers =====

    @mod_event_handler("worker.register")
    async def _handle_worker_register(self, event: Event) -> Optional[EventResponse]:
        """Handle worker registration."""
        try:
            payload = event.payload
            worker_id = event.source_id
            capabilities = payload.get("capabilities", [])
            max_concurrent = int(payload.get("max_concurrent", 1))

            # Register worker
            worker = self.task_manager.register_worker(
                worker_id,
                capabilities,
                max_concurrent
            )

            # Save to storage
            self._save_worker(worker)

            logger.info(f"Registered worker {worker_id} with capabilities: {capabilities}")

            return EventResponse(
                success=True,
                message="Worker registered successfully",
                data={
                    "worker_id": worker_id,
                    "capabilities": capabilities,
                    "max_concurrent": max_concurrent
                }
            )

        except Exception as e:
            logger.error(f"Error registering worker: {e}")
            return EventResponse(success=False, message=f"Error registering worker: {str(e)}")

    @mod_event_handler("worker.unregister")
    async def _handle_worker_unregister(self, event: Event) -> Optional[EventResponse]:
        """Handle worker unregistration."""
        try:
            worker_id = event.source_id

            success = self.task_manager.unregister_worker(worker_id)

            if success:
                self._delete_worker_file(worker_id)

            return EventResponse(
                success=success,
                message="Worker unregistered successfully" if success else "Worker not found"
            )

        except Exception as e:
            logger.error(f"Error unregistering worker: {e}")
            return EventResponse(success=False, message=f"Error unregistering worker: {str(e)}")

    @mod_event_handler("worker.heartbeat")
    async def _handle_worker_heartbeat(self, event: Event) -> Optional[EventResponse]:
        """Handle worker heartbeat."""
        try:
            worker_id = event.source_id

            success = self.task_manager.heartbeat_worker(worker_id)

            if success:
                # Update worker file
                worker = self.task_manager.workers.get(worker_id)
                if worker:
                    self._save_worker(worker)

            return EventResponse(
                success=success,
                message="Heartbeat recorded" if success else "Worker not registered"
            )

        except Exception as e:
            logger.error(f"Error processing heartbeat: {e}")
            return EventResponse(success=False, message=f"Error processing heartbeat: {str(e)}")

    @mod_event_handler("worker.claim_next")
    async def _handle_worker_claim_next(self, event: Event) -> Optional[EventResponse]:
        """Handle worker requesting next available task."""
        try:
            worker_id = event.source_id
            payload = event.payload
            capabilities = payload.get("capabilities")

            # Get next task
            task = self.task_manager.get_next_task(worker_id, capabilities)

            if not task:
                return EventResponse(
                    success=True,
                    message="No tasks available",
                    data={"task": None}
                )

            # Claim the task
            claimed = self.task_manager.claim_task(task.task_id, worker_id)

            if not claimed:
                return EventResponse(
                    success=False,
                    message="Could not claim task"
                )

            # Update storage
            self._save_task(task)

            return EventResponse(
                success=True,
                message="Task claimed",
                data={"task": task.to_dict()}
            )

        except Exception as e:
            logger.error(f"Error claiming next task: {e}")
            return EventResponse(success=False, message=f"Error claiming next task: {str(e)}")

    @mod_event_handler("worker.list")
    async def _handle_worker_list(self, event: Event) -> Optional[EventResponse]:
        """Handle listing workers."""
        try:
            workers_data = [worker.to_dict() for worker in self.task_manager.workers.values()]

            return EventResponse(
                success=True,
                message=f"Retrieved {len(workers_data)} workers",
                data={"workers": workers_data}
            )

        except Exception as e:
            logger.error(f"Error listing workers: {e}")
            return EventResponse(success=False, message=f"Error listing workers: {str(e)}")

    # ===== Queue Management Event Handlers =====

    @mod_event_handler("queue.stats")
    async def _handle_queue_stats(self, event: Event) -> Optional[EventResponse]:
        """Handle getting queue statistics."""
        try:
            stats = self.task_manager.get_stats()

            return EventResponse(
                success=True,
                message="Queue statistics retrieved",
                data={"stats": stats}
            )

        except Exception as e:
            logger.error(f"Error getting queue stats: {e}")
            return EventResponse(success=False, message=f"Error getting queue stats: {str(e)}")

    @mod_event_handler("queue.dead_letter.list")
    async def _handle_dead_letter_list(self, event: Event) -> Optional[EventResponse]:
        """Handle listing dead letter queue."""
        try:
            payload = event.payload
            limit = int(payload.get("limit", 50))
            offset = int(payload.get("offset", 0))

            # Get dead letter tasks
            dead_letter_ids = self.task_manager.dead_letter_queue[offset:offset + limit]
            tasks = [
                self.task_manager.get_task(tid).to_dict()
                for tid in dead_letter_ids
                if self.task_manager.get_task(tid)
            ]

            return EventResponse(
                success=True,
                message=f"Retrieved {len(tasks)} dead letter tasks",
                data={
                    "tasks": tasks,
                    "total": len(self.task_manager.dead_letter_queue)
                }
            )

        except Exception as e:
            logger.error(f"Error listing dead letter queue: {e}")
            return EventResponse(success=False, message=f"Error listing dead letter queue: {str(e)}")

    # ===== Storage Methods =====

    def _load_tasks(self):
        """Load tasks from storage."""
        try:
            storage_path = self.get_storage_path()
            tasks_dir = storage_path / "tasks"

            if not tasks_dir.exists():
                return

            for task_file in tasks_dir.glob("*.json"):
                try:
                    with open(task_file, "r") as f:
                        task_data = json.load(f)

                    task = Task.from_dict(task_data)
                    self.task_manager.create_task(task)

                except Exception as e:
                    logger.error(f"Error loading task from {task_file}: {e}")

            logger.info(f"Loaded {len(self.task_manager.tasks)} tasks from storage")

        except Exception as e:
            logger.error(f"Error loading tasks: {e}")

    def _load_workers(self):
        """Load workers from storage."""
        try:
            storage_path = self.get_storage_path()
            workers_dir = storage_path / "workers"

            if not workers_dir.exists():
                return

            for worker_file in workers_dir.glob("*.json"):
                try:
                    with open(worker_file, "r") as f:
                        worker_data = json.load(f)

                    worker = Worker.from_dict(worker_data)
                    self.task_manager.workers[worker.worker_id] = worker

                except Exception as e:
                    logger.error(f"Error loading worker from {worker_file}: {e}")

            logger.info(f"Loaded {len(self.task_manager.workers)} workers from storage")

        except Exception as e:
            logger.error(f"Error loading workers: {e}")

    def _save_task(self, task: Task):
        """Save a task to storage."""
        try:
            storage_path = self.get_storage_path()
            tasks_dir = storage_path / "tasks"
            tasks_dir.mkdir(parents=True, exist_ok=True)

            task_file = tasks_dir / f"{task.task_id}.json"

            with open(task_file, "w") as f:
                json.dump(task.to_dict(), f, indent=2, default=str)

        except Exception as e:
            logger.error(f"Error saving task {task.task_id}: {e}")

    def _save_all_tasks(self):
        """Save all tasks to storage."""
        for task in self.task_manager.tasks.values():
            self._save_task(task)

    def _save_worker(self, worker: Worker):
        """Save a worker to storage."""
        try:
            storage_path = self.get_storage_path()
            workers_dir = storage_path / "workers"
            workers_dir.mkdir(parents=True, exist_ok=True)

            worker_file = workers_dir / f"{worker.worker_id}.json"

            with open(worker_file, "w") as f:
                json.dump(worker.to_dict(), f, indent=2, default=str)

        except Exception as e:
            logger.error(f"Error saving worker {worker.worker_id}: {e}")

    def _save_all_workers(self):
        """Save all workers to storage."""
        for worker in self.task_manager.workers.values():
            self._save_worker(worker)

    def _delete_worker_file(self, worker_id: str):
        """Delete worker file from storage."""
        try:
            storage_path = self.get_storage_path()
            worker_file = storage_path / "workers" / f"{worker_id}.json"

            if worker_file.exists():
                worker_file.unlink()

        except Exception as e:
            logger.error(f"Error deleting worker file {worker_id}: {e}")

    def _move_to_dead_letter(self, task: Task):
        """Move task to dead letter storage."""
        try:
            storage_path = self.get_storage_path()
            dl_dir = storage_path / "dead_letter"
            dl_dir.mkdir(parents=True, exist_ok=True)

            dl_file = dl_dir / f"{task.task_id}.json"

            with open(dl_file, "w") as f:
                json.dump(task.to_dict(), f, indent=2, default=str)

            # Remove from regular tasks dir
            task_file = storage_path / "tasks" / f"{task.task_id}.json"
            if task_file.exists():
                task_file.unlink()

        except Exception as e:
            logger.error(f"Error moving task to dead letter: {e}")

    # ===== Notification Methods =====

    async def _send_notification(
        self,
        event_name: str,
        payload: Dict[str, Any],
        recipients: Optional[List[str]] = None
    ):
        """Send notification event.

        Args:
            event_name: Event name
            payload: Event payload
            recipients: List of agent IDs (None = broadcast)
        """
        try:
            if recipients:
                # Send to specific recipients
                for recipient in recipients:
                    notification = Event(
                        event_name=event_name,
                        source_id=f"mod:{self.mod_name}",
                        destination_id=recipient,
                        payload=payload
                    )
                    await self.send_event(notification)
            else:
                # Broadcast
                notification = Event(
                    event_name=event_name,
                    source_id=f"mod:{self.mod_name}",
                    destination_id=BROADCAST_AGENT_ID,
                    payload=payload
                )
                await self.send_event(notification)

        except Exception as e:
            logger.error(f"Error sending notification: {e}")

    # ===== Background Tasks =====

    async def _periodic_cleanup(self):
        """Periodic cleanup task for stale workers and claims."""
        logger.info("Starting periodic cleanup task")

        while self._is_running:
            try:
                await asyncio.sleep(self._cleanup_interval)

                if not self._is_running:
                    break

                logger.debug("Running periodic cleanup")

                # Cleanup stale workers
                self.task_manager.cleanup_stale_workers()

                # Cleanup stale claims
                self.task_manager.cleanup_stale_claims()

                # Save updated state
                self._save_all_tasks()
                self._save_all_workers()

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in periodic cleanup: {e}")

        logger.info("Periodic cleanup task stopped")
