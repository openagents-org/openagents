"""
Simple Messaging Protocol for OpenAgents.

This protocol enables direct and broadcast messaging between agents with support for text and file attachments.
Key features:
- Direct messaging between agents
- Broadcast messaging to all agents
- File transfer capabilities
- Support for text and binary file attachments
"""

from openagents.protocols.communication.simple_messaging.adapter import SimpleMessagingAgentClient
from openagents.protocols.communication.simple_messaging.protocol import SimpleMessagingNetworkProtocol

__all__ = ["SimpleMessagingAgentClient", "SimpleMessagingNetworkProtocol"] 