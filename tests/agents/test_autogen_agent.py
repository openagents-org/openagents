"""
Test cases for the AutoGen agent integration.
"""

from pathlib import Path

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from openagents.models.event import Event
from openagents.models.event_context import EventContext
from openagents.models.event_thread import EventThread
from openagents.models.tool import AgentTool


try:
    from autogen_core.tools import BaseTool, FunctionTool  # type: ignore

    AUTOGEN_AVAILABLE = True
except ImportError:
    AUTOGEN_AVAILABLE = False
    FunctionTool = None


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
                "message": {
                    "type": "string",
                    "description": "Message to process",
                }
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
        destination_id="autogen-agent",
        payload={"content": {"text": "Hello from OpenAgents"}},
    )
    event_threads = {"thread_1": EventThread(events=[])}
    return EventContext(
        incoming_event=incoming_event,
        incoming_thread_id="thread_1",
        event_threads=event_threads,
    )


@pytest.fixture
def mock_single_autogen_entity():
    """Create a mock single AutoGen entity."""
    entity = MagicMock()
    entity.run = AsyncMock(return_value={"output": "AutoGen single response"})
    entity.tools = []
    return entity


@pytest.fixture
def mock_team_autogen_entity():
    """Create a mock team-style AutoGen entity."""
    participant_a = MagicMock()
    participant_a.tools = []
    participant_b = MagicMock()
    participant_b.tools = []

    team = MagicMock()
    task_result = MagicMock()
    task_result.messages = [{"content": "Team final response"}]
    team.run = AsyncMock(return_value=task_result)
    team.participants = [participant_a, participant_b]
    return team


class TestToolConverters:
    """Test cases for tool conversion functions."""

    @pytest.mark.skipif(not AUTOGEN_AVAILABLE, reason="AutoGen not installed")
    def test_openagents_to_autogen_conversion(self, sample_openagents_tool):
        """Test converting OpenAgents tool to AutoGen BaseTool."""
        from openagents.agents.autogen_agent import openagents_tool_to_autogen

        autogen_tool = openagents_tool_to_autogen(sample_openagents_tool)
        assert autogen_tool is not None
        assert isinstance(autogen_tool, BaseTool)
        assert autogen_tool.schema["name"] == "sample_tool"
        assert (
            autogen_tool.schema["parameters"]["properties"]["message"]["type"]
            == "string"
        )

    def test_autogen_to_openagents_conversion(self):
        """Test converting AutoGen-like tool to OpenAgents format."""
        from openagents.agents.autogen_agent import autogen_tool_to_openagents

        class MockAutoGenTool:
            name = "mock_tool"
            description = "Mock tool description"
            schema = {"type": "object"}

            async def run_json(self, payload):
                return f"ok:{payload}"

        openagents_tool = autogen_tool_to_openagents(MockAutoGenTool())
        assert openagents_tool.name == "mock_tool"
        assert openagents_tool.description == "Mock tool description"
        assert openagents_tool.input_schema == {"type": "object"}


class TestAutoGenAgentRunner:
    """Test cases for AutoGenAgentRunner."""

    def test_runner_initialization(self, mock_single_autogen_entity):
        """Runner initializes with valid entity."""
        from openagents.agents.autogen_agent import AutoGenAgentRunner

        runner = AutoGenAgentRunner(
            autogen_entity=mock_single_autogen_entity,
            agent_id="autogen-agent",
            include_network_tools=False,
        )
        assert runner.agent_id == "autogen-agent"
        assert runner.autogen_entity == mock_single_autogen_entity

    def test_runner_requires_valid_entity(self):
        """Runner rejects entities without run-like methods."""
        from openagents.agents.autogen_agent import AutoGenAgentRunner

        invalid = MagicMock(spec=[])
        with pytest.raises(ValueError, match="run-like API"):
            AutoGenAgentRunner(autogen_entity=invalid, agent_id="bad-agent")

    def test_extract_input_text(
        self,
        mock_single_autogen_entity,
        mock_event_context,
    ):
        """Extract input text from event payload."""
        from openagents.agents.autogen_agent import AutoGenAgentRunner

        runner = AutoGenAgentRunner(
            autogen_entity=mock_single_autogen_entity,
            agent_id="autogen-agent",
            include_network_tools=False,
        )
        assert (
            runner._extract_input_text(mock_event_context)
            == "Hello from OpenAgents"
        )

    def test_extract_output_from_dict(self, mock_single_autogen_entity):
        """Extract output from dictionary-like result."""
        from openagents.agents.autogen_agent import AutoGenAgentRunner

        runner = AutoGenAgentRunner(
            autogen_entity=mock_single_autogen_entity,
            agent_id="autogen-agent",
            include_network_tools=False,
        )
        assert runner._extract_output({"output": "hello"}) == "hello"

    def test_extract_output_from_messages(self, mock_single_autogen_entity):
        """Extract output from result.messages."""
        from openagents.agents.autogen_agent import AutoGenAgentRunner

        runner = AutoGenAgentRunner(
            autogen_entity=mock_single_autogen_entity,
            agent_id="autogen-agent",
            include_network_tools=False,
        )

        result = MagicMock()
        result.messages = [MagicMock(content="final content")]
        assert runner._extract_output(result) == "final content"

    @pytest.mark.asyncio
    async def test_react_single_agent_path(
        self, mock_single_autogen_entity, mock_event_context
    ):
        """react() invokes single-entity run and sends response."""
        from openagents.agents.autogen_agent import AutoGenAgentRunner

        runner = AutoGenAgentRunner(
            autogen_entity=mock_single_autogen_entity,
            agent_id="autogen-agent",
            include_network_tools=False,
        )
        runner.send_event = AsyncMock()

        await runner.react(mock_event_context)

        mock_single_autogen_entity.run.assert_called_once()
        runner.send_event.assert_called_once()
        sent_event = runner.send_event.call_args[0][0]
        assert sent_event.destination_id == "test_sender"
        assert (
            "AutoGen single response"
            in sent_event.payload["content"]["text"]
        )

    @pytest.mark.asyncio
    async def test_react_team_path(
        self,
        mock_team_autogen_entity,
        mock_event_context,
    ):
        """react() works for team entities and extracts final message."""
        from openagents.agents.autogen_agent import AutoGenAgentRunner

        runner = AutoGenAgentRunner(
            autogen_entity=mock_team_autogen_entity,
            agent_id="autogen-team",
            include_network_tools=False,
        )
        runner.send_event = AsyncMock()

        await runner.react(mock_event_context)

        mock_team_autogen_entity.run.assert_called_once()
        runner.send_event.assert_called_once()
        sent_event = runner.send_event.call_args[0][0]
        assert "Team final response" in sent_event.payload["content"]["text"]

    @pytest.mark.asyncio
    async def test_react_run_stream_path(self, mock_event_context):
        """react() consumes run_stream and uses the terminal TaskResult."""
        from openagents.agents.autogen_agent import AutoGenAgentRunner

        class StreamEntity:
            async def run_stream(self, task):
                yield {"content": f"intermediate: {task}"}
                yield MagicMock(
                    messages=[{"content": "Stream final response"}]
                )

        runner = AutoGenAgentRunner(
            autogen_entity=StreamEntity(),
            agent_id="autogen-stream",
            include_network_tools=False,
        )
        runner.send_event = AsyncMock()

        await runner.react(mock_event_context)

        runner.send_event.assert_called_once()
        sent_event = runner.send_event.call_args[0][0]
        assert "Stream final response" in sent_event.payload["content"]["text"]

    @pytest.mark.asyncio
    async def test_react_with_custom_response_handler(
        self, mock_single_autogen_entity, mock_event_context
    ):
        """Custom response handler is used when provided."""
        from openagents.agents.autogen_agent import AutoGenAgentRunner

        called = {"ok": False, "response": ""}

        async def custom_handler(context, response_text):
            called["ok"] = True
            called["response"] = response_text

        runner = AutoGenAgentRunner(
            autogen_entity=mock_single_autogen_entity,
            agent_id="autogen-agent",
            include_network_tools=False,
            response_handler=custom_handler,
        )

        await runner.react(mock_event_context)

        assert called["ok"] is True
        assert called["response"] == "AutoGen single response"

    @pytest.mark.asyncio
    async def test_react_handles_errors_gracefully(self, mock_event_context):
        """react() sends an error response when execution fails."""
        from openagents.agents.autogen_agent import AutoGenAgentRunner

        broken_entity = MagicMock()
        broken_entity.run = AsyncMock(side_effect=Exception("boom"))
        broken_entity.tools = []

        runner = AutoGenAgentRunner(
            autogen_entity=broken_entity,
            agent_id="autogen-agent",
            include_network_tools=False,
        )
        runner.send_event = AsyncMock()

        await runner.react(mock_event_context)
        runner.send_event.assert_called_once()
        sent_event = runner.send_event.call_args[0][0]
        assert "error" in sent_event.payload["content"]["text"].lower()


class TestEventFiltering:
    """Test event filtering behavior."""

    def test_event_names_filter_blocks_non_matching(
        self,
        mock_single_autogen_entity,
    ):
        """event_names blocks events not in allowed list."""
        from openagents.agents.autogen_agent import AutoGenAgentRunner

        runner = AutoGenAgentRunner(
            autogen_entity=mock_single_autogen_entity,
            agent_id="autogen-agent",
            include_network_tools=False,
            event_names=["thread.new_message"],
        )

        event = Event(
            event_name="agent.message",
            source_id="sender",
            payload={"content": {"text": "hello"}},
        )
        context = EventContext(
            incoming_event=event,
            incoming_thread_id="thread_1",
            event_threads={"thread_1": EventThread(events=[])},
        )
        assert runner._should_react(context) is False

    def test_event_filter_error_blocks_event(
        self, mock_single_autogen_entity, mock_event_context
    ):
        """Errors in event_filter fail closed."""
        from openagents.agents.autogen_agent import AutoGenAgentRunner

        def broken_filter(_):
            raise ValueError("broken")

        runner = AutoGenAgentRunner(
            autogen_entity=mock_single_autogen_entity,
            agent_id="autogen-agent",
            include_network_tools=False,
            event_filter=broken_filter,
        )
        assert runner._should_react(mock_event_context) is False


class TestSetupAndImports:
    """Test setup/tool injection and package exports."""

    @pytest.mark.skipif(not AUTOGEN_AVAILABLE, reason="AutoGen not installed")
    @pytest.mark.asyncio
    async def test_setup_injects_tools(
        self,
        mock_single_autogen_entity,
        sample_openagents_tool,
    ):
        """setup() injects converted OpenAgents tools."""
        from openagents.agents.autogen_agent import AutoGenAgentRunner

        runner = AutoGenAgentRunner(
            autogen_entity=mock_single_autogen_entity,
            agent_id="autogen-agent",
            include_network_tools=True,
        )

        runner._tools = [sample_openagents_tool]
        await runner.setup()
        assert len(mock_single_autogen_entity.tools) == 1

    @pytest.mark.asyncio
    async def test_setup_warns_when_runtime_injection_is_unsupported(
        self,
        sample_openagents_tool,
        caplog,
    ):
        """setup() warns when no mutable tool container is exposed."""
        from openagents.agents.autogen_agent import AutoGenAgentRunner

        class NoToolsEntity:
            async def run(self, task):
                return {"output": task}

        runner = AutoGenAgentRunner(
            autogen_entity=NoToolsEntity(),
            agent_id="autogen-no-tools",
            include_network_tools=True,
        )
        runner._tools = [sample_openagents_tool]

        with patch(
            "openagents.agents.autogen_agent.openagents_tool_to_autogen",
            return_value=object(),
        ):
            await runner.setup()

        assert "preconfigure tools at construction time" in caplog.text

    def test_import_from_agents_module(self):
        """AutoGen symbols are exported from openagents.agents."""
        from openagents.agents import (
            AutoGenAgentRunner,
            create_autogen_runner,
            openagents_tool_to_autogen,
            autogen_tool_to_openagents,
        )

        assert AutoGenAgentRunner is not None
        assert create_autogen_runner is not None
        assert openagents_tool_to_autogen is not None
        assert autogen_tool_to_openagents is not None

    def test_all_extra_includes_autogen(self):
        """The aggregate optional dependency set includes the autogen extra."""
        pyproject_path = Path(__file__).resolve().parents[2] / "pyproject.toml"
        pyproject_text = pyproject_path.read_text(encoding="utf-8")
        assert "autogen = [" in pyproject_text
        all_extra_line = next(
            line.strip()
            for line in pyproject_text.splitlines()
            if "openagents[" in line and "autogen" in line
        )
        assert "autogen" in all_extra_line
