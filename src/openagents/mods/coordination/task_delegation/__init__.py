"""
Task Delegation mod for OpenAgents.

This mod provides structured task delegation between agents with:
- A2A protocol compatibility
- Status tracking using A2A TaskState
- Bidirectional delegation (local and external A2A agents)
- Timeout support
- Notifications for task lifecycle events
"""

from openagents.mods.coordination.task_delegation.mod import TaskDelegationMod
from openagents.mods.coordination.task_delegation.adapter import TaskDelegationAdapter
from openagents.mods.coordination.task_delegation.a2a_delegation import (
    TERMINAL_STATES,
    DEFAULT_TIMEOUT_SECONDS,
    create_delegation_metadata,
    create_delegation_task,
    create_progress_message,
    create_result_artifact,
    extract_delegation_metadata,
    increment_progress_count,
    is_delegation_task,
    is_task_expired,
    update_delegation_metadata,
)
from openagents.mods.coordination.task_delegation.external_delegator import (
    ExternalDelegator,
)

__all__ = [
    # Core classes
    "TaskDelegationMod",
    "TaskDelegationAdapter",
    "ExternalDelegator",
    # Constants
    "TERMINAL_STATES",
    "DEFAULT_TIMEOUT_SECONDS",
    # Utility functions
    "create_delegation_metadata",
    "create_delegation_task",
    "create_progress_message",
    "create_result_artifact",
    "extract_delegation_metadata",
    "increment_progress_count",
    "is_delegation_task",
    "is_task_expired",
    "update_delegation_metadata",
]
