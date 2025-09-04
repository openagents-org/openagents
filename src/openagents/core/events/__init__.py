"""
Unified event system for OpenAgents.

This module provides a unified event-based architecture that replaces
the current message system (DirectMessage, BroadcastMessage, ModMessage)
with a single Event type and global EventBus.

Key Components:
- Event: Unified event structure for all network interactions
- EventBus: Global event distribution system
- EventSubscription: Agent subscription to event patterns
- EventVisibility: Access control for events

Usage:
    # Create and emit events
    event = Event(
        event_name="agent.direct_message.sent",
        source_id="agent1",
        target_agent_id="agent2",
        payload={"text": "Hello!"}
    )
    await event_bus.emit_event(event)
    
    # Subscribe to events
    subscription = event_bus.subscribe(
        agent_id="agent1",
        event_patterns=["project.*", "channel.message.*"]
    )
    
    # Handle events in mods
    event_bus.register_mod_handler("project.default", handle_project_event)
"""

from openagents.models.event import (
    Event,
    EventSubscription,
    EventVisibility,
    EventNames
)
from .event_bus import EventBus

__all__ = [
    "Event",
    "EventSubscription", 
    "EventVisibility",
    "EventNames",
    "EventBus"
]
