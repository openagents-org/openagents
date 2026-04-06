"""
Default Workspace Mod for OpenAgents.

This mod provides basic workspace functionality and integrates with
thread messaging capabilities for communication within the workspace.
"""

from openagents.mods.workspace.default.adapter import DefaultWorkspaceAgentAdapter
from openagents.mods.workspace.default.mod import DefaultWorkspaceNetworkMod

__all__ = ["DefaultWorkspaceAgentAdapter", "DefaultWorkspaceNetworkMod"]
