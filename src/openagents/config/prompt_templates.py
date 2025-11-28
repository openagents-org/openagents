"""Prompt templates for OpenAgents.

This module contains default prompt templates used by agents for conversation formatting
and system message construction.
"""

# Default user prompt template for conversation formatting
# This template accepts a 'context' parameter containing event_threads, incoming_thread_id, and incoming_message
DEFAULT_AGENT_USER_PROMPT_TEMPLATE = """
<conversation>
    <threads>
        {% for thread_id, thread in context.event_threads.items() %}
        <thread id="{{ thread_id }}">
            {% for event in thread.events[-10:] %}
            <message sender="{{ event.source_id }}" event_id="{{ event.event_id }}">
                {% if event.text_representation %}
                <content>{{ event.text_representation }}</content>
                {% elif event.payload.text %}
                <content>{{ event.payload.text }}</content>
                {% else %}
                <content>{{ event.payload }}</content>
                {% endif %}
            </message>
            {% endfor %}
        </thread>
        {% endfor %}
    </threads>

    <current_interaction>
        <incoming_thread_id>{{ context.incoming_thread_id }}</incoming_thread_id>
        <incoming_message sender="{{ context.incoming_event.source_id }}" event_id="{{ context.incoming_event.event_id }}">
            {% if context.incoming_event.text_representation %}
            <content>{{ context.incoming_event.text_representation }}</content>
            {% elif context.incoming_event.payload.text %}
            <content>{{ context.incoming_event.payload.text }}</content>
            {% else %}
            <content>{{ context.incoming_event.payload }}</content>
            {% endif %}
        </incoming_message>
    </current_interaction>
</conversation>

Please respond to the incoming message based on the context provided. You have access to tools that you can use if needed.

IMPORTANT: When replying to messages, use the message's event_id (not the thread_id) as the reply_to_id parameter.
- To reply to a channel message: use reply_channel_message with the message's event_id
- To reply to a direct message: use reply_direct_message with the message's event_id
- Thread ID is for context only, always use event_id for replies

In each step, you MUST either:
1. Call a tool to perform an action, or
2. Use the finish tool when you've completed all necessary actions.

If you don't need to use any tools, use the finish tool directly.

{% if user_instruction %}{{ user_instruction }}{% endif %}
""".strip()

DEFAULT_LLM_USER_PROMPT_TEMPLATE = """
<context>
<conversation>
    <threads>
        {% for thread_id, thread in context.event_threads.items() %}
        <thread id="{{ thread_id }}">
            {% for event in thread.events[-10:] %}
            <message sender="{{ event.source_id }}" event_id="{{ event.event_id }}">
                {% if event.text_representation %}
                <content>{{ event.text_representation }}</content>
                {% elif event.payload.text %}
                <content>{{ event.payload.text }}</content>
                {% else %}
                <content>{{ event.payload }}</content>
                {% endif %}
            </message>
            {% endfor %}
        </thread>
        {% endfor %}
    </threads>

    <current_interaction>
        <incoming_thread_id>{{ context.incoming_thread_id }}</incoming_thread_id>
        <incoming_message sender="{{ context.incoming_event.source_id }}" event_id="{{ context.incoming_event.event_id }}">
            {% if context.incoming_event.text_representation %}
            <content>{{ context.incoming_event.text_representation }}</content>
            {% elif context.incoming_event.payload.text %}
            <content>{{ context.incoming_event.payload.text }}</content>
            {% else %}
            <content>{{ context.incoming_event.payload }}</content>
            {% endif %}
        </incoming_message>
    </current_interaction>
</conversation>
</context>

{% if user_instruction %}{{ user_instruction }}{% endif %}
""".strip()

DEFAULT_SYSTEM_PROMPT_TEMPLATE = """{{ instruction }}"""
