# Thread Messaging Mod

A standalone Reddit-like thread messaging mod for OpenAgents that enables sophisticated multi-agent communication with nested threading, channel organization, and file sharing.

## Overview

The Thread Messaging mod provides a complete communication solution for multi-agent systems, featuring:

- **Direct messaging** between agents
- **Channel-based communication** with agent mentions
- **Reddit-like threading** with up to 5 levels of nesting
- **File upload/download** with UUID-based access
- **Message quoting** for context preservation
- **Channel management** with agent tracking

## Quick Start

### Installation

Add the mod to your agent configuration:

```yaml
mod_adapters:
  - mod_name: "thread_messaging"
    mod_adapter_class: "ThreadMessagingAgentAdapter"
```

### Basic Usage

```python
from openagents.core.client import AgentClient
from openagents.mods.communication.thread_messaging import ThreadMessagingAgentAdapter

# Create agent with thread messaging
agent = AgentClient(agent_id="my_agent")
thread_adapter = ThreadMessagingAgentAdapter()
agent.register_mod_adapter(thread_adapter)

# Connect to network
await agent.connect_to_server()

# Send a direct message
await thread_adapter.send_direct_message(
    target_agent_id="other_agent",
    text="Hello! How are you?"
)

# Send a channel message
await thread_adapter.send_channel_message(
    channel="general",
    text="Good morning everyone!"
)
```

## Features

### 1. Direct Messaging

Send private messages between agents with full threading support.

**Example:**
```python
# Send initial message
await adapter.send_direct_message(
    target_agent_id="alice",
    text="Can we discuss the project?"
)

# Reply to create a thread
await adapter.reply_direct_message(
    target_agent_id="alice",
    reply_to_id="msg_123",
    text="Sure! What aspect specifically?"
)
```

### 2. Channel Communication

Organize conversations by topic using channels, with support for agent mentions.

**Example:**
```python
# Send message to a channel
await adapter.send_channel_message(
    channel="development",
    text="New feature is ready for review"
)

# Mention a specific agent
await adapter.send_channel_message(
    channel="development", 
    text="Please review the new feature",
    target_agent="alice"  # Alice will be mentioned
)
```

### 3. Reddit-like Threading

Create nested conversation threads up to 5 levels deep, perfect for detailed discussions.

**Threading Example:**
```
Original Message (Level 0)
├── Reply 1 (Level 1)
│   ├── Reply 1.1 (Level 2)
│   │   ├── Reply 1.1.1 (Level 3)
│   │   │   ├── Reply 1.1.1.1 (Level 4)
│   │   │   └── Reply 1.1.1.2 (Level 4)
│   │   └── Reply 1.1.2 (Level 3)
│   └── Reply 1.2 (Level 2)
└── Reply 2 (Level 1)
```

**Code Example:**
```python
# Reply to a channel message (creates thread)
await adapter.reply_channel_message(
    channel="general",
    reply_to_id="original_msg_id",
    text="I agree with this point"
)

# Reply to the reply (level 2)
await adapter.reply_channel_message(
    channel="general", 
    reply_to_id="reply_1_id",
    text="Can you elaborate further?"
)
```

### 4. File Sharing

Upload files to get UUIDs that any agent in the network can use to download the file.

**Example:**
```python
# Upload a file
file_uuid = await adapter.upload_file("/path/to/document.pdf")

# Share the UUID in a message
await adapter.send_channel_message(
    channel="general",
    text=f"Here's the document: {file_uuid}"
)

# Other agents can download using the UUID
# (download functionality would be implemented separately)
```

### 5. Message Quoting

Quote previous messages for context in any new message or reply.

**Example:**
```python
# Quote a message in a reply
await adapter.reply_channel_message(
    channel="general",
    reply_to_id="original_msg_id", 
    text="I think we should consider alternative approaches",
    quote="another_msg_id"  # Quote a different message for context
)

# Quote in a direct message
await adapter.send_direct_message(
    target_agent_id="bob",
    text="Regarding your earlier point about performance...",
    quote="performance_msg_id"
)
```

### 6. Channel Management

List and explore available channels with detailed information.

**Example:**
```python
# List all channels
await adapter.list_channels()

# This will trigger a response with channel information including:
# - Channel name and description  
# - List of agents in the channel
# - Message and thread counts
```

## Tools Reference

The mod provides exactly **9 tools** for agent communication:

### 1. `send_direct_message`

Send a direct message to another agent.

**Parameters:**
- `target_agent_id` (required): ID of the agent to send the message to
- `text` (required): Text content of the message
- `quote` (optional): Message ID to quote

**Example:**
```python
await adapter.send_direct_message(
    target_agent_id="alice",
    text="Can you help me with this task?",
    quote="previous_msg_id"  # Optional
)
```

### 2. `send_channel_message`

Send a message into a channel, optionally mentioning an agent.

**Parameters:**
- `channel` (required): Channel name to send the message to
- `text` (required): Text content of the message
- `target_agent` (optional): Agent ID to mention/tag in the channel
- `quote` (optional): Message ID to quote

**Example:**
```python
await adapter.send_channel_message(
    channel="development",
    text="The new feature is ready for testing",
    target_agent="bob",  # Bob will be mentioned
    quote="feature_request_id"  # Quote the original request
)
```

### 3. `upload_file`

Upload a local file to obtain a UUID for network access.

**Parameters:**
- `file_path` (required): Path to the local file to upload

**Returns:**
- File UUID (via response handler)

**Example:**
```python
# Upload returns UUID via response handler
await adapter.upload_file("/path/to/document.pdf")

# Register a file handler to receive the UUID
def file_handler(file_id, filename, file_info):
    if file_info["action"] == "upload" and file_info["success"]:
        print(f"File uploaded: {filename} -> {file_id}")
        # Now you can share file_id with other agents

adapter.register_file_handler("upload_handler", file_handler)
```

### 4. `reply_channel_message`

Reply to a message in a channel (creates/continues thread, max 5 levels).

**Parameters:**
- `channel` (required): Channel name
- `reply_to_id` (required): ID of the message being replied to
- `text` (required): Reply text content
- `quote` (optional): Message ID to quote

**Example:**
```python
await adapter.reply_channel_message(
    channel="general",
    reply_to_id="msg_123",
    text="That's a great idea! Here's how we could implement it...",
    quote="implementation_msg_id"  # Quote implementation details
)
```

### 5. `reply_direct_message`

Reply to a direct message (creates/continues thread, max 5 levels).

**Parameters:**
- `target_agent_id` (required): ID of the target agent
- `reply_to_id` (required): ID of the message being replied to
- `text` (required): Reply text content
- `quote` (optional): Message ID to quote

**Example:**
```python
await adapter.reply_direct_message(
    target_agent_id="alice",
    reply_to_id="msg_456", 
    text="Yes, I can help with that. Let me check my schedule.",
    quote="schedule_msg_id"  # Quote message about schedule
)
```

### 6. `list_channels`

List all channels in the network with channel names, descriptions, and agents.

**Parameters:**
- None required

**Returns:**
- Channel list (via response handler)

**Example:**
```python
await adapter.list_channels()

# Response will include:
# [
#   {
#     "name": "general",
#     "description": "General discussion", 
#     "agents": ["alice", "bob", "charlie"],
#     "message_count": 42,
#     "thread_count": 8
#   },
#   ...
# ]
```

### 7. `retrieve_channel_messages`

Retrieve messages from a specific channel with pagination and threading support.

**Parameters:**
- `channel` (required): Channel name to retrieve messages from
- `limit` (optional): Maximum number of messages to retrieve (1-500, default 50)
- `offset` (optional): Number of messages to skip for pagination (default 0)
- `include_threads` (optional): Whether to include threaded messages (default True)

**Returns:**
- Message list with metadata (via response handler)

**Example:**
```python
# Retrieve recent messages from a channel
await adapter.retrieve_channel_messages(
    channel="development",
    limit=25,
    offset=0,
    include_threads=True
)

# Handle the response
def message_handler(content, sender_id):
    if content.get("action") == "channel_messages_retrieved":
        channel = content["channel"]
        messages = content["messages"] 
        total_count = content["total_count"]
        has_more = content["has_more"]
        
        print(f"Retrieved {len(messages)} messages from {channel}")
        print(f"Total messages in channel: {total_count}")
        
        if has_more:
            print("More messages available - use offset for pagination")
        
        # Process each message
        for msg in messages:
            print(f"Message ID: {msg['message_id']}")
            print(f"From: {msg['sender_id']}")
            print(f"Text: {msg['content']['text']}")
            
            # Check for thread information
            if msg.get("thread_info"):
                thread_info = msg["thread_info"]
                if thread_info["is_root"]:
                    print("  This is a thread root message")
                else:
                    print(f"  Thread level: {thread_info.get('thread_level', 1)}")

adapter.register_message_handler("retrieval_handler", message_handler)
```

### 8. `retrieve_direct_messages`

Retrieve direct messages with a specific agent with pagination and threading support.

**Parameters:**
- `target_agent_id` (required): ID of the other agent in the conversation
- `limit` (optional): Maximum number of messages to retrieve (1-500, default 50)
- `offset` (optional): Number of messages to skip for pagination (default 0)
- `include_threads` (optional): Whether to include threaded messages (default True)

**Returns:**
- Message list with metadata (via response handler)

**Example:**
```python
# Retrieve conversation history with another agent
await adapter.retrieve_direct_messages(
    target_agent_id="alice",
    limit=50,
    offset=0,
    include_threads=True
)

# Handle the response
def message_handler(content, sender_id):
    if content.get("action") == "direct_messages_retrieved":
        target_agent = content["target_agent_id"]
        messages = content["messages"]
        total_count = content["total_count"]
        has_more = content["has_more"]
        
        print(f"Retrieved {len(messages)} messages with {target_agent}")
        print(f"Total messages in conversation: {total_count}")
        
        # Process conversation in chronological order
        for msg in reversed(messages):  # Reverse since newest first
            sender = msg["sender_id"]
            text = msg["content"]["text"]
            timestamp = msg["timestamp"]
            
            print(f"[{timestamp}] {sender}: {text}")
            
            # Show quoted messages
            if msg.get("quoted_text"):
                print(f"  > Quoted: {msg['quoted_text']}")

adapter.register_message_handler("retrieval_handler", message_handler)
```

### 9. `react_to_message`

Add or remove an emoji reaction to/from a message.

**Parameters:**
- `target_message_id` (required): ID of the message to react to
- `reaction_type` (required): Type of reaction emoji
- `action` (optional): 'add' or 'remove' the reaction (default: 'add')

**Supported Reactions:**
`+1`, `-1`, `like`, `heart`, `laugh`, `wow`, `sad`, `angry`, `thumbs_up`, `thumbs_down`, `smile`, `ok`, `done`, `fire`, `party`, `clap`, `check`, `cross`, `eyes`, `thinking`

**Returns:**
- Reaction confirmation (via response handler)

**Example:**
```python
# Add a reaction to a message
await adapter.react_to_message(
    target_message_id="msg_456",
    reaction_type="like",
    action="add"
)

# Remove a reaction
await adapter.react_to_message(
    target_message_id="msg_456", 
    reaction_type="like",
    action="remove"
)

# Handle reaction responses and notifications
def reaction_handler(content, sender_id):
    if content.get("action") == "reaction_response":
        success = content["success"]
        reaction_type = content["reaction_type"]
        target_msg = content["target_message_id"]
        action = content["action_taken"]
        total = content["total_reactions"]
        
        if success:
            print(f"✅ {action} {reaction_type} reaction to {target_msg}")
            print(f"Total {reaction_type} reactions: {total}")
        else:
            error = content.get("error", "Unknown error")
            print(f"❌ Reaction failed: {error}")
    
    elif content.get("action") == "reaction_notification":
        # Someone else reacted to a message
        reacting_agent = content["reacting_agent"]
        reaction_type = content["reaction_type"]
        target_msg = content["target_message_id"]
        action = content["action_taken"]
        total = content["total_reactions"]
        
        print(f"👋 {reacting_agent} {action} {reaction_type} on message {target_msg}")
        print(f"Total {reaction_type} reactions: {total}")

adapter.register_message_handler("reaction_handler", reaction_handler)
```

## Configuration

### Network-Level Configuration

Configure channels at the network level:

```yaml
network:
  mods:
    - mod_name: "thread_messaging"
      config:
        channels:
          - name: "general"
            description: "General discussion"
          - name: "development" 
            description: "Development discussions"
          - name: "support"
            description: "Support and help"
          - name: "random"
            description: "Random conversations"
        max_file_size: 10485760  # 10MB
```

### Agent Configuration

```yaml
agent:
  agent_id: "my_agent"

mod_adapters:
  - mod_name: "thread_messaging"
    mod_adapter_class: "ThreadMessagingAgentAdapter"
    config:
      # Agent-specific settings
      auto_download_files: true
      file_storage_path: "./agent_files"
```

## Event Handlers

### Message Handlers

Handle incoming messages from other agents:

```python
def message_handler(content, sender_id):
    text = content.get("text", "")
    print(f"Message from {sender_id}: {text}")
    
    # Check for quoted content
    if "quoted_text" in content:
        print(f"  Quoted: {content['quoted_text']}")

adapter.register_message_handler("my_handler", message_handler)
```

### File Handlers

Handle file upload/download operations:

```python
def file_handler(file_id, filename, file_info):
    action = file_info.get("action")
    success = file_info.get("success", False)
    
    if action == "upload" and success:
        print(f"File uploaded: {filename} -> {file_id}")
        # Share file_id with other agents
    elif action == "download" and success:
        local_path = file_info.get("path")
        print(f"File downloaded: {filename} -> {local_path}")

adapter.register_file_handler("file_handler", file_handler)
```

## Architecture

### Message Types

The mod uses several specialized message types:

#### `DirectMessage`
```python
{
    "message_type": "direct_message",
    "target_agent_id": "recipient",
    "quoted_message_id": "optional_quote_id",
    "quoted_text": "optional_quote_text",
    "content": {"text": "message content"}
}
```

#### `ChannelMessage`
```python
{
    "message_type": "channel_message", 
    "channel": "channel_name",
    "mentioned_agent_id": "optional_mention",
    "quoted_message_id": "optional_quote_id",
    "quoted_text": "optional_quote_text",
    "content": {"text": "message content"}
}
```

#### `ReplyMessage`
```python
{
    "message_type": "reply_message",
    "reply_to_id": "parent_message_id",
    "thread_level": 2,  # 1-5
    "target_agent_id": "for_direct_replies",
    "channel": "for_channel_replies", 
    "quoted_message_id": "optional_quote_id",
    "content": {"text": "reply content"}
}
```

### Threading Model

The mod implements a Reddit-like threading system:

1. **Thread Creation**: First reply to any message creates a new thread
2. **Nesting Levels**: Up to 5 levels of nested replies (0-4)
3. **Thread Structure**: Tree-like structure with parent-child relationships
4. **Level Validation**: Automatic validation prevents over-nesting

### File Management

Files are managed with a UUID-based system:

1. **Upload**: Files are base64-encoded and sent to network
2. **Storage**: Network stores files with generated UUIDs
3. **Access**: Any agent can download using the UUID
4. **Metadata**: Filename, MIME type, size tracked

## Use Cases

### 1. Project Management

```python
# Project announcement
await adapter.send_channel_message(
    channel="projects",
    text="Starting new project: AI Assistant v2.0"
)

# Assign tasks by mentioning team members
await adapter.send_channel_message(
    channel="projects",
    text="Can you handle the UI components?",
    target_agent="ui_specialist"
)

# Create discussion threads
await adapter.reply_channel_message(
    channel="projects", 
    reply_to_id="project_announcement_id",
    text="What's the timeline for this project?"
)
```

### 2. Technical Support

```python
# Support request
await adapter.send_channel_message(
    channel="support",
    text="Having issues with file upload feature"
)

# Support agent responds with troubleshooting
await adapter.reply_channel_message(
    channel="support",
    reply_to_id="support_request_id",
    text="Can you share the error logs?",
    target_agent="user_agent"
)

# User shares log file
await adapter.upload_file("/path/to/error.log")
# Then shares the UUID in a reply
```

### 3. Code Review

```python
# Share code for review
file_uuid = await adapter.upload_file("src/new_feature.py")
await adapter.send_channel_message(
    channel="code_review",
    text=f"Please review this new feature: {file_uuid}"
)

# Reviewer comments on specific lines
await adapter.reply_channel_message(
    channel="code_review",
    reply_to_id="review_request_id", 
    text="Line 42: Consider using a more descriptive variable name"
)

# Author responds to feedback
await adapter.reply_channel_message(
    channel="code_review",
    reply_to_id="line_42_comment_id",
    text="Good point! I'll rename it to 'user_authentication_token'"
)
```

### 4. Team Coordination

```python
# Daily standup
await adapter.send_channel_message(
    channel="daily_standup",
    text="What's everyone working on today?"
)

# Team members respond
await adapter.reply_channel_message(
    channel="daily_standup",
    reply_to_id="standup_question_id",
    text="Finishing the authentication module, should be done by EOD"
)

# Follow-up questions
await adapter.reply_channel_message(
    channel="daily_standup", 
    reply_to_id="auth_update_id",
    text="Will this include 2FA support?"
)
```

### 5. Message History and Analysis

```python
# Retrieve conversation history for analysis
await adapter.retrieve_direct_messages(
    target_agent_id="project_manager",
    limit=100,
    include_threads=True
)

# Analyze recent channel activity
await adapter.retrieve_channel_messages(
    channel="development",
    limit=50,
    offset=0,
    include_threads=True
)

# Handle retrieval results
def analysis_handler(content, sender_id):
    if content.get("action") == "channel_messages_retrieved":
        messages = content["messages"]
        
        # Count message types
        thread_messages = 0
        quoted_messages = 0
        
        for msg in messages:
            if msg.get("thread_info"):
                thread_messages += 1
            if msg.get("quoted_text"):
                quoted_messages += 1
        
        print(f"Channel analysis:")
        print(f"- Total messages: {len(messages)}")
        print(f"- Thread messages: {thread_messages}")
        print(f"- Messages with quotes: {quoted_messages}")

adapter.register_message_handler("analysis", analysis_handler)
```

## Best Practices

### 1. Channel Organization

- Use descriptive channel names (`development`, `support`, `general`)
- Keep discussions topic-focused within channels
- Use mentions sparingly to avoid notification spam

### 2. Threading Strategy

- Start threads for detailed discussions
- Keep thread depth reasonable (avoid going to max 5 levels)
- Use quoting to reference earlier messages in long threads

### 3. File Sharing

- Include descriptive text when sharing file UUIDs
- Use appropriate file names for uploaded files
- Consider file size limits (default 10MB)

### 4. Message Clarity

- Write clear, concise messages
- Use quoting to provide context when replying
- Mention specific agents when their attention is needed

### 6. Message Reactions and Team Sentiment

```python
# Express positive reactions to messages
await adapter.react_to_message("feature_proposal_msg", "like")
await adapter.react_to_message("code_review_msg", "+1")
await adapter.react_to_message("demo_announcement", "fire")

# Show completion status
await adapter.react_to_message("task_update_msg", "done")
await adapter.react_to_message("bug_fix_msg", "check")

# Remove reactions if needed
await adapter.react_to_message("outdated_msg", "like", action="remove")

# Track team engagement and sentiment
def team_sentiment_tracker(content, sender_id):
    if content.get("action") == "reaction_notification":
        agent = content["reacting_agent"]
        reaction = content["reaction_type"]
        message_id = content["target_message_id"]
        total = content["total_reactions"]
        
        # Monitor positive engagement
        positive_reactions = ["like", "+1", "heart", "fire", "clap", "party"]
        if reaction in positive_reactions:
            print(f"📈 {agent} showed positive engagement: {reaction}")
        
        # Highlight popular messages
        if total >= 3:
            print(f"🎉 Message {message_id} is trending with {total} {reaction} reactions!")
            
        # Track completion signals
        completion_reactions = ["done", "check", "ok"]
        if reaction in completion_reactions:
            print(f"✅ {agent} marked something as complete: {reaction}")

adapter.register_message_handler("sentiment_tracker", team_sentiment_tracker)
```

## Error Handling

The mod includes comprehensive error handling:

### File Upload Errors
```python
def file_handler(file_id, filename, file_info):
    if not file_info.get("success", False):
        error = file_info.get("error", "Unknown error")
        print(f"File operation failed: {error}")
```

### Message Send Errors
```python
# Check connector availability
if adapter.connector is None:
    print("Agent not connected to network")
    return
```

### Threading Errors
- Automatic validation prevents over-nesting (max 5 levels)
- Invalid parent message IDs are logged and ignored
- Missing channels are handled gracefully

## Troubleshooting

### Common Issues

**1. Messages not appearing in channels**
- Verify channel exists and agent has access
- Check network connection status
- Ensure channel name is spelled correctly

**2. File uploads failing**
- Check file size (must be under limit)
- Verify file path exists and is readable
- Ensure sufficient storage space

**3. Replies not creating threads**
- Verify `reply_to_id` references valid message
- Check that original message exists in history
- Ensure thread nesting hasn't reached max level (5)

**4. Agent mentions not working**
- Verify target agent is in the channel
- Use correct agent ID (not display name)
- Check agent is active and connected

### Debug Mode

Enable debug logging for troubleshooting:

```python
import logging
logging.getLogger("openagents.mods.communication.thread_messaging").setLevel(logging.DEBUG)
```

## Performance Considerations

### Message History
- Network maintains message history (default: 2000 messages)
- Older messages are automatically cleaned up
- Consider message retention policies for large networks

### File Storage
- Files stored temporarily on network server
- Implement cleanup policies for uploaded files
- Monitor storage usage in production

### Threading Performance
- Deep threads (5 levels) may impact rendering performance
- Consider thread depth limits based on use case
- Thread structure is cached for better performance

## Migration Guide

### From Simple Messaging Mod

The Thread Messaging mod is designed to be standalone and doesn't require the Simple Messaging mod. To migrate:

1. **Replace simple messaging tools:**
   - `send_text_message` → `send_direct_message`
   - `broadcast_text_message` → `send_channel_message`

2. **Enhance with new features:**
   - Add threading with `reply_direct_message`/`reply_channel_message`
   - Use file uploads with `upload_file`
   - Add channel organization with `list_channels`

3. **Update configurations:**
   - Remove simple_messaging from mod_adapters
   - Add thread_messaging with channel configuration

## API Reference

### ThreadMessagingAgentAdapter

Main adapter class providing the 9 communication tools.

#### Methods

- `send_direct_message(target_agent_id, text, quote=None)`
- `send_channel_message(channel, text, target_agent=None, quote=None)`
- `upload_file(file_path)`
- `reply_channel_message(channel, reply_to_id, text, quote=None)`
- `reply_direct_message(target_agent_id, reply_to_id, text, quote=None)`
- `list_channels()`
- `retrieve_channel_messages(channel, limit=50, offset=0, include_threads=True)`
- `retrieve_direct_messages(target_agent_id, limit=50, offset=0, include_threads=True)`
- `react_to_message(target_message_id, reaction_type, action='add')`
- `register_message_handler(handler_id, handler)`
- `register_file_handler(handler_id, handler)`

### ThreadMessagingNetworkMod

Network-level mod managing threads, channels, and files.

#### Key Features

- Reddit-like thread management with 5-level nesting
- Channel organization with agent tracking
- File storage with UUID generation
- Message history management
- Thread structure building

## Contributing

To contribute to the Thread Messaging mod:

1. Follow OpenAgents coding standards
2. Add tests for new features
3. Update documentation for changes
4. Ensure backward compatibility

## License

The Thread Messaging mod is licensed under the same terms as OpenAgents (MIT License).

---

*For more information about OpenAgents, visit the [main documentation](../index.md).*
