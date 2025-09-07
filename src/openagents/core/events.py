"""
DEPRECATED: Old workspace-level event system.

This module has been replaced by the unified network-level event system.
Use the new event system from openagents.core.events instead.

The new system provides:
- Network-level event distribution via EventBus
- Unified Event type replacing all message types
- Pattern-based subscriptions (e.g., "project.*")
- Better performance and observability

Migration:
- Replace ws.events.subscribe() with network.events.subscribe()
- Use the new Event type instead of WorkspaceEvent
- Update event names to use hierarchical naming (e.g., "agent.direct_message.sent")
"""

# Re-export the new unified event system for backward compatibility
from .events import Event, EventBus, EventSubscription, EventVisibility, EventNames

