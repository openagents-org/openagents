"""
Messaging protocol for OpenAgents.

This protocol enables direct messaging between agents and topic-based publish-subscribe.
"""

from .agent_protocol import MessagingAgentProtocol
from .network_protocol import MessagingNetworkProtocol

__all__ = ["MessagingAgentProtocol", "MessagingNetworkProtocol"] 