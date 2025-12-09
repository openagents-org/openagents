"""
Interactive Playground mod for OpenAgents.

This mod provides a unified workspace combining:
- Real-time chat (via messaging mod)
- Kanban board (via kanban mod)
- Shared artifacts (via project artifacts)

Perfect for research sessions, collaborative work, and interactive demos.
"""

from openagents.mods.workspace.playground.mod import PlaygroundMod
from openagents.mods.workspace.playground.adapter import PlaygroundAdapter

__all__ = ["PlaygroundMod", "PlaygroundAdapter"]
