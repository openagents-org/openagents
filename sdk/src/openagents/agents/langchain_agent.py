"""
LangChain Agent Runner for OpenAgents.

This module provides a wrapper that allows any LangChain agent to connect
to and participate in the OpenAgents network.

Example usage:
    from langchain_openai import ChatOpenAI
    from langchain.agents import create_tool_calling_agent, AgentExecutor
    from openagents.agents import LangChainAgentRunner

    # Create your LangChain agent
    llm = ChatOpenAI(model="gpt-4")
    agent = create_tool_calling_agent(llm, tools, prompt)
    executor = AgentExecutor(agent=agent, tools=tools)

    # Connect to OpenAgents network
    runner = LangChainAgentRunner(
        langchain_agent=executor,
        agent_id="my-langchain-agent"
    )
    runner.start(network_host="localhost", network_port=8600)
    runner.wait_for_stop()
"""

import logging
from typing import Any, Callable, Dict, List, Optional, Set, Union

from openagents.agents.runner import AgentRunner
from openagents.models.event import Event
from openagents.models.event_context import EventContext
from openagents.models.event_response import EventResponse
from openagents.models.tool import AgentTool

logger = logging.getLogger(__name__)

# Type alias for LangChain agents - we use Any to avoid hard dependency
LangChainAgent = Any


def openagents_tool_to_langchain(agent_tool: AgentTool) -> Any:
    """
    Convert an OpenAgents AgentTool to a LangChain BaseTool.

    This allows LangChain agents to use tools provided by the OpenAgents network
    (e.g., messaging tools, discovery tools, etc.)

    Args:
        agent_tool: The OpenAgents tool to convert

    Returns:
        A LangChain BaseTool instance

    Raises:
        ImportError: If langchain is not installed
    """
    try:
        from langchain_core.tools import BaseTool, ToolException
        from pydantic import Field
        import asyncio
    except ImportError:
        raise ImportError(
            "langchain-core is required for tool conversion. "
            "Install it with: pip install langchain-core"
        )

    # Create a dynamic LangChain tool class
    class WrappedOpenAgentsTool(BaseTool):
        name: str = agent_tool.name
        description: str = agent_tool.description
        _openagents_tool: AgentTool = agent_tool

        def _run(self, **kwargs) -> str:
            """Synchronous execution - runs async in event loop."""
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    # If we're already in an async context, create a new task
                    import concurrent.futures
                    with concurrent.futures.ThreadPoolExecutor() as executor:
                        future = executor.submit(
                            asyncio.run,
                            self._openagents_tool.execute(**kwargs)
                        )
                        return str(future.result())
                else:
                    return str(loop.run_until_complete(
                        self._openagents_tool.execute(**kwargs)
                    ))
            except Exception as e:
                raise ToolException(f"Tool execution failed: {e}")

        async def _arun(self, **kwargs) -> str:
            """Asynchronous execution."""
            try:
                result = await self._openagents_tool.execute(**kwargs)
                return str(result)
            except Exception as e:
                raise ToolException(f"Tool execution failed: {e}")

    return WrappedOpenAgentsTool()


def langchain_tool_to_openagents(langchain_tool: Any) -> AgentTool:
    """
    Convert a LangChain BaseTool to an OpenAgents AgentTool.

    This allows OpenAgents to use tools defined in LangChain format.

    Args:
        langchain_tool: The LangChain tool to convert

    Returns:
        An OpenAgents AgentTool instance
    """
    import asyncio
    import inspect

    # Extract the input schema from LangChain tool
    input_schema = {}
    if hasattr(langchain_tool, 'args_schema') and langchain_tool.args_schema:
        # Get JSON schema from Pydantic model
        input_schema = langchain_tool.args_schema.model_json_schema()
    elif hasattr(langchain_tool, 'args'):
        input_schema = langchain_tool.args

    # Create async wrapper for the tool
    async def tool_func(**kwargs) -> Any:
        if hasattr(langchain_tool, 'ainvoke'):
            return await langchain_tool.ainvoke(kwargs)
        elif hasattr(langchain_tool, '_arun'):
            return await langchain_tool._arun(**kwargs)
        elif hasattr(langchain_tool, 'invoke'):
            return langchain_tool.invoke(kwargs)
        elif hasattr(langchain_tool, '_run'):
            result = langchain_tool._run(**kwargs)
            if inspect.iscoroutine(result):
                return await result
            return result
        else:
            raise ValueError(f"Tool {langchain_tool.name} has no callable method")

    return AgentTool(
        name=langchain_tool.name,
        description=langchain_tool.description or "",
        input_schema=input_schema,
        func=tool_func,
    )


class LangChainAgentRunner(AgentRunner):
    """
    An AgentRunner that wraps a LangChain agent for use in OpenAgents network.

    This class bridges LangChain's agent framework with OpenAgents' network
    capabilities, allowing LangChain agents to:
    - Receive messages from the OpenAgents network
    - Use OpenAgents network tools (messaging, discovery, etc.)
    - Send responses back to other agents

    Example:
        from langchain_openai import ChatOpenAI
        from langchain.agents import create_tool_calling_agent, AgentExecutor
        from langchain_core.prompts import ChatPromptTemplate

        # Create LangChain agent
        llm = ChatOpenAI(model="gpt-4")
        prompt = ChatPromptTemplate.from_messages([
            ("system", "You are a helpful assistant."),
            ("human", "{input}"),
            ("placeholder", "{agent_scratchpad}"),
        ])
        agent = create_tool_calling_agent(llm, [], prompt)
        executor = AgentExecutor(agent=agent, tools=[])

        # Connect to OpenAgents
        runner = LangChainAgentRunner(
            langchain_agent=executor,
            agent_id="assistant"
        )
        runner.start(network_host="localhost", network_port=8600)
    """

    def __init__(
        self,
        langchain_agent: LangChainAgent,
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
        Initialize the LangChain agent runner.

        Args:
            langchain_agent: The LangChain agent (AgentExecutor or similar)
                to wrap. Must have an `invoke` or `ainvoke` method.
            agent_id: ID for this agent on the network. If not provided,
                will be auto-generated.
            include_network_tools: If True, OpenAgents network tools will be
                converted and added to the LangChain agent's tools.
            input_key: The key to use for input in the LangChain agent.
                Defaults to "input".
            output_key: The key to extract output from the LangChain agent
                response. Defaults to "output".
            response_handler: Optional custom handler for processing responses.
                If provided, it will be called with (context, response_text)
                instead of the default broadcast behavior.
            event_names: Optional list of event names to react to. If provided,
                the agent will only process events with matching event_name.
                Example: ["agent.message", "thread.new_message"]
            event_filter: Optional custom filter function that takes an
                EventContext and returns True if the agent should react.
                This is applied after event_names filtering.
                Example: lambda ctx: ctx.incoming_event.source_id != "ignored"
            **kwargs: Additional arguments passed to AgentRunner.
        """
        super().__init__(agent_id=agent_id, **kwargs)

        self._langchain_agent = langchain_agent
        self._include_network_tools = include_network_tools
        self._input_key = input_key
        self._output_key = output_key
        self._response_handler = response_handler
        self._event_names: Optional[Set[str]] = set(event_names) if event_names else None
        self._event_filter = event_filter
        self._tools_injected = False

        # Validate the LangChain agent has required methods
        if not (hasattr(langchain_agent, 'invoke') or hasattr(langchain_agent, 'ainvoke')):
            raise ValueError(
                "langchain_agent must have an 'invoke' or 'ainvoke' method. "
                "Consider wrapping your agent in an AgentExecutor."
            )

        logger.info(f"Initialized LangChainAgentRunner with agent_id={agent_id}")

    @property
    def langchain_agent(self) -> LangChainAgent:
        """Get the wrapped LangChain agent."""
        return self._langchain_agent

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

    async def setup(self):
        """Setup the runner and inject network tools if enabled."""
        await super().setup()

        # Inject OpenAgents tools into LangChain agent if requested
        if self._include_network_tools and not self._tools_injected:
            await self._inject_network_tools()
            self._tools_injected = True

    async def _inject_network_tools(self):
        """
        Inject OpenAgents network tools into the LangChain agent.

        This converts OpenAgents tools (messaging, discovery, etc.) to
        LangChain format and adds them to the agent's tool list.
        """
        openagents_tools = self.tools
        if not openagents_tools:
            logger.debug("No OpenAgents tools to inject")
            return

        try:
            langchain_tools = [
                openagents_tool_to_langchain(tool)
                for tool in openagents_tools
            ]

            # Try to add tools to the agent
            if hasattr(self._langchain_agent, 'tools'):
                if isinstance(self._langchain_agent.tools, list):
                    self._langchain_agent.tools.extend(langchain_tools)
                    logger.info(
                        f"Injected {len(langchain_tools)} OpenAgents tools "
                        f"into LangChain agent"
                    )
            else:
                logger.warning(
                    "LangChain agent does not have a 'tools' attribute. "
                    "Network tools not injected."
                )
        except ImportError as e:
            logger.warning(f"Could not inject network tools: {e}")
        except Exception as e:
            logger.error(f"Error injecting network tools: {e}")

    def _extract_input_text(self, context: EventContext) -> str:
        """
        Extract the input text from an EventContext.

        This method handles various message formats and extracts the
        relevant text content for the LangChain agent.

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

    def _build_langchain_input(
        self,
        context: EventContext,
        additional_context: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Build the input dictionary for the LangChain agent.

        Args:
            context: The event context
            additional_context: Optional additional context to include

        Returns:
            Dictionary suitable for passing to the LangChain agent
        """
        input_text = self._extract_input_text(context)

        langchain_input = {
            self._input_key: input_text,
        }

        # Add metadata that might be useful for the agent
        langchain_input['_openagents_metadata'] = {
            'source_id': context.incoming_event.source_id,
            'thread_id': context.incoming_thread_id,
            'event_id': context.incoming_event.event_id,
            'event_name': context.incoming_event.event_name,
        }

        # Add any additional context
        if additional_context:
            langchain_input.update(additional_context)

        return langchain_input

    def _extract_output(self, result: Any) -> str:
        """
        Extract the output string from a LangChain agent result.

        Args:
            result: The result from the LangChain agent

        Returns:
            The extracted output string
        """
        if isinstance(result, dict):
            # Standard AgentExecutor output format
            if self._output_key in result:
                return str(result[self._output_key])
            # Fallback to 'response' key
            if 'response' in result:
                return str(result['response'])
            # Return string representation
            return str(result)

        if isinstance(result, str):
            return result

        # For other types (like AIMessage), try to get content
        if hasattr(result, 'content'):
            return str(result.content)

        return str(result)

    async def react(self, context: EventContext):
        """
        React to an incoming message by running the LangChain agent.

        This method:
        1. Checks if the event passes configured filters
        2. Extracts input from the EventContext
        3. Runs the LangChain agent
        4. Sends the response back to the network

        Args:
            context: The event context containing the incoming message
        """
        # Check if we should react to this event
        if not self._should_react(context):
            return

        try:
            # Build input for LangChain agent
            langchain_input = self._build_langchain_input(context)

            logger.debug(
                f"Running LangChain agent with input: "
                f"{langchain_input[self._input_key][:100]}..."
            )

            # Run the LangChain agent
            if hasattr(self._langchain_agent, 'ainvoke'):
                result = await self._langchain_agent.ainvoke(langchain_input)
            else:
                # Fallback to sync invoke in executor
                import asyncio
                import concurrent.futures

                with concurrent.futures.ThreadPoolExecutor() as executor:
                    loop = asyncio.get_event_loop()
                    result = await loop.run_in_executor(
                        executor,
                        lambda: self._langchain_agent.invoke(langchain_input)
                    )

            # Extract output
            output_text = self._extract_output(result)

            logger.debug(f"LangChain agent response: {output_text[:100]}...")

            # Send response
            await self._send_response(context, output_text)

        except Exception as e:
            logger.error(f"Error in LangChain agent execution: {e}")
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


def create_langchain_runner(
    langchain_agent: LangChainAgent,
    agent_id: Optional[str] = None,
    **kwargs
) -> LangChainAgentRunner:
    """
    Convenience function to create a LangChainAgentRunner.

    Args:
        langchain_agent: The LangChain agent to wrap
        agent_id: Optional agent ID
        **kwargs: Additional arguments for LangChainAgentRunner

    Returns:
        A configured LangChainAgentRunner instance
    """
    return LangChainAgentRunner(
        langchain_agent=langchain_agent,
        agent_id=agent_id,
        **kwargs
    )
