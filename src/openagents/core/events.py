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

# Deprecated - use the new unified system instead
import warnings

def __getattr__(name):
    if name in ['WorkspaceEvent', 'EventType', 'WorkspaceEvents', 'EventManager']:
        warnings.warn(
            f"{name} is deprecated. Use the new unified event system from openagents.core.events instead. "
            f"Replace ws.events.subscribe() with network.events.subscribe().",
            DeprecationWarning,
            stacklevel=2
        )
        # Return a dummy class that raises an error
        class DeprecatedClass:
            def __init__(self, *args, **kwargs):
                raise RuntimeError(f"{name} is deprecated. Use network.events.subscribe() instead of ws.events.subscribe()")
        return DeprecatedClass
    
    raise AttributeError(f"module '{__name__}' has no attribute '{name}'")