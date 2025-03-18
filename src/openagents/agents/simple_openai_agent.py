import os
from openagents.agents.runner import AgentRunner
from openagents.models.message_thread import MessageThread
from openagents.models.messages import BaseMessage
from typing import Dict, List, Any, Optional
import json
import asyncio
from openagents.models.tool import AgentAdapterTool
import logging
logger = logging.getLogger(__name__)

try:
    from openai import AzureOpenAI, OpenAI
except ImportError:
    logger.warning("openai is not installed, please install it with `pip install openai`")


from jinja2 import Template

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

class SimpleOpenAIAgentRunner(AgentRunner):

    def __init__(self, agent_id: str, model_name: str, instruction: str, api_base: str = None, protocol_names: Optional[List[str]] = None, ignored_sender_ids: Optional[List[str]] = None):
        super().__init__(agent_id=agent_id, protocol_names=protocol_names, ignored_sender_ids=ignored_sender_ids)
        self.model_name = model_name
        self.instruction = instruction
        # Initialize OpenAI client with custom API base URL if provided
        if api_base:
            if "azure.com" in api_base:
                self.openai_client = AzureOpenAI(azure_endpoint=api_base, api_key=os.getenv("AZURE_OPENAI_API_KEY"), api_version=os.getenv("OPENAI_API_VERSION", "2024-07-01-preview"))
            else:
                self.openai_client = OpenAI(base_url=api_base, api_key=os.getenv("OPENAI_API_KEY"))
        else:
            self.openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

    def _create_finish_tool(self):
        """Create a tool that allows the model to indicate it's finished with actions."""
        return AgentAdapterTool(
            name="finish",
            description="Use this tool when you have completed all necessary actions and don't need to do anything else.",
            input_schema={
                "type": "object",
                "properties": {
                    "reason": {
                        "type": "string",
                        "description": "Reason for finishing the action chain."
                    }
                },
                "required": ["reason"]
            },
            func=lambda reason: f"Action chain completed: {reason}"
        )

    async def react(self, message_threads: Dict[str, MessageThread], incoming_thread_id: str, incoming_message: BaseMessage):
        print(f">>> Reacting to message: {incoming_message.text_representation} (thread:{incoming_thread_id})")
        # Generate the prompt using the template
        prompt_content = user_prompt_template.render(
            message_threads=message_threads,
            incoming_thread_id=incoming_thread_id,
            incoming_message=incoming_message
        )
        
        # Create messages with instruction as system message and prompt as user message
        messages = [
            {"role": "system", "content": self.instruction},
            {"role": "user", "content": prompt_content}
        ]
        
        # Convert tools to OpenAI function format and add the finish tool
        all_tools = list(self.tools)
        finish_tool = self._create_finish_tool()
        all_tools.append(finish_tool)
        
        functions = [tool.to_openai_function() for tool in all_tools]
        
        # Start the conversation with the model
        is_finished = False
        max_iterations = 10  # Prevent infinite loops
        iteration = 0
        
        while not is_finished and iteration < max_iterations:
            iteration += 1
            
            # Call the OpenAI API with function calling
            response = self.openai_client.chat.completions.create(
                model=self.model_name,
                messages=messages,
                tools=[{"type": "function", "function": func} for func in functions],
                tool_choice="auto"
            )
            
            # Get the response message
            response_message = response.choices[0].message
            # Add the assistant's response to the conversation
            messages.append({
                "role": "assistant",
                "content": response_message.content or None,
                **({"tool_calls": response_message.tool_calls} if hasattr(response_message, 'tool_calls') and response_message.tool_calls else {})
            })
            
            # Check if the model wants to call a function
            if hasattr(response_message, 'tool_calls') and response_message.tool_calls:
                for tool_call in response_message.tool_calls:
                    print(f">>> tool >>> {tool_call.function.name}({tool_call.function.arguments})")
                    # Get the tool name and arguments
                    tool_name = tool_call.function.name
                    
                    # Check if the model wants to finish
                    if tool_name == "finish":
                        is_finished = True
                        # Add the tool result to the conversation
                        messages.append({
                            "role": "tool",
                            "tool_call_id": tool_call.id,
                            "content": "Action chain completed."
                        })
                        break
                    
                    # Find the corresponding tool for other tools
                    tool = next((t for t in self.tools if t.name == tool_name), None)
                    
                    if tool:
                        try:
                            # Parse the function arguments
                            arguments = json.loads(tool_call.function.arguments)
                            
                            # Execute the tool (now we can use await directly since the method is async)
                            result = await tool.execute(**arguments)
                            
                            # Add the tool result to the conversation
                            messages.append({
                                "role": "tool",
                                "tool_call_id": tool_call.id,
                                "content": str(result)
                            })
                        except (json.JSONDecodeError, Exception) as e:
                            # If there's an error, add it as a tool result
                            messages.append({
                                "role": "tool",
                                "tool_call_id": tool_call.id,
                                "content": f"Error: {str(e)}"
                            })
                            logger.info(f"Error executing tool {tool_name}: {e}")
                            logger.info(f"Tool call: {tool_call}")
            else:
                print(f">>> response >>> {response_message.content}")
                # If the model generates a response without calling a tool, finish
                is_finished = True
                break
        
        # No need to send a final response