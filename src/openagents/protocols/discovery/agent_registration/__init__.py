"""
Agent registration protocol for OpenAgents.

This protocol enables agent registration and discovery within a network.
"""

from .agent_protocol import AgentRegistrationAgentProtocol
from .network_protocol import AgentRegistrationNetworkProtocol

__all__ = ["AgentRegistrationAgentProtocol", "AgentRegistrationNetworkProtocol"] 