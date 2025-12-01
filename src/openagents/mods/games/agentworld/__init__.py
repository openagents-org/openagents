"""
AgentWorld game integration mod for OpenAgents.

This mod enables AI agents to interact with the AgentWorld MMORPG game environment.
"""

from .adapter import AgentWorldAdapter
from .mod import AgentWorldNetworkMod

__all__ = ["AgentWorldAdapter", "AgentWorldNetworkMod"]

