"""
Data models for the Task Queue mod.

This module defines the core data structures for task management including:
- Task definitions with priority and scheduling
- Execution history and retry policies
- Worker registration and assignment
"""

import time
import uuid
from dataclasses import dataclass, field, asdict
from typing import Dict, Any, List, Optional
from enum import Enum


class TaskPriority(Enum):
    """Task priority levels."""
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    URGENT = "urgent"


class TaskStatus(Enum):
    """Task execution status."""
    PENDING = "pending"  # Waiting to be picked up
    CLAIMED = "claimed"  # Claimed by a worker
    RUNNING = "running"  # Currently executing
    COMPLETED = "completed"  # Successfully completed
    FAILED = "failed"  # Failed (may retry)
    CANCELLED = "cancelled"  # Manually cancelled
    DEAD_LETTER = "dead_letter"  # Failed permanently after max retries


class ScheduleType(Enum):
    """Schedule types for tasks."""
    ONE_TIME = "one_time"  # Execute once
    CRON = "cron"  # Cron-like scheduling
    INTERVAL = "interval"  # Fixed interval (seconds)


@dataclass
class RetryPolicy:
    """Retry policy configuration for failed tasks."""

    max_retries: int = 3  # Maximum number of retry attempts
    initial_delay: float = 5.0  # Initial delay in seconds
    max_delay: float = 300.0  # Maximum delay in seconds
    backoff_multiplier: float = 2.0  # Exponential backoff multiplier
    retry_on_timeout: bool = True  # Retry on timeout errors

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "RetryPolicy":
        """Create from dictionary."""
        return cls(
            max_retries=data.get("max_retries", 3),
            initial_delay=data.get("initial_delay", 5.0),
            max_delay=data.get("max_delay", 300.0),
            backoff_multiplier=data.get("backoff_multiplier", 2.0),
            retry_on_timeout=data.get("retry_on_timeout", True)
        )

    def calculate_delay(self, attempt: int) -> float:
        """Calculate delay for a retry attempt."""
        delay = self.initial_delay * (self.backoff_multiplier ** attempt)
        return min(delay, self.max_delay)


@dataclass
class Schedule:
    """Task scheduling configuration."""

    schedule_type: ScheduleType = ScheduleType.ONE_TIME
    cron_expression: Optional[str] = None  # Cron expression (e.g., "0 */2 * * *")
    interval_seconds: Optional[int] = None  # Interval in seconds
    start_time: Optional[float] = None  # Unix timestamp to start
    end_time: Optional[float] = None  # Unix timestamp to end (None = forever)
    timezone: str = "UTC"  # Timezone for cron expressions

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "schedule_type": self.schedule_type.value,
            "cron_expression": self.cron_expression,
            "interval_seconds": self.interval_seconds,
            "start_time": self.start_time,
            "end_time": self.end_time,
            "timezone": self.timezone
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Schedule":
        """Create from dictionary."""
        return cls(
            schedule_type=ScheduleType(data.get("schedule_type", "one_time")),
            cron_expression=data.get("cron_expression"),
            interval_seconds=data.get("interval_seconds"),
            start_time=data.get("start_time"),
            end_time=data.get("end_time"),
            timezone=data.get("timezone", "UTC")
        )


@dataclass
class TaskExecution:
    """Record of a task execution attempt."""

    execution_id: str
    task_id: str
    worker_id: Optional[str]
    attempt_number: int
    status: TaskStatus
    started_at: Optional[float] = None
    completed_at: Optional[float] = None
    duration_seconds: Optional[float] = None
    result: Optional[Any] = None
    error: Optional[str] = None
    error_details: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "execution_id": self.execution_id,
            "task_id": self.task_id,
            "worker_id": self.worker_id,
            "attempt_number": self.attempt_number,
            "status": self.status.value,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "duration_seconds": self.duration_seconds,
            "result": self.result,
            "error": self.error,
            "error_details": self.error_details
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "TaskExecution":
        """Create from dictionary."""
        return cls(
            execution_id=data["execution_id"],
            task_id=data["task_id"],
            worker_id=data.get("worker_id"),
            attempt_number=data["attempt_number"],
            status=TaskStatus(data["status"]),
            started_at=data.get("started_at"),
            completed_at=data.get("completed_at"),
            duration_seconds=data.get("duration_seconds"),
            result=data.get("result"),
            error=data.get("error"),
            error_details=data.get("error_details")
        )


@dataclass
class Task:
    """Task definition with execution configuration."""

    task_id: str
    name: str  # Human-readable task name
    payload: Dict[str, Any]  # Task parameters/data
    creator_id: str  # Agent that created the task
    priority: TaskPriority = TaskPriority.NORMAL
    status: TaskStatus = TaskStatus.PENDING

    # Scheduling
    schedule: Optional[Schedule] = None
    scheduled_time: Optional[float] = None  # Unix timestamp for when to execute

    # Retry configuration
    retry_policy: Optional[RetryPolicy] = None
    current_attempt: int = 0

    # Execution
    claimed_by: Optional[str] = None  # Worker agent ID
    claimed_at: Optional[float] = None
    started_at: Optional[float] = None
    completed_at: Optional[float] = None

    # Results
    result: Optional[Any] = None
    error: Optional[str] = None

    # Metadata
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    timeout_seconds: Optional[int] = None  # Task timeout
    tags: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)

    # Dependencies (for DAG support)
    depends_on: List[str] = field(default_factory=list)  # Task IDs this task depends on

    # Access control
    allowed_workers: List[str] = field(default_factory=list)  # Empty = any worker
    allowed_groups: List[str] = field(default_factory=list)  # Empty = any group

    # Execution history
    executions: List[TaskExecution] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "task_id": self.task_id,
            "name": self.name,
            "payload": self.payload,
            "creator_id": self.creator_id,
            "priority": self.priority.value,
            "status": self.status.value,
            "schedule": self.schedule.to_dict() if self.schedule else None,
            "scheduled_time": self.scheduled_time,
            "retry_policy": self.retry_policy.to_dict() if self.retry_policy else None,
            "current_attempt": self.current_attempt,
            "claimed_by": self.claimed_by,
            "claimed_at": self.claimed_at,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "result": self.result,
            "error": self.error,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "timeout_seconds": self.timeout_seconds,
            "tags": self.tags,
            "metadata": self.metadata,
            "depends_on": self.depends_on,
            "allowed_workers": self.allowed_workers,
            "allowed_groups": self.allowed_groups,
            "executions": [ex.to_dict() for ex in self.executions]
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Task":
        """Create from dictionary."""
        # Parse schedule
        schedule = None
        if data.get("schedule"):
            schedule = Schedule.from_dict(data["schedule"])

        # Parse retry policy
        retry_policy = None
        if data.get("retry_policy"):
            retry_policy = RetryPolicy.from_dict(data["retry_policy"])

        # Parse executions
        executions = [
            TaskExecution.from_dict(ex) for ex in data.get("executions", [])
        ]

        return cls(
            task_id=data["task_id"],
            name=data["name"],
            payload=data["payload"],
            creator_id=data["creator_id"],
            priority=TaskPriority(data.get("priority", "normal")),
            status=TaskStatus(data.get("status", "pending")),
            schedule=schedule,
            scheduled_time=data.get("scheduled_time"),
            retry_policy=retry_policy,
            current_attempt=data.get("current_attempt", 0),
            claimed_by=data.get("claimed_by"),
            claimed_at=data.get("claimed_at"),
            started_at=data.get("started_at"),
            completed_at=data.get("completed_at"),
            result=data.get("result"),
            error=data.get("error"),
            created_at=data.get("created_at", time.time()),
            updated_at=data.get("updated_at", time.time()),
            timeout_seconds=data.get("timeout_seconds"),
            tags=data.get("tags", []),
            metadata=data.get("metadata", {}),
            depends_on=data.get("depends_on", []),
            allowed_workers=data.get("allowed_workers", []),
            allowed_groups=data.get("allowed_groups", []),
            executions=executions
        )

    def is_ready_to_execute(self, current_time: Optional[float] = None) -> bool:
        """Check if task is ready to be executed."""
        if current_time is None:
            current_time = time.time()

        # Must be in pending status
        if self.status != TaskStatus.PENDING:
            return False

        # Check if scheduled time has arrived
        if self.scheduled_time and current_time < self.scheduled_time:
            return False

        # Check dependencies (all must be completed)
        # Note: Dependency checking requires access to other tasks
        # This will be handled in the task manager

        return True

    def can_retry(self) -> bool:
        """Check if task can be retried."""
        if not self.retry_policy:
            return False

        if self.status != TaskStatus.FAILED:
            return False

        return self.current_attempt < self.retry_policy.max_retries


@dataclass
class Worker:
    """Worker agent registration."""

    worker_id: str  # Agent ID
    capabilities: List[str] = field(default_factory=list)  # Task types/tags
    max_concurrent: int = 1  # Max concurrent tasks
    registered_at: float = field(default_factory=time.time)
    last_heartbeat: float = field(default_factory=time.time)
    current_tasks: List[str] = field(default_factory=list)  # Currently executing task IDs
    completed_count: int = 0
    failed_count: int = 0

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "worker_id": self.worker_id,
            "capabilities": self.capabilities,
            "max_concurrent": self.max_concurrent,
            "registered_at": self.registered_at,
            "last_heartbeat": self.last_heartbeat,
            "current_tasks": self.current_tasks,
            "completed_count": self.completed_count,
            "failed_count": self.failed_count
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Worker":
        """Create from dictionary."""
        return cls(
            worker_id=data["worker_id"],
            capabilities=data.get("capabilities", []),
            max_concurrent=data.get("max_concurrent", 1),
            registered_at=data.get("registered_at", time.time()),
            last_heartbeat=data.get("last_heartbeat", time.time()),
            current_tasks=data.get("current_tasks", []),
            completed_count=data.get("completed_count", 0),
            failed_count=data.get("failed_count", 0)
        )

    def is_available(self) -> bool:
        """Check if worker can accept more tasks."""
        return len(self.current_tasks) < self.max_concurrent

    def is_active(self, timeout: float = 300.0) -> bool:
        """Check if worker is still active (based on heartbeat)."""
        return (time.time() - self.last_heartbeat) < timeout
