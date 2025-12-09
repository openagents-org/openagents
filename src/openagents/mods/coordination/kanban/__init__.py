"""
Kanban board mod for OpenAgents.

This mod provides a visual task board with customizable columns for
organizing and tracking work in the Interactive Playground.
"""

from openagents.mods.coordination.kanban.mod import KanbanMod
from openagents.mods.coordination.kanban.adapter import KanbanAdapter

__all__ = ["KanbanMod", "KanbanAdapter"]
