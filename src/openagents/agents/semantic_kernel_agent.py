"""
Semantic Kernel Agent Runner for OpenAgents.

This module provides a wrapper that allows any Microsoft Semantic Kernel agent
to connect to and participate in the OpenAgents network.

Example usage:
    from semantic_kernel.agents import ChatCompletionAgent
    from semantic_kernel.connectors.ai.open_ai import OpenAIChatCompletion
    from semantic_kernel import Kernel
    from openagents.agents.semantic_kernel_agent import SemanticKernelAgentRunner

    # Create your Semantic Kernel agent
    kernel = Kernel()
    kernel.add_service(OpenAIChatCompletion(service_id="chat", ai_model_id="gpt-4"))
    agent = ChatCompletionAgent(kernel=kernel, name="assistant", instructions="You are helpful.")

    # Connect to OpenAgents network
    runner = SemanticKernelAgentRunner(
        sk_agent=agent,
        agent_id="my-sk-agent"
    )
    runner.start(network_host="localhost", network_port=8600)
    runner.wait_for_stop()
"""

import inspect
import logging
from typing import Any, Callable, Dict, List, Optional, Set

from openagents.agents.runner import AgentRunner
from openagents.models.event import Event
from openagents.models.event_context import EventContext
from openagents.models.tool import AgentTool

logger = logging.getLogger(__name__)

# Lazy type alias — avoid hard dependency at import time
SemanticKernelAgent = Any


def _check_sk_installed():
    """Raise a clear ImportError if semantic-kernel is not installed."""
    try:
        import semantic_kernel  # noqa: F401
    except ImportError:
        raise ImportError(
            "semantic-kernel is required for SemanticKernelAgentRunner. "
            "Install it with: pip install semantic-kernel"
        )


def openagents_tool_to_sk_plugin(agent_tool: AgentTool) -> Any:
    """
    Convert an OpenAgents AgentTool to a Semantic Kernel KernelPlugin.

    The returned plugin contains a single KernelFunction that wraps the
    AgentTool so that a Semantic Kernel agent can call it during execution.

    Args:
        agent_tool: The OpenAgents tool to convert.

    Returns:
        A ``KernelPlugin`` instance containing one function.

    Raises:
        ImportError: If semantic-kernel is not installed.
    """
    _check_sk_installed()

    from semantic_kernel.functions import KernelFunction, KernelPlugin

    # Build an async wrapper decorated with the metadata SK needs.
    # We dynamically construct the function so that SK can introspect its
    # name / description via KernelFunction.from_method.
    async def _tool_wrapper(**kwargs: Any) -> str:
        result = await agent_tool.execute(**kwargs)
        return str(result)

    # Attach metadata that KernelFunction.from_method reads
    _tool_wrapper.__name__ = agent_tool.name
    _tool_wrapper.__doc__ = agent_tool.description
    _tool_wrapper.__kernel_function__ = True
    _tool_wrapper.__kernel_function_name__ = agent_tool.name
    _tool_wrapper.__kernel_function_description__ = agent_tool.description

    # Map JSON-schema type strings to Python type objects for SK introspection.
    _JSON_TYPE_MAP = {
        "string": str,
        "integer": int,
        "number": float,
        "boolean": bool,
        "array": list,
        "object": dict,
    }

    # Build parameter metadata from the tool's input_schema so SK knows
    # what arguments the function accepts.
    param_metadata: list = []
    properties = agent_tool.input_schema.get("properties", {})
    required_params = set(agent_tool.input_schema.get("required", []))
    for param_name, param_info in properties.items():
        json_type = param_info.get("type", "string")
        param_metadata.append({
            "name": param_name,
            "description": param_info.get("description", ""),
            "type_": json_type,
            "type_object": _JSON_TYPE_MAP.get(json_type, str),
            "is_required": param_name in required_params,
            "default_value": param_info.get("default"),
        })
    _tool_wrapper.__kernel_function_parameters__ = param_metadata
    _tool_wrapper.__kernel_function_return_type__ = "str"
    _tool_wrapper.__kernel_function_return_type_object__ = str
    _tool_wrapper.__kernel_function_return_description__ = ""
    _tool_wrapper.__kernel_function_return_required__ = True
    _tool_wrapper.__kernel_function_streaming__ = False

    kernel_func = KernelFunction.from_method(
        method=_tool_wrapper,
        plugin_name=agent_tool.name,
    )

    return KernelPlugin(
        name=agent_tool.name,
        description=agent_tool.description,
        functions=[kernel_func],
    )


class SemanticKernelAgentRunner(AgentRunner):
    """
    An AgentRunner that wraps a Microsoft Semantic Kernel agent for use in
    the OpenAgents network.

    This class bridges Semantic Kernel's agent framework with OpenAgents'
    network capabilities, allowing SK agents to:
    - Receive messages from the OpenAgents network
    - Use OpenAgents network tools (messaging, discovery, etc.)
    - Send responses back to other agents

    Example::

        from semantic_kernel.agents import ChatCompletionAgent
        from semantic_kernel.connectors.ai.open_ai import OpenAIChatCompletion
        from semantic_kernel import Kernel

        kernel = Kernel()
        kernel.add_service(OpenAIChatCompletion(service_id="chat", ai_model_id="gpt-4"))
        agent = ChatCompletionAgent(kernel=kernel, name="assistant", instructions="You are helpful.")

        runner = SemanticKernelAgentRunner(
            sk_agent=agent,
            agent_id="assistant",
        )
        runner.start(network_host="localhost", network_port=8600)
    """

    def __init__(
        self,
        sk_agent: SemanticKernelAgent,
        agent_id: Optional[str] = None,
        include_network_tools: bool = True,
        stream: bool = False,
        response_handler: Optional[Callable[[EventContext, str], Any]] = None,
        event_names: Optional[List[str]] = None,
        event_filter: Optional[Callable[[EventContext], bool]] = None,
        **kwargs,
    ):
        """
        Initialize the Semantic Kernel agent runner.

        Args:
            sk_agent: The Semantic Kernel agent (e.g. ``ChatCompletionAgent``)
                to wrap.  Must have an ``invoke`` method.
            agent_id: ID for this agent on the network.  Auto-generated when
                omitted.
            include_network_tools: If ``True``, OpenAgents network tools are
                converted to SK plugins and added to the agent's kernel.
            stream: If ``True``, use ``invoke_stream`` instead of ``invoke``.
                Streaming chunks are collected and sent as a single final
                response.
            response_handler: Optional custom handler called with
                ``(context, response_text)`` instead of the default broadcast.
            event_names: Optional list of event names to react to.  Events
                whose ``event_name`` is not in this list are ignored.
            event_filter: Optional predicate applied after *event_names*
                filtering.  Return ``True`` to process the event.
            **kwargs: Forwarded to :class:`AgentRunner`.
        """
        _check_sk_installed()
        super().__init__(agent_id=agent_id, **kwargs)

        self._sk_agent = sk_agent
        self._include_network_tools = include_network_tools
        self._stream = stream
        self._response_handler = response_handler
        self._event_names: Optional[Set[str]] = set(event_names) if event_names else None
        self._event_filter = event_filter
        self._tools_injected = False

        # Validate that the agent exposes the expected interface
        if not hasattr(sk_agent, "invoke"):
            raise ValueError(
                "sk_agent must have an 'invoke' method.  "
                "Pass a ChatCompletionAgent or compatible Semantic Kernel agent."
            )

        logger.info(f"Initialized SemanticKernelAgentRunner with agent_id={agent_id}")

    @property
    def sk_agent(self) -> SemanticKernelAgent:
        """Get the wrapped Semantic Kernel agent."""
        return self._sk_agent

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def setup(self):
        """Setup the runner and inject network tools if enabled."""
        await super().setup()

        if self._include_network_tools and not self._tools_injected:
            await self._inject_network_tools()
            self._tools_injected = True

    # ------------------------------------------------------------------
    # Filtering
    # ------------------------------------------------------------------

    def _should_react(self, context: EventContext) -> bool:
        """
        Determine if the agent should react to the given event.

        Checks configured *event_names* and *event_filter* in order.

        Args:
            context: The event context to evaluate.

        Returns:
            ``True`` if the agent should process this event.
        """
        event = context.incoming_event

        if self._event_names is not None:
            if event.event_name not in self._event_names:
                logger.debug(
                    f"Skipping event '{event.event_name}' — not in allowed "
                    f"event_names: {self._event_names}"
                )
                return False

        if self._event_filter is not None:
            try:
                if not self._event_filter(context):
                    logger.debug(
                        f"Skipping event '{event.event_name}' — "
                        f"rejected by custom event_filter"
                    )
                    return False
            except Exception as e:
                logger.error(f"Error in event_filter: {e}")
                return False

        return True

    # ------------------------------------------------------------------
    # Input / output helpers
    # ------------------------------------------------------------------

    def _extract_input_text(self, context: EventContext) -> str:
        """
        Extract the input text from an EventContext.

        Handles the common payload shapes used across OpenAgents.

        Args:
            context: The event context containing the incoming message.

        Returns:
            The extracted text content.
        """
        event = context.incoming_event

        if hasattr(event, "text_representation") and event.text_representation:
            return event.text_representation

        if isinstance(event.payload, dict):
            content = event.payload.get("content", {})
            if isinstance(content, dict) and "text" in content:
                return content["text"]
            if "text" in event.payload:
                return event.payload["text"]
            if "message" in event.payload:
                return str(event.payload["message"])

        if event.payload:
            return str(event.payload)

        return ""

    def _build_sk_input(self, context: EventContext) -> str:
        """
        Build the input string for the Semantic Kernel agent.

        SK agents accept plain strings (or ``ChatMessageContent``) as the
        *messages* parameter, so we simply return the extracted text.

        Args:
            context: The event context.

        Returns:
            A plain-text string to pass to ``agent.invoke()``.
        """
        return self._extract_input_text(context)

    def _extract_output(self, result: Any) -> str:
        """
        Extract the output string from a Semantic Kernel agent result.

        ``invoke`` / ``invoke_stream`` yield ``AgentResponseItem`` objects
        whose ``str()`` representation is the text content.

        Args:
            result: A single ``AgentResponseItem`` or any fallback value.

        Returns:
            The extracted output string.
        """
        if hasattr(result, "message"):
            msg = result.message
            # ChatMessageContent exposes .content as the first TextContent text
            if hasattr(msg, "content") and msg.content:
                return str(msg.content)
            return str(msg)

        if isinstance(result, str):
            return result

        return str(result)

    # ------------------------------------------------------------------
    # Tool injection
    # ------------------------------------------------------------------

    async def _inject_network_tools(self):
        """
        Inject OpenAgents network tools into the SK agent's kernel as plugins.

        Each ``AgentTool`` is converted to a ``KernelPlugin`` and added to
        the agent's ``kernel``.
        """
        openagents_tools = self.tools
        if not openagents_tools:
            logger.debug("No OpenAgents tools to inject")
            return

        try:
            for tool in openagents_tools:
                plugin = openagents_tool_to_sk_plugin(tool)
                self._sk_agent.kernel.add_plugin(plugin)

            logger.info(
                f"Injected {len(openagents_tools)} OpenAgents tools "
                f"into Semantic Kernel agent"
            )
        except ImportError as e:
            logger.warning(f"Could not inject network tools: {e}")
        except Exception as e:
            logger.error(f"Error injecting network tools: {e}")

    # ------------------------------------------------------------------
    # Response
    # ------------------------------------------------------------------

    async def _send_response(self, context: EventContext, response_text: str):
        """
        Send the response back to the OpenAgents network.

        Uses the custom *response_handler* when provided; otherwise sends an
        ``agent.message`` event addressed to the original sender.

        Args:
            context: The original event context.
            response_text: The response text to send.
        """
        if self._response_handler:
            result = self._response_handler(context, response_text)
            if inspect.iscoroutine(result):
                await result
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
                    "text": response_text,
                },
                "response_to": context.incoming_event.event_id,
            },
        )

        await self.send_event(response_event)
        logger.debug(f"Sent response to {source_id}")

    # ------------------------------------------------------------------
    # Core react
    # ------------------------------------------------------------------

    async def react(self, context: EventContext):
        """
        React to an incoming message by running the Semantic Kernel agent.

        1. Checks configured filters.
        2. Extracts input text from the ``EventContext``.
        3. Invokes the SK agent (streaming or non-streaming).
        4. Sends the response back to the network.

        Args:
            context: The event context containing the incoming message.
        """
        if not self._should_react(context):
            return

        try:
            input_text = self._build_sk_input(context)

            logger.debug(
                f"Running Semantic Kernel agent with input: "
                f"{input_text[:100]}..."
            )

            if self._stream and hasattr(self._sk_agent, "invoke_stream"):
                output_text = await self._invoke_stream(input_text)
            else:
                output_text = await self._invoke(input_text)

            logger.debug(f"Semantic Kernel agent response: {output_text[:100]}...")

            await self._send_response(context, output_text)

        except Exception as e:
            logger.error(f"Error in Semantic Kernel agent execution: {e}")
            error_message = f"I encountered an error: {str(e)}"
            await self._send_response(context, error_message)

    async def _invoke(self, input_text: str) -> str:
        """Run the agent in non-streaming mode and return the full response."""
        chunks: list[str] = []
        async for response_item in self._sk_agent.invoke(messages=input_text):
            text = self._extract_output(response_item)
            if text:
                chunks.append(text)
        return "".join(chunks)

    async def _invoke_stream(self, input_text: str) -> str:
        """Run the agent in streaming mode, collect all chunks, return the full response."""
        chunks: list[str] = []
        async for response_item in self._sk_agent.invoke_stream(messages=input_text):
            text = self._extract_output(response_item)
            if text:
                chunks.append(text)
        return "".join(chunks)


def create_semantic_kernel_runner(
    sk_agent: SemanticKernelAgent,
    agent_id: Optional[str] = None,
    **kwargs,
) -> SemanticKernelAgentRunner:
    """
    Convenience function to create a SemanticKernelAgentRunner.

    Args:
        sk_agent: The Semantic Kernel agent to wrap.
        agent_id: Optional agent ID.
        **kwargs: Additional arguments for SemanticKernelAgentRunner.

    Returns:
        A configured SemanticKernelAgentRunner instance.
    """
    return SemanticKernelAgentRunner(
        sk_agent=sk_agent,
        agent_id=agent_id,
        **kwargs,
    )
