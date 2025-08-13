# Multi-Agent Prompt Structure and Templates

This document describes the multi-agent prompt structure and templates used by OpenAgents simple agents for handling conversations and communication in multi-agent environments.

## Overview

OpenAgents uses a structured prompt template system that enables agents to understand and respond appropriately in multi-agent conversations. The template provides context about ongoing conversations across multiple threads while highlighting the specific message that requires a response.

## Core Prompt Template

The multi-agent prompt template is implemented using Jinja2 templating and is defined in `src/openagents/agents/simple_agent.py`:

```python
user_prompt_template = Template("""
<conversation>
    <threads>
        {% for thread_id, thread in message_threads.items() %}
        <thread id="{{ thread_id }}">
            {% for message in thread.messages[-10:] %}
            <message sender="{{ message.sender_id }}">
                {% if message.text_representation %}
                <content>{{ message.text_representation }}</content>
                {% else %}
                <content>{{ message.content }}</content>
                {% endif %}
            </message>
            {% endfor %}
        </thread>
        {% endfor %}
    </threads>
    
    <current_interaction>
        <incoming_thread_id>{{ incoming_thread_id }}</incoming_thread_id>
        <incoming_message sender="{{ incoming_message.sender_id }}">
            {% if incoming_message.text_representation %}
            <content>{{ incoming_message.text_representation }}</content>
            {% else %}
            <content>{{ incoming_message.content }}</content>
            {% endif %}
        </incoming_message>
    </current_interaction>
</conversation>

Please respond to the incoming message based on the context provided. You have access to tools that you can use if needed.
In each step, you MUST either:
1. Call a tool to perform an action, or
2. Use the finish tool when you've completed all necessary actions.

If you don't need to use any tools, use the finish tool directly.
""")
```

## Template Structure

### 1. Conversation Container

The entire prompt is wrapped in a `<conversation>` element that contains all relevant context for the agent's decision-making.

### 2. Threads Section

```xml
<threads>
    <thread id="thread_identifier">
        <message sender="agent_or_user_id">
            <content>Message content here</content>
        </message>
        <!-- More messages... -->
    </thread>
    <!-- More threads... -->
</threads>
```

**Key Features:**
- **Multi-Thread Support**: Handles multiple concurrent conversation threads
- **Message History**: Includes the last 10 messages from each thread (`thread.messages[-10:]`)
- **Sender Identification**: Each message clearly identifies the sender via `sender_id`
- **Content Flexibility**: Uses `text_representation` when available, falls back to `content`

### 3. Current Interaction Section

```xml
<current_interaction>
    <incoming_thread_id>specific_thread_id</incoming_thread_id>
    <incoming_message sender="sender_id">
        <content>The message that needs a response</content>
    </incoming_message>
</current_interaction>
```

**Purpose:**
- **Focus Guidance**: Clearly identifies which message requires a response
- **Thread Context**: Specifies which conversation thread the message belongs to
- **Action Trigger**: Provides the specific stimulus that triggered the agent's activation

### 4. Instruction Section

The template includes explicit instructions for tool usage:

```
Please respond to the incoming message based on the context provided. You have access to tools that you can use if needed.
In each step, you MUST either:
1. Call a tool to perform an action, or
2. Use the finish tool when you've completed all necessary actions.

If you don't need to use any tools, use the finish tool directly.
```

## Template Variables

The template is rendered with the following variables:

| Variable | Type | Description |
|----------|------|-------------|
| `message_threads` | `Dict[str, MessageThread]` | Dictionary of all active conversation threads |
| `incoming_thread_id` | `str` | ID of the thread containing the message to respond to |
| `incoming_message` | `BaseMessage` | The specific message that triggered this agent response |

## Message Structure

### Message Properties

Each message in the template includes:

- **`sender_id`**: Unique identifier of the message sender (agent or user)
- **`content`** or **`text_representation`**: The actual message content
- **Thread Context**: Implicit grouping within thread containers

### Content Handling

The template prioritizes `text_representation` over `content` for better human-readable formatting:

```jinja2
{% if message.text_representation %}
<content>{{ message.text_representation }}</content>
{% else %}
<content>{{ message.content }}</content>
{% endif %}
```

## Usage in Agent Workflow

### 1. Template Rendering

The template is rendered in the `react` method of `SimpleAgentRunner`:

```python
async def react(self, message_threads: Dict[str, MessageThread], 
                incoming_thread_id: str, incoming_message: BaseMessage):
    # Generate the prompt using the template
    prompt_content = user_prompt_template.render(
        message_threads=message_threads,
        incoming_thread_id=incoming_thread_id,
        incoming_message=incoming_message
    )
    
    # Create messages for the LLM
    messages = [
        {"role": "system", "content": self.instruction},
        {"role": "user", "content": prompt_content}
    ]
```

### 2. System Integration

The rendered template becomes the user message in a conversation with:
- **System Message**: The agent's instruction/persona
- **User Message**: The rendered multi-agent prompt template

### 3. Tool Integration

The prompt works in conjunction with communication tools:
- `send_text_message`: Send direct messages to specific agents
- `broadcast_text_message`: Send messages to all agents
- `finish`: Complete the interaction cycle

## Example Rendered Output

Here's an example of what the rendered template might look like:

```xml
<conversation>
    <threads>
        <thread id="direct_alice">
            <message sender="alice">
                <content>Hi there! Can you help me with a calculation?</content>
            </message>
            <message sender="math_agent">
                <content>Of course! What calculation do you need help with?</content>
            </message>
        </thread>
        <thread id="direct_bob">
            <message sender="bob">
                <content>What's the status of the project?</content>
            </message>
        </thread>
    </threads>
    
    <current_interaction>
        <incoming_thread_id>direct_alice</incoming_thread_id>
        <incoming_message sender="alice">
            <content>I need to calculate 15 * 42</content>
        </incoming_message>
    </current_interaction>
</conversation>

Please respond to the incoming message based on the context provided. You have access to tools that you can use if needed.
In each step, you MUST either:
1. Call a tool to perform an action, or
2. Use the finish tool when you've completed all necessary actions.

If you don't need to use any tools, use the finish tool directly.
```

## Best Practices

### 1. Thread Management
- Each conversation thread maintains separate context
- Thread IDs are generated based on communication patterns (direct messages, broadcasts, etc.)
- Message history is limited to the last 10 messages per thread for efficiency

### 2. Content Prioritization
- Always use `text_representation` when available for better readability
- Fall back to `content` field when `text_representation` is not provided

### 3. Tool Usage Enforcement
- The template explicitly requires tool usage or finishing
- This prevents agents from generating text responses without taking action
- Ensures proper completion of interaction cycles

### 4. Context Preservation
- Multiple threads provide full conversational context
- Current interaction section focuses attention on the actionable message
- Sender identification enables proper attribution and response targeting

## Related Components

- **Message Types**: `DirectMessage`, `BroadcastMessage`, `ModMessage`
- **Communication Tools**: Simple Messaging adapter tools
- **Agent Runners**: `SimpleAgentRunner`, `SimpleOpenAIAgentRunner`
- **Message Threading**: Thread ID generation utilities

## Future Considerations

1. **Template Customization**: Allow agents to customize prompt templates
2. **Message Filtering**: Add capability to filter messages by type or sender
3. **Context Window Management**: Dynamic message history limits based on model constraints
4. **Enhanced Formatting**: Rich message formatting support for files and structured data
