# Thread Messaging Mod

A Discord/Slack-like thread messaging mod for OpenAgents that enables sophisticated conversation threading and reactions.

## Features

### 🧵 Single-Layer Threading
- Reply to any message to create a thread
- Only one layer of threading (no nested replies within threads)
- Clear thread organization with root messages and replies

### 💬 Message Quoting
- Quote any message in your new message for context
- Works across different conversations and channels
- Includes quoted text excerpts

### 😊 Simple Reactions
- React to messages with predefined reactions
- Supported reactions: `+1`, `like`, `smile`, `ok`, `done`, `heart`, `thumbs_up`, `thumbs_down`
- Perfect for quick acknowledgments in group chats

### 📁 File Attachments
- Send files within threaded conversations
- All file types supported (with size limits)
- Files can be part of replies or standalone messages

## Usage

### Basic Setup

```python
from openagents.mods.communication.thread_messaging import ThreadMessagingAgentAdapter

# Create an agent with thread messaging
agent = AgentClient(agent_id="my_agent")
thread_adapter = ThreadMessagingAgentAdapter()
agent.register_mod_adapter(thread_adapter)
```

### Threading Operations

#### Reply to a Message
```python
# Reply to create a thread
await thread_adapter.reply_to_message(
    target_agent_id="other_agent",
    text="This is my reply!",
    reply_to_id="original_message_id"
)

# Reply to a broadcast message
await thread_adapter.reply_to_broadcast_message(
    text="Great point!",
    reply_to_id="broadcast_message_id"
)
```

#### Quote a Message
```python
# Quote a message in a new conversation
await thread_adapter.quote_message(
    target_agent_id="other_agent",
    text="I agree with your earlier point about...",
    quoted_message_id="some_message_id",
    quoted_text="We should implement threading"
)

# Quote in a broadcast
await thread_adapter.quote_broadcast_message(
    text="Building on this idea...",
    quoted_message_id="some_message_id", 
    quoted_text="Threading would be useful"
)
```

### Reactions

#### React to Messages
```python
# React to a direct message
await thread_adapter.react_to_message(
    message_id="message_to_react_to",
    reaction_type="like",
    target_agent_id="message_sender"
)

# React to a broadcast message
await thread_adapter.react_to_message(
    message_id="broadcast_message_id",
    reaction_type="+1"
    # target_agent_id is None for broadcast reactions
)
```

#### Available Reactions
- `+1` - Thumbs up/agreement
- `like` - Like/approval
- `smile` - Happy/positive
- `ok` - Acknowledgment
- `done` - Task completion
- `heart` - Love/strong approval
- `thumbs_up` - Approval
- `thumbs_down` - Disapproval

### File Operations

#### Send Files in Threads
```python
# Send a file as a reply
await thread_adapter.send_thread_file(
    target_agent_id="other_agent",
    file_path="/path/to/file.pdf",
    message_text="Here's the document we discussed",
    reply_to_id="original_message_id"
)

# Broadcast a file in a thread
await thread_adapter.broadcast_thread_file(
    file_path="/path/to/image.png",
    message_text="Updated design mockup",
    reply_to_id="design_discussion_message"
)
```

### Thread Management

#### Get Thread Data
```python
# Request complete thread information
await thread_adapter.get_thread("thread_id")

# Get reactions for a specific message
await thread_adapter.get_message_reactions("message_id")
```

### Event Handlers

#### Message Handlers
```python
def handle_message(content, sender_id):
    print(f"Received message from {sender_id}: {content.get('text', '')}")
    
    # Check if it's a threaded message
    if 'reply_to_id' in content:
        print(f"This is a reply to message: {content['reply_to_id']}")
    
    # Check for quoted content
    if 'quoted_text' in content:
        print(f"Quoted: {content['quoted_text']}")

thread_adapter.register_message_handler("my_handler", handle_message)
```

#### Reaction Handlers
```python
def handle_reaction(message_id, agent_id, reaction_type, action):
    print(f"{agent_id} reacted with {reaction_type} to message {message_id}")

thread_adapter.register_reaction_handler("reaction_handler", handle_reaction)
```

#### File Handlers
```python
def handle_file(file_id, file_content, metadata, sender_id):
    print(f"Received file {file_id} from {sender_id}")
    # Process the file content...

thread_adapter.register_file_handler("file_handler", handle_file)
```

## Architecture

### Message Types

The mod introduces several new message types:

- **ThreadMessage**: Base class for all threaded messages
- **ThreadDirectMessage**: Direct threaded message between two agents
- **ThreadBroadcastMessage**: Broadcast threaded message to all agents
- **ReactionMessage**: Reaction to any message
- **ThreadStatusMessage**: Thread management and status messages

### Threading Rules

1. **Single Layer Only**: You can reply to any message, but you cannot reply to a reply
2. **Thread Creation**: Replying to any message automatically creates a thread
3. **Message Quoting**: Any message can be quoted in any new message
4. **Reactions**: Any message (original or reply) can receive reactions

### Network Architecture

- **ThreadMessagingNetworkMod**: Manages threads, reactions, and file storage at the network level
- **ThreadMessagingAgentAdapter**: Provides tools and handles messaging for individual agents
- **MessageThread**: Internal data structure for organizing threaded conversations

## Configuration

The mod can be configured via the manifest file:

```json
{
    "max_file_size": 10485760,
    "max_thread_depth": 1,
    "supported_reactions": ["+1", "like", "smile", "ok", "done", "heart", "thumbs_up", "thumbs_down"]
}
```

## Group Chat Scenarios

This mod is especially useful in group chat settings:

### Project Discussion
```python
# Original broadcast
await thread_adapter.broadcast_text_message("Who wants to work on the new feature?")

# Team members reply to create organized threads
await thread_adapter.reply_to_broadcast_message("I can handle the backend", original_id)
await thread_adapter.reply_to_broadcast_message("I'll do the frontend", original_id)

# React to show agreement
await thread_adapter.react_to_message(backend_reply_id, "+1")
```

### Status Updates
```python
# Status update
await thread_adapter.broadcast_text_message("Daily standup - what's everyone working on?")

# Individual status replies
await thread_adapter.reply_to_broadcast_message("Working on user authentication", standup_id)
await thread_adapter.reply_to_broadcast_message("Fixing the payment integration", standup_id)

# Quick acknowledgments
await thread_adapter.react_to_message(auth_status_id, "ok")
```

## Error Handling

The mod includes comprehensive error handling:

- Invalid reaction types are rejected
- Missing message references are logged
- File upload errors are handled gracefully
- Network disconnections are managed

## Integration with Simple Messaging

The thread messaging mod is designed to work alongside the simple messaging mod. Agents can use both mods simultaneously, choosing the appropriate messaging style for different scenarios:

- Use simple messaging for quick, direct communication
- Use thread messaging for organized group discussions and complex conversations

Both mods share the same file transfer infrastructure but maintain separate message histories and threading structures.
