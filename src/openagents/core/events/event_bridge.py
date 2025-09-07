"""
Bridge between the old message system and new event system.

This module provides backward compatibility by working with the unified Event type.
Since all messages are now Events, this bridge is simplified.
"""

import logging
from typing import Dict, Any, Optional

from openagents.models.event import Event, EventVisibility, EventNames
from ...models.messages import Event as MessageEvent

logger = logging.getLogger(__name__)


class EventBridge:
    """
    Simplified event bridge for the unified Event system.
    
    Since all messages are now Events, most conversion is pass-through.
    """
    
    @staticmethod
    def message_to_event(message: Event) -> Event:
        """
        Convert a message to an event.
        
        Since messages are now Events, this is a pass-through.
        
        Args:
            message: The message to convert (already an Event)
            
        Returns:
            Event: The event (same object)
        """
        return message
    
    @staticmethod
    def event_to_message(event: Event) -> Event:
        """
        Convert an Event to a message.
        
        Since messages are now Events, this is a pass-through.
        
        Args:
            event: The event to convert
            
        Returns:
            Event: The message (same object)
        """
        return event
    
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


