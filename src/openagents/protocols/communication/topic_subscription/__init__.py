"""
Topic subscription protocol for OpenAgents.

This protocol enables topic-based publish-subscribe messaging between agents.
"""

from .agent_protocol import TopicSubscriptionAgentProtocol
from .network_protocol import TopicSubscriptionNetworkProtocol

__all__ = ["TopicSubscriptionAgentProtocol", "TopicSubscriptionNetworkProtocol"] 