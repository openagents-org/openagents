"""
Test cases for the LangChain agent integration.

This module contains tests for the LangChainAgentRunner and tool converters.
"""

import os
import pytest
import asyncio
from unittest.mock import MagicMock, AsyncMock, patch

from openagents.models.event import Event
from openagents.models.event_context import EventContext
from openagents.models.event_thread import EventThread
from openagents.models.tool import AgentTool


# Check if LangChain is available
try:
    from langchain_core.tools import BaseTool
    LANGCHAIN_AVAILABLE = True
except ImportError:
    LANGCHAIN_AVAILABLE = False


@pytest.fixture
def sample_openagents_tool():
    """Create a sample OpenAgents tool for testing."""
    async def sample_func(message: str) -> str:
        return f"Processed: {message}"

    return AgentTool(
        name="sample_tool",
        description="A sample tool that processes messages",
        input_schema={
            "type": "object",
            "properties": {
                "message": {"type": "string", "description": "Message to process"}
            },
            "required": ["message"],
        },
        func=sample_func,
    )


@pytest.fixture
def mock_event_context():
    """Create a mock EventContext for testing."""
    incoming_event = Event(
        event_name="agent.message",
        source_id="test_sender",
        destination_id="langchain-agent",
        payload={
            "content": {
                "text": "Hello, can you help me with the weather?"
            }
        },
    )

    event_threads = {
        "thread_1": EventThread(events=[])
    }

    return EventContext(
        incoming_event=incoming_event,
        incoming_thread_id="thread_1",
        event_threads=event_threads,
    )


@pytest.fixture
def mock_langchain_agent():
    """Create a mock LangChain agent for testing."""
    mock_agent = MagicMock()
    mock_agent.invoke = MagicMock(return_value={"output": "This is a test response"})
    mock_agent.ainvoke = AsyncMock(return_value={"output": "This is an async test response"})
    mock_agent.tools = []
    return mock_agent


class TestToolConverters:
    """Test cases for tool conversion functions."""

    def test_openagents_tool_creation(self, sample_openagents_tool):
        """Test that OpenAgents tools are created correctly."""
        assert sample_openagents_tool.name == "sample_tool"
        assert sample_openagents_tool.description == "A sample tool that processes messages"
        assert "message" in sample_openagents_tool.input_schema["properties"]

    @pytest.mark.asyncio
    async def test_openagents_tool_execution(self, sample_openagents_tool):
        """Test that OpenAgents tools execute correctly."""
        result = await sample_openagents_tool.execute(message="test")
        assert result == "Processed: test"

    @pytest.mark.skipif(not LANGCHAIN_AVAILABLE, reason="LangChain not installed")
    def test_openagents_to_langchain_conversion(self, sample_openagents_tool):
        """Test converting OpenAgents tool to LangChain format."""
        from openagents.agents.langchain_agent import openagents_tool_to_langchain

        langchain_tool = openagents_tool_to_langchain(sample_openagents_tool)

        assert langchain_tool.name == "sample_tool"
        assert langchain_tool.description == "A sample tool that processes messages"
        assert isinstance(langchain_tool, BaseTool)

    @pytest.mark.skipif(not LANGCHAIN_AVAILABLE, reason="LangChain not installed")
    def test_langchain_to_openagents_conversion(self):
        """Test converting LangChain tool to OpenAgents format."""
        from langchain_core.tools import tool
        from openagents.agents.langchain_agent import langchain_tool_to_openagents

        @tool
        def test_tool(x: int) -> int:
            """Multiply input by 2."""
            return x * 2

        openagents_tool = langchain_tool_to_openagents(test_tool)

        assert openagents_tool.name == "test_tool"
        assert "Multiply" in openagents_tool.description
        assert isinstance(openagents_tool, AgentTool)


class TestLangChainAgentRunner:
    """Test cases for the LangChainAgentRunner class."""

    def test_runner_initialization(self, mock_langchain_agent):
        """Test that LangChainAgentRunner initializes correctly."""
        from openagents.agents.langchain_agent import LangChainAgentRunner

        runner = LangChainAgentRunner(
            langchain_agent=mock_langchain_agent,
            agent_id="test-langchain-agent",
            include_network_tools=False,  # Disable for unit test
        )

        assert runner.agent_id == "test-langchain-agent"
        assert runner.langchain_agent == mock_langchain_agent

    def test_runner_requires_valid_agent(self):
        """Test that runner raises error for invalid agent."""
        from openagents.agents.langchain_agent import LangChainAgentRunner

        invalid_agent = MagicMock(spec=[])  # No invoke or ainvoke

        with pytest.raises(ValueError, match="invoke"):
            LangChainAgentRunner(
                langchain_agent=invalid_agent,
                agent_id="test-agent",
            )

    def test_extract_input_text_from_content(self, mock_langchain_agent, mock_event_context):
        """Test extracting input text from event context with content structure."""
        from openagents.agents.langchain_agent import LangChainAgentRunner

        runner = LangChainAgentRunner(
            langchain_agent=mock_langchain_agent,
            agent_id="test-agent",
            include_network_tools=False,
        )

        text = runner._extract_input_text(mock_event_context)
        assert text == "Hello, can you help me with the weather?"

    def test_extract_input_text_from_text_representation(self, mock_langchain_agent):
        """Test extracting input text from text_representation attribute."""
        from openagents.agents.langchain_agent import LangChainAgentRunner

        runner = LangChainAgentRunner(
            langchain_agent=mock_langchain_agent,
            agent_id="test-agent",
            include_network_tools=False,
        )

        # Create event with text_representation
        event = Event(
            event_name="agent.message",
            source_id="sender",
            payload={},
        )
        event.text_representation = "Direct text representation"

        context = EventContext(
            incoming_event=event,
            incoming_thread_id="thread_1",
            event_threads={"thread_1": EventThread(events=[])},
        )

        text = runner._extract_input_text(context)
        assert text == "Direct text representation"

    def test_extract_output_from_dict(self, mock_langchain_agent):
        """Test extracting output from dictionary result."""
        from openagents.agents.langchain_agent import LangChainAgentRunner

        runner = LangChainAgentRunner(
            langchain_agent=mock_langchain_agent,
            agent_id="test-agent",
            include_network_tools=False,
        )

        result = {"output": "This is the output"}
        output = runner._extract_output(result)
        assert output == "This is the output"

    def test_extract_output_from_string(self, mock_langchain_agent):
        """Test extracting output from string result."""
        from openagents.agents.langchain_agent import LangChainAgentRunner

        runner = LangChainAgentRunner(
            langchain_agent=mock_langchain_agent,
            agent_id="test-agent",
            include_network_tools=False,
        )

        output = runner._extract_output("Direct string output")
        assert output == "Direct string output"

    def test_build_langchain_input(self, mock_langchain_agent, mock_event_context):
        """Test building LangChain input from event context."""
        from openagents.agents.langchain_agent import LangChainAgentRunner

        runner = LangChainAgentRunner(
            langchain_agent=mock_langchain_agent,
            agent_id="test-agent",
            include_network_tools=False,
        )

        langchain_input = runner._build_langchain_input(mock_event_context)

        assert "input" in langchain_input
        assert langchain_input["input"] == "Hello, can you help me with the weather?"
        assert "_openagents_metadata" in langchain_input
        assert langchain_input["_openagents_metadata"]["source_id"] == "test_sender"

    @pytest.mark.asyncio
    async def test_react_calls_langchain_agent(self, mock_langchain_agent, mock_event_context):
        """Test that react() calls the LangChain agent correctly."""
        from openagents.agents.langchain_agent import LangChainAgentRunner

        runner = LangChainAgentRunner(
            langchain_agent=mock_langchain_agent,
            agent_id="test-agent",
            include_network_tools=False,
        )

        # Mock the send_event method
        runner.send_event = AsyncMock()

        await runner.react(mock_event_context)

        # Verify LangChain agent was called
        mock_langchain_agent.ainvoke.assert_called_once()

        # Verify response was sent
        runner.send_event.assert_called_once()
        sent_event = runner.send_event.call_args[0][0]
        assert sent_event.destination_id == "test_sender"
        assert "async test response" in sent_event.payload["content"]["text"]

    @pytest.mark.asyncio
    async def test_react_with_custom_response_handler(self, mock_langchain_agent, mock_event_context):
        """Test that custom response handler is called."""
        from openagents.agents.langchain_agent import LangChainAgentRunner

        custom_handler_called = False
        received_response = None

        async def custom_handler(context, response_text):
            nonlocal custom_handler_called, received_response
            custom_handler_called = True
            received_response = response_text

        runner = LangChainAgentRunner(
            langchain_agent=mock_langchain_agent,
            agent_id="test-agent",
            include_network_tools=False,
            response_handler=custom_handler,
        )

        await runner.react(mock_event_context)

        assert custom_handler_called
        assert received_response == "This is an async test response"

    @pytest.mark.asyncio
    async def test_react_handles_errors_gracefully(self, mock_event_context):
        """Test that react() handles errors gracefully."""
        from openagents.agents.langchain_agent import LangChainAgentRunner

        # Create agent that raises an error
        error_agent = MagicMock()
        error_agent.ainvoke = AsyncMock(side_effect=Exception("Test error"))
        error_agent.tools = []

        runner = LangChainAgentRunner(
            langchain_agent=error_agent,
            agent_id="test-agent",
            include_network_tools=False,
        )

        # Mock the send_event method
        runner.send_event = AsyncMock()

        # Should not raise, but send error response
        await runner.react(mock_event_context)

        # Verify error response was sent
        runner.send_event.assert_called_once()
        sent_event = runner.send_event.call_args[0][0]
        assert "error" in sent_event.payload["content"]["text"].lower()


class TestCreateLangChainRunner:
    """Test cases for the create_langchain_runner helper function."""

    def test_create_langchain_runner(self, mock_langchain_agent):
        """Test the create_langchain_runner helper function."""
        from openagents.agents.langchain_agent import create_langchain_runner

        runner = create_langchain_runner(
            langchain_agent=mock_langchain_agent,
            agent_id="helper-created-agent",
        )

        assert runner.agent_id == "helper-created-agent"
        assert runner.langchain_agent == mock_langchain_agent


@pytest.mark.skipif(
    not LANGCHAIN_AVAILABLE or not os.getenv("OPENAI_API_KEY"),
    reason="LangChain not installed or OPENAI_API_KEY not set"
)
@pytest.mark.integration
class TestLangChainIntegration:
    """Integration tests with real LangChain components."""

    @pytest.mark.asyncio
    async def test_real_langchain_agent(self, mock_event_context):
        """Test with a real LangChain agent (requires OPENAI_API_KEY)."""
        from langchain_openai import ChatOpenAI
        from langchain_core.tools import tool
        from langchain_core.messages import HumanMessage
        from openagents.agents.langchain_agent import LangChainAgentRunner

        @tool
        def get_weather(location: str) -> str:
            """Get weather for a location."""
            return f"Sunny, 72F in {location}"

        # Create LLM with tools bound
        llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)
        llm_with_tools = llm.bind_tools([get_weather])

        # Create a simple wrapper that has invoke/ainvoke interface
        # This simulates a basic agent that calls tools and returns results
        class SimpleToolAgent:
            def __init__(self, llm, tools):
                self.llm = llm
                self.tools = tools
                self._tool_map = {t.name: t for t in tools}

            def invoke(self, inputs):
                message = inputs.get("input", "")
                response = self.llm.invoke([HumanMessage(content=message)])
                # Handle tool calls
                if response.tool_calls:
                    tool_results = []
                    for tool_call in response.tool_calls:
                        tool_fn = self._tool_map.get(tool_call["name"])
                        if tool_fn:
                            result = tool_fn.invoke(tool_call["args"])
                            tool_results.append(result)
                    return {"output": " ".join(tool_results)}
                return {"output": response.content or "No response"}

            async def ainvoke(self, inputs):
                message = inputs.get("input", "")
                response = await self.llm.ainvoke([HumanMessage(content=message)])
                # Handle tool calls
                if response.tool_calls:
                    tool_results = []
                    for tool_call in response.tool_calls:
                        tool_fn = self._tool_map.get(tool_call["name"])
                        if tool_fn:
                            result = await tool_fn.ainvoke(tool_call["args"])
                            tool_results.append(result)
                    return {"output": " ".join(tool_results)}
                return {"output": response.content or "No response"}

        agent = SimpleToolAgent(llm_with_tools, [get_weather])

        runner = LangChainAgentRunner(
            langchain_agent=agent,
            agent_id="weather-assistant",
            include_network_tools=False,
        )

        # Test input extraction
        input_text = runner._extract_input_text(mock_event_context)
        assert "weather" in input_text.lower()

        # Test building input
        langchain_input = runner._build_langchain_input(mock_event_context)
        assert langchain_input["input"] == input_text

        # Test the agent runs (without full network)
        result = await agent.ainvoke({"input": "What's the weather in Tokyo?"})
        assert "output" in result
        assert len(result["output"]) > 0
        # Verify the tool was called and returned weather info
        assert "Tokyo" in result["output"] or "Sunny" in result["output"]


class TestImports:
    """Test that imports work correctly."""

    def test_import_from_agents_module(self):
        """Test that LangChain components can be imported from agents module."""
        from openagents.agents import (
            LangChainAgentRunner,
            create_langchain_runner,
            openagents_tool_to_langchain,
            langchain_tool_to_openagents,
        )

        assert LangChainAgentRunner is not None
        assert create_langchain_runner is not None
        assert openagents_tool_to_langchain is not None
        assert langchain_tool_to_openagents is not None

    def test_direct_import(self):
        """Test direct import from langchain_agent module."""
        from openagents.agents.langchain_agent import (
            LangChainAgentRunner,
            create_langchain_runner,
            openagents_tool_to_langchain,
            langchain_tool_to_openagents,
        )

        assert LangChainAgentRunner is not None
        assert create_langchain_runner is not None
