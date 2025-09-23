"""Prompt templates for OpenAgents.

This module contains default prompt templates used by agents for conversation formatting
and system message construction.
"""

# Default user prompt template for conversation formatting
# This template accepts a 'context' parameter containing event_threads, incoming_thread_id, and incoming_message
DEFAULT_USER_PROMPT_TEMPLATE = """<conversation>
    <threads>
        {% for thread_id, thread in context.event_threads.items() %}
        <thread id="{{ thread_id }}">
            {% for event in thread.events[-10:] %}
            <message sender="{{ event.source_id }}">
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
        <incoming_message sender="{{ context.incoming_event.source_id }}">
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
In each step, you MUST either:
1. Call a tool to perform an action, or
2. Use the finish tool when you've completed all necessary actions.

If you don't need to use any tools, use the finish tool directly.
"""

DEFAULT_SYSTEM_PROMPT_TEMPLATE = f"""{{instruction}}"""