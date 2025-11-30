"""
Task Queue and Job Scheduler mod for OpenAgents.

This mod provides distributed task execution with:
- Priority-based task queues
- Cron and interval-based scheduling
- Worker pool management
- Retry logic with exponential backoff
- Task dependencies (DAG support)
- Dead letter queue
"""

from .mod import TaskQueueNetworkMod
from .adapter import TaskQueueAdapter
from .models import (
    Task,
    Worker,
    TaskExecution,
    TaskStatus,
    TaskPriority,
    ScheduleType,
    RetryPolicy,
    Schedule
)

__all__ = [
    "TaskQueueNetworkMod",
    "TaskQueueAdapter",
    "Task",
    "Worker",
    "TaskExecution",
    "TaskStatus",
    "TaskPriority",
    "ScheduleType",
    "RetryPolicy",
    "Schedule"
]
