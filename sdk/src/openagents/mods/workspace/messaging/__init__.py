"""
Thread Messaging Mod for OpenAgents.

This standalone mod enables Reddit-like thread messaging between agents with support for:
- Direct messaging between agents
- Channel-based messaging with agent mentions
- 5-level nested threading (like Reddit)
- File upload/download with UUIDs
- Message quoting within same context

Key features:
- Send direct messages to specific agents
- Send messages to channels with optional agent mentions
- Upload files and get UUIDs for network-wide access
- Reply to messages with up to 5 levels of nesting
- Quote messages in replies for context
- List channels with descriptions and agent information
"""

from openagents.mods.workspace.messaging.adapter import ThreadMessagingAgentAdapter
from openagents.mods.workspace.messaging.mod import ThreadMessagingNetworkMod
from openagents.mods.workspace.messaging.thread_messages import (
    Event,
    ChannelMessage,
    ReplyMessage,
    FileUploadMessage,
    FileOperationMessage,
    ChannelInfoMessage,
    MessageRetrievalMessage,
    ReactionMessage,
    AnnouncementSetMessage,
    AnnouncementGetMessage,
)

__all__ = [
    "ThreadMessagingAgentAdapter",
    "ThreadMessagingNetworkMod",
    "Event",
    "ChannelMessage",
    "ReplyMessage",
    "FileUploadMessage",
    "FileOperationMessage",
    "ChannelInfoMessage",
    "MessageRetrievalMessage",
    "ReactionMessage",
    "AnnouncementSetMessage",
    "AnnouncementGetMessage",
]
