"""
A2A Task Store for OpenAgents.

This module provides abstract and concrete implementations for storing
and managing A2A tasks.

The TaskStore interface allows for pluggable storage backends:
- InMemoryTaskStore: Default in-memory implementation
- Future: PostgreSQL, Redis, SQLite, etc.
"""

from abc import ABC, abstractmethod
from typing import Dict, List, Optional, Callable, Awaitable
import asyncio
import logging
import time

from openagents.models.a2a import (
    Task,
    TaskState,
    TaskStatus,
    Artifact,
    A2AMessage,
)

logger = logging.getLogger(__name__)


# Type alias for task update callbacks
TaskUpdateCallback = Callable[[Task, str], Awaitable[None]]


class TaskStore(ABC):
    """Abstract base class for A2A task storage.

    Implementations must provide thread-safe storage and retrieval
    of A2A tasks and their associated data.
    """

    @abstractmethod
    async def create_task(self, task: Task) -> Task:
        """Create a new task in the store.

        Args:
            task: The task to create

        Returns:
            The created task (may have updated fields)
        """
        pass

    @abstractmethod
    async def get_task(self, task_id: str) -> Optional[Task]:
        """Get a task by ID.

        Args:
            task_id: The task ID to look up

        Returns:
            The task if found, None otherwise
        """
        pass

    @abstractmethod
    async def update_status(
        self,
        task_id: str,
        status: TaskStatus,
    ) -> Optional[Task]:
        """Update the status of a task.

        Args:
            task_id: The task ID to update
            status: The new status

        Returns:
            The updated task if found, None otherwise
        """
        pass

    @abstractmethod
    async def add_artifact(
        self,
        task_id: str,
        artifact: Artifact,
    ) -> Optional[Task]:
        """Add an artifact to a task.

        Args:
            task_id: The task ID to update
            artifact: The artifact to add

        Returns:
            The updated task if found, None otherwise
        """
        pass

    @abstractmethod
    async def add_message(
        self,
        task_id: str,
        message: A2AMessage,
    ) -> Optional[Task]:
        """Add a message to a task's history.

        Args:
            task_id: The task ID to update
            message: The message to add

        Returns:
            The updated task if found, None otherwise
        """
        pass

    @abstractmethod
    async def list_tasks(
        self,
        context_id: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[Task]:
        """List tasks with optional filtering.

        Args:
            context_id: Optional context ID to filter by
            limit: Maximum number of tasks to return
            offset: Number of tasks to skip

        Returns:
            List of matching tasks
        """
        pass

    @abstractmethod
    async def delete_task(self, task_id: str) -> bool:
        """Delete a task from the store.

        Args:
            task_id: The task ID to delete

        Returns:
            True if deleted, False if not found
        """
        pass

    async def update_task_state(
        self,
        task_id: str,
        state: TaskState,
        message: Optional[A2AMessage] = None,
    ) -> Optional[Task]:
        """Convenience method to update task state.

        Args:
            task_id: The task ID to update
            state: The new state
            message: Optional status message

        Returns:
            The updated task if found, None otherwise
        """
        status = TaskStatus(
            state=state,
            message=message,
            timestamp=int(time.time()),
        )
        return await self.update_status(task_id, status)


class InMemoryTaskStore(TaskStore):
    """In-memory implementation of TaskStore.

    Suitable for development and single-instance deployments.
    Tasks are lost on restart.
    """

    def __init__(self, max_tasks: int = 10000):
        """Initialize the in-memory task store.

        Args:
            max_tasks: Maximum number of tasks to store (LRU eviction)
        """
        self._tasks: Dict[str, Task] = {}
        self._context_index: Dict[str, List[str]] = {}  # context_id → task_ids
        self._task_order: List[str] = []  # For LRU eviction
        self._max_tasks = max_tasks
        self._lock = asyncio.Lock()
        self._callbacks: List[TaskUpdateCallback] = []

    def register_callback(self, callback: TaskUpdateCallback) -> None:
        """Register a callback for task updates.

        Args:
            callback: Async function called with (task, update_type)
        """
        self._callbacks.append(callback)

    def unregister_callback(self, callback: TaskUpdateCallback) -> None:
        """Unregister a task update callback.

        Args:
            callback: The callback to remove
        """
        if callback in self._callbacks:
            self._callbacks.remove(callback)

    async def _notify_callbacks(self, task: Task, update_type: str) -> None:
        """Notify all registered callbacks of a task update.

        Args:
            task: The updated task
            update_type: Type of update (created, status, artifact, message)
        """
        for callback in self._callbacks:
            try:
                await callback(task, update_type)
            except Exception as e:
                logger.warning(f"Task callback error: {e}")

    async def _evict_if_needed(self) -> None:
        """Evict oldest tasks if over capacity."""
        while len(self._tasks) >= self._max_tasks and self._task_order:
            oldest_id = self._task_order.pop(0)
            if oldest_id in self._tasks:
                task = self._tasks.pop(oldest_id)
                # Remove from context index
                if task.context_id and task.context_id in self._context_index:
                    if oldest_id in self._context_index[task.context_id]:
                        self._context_index[task.context_id].remove(oldest_id)
                logger.debug(f"Evicted task {oldest_id} due to capacity")

    async def create_task(self, task: Task) -> Task:
        """Create a new task in the store."""
        async with self._lock:
            await self._evict_if_needed()

            self._tasks[task.id] = task
            self._task_order.append(task.id)

            # Update context index
            if task.context_id:
                if task.context_id not in self._context_index:
                    self._context_index[task.context_id] = []
                self._context_index[task.context_id].append(task.id)

            logger.debug(f"Created task {task.id} in context {task.context_id}")

        await self._notify_callbacks(task, "created")
        return task

    async def get_task(self, task_id: str) -> Optional[Task]:
        """Get a task by ID."""
        task = self._tasks.get(task_id)
        if task:
            # Update LRU order
            async with self._lock:
                if task_id in self._task_order:
                    self._task_order.remove(task_id)
                    self._task_order.append(task_id)
        return task

    async def update_status(
        self,
        task_id: str,
        status: TaskStatus,
    ) -> Optional[Task]:
        """Update the status of a task."""
        async with self._lock:
            task = self._tasks.get(task_id)
            if not task:
                return None

            task.status = status
            logger.debug(f"Updated task {task_id} status to {status.state}")

        await self._notify_callbacks(task, "status")
        return task

    async def add_artifact(
        self,
        task_id: str,
        artifact: Artifact,
    ) -> Optional[Task]:
        """Add an artifact to a task."""
        async with self._lock:
            task = self._tasks.get(task_id)
            if not task:
                return None

            task.artifacts.append(artifact)
            logger.debug(f"Added artifact to task {task_id}")

        await self._notify_callbacks(task, "artifact")
        return task

    async def add_message(
        self,
        task_id: str,
        message: A2AMessage,
    ) -> Optional[Task]:
        """Add a message to a task's history."""
        async with self._lock:
            task = self._tasks.get(task_id)
            if not task:
                return None

            task.history.append(message)
            logger.debug(f"Added message to task {task_id} history")

        await self._notify_callbacks(task, "message")
        return task

    async def list_tasks(
        self,
        context_id: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[Task]:
        """List tasks with optional filtering."""
        if context_id:
            task_ids = self._context_index.get(context_id, [])
            tasks = [
                self._tasks[tid]
                for tid in task_ids
                if tid in self._tasks
            ]
        else:
            tasks = list(self._tasks.values())

        # Sort by creation time (newest first based on task order)
        # Apply offset and limit
        return tasks[offset : offset + limit]

    async def delete_task(self, task_id: str) -> bool:
        """Delete a task from the store."""
        async with self._lock:
            if task_id not in self._tasks:
                return False

            task = self._tasks.pop(task_id)

            # Remove from order list
            if task_id in self._task_order:
                self._task_order.remove(task_id)

            # Remove from context index
            if task.context_id and task.context_id in self._context_index:
                if task_id in self._context_index[task.context_id]:
                    self._context_index[task.context_id].remove(task_id)

            logger.debug(f"Deleted task {task_id}")
            return True

    async def get_tasks_by_state(self, state: TaskState) -> List[Task]:
        """Get all tasks in a specific state.

        Args:
            state: The state to filter by

        Returns:
            List of tasks in the specified state
        """
        return [
            task for task in self._tasks.values()
            if task.status.state == state
        ]

    async def get_context_tasks(self, context_id: str) -> List[Task]:
        """Get all tasks in a context.

        Args:
            context_id: The context ID to look up

        Returns:
            List of tasks in the context
        """
        task_ids = self._context_index.get(context_id, [])
        return [
            self._tasks[tid]
            for tid in task_ids
            if tid in self._tasks
        ]

    def task_count(self) -> int:
        """Get the current number of tasks in the store."""
        return len(self._tasks)

    def context_count(self) -> int:
        """Get the number of active contexts."""
        return len(self._context_index)

    async def clear(self) -> None:
        """Clear all tasks from the store."""
        async with self._lock:
            self._tasks.clear()
            self._context_index.clear()
            self._task_order.clear()
            logger.info("Cleared all tasks from store")
