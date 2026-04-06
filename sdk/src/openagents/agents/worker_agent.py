"""
WorkerAgent - A simplified, event-driven agent interface for thread messaging.

This module provides a high-level, convenient interface for creating agents that
work with the thread messaging system. It abstracts away the complexity of message
routing and provides intuitive handler methods.
"""

import logging
import re
import asyncio
import inspect
from abc import abstractmethod
from typing import Dict, List, Optional, Any, Callable, Union

from openagents.agents.collaborator_agent import CollaboratorAgent
from openagents.core.workspace import Workspace
from openagents.models.event_thread import EventThread
from openagents.models.event import Event
from openagents.models.event_response import EventResponse
from openagents.models.messages import EventNames
from openagents.models.event_context import (
    EventContext,
    ChannelMessageContext,
    ReplyMessageContext,
    ReactionContext,
    FileContext,
)
from openagents.config.globals import DEFAULT_TRANSPORT_ADDRESS
from openagents.mods.workspace.messaging.thread_messages import (
    Event as ThreadEvent,
    ChannelMessage,
    ReplyMessage,
    FileUploadMessage,
    ReactionMessage,
)

# Project-related imports (optional, only used if project mod is available)
try:
    from openagents.workspace.project import Project
    from openagents.workspace.project_messages import (
        ProjectCreationMessage,
        ProjectStatusMessage,
        ProjectNotificationMessage,
    )

    # Use new unified event system
    from openagents.models.event import Event
    from openagents.models.event_response import EventResponse
    from openagents.models.messages import EventNames

    PROJECT_IMPORTS_AVAILABLE = True
except ImportError:
    PROJECT_IMPORTS_AVAILABLE = False

logger = logging.getLogger(__name__)


def on_event(pattern: str):
    """
    Decorator for defining event handlers in WorkerAgent subclasses.

    This decorator allows you to define custom event handlers that will be called
    when events matching the specified pattern are received.

    Args:
        pattern: Event name pattern to match. Supports wildcards with '*'.
                Examples: "myplugin.message.received", "project.*", "thread.channel_message.*"

    Example:
        class MyAgent(WorkerAgent):
            @on_event("myplugin.message.received")
            async def handle_plugin_message(self, context: EventContext):
                print(f"Got plugin message: {context.payload}")

            @on_event("project.*")
            async def handle_any_project_event(self, context: EventContext):
                print(f"Project event: {context.incoming_event.event_name}")

    Note:
        - The decorated function must be async
        - The function should accept (self, context: EventContext) as parameters
        - Multiple handlers can be defined for the same pattern
        - Handlers are executed before built-in WorkerAgent handlers
    """

    def decorator(func: Callable):
        # Validate that the function is async
        if not asyncio.iscoroutinefunction(func):
            raise ValueError(
                f"@on_event decorated function '{func.__name__}' must be async"
            )

        # Validate function signature
        sig = inspect.signature(func)
        params = list(sig.parameters.keys())
        if len(params) < 2 or params[0] != "self":
            raise ValueError(
                f"@on_event decorated function '{func.__name__}' must have signature (self, context: EventContext)"
            )

        # Store the event pattern on the function for later collection
        func._event_pattern = pattern
        return func

    return decorator


class WorkerAgent(CollaboratorAgent):
    """
    A simplified, event-driven agent interface for OpenAgents workspace.

    This class provides convenient handler methods for different types of messages
    and hides the complexity of the underlying messaging system.

    Example:
        class EchoAgent(WorkerAgent):
            default_agent_id = "echo"

            async def on_direct(self, msg):
                response = await self.send_direct(to=msg.source_id, text=f"Echo: {msg.text}")
                if not response.success:
                    logger.error(f"Failed to send echo: {response.message}")
    """

    # Class attributes that can be overridden
    default_agent_id: str = None
    ignore_own_messages: bool = True

    # Project-related configuration (only effective when project mod is enabled)
    auto_join_projects: bool = False
    project_keywords: List[str] = []  # Auto-join projects matching these keywords
    max_concurrent_projects: int = 3
    project_completion_timeout: int = 3600  # 1 hour

    def __init__(self, agent_id: Optional[str] = None, **kwargs):
        """Initialize the WorkerAgent.

        Args:
            agent_id: Optional agent ID. If not provided, uses the class name.
            **kwargs: Additional arguments passed to AgentRunner.
        """
        if agent_id is None:
            if hasattr(self, "default_agent_id") and self.default_agent_id is not None:
                agent_id = self.default_agent_id
            else:
                agent_id = getattr(self, "name", self.__class__.__name__.lower())

        super().__init__(agent_id=agent_id, **kwargs)

        # Internal state
        self._scheduled_tasks: List[asyncio.Task] = []

        # Event handler storage for @on decorated methods
        self._event_handlers: List[tuple[str, Callable]] = (
            []
        )  # List of (pattern, handler) tuples

        self._workspace_client = None

        # Collect @on decorated event handlers
        self._collect_event_handlers()

        logger.info(
            f"Initialized WorkerAgent '{self.default_agent_id}' with ID: {agent_id}"
        )

    def workspace(self) -> Workspace:
        """Get the workspace client."""
        if self._workspace_client is None:
            self._workspace_client = self.client.workspace()

        # Only set auto-connect config if not already configured and if we have connection info
        if not self._workspace_client._auto_connect_config:
            if hasattr(self.client, "connector") and self.client.connector:
                # Use the current agent's connection info
                connector = self.client.connector
                if hasattr(connector, "host") and hasattr(connector, "port"):
                    self._workspace_client._auto_connect_config = {
                        "host": connector.host,
                        "port": connector.port,
                    }
                else:
                    # Default fallback
                    self._workspace_client._auto_connect_config = {
                        "host": "localhost",
                        "port": DEFAULT_TRANSPORT_ADDRESS["http"]["port"],
                    }
            else:
                # Default fallback
                self._workspace_client._auto_connect_config = {
                    "host": "localhost",
                    "port": DEFAULT_TRANSPORT_ADDRESS["http"]["port"],
                }

        return self._workspace_client

    def _collect_event_handlers(self):
        """
        Collect all @on decorated methods from this class and its parent classes.

        This method scans the class hierarchy for methods with the _event_pattern
        attribute (set by the @on_event decorator) and stores them for later event routing.
        """
        self._event_handlers.clear()

        # Track unique methods to avoid duplicates from inheritance
        seen_methods = set()

        # Get all methods from this class and parent classes
        for cls in self.__class__.__mro__:
            for method_name in dir(cls):
                method = getattr(self, method_name, None)
                if method is None or not callable(method):
                    continue

                # Check if this method has the _event_pattern attribute (set by @on decorator)
                if hasattr(method, "_event_pattern"):
                    # Use function name + pattern to avoid duplicates from inheritance
                    # This ensures we only register each unique method once per pattern
                    method_key = f"{method_name}:{method._event_pattern}"
                    if method_key in seen_methods:
                        logger.debug(
                            f"Skipping duplicate event handler: {method_name} for pattern '{method._event_pattern}'"
                        )
                        continue

                    seen_methods.add(method_key)
                    pattern = method._event_pattern
                    self._event_handlers.append((pattern, method))
                    logger.debug(
                        f"Collected event handler for pattern '{pattern}': {method_name}"
                    )

        if self._event_handlers:
            patterns = [pattern for pattern, _ in self._event_handlers]
            logger.info(
                f"WorkerAgent '{self.default_agent_id}' collected {len(self._event_handlers)} event handlers for patterns: {patterns}"
            )

    async def _execute_custom_event_handlers(self, context: EventContext) -> bool:
        """
        Execute custom @on decorated event handlers that match the given event.

        Args:
            context: The event context to handle

        Returns:
            True if at least one custom handler was executed, False otherwise
        """
        handlers_executed = 0

        for pattern, handler in self._event_handlers:
            try:
                # Use the Event's matches_pattern method to check if pattern matches
                if context.incoming_event.matches_pattern(pattern):
                    logger.debug(
                        f"Executing custom handler for pattern '{pattern}': {handler.__name__}"
                    )
                    await handler(context)
                    handlers_executed += 1

            except Exception as e:
                logger.error(
                    f"Error executing custom event handler {handler.__name__} for pattern '{pattern}': {e}"
                )
                # Continue executing other handlers even if one fails

        if handlers_executed > 0:
            logger.debug(
                f"Executed {handlers_executed} custom event handlers for event '{context.incoming_event.event_name}'"
            )

        return handlers_executed > 0

    async def setup(self):
        """Setup the WorkerAgent with thread messaging."""
        await super().setup()

        logger.info(f"Setting up WorkerAgent '{self.default_agent_id}'")

        # Find thread messaging adapter using multiple possible keys
        thread_adapter = None
        for key in [
            "ThreadMessagingAgentAdapter",
            "thread_messaging",
            "openagents.mods.workspace.messaging",
        ]:
            thread_adapter = self.get_mod_adapter(key)
            if thread_adapter:
                logger.info(f"Found thread messaging adapter with key: {key}")
                break

        # Store reference for later use (needed for workspace integration)
        self._thread_adapter = thread_adapter

        # Thread messaging mod events are now handled through the event system
        logger.info("Thread messaging events will be handled through the event system")

        # Call user-defined startup hook
        await self.on_startup()

        logger.info(f"WorkerAgent '{self.default_agent_id}' setup complete")

    async def teardown(self):
        """Teardown the WorkerAgent."""
        logger.info(f"Tearing down WorkerAgent '{self.default_agent_id}'")

        # Cancel scheduled tasks
        for task in self._scheduled_tasks:
            if not task.done():
                task.cancel()

        # Call user-defined shutdown hook
        await self.on_shutdown()

        await super().teardown()

    async def react(self, context: EventContext):
        """Route incoming messages to appropriate handlers."""
        # Skip our own messages if configured to do so
        if (
            self.ignore_own_messages
            and context.incoming_event.source_id == self.client.agent_id
        ):
            return

        logger.debug(
            f"WorkerAgent '{self.default_agent_id}' processing event: {context.incoming_event.event_name} from {context.incoming_event.source_id}"
        )

        # Execute custom @on decorated event handlers
        handler_executed = await self._execute_custom_event_handlers(context)
        if handler_executed:
            return

        # Call parent react for any remaining handling
        await super().react(context)

    @on_event("agent.message")
    async def _handle_raw_direct_message(self, context: EventContext):
        """Handle direct messages."""
        # Create specific context for direct messages with additional fields
        direct_context = ChannelMessageContext(
            incoming_event=context.incoming_event,
            event_threads=context.event_threads,
            incoming_thread_id=context.incoming_thread_id,
            channel="direct",  # Special channel for direct messages
            mentioned_agent_id=context.incoming_event.destination_id,
            quoted_message_id=getattr(
                context.incoming_event, "quoted_message_id", None
            ),
            quoted_text=getattr(context.incoming_event, "quoted_text", None),
        )

        await self.on_direct(context)

    async def _handle_broadcast_message(self, context: EventContext):
        """Handle broadcast messages (treat as channel messages to 'general')."""
        # Convert broadcast to channel message context
        channel_context = ChannelMessageContext(
            incoming_event=context.incoming_event,
            event_threads=context.event_threads,
            incoming_thread_id=context.incoming_thread_id,
            channel="general",  # Default channel for broadcasts
        )

        # Check if we're mentioned
        if self.is_mentioned(channel_context.text):
            await self.on_channel_mention(channel_context)
        else:
            await self.on_channel_post(channel_context)
    
    @on_event("thread.reply.notification")
    async def _handle_channel_post_notification(self, context: EventContext):
        """Handle channel post notifications."""
        reply_context = ReplyMessageContext(
            incoming_event=context.incoming_event,
            event_threads=context.event_threads,
            incoming_thread_id=context.incoming_thread_id,
            reply_to_id=context.incoming_event.payload.get("reply_to_id"),
            target_agent_id=context.incoming_event.payload.get("target_agent_id"),
            channel=context.incoming_event.payload.get("channel"),
        )
        await self.on_channel_reply(reply_context)

    @on_event("thread.channel_message.notification")
    async def _handle_channel_notification(self, context: EventContext):
        """Handle channel message notifications."""
        message = context.incoming_event
        channel_msg_data = message.payload
        channel = message.payload.get("channel", "")

        # Extract message details
        msg_content = channel_msg_data.get("content", {})
        sender_id = channel_msg_data.get("sender_id", "")
        message_id = channel_msg_data.get("message_id", "")
        timestamp = channel_msg_data.get("timestamp", 0)
        message_type = channel_msg_data.get("message_type", "")

        # Skip our own messages
        if self.ignore_own_messages and sender_id == self.client.agent_id:
            return
        # Check if this is a reply message (either explicit reply_message type or channel_message with reply_to_id)
        reply_to_id = channel_msg_data.get("reply_to_id")

        if message_type == "reply_message" or (
            message_type == "channel_message" and reply_to_id
        ):
            reply_context = ReplyMessageContext(
                incoming_event=message,
                event_threads=context.event_threads,
                incoming_thread_id=context.incoming_thread_id,
                reply_to_id=reply_to_id or "",
                target_agent_id=channel_msg_data.get("target_agent_id"),
                channel=channel,
                thread_level=channel_msg_data.get("thread_level", 1),
            )

            await self.on_channel_reply(reply_context)

        elif message_type == "channel_message":
            channel_context = ChannelMessageContext(
                incoming_event=message,
                event_threads=context.event_threads,
                incoming_thread_id=context.incoming_thread_id,
                channel=channel,
                mentioned_agent_id=channel_msg_data.get("mentioned_agent_id"),
            )

            # Check if we're mentioned
            if (
                channel_context.mentioned_agent_id == self.client.agent_id
                or self.is_mentioned(channel_context.text)
            ):
                await self.on_channel_mention(channel_context)
            else:
                await self.on_channel_post(channel_context)

    @on_event("thread.reaction.notification")
    async def _handle_reaction_notification(self, context: EventContext):
        """Handle reaction notifications."""
        message = context.incoming_event
        reaction_data = message.payload.get("reaction", {})

        reaction_context = ReactionContext(
            message_id=message.event_id,
            target_message_id=reaction_data.get("target_message_id", ""),
            reactor_id=reaction_data.get("sender_id", ""),
            reaction_type=reaction_data.get("reaction_type", ""),
            action=reaction_data.get("action", "add"),
            timestamp=message.timestamp,
            raw_message=message,
        )

        await self.on_reaction(reaction_context)

    @on_event("thread.file.upload_response")
    @on_event("thread.file.download_response")
    async def _handle_file_notification(self, context: EventContext):
        """Handle file upload notifications."""
        message = context.incoming_event
        file_data = message.payload.get("file", {})

        file_context = FileContext(
            message_id=message.event_id,
            source_id=message.source_id,
            filename=file_data.get("filename", ""),
            file_content=file_data.get("file_content", ""),
            mime_type=file_data.get("mime_type", "application/octet-stream"),
            file_size=file_data.get("file_size", 0),
            timestamp=message.timestamp,
            raw_message=message,
        )

        await self.on_file_received(file_context)

    @on_event("thread.direct_message.notification")
    async def _handle_direct_message_notification(self, context: EventContext):
        """Handle direct message notifications."""
        logger.info(
            f"🔧 WORKER_AGENT: Calling on_direct with source={context.incoming_event.source_id}"
        )
        await self.on_direct(context)


    async def _handle_thread_event(self, message: Event):
        """Handle other thread events."""
        logger.debug(f"Generic thread event: {message.event_name}")

    # Abstract handler methods that users should override
    async def on_direct(self, context: EventContext):
        """Handle direct messages. Override this method."""
        pass

    async def on_channel_post(self, context: ChannelMessageContext):
        """Handle new channel posts. Override this method."""
        pass

    async def on_channel_reply(self, context: ReplyMessageContext):
        """Handle replies in channels. Override this method."""
        pass

    async def on_channel_mention(self, context: ChannelMessageContext):
        """Handle when agent is mentioned in channels. Override this method."""
        pass

    async def on_reaction(self, context: ReactionContext):
        """Handle reactions to messages. Override this method."""
        pass

    async def on_file_received(self, context: FileContext):
        """Handle file uploads. Override this method."""
        pass

    async def on_startup(self):
        """Called after successful connection and setup. Override this method."""
        pass

    async def on_shutdown(self):
        """Called before disconnection. Override this method."""
        pass

    # Convenience methods for messaging (with EventResponse integration)
    async def send_direct(
        self, to: str, text: str = None, content: Dict[str, Any] = None, **kwargs
    ) -> EventResponse:
        """Send a direct message to another agent.

        Args:
            to: Target agent ID
            text: Text content to send
            content: Dict content to send (alternative to text)
            **kwargs: Additional parameters

        Returns:
            EventResponse: Response from the event system
        """
        if text is not None:
            message_content = {"text": text}
        elif content is not None:
            message_content = content
        else:
            message_content = {"text": ""}

        agent_connection = self.workspace().agent(to)
        return await agent_connection.send(message_content, **kwargs)

    async def post_to_channel(
        self, channel: str, text: str = None, content: Dict[str, Any] = None, **kwargs
    ) -> EventResponse:
        """Post a message to a channel.

        Args:
            channel: Channel name (with or without #)
            text: Text content to send
            content: Dict content to send (alternative to text)
            **kwargs: Additional parameters

        Returns:
            EventResponse: Response from the event system
        """
        if text is not None:
            message_content = {"text": text}
        elif content is not None:
            message_content = content
        else:
            message_content = {"text": ""}

        channel_connection = self.workspace().channel(channel)
        return await channel_connection.post(message_content, **kwargs)

    async def reply_to_message(
        self,
        channel: str,
        message_id: str,
        text: str = None,
        content: Dict[str, Any] = None,
        **kwargs,
    ) -> EventResponse:
        """Reply to a message in a channel.

        Args:
            channel: Channel name (with or without #)
            message_id: ID of the message to reply to
            text: Text content to send
            content: Dict content to send (alternative to text)
            **kwargs: Additional parameters

        Returns:
            EventResponse: Response from the event system
        """
        if text is not None:
            message_content = {"text": text}
        elif content is not None:
            message_content = content
        else:
            message_content = {"text": ""}

        channel_connection = self.workspace().channel(channel)
        return await channel_connection.reply_to_message(
            message_id, message_content, **kwargs
        )

    async def react_to_message(
        self, channel: str, message_id: str, reaction: str, action: str = "add"
    ) -> EventResponse:
        """React to a message in a channel.

        Args:
            channel: Channel name (with or without #)
            message_id: ID of the message to react to
            reaction: Reaction emoji or text
            action: "add" or "remove"

        Returns:
            EventResponse: Response from the event system
        """
        channel_connection = self.workspace().channel(channel)
        return await channel_connection.react_to_message(message_id, reaction, action)

    async def get_channel_messages(
        self, channel: str, limit: int = 50, offset: int = 0
    ) -> Dict[str, Any]:
        """Get messages from a channel.

        Args:
            channel: Channel name (with or without #)
            limit: Maximum number of messages to retrieve
            offset: Offset for pagination

        Returns:
            Dict with messages and metadata
        """
        # Send request via mod messaging
        if not hasattr(self, "_thread_adapter") or not self._thread_adapter:
            return {"messages": [], "total_count": 0, "has_more": False}

        # Create future for async response
        future_key = f"get_channel_messages:{channel}"
        future = asyncio.Future()
        self._pending_history_requests[future_key] = future

        # Send request
        try:
            await self._thread_adapter.request_channel_messages(
                channel=channel.lstrip("#"), limit=limit, offset=offset
            )

            # Wait for response
            result = await asyncio.wait_for(future, timeout=10.0)
            return result
        except asyncio.TimeoutError:
            self._pending_history_requests.pop(future_key, None)
            logger.error(f"Timeout waiting for channel messages from {channel}")
            return {"messages": [], "total_count": 0, "has_more": False}
        except Exception as e:
            self._pending_history_requests.pop(future_key, None)
            logger.error(f"Error getting channel messages from {channel}: {e}")
            return {"messages": [], "total_count": 0, "has_more": False}

    async def get_direct_messages(
        self, with_agent: str, limit: int = 50, offset: int = 0
    ) -> Dict[str, Any]:
        """Get direct messages with an agent.

        Args:
            with_agent: Agent ID to get messages with
            limit: Maximum number of messages to retrieve
            offset: Offset for pagination

        Returns:
            Dict with messages and metadata
        """
        # Send request via mod messaging
        if not hasattr(self, "_thread_adapter") or not self._thread_adapter:
            return {"messages": [], "total_count": 0, "has_more": False}

        # Create future for async response
        future_key = f"get_direct_messages:{with_agent}"
        future = asyncio.Future()
        self._pending_history_requests[future_key] = future

        # Send request
        try:
            await self._thread_adapter.request_direct_messages(
                target_agent_id=with_agent, limit=limit, offset=offset
            )

            # Wait for response
            result = await asyncio.wait_for(future, timeout=10.0)
            return result
        except asyncio.TimeoutError:
            self._pending_history_requests.pop(future_key, None)
            logger.error(f"Timeout waiting for direct messages with {with_agent}")
            return {"messages": [], "total_count": 0, "has_more": False}
        except Exception as e:
            self._pending_history_requests.pop(future_key, None)
            logger.error(f"Error getting direct messages with {with_agent}: {e}")
            return {"messages": [], "total_count": 0, "has_more": False}

    async def upload_file(
        self, channel: str, file_path: str, filename: str = None
    ) -> Optional[str]:
        """Upload a file to a channel.

        Args:
            channel: Channel name (with or without #)
            file_path: Path to the file to upload
            filename: Optional custom filename

        Returns:
            File UUID if successful, None if failed
        """
        channel_connection = self.workspace().channel(channel)
        return await channel_connection.upload_file(file_path, filename)

    async def get_channel_list(self) -> List[str]:
        """Get list of available channels.

        Returns:
            List of channel names
        """
        return await self.workspace().channels()

    async def get_agent_list(self) -> List[str]:
        """Get list of connected agents.

        Returns:
            List of agent IDs
        """
        return await self.workspace().agents()

    def is_mentioned(self, text: str) -> bool:
        """Check if this agent is mentioned in the text."""
        mention_pattern = rf"@{re.escape(self.client.agent_id)}\b"
        return bool(re.search(mention_pattern, text))

    def extract_mentions(self, text: str) -> List[str]:
        """Extract all mentioned agent IDs from text."""
        mention_pattern = r"@([a-zA-Z0-9_-]+)"
        return re.findall(mention_pattern, text)

    async def schedule_task(self, delay: float, coro: Callable):
        """Schedule a delayed task.

        Args:
            delay: Delay in seconds
            coro: Coroutine to execute after delay
        """

        async def delayed_task():
            await asyncio.sleep(delay)
            await coro()

        task = asyncio.create_task(delayed_task())
        self._scheduled_tasks.append(task)
        return task

    # Convenience methods for message history
    async def get_recent_channel_messages(
        self, channel: str, count: int = 10
    ) -> List[Dict[str, Any]]:
        """Get recent messages from a channel.

        Args:
            channel: Channel name
            count: Number of recent messages to get

        Returns:
            List of recent message dictionaries, newest first
        """
        try:
            result = await self.get_channel_messages(channel, limit=count, offset=0)
            messages = result.get("messages", [])
            # Sort by timestamp, newest first
            return sorted(messages, key=lambda m: m.get("timestamp", 0), reverse=True)
        except Exception as e:
            logger.error(f"Failed to get recent channel messages from {channel}: {e}")
            return []

    async def get_recent_direct_messages(
        self, with_agent: str, count: int = 10
    ) -> List[Dict[str, Any]]:
        """Get recent direct messages with an agent.

        Args:
            with_agent: Agent ID to get conversation with
            count: Number of recent messages to get

        Returns:
            List of recent message dictionaries, newest first
        """
        try:
            result = await self.get_direct_messages(with_agent, limit=count, offset=0)
            messages = result.get("messages", [])
            # Sort by timestamp, newest first
            return sorted(messages, key=lambda m: m.get("timestamp", 0), reverse=True)
        except Exception as e:
            logger.error(f"Failed to get recent direct messages with {with_agent}: {e}")
            return []

    async def find_messages_by_sender(
        self, channel_or_agent: str, sender_id: str, limit: int = 50
    ) -> List[Dict[str, Any]]:
        """Find messages from a specific sender in a channel or direct conversation.

        Args:
            channel_or_agent: Channel name (with #) or agent ID for direct messages
            sender_id: ID of the sender to find messages from
            limit: Maximum number of messages to search through

        Returns:
            List of messages from the specified sender
        """
        try:
            if channel_or_agent.startswith("#"):
                # Channel messages
                result = await self.get_channel_messages(channel_or_agent, limit=limit)
            else:
                # Direct messages
                result = await self.get_direct_messages(channel_or_agent, limit=limit)

            messages = result.get("messages", [])
            return [msg for msg in messages if msg.get("sender_id") == sender_id]
        except Exception as e:
            logger.error(f"Failed to find messages by sender {sender_id}: {e}")
            return []

    def get_cached_messages(self, channel_or_agent: str) -> List[Dict[str, Any]]:
        """Get cached messages without making a network request.

        Args:
            channel_or_agent: Channel name (with #) or agent ID for direct messages

        Returns:
            List of cached message dictionaries, or empty list if not cached
        """
        if channel_or_agent.startswith("#"):
            cache_key = f"channel:{channel_or_agent}"
        else:
            cache_key = f"direct:{channel_or_agent}"

        return self._message_history_cache.get(cache_key, [])
