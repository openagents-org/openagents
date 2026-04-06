"""
PydanticAI Agent Runner for OpenAgents.

This module provides a wrapper that allows any PydanticAI agent to connect
to and participate in the OpenAgents network. PydanticAI enables type-safe
agent interactions with validated responses, reducing runtime errors.

Example usage:
    from pydantic_ai import Agent
    from openagents.agents import PydanticAIAgentRunner

    # Create your PydanticAI agent
    agent = Agent(
        'openai:gpt-4',
        system_prompt='You are a helpful assistant.'
    )

    # Connect to OpenAgents network
    runner = PydanticAIAgentRunner(
        pydantic_agent=agent,
        agent_id="my-pydantic-agent"
    )
    runner.start(network_host="localhost", network_port=8600)
    runner.wait_for_stop()
"""

import logging
from typing import Any, Callable, Dict, List, Optional, Set

from openagents.agents.runner import AgentRunner
from openagents.models.event import Event
from openagents.models.event_context import EventContext
from openagents.models.tool import AgentTool

logger = logging.getLogger(__name__)

# Type alias for PydanticAI agents - we use Any to avoid hard dependency
PydanticAgent = Any


def openagents_tool_to_pydantic(agent_tool: AgentTool) -> Any:
    """
    Convert an OpenAgents AgentTool to a PydanticAI tool.

    This allows PydanticAI agents to use tools provided by the OpenAgents network
    (e.g., messaging tools, discovery tools, etc.)

    Args:
        agent_tool: The OpenAgents tool to convert

    Returns:
        A function decorated as a PydanticAI tool

    Raises:
        ImportError: If pydantic-ai is not installed
    """
    # Create a wrapper function that calls the OpenAgents tool
    async def tool_wrapper(**kwargs) -> str:
        """Wrapper that executes the OpenAgents tool."""
        try:
            result = await agent_tool.execute(**kwargs)
            return str(result)
        except Exception as e:
            return f"Tool execution failed: {e}"

    # Set function metadata for PydanticAI
    tool_wrapper.__name__ = agent_tool.name
    tool_wrapper.__doc__ = agent_tool.description

    return tool_wrapper


def pydantic_tool_to_openagents(pydantic_tool: Any) -> AgentTool:
    """
    Convert a PydanticAI tool to an OpenAgents AgentTool.

    This allows OpenAgents to use tools defined in PydanticAI format.

    Args:
        pydantic_tool: The PydanticAI tool to convert

    Returns:
        An OpenAgents AgentTool instance
    """
    import asyncio
    import inspect

    # Extract tool info from PydanticAI tool
    name = getattr(pydantic_tool, 'name', pydantic_tool.__name__)
    description = getattr(pydantic_tool, 'description', pydantic_tool.__doc__ or "")
    
    # Try to get schema from the tool
    input_schema = {}
    if hasattr(pydantic_tool, 'parameters_json_schema'):
        input_schema = pydantic_tool.parameters_json_schema

    # Create async wrapper for the tool
    async def tool_func(**kwargs) -> Any:
        if asyncio.iscoroutinefunction(pydantic_tool):
            return await pydantic_tool(**kwargs)
        else:
            return pydantic_tool(**kwargs)

    return AgentTool(
        name=name,
        description=description,
        input_schema=input_schema,
        func=tool_func,
    )


class PydanticAIAgentRunner(AgentRunner):
    """
    An AgentRunner that wraps a PydanticAI agent for use in OpenAgents network.

    This class bridges PydanticAI's type-safe agent framework with OpenAgents'
    network capabilities, allowing PydanticAI agents to:
    - Receive messages from the OpenAgents network
    - Use OpenAgents network tools (messaging, discovery, etc.)
    - Send responses back to other agents

    PydanticAI provides type-safe, model-agnostic agents with features like:
    - Strong typing with Pydantic models
    - Dependency injection
    - Streaming support
    - Tool/function calling

    Example:
        from pydantic_ai import Agent
        from openagents.agents import PydanticAIAgentRunner

        # Create PydanticAI agent
        agent = Agent(
            'openai:gpt-4',
            system_prompt='You are a helpful assistant.',
            tools=[my_tool],
        )

        # Connect to OpenAgents
        runner = PydanticAIAgentRunner(
            pydantic_agent=agent,
            agent_id="assistant"
        )
        runner.start(network_host="localhost", network_port=8600)
    """

    def __init__(
        self,
        pydantic_agent: PydanticAgent,
        agent_id: Optional[str] = None,
        include_network_tools: bool = True,
        response_handler: Optional[Callable[[EventContext, str], None]] = None,
        event_names: Optional[List[str]] = None,
        event_filter: Optional[Callable[[EventContext], bool]] = None,
        deps: Optional[Any] = None,
        **kwargs
    ):
        """
        Initialize the PydanticAI agent runner.

        Args:
            pydantic_agent: The PydanticAI Agent instance to wrap.
            agent_id: ID for this agent on the network. If not provided,
                will be auto-generated.
            include_network_tools: If True, OpenAgents network tools will be
                registered with the PydanticAI agent.
            response_handler: Optional custom handler for processing responses.
                If provided, it will be called with (context, response_text)
                instead of the default broadcast behavior.
            event_names: Optional list of event names to react to. If provided,
                the agent will only process events with matching event_name.
                Example: ["agent.message", "thread.new_message"]
            event_filter: Optional custom filter function that takes an
                EventContext and returns True if the agent should react.
                This is applied after event_names filtering.
            deps: Optional dependencies to pass to the PydanticAI agent's run method.
                These are injected into tools via PydanticAI's dependency injection.
            **kwargs: Additional arguments passed to AgentRunner.
        """
        super().__init__(agent_id=agent_id, **kwargs)

        self._pydantic_agent = pydantic_agent
        self._include_network_tools = include_network_tools
        self._response_handler = response_handler
        self._event_names: Optional[Set[str]] = set(event_names) if event_names else None
        self._event_filter = event_filter
        self._deps = deps
        self._tools_injected = False

        # Validate the PydanticAI agent
        if not hasattr(pydantic_agent, 'run') and not hasattr(pydantic_agent, 'run_sync'):
            raise ValueError(
                "pydantic_agent must have a 'run' or 'run_sync' method. "
                "Make sure you're passing a PydanticAI Agent instance."
            )

        logger.info(f"Initialized PydanticAIAgentRunner with agent_id={agent_id}")

    @property
    def pydantic_agent(self) -> PydanticAgent:
        """Get the wrapped PydanticAI agent."""
        return self._pydantic_agent

    def _should_react(self, context: EventContext) -> bool:
        """
        Determine if the agent should react to the given event.

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
                return False

        return True

    async def setup(self):
        """Setup the runner and inject network tools if enabled."""
        await super().setup()

        # Inject OpenAgents tools into PydanticAI agent if requested
        if self._include_network_tools and not self._tools_injected:
            await self._inject_network_tools()
            self._tools_injected = True

    async def _inject_network_tools(self):
        """
        Inject OpenAgents network tools into the PydanticAI agent.

        This converts OpenAgents tools to PydanticAI format and registers them.
        """
        openagents_tools = self.tools
        if not openagents_tools:
            logger.debug("No OpenAgents tools to inject")
            return

        try:
            for tool in openagents_tools:
                wrapped_tool = openagents_tool_to_pydantic(tool)
                
                # Register the tool with the PydanticAI agent
                if hasattr(self._pydantic_agent, 'tool'):
                    # Use the @agent.tool decorator pattern
                    self._pydantic_agent.tool(wrapped_tool)
                    logger.debug(f"Injected tool '{tool.name}' into PydanticAI agent")
                else:
                    logger.warning(
                        "PydanticAI agent does not support dynamic tool registration"
                    )
                    break
            
            logger.info(
                f"Injected {len(openagents_tools)} OpenAgents tools "
                f"into PydanticAI agent"
            )
        except ImportError as e:
            logger.warning(f"Could not inject network tools: {e}")
        except Exception as e:
            logger.error(f"Error injecting network tools: {e}")

    def _extract_input_text(self, context: EventContext) -> str:
        """
        Extract the input text from an EventContext.

        Args:
            context: The event context containing the incoming message

        Returns:
            The extracted text content
        """
        event = context.incoming_event

        # Try to get text from various sources
        if hasattr(event, 'text_representation') and event.text_representation:
            return event.text_representation

        if isinstance(event.payload, dict):
            content = event.payload.get('content', {})
            if isinstance(content, dict) and 'text' in content:
                return content['text']
            if 'text' in event.payload:
                return event.payload['text']
            if 'message' in event.payload:
                return str(event.payload['message'])

        if event.payload:
            return str(event.payload)

        return ""

    def _extract_output(self, result: Any) -> str:
        """
        Extract the output string from a PydanticAI agent result.

        Args:
            result: The result from the PydanticAI agent

        Returns:
            The extracted output string
        """
        # PydanticAI returns a RunResult object
        if hasattr(result, 'data'):
            return str(result.data)
        
        if hasattr(result, 'output'):
            return str(result.output)
        
        if isinstance(result, str):
            return result

        return str(result)

    async def react(self, context: EventContext):
        """
        React to an incoming message by running the PydanticAI agent.

        This method:
        1. Checks if the event passes configured filters
        2. Extracts input from the EventContext
        3. Runs the PydanticAI agent
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

            logger.debug(
                f"Running PydanticAI agent with input: {input_text[:100]}..."
            )

            # Run the PydanticAI agent
            if hasattr(self._pydantic_agent, 'run'):
                # Async run method (preferred)
                if self._deps is not None:
                    result = await self._pydantic_agent.run(input_text, deps=self._deps)
                else:
                    result = await self._pydantic_agent.run(input_text)
            else:
                # Fallback to sync run in executor
                import asyncio
                import concurrent.futures

                with concurrent.futures.ThreadPoolExecutor() as executor:
                    loop = asyncio.get_event_loop()
                    if self._deps is not None:
                        result = await loop.run_in_executor(
                            executor,
                            lambda: self._pydantic_agent.run_sync(input_text, deps=self._deps)
                        )
                    else:
                        result = await loop.run_in_executor(
                            executor,
                            lambda: self._pydantic_agent.run_sync(input_text)
                        )

            # Extract output
            output_text = self._extract_output(result)

            logger.debug(f"PydanticAI agent response: {output_text[:100]}...")

            # Send response
            await self._send_response(context, output_text)

        except Exception as e:
            logger.error(f"Error in PydanticAI agent execution: {e}")
            error_message = f"I encountered an error: {str(e)}"
            await self._send_response(context, error_message)

    async def _send_response(self, context: EventContext, response_text: str):
        """
        Send the response back to the network.

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


def create_pydantic_runner(
    pydantic_agent: PydanticAgent,
    agent_id: Optional[str] = None,
    **kwargs
) -> PydanticAIAgentRunner:
    """
    Convenience function to create a PydanticAIAgentRunner.

    Args:
        pydantic_agent: The PydanticAI agent to wrap
        agent_id: Optional agent ID
        **kwargs: Additional arguments for PydanticAIAgentRunner

    Returns:
        A configured PydanticAIAgentRunner instance
    """
    return PydanticAIAgentRunner(
        pydantic_agent=pydantic_agent,
        agent_id=agent_id,
        **kwargs
    )
