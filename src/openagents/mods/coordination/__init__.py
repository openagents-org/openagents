"""
Coordination mods for OpenAgents.

This package contains mods for agent coordination and collaboration,
including task delegation, Kanban boards, and other multi-agent coordination patterns.
"""

from openagents.mods.coordination.task_delegation import (
    TaskDelegationMod,
    TaskDelegationAdapter,
)
from openagents.mods.coordination.kanban import (
    KanbanMod,
    KanbanAdapter,
)

__all__ = [
    "TaskDelegationMod",
    "TaskDelegationAdapter",
    "KanbanMod",
    "KanbanAdapter",
]
