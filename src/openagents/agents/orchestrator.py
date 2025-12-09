"""
Agent orchestration module for OpenAgents.

This module provides the core orchestration logic for agent interactions,
extracted from SimpleAgentRunner to improve reusability and testability.
"""

import json
import logging
import time
import uuid
from datetime import datetime
from typing import List, Optional, TYPE_CHECKING

from jinja2 import Template

from openagents.models.event_context import EventContext
from openagents.models.tool import AgentTool
from openagents.models.agent_config import AgentConfig
from openagents.models.agent_actions import (
    AgentTrajectory,
    AgentAction,
    AgentActionType,
)
from openagents.config.llm_configs import determine_provider, create_model_provider
from openagents.utils.verbose import verbose_print

if TYPE_CHECKING:
    from openagents.core.client import AgentClient

logger = logging.getLogger(__name__)


def _create_finish_tool() -> AgentTool:
    """Create a tool that allows the model to indicate it's finished with actions."""
    return AgentTool(
        name="finish",
        description="Use this tool when you have completed all necessary actions and don't need to do anything else.",
        input_schema={
            "type": "object",
            "properties": {
                "reason": {
                    "type": "string",
                    "description": "Reason for finishing the action chain.",
                }
            },
            "required": ["reason"],
        },
        func=lambda reason: f"Action chain completed: {reason}",
    )


async def orchestrate_agent(
    context: EventContext,
    agent_config: AgentConfig,
    tools: List[AgentTool],
    user_instruction: Optional[str] = None,
    max_iterations: Optional[int] = None,
    disable_finish_tool: Optional[bool] = False,
    use_llm_user_prompt: Optional[bool] = False,
    agent_id: Optional[str] = None,
    agent_client: Optional["AgentClient"] = None,
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
        user_instruction: Optional user instruction to guide the agent
        max_iterations: Maximum number of conversation iterations
        disable_finish_tool: Whether to disable the finish tool
        use_llm_user_prompt: Whether to use LLM user prompt template
        agent_id: Agent ID for LLM logging (optional, defaults to source_id from context)
        agent_client: AgentClient for event-based LLM logging (for external agents)

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

    # Initialize LLM logger (event-based logging via agent_client)
    llm_logger = None
    effective_agent_id = agent_id or incoming_message.source_id or "unknown"

    if agent_client:
        # Event-based logging (sends logs to network for centralized storage)
        try:
            from openagents.lms.llm_logger import EventBasedLLMLogger
            llm_logger = EventBasedLLMLogger(effective_agent_id, agent_client)
            logger.debug(f"Using event-based LLM logger for agent {effective_agent_id}")
        except Exception as e:
            logger.warning(f"Failed to initialize event-based LLM logger: {e}")

    # Print colored box for orchestration start
    from openagents.utils.cli_display import print_box

    event_text = incoming_message.text_representation or incoming_message.event_name
    lines = [
        f"Thread: {incoming_thread_id}",
        f"Event:  {event_text}",
    ]

    print_box("🎯 STARTING ORCHESTRATION", lines, color_code="\033[95m")

    verbose_print(
        f">>> Orchestrating agent response to: {incoming_message.text_representation} (thread:{incoming_thread_id})"
    )

    # Create model provider from agent config
    provider = determine_provider(
        agent_config.provider, agent_config.model_name, agent_config.api_base
    )
    model_provider = create_model_provider(
        provider=provider,
        model_name=agent_config.model_name,
        api_base=agent_config.api_base,
        api_key=agent_config.api_key,
    )

    # Create context object for template rendering
    template_context = type(
        "TemplateContext",
        (),
        {
            "event_threads": event_threads,
            "incoming_thread_id": incoming_thread_id,
            "incoming_event": incoming_message,
        },
    )()

    # Generate messages using templates from agent config
    if use_llm_user_prompt:
        user_template = Template(agent_config.llm_user_prompt_template)
    else:
        user_template = Template(agent_config.user_prompt_template)
    
    prompt_content = user_template.render(
        context=template_context, user_instruction=user_instruction
    ).strip()

    system_content = (
        Template(agent_config.get_effective_system_prompt_template())
        .render(instruction=agent_config.instruction)
        .strip()
    )

    messages = [
        {"role": "system", "content": system_content},
        {"role": "user", "content": prompt_content},
    ]

    # Prepare tools with finish tool
    all_tools = list(tools)

    if not disable_finish_tool:
        finish_tool = _create_finish_tool()
        all_tools.append(finish_tool)

    formatted_tools = model_provider.format_tools(all_tools)

    # Conversation loop with action tracking
    is_finished = False
    iteration = 0

    while not is_finished and iteration < max_iterations:
        iteration += 1

        try:
            # Call the model provider - async, with timing for logging
            call_start_time = time.time()
            llm_error = None
            response = None
            try:
                response = await model_provider.chat_completion(messages, formatted_tools)
            except Exception as llm_exc:
                llm_error = str(llm_exc)
                raise
            finally:
                call_end_time = time.time()
                latency_ms = int((call_end_time - call_start_time) * 1000)

                # Log the LLM call if logger is available
                if llm_logger:
                    try:
                        log_response = response if response else {"content": "", "tool_calls": []}
                        await llm_logger.log_call(
                            model_name=agent_config.model_name,
                            provider=provider,
                            messages=messages.copy(),
                            tools=formatted_tools,
                            response=log_response,
                            latency_ms=latency_ms,
                            error=llm_error,
                        )
                    except Exception as log_exc:
                        logger.warning(f"Failed to log LLM call: {log_exc}")

            # Add the assistant's response to the conversation
            # Handle content and tool_calls properly for OpenAI API
            assistant_message = {"role": "assistant"}

            # If there are tool calls, content can be null, but if no tool calls, content must be a string
            if response.get("tool_calls"):
                # Format tool calls for OpenAI API - each needs a "type": "function" field
                formatted_tool_calls = []
                for tool_call in response["tool_calls"]:
                    formatted_tool_calls.append(
                        {
                            "id": tool_call["id"],
                            "type": "function",
                            "function": {
                                "name": tool_call["name"],
                                "arguments": tool_call["arguments"],
                            },
                        }
                    )
                assistant_message["tool_calls"] = formatted_tool_calls
                assistant_message["content"] = response.get("content") or None
            else:
                # No tool calls, so content must be a non-empty string
                assistant_content = response.get("content") or ""
                if assistant_content:
                    assistant_message["content"] = assistant_content
                else:
                    # If no content and no tool calls, something went wrong - finish the conversation
                    logger.warning("Model returned empty response with no tool calls")
                    completion_action = AgentAction(
                        action_id=str(uuid.uuid4()),
                        action_type=AgentActionType.COMPLETE,
                        timestamp=datetime.now(),
                        payload={
                            "reason": "Model returned empty response",
                            "response": "",
                        },
                    )
                    actions.append(completion_action)
                    is_finished = True
                    break

            messages.append(assistant_message)

            # Check if the model wants to call tools
            if response.get("tool_calls"):
                # Print colored box for tool calls
                from openagents.utils.cli_display import print_box

                lines = []
                for tool_call in response["tool_calls"]:
                    tool_name = tool_call["name"]
                    args_str = str(tool_call["arguments"])

                    lines.append(f"Tool: {tool_name}")
                    lines.append(f"Args: {args_str}")
                    lines.append("─" * 66)  # Separator

                # Remove last separator
                if lines and lines[-1].startswith("─"):
                    lines.pop()

                print_box("🔧 AGENT TOOL CALL", lines, color_code="\033[93m")

                for tool_call in response["tool_calls"]:
                    verbose_print(
                        f">>> tool >>> {tool_call['name']}({tool_call['arguments']})"
                    )

                    tool_name = tool_call["name"]

                    # Create action for this tool call
                    action = AgentAction(
                        action_id=str(uuid.uuid4()),
                        action_type=AgentActionType.CALL_TOOL,
                        timestamp=datetime.now(),
                        payload={
                            "tool_name": tool_name,
                            "arguments": tool_call["arguments"],
                        },
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
                            payload={"reason": reason},
                        )
                        actions.append(completion_action)

                        messages.append(
                            {"role": "tool", "content": "Action chain completed."}
                        )
                        break

                    # Find and execute the corresponding tool
                    tool = next((t for t in tools if t.name == tool_name), None)

                    if tool:
                        try:
                            # Parse the function arguments
                            arguments = json.loads(tool_call["arguments"])

                            # Execute the tool
                            result = await tool.execute(**arguments)

                            # Add the tool result to the conversation
                            messages.append(
                                {
                                    "role": "tool",
                                    "tool_call_id": tool_call["id"],
                                    "content": str(result),
                                }
                            )

                            # Update action with result
                            action.payload["result"] = str(result)
                            action.payload["status"] = "success"

                        except (json.JSONDecodeError, Exception) as e:
                            # If there's an error, add it as a tool result
                            error_msg = f"Error: {str(e)}"
                            messages.append(
                                {
                                    "role": "tool",
                                    "tool_call_id": tool_call["id"],
                                    "content": error_msg,
                                }
                            )

                            # Update action with error
                            action.payload["error"] = error_msg
                            action.payload["status"] = "error"

                            logger.info(f"Error executing tool {tool_name}: {e}")
                    else:
                        # Tool not found
                        error_msg = f"Tool '{tool_name}' not found"
                        messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": tool_call["id"],
                                "content": error_msg,
                            }
                        )

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
                        "response": response.get("content"),
                    },
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
                payload={"reason": "Error during model interaction", "error": str(e)},
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

    return AgentTrajectory(actions=actions, summary=summary)
