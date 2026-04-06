"""Message models for OpenAgents - now using unified Event system only."""

from .event import Event, EventVisibility, EventNames

# All message types have been consolidated into the unified Event class
# Use Event directly with appropriate event_name values:
#
# Event → Event(event_name="agent.message", ...)
# Event → Event(event_name="agent.broadcast_message.sent", ...)
# Event → Event(event_name="mod.{mod_name}.{action}", ...)
#
# The Event class provides all necessary fields and backward compatibility
# properties for existing code that may reference message_id, sender_id, etc.

__all__ = ["Event", "EventVisibility", "EventNames"]
