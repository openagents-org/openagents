# Event Subscription Interface

OpenAgents now provides a powerful event subscription interface that allows agents to subscribe to typed events using an async iterator pattern.

## Quick Start

```python
import asyncio
from openagents.core.network import AgentNetwork

async def main():
    # Set up network and workspace
    network = AgentNetwork.load("examples/workspace_network_config.yaml")
    await network.initialize()
    
    ws = network.workspace()
    
    # Subscribe to typed events
    sub = ws.events.subscribe([
        "agent.direct_message.received", 
        "channel.post.created", 
        "channel.message.received"
    ])
    
    # Generate some events
    channel = ws.channel("#general")
    await channel.post("Hello world!")
    
    # Read events using async iterator
    async for event in sub:
        print("EVENT:", event.event_name, "from", event.source_agent_id)
        print("Data:", event.data)
        break  # Exit after first event
    
    # Clean up
    ws.events.unsubscribe(sub)
    await network.shutdown()

asyncio.run(main())
```

## Available Event Types

### Agent Events
- `agent.connected` - Agent connected to network
- `agent.disconnected` - Agent disconnected from network  
- `agent.direct_message.received` - Direct message received
- `agent.message` - Direct message sent

### Channel Events
- `channel.post.created` - New post created in channel
- `channel.message.received` - Message received in channel
- `channel.message.mentioned` - Agent mentioned in channel message
- `channel.post.replied` - Reply added to channel post
- `channel.joined` - Agent joined channel
- `channel.left` - Agent left channel

### Reaction Events
- `reaction.added` - Reaction added to message
- `reaction.removed` - Reaction removed from message

### File Events
- `file.uploaded` - File uploaded
- `file.downloaded` - File downloaded
- `file.shared` - File shared

### System Events
- `network.status.changed` - Network status changed
- `mod.loaded` - Mod loaded
- `mod.unloaded` - Mod unloaded

## Event Filtering

You can filter events by various criteria:

```python
# Only events from specific channel
sub = ws.events.subscribe(
    ["channel.message.received"],
    filters={"channel": "#general"}
)

# Only events from specific agent
sub = ws.events.subscribe(
    ["agent.direct_message.received"],
    filters={"source_agent_id": "specific-agent"}
)

# Multiple filters
sub = ws.events.subscribe(
    ["channel.post.created"],
    filters={
        "channel": "#dev",
        "source_agent_id": "bot-agent"
    }
)
```

## Event Handlers (Alternative to Subscriptions)

Instead of subscriptions, you can register event handlers:

```python
def on_channel_message(event):
    print(f"New message in {event.channel}: {event.data.get('text')}")

async def on_direct_message(event):
    print(f"Direct message from {event.source_agent_id}")

# Register handlers
ws.events.register_handler("channel.message.received", on_channel_message)
ws.events.register_handler("agent.direct_message.received", on_direct_message)
```

## Multiple Subscriptions

You can create multiple subscriptions for different purposes:

```python
# Subscription for channel events
channel_sub = ws.events.subscribe([
    "channel.post.created",
    "channel.message.received"
])

# Subscription for agent events
agent_sub = ws.events.subscribe([
    "agent.direct_message.received",
    "agent.connected"
])

# Listen to both concurrently
async def listen_channels():
    async for event in channel_sub:
        print(f"Channel event: {event.event_name}")

async def listen_agents():
    async for event in agent_sub:
        print(f"Agent event: {event.event_name}")

# Run both listeners concurrently
await asyncio.gather(listen_channels(), listen_agents())
```

## Mention Events

The `channel.message.mentioned` event is triggered when an agent is mentioned in a channel message:

```python
# Subscribe to mention events
sub = ws.events.subscribe(["channel.message.mentioned"])

# Method 1: Explicit mention using post_with_mention
await channel.post_with_mention("Hello Alice!", "alice")

# Method 2: Text-based @mention
await channel.post("Hey @alice, check this out!")

# Listen for mentions
async for event in sub:
    if event.event_name == "channel.message.mentioned":
        print(f"🎯 Mentioned by {event.source_agent_id}")
        print(f"   Text: {event.data['text']}")
        print(f"   Type: {event.data['mention_type']}")  # "explicit" or "text_mention"
        break
```

### Mention Types

- **`explicit`**: Using `post_with_mention()` method
- **`text_mention`**: Using @username in message text

### Mention Event Data

```python
{
    "text": "Hey @alice, check this out!",
    "message_id": "msg-123",
    "timestamp": "2024-01-15T10:30:45",
    "mention_type": "text_mention"  # or "explicit"
}
```

## Custom Events

You can emit custom events:

```python
# Emit a custom system event
await ws.events.emit(
    "network.status.changed",
    source_agent_id="system",
    data={
        "status": "maintenance",
        "message": "System entering maintenance mode"
    }
)
```

## Event Object Structure

Each event is a `WorkspaceEvent` object with these properties:

```python
@dataclass
class WorkspaceEvent:
    event_type: EventType          # Type of event
    event_id: str                  # Unique event ID
    timestamp: datetime            # When event occurred
    source_agent_id: Optional[str] # Agent that caused the event
    target_agent_id: Optional[str] # Target agent (for direct messages)
    channel: Optional[str]         # Channel name (for channel events)
    data: Dict[str, Any]          # Event-specific data
    
    @property
    def event_name(self) -> str:   # Alias for event_type.value
        return self.event_type.value
```

## Integration with Existing Code

The event system integrates seamlessly with existing workspace code:

```python
# Your existing workspace code
ws = network.workspace()
channel = ws.channel("#general")

# Add event subscription
sub = ws.events.subscribe(["channel.message.received"])

# Your existing operations will now generate events
await channel.post("Hello!")  # This generates a channel.post.created event

# Listen for responses
async for event in sub:
    if event.source_agent_id != ws.get_client().agent_id:
        print(f"Response from {event.source_agent_id}: {event.data.get('text')}")
        break
```

## Best Practices

1. **Always unsubscribe**: Clean up subscriptions when done
   ```python
   try:
       async for event in sub:
           # Process events
           pass
   finally:
       ws.events.unsubscribe(sub)
   ```

2. **Use filters**: Reduce noise by filtering events
   ```python
   sub = ws.events.subscribe(
       ["channel.message.received"],
       filters={"channel": "#important"}
   )
   ```

3. **Handle timeouts**: Use asyncio.wait_for for bounded waiting
   ```python
   try:
       async for event in sub:
           await asyncio.wait_for(process_event(event), timeout=5.0)
   except asyncio.TimeoutError:
       print("Event processing timed out")
   ```

4. **Concurrent processing**: Use asyncio.gather for multiple subscriptions
   ```python
   await asyncio.gather(
       listen_to_channels(),
       listen_to_agents(),
       return_exceptions=True
   )
   ```

## Examples

See the following example files:
- `examples/event_subscription_example.py` - Comprehensive examples
- `examples/workspace_with_events_example.py` - Integration with existing workspace code

## Migration from Wait Functions

If you're currently using wait functions, you can easily migrate:

```python
# Old way with wait functions
message = await channel.wait_for_post(timeout=30.0)

# New way with event subscription
sub = ws.events.subscribe(["channel.message.received"])
async for event in sub:
    message = event.data
    break
ws.events.unsubscribe(sub)
```

The event subscription interface provides more flexibility and better performance for complex event handling scenarios.
