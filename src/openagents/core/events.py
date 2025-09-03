"""
Event subscription system for OpenAgents workspace.

This module provides a typed event subscription interface that allows agents
to subscribe to and receive events from the workspace in a structured way.
"""

import asyncio
import logging
from typing import Dict, Any, List, Optional, Union, AsyncIterator, Set
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
import uuid

logger = logging.getLogger(__name__)


class EventType(str, Enum):
    """Enumeration of available event types in the workspace."""
    
    # Agent events
    AGENT_CONNECTED = "agent.connected"
    AGENT_DISCONNECTED = "agent.disconnected"
    AGENT_DIRECT_MESSAGE_RECEIVED = "agent.direct_message.received"
    AGENT_DIRECT_MESSAGE_SENT = "agent.direct_message.sent"
    
    # Channel events
    CHANNEL_POST_CREATED = "channel.post.created"
    CHANNEL_POST_REPLIED = "channel.post.replied"
    CHANNEL_MESSAGE_RECEIVED = "channel.message.received"
    CHANNEL_MESSAGE_MENTIONED = "channel.message.mentioned"
    CHANNEL_JOINED = "channel.joined"
    CHANNEL_LEFT = "channel.left"
    
    # Reaction events
    REACTION_ADDED = "reaction.added"
    REACTION_REMOVED = "reaction.removed"
    
    # Project events
    PROJECT_CREATED = "project.created"
    PROJECT_STARTED = "project.started"
    PROJECT_RUN_COMPLETED = "project.run.completed"
    PROJECT_RUN_FAILED = "project.run.failed"
    PROJECT_RUN_REQUIRES_INPUT = "project.run.requires_input"
    PROJECT_MESSAGE_RECEIVED = "project.message.received"
    PROJECT_RUN_NOTIFICATION = "project.run.notification"
    PROJECT_STOPPED = "project.stopped"
    PROJECT_AGENT_JOINED = "project.agent.joined"
    PROJECT_AGENT_LEFT = "project.agent.left"
    PROJECT_STATUS_CHANGED = "project.status.changed"
    
    # File events
    FILE_UPLOADED = "file.uploaded"
    FILE_DOWNLOADED = "file.downloaded"
    FILE_SHARED = "file.shared"
    
    # System events
    NETWORK_STATUS_CHANGED = "network.status.changed"
    MOD_LOADED = "mod.loaded"
    MOD_UNLOADED = "mod.unloaded"


@dataclass
class WorkspaceEvent:
    """Represents an event in the workspace."""
    
    event_type: EventType
    event_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: datetime = field(default_factory=datetime.now)
    source_agent_id: Optional[str] = None
    target_agent_id: Optional[str] = None
    channel: Optional[str] = None
    data: Dict[str, Any] = field(default_factory=dict)
    
    @property
    def event_name(self) -> str:
        """Get the event name (alias for event_type)."""
        return self.event_type.value


class EventSubscription:
    """Represents an active event subscription."""
    
    def __init__(self, subscription_id: str, event_types: List[EventType], 
                 event_queue: asyncio.Queue, filters: Optional[Dict[str, Any]] = None):
        self.subscription_id = subscription_id
        self.event_types = set(event_types)
        self.event_queue = event_queue
        self.filters = filters or {}
        self.is_active = True
        
    def matches_event(self, event: WorkspaceEvent) -> bool:
        """Check if an event matches this subscription."""
        if not self.is_active:
            return False
            
        # Check event type
        if event.event_type not in self.event_types:
            return False
            
        # Apply filters
        for filter_key, filter_value in self.filters.items():
            if filter_key == "source_agent_id":
                if event.source_agent_id != filter_value:
                    return False
            elif filter_key == "target_agent_id":
                if event.target_agent_id != filter_value:
                    return False
            elif filter_key == "channel":
                if event.channel != filter_value:
                    return False
            elif filter_key in event.data:
                if event.data[filter_key] != filter_value:
                    return False
                    
        return True
    
    async def put_event(self, event: WorkspaceEvent):
        """Add an event to the subscription queue."""
        if self.matches_event(event):
            try:
                await self.event_queue.put(event)
            except Exception as e:
                logger.error(f"Failed to queue event {event.event_id}: {e}")
    
    def close(self):
        """Close the subscription."""
        self.is_active = False
        # Put a sentinel value to wake up any waiting consumers
        try:
            self.event_queue.put_nowait(None)
        except asyncio.QueueFull:
            pass
    
    def __aiter__(self):
        """Make subscription async iterable."""
        return self
    
    async def __anext__(self) -> WorkspaceEvent:
        """Get the next event from the subscription."""
        if not self.is_active:
            raise StopAsyncIteration
            
        try:
            event = await self.event_queue.get()
            if event is None:  # Sentinel value indicating subscription closed
                raise StopAsyncIteration
            return event
        except asyncio.CancelledError:
            raise StopAsyncIteration


class EventManager:
    """Manages event subscriptions and distribution in the workspace."""
    
    def __init__(self):
        self.subscriptions: Dict[str, EventSubscription] = {}
        self._event_handlers: Dict[EventType, List[callable]] = {}
        
    def subscribe(self, event_types: Union[List[str], List[EventType]], 
                  filters: Optional[Dict[str, Any]] = None,
                  queue_size: int = 1000) -> EventSubscription:
        """Subscribe to workspace events.
        
        Args:
            event_types: List of event types to subscribe to
            filters: Optional filters to apply to events
            queue_size: Maximum size of the event queue
            
        Returns:
            EventSubscription: An active subscription object
        """
        # Convert string event types to EventType enums
        if event_types and isinstance(event_types[0], str):
            try:
                event_types = [EventType(event_type) for event_type in event_types]
            except ValueError as e:
                available_types = [et.value for et in EventType]
                raise ValueError(f"Invalid event type. Available types: {available_types}") from e
        
        subscription_id = str(uuid.uuid4())
        event_queue = asyncio.Queue(maxsize=queue_size)
        
        subscription = EventSubscription(
            subscription_id=subscription_id,
            event_types=event_types,
            event_queue=event_queue,
            filters=filters
        )
        
        self.subscriptions[subscription_id] = subscription
        logger.debug(f"Created subscription {subscription_id} for events: {[et.value for et in event_types]}")
        
        return subscription
    
    def unsubscribe(self, subscription: EventSubscription):
        """Unsubscribe from events."""
        if subscription.subscription_id in self.subscriptions:
            subscription.close()
            del self.subscriptions[subscription.subscription_id]
            logger.debug(f"Removed subscription {subscription.subscription_id}")
    
    async def emit_event(self, event: WorkspaceEvent):
        """Emit an event to all matching subscriptions."""
        logger.debug(f"Emitting event: {event.event_type.value} from {event.source_agent_id}")
        
        # Send to all matching subscriptions
        for subscription in list(self.subscriptions.values()):
            await subscription.put_event(event)
        
        # Call registered event handlers
        handlers = self._event_handlers.get(event.event_type, [])
        for handler in handlers:
            try:
                if asyncio.iscoroutinefunction(handler):
                    await handler(event)
                else:
                    handler(event)
            except Exception as e:
                logger.error(f"Error in event handler for {event.event_type.value}: {e}")
    
    def register_handler(self, event_type: EventType, handler: callable):
        """Register a handler function for an event type."""
        if event_type not in self._event_handlers:
            self._event_handlers[event_type] = []
        self._event_handlers[event_type].append(handler)
    
    def unregister_handler(self, event_type: EventType, handler: callable):
        """Unregister a handler function for an event type."""
        if event_type in self._event_handlers:
            try:
                self._event_handlers[event_type].remove(handler)
            except ValueError:
                pass
    
    def get_active_subscriptions(self) -> List[str]:
        """Get list of active subscription IDs."""
        return [sub_id for sub_id, sub in self.subscriptions.items() if sub.is_active]
    
    def cleanup(self):
        """Clean up all subscriptions."""
        for subscription in list(self.subscriptions.values()):
            subscription.close()
        self.subscriptions.clear()


class WorkspaceEvents:
    """Event interface for workspace - provides the main API for event subscription."""
    
    def __init__(self, workspace):
        self.workspace = workspace
        self.event_manager = EventManager()
        self._setup_event_handlers()
    
    def _setup_event_handlers(self):
        """Set up handlers to capture events from the workspace."""
        # We'll integrate with the existing message handlers in the client
        client = self.workspace._client
        
        if client and hasattr(client, 'connector') and client.connector:
            # Register handlers for different message types
            original_direct_handler = client._handle_direct_message
            original_mod_handler = client._handle_mod_message
            
            async def enhanced_direct_handler(message):
                # Call original handler first
                await original_direct_handler(message)
                
                # Emit event
                event = WorkspaceEvent(
                    event_type=EventType.AGENT_DIRECT_MESSAGE_RECEIVED,
                    source_agent_id=message.sender_id,
                    target_agent_id=message.target_agent_id,
                    data={
                        "content": message.content,
                        "message_id": message.message_id,
                        "timestamp": message.timestamp
                    }
                )
                await self.event_manager.emit_event(event)
            
            async def enhanced_mod_handler(message):
                # Call original handler first
                await original_mod_handler(message)
                
                # Check for channel message notifications
                if message.content.get("action") == "channel_message_notification":
                    msg_data = message.content.get("message", {})
                    
                    # Emit general channel message received event
                    event = WorkspaceEvent(
                        event_type=EventType.CHANNEL_MESSAGE_RECEIVED,
                        source_agent_id=msg_data.get("sender_id"),
                        channel=msg_data.get("channel"),
                        data={
                            "text": msg_data.get("text", ""),
                            "message_id": msg_data.get("message_id"),
                            "timestamp": msg_data.get("timestamp"),
                            "mentioned_agent_id": msg_data.get("mentioned_agent_id")
                        }
                    )
                    await self.event_manager.emit_event(event)
                    
                    # Check if this message mentions the current agent
                    current_agent_id = self.workspace._client.agent_id if self.workspace._client else None
                    mentioned_agent_id = msg_data.get("mentioned_agent_id")
                    
                    # Also check for @mentions in the text content
                    text = msg_data.get("text", "")
                    text_mentions_current_agent = (
                        current_agent_id and 
                        (f"@{current_agent_id}" in text or f"@{current_agent_id.lower()}" in text.lower())
                    )
                    
                    if (mentioned_agent_id == current_agent_id) or text_mentions_current_agent:
                        # Emit mention-specific event
                        mention_event = WorkspaceEvent(
                            event_type=EventType.CHANNEL_MESSAGE_MENTIONED,
                            source_agent_id=msg_data.get("sender_id"),
                            target_agent_id=current_agent_id,
                            channel=msg_data.get("channel"),
                            data={
                                "text": text,
                                "message_id": msg_data.get("message_id"),
                                "timestamp": msg_data.get("timestamp"),
                                "mention_type": "explicit" if mentioned_agent_id == current_agent_id else "text_mention"
                            }
                        )
                        await self.event_manager.emit_event(mention_event)
                
                # Check for reaction notifications
                elif message.content.get("action") == "reaction_notification":
                    event_type = EventType.REACTION_ADDED if message.content.get("action_taken") == "add" else EventType.REACTION_REMOVED
                    event = WorkspaceEvent(
                        event_type=event_type,
                        source_agent_id=message.content.get("reacting_agent"),
                        data={
                            "target_message_id": message.content.get("target_message_id"),
                            "reaction_type": message.content.get("reaction_type"),
                            "total_reactions": message.content.get("total_reactions", 0)
                        }
                    )
                    await self.event_manager.emit_event(event)
            
            # Replace the handlers
            client._handle_direct_message = enhanced_direct_handler
            client._handle_mod_message = enhanced_mod_handler
    
    def subscribe(self, event_types: Union[List[str], List[EventType]], 
                  filters: Optional[Dict[str, Any]] = None,
                  queue_size: int = 1000) -> EventSubscription:
        """Subscribe to workspace events.
        
        Args:
            event_types: List of event type strings or EventType enums
            filters: Optional filters (e.g., {"channel": "#general", "source_agent_id": "agent1"})
            queue_size: Maximum number of events to queue
            
        Returns:
            EventSubscription: Async iterable subscription object
            
        Example:
            sub = ws.events.subscribe(["channel.message.received", "agent.direct_message.received"])
            async for event in sub:
                print(f"Event: {event.event_name}, Data: {event.data}")
        """
        return self.event_manager.subscribe(event_types, filters, queue_size)
    
    def unsubscribe(self, subscription: EventSubscription):
        """Unsubscribe from events."""
        self.event_manager.unsubscribe(subscription)
    
    async def emit(self, event_type: Union[str, EventType], **kwargs) -> WorkspaceEvent:
        """Emit a custom event.
        
        Args:
            event_type: Type of event to emit
            **kwargs: Event data (source_agent_id, target_agent_id, channel, data, etc.)
            
        Returns:
            WorkspaceEvent: The emitted event
        """
        if isinstance(event_type, str):
            event_type = EventType(event_type)
        
        event = WorkspaceEvent(
            event_type=event_type,
            source_agent_id=kwargs.get('source_agent_id'),
            target_agent_id=kwargs.get('target_agent_id'),
            channel=kwargs.get('channel'),
            data=kwargs.get('data', {})
        )
        
        await self.event_manager.emit_event(event)
        return event
    
    def register_handler(self, event_type: Union[str, EventType], handler: callable):
        """Register a handler function for an event type.
        
        Args:
            event_type: Event type to handle
            handler: Function to call when event occurs (can be sync or async)
        """
        if isinstance(event_type, str):
            event_type = EventType(event_type)
        self.event_manager.register_handler(event_type, handler)
    
    def get_available_event_types(self) -> List[str]:
        """Get list of available event types."""
        return [et.value for et in EventType]
    
    def get_active_subscriptions(self) -> List[str]:
        """Get list of active subscription IDs."""
        return self.event_manager.get_active_subscriptions()
    
    def cleanup(self):
        """Clean up all event subscriptions."""
        self.event_manager.cleanup()
