"""
LlamaIndex Agent Runner for OpenAgents.

This module provides a wrapper that allows LlamaIndex agents to connect
to and participate in the OpenAgents network.

LlamaIndex excels at RAG (Retrieval Augmented Generation) pipelines,
making it ideal for knowledge-intensive agent tasks.

Example usage:
    from llama_index.core.agent import ReActAgent
    from llama_index.llms.openai import OpenAI
    from openagents.agents import LlamaIndexAgentRunner

    # Create your LlamaIndex agent
    llm = OpenAI(model="gpt-4")
    agent = ReActAgent.from_tools(tools, llm=llm, verbose=True)

    # Connect to OpenAgents network
    runner = LlamaIndexAgentRunner(
        llamaindex_agent=agent,
        agent_id="my-llamaindex-agent"
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

# Type alias for LlamaIndex agents - we use Any to avoid hard dependency
LlamaIndexAgent = Any


def openagents_tool_to_llamaindex(agent_tool: AgentTool) -> Any:
    """
    Convert an OpenAgents AgentTool to a LlamaIndex FunctionTool.

    Args:
        agent_tool: The OpenAgents tool to convert

    Returns:
        A LlamaIndex FunctionTool

    Raises:
        ImportError: If llama-index is not installed
    """
    try:
        from llama_index.core.tools import FunctionTool
        import asyncio
    except ImportError:
        raise ImportError(
            "llama-index-core is required for tool conversion. "
            "Install it with: pip install llama-index-core"
        )

    def sync_wrapper(**kwargs) -> str:
        """Synchronous wrapper for the async OpenAgents tool."""
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor() as executor:
                    future = executor.submit(
                        asyncio.run,
                        agent_tool.execute(**kwargs)
                    )
                    return str(future.result())
            else:
                return str(loop.run_until_complete(
                    agent_tool.execute(**kwargs)
                ))
        except Exception as e:
            return f"Tool execution failed: {e}"

    return FunctionTool.from_defaults(
        fn=sync_wrapper,
        name=agent_tool.name,
        description=agent_tool.description,
    )


def llamaindex_tool_to_openagents(llamaindex_tool: Any) -> AgentTool:
    """
    Convert a LlamaIndex tool to an OpenAgents AgentTool.

    Args:
        llamaindex_tool: The LlamaIndex tool to convert

    Returns:
        An OpenAgents AgentTool instance
    """
    import asyncio

    # Extract name and description - handle both dict and ToolMetadata objects
    metadata = getattr(llamaindex_tool, 'metadata', None)
    if metadata is not None:
        if isinstance(metadata, dict):
            name = metadata.get('name', '')
            description = metadata.get('description', '')
        else:
            # ToolMetadata object - access as attributes
            name = getattr(metadata, 'name', '') or ''
            description = getattr(metadata, 'description', '') or ''
    else:
        name = ''
        description = ''

    # Fallback to direct attributes if metadata didn't provide values
    if not name:
        name = getattr(llamaindex_tool, 'name', llamaindex_tool.__class__.__name__)
    if not description:
        description = getattr(llamaindex_tool, 'description', '')

    # Get schema if available
    input_schema = {}
    if hasattr(llamaindex_tool, 'metadata') and hasattr(llamaindex_tool.metadata, 'fn_schema'):
        if llamaindex_tool.metadata.fn_schema:
            input_schema = llamaindex_tool.metadata.fn_schema.model_json_schema()

    async def tool_func(**kwargs) -> Any:
        if hasattr(llamaindex_tool, 'acall'):
            return await llamaindex_tool.acall(**kwargs)
        elif hasattr(llamaindex_tool, 'call'):
            result = llamaindex_tool.call(**kwargs)
            if asyncio.iscoroutine(result):
                return await result
            return result
        elif callable(llamaindex_tool):
            result = llamaindex_tool(**kwargs)
            if asyncio.iscoroutine(result):
                return await result
            return result
        return str(llamaindex_tool)

    return AgentTool(
        name=name,
        description=description,
        input_schema=input_schema,
        func=tool_func,
    )


class LlamaIndexAgentRunner(AgentRunner):
    """
    An AgentRunner that wraps a LlamaIndex agent for use in OpenAgents network.

    This class bridges LlamaIndex's RAG-focused agent framework with OpenAgents'
    network capabilities, allowing LlamaIndex agents to:
    - Receive messages from the OpenAgents network
    - Use OpenAgents network tools alongside RAG pipelines
    - Send knowledge-enhanced responses back to other agents

    LlamaIndex is particularly strong for:
    - Retrieval Augmented Generation (RAG)
    - Document Q&A
    - Knowledge base agents
    - Multi-document reasoning

    Example:
        from llama_index.core.agent import ReActAgent
        from llama_index.llms.openai import OpenAI
        from openagents.agents import LlamaIndexAgentRunner

        # Create LlamaIndex agent with tools
        llm = OpenAI(model="gpt-4")
        agent = ReActAgent.from_tools(
            tools,
            llm=llm,
            verbose=True
        )

        # Connect to OpenAgents
        runner = LlamaIndexAgentRunner(
            llamaindex_agent=agent,
            agent_id="knowledge-agent"
        )
        runner.start(network_host="localhost", network_port=8600)
    """

    def __init__(
        self,
        llamaindex_agent: LlamaIndexAgent,
        agent_id: Optional[str] = None,
        include_network_tools: bool = True,
        response_handler: Optional[Callable[[EventContext, str], None]] = None,
        event_names: Optional[List[str]] = None,
        event_filter: Optional[Callable[[EventContext], bool]] = None,
        **kwargs
    ):
        """
        Initialize the LlamaIndex agent runner.

        Args:
            llamaindex_agent: The LlamaIndex agent to wrap. Must have a `chat`
                or `query` method (e.g., ReActAgent, OpenAIAgent).
            agent_id: ID for this agent on the network. If not provided,
                will be auto-generated.
            include_network_tools: If True, OpenAgents network tools will be
                added to the LlamaIndex agent.
            response_handler: Optional custom handler for processing responses.
            event_names: Optional list of event names to react to.
            event_filter: Optional custom filter function.
            **kwargs: Additional arguments passed to AgentRunner.
        """
        super().__init__(agent_id=agent_id, **kwargs)

        self._llamaindex_agent = llamaindex_agent
        self._include_network_tools = include_network_tools
        self._response_handler = response_handler
        self._event_names: Optional[Set[str]] = set(event_names) if event_names else None
        self._event_filter = event_filter
        self._tools_injected = False

        # Validate the LlamaIndex agent
        if not (hasattr(llamaindex_agent, 'chat') or 
                hasattr(llamaindex_agent, 'query') or
                hasattr(llamaindex_agent, 'achat') or
                hasattr(llamaindex_agent, 'aquery')):
            raise ValueError(
                "llamaindex_agent must have a 'chat', 'query', 'achat', or 'aquery' method. "
                "Make sure you're passing a LlamaIndex agent instance."
            )

        logger.info(f"Initialized LlamaIndexAgentRunner with agent_id={agent_id}")

    @property
    def llamaindex_agent(self) -> LlamaIndexAgent:
        """Get the wrapped LlamaIndex agent."""
        return self._llamaindex_agent

    def _should_react(self, context: EventContext) -> bool:
        """Determine if the agent should react to the given event."""
        event = context.incoming_event

        if self._event_names is not None:
            if event.event_name not in self._event_names:
                logger.debug(f"Skipping event '{event.event_name}' - not in allowed list")
                return False

        if self._event_filter is not None:
            try:
                if not self._event_filter(context):
                    logger.debug(f"Skipping event - rejected by custom filter")
                    return False
            except Exception as e:
                logger.error(f"Error in event_filter: {e}")
                return False

        return True

    async def setup(self):
        """Setup the runner and inject network tools if enabled."""
        await super().setup()

        if self._include_network_tools and not self._tools_injected:
            await self._inject_network_tools()
            self._tools_injected = True

    async def _inject_network_tools(self):
        """Inject OpenAgents network tools into the LlamaIndex agent."""
        openagents_tools = self.tools
        if not openagents_tools:
            logger.debug("No OpenAgents tools to inject")
            return

        try:
            llamaindex_tools = [
                openagents_tool_to_llamaindex(tool)
                for tool in openagents_tools
            ]

            # Try to add tools to the agent
            if hasattr(self._llamaindex_agent, 'tools'):
                if isinstance(self._llamaindex_agent.tools, list):
                    self._llamaindex_agent.tools.extend(llamaindex_tools)
                    logger.info(
                        f"Injected {len(llamaindex_tools)} OpenAgents tools "
                        f"into LlamaIndex agent"
                    )
            elif hasattr(self._llamaindex_agent, '_tools'):
                if isinstance(self._llamaindex_agent._tools, list):
                    self._llamaindex_agent._tools.extend(llamaindex_tools)
                    logger.info(
                        f"Injected {len(llamaindex_tools)} OpenAgents tools "
                        f"into LlamaIndex agent"
                    )
            else:
                logger.warning(
                    "LlamaIndex agent does not have a 'tools' attribute. "
                    "Network tools not injected."
                )
        except ImportError as e:
            logger.warning(f"Could not inject network tools: {e}")
        except Exception as e:
            logger.error(f"Error injecting network tools: {e}")

    def _extract_input_text(self, context: EventContext) -> str:
        """Extract the input text from an EventContext."""
        event = context.incoming_event

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
        """Extract the output string from a LlamaIndex agent result."""
        # LlamaIndex returns AgentChatResponse or Response objects
        if hasattr(result, 'response'):
            return str(result.response)
        
        if hasattr(result, 'output'):
            return str(result.output)
        
        if hasattr(result, 'content'):
            return str(result.content)
        
        if isinstance(result, str):
            return result

        return str(result)

    async def react(self, context: EventContext):
        """React to an incoming message by running the LlamaIndex agent."""
        if not self._should_react(context):
            return

        try:
            input_text = self._extract_input_text(context)

            logger.debug(f"Running LlamaIndex agent with input: {input_text[:100]}...")

            # Run the agent - prefer async methods
            if hasattr(self._llamaindex_agent, 'achat'):
                result = await self._llamaindex_agent.achat(input_text)
            elif hasattr(self._llamaindex_agent, 'aquery'):
                result = await self._llamaindex_agent.aquery(input_text)
            else:
                # Fallback to sync methods in executor
                import asyncio
                import concurrent.futures

                with concurrent.futures.ThreadPoolExecutor() as executor:
                    loop = asyncio.get_event_loop()
                    
                    if hasattr(self._llamaindex_agent, 'chat'):
                        result = await loop.run_in_executor(
                            executor,
                            lambda: self._llamaindex_agent.chat(input_text)
                        )
                    else:
                        result = await loop.run_in_executor(
                            executor,
                            lambda: self._llamaindex_agent.query(input_text)
                        )

            output_text = self._extract_output(result)

            logger.debug(f"LlamaIndex agent response: {output_text[:100]}...")

            await self._send_response(context, output_text)

        except Exception as e:
            logger.error(f"Error in LlamaIndex agent execution: {e}")
            error_message = f"I encountered an error: {str(e)}"
            await self._send_response(context, error_message)

    async def _send_response(self, context: EventContext, response_text: str):
        """Send the response back to the network."""
        if self._response_handler:
            await self._response_handler(context, response_text)
            return

        source_id = context.incoming_event.source_id
        if not source_id:
            logger.warning("No source_id in event, cannot send response")
            return

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


def create_llamaindex_runner(
    llamaindex_agent: LlamaIndexAgent,
    agent_id: Optional[str] = None,
    **kwargs
) -> LlamaIndexAgentRunner:
    """
    Convenience function to create a LlamaIndexAgentRunner.

    Args:
        llamaindex_agent: The LlamaIndex agent to wrap
        agent_id: Optional agent ID
        **kwargs: Additional arguments for LlamaIndexAgentRunner

    Returns:
        A configured LlamaIndexAgentRunner instance
    """
    return LlamaIndexAgentRunner(
        llamaindex_agent=llamaindex_agent,
        agent_id=agent_id,
        **kwargs
    )
