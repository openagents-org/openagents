"""
Agent-level thread messaging mod for OpenAgents.

This standalone mod provides Reddit-like threading and direct messaging with:
- Direct messaging between agents
- Channel-based messaging with mentions
- 5-level nested threading
- File upload/download with UUIDs
- Message quoting
"""

import logging
import base64
import os
import uuid
import tempfile
from typing import Dict, Any, List, Optional, Callable, Union
from pathlib import Path

from openagents.core.base_mod_adapter import BaseModAdapter
from openagents.models.messages import Event
from openagents.models.event import EventVisibility, EventNames
from openagents.models.tool import AgentTool
from openagents.utils.message_util import (
    get_direct_event_thread_id,
    get_broadcast_event_thread_id,
)
from .thread_messages import (
    Event,
    ChannelMessage,
    ReplyMessage,
    FileUploadMessage,
    FileOperationMessage,
    ChannelInfoMessage,
    MessageRetrievalMessage,
    ReactionMessage,
)

logger = logging.getLogger(__name__)

# Type definitions for message handlers
MessageHandler = Callable[[Dict[str, Any], str], None]
FileHandler = Callable[[str, str, Dict[str, Any]], None]  # file_id, filename, file_info


class ThreadMessagingAgentAdapter(BaseModAdapter):
    """Agent-level thread messaging mod implementation.

    This standalone mod provides:
    - Direct messaging between agents
    - Channel-based messaging with mentions
    - 5-level nested threading (like Reddit)
    - File upload/download with UUIDs
    - Message quoting
    """

    def __init__(self):
        """Initialize the thread messaging protocol for an agent."""
        super().__init__(mod_name="messaging")

        # Initialize protocol state
        self.message_handlers: Dict[str, MessageHandler] = {}
        self.file_handlers: Dict[str, FileHandler] = {}
        self.pending_file_operations: Dict[str, Dict[str, Any]] = (
            {}
        )  # request_id -> operation metadata
        self.completed_file_operations: Dict[str, Dict[str, Any]] = (
            {}
        )  # request_id -> operation results
        self.pending_channel_requests: Dict[str, Dict[str, Any]] = (
            {}
        )  # request_id -> request metadata
        self.pending_retrieval_requests: Dict[str, Dict[str, Any]] = (
            {}
        )  # request_id -> retrieval metadata
        self.temp_dir = None
        self.file_storage_path = None
        self.available_channels: List[Dict[str, Any]] = []  # Channel list cache

    def initialize(self) -> bool:
        """Initialize the protocol.

        Returns:
            bool: True if initialization was successful, False otherwise
        """

        # Create a temporary directory for file storage
        self.temp_dir = tempfile.TemporaryDirectory(
            prefix=f"openagents_agent_{self.agent_id}_threads_"
        )
        self.file_storage_path = Path(self.temp_dir.name)

        logger.info(
            f"Initializing Thread Messaging protocol for agent {self.agent_id} with file storage at {self.file_storage_path}"
        )
        return True

    def shutdown(self) -> bool:
        """Shutdown the protocol.

        Returns:
            bool: True if shutdown was successful, False otherwise
        """
        # Clean up the temporary directory
        try:
            self.temp_dir.cleanup()
            logger.info(
                f"Cleaned up temporary file storage directory for agent {self.agent_id}"
            )
        except Exception as e:
            logger.error(
                f"Error cleaning up temporary directory for agent {self.agent_id}: {e}"
            )

        return True

    async def process_incoming_direct_message(self, message: Event) -> None:
        """Process an incoming direct message.

        Args:
            message: The direct message to process
        """
        # Only process messages targeted to this agent
        if message.destination_id != self.agent_id:
            return

        logger.debug(f"Received direct message from {message.source_id}")

        # Add message to the appropriate conversation thread
        message.thread_name = get_direct_event_thread_id(message.source_id)

        # Call registered message handlers
        for handler in self.message_handlers.values():
            try:
                handler(message.payload, message.source_id)
            except Exception as e:
                logger.error(f"Error in message handler: {e}")

    async def process_incoming_broadcast_message(self, message) -> None:
        """Process an incoming broadcast message (channel message).

        Args:
            message: The broadcast message to process
        """
        # Check if this is a channel message by examining the payload
        if (
            hasattr(message, "payload")
            and message.payload
            and "channel" in message.payload
        ):
            channel = ChannelMessage.get_channel(message)
            logger.debug(
                f"Received channel message from {message.source_id} in {channel}"
            )

            # Add message to the channel thread
            if hasattr(message, "thread_name"):
                message.thread_name = f"channel_{channel}"

            # Call registered message handlers
            for handler in self.message_handlers.values():
                try:
                    handler(message.payload, message.source_id)
                except Exception as e:
                    logger.error(f"Error in message handler: {e}")

    async def process_incoming_mod_message(self, message: Event) -> None:
        """Process an incoming mod message.

        Args:
            message: The mod message to process
        """
        logger.debug(f"Received protocol message from {message.source_id}")

        # Handle different event types based on event name
        event_name = message.event_name

        if event_name == "thread.file.upload_response":
            await self._handle_file_upload_response(message)
        elif event_name == "thread.file.download_response":
            await self._handle_file_download_response(message)
        elif event_name == "thread.channels.list_response":
            await self._handle_channels_list_response(message)
        elif event_name == "thread.channel_messages.retrieve_response":
            await self._handle_channel_messages_response(message)
        elif event_name == "thread.direct_messages.retrieve_response":
            await self._handle_direct_messages_response(message)
        elif event_name == "thread.reaction.response":
            await self._handle_reaction_response(message)
        elif event_name == "thread.reaction.notification":
            await self._handle_reaction_notification(message)
        elif event_name == "thread.channel_message.notification":
            await self._handle_channel_message_notification(message)
        elif event_name == "thread.direct_message.notification":
            await self._handle_direct_message_notification(message)
        else:
            logger.debug(f"Unhandled thread messaging event: {event_name}")

    async def send_direct_message(
        self, target_agent_id: str, text: str, quote: Optional[str] = None
    ) -> None:
        """Send a direct message to another agent.

        Args:
            target_agent_id: ID of the target agent
            text: Message text content
            quote: Optional message ID to quote
        """
        if self.connector is None:
            logger.error(
                f"Cannot send message: connector is None for agent {self.agent_id}"
            )
            return

        content = {"text": text}

        # Handle quoting if specified
        quoted_message_id = None
        quoted_text = None
        if quote:
            quoted_message_id = quote
            # Try to get quoted text from message history
            if quote in self.event_threads:
                # This is simplified - in practice you'd search through thread messages
                quoted_text = f"[Quoted message {quote}]"

        # Create payload with all direct message data
        payload = {
            "target_agent_id": target_agent_id,
            "content": content,
            "message_type": "direct_message"
        }
        if quoted_message_id:
            payload["quoted_message_id"] = quoted_message_id
        if quoted_text:
            payload["quoted_text"] = quoted_text

        # Create direct message
        direct_msg = Event(
            event_name="thread.direct_message.send",
            source_id=self.agent_id,
            destination_id=target_agent_id,
            payload=payload,
        )

        await self.agent_client.send_event(direct_msg)
        logger.debug(f"Sent direct message to {target_agent_id}")

    async def send_channel_message(
        self,
        channel: str,
        text: str,
        mentioned_agent_id: Optional[str] = None,
        quote: Optional[str] = None,
        attachment_file_id: Optional[str] = None,
        attachment_filename: Optional[str] = None,
        attachment_size: Optional[int] = None,
    ) -> bool:
        """Send a message into a channel, optionally mentioning an agent.

        Args:
            channel: Channel name
            text: Message text content
            mentioned_agent_id: Optional agent ID to mention/tag
            quote: Optional message ID to quote
            attachment_file_id: Optional file ID for attachment
            attachment_filename: Optional filename for attachment
            attachment_size: Optional file size for attachment
        """
        if self.connector is None:
            logger.error(
                f"Cannot send channel message: connector is None for agent {self.agent_id}"
            )
            return False

        # CRITICAL FIX: Normalize channel name by removing # prefix
        # This ensures messages sent to "#general" appear in "general" channel
        normalized_channel = channel.lstrip("#") if channel else channel
        logger.info(
            f"🔍 DEBUG CHANNEL: Input channel='{channel}' -> normalized='{normalized_channel}'"
        )
        if normalized_channel != channel:
            logger.info(
                f"🔧 CHANNEL FIX: Normalized channel '{channel}' -> '{normalized_channel}'"
            )

        content = {"text": text}

        # Handle quoting if specified
        quoted_message_id = None
        quoted_text = None
        if quote:
            quoted_message_id = quote
            quoted_text = f"[Quoted message {quote}]"

        # Create Event directly without using ChannelMessage
        payload = {
            "message_type": "channel_message",
            "channel": normalized_channel,
            "content": content,
            "source_id": self.agent_id,
            "relevant_agent_id": self.agent_id,
        }

        # Add optional fields if provided
        if mentioned_agent_id:
            payload["mentioned_agent_id"] = mentioned_agent_id
        if quoted_message_id:
            payload["quoted_message_id"] = quoted_message_id
        if quoted_text:
            payload["quoted_text"] = quoted_text
        if attachment_file_id:
            payload["attachment_file_id"] = attachment_file_id
        if attachment_filename:
            payload["attachment_filename"] = attachment_filename
        if attachment_size:
            payload["attachment_size"] = attachment_size

        # CRITICAL FIX: Set destination_id on Event for proper message routing
        # The network's message classification depends on this field
        message = Event(
            event_name="thread.channel_message.post",
            source_id=self.agent_id,
            destination_id=f"channel:{normalized_channel}",  # This is the key fix!
            payload=payload,
            relevant_mod="openagents.mods.workspace.messaging",
        )
        logger.info(
            f"🔧 ADAPTER: Created Event with visibility={message.visibility}, relevant_mod={message.relevant_mod}"
        )
        logger.info(f"🔧 ADAPTER: Event destination_id={message.destination_id}")

        # Use agent_client.send_event() instead of connector directly
        # This ensures the event is stored in _event_threads so agents can see their own messages
        await self.agent_client.send_event(message)
        logger.debug(f"Sent channel message to {channel}")
        return True

    async def _handle_channel_message_notification(self, message: Event) -> None:
        """Handle a channel message notification from the network.

        Args:
            message: The channel message notification
        """
        logger.info(
            f"🔧 THREAD MESSAGING ADAPTER: Received channel message notification"
        )
        logger.info(
            f"🔧 THREAD MESSAGING ADAPTER: Notification content: {message.payload}"
        )

        # Forward the notification to the agent's Event handler
        # This allows agents like ProjectEchoAgent to process channel notifications
        if (
            hasattr(self, "_agent_mod_message_handler")
            and self._agent_mod_message_handler
        ):
            try:
                await self._agent_mod_message_handler(message)
                logger.info(
                    f"🔧 THREAD MESSAGING ADAPTER: Forwarded notification to agent handler"
                )
            except Exception as e:
                logger.error(f"Error forwarding channel notification to agent: {e}")
        else:
            logger.warning(
                f"🔧 THREAD MESSAGING ADAPTER: No agent mod message handler registered"
            )

    async def _handle_direct_message_notification(self, message: Event) -> None:
        """Handle a direct message notification from the network.

        Args:
            message: The direct message notification
        """
        logger.info(
            f"🔧 THREAD MESSAGING ADAPTER: Received direct message notification"
        )
        logger.info(
            f"🔧 THREAD MESSAGING ADAPTER: Notification content: {message.payload}"
        )

        # Extract the original message from the notification
        try:
            original_message_data = message.payload.get("message", {})
            sender_id = message.payload.get("sender_id", "")

            if original_message_data:
                # Convert notification back to a direct message event for the agent
                from openagents.models.event import Event

                # Create a direct message event that the agent can handle
                direct_message_event = Event(
                    event_name="thread.direct_message.send",
                    source_id=sender_id,
                    destination_id=message.destination_id,
                    payload={
                        "action": "direct_message",
                        "sender_id": sender_id,
                        "content": original_message_data.get("payload", {}),
                        "text": original_message_data.get("text_representation", ""),
                        "timestamp": original_message_data.get("timestamp", 0),
                    },
                    event_id=original_message_data.get("event_id", ""),
                    timestamp=original_message_data.get("timestamp", 0),
                )

                logger.info(
                    f"🔧 THREAD MESSAGING ADAPTER: Converted notification to direct message event"
                )

                # Forward the converted direct message to the agent's Event handler
                if (
                    hasattr(self, "_agent_mod_message_handler")
                    and self._agent_mod_message_handler
                ):
                    await self._agent_mod_message_handler(direct_message_event)
                    logger.info(
                        f"🔧 THREAD MESSAGING ADAPTER: Forwarded converted direct message to agent handler"
                    )
                else:
                    logger.warning(
                        f"🔧 THREAD MESSAGING ADAPTER: No agent handler available for direct message"
                    )
            else:
                logger.warning(
                    f"🔧 THREAD MESSAGING ADAPTER: No original message found in notification"
                )

        except Exception as e:
            logger.error(f"Error processing direct message notification: {e}")
            logger.debug(f"Notification payload: {message.payload}")

    def set_agent_mod_message_handler(self, handler):
        """Set the agent's Event handler for forwarding notifications.

        Args:
            handler: The agent's _handle_mod_message method
        """
        self._agent_mod_message_handler = handler
        logger.info(
            f"🔧 THREAD MESSAGING ADAPTER: Registered agent mod message handler"
        )

    async def upload_file(self, file_path: Union[str, Path]) -> Optional[str]:
        """Upload a local file and get a UUID for it.

        Args:
            file_path: Path to the local file

        Returns:
            Optional[str]: File UUID if successful, None if failed
        """
        file_path = Path(file_path)

        if not file_path.exists():
            logger.error(f"File not found: {file_path}")
            return None

        try:
            # Read and encode file
            with open(file_path, "rb") as f:
                file_content = f.read()

            encoded_content = base64.b64encode(file_content).decode("utf-8")

            # Create upload message
            upload_msg = FileUploadMessage.create(
                filename=file_path.name,
                file_content=encoded_content,
                source_id=self.agent_id,
                mime_type=self._get_mime_type(file_path),
                file_size=len(file_content),
            )

            # Wrap in Event for proper transport
            wrapper_payload = upload_msg.model_dump()
            wrapper_payload["relevant_agent_id"] = self.agent_id
            message = Event(
                event_name="thread.file.upload",
                source_id=self.agent_id,
                payload=wrapper_payload,
                relevant_mod="openagents.mods.workspace.messaging",
                visibility=EventVisibility.MOD_ONLY,
            )

            # Store pending operation
            self.pending_file_operations[message.event_id] = {
                "action": "upload",
                "filename": file_path.name,
                "timestamp": message.timestamp,
            }

            # Use send_event for gRPC or send_mod_message for websocket
            if hasattr(self.connector, "send_mod_message"):
                await self.connector.send_mod_message(message)
            else:
                await self.agent_client.send_event(message)
            logger.debug(f"Initiated file upload for {file_path.name}")

            # Wait for response with timeout
            try:
                import asyncio

                # Wait up to 10 seconds for the upload response
                for _ in range(50):  # 50 * 0.2 = 10 seconds
                    if message.event_id in self.completed_file_operations:
                        result = self.completed_file_operations.pop(message.event_id)
                        if result.get("success"):
                            file_uuid = result.get("file_uuid")
                            logger.info(
                                f"File upload completed: {file_path.name} -> {file_uuid}"
                            )
                            return file_uuid
                        else:
                            logger.error(
                                f"File upload failed: {result.get('error', 'Unknown error')}"
                            )
                            return None

                    await asyncio.sleep(0.2)

                # Timeout - clean up and return None
                logger.warning(f"File upload timed out for {file_path.name}")
                if message.event_id in self.pending_file_operations:
                    del self.pending_file_operations[message.event_id]
                return None

            except Exception as e:
                logger.error(f"Error waiting for upload response: {e}")
                return None

        except Exception as e:
            logger.error(f"Error uploading file: {e}")
            return None

    async def reply_channel_message(
        self, channel: str, reply_to_id: str, text: str, quote: Optional[str] = None
    ) -> None:
        """Reply to a message in a channel (creates/continues thread).

        Args:
            channel: Channel name
            reply_to_id: ID of message being replied to
            text: Reply text content
            quote: Optional message ID to quote
        """
        if self.connector is None:
            logger.error(
                f"Cannot send reply: connector is None for agent {self.agent_id}"
            )
            return

        # Handle quoting if specified
        quoted_message_id = None
        quoted_text = None
        if quote:
            quoted_message_id = quote
            quoted_text = f"[Quoted message {quote}]"

        # Create reply message - this returns an Event object, don't double-wrap it
        reply_msg = ReplyMessage.create(
            reply_to_id=reply_to_id,
            text=text,
            source_id=self.agent_id,
            channel=channel,
            quoted_message_id=quoted_message_id,
            quoted_text=quoted_text,
        )
        
        # Use the reply message Event directly, just update the metadata
        message = reply_msg
        message.relevant_mod = "openagents.mods.workspace.messaging"

        await self.agent_client.send_event(message)
        logger.debug(f"Sent reply to message {reply_to_id} in channel {channel}")

    async def retrieve_channel_messages(
        self,
        channel: str,
        limit: int = 50,
        offset: int = 0,
        include_threads: bool = True,
    ) -> None:
        """Retrieve messages from a specific channel.

        Args:
            channel: Channel name to retrieve messages from
            limit: Maximum number of messages to retrieve (1-500, default 50)
            offset: Number of messages to skip for pagination (default 0)
            include_threads: Whether to include threaded messages (default True)
        """
        if self.connector is None:
            logger.error(
                f"Cannot retrieve messages: connector is None for agent {self.agent_id}"
            )
            return

        # Validate limit
        if not 1 <= limit <= 500:
            logger.error("Limit must be between 1 and 500")
            return

        # Create retrieval request
        retrieval_msg = MessageRetrievalMessage.create(
            action="retrieve_channel_messages",
            source_id=self.agent_id,
            channel=channel,
            limit=limit,
            offset=offset,
            include_threads=include_threads,
        )

        # Wrap in Event for proper transport
        message = Event(
            event_name="thread.channel_messages.retrieve",
            source_id=self.agent_id,
            relevant_mod="openagents.mods.workspace.messaging",
            visibility=EventVisibility.MOD_ONLY,
            relevant_agent_id=self.agent_id,
            payload=retrieval_msg.model_dump(),
        )

        # Store pending request
        self.pending_retrieval_requests[message.event_id] = {
            "action": "retrieve_channel_messages",
            "channel": channel,
            "limit": limit,
            "offset": offset,
            "include_threads": include_threads,
            "timestamp": message.timestamp,
        }

        await self.agent_client.send_event(message)
        logger.debug(
            f"Requested channel messages for {channel} (limit={limit}, offset={offset})"
        )

    async def retrieve_direct_messages(
        self,
        target_agent_id: str,
        limit: int = 50,
        offset: int = 0,
        include_threads: bool = True,
    ) -> None:
        """Retrieve direct messages with a specific agent.

        Args:
            target_agent_id: ID of the other agent in the conversation
            limit: Maximum number of messages to retrieve (1-500, default 50)
            offset: Number of messages to skip for pagination (default 0)
            include_threads: Whether to include threaded messages (default True)
        """
        if self.connector is None:
            logger.error(
                f"Cannot retrieve messages: connector is None for agent {self.agent_id}"
            )
            return

        # Validate limit
        if not 1 <= limit <= 500:
            logger.error("Limit must be between 1 and 500")
            return

        # Create retrieval request
        retrieval_msg = MessageRetrievalMessage.create(
            action="retrieve_direct_messages",
            source_id=self.agent_id,
            target_agent_id=target_agent_id,
            limit=limit,
            offset=offset,
            include_threads=include_threads,
        )

        # Wrap in Event for proper transport
        message = Event(
            event_name="thread.direct_messages.retrieve",
            source_id=self.agent_id,
            relevant_mod="openagents.mods.workspace.messaging",
            visibility=EventVisibility.MOD_ONLY,
            relevant_agent_id=self.agent_id,
            payload=retrieval_msg.model_dump(),
        )

        # Store pending request
        self.pending_retrieval_requests[message.event_id] = {
            "action": "retrieve_direct_messages",
            "target_agent_id": target_agent_id,
            "limit": limit,
            "offset": offset,
            "include_threads": include_threads,
            "timestamp": message.timestamp,
        }

        await self.agent_client.send_event(message)
        logger.debug(
            f"Requested direct messages with {target_agent_id} (limit={limit}, offset={offset})"
        )

    async def list_channels(self) -> List[Dict[str, Any]]:
        """List all channels in the network with details.

        Returns:
            List of channel dictionaries with name, description, agents, etc.
        """
        if self.connector is None:
            logger.error(
                f"Cannot list channels: connector is None for agent {self.agent_id}"
            )
            # Return default channels for test network
            return [
                {
                    "name": "general",
                    "description": "General discussion",
                    "agents": [],
                    "message_count": 0,
                },
                {
                    "name": "development",
                    "description": "Development topics",
                    "agents": [],
                    "message_count": 0,
                },
                {
                    "name": "support",
                    "description": "Support and help",
                    "agents": [],
                    "message_count": 0,
                },
            ]

        # Return cached channels if available
        if self.available_channels:
            logger.debug(f"Returning {len(self.available_channels)} cached channels")
            return self.available_channels

        # Create channel info request
        channel_info_msg = ChannelInfoMessage.create(source_id=self.agent_id)

        # Wrap in Event for proper transport
        message = Event(
            event_name="thread.channels.list",
            source_id=self.agent_id,
            relevant_mod="openagents.mods.workspace.messaging",
            visibility=EventVisibility.MOD_ONLY,
            relevant_agent_id=self.agent_id,
            payload=channel_info_msg.model_dump(),
        )

        # Store pending request
        self.pending_channel_requests[message.event_id] = {
            "action": "list_channels",
            "timestamp": message.timestamp,
        }

        await self.agent_client.send_event(message)
        logger.debug("Requested channels list")

        # Wait for response with timeout
        try:
            import asyncio

            for _ in range(25):  # 25 * 0.2 = 5 seconds
                if self.available_channels:
                    logger.debug(
                        f"Received {len(self.available_channels)} channels from network"
                    )
                    return self.available_channels
                await asyncio.sleep(0.2)

            # Timeout - return default channels
            logger.warning("Channel list request timed out, returning defaults")
            default_channels = [
                {
                    "name": "general",
                    "description": "General discussion",
                    "agents": [],
                    "message_count": 0,
                },
                {
                    "name": "development",
                    "description": "Development topics",
                    "agents": [],
                    "message_count": 0,
                },
                {
                    "name": "support",
                    "description": "Support and help",
                    "agents": [],
                    "message_count": 0,
                },
            ]
            return default_channels
        except Exception as e:
            logger.error(f"Error waiting for channels response: {e}")
            return []

    async def react_to_message(
        self, target_message_id: str, reaction_type: str, action: str = "add"
    ) -> None:
        """React to a message with an emoji.

        Args:
            target_message_id: ID of the message to react to
            reaction_type: Type of reaction (emoji)
            action: 'add' or 'remove' the reaction (default: 'add')
        """
        if self.connector is None:
            logger.error(f"Cannot react: connector is None for agent {self.agent_id}")
            return

        # Validate action
        if action not in ["add", "remove"]:
            logger.error(
                f"Invalid reaction action: {action}. Must be 'add' or 'remove'"
            )
            return

        # Create reaction message
        reaction_msg = ReactionMessage.create(
            target_message_id=target_message_id,
            reaction_type=reaction_type,
            source_id=self.agent_id,
            action=action,
        )

        # Wrap in Event for proper transport
        event_name = (
            f"thread.reaction.{action}"  # thread.reaction.add or thread.reaction.remove
        )
        message = Event(
            event_name=event_name,
            source_id=self.agent_id,
            relevant_mod="openagents.mods.workspace.messaging",
            visibility=EventVisibility.MOD_ONLY,
            relevant_agent_id=self.agent_id,
            payload=reaction_msg.model_dump(),
        )

        await self.agent_client.send_event(message)
        logger.debug(
            f"Sent {action} reaction {reaction_type} for message {target_message_id}"
        )

    def register_message_handler(
        self, handler_id: str, handler: MessageHandler
    ) -> None:
        """Register a handler for incoming messages.

        Args:
            handler_id: Unique identifier for the handler
            handler: Function to call when a message is received
        """
        self.message_handlers[handler_id] = handler
        logger.debug(f"Registered message handler {handler_id}")

    def unregister_message_handler(self, handler_id: str) -> None:
        """Unregister a message handler.

        Args:
            handler_id: Identifier of the handler to unregister
        """
        if handler_id in self.message_handlers:
            del self.message_handlers[handler_id]
            logger.debug(f"Unregistered message handler {handler_id}")

    def register_file_handler(self, handler_id: str, handler: FileHandler) -> None:
        """Register a handler for file operations.

        Args:
            handler_id: Unique identifier for the handler
            handler: Function to call when a file operation completes
        """
        self.file_handlers[handler_id] = handler
        logger.debug(f"Registered file handler {handler_id}")

    def unregister_file_handler(self, handler_id: str) -> None:
        """Unregister a file handler.

        Args:
            handler_id: Identifier of the handler to unregister
        """
        if handler_id in self.file_handlers:
            del self.file_handlers[handler_id]
            logger.debug(f"Unregistered file handler {handler_id}")

    async def _handle_file_upload_response(self, message: Event) -> None:
        """Handle file upload response.

        Args:
            message: The response message containing upload results
        """
        request_id = message.payload.get("request_id")
        success = message.payload.get("success", False)

        if success:
            file_id = message.payload.get("file_id")
            filename = message.payload.get("filename")
            logger.info(f"File uploaded successfully: {filename} -> {file_id}")

            # Store completion result for upload_file method
            if request_id:
                self.completed_file_operations[request_id] = {
                    "success": True,
                    "file_uuid": file_id,
                    "filename": filename,
                }

            # Call file handlers
            for handler in self.file_handlers.values():
                try:
                    handler(file_id, filename, {"action": "upload", "success": True})
                except Exception as e:
                    logger.error(f"Error in file handler: {e}")
        else:
            error = message.payload.get("error", "Unknown error")
            logger.error(f"File upload failed: {error}")

            # Store completion result for upload_file method
            if request_id:
                self.completed_file_operations[request_id] = {
                    "success": False,
                    "error": error,
                }

            # Call file handlers with error
            for handler in self.file_handlers.values():
                try:
                    handler(
                        "", "", {"action": "upload", "success": False, "error": error}
                    )
                except Exception as e:
                    logger.error(f"Error in file handler: {e}")

        # Clean up pending operation
        if request_id in self.pending_file_operations:
            del self.pending_file_operations[request_id]

    async def _handle_file_download_response(self, message: Event) -> None:
        """Handle file download response.

        Args:
            message: The response message containing file data
        """
        request_id = message.payload.get("request_id")
        success = message.payload.get("success", False)

        if success:
            file_id = message.payload.get("file_id")
            filename = message.payload.get("filename")
            encoded_content = message.payload.get("content")

            try:
                # Decode and save file locally
                file_content = base64.b64decode(encoded_content)
                local_path = self.file_storage_path / filename

                with open(local_path, "wb") as f:
                    f.write(file_content)

                logger.info(f"File downloaded: {file_id} -> {local_path}")

                # Call file handlers
                for handler in self.file_handlers.values():
                    try:
                        handler(
                            file_id,
                            filename,
                            {
                                "action": "download",
                                "success": True,
                                "path": str(local_path),
                            },
                        )
                    except Exception as e:
                        logger.error(f"Error in file handler: {e}")

            except Exception as e:
                logger.error(f"Error saving downloaded file: {e}")

                # Call file handlers with error
                for handler in self.file_handlers.values():
                    try:
                        handler(
                            file_id,
                            filename,
                            {"action": "download", "success": False, "error": str(e)},
                        )
                    except Exception as e:
                        logger.error(f"Error in file handler: {e}")
        else:
            error = message.payload.get("error", "Unknown error")
            file_id = message.payload.get("file_id", "")
            logger.error(f"File download failed: {error}")

            # Call file handlers with error
            for handler in self.file_handlers.values():
                try:
                    handler(
                        file_id,
                        "",
                        {"action": "download", "success": False, "error": error},
                    )
                except Exception as e:
                    logger.error(f"Error in file handler: {e}")

        # Clean up pending operation
        if request_id in self.pending_file_operations:
            del self.pending_file_operations[request_id]

    async def _handle_channels_list_response(self, message: Event) -> None:
        """Handle channels list response.

        Args:
            message: The response message containing channels data
        """
        request_id = message.payload.get("request_id")
        success = message.payload.get("success", False)

        if success:
            channels = message.payload.get("channels", [])
            self.available_channels = channels
            logger.info(f"Received channels list: {[ch['name'] for ch in channels]}")
        else:
            error = message.payload.get("error", "Unknown error")
            logger.error(f"Failed to get channels list: {error}")

        # Clean up pending request
        if request_id in self.pending_channel_requests:
            del self.pending_channel_requests[request_id]

    async def _handle_channel_messages_response(self, message: Event) -> None:
        """Handle channel messages retrieval response.

        Args:
            message: The response message
        """
        content = message.payload
        request_id = content.get("request_id")

        if request_id in self.pending_retrieval_requests:
            request_info = self.pending_retrieval_requests.pop(request_id)

            if content.get("success", False):
                # Successful retrieval
                channel = content.get("channel")
                messages = content.get("messages", [])
                total_count = content.get("total_count", 0)
                offset = content.get("offset", 0)
                limit = content.get("limit", 50)
                has_more = content.get("has_more", False)

                logger.debug(
                    f"Retrieved {len(messages)} channel messages from {channel}"
                )

                # Notify handlers
                for handler_id, handler in self.message_handlers.items():
                    try:
                        handler(
                            {
                                "action": "channel_messages_retrieved",
                                "channel": channel,
                                "messages": messages,
                                "total_count": total_count,
                                "offset": offset,
                                "limit": limit,
                                "has_more": has_more,
                                "request_info": request_info,
                            },
                            message.source_id,
                        )
                    except Exception as e:
                        logger.error(f"Error in message handler {handler_id}: {e}")
            else:
                # Failed retrieval
                error = content.get("error", "Unknown error")
                logger.error(f"Channel messages retrieval failed: {error}")

                # Notify handlers of error
                for handler_id, handler in self.message_handlers.items():
                    try:
                        handler(
                            {
                                "action": "channel_messages_retrieval_error",
                                "error": error,
                                "request_info": request_info,
                            },
                            message.source_id,
                        )
                    except Exception as e:
                        logger.error(f"Error in message handler {handler_id}: {e}")

    async def _handle_direct_messages_response(self, message: Event) -> None:
        """Handle direct messages retrieval response.

        Args:
            message: The response message
        """
        content = message.payload
        request_id = content.get("request_id")

        if request_id in self.pending_retrieval_requests:
            request_info = self.pending_retrieval_requests.pop(request_id)

            if content.get("success", False):
                # Successful retrieval
                target_agent_id = content.get("target_agent_id")
                messages = content.get("messages", [])
                total_count = content.get("total_count", 0)
                offset = content.get("offset", 0)
                limit = content.get("limit", 50)
                has_more = content.get("has_more", False)

                logger.debug(
                    f"Retrieved {len(messages)} direct messages with {target_agent_id}"
                )

                # Notify handlers
                for handler_id, handler in self.message_handlers.items():
                    try:
                        handler(
                            {
                                "action": "direct_messages_retrieved",
                                "target_agent_id": target_agent_id,
                                "messages": messages,
                                "total_count": total_count,
                                "offset": offset,
                                "limit": limit,
                                "has_more": has_more,
                                "request_info": request_info,
                            },
                            message.source_id,
                        )
                    except Exception as e:
                        logger.error(f"Error in message handler {handler_id}: {e}")
            else:
                # Failed retrieval
                error = content.get("error", "Unknown error")
                logger.error(f"Direct messages retrieval failed: {error}")

                # Notify handlers of error
                for handler_id, handler in self.message_handlers.items():
                    try:
                        handler(
                            {
                                "action": "direct_messages_retrieval_error",
                                "error": error,
                                "request_info": request_info,
                            },
                            message.source_id,
                        )
                    except Exception as e:
                        logger.error(f"Error in message handler {handler_id}: {e}")

    async def _handle_reaction_response(self, message: Event) -> None:
        """Handle reaction response.

        Args:
            message: The reaction response message
        """
        content = message.payload
        success = content.get("success", False)
        target_message_id = content.get("target_message_id")
        reaction_type = content.get("reaction_type")
        action_taken = content.get("action_taken")
        total_reactions = content.get("total_reactions", 0)

        if success:
            logger.debug(
                f"Reaction {action_taken} successful: {reaction_type} on message {target_message_id}"
            )
        else:
            error = content.get("error", "Unknown error")
            logger.error(f"Reaction {action_taken} failed: {error}")

        # Notify message handlers
        for handler_id, handler in self.message_handlers.items():
            try:
                handler(
                    {
                        "success": success,
                        "target_message_id": target_message_id,
                        "reaction_type": reaction_type,
                        "action_taken": action_taken,
                        "total_reactions": total_reactions,
                        "error": content.get("error") if not success else None,
                    },
                    message.source_id,
                )
            except Exception as e:
                logger.error(f"Error in message handler {handler_id}: {e}")

    async def _handle_reaction_notification(self, message: Event) -> None:
        """Handle reaction notification from other agents.

        Args:
            message: The reaction notification message
        """
        content = message.payload
        target_message_id = content.get("target_message_id")
        reaction_type = content.get("reaction_type")
        reacting_agent = content.get("reacting_agent")
        action_taken = content.get("action_taken")
        total_reactions = content.get("total_reactions", 0)

        logger.debug(
            f"Reaction notification: {reacting_agent} {action_taken} {reaction_type} on message {target_message_id}"
        )

        # Notify message handlers
        for handler_id, handler in self.message_handlers.items():
            try:
                handler(
                    {
                        "action": "reaction_notification",
                        "target_message_id": target_message_id,
                        "reaction_type": reaction_type,
                        "reacting_agent": reacting_agent,
                        "action_taken": action_taken,
                        "total_reactions": total_reactions,
                    },
                    message.source_id,
                )
            except Exception as e:
                logger.error(f"Error in message handler {handler_id}: {e}")

    def _get_mime_type(self, file_path: Path) -> str:
        """Get the MIME type for a file.

        Args:
            file_path: Path to the file

        Returns:
            str: MIME type of the file
        """
        # Simple MIME type detection based on extension
        extension = file_path.suffix.lower()

        mime_types = {
            ".txt": "text/plain",
            ".html": "text/html",
            ".htm": "text/html",
            ".json": "application/json",
            ".xml": "application/xml",
            ".pdf": "application/pdf",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".gif": "image/gif",
            ".svg": "image/svg+xml",
            ".mp3": "audio/mpeg",
            ".mp4": "video/mp4",
            ".wav": "audio/wav",
            ".zip": "application/zip",
            ".tar": "application/x-tar",
            ".gz": "application/gzip",
            ".csv": "text/csv",
            ".py": "text/x-python",
            ".js": "text/javascript",
            ".css": "text/css",
        }

        return mime_types.get(extension, "application/octet-stream")

    def get_tools(self) -> List[AgentTool]:
        """Get the tools for the mod adapter.

        Returns:
            List[AgentAdapterTool]: The 6 specified tools for the mod adapter
        """
        tools = []

        # Tool 1: Send direct message
        send_direct_tool = AgentTool(
            name="send_direct_message",
            description="Send a direct message to another agent",
            input_schema={
                "type": "object",
                "properties": {
                    "target_agent_id": {
                        "type": "string",
                        "description": "ID of the agent to send the message to",
                    },
                    "text": {
                        "type": "string",
                        "description": "Text content of the message",
                    },
                    "quote": {
                        "type": "string",
                        "description": "Optional message ID to quote",
                    },
                },
                "required": ["target_agent_id", "text"],
            },
            func=self.send_direct_message,
        )
        tools.append(send_direct_tool)

        # Tool 2: Send channel message
        send_channel_tool = AgentTool(
            name="send_channel_message",
            description="Send a message into a channel, optionally mentioning an agent",
            input_schema={
                "type": "object",
                "properties": {
                    "channel": {
                        "type": "string",
                        "description": "Channel name to send the message to",
                    },
                    "text": {
                        "type": "string",
                        "description": "Text content of the message",
                    },
                    "mentioned_agent_id": {
                        "type": "string",
                        "description": "Optional agent ID to mention/tag in the channel",
                    },
                    "quote": {
                        "type": "string",
                        "description": "Optional message ID to quote",
                    },
                },
                "required": ["channel", "text"],
            },
            func=self.send_channel_message,
        )
        tools.append(send_channel_tool)

        # Note: upload_file tool removed to avoid conflict with shared_cache mod
        # Use openagents.mods.core.shared_cache for file operations

        # Tool 3: Reply to channel message
        reply_channel_tool = AgentTool(
            name="reply_channel_message",
            description="Reply to a message in a channel (creates/continues thread, max 5 levels)",
            input_schema={
                "type": "object",
                "properties": {
                    "channel": {"type": "string", "description": "Channel name"},
                    "reply_to_id": {
                        "type": "string",
                        "description": "ID of the message being replied to",
                    },
                    "text": {"type": "string", "description": "Reply text content"},
                    "quote": {
                        "type": "string",
                        "description": "Optional message ID to quote",
                    },
                },
                "required": ["channel", "reply_to_id", "text"],
            },
            func=self.reply_channel_message,
        )
        tools.append(reply_channel_tool)

        # Tool 6: List channels
        list_channels_tool = AgentTool(
            name="list_channels",
            description="List all channels in the network with channel names, descriptions, and agents",
            input_schema={"type": "object", "properties": {}, "required": []},
            func=self.list_channels,
        )
        tools.append(list_channels_tool)

        # Tool 7: Retrieve channel messages
        retrieve_channel_tool = AgentTool(
            name="retrieve_channel_messages",
            description="Retrieve messages from a specific channel with pagination and threading support",
            input_schema={
                "type": "object",
                "properties": {
                    "channel": {
                        "type": "string",
                        "description": "Channel name to retrieve messages from",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of messages to retrieve (1-500, default 50)",
                        "minimum": 1,
                        "maximum": 500,
                        "default": 50,
                    },
                    "offset": {
                        "type": "integer",
                        "description": "Number of messages to skip for pagination (default 0)",
                        "minimum": 0,
                        "default": 0,
                    },
                    "include_threads": {
                        "type": "boolean",
                        "description": "Whether to include threaded messages (default true)",
                        "default": True,
                    },
                },
                "required": ["channel"],
            },
            func=self.retrieve_channel_messages,
        )
        tools.append(retrieve_channel_tool)

        # Tool 8: Retrieve direct messages
        retrieve_direct_tool = AgentTool(
            name="retrieve_direct_messages",
            description="Retrieve direct messages with a specific agent with pagination and threading support",
            input_schema={
                "type": "object",
                "properties": {
                    "target_agent_id": {
                        "type": "string",
                        "description": "ID of the other agent in the conversation",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of messages to retrieve (1-500, default 50)",
                        "minimum": 1,
                        "maximum": 500,
                        "default": 50,
                    },
                    "offset": {
                        "type": "integer",
                        "description": "Number of messages to skip for pagination (default 0)",
                        "minimum": 0,
                        "default": 0,
                    },
                    "include_threads": {
                        "type": "boolean",
                        "description": "Whether to include threaded messages (default true)",
                        "default": True,
                    },
                },
                "required": ["target_agent_id"],
            },
            func=self.retrieve_direct_messages,
        )
        tools.append(retrieve_direct_tool)

        # Tool 9: React to message
        react_tool = AgentTool(
            name="react_to_message",
            description="Add or remove an emoji reaction to/from a message",
            input_schema={
                "type": "object",
                "properties": {
                    "target_message_id": {
                        "type": "string",
                        "description": "ID of the message to react to",
                    },
                    "reaction_type": {
                        "type": "string",
                        "description": "Type of reaction emoji",
                        "enum": [
                            "+1",
                            "-1",
                            "like",
                            "heart",
                            "laugh",
                            "wow",
                            "sad",
                            "angry",
                            "thumbs_up",
                            "thumbs_down",
                            "smile",
                            "ok",
                            "done",
                            "fire",
                            "party",
                            "clap",
                            "check",
                            "cross",
                            "eyes",
                            "thinking",
                        ],
                    },
                    "action": {
                        "type": "string",
                        "description": "Action to take: 'add' or 'remove' reaction",
                        "enum": ["add", "remove"],
                        "default": "add",
                    },
                },
                "required": ["target_message_id", "reaction_type"],
            },
            func=self.react_to_message,
        )
        tools.append(react_tool)

        return tools
