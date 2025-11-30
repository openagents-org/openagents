"""
Coordination mods for OpenAgents.

This package contains mods for agent coordination and collaboration,
including task delegation and other multi-agent coordination patterns.
"""

from openagents.mods.coordination.task_delegation import (
    TaskDelegationMod,
    TaskDelegationAdapter,
)

__all__ = [
    "TaskDelegationMod",
    "TaskDelegationAdapter",
]
