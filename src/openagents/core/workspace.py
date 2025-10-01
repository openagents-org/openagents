"""
Workspace implementation for OpenAgents.

This module provides workspace functionality that integrates with the thread messaging mod
to provide channel-based communication and collaboration features.
"""

import asyncio
import logging
import time
import uuid
from typing import Dict, Any, List, Optional, Union, TYPE_CHECKING
from datetime import datetime

from openagents.core.client import AgentClient
from openagents.models.event import Event
from openagents.models.event_response import EventResponse
from openagents.models.messages import EventNames
from openagents.config.globals import WORKSPACE_MESSAGING_MOD_NAME, DEFAULT_CHANNELS

logger = logging.getLogger(__name__)


class AgentConnection:
    """
    Represents a connection to a specific agent in the workspace.

    Provides methods to communicate directly with an agent.
    """

    def __init__(self, agent_id: str, workspace: "Workspace"):
        """Initialize an agent connection.

        Args:
            agent_id: ID of the target agent
            workspace: Parent workspace instance
        """
        self.agent_id = agent_id
        self.workspace = workspace
        self._client = workspace.client

    async def send(
        self, content: Union[str, Dict[str, Any]], **kwargs
    ) -> EventResponse:
        """Send a direct message to this agent.

        Args:
            content: Message content (string or dict)
            **kwargs: Additional message parameters

        Returns:
            EventResponse: Response from the event system
        """
        # Ensure we're connected to the client
        if not await self.workspace._ensure_connected():
            logger.error("Could not establish client connection")
            return EventResponse(
                success=False, message="Could not establish client connection"
            )

        try:
            # Prepare message content
            if isinstance(content, str):
                message_content = {"text": content}
            else:
                message_content = content.copy()

            # Create direct message event for thread messaging with nested structure
            direct_message = Event(
                event_name="thread.direct_message.send",
                source_id=self._client.agent_id,
                destination_id=self.agent_id,
                payload={
                    "target_agent_id": self.agent_id,
                    "message_type": "direct_message",
                    "content": message_content,  # Nested structure like channel messages
                },
                relevant_mod=WORKSPACE_MESSAGING_MOD_NAME,
                **kwargs,
            )

            # Send through client and get immediate response
            response = await self.workspace.send_event(direct_message)
            return response

        except Exception as e:
            logger.error(f"Failed to send direct message to agent {self.agent_id}: {e}")
            return EventResponse(
                success=False, message=f"Failed to send message: {str(e)}"
            )

    async def get_agent_info(self) -> Optional[Dict[str, Any]]:
        """Get information about this agent.

        Returns:
            Dict with agent information or None if not available
        """
        # Ensure we're connected to the client
        if not await self.workspace._ensure_connected():
            logger.error("Could not establish client connection")
            return None

        try:
            # Get agent info from the workspace's client connection
            # This would need to be implemented with proper agent discovery
            # For now, return basic info
            return {
                "agent_id": self.agent_id,
                "status": "online",  # Placeholder
                "capabilities": [],  # Placeholder
            }

        except Exception as e:
            logger.error(f"Failed to get info for agent {self.agent_id}: {e}")
            return None

    async def wait_for_message(self, timeout: float = 30.0) -> Optional[Dict[str, Any]]:
        """Wait for a direct message from this agent.

        Args:
            timeout: Timeout in seconds

        Returns:
            Dict containing the message content, or None if timeout
        """
        # Ensure we're connected to the client
        if not await self.workspace._ensure_connected():
            logger.error("Could not establish client connection")
            return None

        try:

            def message_condition(msg):
                """Check if this is a direct message from our target agent."""
                try:
                    return msg.source_id == self.agent_id
                except (AttributeError, KeyError):
                    return False

            # Wait for the direct message
            response = await self._client.wait_event(
                condition=message_condition, timeout=timeout
            )

            if response:
                return response.payload
            return None

        except Exception as e:
            logger.error(f"Error waiting for message from agent {self.agent_id}: {e}")
            return None

    async def wait_for_reply(self, timeout: float = 30.0) -> Optional[Dict[str, Any]]:
        """Wait for a reply from this agent (alias for wait_for_message).

        Args:
            timeout: Timeout in seconds

        Returns:
            Dict containing the message content, or None if timeout
        """
        return await self.wait_for_message(timeout)

    async def send_and_wait(
        self, content: Union[str, Dict[str, Any]], timeout: float = 30.0, **kwargs
    ) -> Optional[Dict[str, Any]]:
        """Send a direct message and wait for a reply.

        Args:
            content: Message content to send
            timeout: Timeout in seconds to wait for reply
            **kwargs: Additional message parameters

        Returns:
            Dict containing the reply message content, or None if timeout or send failed
        """
        # Send the message first
        success = await self.send(content, **kwargs)
        if not success:
            logger.error(f"Failed to send message to agent {self.agent_id}")
            return None

        # Wait for reply
        logger.info(f"Sent message to {self.agent_id}, waiting for reply...")
        return await self.wait_for_reply(timeout=timeout)

    def __str__(self) -> str:
        return f"AgentConnection({self.agent_id})"

    def __repr__(self) -> str:
        return f"AgentConnection(agent_id='{self.agent_id}', workspace='{self.workspace._client.agent_id if self.workspace._client else 'None'}')"


class ChannelConnection:
    """
    Represents a communication channel in a workspace.

    Provides methods to interact with channels through the thread messaging mod.
    """

    def __init__(self, channel_name: str, workspace: "Workspace"):
        """Initialize a channel.

        Args:
            channel_name: Name of the channel (with or without # prefix)
            workspace: Parent workspace instance
        """
        # Store channel name with # prefix for display but normalize for backend communication
        # The name property includes # for UI/display purposes
        self.name = f"#{channel_name.lstrip('#')}"
        self.workspace = workspace
        self._client = workspace._client

    async def post(
        self, content: Union[str, Dict[str, Any]], **kwargs
    ) -> EventResponse:
        """Send a message to this channel.

        Args:
            content: Message content (string or dict)
            **kwargs: Additional message parameters

        Returns:
            EventResponse: Response from the event system
        """
        # Ensure we're connected to the client
        if not await self.workspace._ensure_connected():
            logger.error("Could not establish client connection")
            return EventResponse(
                success=False, message="Could not establish client connection"
            )

        try:
            # Prepare message content
            if isinstance(content, str):
                message_content = {"text": content}
            else:
                message_content = content.copy()

            # Create mod message for thread messaging
            mod_message = Event(
                event_name="thread.channel_message.post",
                source_id=self._client.agent_id,
                relevant_mod=WORKSPACE_MESSAGING_MOD_NAME,
                destination_id=f"channel:{self.name.lstrip('#')}",  # Proper channel destination
                payload={
                    "action": "channel_message",
                    "message_type": "channel_message",
                    "channel": (
                        self.name.lstrip("#") if self.name else self.name
                    ),  # Normalize channel name
                    "content": message_content,
                    **kwargs,
                },
            )

            # Send through workspace and get immediate response
            response = await self.workspace.send_event(mod_message)
            return response

        except Exception as e:
            logger.error(f"Failed to send message to channel {self.name}: {e}")
            return EventResponse(
                success=False, message=f"Failed to send message: {str(e)}"
            )

    async def post_with_mention(
        self, content: Union[str, Dict[str, Any]], mention_agent_id: str, **kwargs
    ) -> bool:
        """Send a message to this channel with an explicit agent mention.

        Args:
            content: Message content (string or dict)
            mention_agent_id: ID of the agent to mention
            **kwargs: Additional message parameters

        Returns:
            bool: True if message sent successfully
        """
        # Ensure we're connected to the client
        if not await self.workspace._ensure_connected():
            logger.error("Could not establish client connection")
            return False

        try:
            # Prepare message content
            if isinstance(content, str):
                message_content = {"text": content}
            else:
                message_content = content.copy()

            # Create mod message for thread messaging with mention
            mod_message = Event(
                event_name="thread.channel_message.post",
                source_id=self._client.agent_id,
                relevant_mod=WORKSPACE_MESSAGING_MOD_NAME,
                destination_id=f"channel:{self.name.lstrip('#')}",
                payload={
                    "message_type": "channel_message",
                    "channel": self.name.lstrip("#"),
                    "content": message_content,
                    "mentioned_agent_id": mention_agent_id,  # Add explicit mention
                    **kwargs,
                },
            )

            # Send through workspace's method
            success = await self.workspace.send_event(mod_message)

            # Events are now emitted automatically by the client

            return success

        except Exception as e:
            logger.error(
                f"Failed to send message with mention to channel {self.name}: {e}"
            )
            return False

    async def get_messages(self, limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
        """Retrieve messages from this channel synchronously.

        Args:
            limit: Maximum number of messages to retrieve
            offset: Number of messages to skip

        Returns:
            List of message dictionaries
        """
        try:
            # Create mod message to retrieve channel messages using the correct event name
            mod_message = Event(
                event_name="thread.channel_messages.retrieve",
                source_id=self._client.agent_id,
                relevant_mod=WORKSPACE_MESSAGING_MOD_NAME,
                destination_id=f"channel:{self.name.lstrip('#')}",
                payload={
                    "action": "retrieve_channel_messages",
                    "channel": self.name.lstrip("#"),
                    "limit": limit,
                    "offset": offset,
                },
            )

            # Send request synchronously and get immediate response
            response = await self.workspace.send_event(mod_message)

            if not response.success:
                logger.error(
                    f"Failed to retrieve messages for channel {self.name}: {response.message}"
                )
                return []

            # Extract messages from response data
            messages = response.data.get("messages", []) if response.data else []

            logger.debug(f"Retrieved {len(messages)} messages from channel {self.name}")
            return messages

        except Exception as e:
            logger.error(f"Failed to retrieve messages from channel {self.name}: {e}")
            return []
    
    async def reply(
        self, message_id: str, content: Union[str, Dict[str, Any]], **kwargs
    ) -> bool:
        """
        Reply to a specific message in this channel.

        Alias for reply_to_message.
        """
        return await self.reply_to_message(message_id, content, **kwargs)

    async def reply_to_message(
        self, message_id: str, content: Union[str, Dict[str, Any]], **kwargs
    ) -> bool:
        """Reply to a specific message in this channel.

        Args:
            message_id: ID of the message to reply to
            content: Reply content
            **kwargs: Additional reply parameters

        Returns:
            bool: True if reply sent successfully
        """
        # Ensure we're connected to the client
        if not await self.workspace._ensure_connected():
            logger.error("Could not establish client connection")
            return False

        try:
            # Prepare reply content
            if isinstance(content, str):
                reply_content = {"text": content}
            else:
                reply_content = content.copy()

            # Create mod message for thread messaging
            mod_message = Event(
                event_name="thread.reply.post",
                source_id=self._client.agent_id,
                relevant_mod=WORKSPACE_MESSAGING_MOD_NAME,
                destination_id=f"channel:{self.name.lstrip('#')}",
                payload={
                    "message_type": "reply_message",
                    "sender_id": self._client.agent_id,
                    "channel": self.name.lstrip("#"),
                    "reply_to_id": message_id,
                    "content": reply_content,
                    **kwargs,
                },
            )

            # Send through client
            return await self.workspace.send_event(mod_message)

        except Exception as e:
            logger.error(
                f"Failed to reply to message {message_id} in channel {self.name}: {e}"
            )
            return False

    async def upload_file(self, file_path: str) -> Optional[str]:
        """Upload a file to this channel.

        Args:
            file_path: Path to the file to upload

        Returns:
            File UUID if successful, None otherwise
        """
        # Ensure we're connected to the client
        if not await self.workspace._ensure_connected():
            logger.error("Could not establish client connection")
            return None

        try:
            # Create mod message for file upload with required fields
            # Read file content for upload (in a real implementation, this would be more sophisticated)
            file_content = "dummy_file_content"  # Placeholder
            filename = file_path.split("/")[-1] if "/" in file_path else file_path
            file_size = len(file_content)

            mod_message = Event(
                event_name="thread.file_upload",
                source_id=self._client.agent_id,
                relevant_mod=WORKSPACE_MESSAGING_MOD_NAME,
                destination_id=self._client.agent_id,
                payload={
                    "message_type": "file_upload",
                    "sender_id": self._client.agent_id,
                    "channel": self.name.lstrip("#"),
                    "file_content": file_content,
                    "filename": filename,
                    "file_size": file_size,
                    "file_path": file_path,
                },
            )

            # Send through workspace's method
            success = await self.workspace.send_event(mod_message)
            if success:
                # In a real implementation, this would return the actual file UUID
                # For now, return a placeholder
                return f"file-{file_path.split('/')[-1]}-uuid"
            return None

        except Exception as e:
            logger.error(
                f"Failed to upload file {file_path} to channel {self.name}: {e}"
            )
            return None

    async def react_to_message(
        self, message_id: str, reaction: str, action: str = "add"
    ) -> bool:
        """Add or remove a reaction to a message.

        Args:
            message_id: ID of the message to react to
            reaction: Reaction emoji (e.g., "+1", "heart", "laugh")
            action: "add" or "remove" the reaction

        Returns:
            bool: True if reaction was successful
        """
        # Ensure we're connected to the client
        if not await self.workspace._ensure_connected():
            logger.error("Could not establish client connection")
            return False

        try:
            # Create mod message for reaction
            mod_message = Event(
                event_name="thread.reaction",
                source_id=self._client.agent_id,
                relevant_mod=WORKSPACE_MESSAGING_MOD_NAME,
                destination_id=self._client.agent_id,
                payload={
                    "message_type": "reaction",
                    "sender_id": self._client.agent_id,
                    "target_message_id": message_id,
                    "reaction_type": reaction,
                    "action": action,
                },
            )

            # Send through client
            return await self.workspace.send_event(mod_message)

        except Exception as e:
            logger.error(
                f"Failed to react to message {message_id} in channel {self.name}: {e}"
            )
            return False

    async def wait_for_reply(
        self, message_id: Optional[str] = None, timeout: float = 30.0
    ) -> Optional[Dict[str, Any]]:
        """Wait for a reply to a specific message or any reply in this channel.

        Args:
            message_id: ID of the message to wait for replies to (if None, waits for any reply)
            timeout: Timeout in seconds

        Returns:
            Dict containing the reply message, or None if timeout
        """
        # Ensure we're connected to the client
        if not await self.workspace._ensure_connected():
            logger.error("Could not establish client connection")
            return None

        try:

            def reply_condition(msg):
                """Check if this is a reply message in our channel."""
                try:
                    content = msg.payload
                    # Look for reply messages from thread messaging mod
                    if content.get("action") == "channel_message_notification":
                        msg_data = content.get("message", {})
                        # Check if it's in our channel
                        if msg_data.get("channel") != self.name.lstrip("#"):
                            return False
                        # Check if it's a reply (has reply_to_id)
                        if not msg_data.get("reply_to_id"):
                            return False
                        # If specific message_id provided, check if it matches
                        if message_id and msg_data.get("reply_to_id") != message_id:
                            return False
                        return True
                    return False
                except (AttributeError, KeyError):
                    return False

            # Wait for the reply
            response = await self._client.wait_mod_message(
                condition=reply_condition, timeout=timeout
            )

            if response:
                return response.payload.get("message", {})
            return None

        except Exception as e:
            logger.error(f"Error waiting for reply in channel {self.name}: {e}")
            return None

    async def wait_for_post(
        self, from_agent: Optional[str] = None, timeout: float = 30.0
    ) -> Optional[Dict[str, Any]]:
        """Wait for the next post (not reply) in this channel.

        Args:
            from_agent: Wait for post from specific agent (if None, waits for any agent)
            timeout: Timeout in seconds

        Returns:
            Dict containing the post message, or None if timeout
        """
        # Ensure we're connected to the client
        if not await self.workspace._ensure_connected():
            logger.error("Could not establish client connection")
            return None

        try:

            def post_condition(msg):
                """Check if this is a new post (not reply) in our channel."""
                try:
                    content = msg.payload
                    # Look for channel messages from thread messaging mod
                    if content.get("action") == "channel_message_notification":
                        msg_data = content.get("message", {})
                        # Check if it's in our channel
                        if msg_data.get("channel") != self.name.lstrip("#"):
                            return False
                        # Check if it's NOT a reply (no reply_to_id)
                        if msg_data.get("reply_to_id"):
                            return False
                        # If specific agent provided, check sender
                        if from_agent and msg_data.get("sender_id") != from_agent:
                            return False
                        # Don't wait for our own messages
                        if msg_data.get("sender_id") == self._client.agent_id:
                            return False
                        return True
                    return False
                except (AttributeError, KeyError):
                    return False

            # Wait for the post
            response = await self._client.wait_mod_message(
                condition=post_condition, timeout=timeout
            )

            if response:
                return response.payload.get("message", {})
            return None

        except Exception as e:
            logger.error(f"Error waiting for post in channel {self.name}: {e}")
            return None

    async def wait_for_reaction(
        self, message_id: str, timeout: float = 30.0
    ) -> Optional[Dict[str, Any]]:
        """Wait for a reaction to a specific message.

        Args:
            message_id: ID of the message to wait for reactions to
            timeout: Timeout in seconds

        Returns:
            Dict containing the reaction info, or None if timeout
        """
        # Ensure we're connected to the client
        if not await self.workspace._ensure_connected():
            logger.error("Could not establish client connection")
            return None

        try:

            def reaction_condition(msg):
                """Check if this is a reaction to our message."""
                try:
                    content = msg.payload
                    # Look for reaction notifications from thread messaging mod
                    if content.get("action") == "reaction_notification":
                        return content.get("target_message_id") == message_id
                    return False
                except (AttributeError, KeyError):
                    return False

            # Wait for the reaction
            response = await self._client.wait_mod_message(
                condition=reaction_condition, timeout=timeout
            )

            if response:
                return response.payload
            return None

        except Exception as e:
            logger.error(f"Error waiting for reaction to message {message_id}: {e}")
            return None

    async def post_and_wait(
        self, content: Union[str, Dict[str, Any]], timeout: float = 30.0, **kwargs
    ) -> Optional[Dict[str, Any]]:
        """Post a message and wait for any reply to it.

        Args:
            content: Message content to post
            timeout: Timeout in seconds to wait for reply
            **kwargs: Additional message parameters

        Returns:
            Dict containing the reply message, or None if timeout or post failed
        """
        # Post the message first
        success = await self.post(content, **kwargs)
        if not success:
            logger.error(f"Failed to post message to {self.name}")
            return None

        # For demo purposes, we'll wait for any reply since we don't have the actual message ID
        # In a real implementation, the post method would return the message ID
        logger.info(f"Posted message to {self.name}, waiting for replies...")
        return await self.wait_for_reply(timeout=timeout)

    def __str__(self) -> str:
        return f"ChannelConnection({self.name})"

    def __repr__(self) -> str:
        return f"ChannelConnection(name='{self.name}', workspace='{self.workspace._client.agent_id if self.workspace._client else 'None'}')"


class Workspace:
    """
    Represents a workspace that provides access to channels and collaboration features.

    The workspace integrates with the thread messaging mod to provide channel-based
    communication and other collaborative features.
    """

    def __init__(self, client: AgentClient):
        """Initialize a workspace.

        Args:
            client: AgentClient instance for communication
        """
        self._client = client

        self._channels_cache: Dict[str, ChannelConnection] = {}
        self._agents_cache: Dict[str, AgentConnection] = {}
        self._last_channels_fetch: Optional[datetime] = None
        self._last_agents_fetch: Optional[datetime] = None
        self._auto_connect_config: Optional[Dict[str, Any]] = None
        self._is_connected: bool = False

        # Events are now handled by the client - no workspace events

        # Initialize response handling
        self._pending_responses: Dict[str, asyncio.Future] = {}
        self._handlers_setup: bool = False

    @property
    def agent_id(self) -> str:
        """Get the agent ID.

        Returns:
            str: The agent ID
        """
        return self._client.agent_id

    @property
    def client(self) -> AgentClient:
        """Get the client instance.

        Returns:
            AgentClient: The client instance
        """
        return self._client

    async def send_event(self, mod_message) -> EventResponse:
        """Send a mod message through connector.

        Args:
            mod_message: Event to send

        Returns:
            EventResponse: Response from the event system
        """
        logger.debug(f"🔧 WORKSPACE: Sending message through connector")

        # Check if client and connector are available
        if not self._client:
            raise ValueError("No client available for sending event")

        if not self._client.connector:
            raise ValueError("No connector available for sending event")

        response = await self._client.send_event(mod_message)
        logger.debug(f"🔧 WORKSPACE: Connector send result: {response}")
        return response

    def send_event_sync(self, mod_message) -> EventResponse:
        """Send a mod message through client synchronously.

        The client.send_event is async but returns synchronous EventResponse.
        We use asyncio.run to call it synchronously for workspace operations.

        Args:
            mod_message: Event to send

        Returns:
            EventResponse: Response from the event system with data
        """
        logger.debug(f"🔧 WORKSPACE: Sending sync message through client")

        try:
            # Use asyncio.run to call the async method synchronously
            # This is appropriate for workspace operations which can be blocking
            import asyncio

            # Check if we're already in an event loop
            try:
                loop = asyncio.get_running_loop()
                # If we're in a loop, we need to use a different approach
                # This shouldn't happen in normal workspace usage, but handle it gracefully
                logger.warning(
                    "Already in event loop, using await instead of asyncio.run"
                )
                # Create a task and get the result synchronously (this is a fallback)
                import concurrent.futures

                with concurrent.futures.ThreadPoolExecutor() as executor:
                    future = executor.submit(
                        asyncio.run, self._client.send_event(mod_message)
                    )
                    response = future.result()
            except RuntimeError:
                # No event loop running, safe to use asyncio.run
                response = asyncio.run(self._client.send_event(mod_message))

            logger.debug(f"🔧 WORKSPACE: Sync client send result: {response}")
            return response

        except Exception as e:
            logger.error(f"Failed to send sync mod message: {e}")
            return EventResponse(success=False, message=f"Sync send failed: {str(e)}")

    async def _handle_project_responses(self, message) -> None:
        """Handle project mod responses.

        Args:
            message: The message to handle (Event or Event)
        """
        try:
            logger.info(
                f"🔧 WORKSPACE: _handle_project_responses called with message type: {type(message).__name__}"
            )

            # Handle both Event and Event responses
            content = None
            is_project_response = False

            # Import here to avoid circular imports
            from openagents.models.messages import Event, EventNames

            if (
                isinstance(message, Event)
                and message.relevant_mod == "openagents.mods.project.default"
            ):
                # Event from project mod
                logger.info(f"🔧 WORKSPACE: Received Event from project mod")
                content = message.payload
                is_project_response = True
            elif isinstance(message, Event) and isinstance(message.payload, dict):
                # Event from project mod
                if message.payload.get("mod") == "openagents.mods.project.default":
                    logger.info(f"🔧 WORKSPACE: Received Event from project mod")
                    content = message.payload
                    is_project_response = True

            if not is_project_response or not content:
                return

            action = content.get("action")
            request_id = content.get("request_id")

            logger.info(
                f"🔧 WORKSPACE: Processing response - action={action}, request_id={request_id}"
            )
            logger.info(
                f"🔧 WORKSPACE: Response content keys: {list(content.keys()) if isinstance(content, dict) else 'Not dict'}"
            )

            if not request_id:
                logger.warning(
                    f"🔧 WORKSPACE: No request_id in response content: {content}"
                )
                return

            # Find matching response future
            response_key = None
            logger.info(
                f"🔧 WORKSPACE: Looking for response key containing: {request_id}"
            )
            logger.info(
                f"🔧 WORKSPACE: Available pending responses: {list(self._pending_responses.keys())}"
            )

            for key in self._pending_responses.keys():
                if request_id in key:
                    response_key = key
                    break

            if response_key and response_key in self._pending_responses:
                logger.info(
                    f"🔧 WORKSPACE: Found matching response key: {response_key}"
                )
                future = self._pending_responses[response_key]
                if not future.done():
                    logger.info(f"🔧 WORKSPACE: Setting result for future")
                    future.set_result(content)
                else:
                    logger.warning(f"🔧 WORKSPACE: Future already done")

                # Clean up
                del self._pending_responses[response_key]
            else:
                logger.warning(
                    f"🔧 WORKSPACE: No matching response key found for {request_id}"
                )
        except Exception as e:
            logger.error(f"Error handling project response: {e}")

    async def _ensure_connected(self) -> bool:
        """Ensure the workspace client is connected.

        Returns:
            bool: True if connected successfully, False otherwise
        """
        # Check if client is already connected
        if (
            self._client
            and self._client.connector
            and hasattr(self._client.connector, "connected")
            and self._client.connector.connected
        ):
            self._is_connected = True
            return True

        # Check if client has an active connector (alternative check)
        if self._client and self._client.connector:
            self._is_connected = True
            return True

        if not self._client:
            logger.error("No client available for workspace connection")
            return False

        # If we have auto-connect config, try to connect
        if self._auto_connect_config:
            try:
                host = self._auto_connect_config["host"]
                port = self._auto_connect_config["port"]

                logger.info(
                    f"Auto-connecting workspace client {self._client.agent_id} to {host}:{port}"
                )
                success = await self._client.connect(host, port)

                if success:
                    self._is_connected = True
                    logger.info(
                        f"Workspace client {self._client.agent_id} connected successfully"
                    )
                else:
                    logger.error(
                        f"Failed to connect workspace client {self._client.agent_id}"
                    )

                return success

            except Exception as e:
                logger.error(f"Error during auto-connection: {e}")
                return False
        else:
            # No auto-connect config, but client might already be connected
            # This is typical in test scenarios where the client is connected externally
            logger.debug(
                "No auto-connect configuration available, assuming client is connected"
            )
            if self._client:
                self._is_connected = True
                return True
            return False

    async def channels(self, refresh: bool = False, timeout: float = 5.0) -> List[str]:
        """List all available channels.

        Args:
            refresh: Whether to refresh the channel list from the server
            timeout: Timeout for waiting for response (seconds)

        Returns:
            List of channel names
        """
        # Return cached channels if not refreshing and cache is recent
        if not refresh and self._last_channels_fetch and self._channels_cache:
            cache_age = (datetime.now() - self._last_channels_fetch).total_seconds()
            if cache_age < 30:  # Use cache if less than 30 seconds old
                return list(self._channels_cache.keys())

        # Ensure we're connected to the client
        if not await self._ensure_connected():
            logger.error("Could not establish client connection")
            # Return cached channels as fallback
            return (
                list(self._channels_cache.keys())
                if self._channels_cache
                else DEFAULT_CHANNELS
            )

        try:
            # Generate unique request ID for correlation
            request_id = str(uuid.uuid4())

            # Create mod message to list channels
            mod_message = Event(
                event_name="thread.channel_info",
                source_id=self._client.agent_id,
                relevant_mod=WORKSPACE_MESSAGING_MOD_NAME,
                destination_id=self._client.agent_id,
                payload={
                    "message_type": "channel_info",
                    "sender_id": self._client.agent_id,
                    "action": "list_channels",
                    "request_id": request_id,
                },
            )

            # Define condition to match the response
            def response_condition(msg):
                """Check if this is the response to our request."""
                try:
                    content = msg.payload
                    return (
                        content.get("action") == "list_channels_response"
                        and content.get("request_id") == request_id
                    )
                except (AttributeError, KeyError):
                    return False

            # Start waiting for response before sending request
            wait_task = asyncio.create_task(
                self._client.wait_mod_message(
                    condition=response_condition, timeout=timeout
                )
            )

            # Give the wait task a moment to start
            await asyncio.sleep(0.01)

            # Send request
            success = await self.send_event(mod_message)
            if not success:
                wait_task.cancel()
                logger.error("Failed to send list_channels request")
                # Return cached or default channels as fallback
                return (
                    list(self._channels_cache.keys())
                    if self._channels_cache
                    else DEFAULT_CHANNELS
                )

            # Wait for response
            response = await wait_task

            if response is None:
                logger.warning(
                    f"Timeout waiting for channel list (timeout: {timeout}s)"
                )
                # Return cached or default channels as fallback
                return (
                    list(self._channels_cache.keys())
                    if self._channels_cache
                    else DEFAULT_CHANNELS
                )

            # Extract channels from response
            response_content = response.payload
            channels = response_content.get("channels", DEFAULT_CHANNELS)

            # Update cache
            self._channels_cache.clear()  # Clear old cache
            for channel_name in channels:
                if channel_name not in self._channels_cache:
                    self._channels_cache[channel_name] = ChannelConnection(
                        channel_name, self
                    )

            self._last_channels_fetch = datetime.now()
            logger.debug(f"Retrieved {len(channels)} channels from server")
            return channels

        except asyncio.CancelledError:
            logger.debug("list_channels request cancelled")
            return (
                list(self._channels_cache.keys())
                if self._channels_cache
                else DEFAULT_CHANNELS
            )
        except Exception as e:
            logger.error(f"Failed to list channels: {e}")
            # Return cached or default channels as fallback
            return (
                list(self._channels_cache.keys())
                if self._channels_cache
                else DEFAULT_CHANNELS
            )

    def channel(self, channel_name: str) -> ChannelConnection:
        """Get a specific channel by name.

        Args:
            channel_name: Name of the channel (with or without # prefix)

        Returns:
            ChannelConnection instance
        """
        # Normalize channel name
        channel_name = channel_name.lstrip("#")

        # Return cached channel or create new one
        if channel_name not in self._channels_cache:
            self._channels_cache[channel_name] = ChannelConnection(channel_name, self)

        return self._channels_cache[channel_name]

    async def agents(self, refresh: bool = False) -> List[str]:
        """List all online agents accessible through the client.

        Args:
            refresh: Whether to refresh the agent list from the server

        Returns:
            List of agent IDs
        """
        # Ensure we're connected to the client
        if not await self._ensure_connected():
            logger.error("Could not establish client connection")
            return []

        try:
            # Get agents from the client
            # This would ideally use the client's agent discovery functionality
            # For now, we'll use the client's list_agents method if available
            if hasattr(self._client, "list_agents"):
                agents_info = await self._client.list_agents()
                if agents_info:
                    agent_ids = [
                        agent.get("agent_id", agent.get("id", ""))
                        for agent in agents_info
                        if agent.get("agent_id") or agent.get("id")
                    ]

                    # Update cache
                    for agent_id in agent_ids:
                        if agent_id and agent_id not in self._agents_cache:
                            self._agents_cache[agent_id] = AgentConnection(
                                agent_id, self
                            )

                    self._last_agents_fetch = datetime.now()
                    return agent_ids

            # Fallback: return cached agent IDs or empty list
            return list(self._agents_cache.keys())

        except Exception as e:
            logger.error(f"Failed to list agents: {e}")
            return list(self._agents_cache.keys())  # Return cached agents as fallback

    def agent(self, agent_id: str) -> AgentConnection:
        """Get a connection to a specific agent by ID.

        Args:
            agent_id: ID of the agent to connect to

        Returns:
            AgentConnection instance
        """
        # Return cached agent connection or create new one
        if agent_id not in self._agents_cache:
            self._agents_cache[agent_id] = AgentConnection(agent_id, self)

        return self._agents_cache[agent_id]

    async def create_channel(
        self, channel_name: str, description: str = ""
    ) -> ChannelConnection:
        """Create a new channel.

        Args:
            channel_name: Name for the new channel
            description: Optional description for the channel

        Returns:
            ChannelConnection instance for the created channel
        """
        # Normalize channel name
        if not channel_name.startswith("#"):
            channel_name = f"#{channel_name}"

        # Ensure we're connected to the client
        if not await self._ensure_connected():
            logger.error("Could not establish client connection")
            return self.channel(channel_name)  # Return channel object anyway

        try:
            # Note: Channel creation is not supported by the thread messaging mod
            # We'll just create the channel object locally
            logger.info(f"Creating local channel object for {channel_name}")

            # Create and cache channel
            channel = ChannelConnection(channel_name, self)
            self._channels_cache[channel_name] = channel

            return channel

        except Exception as e:
            logger.error(f"Failed to create channel {channel_name}: {e}")
            # Return channel object anyway - it might exist or be created later
            return self.channel(channel_name)

    def get_client(self) -> Optional[AgentClient]:
        """Get the underlying client instance.

        Returns:
            AgentClient instance or None if not available
        """
        return self._client

    # Events property removed - use client events instead
    # @property
    # def events(self) -> 'WorkspaceEvents':
    #     """DEPRECATED: Events are now handled by the client. Use client events instead."""
    #     raise AttributeError("workspace.events is deprecated. Use client events instead.")

    async def start_project(self, project, timeout: float = 10.0) -> Dict[str, Any]:
        """Start a new project with project-based collaboration.

        Args:
            project: Project instance with goal, name, and configuration
            timeout: Timeout for waiting for response (seconds)

        Returns:
            Dict containing project creation result with project_id, channel_name, etc.

        Raises:
            RuntimeError: If project mod is not enabled
        """
        # Import here to avoid circular imports
        from openagents.workspace import Project

        # Ensure we're connected to the client
        if not await self._ensure_connected():
            raise RuntimeError("Could not establish client connection")

        # Validate project parameter
        if not isinstance(project, Project):
            raise ValueError("project must be an instance of Project class")

        try:
            # Generate unique request ID for correlation
            request_id = str(uuid.uuid4())

            # Create mod message to start project
            mod_message = Event(
                event_name="project.create",
                source_id=self._client.agent_id,
                destination_id=self._client.agent_id,
                relevant_mod="openagents.mods.project.default",
                payload={
                    "action": "project_creation",
                    "message_type": "project_creation",
                    "sender_id": self._client.agent_id,
                    "project_id": project.project_id,
                    "project_name": project.name,
                    "project_goal": project.goal,
                    "config": project.config,
                    "request_id": request_id,
                    "message_id": request_id,  # Add required message_id
                    "timestamp": int(time.time()),  # Add required timestamp
                },
            )

            # Set up response waiting
            response_future = asyncio.Future()
            response_key = f"project_creation_response_{request_id}"

            # Store future for response correlation
            self._pending_responses[response_key] = response_future

            # Send the message
            success = await self.send_event(mod_message)

            # Wait for response with timeout
            try:
                response_content = await asyncio.wait_for(
                    response_future, timeout=timeout
                )

                if response_content.get("success"):
                    logger.info(f"Successfully started project {project.project_id}")
                    return {
                        "success": True,
                        "project_id": project.project_id,
                        "project_name": response_content.get("project_name"),
                        "channel_name": response_content.get("channel_name"),
                        "service_agents": response_content.get("service_agents", []),
                    }
                else:
                    error = response_content.get("error", "Unknown error")
                    logger.error(f"Failed to start project: {error}")
                    return {"success": False, "error": error}

            except asyncio.TimeoutError:
                logger.error(f"Timeout waiting for project creation response")
                return {"success": False, "error": "Timeout waiting for response"}

        except Exception as e:
            logger.error(f"Error starting project: {e}")
            return {"success": False, "error": str(e)}
        finally:
            # Clean up response future
            self._pending_responses.pop(response_key, None)

    async def get_project_status(
        self, project_id: str, timeout: float = 10.0
    ) -> Dict[str, Any]:
        """Get the status of a project.

        Args:
            project_id: ID of the project to get status for
            timeout: Timeout for waiting for response (seconds)

        Returns:
            Dict containing project status and details
        """
        # Ensure we're connected to the client
        if not await self._ensure_connected():
            raise RuntimeError("Could not establish client connection")

        try:
            # Generate unique request ID for correlation
            request_id = str(uuid.uuid4())

            # Create mod message to get project status
            mod_message = Event(
                event_name="project.status",
                source_id=self._client.agent_id,
                relevant_mod="openagents.mods.project.default",
                destination_id=self._client.agent_id,
                payload={
                    "message_type": "project_status",
                    "sender_id": self._client.agent_id,
                    "project_id": project_id,
                    "action": "get_status",
                    "request_id": request_id,
                    "message_id": request_id,  # Add required message_id
                    "timestamp": int(time.time()),  # Add required timestamp
                },
            )

            # Set up response waiting
            response_future = asyncio.Future()
            response_key = f"project_status_response_{request_id}"

            # Store future for response correlation
            self._pending_responses[response_key] = response_future

            # Send the message
            success = await self.send_event(mod_message)

            # Wait for response with timeout
            try:
                response_content = await asyncio.wait_for(
                    response_future, timeout=timeout
                )

                if response_content.get("success"):
                    return {
                        "success": True,
                        "project_id": project_id,
                        "status": response_content.get("status"),
                        "project_data": response_content.get("project_data", {}),
                    }
                else:
                    error = response_content.get("error", "Unknown error")
                    return {"success": False, "error": error}

            except asyncio.TimeoutError:
                logger.error(f"Timeout waiting for project status response")
                return {"success": False, "error": "Timeout waiting for response"}

        except Exception as e:
            logger.error(f"Error getting project status: {e}")
            return {"success": False, "error": str(e)}
        finally:
            # Clean up response future
            self._pending_responses.pop(response_key, None)

    async def list_projects(
        self, filter_status: Optional[str] = None, timeout: float = 10.0
    ) -> Dict[str, Any]:
        """List all projects associated with this workspace.

        Args:
            filter_status: Optional status filter (created, running, completed, failed, stopped, paused)
            timeout: Timeout for waiting for response (seconds)

        Returns:
            Dict containing list of projects
        """
        # Ensure we're connected to the client
        if not await self._ensure_connected():
            raise RuntimeError("Could not establish client connection")

        try:
            # Generate unique request ID for correlation
            request_id = str(uuid.uuid4())

            # Create mod message to list projects
            mod_message = Event(
                event_name="project.list",
                source_id=self._client.agent_id,
                relevant_mod="openagents.mods.project.default",
                destination_id=self._client.agent_id,
                payload={
                    "message_type": "project_list",
                    "sender_id": self._client.agent_id,
                    "action": "list_projects",
                    "filter_status": filter_status,
                    "request_id": request_id,
                    "message_id": request_id,  # Add required message_id
                    "timestamp": int(time.time()),  # Add required timestamp
                },
            )

            # Set up response waiting
            response_future = asyncio.Future()
            response_key = f"project_list_response_{request_id}"

            # Store future for response correlation
            self._pending_responses[response_key] = response_future

            # Send the message
            success = await self.send_event(mod_message)

            # Wait for response with timeout
            try:
                response_content = await asyncio.wait_for(
                    response_future, timeout=timeout
                )

                if response_content.get("success"):
                    return {
                        "success": True,
                        "projects": response_content.get("projects", []),
                        "total_count": response_content.get("total_count", 0),
                    }
                else:
                    error = response_content.get("error", "Unknown error")
                    return {"success": False, "error": error}

            except asyncio.TimeoutError:
                logger.error(f"Timeout waiting for project list response")
                return {"success": False, "error": "Timeout waiting for response"}

        except Exception as e:
            logger.error(f"Error listing projects: {e}")
            return {"success": False, "error": str(e)}
        finally:
            # Clean up response future
            self._pending_responses.pop(response_key, None)

    def __str__(self) -> str:
        client_id = self._client.agent_id if self._client else "None"
        return f"Workspace(client={client_id})"

    def __repr__(self) -> str:
        client_id = self._client.agent_id if self._client else "None"
        return f"Workspace(client_id='{client_id}', channels_cached={len(self._channels_cache)})"
