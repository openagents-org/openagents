"""
Test cases for the Smolagents agent integration.

This module contains tests for the SmolagentsAgentRunner and tool converters.
"""

import os
import pytest
import asyncio
from unittest.mock import MagicMock, AsyncMock, patch

from openagents.models.event import Event
from openagents.models.event_context import EventContext
from openagents.models.event_thread import EventThread
from openagents.models.tool import AgentTool


# Check if Smolagents is available
try:
    from smolagents import Tool, CodeAgent, ToolCallingAgent
    SMOLAGENTS_AVAILABLE = True
except ImportError:
    SMOLAGENTS_AVAILABLE = False


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
        destination_id="smolagents-agent",
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
def mock_smolagents_agent():
    """Create a mock Smolagents agent for testing."""
    mock_agent = MagicMock()
    # Use a regular function that returns a value
    def mock_run(prompt):
        return "This is a test response"
    mock_agent.run = mock_run
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

    @pytest.mark.skipif(not SMOLAGENTS_AVAILABLE, reason="Smolagents not installed")
    def test_openagents_to_smolagents_conversion(self, sample_openagents_tool):
        """Test converting OpenAgents tool to Smolagents format."""
        from openagents.agents.smolagents_agent import openagents_tool_to_smolagents

        smol_tool = openagents_tool_to_smolagents(sample_openagents_tool)

        # Smolagents Tool created with @tool decorator has name and description attributes
        assert hasattr(smol_tool, 'name')
        assert smol_tool.name == "sample_tool"
        assert hasattr(smol_tool, 'description')
        assert "sample tool" in smol_tool.description.lower()

    @pytest.mark.skipif(not SMOLAGENTS_AVAILABLE, reason="Smolagents not installed")
    @pytest.mark.asyncio
    async def test_smolagents_tool_execution(self, sample_openagents_tool):
        """Test that converted Smolagents tool executes correctly."""
        from openagents.agents.smolagents_agent import openagents_tool_to_smolagents

        smol_tool = openagents_tool_to_smolagents(sample_openagents_tool)
        # Smolagents Tool uses forward() method
        result = await smol_tool.forward(message="test message")

        assert "Processed: test message" in result

    def test_smolagents_to_openagents_conversion(self):
        """Test converting Smolagents tool to OpenAgents format."""
        from openagents.agents.smolagents_agent import smolagents_tool_to_openagents

        # Create a mock Smolagents tool
        def mock_smol_func(query: str) -> str:
            return f"Result for: {query}"

        mock_smol_tool = MagicMock()
        mock_smol_tool.name = "search_tool"
        mock_smol_tool.description = "A search tool"
        mock_smol_tool.forward = mock_smol_func
        mock_smol_tool.inputs = {
            "type": "object",
            "properties": {"query": {"type": "string"}}
        }

        openagents_tool = smolagents_tool_to_openagents(mock_smol_tool)

        assert openagents_tool.name == "search_tool"
        assert openagents_tool.description == "A search tool"

    @pytest.mark.asyncio
    async def test_smolagents_to_openagents_execution(self):
        """Test that converted OpenAgents tool executes correctly."""
        from openagents.agents.smolagents_agent import smolagents_tool_to_openagents

        def mock_smol_func(query: str) -> str:
            return f"Result for: {query}"

        mock_smol_tool = MagicMock()
        mock_smol_tool.name = "search_tool"
        mock_smol_tool.description = "A search tool"
        mock_smol_tool.forward = mock_smol_func
        mock_smol_tool.inputs = {}

        openagents_tool = smolagents_tool_to_openagents(mock_smol_tool)
        result = await openagents_tool.execute(query="test query")

        assert result == "Result for: test query"


class TestSmolagentsAgentRunner:
    """Test cases for SmolagentsAgentRunner."""

    def test_runner_initialization(self, mock_smolagents_agent):
        """Test that the runner initializes correctly."""
        from openagents.agents.smolagents_agent import SmolagentsAgentRunner

        runner = SmolagentsAgentRunner(
            smolagents_agent=mock_smolagents_agent,
            agent_id="test-agent"
        )

        assert runner.agent_id == "test-agent"
        assert runner.smolagents_agent == mock_smolagents_agent

    def test_runner_validation(self):
        """Test that the runner validates the agent correctly."""
        from openagents.agents.smolagents_agent import SmolagentsAgentRunner

        # Agent without 'run' method should raise ValueError
        invalid_agent = MagicMock()
        del invalid_agent.run

        with pytest.raises(ValueError, match="must have a 'run' method"):
            SmolagentsAgentRunner(smolagents_agent=invalid_agent)

    def test_extract_input_text(self, mock_smolagents_agent, mock_event_context):
        """Test extracting input text from event context."""
        from openagents.agents.smolagents_agent import SmolagentsAgentRunner

        runner = SmolagentsAgentRunner(smolagents_agent=mock_smolagents_agent)

        text = runner._extract_input_text(mock_event_context)
        assert text == "Hello, can you help me with the weather?"

    def test_extract_input_text_various_formats(self, mock_smolagents_agent):
        """Test extracting input text from various payload formats."""
        from openagents.agents.smolagents_agent import SmolagentsAgentRunner

        runner = SmolagentsAgentRunner(smolagents_agent=mock_smolagents_agent)

        # Test with direct text in payload
        event1 = Event(
            event_name="agent.message",
            source_id="test",
            payload={"text": "Direct text message"}
        )
        context1 = EventContext(
            incoming_event=event1,
            incoming_thread_id="thread_1",
            event_threads={}
        )
        assert runner._extract_input_text(context1) == "Direct text message"

        # Test with message field
        event2 = Event(
            event_name="agent.message",
            source_id="test",
            payload={"message": "Message field content"}
        )
        context2 = EventContext(
            incoming_event=event2,
            incoming_thread_id="thread_1",
            event_threads={}
        )
        assert runner._extract_input_text(context2) == "Message field content"

    def test_should_react_event_names_filter(self, mock_smolagents_agent, mock_event_context):
        """Test event names filtering."""
        from openagents.agents.smolagents_agent import SmolagentsAgentRunner

        # Create runner with specific event names
        runner = SmolagentsAgentRunner(
            smolagents_agent=mock_smolagents_agent,
            event_names=["agent.message", "thread.new_message"]
        )

        # Should react to agent.message
        assert runner._should_react(mock_event_context) is True

        # Should not react to other events
        mock_event_context.incoming_event.event_name = "other.event"
        assert runner._should_react(mock_event_context) is False

    def test_should_react_event_filter(self, mock_smolagents_agent, mock_event_context):
        """Test custom event filter."""
        from openagents.agents.smolagents_agent import SmolagentsAgentRunner

        # Create runner with custom filter
        def custom_filter(context):
            return context.incoming_event.source_id != "ignored_sender"

        runner = SmolagentsAgentRunner(
            smolagents_agent=mock_smolagents_agent,
            event_filter=custom_filter
        )

        # Should react to normal sender
        assert runner._should_react(mock_event_context) is True

        # Should not react to ignored sender
        mock_event_context.incoming_event.source_id = "ignored_sender"
        assert runner._should_react(mock_event_context) is False

    def test_extract_output(self, mock_smolagents_agent):
        """Test extracting output from agent result."""
        from openagents.agents.smolagents_agent import SmolagentsAgentRunner

        runner = SmolagentsAgentRunner(smolagents_agent=mock_smolagents_agent)

        # Test with dict output
        result1 = {"output": "Test output", "other": "data"}
        assert runner._extract_output(result1) == "Test output"

        # Test with response key
        result2 = {"response": "Response text"}
        assert runner._extract_output(result2) == "Response text"

        # Test with string output
        result3 = "Direct string"
        assert runner._extract_output(result3) == "Direct string"

    @pytest.mark.asyncio
    async def test_react_runs_agent(self, mock_smolagents_agent, mock_event_context):
        """Test that react method runs the agent."""
        from openagents.agents.smolagents_agent import SmolagentsAgentRunner

        # Track if run was called
        run_called = []
        def tracking_run(prompt):
            run_called.append(prompt)
            return "Test response"
        mock_smolagents_agent.run = tracking_run

        runner = SmolagentsAgentRunner(
            smolagents_agent=mock_smolagents_agent,
            agent_id="test-agent"
        )

        # Mock send_event
        runner.send_event = AsyncMock()

        await runner.react(mock_event_context)

        # Verify agent was called
        assert len(run_called) == 1
        assert "weather" in run_called[0]

    @pytest.mark.asyncio
    async def test_react_sends_response(self, mock_smolagents_agent, mock_event_context):
        """Test that react method sends response."""
        from openagents.agents.smolagents_agent import SmolagentsAgentRunner

        runner = SmolagentsAgentRunner(
            smolagents_agent=mock_smolagents_agent,
            agent_id="test-agent"
        )

        # Mock send_event
        runner.send_event = AsyncMock()

        await runner.react(mock_event_context)

        # Verify response was sent
        runner.send_event.assert_called_once()
        call_args = runner.send_event.call_args[0][0]
        assert call_args.event_name == "agent.message"
        assert call_args.destination_id == "test_sender"

    @pytest.mark.asyncio
    async def test_react_handles_errors(self, mock_smolagents_agent, mock_event_context):
        """Test that react method handles agent errors."""
        from openagents.agents.smolagents_agent import SmolagentsAgentRunner

        # Make agent raise an exception
        def failing_run(prompt):
            raise Exception("Test error")
        mock_smolagents_agent.run = failing_run

        runner = SmolagentsAgentRunner(
            smolagents_agent=mock_smolagents_agent,
            agent_id="test-agent"
        )

        # Mock send_event
        runner.send_event = AsyncMock()

        await runner.react(mock_event_context)

        # Verify error response was sent
        runner.send_event.assert_called_once()
        call_args = runner.send_event.call_args[0][0]
        assert "error" in call_args.payload["content"]["text"].lower()

    @pytest.mark.asyncio
    async def test_react_respects_filters(self, mock_smolagents_agent, mock_event_context):
        """Test that react respects event filters."""
        from openagents.agents.smolagents_agent import SmolagentsAgentRunner

        runner = SmolagentsAgentRunner(
            smolagents_agent=mock_smolagents_agent,
            agent_id="test-agent",
            event_names=["other.event"]  # Only react to other.event
        )

        # Mock send_event
        runner.send_event = AsyncMock()

        await runner.react(mock_event_context)

        # Agent should not be called because event name doesn't match
        runner.send_event.assert_not_called()


class TestSmolagentsAgentRunnerSetup:
    """Test cases for SmolagentsAgentRunner setup and tool injection."""

    @pytest.mark.asyncio
    async def test_setup_injects_tools(self, mock_smolagents_agent):
        """Test that setup injects network tools."""
        from openagents.agents.smolagents_agent import SmolagentsAgentRunner

        runner = SmolagentsAgentRunner(
            smolagents_agent=mock_smolagents_agent,
            agent_id="test-agent",
            include_network_tools=True
        )

        # Mock tools
        runner._tools = [
            AgentTool(
                name="network_tool",
                description="A network tool",
                input_schema={},
                func=lambda: "result"
            )
        ]

        # Mock the tool conversion to avoid import issues
        with patch('openagents.agents.smolagents_agent.openagents_tool_to_smolagents') as mock_convert:
            mock_smol_tool = MagicMock()
            mock_convert.return_value = mock_smol_tool

            await runner.setup()

            # Verify tools were converted and added
            mock_convert.assert_called_once()

    @pytest.mark.asyncio
    async def test_setup_skips_injection_when_disabled(self, mock_smolagents_agent):
        """Test that setup skips tool injection when disabled."""
        from openagents.agents.smolagents_agent import SmolagentsAgentRunner

        runner = SmolagentsAgentRunner(
            smolagents_agent=mock_smolagents_agent,
            agent_id="test-agent",
            include_network_tools=False
        )

        with patch('openagents.agents.smolagents_agent.openagents_tool_to_smolagents') as mock_convert:
            await runner.setup()

            # Should not convert tools
            mock_convert.assert_not_called()


class TestCreateSmolagentsRunner:
    """Test cases for create_smolagents_runner convenience function."""

    def test_create_runner(self, mock_smolagents_agent):
        """Test the convenience function creates runner correctly."""
        from openagents.agents.smolagents_agent import (
            create_smolagents_runner,
            SmolagentsAgentRunner
        )

        runner = create_smolagents_runner(
            smolagents_agent=mock_smolagents_agent,
            agent_id="convenience-agent"
        )

        assert isinstance(runner, SmolagentsAgentRunner)
        assert runner.agent_id == "convenience-agent"


class TestSmolagentsAgentRunnerIntegration:
    """Integration tests for SmolagentsAgentRunner."""

    @pytest.mark.skipif(not SMOLAGENTS_AVAILABLE, reason="Smolagents not installed")
    @pytest.mark.asyncio
    async def test_full_react_flow(self):
        """Test the full react flow with a real-like setup."""
        from openagents.agents.smolagents_agent import SmolagentsAgentRunner

        # Create a more realistic mock
        run_calls = []
        def mock_run(prompt):
            run_calls.append(prompt)
            return f"Processed: {prompt[:20]}..."

        mock_agent = MagicMock()
        mock_agent.run = mock_run
        mock_agent.tools = []

        runner = SmolagentsAgentRunner(
            smolagents_agent=mock_agent,
            agent_id="integration-agent"
        )

        # Create a realistic event
        event = Event(
            event_name="agent.message",
            source_id="user_123",
            destination_id="integration-agent",
            payload={
                "content": {
                    "text": "What is the weather like today?"
                }
            }
        )

        context = EventContext(
            incoming_event=event,
            incoming_thread_id="thread_abc",
            event_threads={}
        )

        # Mock send_event
        runner.send_event = AsyncMock()

        await runner.react(context)

        # Verify the flow worked
        assert len(run_calls) == 1
        runner.send_event.assert_called_once()

        # Check response content
        response_event = runner.send_event.call_args[0][0]
        assert response_event.source_id == "integration-agent"
        assert response_event.destination_id == "user_123"
