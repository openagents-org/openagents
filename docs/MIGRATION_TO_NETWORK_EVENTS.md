# Migration Guide: Workspace Events → Network Events

This document explains the migration from the old workspace-level event system to the new unified network-level event system.

## Overview

The OpenAgents event system has been unified and moved from workspace-level to network-level for better performance, consistency, and observability.

### Key Changes

- **Event Location**: Events are now handled at `network.events` instead of `ws.events`
- **Unified System**: All message types (Direct, Broadcast, Mod) are now unified as `Event` objects
- **Pattern Matching**: Subscribe to event patterns like `"project.*"` or `"channel.message.*"`
- **Better Performance**: Direct event delivery without workspace overhead
- **Global Scope**: Events are visible across the entire network, not just individual workspaces

## Migration Steps

### 1. Update Event Subscriptions

**Before (Deprecated):**
```python
# Old workspace-level events
ws = network.workspace()
subscription = ws.events.subscribe([
    "project.created",
    "project.run.completed",
    "channel.message.received"
])

async for event in subscription:
    print(f"Event: {event.event_name}")
```

**After (New System):**
```python
# New network-level events
subscription = network.events.subscribe(
    "my-agent",
    ["project.*", "channel.message.*"]
)

# Option 1: Event queue polling
network.events.register_agent("my-agent")
while True:
    events = await network.events.poll_events("my-agent")
    for event in events:
        print(f"Event: {event.event_name}")
    await asyncio.sleep(1.0)

# Option 2: Direct subscription processing (if supported by your use case)
# Events are automatically delivered to matching subscriptions
```

### 2. Update Event Names

The new system uses hierarchical event names:

| Old Event Name | New Event Name |
|----------------|----------------|
| `"project.created"` | `"project.created"` ✅ (same) |
| `"project.run.completed"` | `"project.run.completed"` ✅ (same) |
| `"channel.message.received"` | `"channel.message.posted"` ⚠️ (changed) |
| `"agent.direct_message.received"` | `"agent.direct_message.received"` ✅ (same) |

### 3. Update Event Data Access

**Before:**
```python
# Old WorkspaceEvent
print(f"Channel: {event.channel}")
print(f"Data: {event.data}")
print(f"Source: {event.source_agent_id}")
```

**After:**
```python
# New Event
print(f"Channel: {event.target_channel}")
print(f"Payload: {event.payload}")
print(f"Source: {event.source_agent_id}")
```

### 4. Update Event Filtering

**Before:**
```python
# Old filtering via subscription filters
subscription = ws.events.subscribe(
    ["channel.message.received"],
    filters={"channel": "#general"}
)
```

**After:**
```python
# New filtering via subscription parameters
subscription = network.events.subscribe(
    "my-agent",
    ["channel.message.*"],
    channel_filter="#general"
)
```

## New Features

### Pattern-Based Subscriptions

Subscribe to multiple related events with patterns:

```python
# Subscribe to all project events
network.events.subscribe("agent1", ["project.*"])

# Subscribe to all channel messages
network.events.subscribe("agent1", ["channel.message.*"])

# Subscribe to everything
network.events.subscribe("agent1", ["*"])
```

### Advanced Filtering

```python
# Filter by mod
network.events.subscribe(
    "agent1", 
    ["project.*"],
    mod_filter="project.default"
)

# Filter by channel
network.events.subscribe(
    "agent1",
    ["channel.*"],
    channel_filter="#general"
)

# Filter by source agent
network.events.subscribe(
    "agent1",
    ["*"],
    agent_filter={"specific-agent"}
)
```

### Event Statistics

```python
# Get event bus statistics
stats = network.events.get_stats()
print(f"Total events: {stats['total_events']}")
print(f"Active subscriptions: {stats['active_subscriptions']}")
print(f"Events by name: {stats['events_by_name']}")
```

## Examples

### Basic Event Subscription

```python
import asyncio
from openagents.core.network import AgentNetwork

async def main():
    network = AgentNetwork.load("config.yaml")
    await network.initialize()
    
    # Subscribe to project events
    subscription = network.events.subscribe(
        "my-agent",
        ["project.*"]
    )
    
    # Create event queue
    network.events.register_agent("my-agent")
    
    # Process events
    while True:
        events = await network.events.poll_events("my-agent")
        for event in events:
            print(f"Received: {event.event_name}")
            print(f"From: {event.source_id}")
            print(f"Data: {event.payload}")
            
            if event.event_name == "project.run.completed":
                break
        await asyncio.sleep(1.0)
    
    # Cleanup
    network.events.unsubscribe(subscription.subscription_id)
    network.events.remove_agent_event_queue("my-agent")

asyncio.run(main())
```

### Event Emission

```python
from openagents.core.events import Event, EventNames

# Create and emit custom event
event = Event(
    event_name=EventNames.PROJECT_CREATED,
    source_agent_id="my-agent",
    payload={
        "project_id": "proj-123",
        "project_name": "My Project"
    }
)

await network.emit_event(event)
```

## Backward Compatibility

The old workspace event system has been deprecated but not removed. Attempting to use it will show deprecation warnings:

```python
# This will show a deprecation warning
ws.events.subscribe(...)  # DeprecationWarning: Use network.events.subscribe() instead
```

## Migration Checklist

- [ ] Replace `ws.events.subscribe()` with `network.events.subscribe()`
- [ ] Update event name references if needed
- [ ] Change `event.data` to `event.payload`
- [ ] Change `event.channel` to `event.target_channel`
- [ ] Update event filtering syntax
- [ ] Add agent_id parameter to subscriptions
- [ ] Use event queues for polling-based event processing
- [ ] Update cleanup code to use `network.events.unsubscribe()`
- [ ] Test event subscription and emission
- [ ] Remove deprecated workspace event imports

## Benefits

1. **Unified Architecture**: All interactions flow through one event system
2. **Better Performance**: Direct event delivery without workspace overhead
3. **Pattern Matching**: Flexible subscription patterns like `"project.*"`
4. **Global Scope**: Events visible across entire network
5. **Enhanced Filtering**: Fine-grained control over event delivery
6. **Better Observability**: Centralized event statistics and history
7. **Simplified API**: Consistent interface for all event types

## Support

For questions about the migration, please refer to:
- `examples/network_events_example.py` - Complete example
- `tests/test_unified_event_system.py` - Test cases
- Network event system documentation
