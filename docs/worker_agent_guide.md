# WorkerAgent Guide

The `WorkerAgent` class provides a simplified, event-driven interface for creating agents that work with the OpenAgents thread messaging system. It abstracts away the complexity of message routing and provides intuitive handler methods.

## Quick Start

```python
from openagents.agents.worker_agent import WorkerAgent

class EchoAgent(WorkerAgent):
    name = "echo"
    
    async def on_direct(self, msg):
        await self.send_direct(to=msg.sender_id, text=f"Echo: {msg.text}")

# Run the agent
agent = EchoAgent()
agent.start(host="localhost", port=8080, network_id="my-network")
agent.wait_for_stop()
```

## Core Concepts

### Handler Methods

Override these methods to handle different types of messages:

- `on_direct(msg)` - Handle direct messages between agents
- `on_channel_post(msg)` - Handle new posts in channels
- `on_channel_reply(msg)` - Handle replies to messages in channels
- `on_channel_mention(msg)` - Handle when your agent is mentioned
- `on_reaction(msg)` - Handle reactions to messages
- `on_file_received(msg)` - Handle file uploads

### Sending Methods

Use these methods to send messages:

- `send_direct(to, text, quote=None)` - Send direct message
- `send_channel(channel, text, mention=None, quote=None)` - Send channel message
- `send_reply(reply_to_id, text, quote=None)` - Reply to any message
- `react_to(message_id, reaction)` - Add reaction to message
- `upload_file(filename, content, mime_type)` - Upload file

### Message Contexts

Each handler receives a rich context object with convenient properties:

#### DirectMessageContext
- `sender_id` - Who sent the message
- `text` - Message text content
- `timestamp` - When it was sent
- `target_agent_id` - Who it was sent to
- `quoted_text` - Any quoted content

#### ChannelMessageContext
- `sender_id` - Who sent the message
- `text` - Message text content
- `channel` - Which channel
- `mentions` - List of mentioned agent IDs
- `quoted_text` - Any quoted content

#### ReplyMessageContext
- `sender_id` - Who sent the reply
- `text` - Reply text content
- `reply_to_id` - ID of message being replied to
- `thread_level` - Nesting level (1-5)
- `channel` - Channel (if channel reply)

## Configuration

Set these class attributes to configure your agent:

```python
class MyAgent(WorkerAgent):
    name = "my-agent"                    # Agent name/ID
    auto_mention_response = True         # Auto-respond to mentions
    ignore_own_messages = True           # Ignore messages from self
    default_channels = ["#general"]      # Channels to monitor
```

## Advanced Features

### Command Registration

Register text commands that users can invoke:

```python
class CommandAgent(WorkerAgent):
    name = "commander"
    
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.register_command("/help", self._help_command)
        self.register_command("!status", self._status_command)
    
    async def _help_command(self, context, args):
        await self.send_direct(to=context.sender_id, text="Help text here")
```

### Lifecycle Hooks

Override these methods for setup and cleanup:

```python
class LifecycleAgent(WorkerAgent):
    async def on_startup(self):
        """Called after connection and setup"""
        print("Agent is ready!")
    
    async def on_shutdown(self):
        """Called before disconnection"""
        print("Agent shutting down...")
```

### Scheduled Tasks

Schedule delayed or recurring tasks:

```python
class ScheduledAgent(WorkerAgent):
    async def on_startup(self):
        # Send a message after 5 seconds
        await self.schedule_task(5.0, self._delayed_greeting)
    
    async def _delayed_greeting(self):
        await self.send_channel("#general", "Hello everyone!")
```

### Utility Methods

- `is_mentioned(text)` - Check if agent is mentioned in text
- `extract_mentions(text)` - Get all mentioned agent IDs
- `get_channels()` - Get available channels
- `get_channel_messages(channel, limit, offset)` - Get channel history
- `get_direct_messages(with_agent, limit, offset)` - Get DM history

## Complete Example

```python
class HelpfulAgent(WorkerAgent):
    name = "helpful"
    default_channels = ["#general", "#help"]
    
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.register_command("/help", self._help_command)
        self.register_command("!status", self._status_command)
    
    async def on_startup(self):
        await self.send_channel("#general", "🤖 HelpfulAgent is online!")
    
    async def on_direct(self, msg):
        if "hello" in msg.text.lower():
            await self.send_direct(
                to=msg.sender_id,
                text=f"Hello {msg.sender_id}! How can I help?"
            )
        else:
            await self.send_direct(
                to=msg.sender_id,
                text="I'm here to help! Type /help for commands."
            )
    
    async def on_channel_mention(self, msg):
        await self.send_channel(
            channel=msg.channel,
            text=f"Hi {msg.sender_id}! What do you need?",
            mention=msg.sender_id
        )
    
    async def on_file_received(self, msg):
        await self.send_direct(
            to=msg.sender_id,
            text=f"📁 Received: {msg.filename} ({msg.file_size} bytes)"
        )
    
    async def _help_command(self, context, args):
        help_text = "Available commands: /help, !status"
        if hasattr(context, 'sender_id'):  # Direct message
            await self.send_direct(to=context.sender_id, text=help_text)
        else:  # Channel message
            await self.send_reply(reply_to_id=context.message_id, text=help_text)
    
    async def _status_command(self, context, args):
        status = f"Agent {self.name} is running with {len(self.tools)} tools"
        if hasattr(context, 'sender_id'):
            await self.send_direct(to=context.sender_id, text=status)
        else:
            await self.send_reply(reply_to_id=context.message_id, text=status)

# Run the agent
if __name__ == "__main__":
    agent = HelpfulAgent()
    try:
        agent.start(host="localhost", port=8080, network_id="example")
        agent.wait_for_stop()
    except KeyboardInterrupt:
        agent.stop()
```

## Running Multiple Agents

```python
import asyncio

async def run_agents():
    agents = [
        EchoAgent(),
        HelpfulAgent(),
        FileProcessorAgent()
    ]
    
    # Start all agents
    start_tasks = [
        agent.async_start(host="localhost", port=8080, network_id="example")
        for agent in agents
    ]
    await asyncio.gather(*start_tasks)
    
    # Keep running until interrupted
    try:
        await asyncio.Event().wait()
    except KeyboardInterrupt:
        pass
    finally:
        # Stop all agents
        stop_tasks = [agent.async_stop() for agent in agents]
        await asyncio.gather(*stop_tasks, return_exceptions=True)

if __name__ == "__main__":
    asyncio.run(run_agents())
```

## Error Handling

The WorkerAgent automatically handles many common errors, but you should still add error handling in your handlers:

```python
async def on_direct(self, msg):
    try:
        # Your message processing logic
        result = await some_processing(msg.text)
        await self.send_direct(to=msg.sender_id, text=f"Result: {result}")
    except Exception as e:
        logger.error(f"Error processing message: {e}")
        await self.send_direct(
            to=msg.sender_id, 
            text="Sorry, I encountered an error processing your message."
        )
```

## Best Practices

1. **Keep handlers lightweight** - Don't block the event loop with long-running operations
2. **Use proper logging** - Log important events and errors
3. **Handle errors gracefully** - Always provide feedback to users when things go wrong
4. **Test your agents** - Create unit tests for your handler methods
5. **Use meaningful names** - Choose descriptive agent names and command names
6. **Document your commands** - Provide help text for user commands
7. **Respect rate limits** - Don't spam channels or users with too many messages

## Migration from AgentRunner

If you have existing agents using `AgentRunner`, migration is straightforward:

1. Change base class from `AgentRunner` to `WorkerAgent`
2. Replace the `react()` method with specific handler methods
3. Use the new sending methods instead of direct mod adapter calls
4. Update message handling to use the new context objects

The WorkerAgent provides the same underlying functionality as AgentRunner but with a much more convenient interface.
