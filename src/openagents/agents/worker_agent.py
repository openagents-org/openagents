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

from openagents.agents.runner import AgentRunner
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
    ProjectEventContext,
    ProjectCompletedContext,
    ProjectFailedContext,
    ProjectMessageContext,
    ProjectInputContext,
    ProjectNotificationContext,
    ProjectAgentContext
)
from openagents.config.globals import DEFAULT_TRANSPORT_ADDRESS
from openagents.mods.workspace.messaging.thread_messages import (
    Event as ThreadEvent,
    ChannelMessage,
    ReplyMessage,
    FileUploadMessage,
    ReactionMessage
)

# Project-related imports (optional, only used if project mod is available)
try:
    from openagents.workspace.project import Project
    from openagents.workspace.project_messages import (
        ProjectCreationMessage,
        ProjectStatusMessage,
        ProjectNotificationMessage
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
            raise ValueError(f"@on_event decorated function '{func.__name__}' must be async")
        
        # Validate function signature
        sig = inspect.signature(func)
        params = list(sig.parameters.keys())
        if len(params) < 2 or params[0] != 'self':
            raise ValueError(f"@on_event decorated function '{func.__name__}' must have signature (self, context: EventContext)")
        
        # Store the event pattern on the function for later collection
        func._event_pattern = pattern
        return func
    
    return decorator


class WorkerAgent(AgentRunner):
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
    auto_mention_response: bool = True
    ignore_own_messages: bool = True
    default_channels: List[str] = []
    
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
            if hasattr(self, 'default_agent_id') and self.default_agent_id is not None:
                agent_id = self.default_agent_id
            else:
                agent_id = getattr(self, 'name', self.__class__.__name__.lower())
        
        # Always include thread messaging in mod_names
        mod_names = kwargs.get('mod_names', [])
        if 'openagents.mods.workspace.messaging' not in mod_names:
            mod_names.append('openagents.mods.workspace.messaging')
        kwargs['mod_names'] = mod_names
        
        super().__init__(agent_id=agent_id, **kwargs)
        
        # Internal state
        self._command_handlers: Dict[str, Callable] = {}
        self._scheduled_tasks: List[asyncio.Task] = []
        self._message_history_cache: Dict[str, List[Dict[str, Any]]] = {}
        self._pending_history_requests: Dict[str, asyncio.Future] = {}
        
        # Event handler storage for @on decorated methods
        self._event_handlers: List[tuple[str, Callable]] = []  # List of (pattern, handler) tuples
        
        # Project-related state (only used when project mod is available)
        self._active_projects: Dict[str, Dict[str, Any]] = {}
        self._project_channels: Dict[str, str] = {}  # project_id -> channel_name
        self._project_event_subscription = None
        self._project_event_queue = None
        self._workspace_client = None
        self._project_mod_available = False
        
        # Collect @on decorated event handlers
        self._collect_event_handlers()
        
        logger.info(f"Initialized WorkerAgent '{self.default_agent_id}' with ID: {agent_id}")
    
    @property
    def agent_id(self) -> str:
        """Get the agent ID."""
        return self.client.agent_id
    
    def workspace(self) -> Workspace:
        """Get the workspace client."""
        if self._workspace_client is None:
            self._workspace_client = self.client.workspace()
        
        # Only set auto-connect config if not already configured and if we have connection info
        if not self._workspace_client._auto_connect_config:
            if hasattr(self.client, 'connector') and self.client.connector:
                # Use the current agent's connection info
                connector = self.client.connector
                if hasattr(connector, 'host') and hasattr(connector, 'port'):
                    self._workspace_client._auto_connect_config = {
                        'host': connector.host,
                        'port': connector.port
                    }
                else:
                    # Default fallback
                    self._workspace_client._auto_connect_config = {
                        'host': 'localhost',
                        'port': DEFAULT_TRANSPORT_ADDRESS['http']['port']
                    }
            else:
                # Default fallback
                self._workspace_client._auto_connect_config = {
                    'host': 'localhost',
                    'port': DEFAULT_TRANSPORT_ADDRESS['http']['port']
                }
        
        return self._workspace_client

    def _collect_event_handlers(self):
        """
        Collect all @on decorated methods from this class and its parent classes.
        
        This method scans the class hierarchy for methods with the _event_pattern
        attribute (set by the @on_event decorator) and stores them for later event routing.
        """
        self._event_handlers.clear()
        
        # Get all methods from this class and parent classes
        for cls in self.__class__.__mro__:
            for method_name in dir(cls):
                if method_name.startswith('_'):
                    continue
                    
                method = getattr(self, method_name, None)
                if method is None or not callable(method):
                    continue
                
                # Check if this method has the _event_pattern attribute (set by @on decorator)
                if hasattr(method, '_event_pattern'):
                    pattern = method._event_pattern
                    self._event_handlers.append((pattern, method))
                    logger.debug(f"Collected event handler for pattern '{pattern}': {method_name}")
        
        if self._event_handlers:
            patterns = [pattern for pattern, _ in self._event_handlers]
            logger.info(f"WorkerAgent '{self.default_agent_id}' collected {len(self._event_handlers)} event handlers for patterns: {patterns}")

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
                    logger.debug(f"Executing custom handler for pattern '{pattern}': {handler.__name__}")
                    await handler(context)
                    handlers_executed += 1
                    
            except Exception as e:
                logger.error(f"Error executing custom event handler {handler.__name__} for pattern '{pattern}': {e}")
                # Continue executing other handlers even if one fails
        
        if handlers_executed > 0:
            logger.debug(f"Executed {handlers_executed} custom event handlers for event '{context.incoming_event.event_name}'")
        
        return handlers_executed > 0

    async def setup(self):
        """Setup the WorkerAgent with thread messaging."""
        await super().setup()
        
        logger.info(f"Setting up WorkerAgent '{self.default_agent_id}'")
        
        # Find thread messaging adapter using multiple possible keys
        thread_adapter = None
        for key in ["ThreadMessagingAgentAdapter", "thread_messaging", "openagents.mods.workspace.messaging"]:
            thread_adapter = self.get_mod_adapter(key)
            if thread_adapter:
                logger.info(f"Found thread messaging adapter with key: {key}")
                break
        
        if not thread_adapter:
            logger.error("Thread messaging adapter not found with any known key!")
            return
        
        # Store reference for later use (needed for workspace integration)
        self._thread_adapter = thread_adapter
        
        # Thread messaging mod events are now handled through the event system
        logger.info("Thread messaging events will be handled through the event system")
        
        # Setup project functionality if available
        await self._setup_project_functionality()
        
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
        
        # Cleanup project functionality
        await self._cleanup_project_functionality()
        
        # Call user-defined shutdown hook
        await self.on_shutdown()
        
        await super().teardown()

    async def react(self, context: EventContext):
        """Route incoming messages to appropriate handlers."""
        # Skip our own messages if configured to do so
        if self.ignore_own_messages and context.incoming_event.source_id == self.client.agent_id:
            return
        
        logger.debug(f"WorkerAgent '{self.default_agent_id}' processing event: {context.incoming_event.event_name} from {context.incoming_event.source_id}")
        
        # First, execute custom @on decorated event handlers
        await self._execute_custom_event_handlers(context)

        
        # Handle different event types based on event names
        event_name = context.incoming_event.event_name
        
        if event_name == "agent.message":
            await self._handle_raw_direct_message(context)
        elif event_name.startswith("thread.direct_message."):
            await self._handle_thread_direct_message(context)
        elif event_name.startswith("thread.channel_message."):
            await self._handle_thread_channel_message(context)
        elif event_name.startswith("thread.reaction."):
            await self._handle_thread_reaction(context)
        elif event_name.startswith("thread.file."):
            await self._handle_thread_file(context)
        elif event_name.startswith("thread."):
            await self._handle_thread_event(context)
        elif event_name.startswith("system."):
            await self._handle_system_message(context)
        else:
            logger.debug(f"Unhandled event type: {event_name}")


    async def _handle_raw_direct_message(self, context: EventContext):
        """Handle direct messages."""
        # Create specific context for direct messages with additional fields
        direct_context = ChannelMessageContext(
            incoming_event=context.incoming_event,
            event_threads=context.event_threads,
            incoming_thread_id=context.incoming_thread_id,
            channel="direct",  # Special channel for direct messages
            mentioned_agent_id=context.incoming_event.destination_id,
            quoted_message_id=getattr(context.incoming_event, 'quoted_message_id', None),
            quoted_text=getattr(context.incoming_event, 'quoted_text', None)
        )
        
        # Check for command patterns
        if await self._handle_command(direct_context):
            return
        
        await self.on_direct(context)

    async def _handle_broadcast_message(self, context: EventContext):
        """Handle broadcast messages (treat as channel messages to 'general')."""
        # Convert broadcast to channel message context
        channel_context = ChannelMessageContext(
            incoming_event=context.incoming_event,
            event_threads=context.event_threads,
            incoming_thread_id=context.incoming_thread_id,
            channel="general"  # Default channel for broadcasts
        )
        
        # Check if we're mentioned
        if self.is_mentioned(channel_context.text):
            await self.on_channel_mention(channel_context)
        else:
            await self.on_channel_post(channel_context)

    async def _handle_system_message(self, context: EventContext):
        """Handle mod messages from thread messaging."""
        if context.incoming_event.relevant_mod != 'thread_messaging':
            return
        
        # Thread mod messages are now handled through event-specific handlers
        pass

    async def _handle_thread_direct_message(self, context: EventContext):
        """Handle thread direct message events."""
        if context.incoming_event.event_name == "thread.direct_message.notification":
            await self._handle_direct_message_notification(context)
        else:
            logger.debug(f"Unhandled thread direct message event: {context.incoming_event.event_name}")

    async def _handle_thread_channel_message(self, context: EventContext):
        """Handle thread channel message events."""
        if context.incoming_event.event_name == "thread.channel_message.notification":
            await self._handle_channel_notification(context)
        else:
            logger.debug(f"Unhandled thread channel message event: {context.incoming_event.event_name}")

    async def _handle_thread_reaction(self, context: EventContext):
        """Handle thread reaction events."""
        if context.incoming_event.event_name == "thread.reaction.notification":
            await self._handle_reaction_notification(context)
        else:
            logger.debug(f"Unhandled thread reaction event: {context.incoming_event.event_name}")

    async def _handle_thread_file(self, context: EventContext):
        """Handle thread file events."""
        if context.incoming_event.event_name in ["thread.file.upload_response", "thread.file.download_response"]:
            await self._handle_file_notification(context)
        else:
            logger.debug(f"Unhandled thread file event: {context.incoming_event.event_name}")

    async def _handle_thread_event(self, context: EventContext):
        """Handle other thread events."""
        logger.debug(f"Generic thread event: {context.incoming_event.event_name}")

    async def _handle_channel_notification(self, context: EventContext):
        """Handle channel message notifications."""
        message = context.incoming_event
        channel_msg_data = message.payload.get("message", {})
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
        
        if message_type == "reply_message" or (message_type == "channel_message" and reply_to_id):
            reply_context = ReplyMessageContext(
                incoming_event=message,
                event_threads=context.event_threads,
                incoming_thread_id=context.incoming_thread_id,
                reply_to_id=reply_to_id or "",
                target_agent_id=channel_msg_data.get("target_agent_id"),
                channel=channel,
                thread_level=channel_msg_data.get("thread_level", 1)
            )
            
            await self.on_channel_reply(reply_context)
            
        elif message_type == "channel_message":
            channel_context = ChannelMessageContext(
                incoming_event=message,
                event_threads=context.event_threads,
                incoming_thread_id=context.incoming_thread_id,
                channel=channel,
                mentioned_agent_id=channel_msg_data.get("mentioned_agent_id")
            )
            
            # Check if we're mentioned
            if (channel_context.mentioned_agent_id == self.client.agent_id or 
                self.is_mentioned(channel_context.text)):
                await self.on_channel_mention(channel_context)
            else:
                await self.on_channel_post(channel_context)

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
            raw_message=message
        )
        
        await self.on_reaction(reaction_context)

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
            raw_message=message
        )
        
        await self.on_file_received(file_context)

    async def _handle_direct_message_notification(self, context: EventContext):
        """Handle direct message notifications."""
        logger.info(f"🔧 WORKER_AGENT: Handling direct message notification")
        
        message = context.incoming_event
        # Extract message details from the payload
        source_id = message.payload.get("sender_id", "")
        content = message.payload.get("content", {})
        text = message.payload.get("text", "")
        timestamp = message.payload.get("timestamp", 0)
        
        # Create EventContext for the on_direct method
        direct_context = EventContext(
            message_id=message.event_id,
            source_id=source_id,
            timestamp=timestamp,
            payload=content,
            raw_message=message,
            target_agent_id=message.destination_id or ""
        )
        
        logger.info(f"🔧 WORKER_AGENT: Calling on_direct with source={source_id}, text='{direct_context.text}'")
        await self.on_direct(direct_context)

    async def _handle_thread_history_response(self, message: Event):
        """Handle thread history response events."""
        event_name = message.event_name
        data = message.payload
        
        if event_name == "thread.channel_messages.retrieve_response":
            self._process_channel_history_response(data)
        elif event_name == "thread.direct_messages.retrieve_response":
            self._process_direct_history_response(data)
        else:
            logger.debug(f"Unhandled thread history response event: {event_name}")
    
    def _process_channel_history_response(self, data: Dict[str, Any]):
        """Process channel message history response."""
        channel = data.get("channel", "")
        messages = data.get("messages", [])
        
        # Cache the messages
        cache_key = f"channel:{channel}"
        if cache_key not in self._message_history_cache:
            self._message_history_cache[cache_key] = []
        
        # Add new messages to cache (avoid duplicates)
        existing_ids = {msg.get("message_id") for msg in self._message_history_cache[cache_key]}
        new_messages = [msg for msg in messages if msg.get("message_id") not in existing_ids]
        self._message_history_cache[cache_key].extend(new_messages)
        
        # Resolve any pending futures
        future_key = f"get_channel_messages:{channel}"
        if future_key in self._pending_history_requests:
            future = self._pending_history_requests.pop(future_key)
            if not future.done():
                future.set_result({
                    "messages": messages,
                    "total_count": data.get("total_count", 0),
                    "offset": data.get("offset", 0),
                    "limit": data.get("limit", 50),
                    "has_more": data.get("has_more", False)
                })
        
        logger.debug(f"Cached {len(new_messages)} new messages for channel {channel}")
    
    def _process_direct_history_response(self, data: Dict[str, Any]):
        """Process direct message history response."""
        target_agent_id = data.get("target_agent_id", "")
        messages = data.get("messages", [])
        
        # Cache the messages
        cache_key = f"direct:{target_agent_id}"
        if cache_key not in self._message_history_cache:
            self._message_history_cache[cache_key] = []
        
        # Add new messages to cache (avoid duplicates)
        existing_ids = {msg.get("message_id") for msg in self._message_history_cache[cache_key]}
        new_messages = [msg for msg in messages if msg.get("message_id") not in existing_ids]
        self._message_history_cache[cache_key].extend(new_messages)
        
        # Resolve any pending futures
        future_key = f"get_direct_messages:{target_agent_id}"
        if future_key in self._pending_history_requests:
            future = self._pending_history_requests.pop(future_key)
            if not future.done():
                future.set_result({
                    "messages": messages,
                    "total_count": data.get("total_count", 0),
                    "offset": data.get("offset", 0),
                    "limit": data.get("limit", 50),
                    "has_more": data.get("has_more", False)
                })
        
        logger.debug(f"Cached {len(new_messages)} new messages for direct conversation with {target_agent_id}")
    
    def _process_history_error_response(self, data: Dict[str, Any]):
        """Process history retrieval error response."""
        error = data.get("error", "Unknown error")
        request_info = data.get("request_info", {})
        
        # Determine future key based on request_info
        if "channel" in request_info:
            channel = request_info.get("channel", "")
            future_key = f"get_channel_messages:{channel}"
        elif "target_agent_id" in request_info:
            target_agent_id = request_info.get("target_agent_id", "")
            future_key = f"get_direct_messages:{target_agent_id}"
        else:
            logger.warning("Could not determine future key from request_info")
            return
        
        if future_key in self._pending_history_requests:
            future = self._pending_history_requests.pop(future_key)
            if not future.done():
                future.set_exception(Exception(f"History retrieval failed: {error}"))
        
        logger.error(f"Message history retrieval failed: {error}")

    async def _handle_thread_event(self, message: Event):
        """Handle other thread events."""
        logger.debug(f"Generic thread event: {message.event_name}")


    async def _handle_command(self, context: EventContext) -> bool:
        """Handle registered text commands."""
        text = context.text.strip()
        
        # Check for command patterns (e.g., "/help", "!status")
        for command, handler in self._command_handlers.items():
            if text.startswith(command):
                try:
                    await handler(context, text[len(command):].strip())
                    return True
                except Exception as e:
                    logger.error(f"Error in command handler '{command}': {e}")
        
        return False

    # Project functionality methods (only effective when project mod is enabled)
    async def _setup_project_functionality(self):
        """Setup project functionality if the project mod is available."""
        if not PROJECT_IMPORTS_AVAILABLE:
            logger.debug("Project imports not available - skipping project setup")
            return
        
        # Check if project mod is available
        project_adapter = self.get_mod_adapter('project.default')
        if project_adapter:
            self._project_mod_available = True
            logger.info("Project mod detected - enabling project functionality")
            
            # Try to get workspace client for event subscription
            try:
                # Get the network from the client
                workspace = self.workspace()
                if workspace is None:
                    logger.warning("Workspace not available")
                    return
                
                # Subscribe to project events
                await self._setup_project_event_subscription()
                logger.info("Project event subscription setup complete")
            except Exception as e:
                logger.warning(f"Could not setup project event subscription: {e}")
        else:
            logger.debug("Project mod not available - project functionality disabled")

    async def _setup_project_event_subscription(self):
        """Setup subscription to project events."""
        if not self._workspace_client:
            return
        
        try:
            # Subscribe to all project events
            project_events = [
                "project.created",
                "project.started", 
                "project.run.completed",
                "project.run.failed",
                "project.run.requires_input",
                "project.message.received",
                "project.run.notification",
                "project.stopped",
                "project.agent.joined",
                "project.agent.left",
                "project.status.changed"
            ]
            
            # Get network reference from workspace client
            network = getattr(self._workspace_client, '_network', None)
            if network and hasattr(network, 'events'):
                self._project_event_subscription = network.events.subscribe(
                    self.client.agent_id,
                    ["project.*"]  # Use pattern matching for all project events
                )
                # Also create an event queue for polling
                network.events.register_agent(self.client.agent_id)
                logger.info("Network event subscription and queue created for project events")
            else:
                logger.warning("Network events not available - project events disabled")
            
            # Start event processing task
            event_task = asyncio.create_task(self._process_project_events())
            self._scheduled_tasks.append(event_task)
            
            logger.info(f"Subscribed to {len(project_events)} project event types")
            
        except Exception as e:
            logger.error(f"Failed to setup project event subscription: {e}")

    async def _process_project_events(self):
        """Process incoming project events using event queue polling."""
        if not hasattr(self, '_project_event_queue') or not self._project_event_queue:
            return
        
        try:
            while True:
                try:
                    # Poll for events with timeout to allow graceful shutdown
                    event = await asyncio.wait_for(self._project_event_queue.get(), timeout=1.0)
                    try:
                        await self._handle_project_event(event)
                    except Exception as e:
                        logger.error(f"Error handling project event {event.event_name}: {e}")
                except asyncio.TimeoutError:
                    # Continue polling - this allows the task to be cancelled
                    continue
                except asyncio.CancelledError:
                    logger.info("Project event processing task cancelled")
                    break
        except Exception as e:
            logger.error(f"Error in project event processing loop: {e}")

    async def _handle_project_event(self, event):
        """Handle a project event by routing to appropriate handler."""
        if not PROJECT_IMPORTS_AVAILABLE:
            return
        
        # Create base context using new Event structure
        base_context = ProjectEventContext(
            project_id=event.payload.get("project_id", ""),
            project_name=event.payload.get("project_name", ""),
            event_type=event.event_name,
            timestamp=event.timestamp,
            source_agent_id=event.source_id or "",
            data=event.payload,  # Use payload instead of data
            raw_event=event
        )
        
        # Route to specific handlers based on event type
        if event.event_name == "project.created":
            await self.on_project_created(base_context)
        elif event.event_name == "project.started":
            await self.on_project_started(base_context)
        elif event.event_name == "project.run.completed":
            context = ProjectCompletedContext(**base_context.__dict__)
            await self.on_project_completed(context)
        elif event.event_name == "project.run.failed":
            context = ProjectFailedContext(**base_context.__dict__)
            await self.on_project_failed(context)
        elif event.event_name == "project.stopped":
            await self.on_project_stopped(base_context)
        elif event.event_name == "project.message.received":
            context = ProjectMessageContext(**base_context.__dict__)
            await self.on_project_message(context)
        elif event.event_name == "project.run.requires_input":
            context = ProjectInputContext(**base_context.__dict__)
            await self.on_project_input_required(context)
        elif event.event_name == "project.run.notification":
            context = ProjectNotificationContext(**base_context.__dict__)
            await self.on_project_notification(context)
        elif event.event_name == "project.agent.joined":
            context = ProjectAgentContext(**base_context.__dict__)
            await self.on_project_joined(context)
        elif event.event_name == "project.agent.left":
            context = ProjectAgentContext(**base_context.__dict__)
            await self.on_project_left(context)
        
        # Update internal state
        if event.event_name in ["project.started", "project.agent.joined"]:
            self._active_projects[base_context.project_id] = {
                "name": base_context.project_name,
                "status": "running",
                "joined_at": base_context.timestamp,
                "channel": base_context.project_channel
            }
            if base_context.project_channel:
                self._project_channels[base_context.project_id] = base_context.project_channel
        elif event.event_name in ["project.run.completed", "project.run.failed", "project.stopped"]:
            self._active_projects.pop(base_context.project_id, None)
            self._project_channels.pop(base_context.project_id, None)

    async def _cleanup_project_functionality(self):
        """Cleanup project functionality."""
        if self._project_event_subscription:
            try:
                # Get network reference from workspace client
                network = getattr(self._workspace_client, '_network', None)
                if network and hasattr(network, 'events'):
                    network.events.unsubscribe(self._project_event_subscription.subscription_id)
                    network.events.remove_agent_event_queue(self.client.agent_id)
                    logger.info("Project event subscription and queue cleaned up")
                else:
                    logger.warning("Network events not available for cleanup")
            except Exception as e:
                logger.error(f"Error cleaning up project subscription: {e}")
    
    def agent(
        self,
        context: EventContext,
        instruction: Optional[str] = None,
    ):
        """
        Let the agent respond to the context and decide it's action automatically.

        Args:
            context: The event context containing incoming event, threads, and thread ID
            instruction: The instruction for the agent to respond to the context
        """

        pass

    async def on_direct(self, context: EventContext):
        """Handle direct messages. Override this method."""
        pass

        pass
    
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

    # Project handler methods (only called when project mod is enabled)
    async def on_project_created(self, context: ProjectEventContext):
        """Handle project creation events. Override this method."""
        pass

    async def on_project_started(self, context: ProjectEventContext):
        """Handle project start events. Override this method."""
        pass

    async def on_project_completed(self, context: ProjectCompletedContext):
        """Handle project completion events. Override this method."""
        pass

    async def on_project_failed(self, context: ProjectFailedContext):
        """Handle project failure events. Override this method."""
        pass

    async def on_project_stopped(self, context: ProjectEventContext):
        """Handle project stop events. Override this method."""
        pass

    async def on_project_message(self, context: ProjectMessageContext):
        """Handle project channel messages. Override this method."""
        pass

    async def on_project_input_required(self, context: ProjectInputContext):
        """Handle project input requirements. Override this method."""
        pass

    async def on_project_notification(self, context: ProjectNotificationContext):
        """Handle project notifications. Override this method."""
        pass

    async def on_project_joined(self, context: ProjectAgentContext):
        """Handle project agent join events. Override this method."""
        pass

    async def on_project_left(self, context: ProjectAgentContext):
        """Handle project agent leave events. Override this method."""
        pass

    # Convenience methods for messaging (with EventResponse integration)
    async def send_direct(self, to: str, text: str = None, content: Dict[str, Any] = None, **kwargs) -> EventResponse:
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
        return await agent_connection.send_message(message_content, **kwargs)

    async def post_to_channel(self, channel: str, text: str = None, content: Dict[str, Any] = None, **kwargs) -> EventResponse:
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

    async def reply_to_message(self, channel: str, message_id: str, text: str = None, content: Dict[str, Any] = None, **kwargs) -> EventResponse:
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
        return await channel_connection.reply_to_message(message_id, message_content, **kwargs)

    async def react_to_message(self, channel: str, message_id: str, reaction: str, action: str = "add") -> EventResponse:
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

    async def get_channel_messages(self, channel: str, limit: int = 50, offset: int = 0) -> Dict[str, Any]:
        """Get messages from a channel.
        
        Args:
            channel: Channel name (with or without #)
            limit: Maximum number of messages to retrieve
            offset: Offset for pagination
            
        Returns:
            Dict with messages and metadata
        """
        # Send request via mod messaging
        if not hasattr(self, '_thread_adapter') or not self._thread_adapter:
            return {"messages": [], "total_count": 0, "has_more": False}
        
        # Create future for async response
        future_key = f"get_channel_messages:{channel}"
        future = asyncio.Future()
        self._pending_history_requests[future_key] = future
        
        # Send request
        try:
            await self._thread_adapter.request_channel_messages(
                channel=channel.lstrip('#'),
                limit=limit,
                offset=offset
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

    async def get_direct_messages(self, with_agent: str, limit: int = 50, offset: int = 0) -> Dict[str, Any]:
        """Get direct messages with an agent.
        
        Args:
            with_agent: Agent ID to get messages with
            limit: Maximum number of messages to retrieve
            offset: Offset for pagination
            
        Returns:
            Dict with messages and metadata
        """
        # Send request via mod messaging
        if not hasattr(self, '_thread_adapter') or not self._thread_adapter:
            return {"messages": [], "total_count": 0, "has_more": False}
        
        # Create future for async response
        future_key = f"get_direct_messages:{with_agent}"
        future = asyncio.Future()
        self._pending_history_requests[future_key] = future
        
        # Send request
        try:
            await self._thread_adapter.request_direct_messages(
                target_agent_id=with_agent,
                limit=limit,
                offset=offset
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

    async def upload_file(self, channel: str, file_path: str, filename: str = None) -> Optional[str]:
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
        mention_pattern = rf'@{re.escape(self.client.agent_id)}\b'
        return bool(re.search(mention_pattern, text))

    def extract_mentions(self, text: str) -> List[str]:
        """Extract all mentioned agent IDs from text."""
        mention_pattern = r'@([a-zA-Z0-9_-]+)'
        return re.findall(mention_pattern, text)

    def register_command(self, command: str, handler: Callable):
        """Register a text command handler.
        
        Args:
            command: The command string (e.g., "/help", "!status")
            handler: Async function that takes (context, args) parameters
        """
        self._command_handlers[command] = handler
        logger.info(f"Registered command: {command}")

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

    # Project utility methods
    def has_project_mod(self) -> bool:
        """Check if project mod is available and enabled."""
        return self._project_mod_available

    def get_active_projects(self) -> List[str]:
        """Get list of active project IDs."""
        return list(self._active_projects.keys())

    def get_project_channel(self, project_id: str) -> Optional[str]:
        """Get the channel name for a project."""
        return self._project_channels.get(project_id)

    def is_project_channel(self, channel: str) -> bool:
        """Check if a channel is a project channel."""
        return channel in self._project_channels.values()

    def get_project_id_from_channel(self, channel: str) -> Optional[str]:
        """Get project ID from channel name."""
        for project_id, project_channel in self._project_channels.items():
            if project_channel == channel:
                return project_id
        return None

    async def get_project_history(self, project_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        """Get message history for a project.
        
        Args:
            project_id: ID of the project
            limit: Maximum number of messages to retrieve
            
        Returns:
            List of message dictionaries
            
        Raises:
            Exception: If project channel not found
        """
        channel = self.get_project_channel(project_id)
        if not channel:
            raise Exception(f"No channel found for project {project_id}")
        
        try:
            result = await self.get_channel_messages(channel, limit=limit)
            return result.get("messages", [])
        except Exception as e:
            logger.error(f"Failed to get project history for {project_id}: {e}")
            raise

    async def search_project_messages(self, project_id: str, search_term: str, limit: int = 50) -> List[Dict[str, Any]]:
        """Search messages in a project.
        
        Args:
            project_id: ID of the project
            search_term: Text to search for
            limit: Maximum number of messages to search through
            
        Returns:
            List of matching message dictionaries
            
        Raises:
            Exception: If project channel not found
        """
        channel = self.get_project_channel(project_id)
        if not channel:
            raise Exception(f"No channel found for project {project_id}")
        
        try:
            return await self.find_messages_containing(channel, search_term, limit=limit)
        except Exception as e:
            logger.error(f"Failed to search project messages for {project_id}: {e}")
            raise

    # Convenience methods for message history
    async def get_recent_channel_messages(self, channel: str, count: int = 10) -> List[Dict[str, Any]]:
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

    async def get_recent_direct_messages(self, with_agent: str, count: int = 10) -> List[Dict[str, Any]]:
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

    async def find_messages_by_sender(self, channel_or_agent: str, sender_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        """Find messages from a specific sender in a channel or direct conversation.
        
        Args:
            channel_or_agent: Channel name (with #) or agent ID for direct messages
            sender_id: ID of the sender to find messages from
            limit: Maximum number of messages to search through
            
        Returns:
            List of messages from the specified sender
        """
        try:
            if channel_or_agent.startswith('#'):
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

    async def find_messages_containing(self, channel_or_agent: str, search_text: str, limit: int = 50) -> List[Dict[str, Any]]:
        """Find messages containing specific text.
        
        Args:
            channel_or_agent: Channel name (with #) or agent ID for direct messages
            search_text: Text to search for (case-insensitive)
            limit: Maximum number of messages to search through
            
        Returns:
            List of messages containing the search text
        """
        try:
            if channel_or_agent.startswith('#'):
                # Channel messages
                result = await self.get_channel_messages(channel_or_agent, limit=limit)
            else:
                # Direct messages
                result = await self.get_direct_messages(channel_or_agent, limit=limit)
            
            messages = result.get("messages", [])
            search_lower = search_text.lower()
            
            matching_messages = []
            for msg in messages:
                content = msg.get("content", {})
                text = content.get("text", "") if isinstance(content, dict) else str(content)
                if search_lower in text.lower():
                    matching_messages.append(msg)
            
            return matching_messages
        except Exception as e:
            logger.error(f"Failed to search messages for '{search_text}': {e}")
            return []

    def get_cached_messages(self, channel_or_agent: str) -> List[Dict[str, Any]]:
        """Get cached messages without making a network request.
        
        Args:
            channel_or_agent: Channel name (with #) or agent ID for direct messages
            
        Returns:
            List of cached message dictionaries, or empty list if not cached
        """
        if channel_or_agent.startswith('#'):
            cache_key = f"channel:{channel_or_agent}"
        else:
            cache_key = f"direct:{channel_or_agent}"
        
        return self._message_history_cache.get(cache_key, [])

    def clear_message_cache(self, channel_or_agent: Optional[str] = None):
        """Clear message cache.
        
        Args:
            channel_or_agent: Specific channel/agent to clear, or None to clear all
        """
        if channel_or_agent is None:
            self._message_history_cache.clear()
            logger.info("Cleared all message cache")
        else:
            if channel_or_agent.startswith('#'):
                cache_key = f"channel:{channel_or_agent}"
            else:
                cache_key = f"direct:{channel_or_agent}"
            
            if cache_key in self._message_history_cache:
                del self._message_history_cache[cache_key]
                logger.info(f"Cleared message cache for {channel_or_agent}")

    async def get_conversation_summary(self, channel_or_agent: str, message_count: int = 20) -> Dict[str, Any]:
        """Get a summary of recent conversation activity.
        
        Args:
            channel_or_agent: Channel name (with #) or agent ID for direct messages
            message_count: Number of recent messages to analyze
            
        Returns:
            Dict with conversation statistics and recent activity
        """
        try:
            if channel_or_agent.startswith('#'):
                result = await self.get_channel_messages(channel_or_agent, limit=message_count)
                conversation_type = "channel"
            else:
                result = await self.get_direct_messages(channel_or_agent, limit=message_count)
                conversation_type = "direct"
            
            messages = result.get("messages", [])
            
            if not messages:
                return {
                    "type": conversation_type,
                    "target": channel_or_agent,
                    "message_count": 0,
                    "participants": [],
                    "recent_activity": False
                }
            
            # Analyze messages
            participants = set()
            recent_messages = []
            
            for msg in messages:
                sender_id = msg.get("sender_id", "")
                if sender_id:
                    participants.add(sender_id)
                
                content = msg.get("content", {})
                text = content.get("text", "") if isinstance(content, dict) else str(content)
                recent_messages.append({
                    "sender": sender_id,
                    "text": text[:100] + "..." if len(text) > 100 else text,
                    "timestamp": msg.get("timestamp", 0)
                })
            
            # Sort messages by timestamp, newest first
            recent_messages.sort(key=lambda m: m["timestamp"], reverse=True)
            
            return {
                "type": conversation_type,
                "target": channel_or_agent,
                "message_count": len(messages),
                "total_count": result.get("total_count", len(messages)),
                "participants": list(participants),
                "participant_count": len(participants),
                "recent_messages": recent_messages[:5],  # Last 5 messages
                "recent_activity": len(messages) > 0,
                "has_more": result.get("has_more", False)
            }
        except Exception as e:
            logger.error(f"Failed to get conversation summary for {channel_or_agent}: {e}")
            return {
                "type": conversation_type if 'conversation_type' in locals() else "unknown",
                "target": channel_or_agent,
                "message_count": 0,
                "participants": [],
                "recent_activity": False,
                "error": str(e)
            }
