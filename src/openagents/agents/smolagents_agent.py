"""
Smolagents Agent Runner for OpenAgents.

This module provides a wrapper that allows any Smolagents agent to connect
to and participate in the OpenAgents network. Smolagents is a lightweight
framework for building powerful AI agents with minimal abstractions.

Supported agent types:
- CodeAgent: Agents that write and execute Python code as actions
- ToolCallingAgent: Agents that use traditional tool calling (JSON format)

Example usage:
    from smolagents import CodeAgent, HfApiModel
    from openagents.agents import SmolagentsAgentRunner

    # Create a Smolagents CodeAgent
    model = HfApiModel(model_id="meta-llama/Llama-3.1-70B-Instruct")
    agent = CodeAgent(tools=[], model=model)

    # Connect to OpenAgents network
    runner = SmolagentsAgentRunner(
        smolagents_agent=agent,
        agent_id="my-smolagents-agent"
    )
    runner.start(network_host="localhost", network_port=8600)
    runner.wait_for_stop()
"""

import asyncio
import logging
from typing import Any, Callable, Dict, List, Optional, Set, Union

from openagents.agents.runner import AgentRunner
from openagents.models.event import Event
from openagents.models.event_context import EventContext
from openagents.models.tool import AgentTool

logger = logging.getLogger(__name__)

# Type alias for Smolagents agents - we use Any to avoid hard dependency
SmolagentsAgent = Any


def openagents_tool_to_smolagents(agent_tool: AgentTool) -> Any:
    """
    Convert an OpenAgents AgentTool to a Smolagents Tool.

    This allows Smolagents agents to use tools provided by the OpenAgents network
    (e.g., messaging tools, discovery tools, etc.)

    Args:
        agent_tool: The OpenAgents tool to convert

    Returns:
        A Smolagents Tool instance

    Raises:
        ImportError: If smolagents is not installed
    """
    try:
        from smolagents import tool
    except ImportError:
        raise ImportError(
            "smolagents is required for tool conversion. "
            "Install it with: pip install smolagents"
        )

    # Get tool schema info
    tool_name = agent_tool.name
    tool_description = agent_tool.description or f"Tool: {tool_name}"
    input_schema = agent_tool.input_schema or {"type": "object", "properties": {}}

    # Build args description from schema
    args_desc = []
    if isinstance(input_schema, dict) and "properties" in input_schema:
        for prop_name, prop_info in input_schema["properties"].items():
            prop_desc = prop_info.get("description", f"The {prop_name} parameter")
            args_desc.append(f"        {prop_name}: {prop_desc}")
    
    args_doc = "\n".join(args_desc) if args_desc else "        No parameters required."

    # Create the wrapper function dynamically
    exec_globals = {"agent_tool": agent_tool, "asyncio": asyncio}
    
    # Build function source
    func_source = f'''
async def {tool_name}(**kwargs) -> str:
    \'\'\'
    {tool_description}
    
    Args:
{args_doc}
    \'\'\'
    try:
        result = await agent_tool.execute(**kwargs)
        return str(result)
    except Exception as e:
        return f"Tool execution failed: {{e}}"
'''

    # Execute to create function
    exec(func_source, exec_globals)
    wrapper_fn = exec_globals[tool_name]

    # Apply smolagents @tool decorator
    return tool(wrapper_fn)


def smolagents_tool_to_openagents(smol_tool: Any) -> AgentTool:
    """
    Convert a Smolagents Tool to an OpenAgents AgentTool.

    This allows OpenAgents to use tools defined in Smolagents format.

    Args:
        smol_tool: The Smolagents tool to convert

    Returns:
        An OpenAgents AgentTool instance
    """
    import inspect

    # Extract tool info from Smolagents tool
    # Try to get name from various possible attributes
    name = getattr(smol_tool, 'name', None)
    if name is None:
        name = getattr(smol_tool, '__name__', 'unnamed_tool')
    
    # Try to get description
    description = getattr(smol_tool, 'description', None)
    if description is None:
        description = getattr(smol_tool, '__doc__', "")
    
    # Try to get schema from the tool
    input_schema = {}
    if hasattr(smol_tool, 'inputs'):
        input_schema = smol_tool.inputs
    elif hasattr(smol_tool, 'parameters_json_schema'):
        input_schema = smol_tool.parameters_json_schema

    # Get the function to call - smolagents uses 'forward' method
    if hasattr(smol_tool, 'forward'):
        tool_func = smol_tool.forward
    else:
        tool_func = smol_tool

    # Create async wrapper for the tool
    async def async_tool_func(**kwargs) -> Any:
        if asyncio.iscoroutinefunction(tool_func):
            return await tool_func(**kwargs)
        else:
            # Run sync function in executor to avoid blocking
            loop = asyncio.get_event_loop()
            return await loop.run_in_executor(None, lambda: tool_func(**kwargs))

    return AgentTool(
        name=name,
        description=description,
        input_schema=input_schema,
        func=async_tool_func,
    )


class SmolagentsAgentRunner(AgentRunner):
    """
    An AgentRunner that wraps a Smolagents agent for use in OpenAgents network.

    This class bridges Smolagents' lightweight agent framework with OpenAgents'
    network capabilities, allowing Smolagents agents to:
    - Receive messages from the OpenAgents network
    - Use OpenAgents network tools (messaging, discovery, etc.)
    - Send responses back to other agents

    Supports both CodeAgent (writes Python code as actions) and 
    ToolCallingAgent (traditional JSON tool calling).

    Example:
        from smolagents import CodeAgent, HfApiModel
        from openagents.agents import SmolagentsAgentRunner

        # Create Smolagents agent
        model = HfApiModel(model_id="meta-llama/Llama-3.1-70B-Instruct")
        agent = CodeAgent(tools=[], model=model)

        # Connect to OpenAgents
        runner = SmolagentsAgentRunner(
            smolagents_agent=agent,
            agent_id="assistant"
        )
        runner.start(network_host="localhost", network_port=8600)
    """

    def __init__(
        self,
        smolagents_agent: SmolagentsAgent,
        agent_id: Optional[str] = None,
        include_network_tools: bool = True,
        input_key: str = "input",
        output_key: str = "output",
        response_handler: Optional[Callable[[EventContext, str], None]] = None,
        event_names: Optional[List[str]] = None,
        event_filter: Optional[Callable[[EventContext], bool]] = None,
        **kwargs
    ):
        """
        Initialize the Smolagents agent runner.

        Args:
            smolagents_agent: The Smolagents agent (CodeAgent or ToolCallingAgent)
                to wrap. Must have a `run` method.
            agent_id: ID for this agent on the network. If not provided,
                will be auto-generated.
            include_network_tools: If True, OpenAgents network tools will be
                converted and added to the Smolagents agent's tools.
            input_key: The key to use for input when calling the agent.
                Defaults to "input".
            output_key: The key to extract output from the agent response.
                Defaults to "output".
            response_handler: Optional custom handler for processing responses.
                If provided, it will be called with (context, response_text)
                instead of the default broadcast behavior.
            event_names: Optional list of event names to react to. If provided,
                the agent will only process events with matching event_name.
                Example: ["agent.message", "thread.new_message"]
            event_filter: Optional custom filter function that takes an
                EventContext and returns True if the agent should react.
            **kwargs: Additional arguments passed to AgentRunner.
        """
        super().__init__(agent_id=agent_id, **kwargs)

        self._smolagents_agent = smolagents_agent
        self._include_network_tools = include_network_tools
        self._input_key = input_key
        self._output_key = output_key
        self._response_handler = response_handler
        self._event_names: Optional[Set[str]] = set(event_names) if event_names else None
        self._event_filter = event_filter
        self._tools_injected = False

        # Validate the Smolagents agent has required methods
        if not hasattr(smolagents_agent, 'run'):
            raise ValueError(
                "smolagents_agent must have a 'run' method. "
                "Expected CodeAgent or ToolCallingAgent instance."
            )

        logger.info(f"Initialized SmolagentsAgentRunner with agent_id={agent_id}")

    @property
    def smolagents_agent(self) -> SmolagentsAgent:
        """Get the wrapped Smolagents agent."""
        return self._smolagents_agent

    def _should_react(self, context: EventContext) -> bool:
        """
        Determine if the agent should react to the given event.

        This method checks the configured filters to decide whether
        to process an event:
        1. If event_names is set, only events with matching names pass
        2. If event_filter is set, the custom filter function is called

        Args:
            context: The event context to evaluate

        Returns:
            True if the agent should process this event, False otherwise
        """
        event = context.incoming_event

        # Check event_names filter
        if self._event_names is not None:
            if event.event_name not in self._event_names:
                logger.debug(
                    f"Skipping event '{event.event_name}' - not in allowed "
                    f"event_names: {self._event_names}"
                )
                return False

        # Check custom event_filter
        if self._event_filter is not None:
            try:
                if not self._event_filter(context):
                    logger.debug(
                        f"Skipping event '{event.event_name}' - "
                        f"rejected by custom event_filter"
                    )
                    return False
            except Exception as e:
                logger.error(f"Error in event_filter: {e}")
                # On filter error, default to not processing
                return False

        return True

    def _extract_input_text(self, context: EventContext) -> str:
        """
        Extract the input text from an EventContext.

        This method handles various message formats and extracts the
        relevant text content for the Smolagents agent.

        Args:
            context: The event context containing the incoming message

        Returns:
            The extracted text content
        """
        event = context.incoming_event

        # Try to get text from various sources
        # 1. Direct text_representation attribute
        if hasattr(event, 'text_representation') and event.text_representation:
            return event.text_representation

        # 2. From payload
        if isinstance(event.payload, dict):
            # Check for content.text structure
            content = event.payload.get('content', {})
            if isinstance(content, dict) and 'text' in content:
                return content['text']

            # Check for direct text field
            if 'text' in event.payload:
                return event.payload['text']

            # Check for message field
            if 'message' in event.payload:
                return str(event.payload['message'])

        # 3. Fallback to string representation of payload
        if event.payload:
            return str(event.payload)

        return ""

    async def setup(self):
        """Setup the runner and inject network tools if enabled."""
        await super().setup()

        # Inject OpenAgents tools into Smolagents agent if requested
        if self._include_network_tools and not self._tools_injected:
            await self._inject_network_tools()
            self._tools_injected = True

    async def _inject_network_tools(self):
        """
        Inject OpenAgents network tools into the Smolagents agent.

        This converts OpenAgents tools (messaging, discovery, etc.) to
        Smolagents format and adds them to the agent's tool list.
        """
        openagents_tools = self.tools
        if not openagents_tools:
            logger.debug("No OpenAgents tools to inject")
            return

        try:
            smolagents_tools = [
                openagents_tool_to_smolagents(tool)
                for tool in openagents_tools
            ]

            # Try to add tools to the agent
            # Different Smolagents agent types store tools differently
            if hasattr(self._smolagents_agent, 'tools'):
                # ToolCallingAgent stores tools in .tools attribute
                if isinstance(self._smolagents_agent.tools, list):
                    self._smolagents_agent.tools.extend(smolagents_tools)
                    logger.info(
                        f"Injected {len(smolagents_tools)} OpenAgents tools "
                        f"into Smolagents agent"
                    )
                else:
                    logger.warning(
                        "Smolagents agent has 'tools' attribute but it's not a list. "
                        "Network tools not injected."
                    )
            elif hasattr(self._smolagents_agent, '_tools'):
                # Some versions use _tools (private)
                if isinstance(self._smolagents_agent._tools, list):
                    self._smolagents_agent._tools.extend(smolagents_tools)
                    logger.info(
                        f"Injected {len(smolagents_tools)} OpenAgents tools "
                        f"into Smolagents agent"
                    )
            else:
                logger.warning(
                    "Smolagents agent does not have a recognizable 'tools' attribute. "
                    "Network tools not injected. "
                    "This is normal for CodeAgent without tools."
                )
        except ImportError as e:
            logger.warning(f"Could not inject network tools: {e}")
        except Exception as e:
            logger.error(f"Error injecting network tools: {e}")

    def _extract_output(self, result: Any) -> str:
        """
        Extract the output string from a Smolagents agent result.

        Args:
            result: The result from the Smolagents agent

        Returns:
            The extracted output string
        """
        if isinstance(result, dict):
            # Check for output_key in result
            if self._output_key in result:
                return str(result[self._output_key])
            # Fallback to common keys
            if 'output' in result:
                return str(result['output'])
            if 'response' in result:
                return str(result['response'])
            if 'content' in result:
                return str(result['content'])
            # Return string representation
            return str(result)

        if isinstance(result, str):
            return result

        # For other types, try common attributes
        if hasattr(result, 'content'):
            return str(result.content)
        
        # Final fallback
        return str(result)

    async def react(self, context: EventContext):
        """
        React to an incoming message by running the Smolagents agent.

        This method:
        1. Checks if the event passes configured filters
        2. Extracts input from the EventContext
        3. Runs the Smolagents agent
        4. Sends the response back to the network

        Args:
            context: The event context containing the incoming message
        """
        # Check if we should react to this event
        if not self._should_react(context):
            return

        try:
            # Extract input text
            input_text = self._extract_input_text(context)
            
            if not input_text.strip():
                logger.debug("Empty input text, skipping")
                return

            logger.debug(
                f"Running Smolagents agent with input: {input_text[:100]}..."
            )

            # Run the Smolagents agent
            # Smolagents agents have a run() method (synchronous)
            # We run it in an executor to avoid blocking the event loop
            loop = asyncio.get_event_loop()
            
            # Check if the agent has an async run method (future versions might)
            if hasattr(self._smolagents_agent, 'arun'):
                result = await self._smolagents_agent.arun(input_text)
            else:
                # Run sync run() in executor
                # Note: Smolagents run() method signature varies by agent type
                result = await loop.run_in_executor(
                    None,
                    lambda: self._smolagents_agent.run(input_text)
                )

            # Extract output
            output_text = self._extract_output(result)

            logger.debug(f"Smolagents agent response: {output_text[:100]}...")

            # Send response
            await self._send_response(context, output_text)

        except asyncio.TimeoutError:
            logger.error("Smolagents agent execution timed out")
            await self._send_response(
                context, 
                "I apologize, but processing your request took too long. Please try again."
            )
        except Exception as e:
            logger.error(f"Error in Smolagents agent execution: {e}")
            error_message = f"I encountered an error: {str(e)}"
            await self._send_response(context, error_message)

    async def _send_response(self, context: EventContext, response_text: str):
        """
        Send the response back to the network.

        By default, this sends a response to the source of the incoming message.
        Override this method or provide a response_handler for custom behavior.

        Args:
            context: The original event context
            response_text: The response text to send
        """
        # Use custom handler if provided
        if self._response_handler:
            await self._response_handler(context, response_text)
            return

        # Default behavior: reply to the source
        source_id = context.incoming_event.source_id
        if not source_id:
            logger.warning("No source_id in event, cannot send response")
            return

        # Create response event
        response_event = Event(
            event_name="agent.message",
            source_id=self.agent_id,
            destination_id=source_id,
            payload={
                "content": {
                    "text": response_text
                },
                "response_to": context.incoming_event.event_id,
            },
        )

        await self.send_event(response_event)
        logger.debug(f"Sent response to {source_id}")


def create_smolagents_runner(
    smolagents_agent: SmolagentsAgent,
    agent_id: Optional[str] = None,
    **kwargs
) -> SmolagentsAgentRunner:
    """
    Convenience function to create a SmolagentsAgentRunner.

    Args:
        smolagents_agent: The Smolagents agent to wrap
        agent_id: Optional agent ID
        **kwargs: Additional arguments for SmolagentsAgentRunner

    Returns:
        A configured SmolagentsAgentRunner instance
    """
    return SmolagentsAgentRunner(
        smolagents_agent=smolagents_agent,
        agent_id=agent_id,
        **kwargs
    )
