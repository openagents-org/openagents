"""
Task Delegation mod for OpenAgents.

This mod provides structured task delegation between agents with status tracking,
timeout support, and notifications for task lifecycle events.
"""

from openagents.mods.coordination.task_delegation.mod import TaskDelegationMod
from openagents.mods.coordination.task_delegation.adapter import TaskDelegationAdapter

__all__ = [
    "TaskDelegationMod",
    "TaskDelegationAdapter",
]
