"""
Agent Discovery Mod for OpenAgents.

This mod allows agents to announce their capabilities to the network
and for other agents to discover agents with specific capabilities.

Key features:
- Capability management (set/get)
- Agent search by capability filter
- Agent listing
- Connection/disconnection notifications
"""

from openagents.mods.discovery.agent_discovery.adapter import AgentDiscoveryAdapter
from openagents.mods.discovery.agent_discovery.mod import AgentDiscoveryMod

__all__ = ["AgentDiscoveryAdapter", "AgentDiscoveryMod"]

