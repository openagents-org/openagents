"""
Task queue manager with priority queues, worker pool, and retry logic.
"""

import time
import asyncio
import logging
from typing import Dict, List, Optional, Set, Tuple
from collections import defaultdict
import heapq

from .models import (
    Task, Worker, TaskExecution, TaskStatus, TaskPriority,
    Schedule, ScheduleType, RetryPolicy
)
from .scheduler import calculate_next_scheduled_time

logger = logging.getLogger(__name__)


class TaskManager:
    """Manages task queues, workers, and task execution lifecycle."""

    def __init__(self):
        """Initialize the task manager."""
        # Task storage (task_id -> Task)
        self.tasks: Dict[str, Task] = {}

        # Priority queues for pending tasks (priority, timestamp, task_id)
        # Using heap for efficient priority queue
        self.pending_queue: List[Tuple[int, float, str]] = []

        # Dead letter queue for permanently failed tasks
        self.dead_letter_queue: List[str] = []

        # Worker pool
        self.workers: Dict[str, Worker] = {}

        # Indexes for efficient lookups
        self.tasks_by_status: Dict[TaskStatus, Set[str]] = defaultdict(set)
        self.tasks_by_creator: Dict[str, Set[str]] = defaultdict(set)
        self.tasks_by_tag: Dict[str, Set[str]] = defaultdict(set)
        self.scheduled_tasks: Set[str] = set()  # Tasks with recurring schedules

        # Configuration
        self.worker_timeout: float = 300.0  # 5 minutes
        self.task_claim_timeout: float = 60.0  # 1 minute
        self.enable_dead_letter: bool = True

    def create_task(self, task: Task) -> Task:
        """Create and queue a new task.

        Args:
            task: Task to create

        Returns:
            The created task
        """
        # Store task
        self.tasks[task.task_id] = task

        # Update indexes
        self.tasks_by_status[task.status].add(task.task_id)
        self.tasks_by_creator[task.creator_id].add(task.task_id)
        for tag in task.tags:
            self.tasks_by_tag[tag].add(task.task_id)

        # If it has a recurring schedule, track it
        if task.schedule and task.schedule.schedule_type != ScheduleType.ONE_TIME:
            self.scheduled_tasks.add(task.task_id)

        # Add to pending queue if ready
        if task.status == TaskStatus.PENDING:
            self._enqueue_task(task)

        logger.info(f"Created task {task.task_id}: {task.name} (priority: {task.priority.value})")
        return task

    def _enqueue_task(self, task: Task):
        """Add task to the priority queue.

        Args:
            task: Task to enqueue
        """
        # Priority mapping (lower number = higher priority)
        priority_map = {
            TaskPriority.URGENT: 0,
            TaskPriority.HIGH: 1,
            TaskPriority.NORMAL: 2,
            TaskPriority.LOW: 3
        }

        priority = priority_map.get(task.priority, 2)
        timestamp = task.scheduled_time or task.created_at

        heapq.heappush(self.pending_queue, (priority, timestamp, task.task_id))

    def get_next_task(
        self,
        worker_id: str,
        capabilities: Optional[List[str]] = None
    ) -> Optional[Task]:
        """Get the next available task for a worker.

        Args:
            worker_id: Worker requesting a task
            capabilities: Worker capabilities (tags)

        Returns:
            Next task to execute, or None if no suitable tasks
        """
        current_time = time.time()
        checked_tasks = []

        # Look through pending queue
        while self.pending_queue:
            priority, timestamp, task_id = heapq.heappop(self.pending_queue)

            if task_id not in self.tasks:
                continue  # Task was removed

            task = self.tasks[task_id]

            # Check if task is still pending
            if task.status != TaskStatus.PENDING:
                continue

            # Check if scheduled time has arrived
            if task.scheduled_time and current_time < task.scheduled_time:
                # Not ready yet, put it back
                checked_tasks.append((priority, timestamp, task_id))
                continue

            # Check if worker is allowed
            if task.allowed_workers and worker_id not in task.allowed_workers:
                # Worker not allowed, put it back
                checked_tasks.append((priority, timestamp, task_id))
                continue

            # Check capabilities match if task has tags
            if task.tags and capabilities:
                if not any(tag in capabilities for tag in task.tags):
                    # Worker doesn't have required capabilities
                    checked_tasks.append((priority, timestamp, task_id))
                    continue

            # Check dependencies
            if not self._are_dependencies_met(task):
                # Dependencies not met, put it back
                checked_tasks.append((priority, timestamp, task_id))
                continue

            # Task is suitable! Put back checked tasks and return this one
            for checked_task in checked_tasks:
                heapq.heappush(self.pending_queue, checked_task)

            return task

        # No suitable task found, put back all checked tasks
        for checked_task in checked_tasks:
            heapq.heappush(self.pending_queue, checked_task)

        return None

    def claim_task(self, task_id: str, worker_id: str) -> bool:
        """Claim a task for execution by a worker.

        Args:
            task_id: Task to claim
            worker_id: Worker claiming the task

        Returns:
            True if successfully claimed
        """
        task = self.tasks.get(task_id)
        if not task:
            logger.warning(f"Task {task_id} not found")
            return False

        if task.status != TaskStatus.PENDING:
            logger.warning(f"Task {task_id} is not pending (status: {task.status})")
            return False

        # Update task
        task.status = TaskStatus.CLAIMED
        task.claimed_by = worker_id
        task.claimed_at = time.time()
        task.updated_at = time.time()

        # Update indexes
        self.tasks_by_status[TaskStatus.PENDING].discard(task_id)
        self.tasks_by_status[TaskStatus.CLAIMED].add(task_id)

        # Update worker
        if worker_id in self.workers:
            worker = self.workers[worker_id]
            worker.current_tasks.append(task_id)

        logger.info(f"Task {task_id} claimed by worker {worker_id}")
        return True

    def start_task(self, task_id: str, worker_id: str) -> Optional[TaskExecution]:
        """Mark task as started and create execution record.

        Args:
            task_id: Task being started
            worker_id: Worker executing the task

        Returns:
            TaskExecution record, or None if error
        """
        task = self.tasks.get(task_id)
        if not task:
            return None

        if task.status not in [TaskStatus.CLAIMED, TaskStatus.PENDING]:
            logger.warning(f"Task {task_id} is not claimable (status: {task.status})")
            return None

        # Update task status
        old_status = task.status
        task.status = TaskStatus.RUNNING
        task.started_at = time.time()
        task.claimed_by = worker_id
        task.current_attempt += 1
        task.updated_at = time.time()

        # Update indexes
        self.tasks_by_status[old_status].discard(task_id)
        self.tasks_by_status[TaskStatus.RUNNING].add(task_id)

        # Create execution record
        execution = TaskExecution(
            execution_id=f"{task_id}_exec_{task.current_attempt}",
            task_id=task_id,
            worker_id=worker_id,
            attempt_number=task.current_attempt,
            status=TaskStatus.RUNNING,
            started_at=task.started_at
        )
        task.executions.append(execution)

        logger.info(f"Task {task_id} started by worker {worker_id} (attempt {task.current_attempt})")
        return execution

    def complete_task(
        self,
        task_id: str,
        result: Optional[any] = None,
        worker_id: Optional[str] = None
    ) -> bool:
        """Mark task as successfully completed.

        Args:
            task_id: Task that completed
            result: Task execution result
            worker_id: Worker that completed the task

        Returns:
            True if successfully marked as completed
        """
        task = self.tasks.get(task_id)
        if not task:
            return False

        # Update task
        task.status = TaskStatus.COMPLETED
        task.completed_at = time.time()
        task.result = result
        task.updated_at = time.time()

        # Update execution record
        if task.executions:
            execution = task.executions[-1]
            execution.status = TaskStatus.COMPLETED
            execution.completed_at = task.completed_at
            execution.duration_seconds = task.completed_at - execution.started_at
            execution.result = result

        # Update indexes
        self.tasks_by_status[TaskStatus.RUNNING].discard(task_id)
        self.tasks_by_status[TaskStatus.COMPLETED].add(task_id)

        # Update worker stats
        if worker_id and worker_id in self.workers:
            worker = self.workers[worker_id]
            if task_id in worker.current_tasks:
                worker.current_tasks.remove(task_id)
            worker.completed_count += 1

        logger.info(f"Task {task_id} completed successfully")

        # Handle recurring tasks
        if task.schedule and task.schedule.schedule_type != ScheduleType.ONE_TIME:
            self._reschedule_recurring_task(task)

        return True

    def fail_task(
        self,
        task_id: str,
        error: str,
        error_details: Optional[Dict] = None,
        worker_id: Optional[str] = None
    ) -> bool:
        """Mark task as failed and handle retry logic.

        Args:
            task_id: Task that failed
            error: Error message
            error_details: Additional error details
            worker_id: Worker that failed the task

        Returns:
            True if task was failed (or moved to dead letter)
        """
        task = self.tasks.get(task_id)
        if not task:
            return False

        current_time = time.time()

        # Update task
        task.status = TaskStatus.FAILED
        task.error = error
        task.updated_at = current_time

        # Update execution record
        if task.executions:
            execution = task.executions[-1]
            execution.status = TaskStatus.FAILED
            execution.completed_at = current_time
            if execution.started_at:
                execution.duration_seconds = current_time - execution.started_at
            execution.error = error
            execution.error_details = error_details

        # Update indexes
        self.tasks_by_status[TaskStatus.RUNNING].discard(task_id)
        self.tasks_by_status[TaskStatus.FAILED].add(task_id)

        # Update worker stats
        if worker_id and worker_id in self.workers:
            worker = self.workers[worker_id]
            if task_id in worker.current_tasks:
                worker.current_tasks.remove(task_id)
            worker.failed_count += 1

        logger.warning(f"Task {task_id} failed: {error}")

        # Check if we can retry
        if task.can_retry():
            self._schedule_retry(task)
            return True

        # Move to dead letter queue if max retries exceeded
        if self.enable_dead_letter:
            task.status = TaskStatus.DEAD_LETTER
            self.tasks_by_status[TaskStatus.FAILED].discard(task_id)
            self.tasks_by_status[TaskStatus.DEAD_LETTER].add(task_id)
            self.dead_letter_queue.append(task_id)
            logger.error(f"Task {task_id} moved to dead letter queue after {task.current_attempt} attempts")

        return True

    def _schedule_retry(self, task: Task):
        """Schedule a task for retry with exponential backoff.

        Args:
            task: Task to retry
        """
        if not task.retry_policy:
            return

        # Calculate delay
        delay = task.retry_policy.calculate_delay(task.current_attempt)

        # Schedule retry
        task.status = TaskStatus.PENDING
        task.scheduled_time = time.time() + delay
        task.claimed_by = None
        task.claimed_at = None
        task.started_at = None
        task.error = None
        task.updated_at = time.time()

        # Update indexes
        self.tasks_by_status[TaskStatus.FAILED].discard(task.task_id)
        self.tasks_by_status[TaskStatus.PENDING].add(task.task_id)

        # Re-enqueue
        self._enqueue_task(task)

        logger.info(
            f"Task {task.task_id} scheduled for retry {task.current_attempt + 1}/"
            f"{task.retry_policy.max_retries} in {delay:.1f}s"
        )

    def _reschedule_recurring_task(self, task: Task):
        """Create a new task instance for a recurring task.

        Args:
            task: Completed recurring task
        """
        if not task.schedule:
            return

        # Calculate next scheduled time
        next_time = calculate_next_scheduled_time(
            task.schedule.to_dict(),
            task.completed_at
        )

        if not next_time:
            logger.warning(f"Could not calculate next execution for recurring task {task.task_id}")
            return

        # Check if schedule has ended
        if task.schedule.end_time and next_time > task.schedule.end_time:
            logger.info(f"Recurring task {task.task_id} schedule has ended")
            return

        # Create new task instance with same parameters
        import uuid
        new_task = Task(
            task_id=str(uuid.uuid4()),
            name=task.name,
            payload=task.payload.copy(),
            creator_id=task.creator_id,
            priority=task.priority,
            schedule=task.schedule,
            scheduled_time=next_time,
            retry_policy=task.retry_policy,
            timeout_seconds=task.timeout_seconds,
            tags=task.tags.copy(),
            metadata=task.metadata.copy(),
            depends_on=task.depends_on.copy(),
            allowed_workers=task.allowed_workers.copy(),
            allowed_groups=task.allowed_groups.copy()
        )

        self.create_task(new_task)
        logger.info(
            f"Scheduled next execution of recurring task {task.name}: "
            f"{new_task.task_id} at {time.ctime(next_time)}"
        )

    def cancel_task(self, task_id: str) -> bool:
        """Cancel a pending or claimed task.

        Args:
            task_id: Task to cancel

        Returns:
            True if successfully cancelled
        """
        task = self.tasks.get(task_id)
        if not task:
            return False

        if task.status not in [TaskStatus.PENDING, TaskStatus.CLAIMED]:
            logger.warning(f"Cannot cancel task {task_id} with status {task.status}")
            return False

        old_status = task.status
        task.status = TaskStatus.CANCELLED
        task.updated_at = time.time()

        # Update indexes
        self.tasks_by_status[old_status].discard(task_id)
        self.tasks_by_status[TaskStatus.CANCELLED].add(task_id)

        # Remove from worker if claimed
        if task.claimed_by and task.claimed_by in self.workers:
            worker = self.workers[task.claimed_by]
            if task_id in worker.current_tasks:
                worker.current_tasks.remove(task_id)

        logger.info(f"Task {task_id} cancelled")
        return True

    def _are_dependencies_met(self, task: Task) -> bool:
        """Check if all task dependencies are completed.

        Args:
            task: Task to check

        Returns:
            True if all dependencies are met
        """
        if not task.depends_on:
            return True

        for dep_task_id in task.depends_on:
            dep_task = self.tasks.get(dep_task_id)
            if not dep_task or dep_task.status != TaskStatus.COMPLETED:
                return False

        return True

    # Worker Management

    def register_worker(
        self,
        worker_id: str,
        capabilities: Optional[List[str]] = None,
        max_concurrent: int = 1
    ) -> Worker:
        """Register a new worker.

        Args:
            worker_id: Worker agent ID
            capabilities: Worker capabilities (task tags)
            max_concurrent: Maximum concurrent tasks

        Returns:
            Worker instance
        """
        worker = Worker(
            worker_id=worker_id,
            capabilities=capabilities or [],
            max_concurrent=max_concurrent
        )
        self.workers[worker_id] = worker
        logger.info(f"Registered worker {worker_id} with capabilities: {capabilities}")
        return worker

    def unregister_worker(self, worker_id: str) -> bool:
        """Unregister a worker.

        Args:
            worker_id: Worker to unregister

        Returns:
            True if worker was unregistered
        """
        if worker_id not in self.workers:
            return False

        worker = self.workers[worker_id]

        # Fail any running tasks
        for task_id in worker.current_tasks[:]:  # Copy list to avoid modification during iteration
            self.fail_task(
                task_id,
                error=f"Worker {worker_id} unregistered",
                worker_id=worker_id
            )

        del self.workers[worker_id]
        logger.info(f"Unregistered worker {worker_id}")
        return True

    def heartbeat_worker(self, worker_id: str) -> bool:
        """Update worker heartbeat.

        Args:
            worker_id: Worker sending heartbeat

        Returns:
            True if heartbeat was recorded
        """
        worker = self.workers.get(worker_id)
        if not worker:
            logger.warning(f"Heartbeat from unknown worker {worker_id}")
            return False

        worker.last_heartbeat = time.time()
        return True

    def cleanup_stale_workers(self):
        """Remove workers that haven't sent heartbeats."""
        current_time = time.time()
        stale_workers = []

        for worker_id, worker in self.workers.items():
            if not worker.is_active(self.worker_timeout):
                stale_workers.append(worker_id)

        for worker_id in stale_workers:
            logger.warning(f"Removing stale worker {worker_id}")
            self.unregister_worker(worker_id)

    def cleanup_stale_claims(self):
        """Release tasks that were claimed but never started."""
        current_time = time.time()

        for task in self.tasks.values():
            if task.status == TaskStatus.CLAIMED:
                if task.claimed_at and (current_time - task.claimed_at) > self.task_claim_timeout:
                    logger.warning(
                        f"Task {task.task_id} claimed by {task.claimed_by} but not started, "
                        f"releasing back to queue"
                    )
                    task.status = TaskStatus.PENDING
                    task.claimed_by = None
                    task.claimed_at = None
                    task.updated_at = current_time

                    # Update indexes
                    self.tasks_by_status[TaskStatus.CLAIMED].discard(task.task_id)
                    self.tasks_by_status[TaskStatus.PENDING].add(task.task_id)

                    # Re-enqueue
                    self._enqueue_task(task)

    # Query Methods

    def get_task(self, task_id: str) -> Optional[Task]:
        """Get task by ID."""
        return self.tasks.get(task_id)

    def list_tasks(
        self,
        status: Optional[TaskStatus] = None,
        creator_id: Optional[str] = None,
        tags: Optional[List[str]] = None,
        limit: int = 50,
        offset: int = 0
    ) -> List[Task]:
        """List tasks with filters.

        Args:
            status: Filter by status
            creator_id: Filter by creator
            tags: Filter by tags (any match)
            limit: Maximum number of tasks
            offset: Offset for pagination

        Returns:
            List of matching tasks
        """
        # Start with all tasks or filter by status
        if status:
            task_ids = self.tasks_by_status.get(status, set())
        else:
            task_ids = set(self.tasks.keys())

        # Filter by creator
        if creator_id:
            task_ids &= self.tasks_by_creator.get(creator_id, set())

        # Filter by tags
        if tags:
            tag_task_ids = set()
            for tag in tags:
                tag_task_ids.update(self.tasks_by_tag.get(tag, set()))
            task_ids &= tag_task_ids

        # Sort by created_at (most recent first)
        tasks = [self.tasks[tid] for tid in task_ids if tid in self.tasks]
        tasks.sort(key=lambda t: t.created_at, reverse=True)

        # Apply pagination
        return tasks[offset:offset + limit]

    def get_stats(self) -> Dict[str, any]:
        """Get task queue statistics."""
        return {
            "total_tasks": len(self.tasks),
            "pending": len(self.tasks_by_status[TaskStatus.PENDING]),
            "claimed": len(self.tasks_by_status[TaskStatus.CLAIMED]),
            "running": len(self.tasks_by_status[TaskStatus.RUNNING]),
            "completed": len(self.tasks_by_status[TaskStatus.COMPLETED]),
            "failed": len(self.tasks_by_status[TaskStatus.FAILED]),
            "cancelled": len(self.tasks_by_status[TaskStatus.CANCELLED]),
            "dead_letter": len(self.tasks_by_status[TaskStatus.DEAD_LETTER]),
            "total_workers": len(self.workers),
            "active_workers": sum(1 for w in self.workers.values() if w.is_active(self.worker_timeout)),
            "scheduled_tasks": len(self.scheduled_tasks)
        }
