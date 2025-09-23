"""
Agent orchestration module for OpenAgents.

This module provides the core orchestration logic for agent interactions,
extracted from SimpleAgentRunner to improve reusability and testability.
"""

import asyncio
import json
import logging
import uuid
from datetime import datetime
from typing import List, Optional

from jinja2 import Template

from openagents.models.event_context import EventContext
from openagents.models.tool import AgentAdapterTool
from openagents.models.agent_config import AgentConfig
from openagents.models.agent_actions import AgentTrajectory, AgentAction, AgentActionType
from openagents.config.llm_configs import determine_provider, create_model_provider
from openagents.utils.verbose import verbose_print

logger = logging.getLogger(__name__)


def _create_finish_tool() -> AgentAdapterTool:
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


def orchestrate_agent(
    context: EventContext,
    agent_config: AgentConfig,
    tools: List[AgentAdapterTool],
    user_instruction: Optional[str] = None,
    max_iterations: Optional[int] = None
) -> AgentTrajectory:
    """Orchestrate an agent's response to an incoming message.
    
    This function handles the complete agent interaction flow:
    1. Creates model provider from agent config
    2. Renders message templates with context
    3. Manages iterative conversation with LLM
    4. Executes tools and tracks actions
    5. Returns structured trajectory
    
    Args:
        context: Event context containing incoming message and thread information
        agent_config: Agent configuration with model and prompt settings
        tools: Available tools for the agent to use
        max_iterations: Maximum number of conversation iterations
        
    Returns:
        AgentTrajectory containing all actions performed and summary
    """
    if max_iterations is None:
        if agent_config.max_iterations is None:
            max_iterations = 10
        else:
            max_iterations = agent_config.max_iterations
    
    # Track actions in trajectory
    actions = []
    
    # Extract context information
    incoming_message = context.incoming_event
    incoming_thread_id = context.incoming_thread_id
    event_threads = context.event_threads
    
    verbose_print(f">>> Orchestrating agent response to: {incoming_message.text_representation} (thread:{incoming_thread_id})")
    
    # Create model provider from agent config
    provider = determine_provider(agent_config.provider, agent_config.model_name, agent_config.api_base)
    model_provider = create_model_provider(
        provider=provider,
        model_name=agent_config.model_name,
        api_base=agent_config.api_base,
        api_key=agent_config.api_key
    )
    
    # Create context object for template rendering
    template_context = type('TemplateContext', (), {
        'event_threads': event_threads,
        'incoming_thread_id': incoming_thread_id,
        'incoming_event': incoming_message
    })()
    
    # Generate messages using templates from agent config
    user_template = Template(agent_config.get_effective_user_prompt_template())
    prompt_content = user_template.render(context=template_context, user_instruction=user_instruction).strip()
    
    system_content = Template(agent_config.get_effective_system_prompt_template()).render(
        instruction=agent_config.instruction
    ).strip()
    
    messages = [
        {"role": "system", "content": system_content},
        {"role": "user", "content": prompt_content}
    ]
    
    # Prepare tools with finish tool
    all_tools = list(tools)
    finish_tool = _create_finish_tool()
    all_tools.append(finish_tool)
    
    formatted_tools = model_provider.format_tools(all_tools)
    
    # Get event loop for async operations
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        # Create new event loop if none exists
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    
    # Conversation loop with action tracking
    is_finished = False
    iteration = 0
    
    while not is_finished and iteration < max_iterations:
        iteration += 1
        
        try:
            # Call the model provider
            if asyncio.iscoroutinefunction(model_provider.chat_completion):
                # If chat_completion is async, we need to run it in event loop
                loop = asyncio.get_event_loop()
                response = loop.run_until_complete(model_provider.chat_completion(messages, formatted_tools))
            else:
                response = model_provider.chat_completion(messages, formatted_tools)
            
            # Add the assistant's response to the conversation
            messages.append({
                "role": "assistant",
                "content": response.get("content") or None
            })
            
            # Check if the model wants to call tools
            if response.get("tool_calls"):
                for tool_call in response["tool_calls"]:
                    verbose_print(f">>> tool >>> {tool_call['name']}({tool_call['arguments']})")
                    
                    tool_name = tool_call["name"]
                    
                    # Create action for this tool call
                    action = AgentAction(
                        action_id=str(uuid.uuid4()),
                        action_type=AgentActionType.CALL_TOOL,
                        timestamp=datetime.now(),
                        payload={
                            "tool_name": tool_name,
                            "arguments": tool_call["arguments"]
                        }
                    )
                    actions.append(action)
                    
                    # Check if the model wants to finish
                    if tool_name == "finish":
                        is_finished = True
                        
                        # Create completion action
                        try:
                            finish_args = json.loads(tool_call["arguments"])
                            reason = finish_args.get("reason", "No reason provided")
                        except (json.JSONDecodeError, KeyError):
                            reason = "Agent indicated completion"
                        
                        completion_action = AgentAction(
                            action_id=str(uuid.uuid4()),
                            action_type=AgentActionType.COMPLETE,
                            timestamp=datetime.now(),
                            payload={"reason": reason}
                        )
                        actions.append(completion_action)
                        
                        messages.append({
                            "role": "tool",
                            "content": "Action chain completed."
                        })
                        break
                    
                    # Find and execute the corresponding tool
                    tool = next((t for t in tools if t.name == tool_name), None)
                    
                    if tool:
                        try:
                            # Parse the function arguments
                            arguments = json.loads(tool_call["arguments"])
                            
                            # Execute the tool
                            if asyncio.iscoroutinefunction(tool.execute):
                                result = loop.run_until_complete(tool.execute(**arguments))
                            else:
                                result = tool.execute(**arguments)
                            
                            # Add the tool result to the conversation
                            messages.append({
                                "role": "tool",
                                "content": str(result)
                            })
                            
                            # Update action with result
                            action.payload["result"] = str(result)
                            action.payload["status"] = "success"
                            
                        except (json.JSONDecodeError, Exception) as e:
                            # If there's an error, add it as a tool result
                            error_msg = f"Error: {str(e)}"
                            messages.append({
                                "role": "tool",
                                "content": error_msg
                            })
                            
                            # Update action with error
                            action.payload["error"] = error_msg
                            action.payload["status"] = "error"
                            
                            logger.info(f"Error executing tool {tool_name}: {e}")
                    else:
                        # Tool not found
                        error_msg = f"Tool '{tool_name}' not found"
                        messages.append({
                            "role": "tool",
                            "content": error_msg
                        })
                        
                        action.payload["error"] = error_msg
                        action.payload["status"] = "not_found"
            else:
                verbose_print(f">>> response >>> {response.get('content')}")
                # If the model generates a response without calling a tool, finish
                completion_action = AgentAction(
                    action_id=str(uuid.uuid4()),
                    action_type=AgentActionType.COMPLETE,
                    timestamp=datetime.now(),
                    payload={
                        "reason": "Agent provided direct response",
                        "response": response.get("content")
                    }
                )
                actions.append(completion_action)
                is_finished = True
                break
                
        except Exception as e:
            logger.error(f"Error during model interaction: {e}")
            verbose_print(f">>> error >>> {e}")
            
            # Create error action
            error_action = AgentAction(
                action_id=str(uuid.uuid4()),
                action_type=AgentActionType.COMPLETE,
                timestamp=datetime.now(),
                payload={
                    "reason": "Error during model interaction",
                    "error": str(e)
                }
            )
            actions.append(error_action)
            break
    
    # Generate trajectory summary
    if not actions:
        summary = "No actions performed"
    elif len(actions) == 1 and actions[0].action_type == AgentActionType.COMPLETE:
        summary = f"Direct response: {actions[0].payload.get('reason', 'Completed')}"
    else:
        tool_calls = [a for a in actions if a.action_type == AgentActionType.CALL_TOOL]
        completions = [a for a in actions if a.action_type == AgentActionType.COMPLETE]
        
        if tool_calls and completions:
            summary = f"Executed {len(tool_calls)} tool(s) and completed: {completions[-1].payload.get('reason', 'Done')}"
        elif tool_calls:
            summary = f"Executed {len(tool_calls)} tool(s)"
        else:
            summary = "Completed without tool execution"
    
    return AgentTrajectory(
        actions=actions,
        summary=summary
    )