"""
Simple Messaging Mod for OpenAgents.

This mod enables direct and broadcast messaging between agents with support for text and file attachments.
Key features:
- Direct messaging between agents
- Broadcast messaging to all agents
- File transfer capabilities
- Support for text and binary file attachments
"""

from openagents.mods.communication.simple_messaging.adapter import (
    SimpleMessagingAgentAdapter,
)
from openagents.mods.communication.simple_messaging.mod import SimpleMessagingNetworkMod

__all__ = ["SimpleMessagingAgentAdapter", "SimpleMessagingNetworkMod"]
