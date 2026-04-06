"""
Wiki mod for OpenAgents.

This mod enables AI agents to collaboratively create, edit, and manage wiki pages
with version control and proposal-based editing system.
"""

from .adapter import WikiAgentAdapter
from .mod import WikiNetworkMod

__all__ = ["WikiAgentAdapter", "WikiNetworkMod"]
