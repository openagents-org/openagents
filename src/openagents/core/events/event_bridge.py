"""
Bridge between the old message system and new event system.

This module provides backward compatibility by converting between
the old message types (DirectMessage, BroadcastMessage, ModMessage)
and the new unified Event type.
"""

import logging
from typing import Dict, Any, Optional

from openagents.models.event import Event, EventVisibility, EventNames
from ...models.messages import DirectMessage, BroadcastMessage, ModMessage

logger = logging.getLogger(__name__)


class EventBridge:
    """
    Converts between old message types and new Event type.
    
    This enables backward compatibility during the migration period
    where both systems need to coexist.
    """
    
    @staticmethod
    def message_to_event(message: Event) -> Event:
        """
        Convert a message to an event.
        
        Since messages now extend Event, this is mostly a pass-through
        but ensures proper event name and visibility are set.
        
        Args:
            message: The message to convert (now an Event)
            
        Returns:
            Event: The event (may be the same object or a copy)
        """
        try:
            # Since messages now extend Event, we can return them directly
            # but we ensure they have proper event names
            if isinstance(message, DirectMessage):
                if not message.event_name or message.event_name == "":
                    message.event_name = EventNames.AGENT_DIRECT_MESSAGE_SENT
                return message
            elif isinstance(message, BroadcastMessage):
                if not message.event_name or message.event_name == "":
                    message.event_name = EventNames.NETWORK_BROADCAST_SENT
                return message
            elif isinstance(message, ModMessage):
                # Event name should already be set by ModMessage.__post_init__
                return message
            elif isinstance(message, Event):
                # Already an event, return as-is
                return message
            else:
                raise ValueError(f"Unsupported message type: {type(message)}")
                
        except Exception as e:
            logger.error(f"Error converting message to event: {e}")
            raise
    

    
    @staticmethod
    def _get_mod_event_name(mod_name: str, content: Dict[str, Any]) -> str:
        """
        Generate event name based on mod and message content.
        
        Args:
            mod_name: Name of the mod
            content: Message content
            
        Returns:
            str: Generated event name
        """
        # Extract action and message_type from content
        action = content.get("action", "")
        message_type = content.get("message_type", "")
        
        # Map common mod messages to event names
        if "project" in mod_name:
            if message_type == "project_creation":
                return EventNames.PROJECT_CREATION_REQUESTED
            elif message_type == "project_status":
                return EventNames.PROJECT_STATUS_CHANGED
            elif message_type == "project_notification":
                notification_type = content.get("notification_type", "")
                if notification_type == "completion":
                    return EventNames.PROJECT_RUN_COMPLETED
                elif notification_type == "error":
                    return EventNames.PROJECT_RUN_FAILED
                elif notification_type == "input_required":
                    return EventNames.PROJECT_RUN_REQUIRES_INPUT
                else:
                    return f"project.{notification_type}"
            else:
                return f"project.{message_type}" if message_type else "project.unknown"
        
        elif "thread_messaging" in mod_name:
            if message_type == "reply_message":
                return EventNames.CHANNEL_MESSAGE_REPLIED
            elif message_type == "channel_message" or action == "channel_message":
                return EventNames.CHANNEL_MESSAGE_POSTED
            elif message_type == "file_upload":
                return EventNames.FILE_UPLOAD_COMPLETED
            elif message_type == "reaction":
                return EventNames.REACTION_ADDED
            else:
                return f"channel.{message_type}" if message_type else "channel.unknown"
        
        elif "shared_document" in mod_name:
            return f"document.{message_type}" if message_type else "document.unknown"
        
        else:
            # Generic mod event name
            mod_short_name = mod_name.split(".")[-1] if "." in mod_name else mod_name
            return f"{mod_short_name}.{message_type}" if message_type else f"{mod_short_name}.unknown"
    
    @staticmethod
    def event_to_message(event: Event) -> Event:
        """
        Convert an Event to a specific message type.
        
        Since messages now extend Event, this creates the appropriate
        message subclass based on the event properties.
        
        Args:
            event: The event to convert
            
        Returns:
            Event: The converted message (DirectMessage, BroadcastMessage, or ModMessage)
            
        Raises:
            ValueError: If event cannot be converted to a message
        """
        try:
            # Determine message type based on event name and properties
            if event.event_name.startswith("agent.direct_message") or event.target_agent_id:
                return EventBridge._event_to_direct_message(event)
            elif event.event_name.startswith("network.broadcast"):
                return EventBridge._event_to_broadcast_message(event)
            elif event.relevant_mod:
                return EventBridge._event_to_mod_message(event)
            else:
                # Default to broadcast message for unknown events
                return EventBridge._event_to_broadcast_message(event)
                
        except Exception as e:
            logger.error(f"Error converting event to message: {e}")
            raise
    
    @staticmethod
    def _event_to_direct_message(event: Event) -> DirectMessage:
        """Convert Event to DirectMessage."""
        if not event.target_agent_id:
            raise ValueError("Direct message event must have target_agent_id")
        
        return DirectMessage(
            event_id=event.event_id,
            event_name=event.event_name,
            timestamp=event.timestamp,
            source_id=event.source_id,
            target_agent_id=event.target_agent_id,
            payload=event.payload,
            metadata=event.metadata,
            requires_response=event.requires_response,
            visibility=event.visibility
        )
    
    @staticmethod
    def _event_to_broadcast_message(event: Event) -> BroadcastMessage:
        """Convert Event to BroadcastMessage."""
        return BroadcastMessage(
            event_id=event.event_id,
            event_name=event.event_name,
            timestamp=event.timestamp,
            source_id=event.source_id,
            payload=event.payload,
            metadata=event.metadata,
            requires_response=event.requires_response,
            visibility=event.visibility
        )
    
    @staticmethod
    def _event_to_mod_message(event: Event) -> ModMessage:
        """Convert Event to ModMessage."""
        if not event.relevant_mod:
            raise ValueError("Mod message event must have relevant_mod")
        
        return ModMessage(
            event_id=event.event_id,
            event_name=event.event_name,
            timestamp=event.timestamp,
            source_id=event.source_id,
            mod=event.relevant_mod,
            relevant_mod=event.relevant_mod,
            relevant_agent_id=event.target_agent_id or event.source_id,
            payload=event.payload,
            metadata=event.metadata,
            requires_response=event.requires_response,
            visibility=event.visibility
        )


class LegacyEventAdapter:
    """
    Adapter that allows old workspace events to work with the new system.
    
    This bridges the gap between the old workspace-only event system
    and the new network-wide event system.
    """
    
    def __init__(self, event_bus):
        """Initialize with reference to the new event bus."""
        self.event_bus = event_bus
        self.workspace_subscriptions = {}  # workspace_id -> subscription_id
    
    async def emit_workspace_event(self, workspace_id: str, event_type: str, **kwargs) -> None:
        """
        Emit an event in the old workspace event format.
        
        This converts the old workspace event to a new Event and emits it.
        """
        # Convert old workspace event to new Event
        event = Event(
            event_name=event_type,
            source_id=kwargs.get('source_id', workspace_id),
            target_agent_id=kwargs.get('target_agent_id'),
            target_channel=kwargs.get('channel'),
            payload=kwargs.get('data', {}),
            visibility=EventVisibility.NETWORK
        )
        
        await self.event_bus.emit_event(event)
    
    def subscribe_workspace(self, workspace_id: str, event_patterns: list) -> str:
        """Subscribe a workspace to events using the old interface."""
        subscription = self.event_bus.subscribe(workspace_id, event_patterns)
        self.workspace_subscriptions[workspace_id] = subscription.subscription_id
        return subscription.subscription_id
    
    def unsubscribe_workspace(self, workspace_id: str) -> bool:
        """Unsubscribe a workspace from events."""
        if workspace_id in self.workspace_subscriptions:
            subscription_id = self.workspace_subscriptions[workspace_id]
            success = self.event_bus.unsubscribe(subscription_id)
            if success:
                del self.workspace_subscriptions[workspace_id]
            return success
        return False
