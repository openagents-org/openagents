"""
WorkerAgent - A simplified, event-driven agent interface for thread messaging.

This module provides a high-level, convenient interface for creating agents that
work with the thread messaging system. It abstracts away the complexity of message
routing and provides intuitive handler methods.
"""

import logging
import re
import asyncio
from abc import abstractmethod
from typing import Dict, List, Optional, Any, Callable, Union
from dataclasses import dataclass

from openagents.agents.runner import AgentRunner
from openagents.models.message_thread import MessageThread
from openagents.models.messages import DirectMessage, BroadcastMessage, ModMessage
from openagents.models.event import Event
from openagents.mods.communication.thread_messaging.thread_messages import (
    DirectMessage as ThreadDirectMessage,
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
    from openagents.models.event import Event, EventNames
    PROJECT_IMPORTS_AVAILABLE = True
except ImportError:
    PROJECT_IMPORTS_AVAILABLE = False

logger = logging.getLogger(__name__)


@dataclass
class MessageContext:
    """Base context class for all message types."""
    message_id: str
    sender_id: str
    timestamp: int
    content: Dict[str, Any]
    raw_message: Event
    
    @property
    def text(self) -> str:
        """Extract text content from the message."""
        if isinstance(self.content, dict):
            return self.content.get('text', str(self.content))
        return str(self.content)


@dataclass
class DirectMessageContext(MessageContext):
    """Context for direct messages."""
    target_agent_id: str
    quoted_message_id: Optional[str] = None
    quoted_text: Optional[str] = None


@dataclass
class ChannelMessageContext(MessageContext):
    """Context for channel messages."""
    channel: str
    mentioned_agent_id: Optional[str] = None
    quoted_message_id: Optional[str] = None
    quoted_text: Optional[str] = None
    
    @property
    def mentions(self) -> List[str]:
        """Extract all mentioned agent IDs from the message text."""
        # Look for @agent_id patterns in the text
        mention_pattern = r'@([a-zA-Z0-9_-]+)'
        return re.findall(mention_pattern, self.text)


@dataclass
class ReplyMessageContext(MessageContext):
    """Context for reply messages."""
    reply_to_id: str
    target_agent_id: Optional[str] = None
    channel: Optional[str] = None
    thread_level: int = 1
    quoted_message_id: Optional[str] = None
    quoted_text: Optional[str] = None


@dataclass
class ReactionContext:
    """Context for reaction messages."""
    message_id: str
    target_message_id: str
    reactor_id: str
    reaction_type: str
    action: str  # 'add' or 'remove'
    timestamp: int
    raw_message: Event


@dataclass
class FileContext:
    """Context for file messages."""
    message_id: str
    sender_id: str
    filename: str
    file_content: str  # Base64 encoded
    mime_type: str
    file_size: int
    timestamp: int
    raw_message: Event
    
    @property
    def content_bytes(self) -> bytes:
        """Decode the base64 file content to bytes."""
        import base64
        return base64.b64decode(self.file_content)


# Project-related context classes (only available if project mod is enabled)
@dataclass
class ProjectEventContext:
    """Base context for project events."""
    project_id: str
    project_name: str
    event_type: str
    timestamp: int
    source_agent_id: str
    data: Dict[str, Any]
    raw_event: Any  # Event if available
    
    @property
    def project_channel(self) -> Optional[str]:
        """Get the project channel name if available."""
        return self.data.get("channel_name")


@dataclass
class ProjectCompletedContext(ProjectEventContext):
    """Context for project completion events."""
    results: Dict[str, Any]
    completed_by: str
    completion_summary: str
    
    def __post_init__(self):
        # Extract completion-specific data
        if "results" in self.data:
            self.results = self.data["results"]
        if "completed_by" in self.data:
            self.completed_by = self.data["completed_by"]
        if "completion_summary" in self.data:
            self.completion_summary = self.data["completion_summary"]


@dataclass
class ProjectFailedContext(ProjectEventContext):
    """Context for project failure events."""
    error_message: str
    error_type: str
    failed_by: str
    
    def __post_init__(self):
        # Extract failure-specific data
        if "error_message" in self.data:
            self.error_message = self.data["error_message"]
        if "error_type" in self.data:
            self.error_type = self.data["error_type"]
        if "failed_by" in self.data:
            self.failed_by = self.data["failed_by"]


@dataclass
class ProjectMessageContext(ProjectEventContext):
    """Context for project channel messages."""
    channel: str
    message_text: str
    sender_id: str
    message_id: str
    
    def __post_init__(self):
        # Extract message-specific data
        if "channel" in self.data:
            self.channel = self.data["channel"]
        if "message_text" in self.data:
            self.message_text = self.data["message_text"]
        if "message_id" in self.data:
            self.message_id = self.data["message_id"]


@dataclass
class ProjectInputContext(ProjectEventContext):
    """Context for project input requirements."""
    input_type: str
    prompt: str
    options: List[str]
    timeout: Optional[int]
    
    def __post_init__(self):
        # Extract input-specific data
        if "input_type" in self.data:
            self.input_type = self.data["input_type"]
        if "prompt" in self.data:
            self.prompt = self.data["prompt"]
        if "options" in self.data:
            self.options = self.data["options"]
        if "timeout" in self.data:
            self.timeout = self.data["timeout"]


@dataclass
class ProjectNotificationContext(ProjectEventContext):
    """Context for project notifications."""
    notification_type: str
    content: Dict[str, Any]
    target_agent_id: Optional[str]
    
    def __post_init__(self):
        # Extract notification-specific data
        if "notification_type" in self.data:
            self.notification_type = self.data["notification_type"]
        if "content" in self.data:
            self.content = self.data["content"]
        if "target_agent_id" in self.data:
            self.target_agent_id = self.data["target_agent_id"]


@dataclass
class ProjectAgentContext(ProjectEventContext):
    """Context for project agent join/leave events."""
    agent_id: str
    action: str  # "joined" or "left"
    
    def __post_init__(self):
        # Extract agent-specific data
        if "agent_id" in self.data:
            self.agent_id = self.data["agent_id"]
        if "action" in self.data:
            self.action = self.data["action"]


class WorkerAgent(AgentRunner):
    """
    A simplified, event-driven agent interface for thread messaging.
    
    This class provides convenient handler methods for different types of messages
    and hides the complexity of the underlying messaging system.
    
    Example:
        class EchoAgent(WorkerAgent):
            name = "echo"
            
            async def on_direct(self, msg):
                await self.send_direct(to=msg.sender_id, text=f"Echo: {msg.text}")
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
        if 'openagents.mods.communication.thread_messaging' not in mod_names:
            mod_names.append('openagents.mods.communication.thread_messaging')
        kwargs['mod_names'] = mod_names
        
        super().__init__(agent_id=agent_id, **kwargs)
        
        # Internal state
        self._command_handlers: Dict[str, Callable] = {}
        self._scheduled_tasks: List[asyncio.Task] = []
        self._message_history_cache: Dict[str, List[Dict[str, Any]]] = {}
        self._pending_history_requests: Dict[str, asyncio.Future] = {}
        
        # Project-related state (only used when project mod is available)
        self._active_projects: Dict[str, Dict[str, Any]] = {}
        self._project_channels: Dict[str, str] = {}  # project_id -> channel_name
        self._project_event_subscription = None
        self._project_event_queue = None
        self._workspace_client = None
        self._project_mod_available = False
        
        logger.info(f"Initialized WorkerAgent '{self.default_agent_id}' with ID: {agent_id}")

    async def setup(self):
        """Setup the WorkerAgent with thread messaging."""
        await super().setup()
        
        logger.info(f"Setting up WorkerAgent '{self.default_agent_id}'")
        
        # Find thread messaging adapter using multiple possible keys
        thread_adapter = None
        for key in ["ThreadMessagingAgentAdapter", "thread_messaging", "openagents.mods.communication.thread_messaging"]:
            thread_adapter = self.get_mod_adapter(key)
            if thread_adapter:
                logger.info(f"Found thread messaging adapter with key: {key}")
                break
        
        if not thread_adapter:
            logger.error("Thread messaging adapter not found with any known key!")
            return
        
        # Store reference for later use
        self._thread_adapter = thread_adapter
        
        # Register for mod message notifications
        if hasattr(thread_adapter, 'set_agent_mod_message_handler'):
            thread_adapter.set_agent_mod_message_handler(self._handle_thread_mod_message)
            logger.info("Registered for thread messaging notifications")
        
        # Register message handler for history responses
        if hasattr(thread_adapter, 'register_message_handler'):
            thread_adapter.register_message_handler("worker_agent_history", self._handle_history_response)
            logger.info("Registered for message history responses")
        
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

    async def react(self, message_threads: Dict[str, MessageThread], incoming_thread_id: str, incoming_message: Event):
        """Route incoming messages to appropriate handlers."""
        # Skip our own messages if configured to do so
        if self.ignore_own_messages and incoming_message.source_agent_id == self.client.agent_id:
            return
        
        logger.debug(f"WorkerAgent '{self.default_agent_id}' processing message from {incoming_message.source_agent_id}")
        
        # Handle different message types
        if isinstance(incoming_message, DirectMessage):
            await self._handle_direct_message(incoming_message)
        elif isinstance(incoming_message, BroadcastMessage):
            await self._handle_broadcast_message(incoming_message)
        elif isinstance(incoming_message, ModMessage):
            await self._handle_mod_message(incoming_message)
        else:
            logger.debug(f"Unhandled message type: {type(incoming_message)}")

    async def _handle_direct_message(self, message: DirectMessage):
        """Handle direct messages."""
        context = DirectMessageContext(
            message_id=message.message_id,
            sender_id=message.sender_id,
            timestamp=message.timestamp,
            content=message.content,
            raw_message=message,
            target_agent_id=message.target_agent_id,
            quoted_message_id=getattr(message, 'quoted_message_id', None),
            quoted_text=getattr(message, 'quoted_text', None)
        )
        
        # Check for command patterns
        if await self._handle_command(context):
            return
        
        await self.on_direct(context)

    async def _handle_broadcast_message(self, message: BroadcastMessage):
        """Handle broadcast messages (treat as channel messages to 'general')."""
        # Convert broadcast to channel message context
        context = ChannelMessageContext(
            message_id=message.message_id,
            sender_id=message.sender_id,
            timestamp=message.timestamp,
            content=message.content,
            raw_message=message,
            channel="general"  # Default channel for broadcasts
        )
        
        # Check if we're mentioned
        if self.is_mentioned(context.text):
            await self.on_channel_mention(context)
        else:
            await self.on_channel_post(context)

    async def _handle_mod_message(self, message: ModMessage):
        """Handle mod messages from thread messaging."""
        if message.mod != 'thread_messaging':
            return
        
        # This will be handled by _handle_thread_mod_message
        pass

    async def _handle_thread_mod_message(self, message: ModMessage):
        """Handle thread messaging mod messages."""
        action = message.content.get("action", "")
        
        if action == "channel_message_notification":
            await self._handle_channel_notification(message)
        elif action == "reaction_notification":
            await self._handle_reaction_notification(message)
        elif action == "file_upload_response":
            await self._handle_file_notification(message)
        else:
            logger.debug(f"Unhandled thread messaging action: {action}")

    async def _handle_channel_notification(self, message: ModMessage):
        """Handle channel message notifications."""
        channel_msg_data = message.content.get("message", {})
        channel = message.content.get("channel", "")
        
        # Extract message details
        msg_content = channel_msg_data.get("content", {})
        sender_id = channel_msg_data.get("sender_id", "")
        message_id = channel_msg_data.get("message_id", "")
        timestamp = channel_msg_data.get("timestamp", 0)
        message_type = channel_msg_data.get("message_type", "")
        
        # Skip our own messages
        if self.ignore_own_messages and sender_id == self.client.agent_id:
            return
        
        if message_type == "channel_message":
            context = ChannelMessageContext(
                message_id=message_id,
                sender_id=sender_id,
                timestamp=timestamp,
                content=msg_content,
                raw_message=message,
                channel=channel,
                mentioned_agent_id=channel_msg_data.get("mentioned_agent_id")
            )
            
            # Check if we're mentioned
            if (context.mentioned_agent_id == self.client.agent_id or 
                self.is_mentioned(context.text)):
                await self.on_channel_mention(context)
            else:
                await self.on_channel_post(context)
                
        elif message_type == "reply_message":
            context = ReplyMessageContext(
                message_id=message_id,
                sender_id=sender_id,
                timestamp=timestamp,
                content=msg_content,
                raw_message=message,
                reply_to_id=channel_msg_data.get("reply_to_id", ""),
                target_agent_id=channel_msg_data.get("target_agent_id"),
                channel=channel,
                thread_level=channel_msg_data.get("thread_level", 1)
            )
            
            await self.on_channel_reply(context)

    async def _handle_reaction_notification(self, message: ModMessage):
        """Handle reaction notifications."""
        reaction_data = message.content.get("reaction", {})
        
        context = ReactionContext(
            message_id=message.message_id,
            target_message_id=reaction_data.get("target_message_id", ""),
            reactor_id=reaction_data.get("sender_id", ""),
            reaction_type=reaction_data.get("reaction_type", ""),
            action=reaction_data.get("action", "add"),
            timestamp=message.timestamp,
            raw_message=message
        )
        
        await self.on_reaction(context)

    async def _handle_file_notification(self, message: ModMessage):
        """Handle file upload notifications."""
        file_data = message.content.get("file", {})
        
        context = FileContext(
            message_id=message.message_id,
            sender_id=message.sender_id,
            filename=file_data.get("filename", ""),
            file_content=file_data.get("file_content", ""),
            mime_type=file_data.get("mime_type", "application/octet-stream"),
            file_size=file_data.get("file_size", 0),
            timestamp=message.timestamp,
            raw_message=message
        )
        
        await self.on_file_received(context)

    def _handle_history_response(self, data: Dict[str, Any], sender_id: str):
        """Handle message history responses from the thread messaging adapter."""
        action = data.get("action", "")
        
        if action == "channel_messages_retrieved":
            self._process_channel_history_response(data)
        elif action == "direct_messages_retrieved":
            self._process_direct_history_response(data)
        elif action in ["channel_messages_retrieval_error", "direct_messages_retrieval_error"]:
            self._process_history_error_response(data)
    
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
        
        # Resolve any pending futures with error
        action = request_info.get("action", "")
        if action == "retrieve_channel_messages":
            channel = request_info.get("channel", "")
            future_key = f"get_channel_messages:{channel}"
        elif action == "retrieve_direct_messages":
            target_agent_id = request_info.get("target_agent_id", "")
            future_key = f"get_direct_messages:{target_agent_id}"
        else:
            return
        
        if future_key in self._pending_history_requests:
            future = self._pending_history_requests.pop(future_key)
            if not future.done():
                future.set_exception(Exception(f"History retrieval failed: {error}"))
        
        logger.error(f"Message history retrieval failed: {error}")

    async def _handle_command(self, context: MessageContext) -> bool:
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
                if hasattr(self.client, 'connector') and hasattr(self.client.connector, 'network'):
                    network = self.client.connector.network
                    if hasattr(network, 'workspace'):
                        workspace = network.workspace()
                        self._workspace_client = workspace
                        
                        # Subscribe to project events
                        await self._setup_project_event_subscription()
                        logger.info("Project event subscription setup complete")
                    else:
                        logger.debug("Network workspace not available")
                else:
                    logger.debug("Network not accessible from client")
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
                    agent_id=self.client.agent_id,
                    event_patterns=["project.*"]  # Use pattern matching for all project events
                )
                # Also create an event queue for polling
                self._project_event_queue = network.events.create_agent_event_queue(self.client.agent_id)
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
            source_agent_id=event.source_agent_id or "",
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
                    if hasattr(self, '_project_event_queue'):
                        network.events.remove_agent_event_queue(self.client.agent_id)
                    logger.info("Project event subscription and queue cleaned up")
                else:
                    logger.warning("Network events not available for cleanup")
            except Exception as e:
                logger.error(f"Error cleaning up project subscription: {e}")

    # Abstract handler methods that users should override
    async def on_direct(self, msg: DirectMessageContext):
        """Handle direct messages. Override this method."""
        pass

    async def on_channel_post(self, msg: ChannelMessageContext):
        """Handle new channel posts. Override this method."""
        pass

    async def on_channel_reply(self, msg: ReplyMessageContext):
        """Handle replies in channels. Override this method."""
        pass

    async def on_channel_mention(self, msg: ChannelMessageContext):
        """Handle when agent is mentioned in channels. Override this method."""
        pass

    async def on_reaction(self, msg: ReactionContext):
        """Handle reactions to messages. Override this method."""
        pass

    async def on_file_received(self, msg: FileContext):
        """Handle file uploads. Override this method."""
        pass

    async def on_startup(self):
        """Called after successful connection and setup. Override this method."""
        pass

    async def on_shutdown(self):
        """Called before disconnection. Override this method."""
        pass

    # Project handler methods (only called when project mod is enabled)
    async def on_project_created(self, event: ProjectEventContext):
        """Handle project creation events. Override this method."""
        pass

    async def on_project_started(self, event: ProjectEventContext):
        """Handle project start events. Override this method."""
        pass

    async def on_project_completed(self, event: ProjectCompletedContext):
        """Handle project completion events. Override this method."""
        pass

    async def on_project_failed(self, event: ProjectFailedContext):
        """Handle project failure events. Override this method."""
        pass

    async def on_project_stopped(self, event: ProjectEventContext):
        """Handle project stop events. Override this method."""
        pass

    async def on_project_message(self, event: ProjectMessageContext):
        """Handle project channel messages. Override this method."""
        pass

    async def on_project_input_required(self, event: ProjectInputContext):
        """Handle project input requirements. Override this method."""
        pass

    async def on_project_notification(self, event: ProjectNotificationContext):
        """Handle project notifications. Override this method."""
        pass

    async def on_project_joined(self, event: ProjectAgentContext):
        """Handle project agent join events. Override this method."""
        pass

    async def on_project_left(self, event: ProjectAgentContext):
        """Handle project agent leave events. Override this method."""
        pass

    # Convenience sending methods
    async def send_direct(self, to: str, text: str, quote: Optional[str] = None):
        """Send a direct message to another agent."""
        if not hasattr(self, '_thread_adapter') or not self._thread_adapter:
            logger.error("Thread messaging adapter not available")
            return
        
        await self._thread_adapter.send_direct_message(
            target_agent_id=to,
            text=text,
            quote=quote
        )
        logger.debug(f"Sent direct message to {to}: {text}")

    async def send_channel(self, channel: str, text: str, mention: Optional[str] = None, quote: Optional[str] = None):
        """Send a message to a channel."""
        if not hasattr(self, '_thread_adapter') or not self._thread_adapter:
            logger.error("Thread messaging adapter not available")
            return
        
        # Add mention to text if specified
        if mention:
            text = f"@{mention} {text}"
        
        await self._thread_adapter.send_channel_message(
            channel=channel,
            text=text,
            mentioned_agent_id=mention,
            quote=quote
        )
        logger.debug(f"Sent channel message to {channel}: {text}")

    async def send_reply(self, reply_to_id: str, text: str, quote: Optional[str] = None):
        """Send a reply to any message."""
        if not hasattr(self, '_thread_adapter') or not self._thread_adapter:
            logger.error("Thread messaging adapter not available")
            return
        
        await self._thread_adapter.send_reply_message(
            reply_to_id=reply_to_id,
            text=text,
            quote=quote
        )
        logger.debug(f"Sent reply to {reply_to_id}: {text}")

    async def react_to(self, message_id: str, reaction: str):
        """Add a reaction to a message."""
        if not hasattr(self, '_thread_adapter') or not self._thread_adapter:
            logger.error("Thread messaging adapter not available")
            return
        
        await self._thread_adapter.add_reaction(
            target_message_id=message_id,
            reaction_type=reaction
        )
        logger.debug(f"Added reaction '{reaction}' to message {message_id}")

    async def upload_file(self, filename: str, content: bytes, mime_type: str = "application/octet-stream"):
        """Upload a file."""
        if not hasattr(self, '_thread_adapter') or not self._thread_adapter:
            logger.error("Thread messaging adapter not available")
            return
        
        import base64
        file_content_b64 = base64.b64encode(content).decode('utf-8')
        
        await self._thread_adapter.upload_file(
            filename=filename,
            file_content=file_content_b64,
            mime_type=mime_type,
            file_size=len(content)
        )
        logger.debug(f"Uploaded file: {filename} ({len(content)} bytes)")

    # Utility methods
    async def get_channels(self) -> List[Dict[str, Any]]:
        """Get available channels."""
        if not hasattr(self, '_thread_adapter') or not self._thread_adapter:
            return []
        
        await self._thread_adapter.list_channels()
        # The response will be handled asynchronously
        return self._thread_adapter.available_channels

    async def get_channel_messages(self, channel: str, limit: int = 50, offset: int = 0, timeout: float = 10.0) -> Dict[str, Any]:
        """Get channel message history.
        
        Args:
            channel: Channel name to retrieve messages from
            limit: Maximum number of messages to retrieve (1-500)
            offset: Number of messages to skip for pagination
            timeout: Maximum time to wait for response in seconds
            
        Returns:
            Dict containing:
                - messages: List of message dictionaries
                - total_count: Total number of messages in channel
                - offset: Offset used for this request
                - limit: Limit used for this request
                - has_more: Whether there are more messages available
                
        Raises:
            Exception: If retrieval fails or times out
        """
        if not hasattr(self, '_thread_adapter') or not self._thread_adapter:
            raise Exception("Thread messaging adapter not available")
        
        # Check cache first
        cache_key = f"channel:{channel}"
        if cache_key in self._message_history_cache and offset == 0:
            cached_messages = self._message_history_cache[cache_key]
            if len(cached_messages) >= limit:
                return {
                    "messages": cached_messages[:limit],
                    "total_count": len(cached_messages),
                    "offset": 0,
                    "limit": limit,
                    "has_more": len(cached_messages) > limit
                }
        
        # Create future for async response
        future_key = f"get_channel_messages:{channel}"
        if future_key in self._pending_history_requests:
            # Request already in progress, wait for it
            future = self._pending_history_requests[future_key]
        else:
            # Create new request
            future = asyncio.get_event_loop().create_future()
            self._pending_history_requests[future_key] = future
            
            # Send the request
            await self._thread_adapter.retrieve_channel_messages(
                channel=channel,
                limit=limit,
                offset=offset
            )
        
        # Wait for response with timeout
        try:
            result = await asyncio.wait_for(future, timeout=timeout)
            return result
        except asyncio.TimeoutError:
            # Clean up pending request
            self._pending_history_requests.pop(future_key, None)
            raise Exception(f"Timeout waiting for channel messages from {channel}")

    async def get_direct_messages(self, with_agent: str, limit: int = 50, offset: int = 0, timeout: float = 10.0) -> Dict[str, Any]:
        """Get direct message history.
        
        Args:
            with_agent: Agent ID to get conversation history with
            limit: Maximum number of messages to retrieve (1-500)
            offset: Number of messages to skip for pagination
            timeout: Maximum time to wait for response in seconds
            
        Returns:
            Dict containing:
                - messages: List of message dictionaries
                - total_count: Total number of messages in conversation
                - offset: Offset used for this request
                - limit: Limit used for this request
                - has_more: Whether there are more messages available
                
        Raises:
            Exception: If retrieval fails or times out
        """
        if not hasattr(self, '_thread_adapter') or not self._thread_adapter:
            raise Exception("Thread messaging adapter not available")
        
        # Check cache first
        cache_key = f"direct:{with_agent}"
        if cache_key in self._message_history_cache and offset == 0:
            cached_messages = self._message_history_cache[cache_key]
            if len(cached_messages) >= limit:
                return {
                    "messages": cached_messages[:limit],
                    "total_count": len(cached_messages),
                    "offset": 0,
                    "limit": limit,
                    "has_more": len(cached_messages) > limit
                }
        
        # Create future for async response
        future_key = f"get_direct_messages:{with_agent}"
        if future_key in self._pending_history_requests:
            # Request already in progress, wait for it
            future = self._pending_history_requests[future_key]
        else:
            # Create new request
            future = asyncio.get_event_loop().create_future()
            self._pending_history_requests[future_key] = future
            
            # Send the request
            await self._thread_adapter.retrieve_direct_messages(
                target_agent_id=with_agent,
                limit=limit,
                offset=offset
            )
        
        # Wait for response with timeout
        try:
            result = await asyncio.wait_for(future, timeout=timeout)
            return result
        except asyncio.TimeoutError:
            # Clean up pending request
            self._pending_history_requests.pop(future_key, None)
            raise Exception(f"Timeout waiting for direct messages with {with_agent}")

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

    # Project management methods (only effective when project mod is enabled)
    async def create_project(self, goal: str, name: Optional[str] = None, config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Create a new project.
        
        Args:
            goal: The goal or description of the project
            name: Optional name for the project (auto-generated if not provided)
            config: Optional project-specific configuration
            
        Returns:
            Dict containing project creation result
            
        Raises:
            Exception: If project mod is not available or creation fails
        """
        if not self._project_mod_available:
            raise Exception("Project functionality not available - project mod not enabled")
        
        if not self._workspace_client:
            raise Exception("Workspace client not available for project creation")
        
        try:
            if not PROJECT_IMPORTS_AVAILABLE:
                raise Exception("Project imports not available")
            
            # Create project object
            project = Project(goal=goal, name=name)
            if config:
                project.config = config
            
            # Start the project through workspace
            result = await self._workspace_client.start_project(project)
            
            if result.get("success"):
                project_id = result["project_id"]
                # Track the project
                self._active_projects[project_id] = {
                    "name": result.get("project_name", name or "Unnamed Project"),
                    "status": "running",
                    "created_at": int(asyncio.get_event_loop().time()),
                    "channel": result.get("channel_name")
                }
                if result.get("channel_name"):
                    self._project_channels[project_id] = result["channel_name"]
                
                logger.info(f"Created project {project_id}: {goal}")
            
            return result
            
        except Exception as e:
            logger.error(f"Failed to create project: {e}")
            raise

    async def get_project_status(self, project_id: str) -> Dict[str, Any]:
        """Get the status and details of a project.
        
        Args:
            project_id: ID of the project to get status for
            
        Returns:
            Dict containing project status information
            
        Raises:
            Exception: If project mod is not available or request fails
        """
        if not self._project_mod_available:
            raise Exception("Project functionality not available - project mod not enabled")
        
        if not self._workspace_client:
            raise Exception("Workspace client not available")
        
        try:
            result = await self._workspace_client.get_project_status(project_id)
            return result
        except Exception as e:
            logger.error(f"Failed to get project status for {project_id}: {e}")
            raise

    async def list_my_projects(self, status_filter: Optional[str] = None) -> List[Dict[str, Any]]:
        """List projects for this agent.
        
        Args:
            status_filter: Optional status filter ("running", "completed", etc.)
            
        Returns:
            List of project dictionaries
            
        Raises:
            Exception: If project mod is not available or request fails
        """
        if not self._project_mod_available:
            raise Exception("Project functionality not available - project mod not enabled")
        
        if not self._workspace_client:
            raise Exception("Workspace client not available")
        
        try:
            result = await self._workspace_client.list_projects(filter_status=status_filter)
            if result.get("success"):
                return result.get("projects", [])
            else:
                raise Exception(result.get("error", "Failed to list projects"))
        except Exception as e:
            logger.error(f"Failed to list projects: {e}")
            raise

    async def stop_project(self, project_id: str) -> Dict[str, Any]:
        """Stop a running project.
        
        Args:
            project_id: ID of the project to stop
            
        Returns:
            Dict containing stop result
            
        Raises:
            Exception: If project mod is not available or request fails
        """
        if not self._project_mod_available:
            raise Exception("Project functionality not available - project mod not enabled")
        
        project_adapter = self.get_mod_adapter('project.default')
        if not project_adapter:
            raise Exception("Project adapter not available")
        
        try:
            # Use the project adapter to stop the project
            # This would need to be implemented in the adapter
            # For now, we'll track it locally
            self._active_projects.pop(project_id, None)
            self._project_channels.pop(project_id, None)
            
            logger.info(f"Stopped project {project_id}")
            return {"success": True, "project_id": project_id}
            
        except Exception as e:
            logger.error(f"Failed to stop project {project_id}: {e}")
            raise

    async def send_project_message(self, project_id: str, message: str) -> None:
        """Send a message to a project channel.
        
        Args:
            project_id: ID of the project
            message: Message text to send
            
        Raises:
            Exception: If project mod is not available or send fails
        """
        if not self._project_mod_available:
            raise Exception("Project functionality not available - project mod not enabled")
        
        # Get project channel
        channel = self._project_channels.get(project_id)
        if not channel:
            # Try to get from active projects
            project_info = self._active_projects.get(project_id)
            if project_info:
                channel = project_info.get("channel")
        
        if not channel:
            raise Exception(f"No channel found for project {project_id}")
        
        # Send message to project channel
        await self.send_channel(channel, message)
        logger.debug(f"Sent message to project {project_id} channel {channel}")

    async def send_project_notification(self, project_id: str, notification_type: str, content: Dict[str, Any]) -> None:
        """Send a project notification.
        
        Args:
            project_id: ID of the project
            notification_type: Type of notification ("progress", "error", "completion", etc.)
            content: Notification content
            
        Raises:
            Exception: If project mod is not available or send fails
        """
        if not self._project_mod_available:
            raise Exception("Project functionality not available - project mod not enabled")
        
        if not PROJECT_IMPORTS_AVAILABLE:
            raise Exception("Project imports not available")
        
        try:
            # Create project notification message
            notification = ProjectNotificationMessage(
                sender_id=self.client.agent_id,
                project_id=project_id,
                notification_type=notification_type,
                content=content
            )
            
            # Send through mod message system
            mod_message = ModMessage(
                sender_id=self.client.agent_id,
                relevant_mod="openagents.mods.project.default",
                direction="outbound",
                relevant_agent_id=self.client.agent_id,
                content=notification.model_dump()
            )
            
            await self.client.connector.send_mod_message(mod_message)
            logger.debug(f"Sent project notification for {project_id}: {notification_type}")
            
        except Exception as e:
            logger.error(f"Failed to send project notification: {e}")
            raise

    async def complete_project(self, project_id: str, results: Dict[str, Any], summary: str) -> None:
        """Mark a project as completed with results.
        
        Args:
            project_id: ID of the project to complete
            results: Project completion results
            summary: Completion summary
            
        Raises:
            Exception: If project mod is not available or completion fails
        """
        if not self._project_mod_available:
            raise Exception("Project functionality not available - project mod not enabled")
        
        try:
            # Send completion notification
            await self.send_project_notification(
                project_id=project_id,
                notification_type="completion",
                content={
                    "results": results,
                    "completed_by": self.client.agent_id,
                    "completion_summary": summary,
                    "completion_time": asyncio.get_event_loop().time()
                }
            )
            
            # Update local state
            self._active_projects.pop(project_id, None)
            self._project_channels.pop(project_id, None)
            
            logger.info(f"Completed project {project_id}: {summary}")
            
        except Exception as e:
            logger.error(f"Failed to complete project {project_id}: {e}")
            raise

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
