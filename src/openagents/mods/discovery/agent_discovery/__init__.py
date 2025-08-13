"""
Agent Discovery Mod for OpenAgents.

This mod allows agents to announce their capabilities to the network
and for other agents to discover agents with specific capabilities.
Key features:
- Capability announcement
- Capability discovery
- Capability matching
"""

from src.openagents.mods.discovery.agent_discovery.adapter import AgentDiscoveryAdapter
from src.openagents.mods.discovery.agent_discovery.mod import AgentDiscoveryMod

__all__ = ["AgentDiscoveryAdapter", "AgentDiscoveryMod"]
