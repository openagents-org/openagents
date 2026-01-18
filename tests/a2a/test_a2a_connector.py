"""Tests for A2A Network Connector."""

import pytest
from unittest.mock import MagicMock, AsyncMock, patch
import asyncio

import aiohttp
from aiohttp import web

from openagents.core.connectors.a2a_connector import A2ANetworkConnector
from openagents.models.a2a import (
    Task,
    TaskState,
    TaskStatus,
    A2AMessage,
    Artifact,
    TextPart,
    Role,
    AgentCard,
    AgentCapabilities,
    create_text_message,
)
from openagents.models.event import Event


class TestA2AConnectorConfig:
    """Tests for A2A connector configuration."""

    def test_basic_initialization(self):
        """Test basic connector initialization."""
        connector = A2ANetworkConnector(
            a2a_server_url="https://example.com/a2a",
            agent_id="test-agent",
        )

        assert connector.server_url == "https://example.com/a2a"
        assert connector.agent_id == "test-agent"
        assert connector.host == "example.com"
        assert connector.port == 443

    def test_http_url_parsing(self):
        """Test HTTP URL parsing."""
        connector = A2ANetworkConnector(
            a2a_server_url="http://localhost:8900",
            agent_id="test-agent",
        )

        assert connector.host == "localhost"
        assert connector.port == 8900

    def test_url_trailing_slash_removed(self):
        """Test trailing slash is removed from URL."""
        connector = A2ANetworkConnector(
            a2a_server_url="https://example.com/a2a/",
            agent_id="test-agent",
        )

        assert connector.server_url == "https://example.com/a2a"

    def test_auth_token(self):
        """Test authentication token configuration."""
        connector = A2ANetworkConnector(
            a2a_server_url="https://example.com",
            agent_id="test-agent",
            auth_token="secret-token",
        )

        assert connector.auth_token == "secret-token"
        headers = connector._get_headers()
        assert headers["Authorization"] == "Bearer secret-token"

    def test_custom_poll_interval(self):
        """Test custom poll interval."""
        connector = A2ANetworkConnector(
            a2a_server_url="https://example.com",
            agent_id="test-agent",
            poll_interval=5.0,
        )

        assert connector.poll_interval == 5.0

    def test_custom_timeout(self):
        """Test custom timeout."""
        connector = A2ANetworkConnector(
            a2a_server_url="https://example.com",
            agent_id="test-agent",
            timeout=60.0,
        )

        assert connector.timeout.total == 60.0

    def test_metadata(self):
        """Test connector metadata."""
        connector = A2ANetworkConnector(
            a2a_server_url="https://example.com",
            agent_id="test-agent",
            metadata={"version": "1.0", "type": "assistant"},
        )

        assert connector.metadata["version"] == "1.0"
        assert connector.metadata["type"] == "assistant"


class TestA2AConnectorHeaders:
    """Tests for HTTP header generation."""

    def test_default_headers(self):
        """Test default headers without auth."""
        connector = A2ANetworkConnector(
            a2a_server_url="https://example.com",
            agent_id="test-agent",
        )

        headers = connector._get_headers()

        assert headers["Content-Type"] == "application/json"
        assert headers["Accept"] == "application/json"
        assert "Authorization" not in headers

    def test_headers_with_auth(self):
        """Test headers with authentication."""
        connector = A2ANetworkConnector(
            a2a_server_url="https://example.com",
            agent_id="test-agent",
            auth_token="my-token",
        )

        headers = connector._get_headers()

        assert headers["Authorization"] == "Bearer my-token"


class TestA2AConnectorCallbacks:
    """Tests for callback registration."""

    def test_register_callback(self):
        """Test registering a callback."""
        connector = A2ANetworkConnector(
            a2a_server_url="https://example.com",
            agent_id="test-agent",
        )

        async def my_callback(task, update_type):
            pass

        connector.register_callback(my_callback)
        assert len(connector._callbacks) == 1

    def test_unregister_callback(self):
        """Test unregistering a callback."""
        connector = A2ANetworkConnector(
            a2a_server_url="https://example.com",
            agent_id="test-agent",
        )

        async def my_callback(task, update_type):
            pass

        connector.register_callback(my_callback)
        connector.unregister_callback(my_callback)
        assert len(connector._callbacks) == 0

    @pytest.mark.asyncio
    async def test_callback_is_called(self):
        """Test callbacks are called on task updates."""
        connector = A2ANetworkConnector(
            a2a_server_url="https://example.com",
            agent_id="test-agent",
        )

        callback_events = []

        async def my_callback(task, update_type):
            callback_events.append((task.id, update_type))

        connector.register_callback(my_callback)

        # Create a mock task
        task = Task(
            id="task-1",
            status=TaskStatus(state=TaskState.SUBMITTED),
        )

        await connector._notify_callbacks(task, "created")

        assert len(callback_events) == 1
        assert callback_events[0] == ("task-1", "created")

    @pytest.mark.asyncio
    async def test_callback_error_handling(self):
        """Test callback errors don't break the connector."""
        connector = A2ANetworkConnector(
            a2a_server_url="https://example.com",
            agent_id="test-agent",
        )

        async def bad_callback(task, update_type):
            raise Exception("Callback error")

        connector.register_callback(bad_callback)

        task = Task(
            id="task-1",
            status=TaskStatus(state=TaskState.SUBMITTED),
        )

        # Should not raise
        await connector._notify_callbacks(task, "created")


class TestA2AConnectorActiveTasksCache:
    """Tests for active tasks cache."""

    def test_initial_active_tasks_empty(self):
        """Test active tasks starts empty."""
        connector = A2ANetworkConnector(
            a2a_server_url="https://example.com",
            agent_id="test-agent",
        )

        assert connector.active_task_count == 0

    def test_get_active_task(self):
        """Test getting active task from cache."""
        connector = A2ANetworkConnector(
            a2a_server_url="https://example.com",
            agent_id="test-agent",
        )

        # Manually add a task
        task = Task(
            id="task-1",
            status=TaskStatus(state=TaskState.WORKING),
        )
        connector._active_tasks["task-1"] = task

        retrieved = connector.get_active_task("task-1")
        assert retrieved is not None
        assert retrieved.id == "task-1"

    def test_get_nonexistent_active_task(self):
        """Test getting nonexistent task returns None."""
        connector = A2ANetworkConnector(
            a2a_server_url="https://example.com",
            agent_id="test-agent",
        )

        result = connector.get_active_task("nonexistent")
        assert result is None

    def test_clear_active_tasks(self):
        """Test clearing active tasks."""
        connector = A2ANetworkConnector(
            a2a_server_url="https://example.com",
            agent_id="test-agent",
        )

        # Add some tasks
        for i in range(3):
            connector._active_tasks[f"task-{i}"] = Task(
                id=f"task-{i}",
                status=TaskStatus(state=TaskState.WORKING),
            )

        assert connector.active_task_count == 3

        connector.clear_active_tasks()

        assert connector.active_task_count == 0


class MockA2AServer:
    """Mock A2A server for testing connector."""

    def __init__(self):
        self.tasks: dict = {}
        self.agent_card = AgentCard(
            name="Mock Agent",
            version="1.0.0",
            description="Test agent",
            url="http://localhost:8900",
            protocol_version="0.3",
            capabilities=AgentCapabilities(streaming=False),
        )

    async def handle_agent_card(self, request):
        """Handle agent card request."""
        return web.json_response(
            self.agent_card.model_dump(by_alias=True, exclude_none=True)
        )

    async def handle_jsonrpc(self, request):
        """Handle JSON-RPC requests."""
        data = await request.json()
        method = data.get("method")
        params = data.get("params", {})

        if method == "message/send":
            # Create new task
            task = Task(
                id="test-task-123",
                context_id=params.get("contextId", "ctx-1"),
                status=TaskStatus(state=TaskState.WORKING),
                history=[],
            )
            self.tasks[task.id] = task
            return web.json_response({
                "jsonrpc": "2.0",
                "result": task.model_dump(by_alias=True, exclude_none=True),
                "id": data.get("id"),
            })

        elif method == "tasks/get":
            task_id = params.get("id")
            task = self.tasks.get(task_id)
            if task:
                return web.json_response({
                    "jsonrpc": "2.0",
                    "result": task.model_dump(by_alias=True, exclude_none=True),
                    "id": data.get("id"),
                })
            else:
                return web.json_response({
                    "jsonrpc": "2.0",
                    "error": {"code": -32602, "message": "Task not found"},
                    "id": data.get("id"),
                })

        elif method == "tasks/list":
            tasks = list(self.tasks.values())
            return web.json_response({
                "jsonrpc": "2.0",
                "result": {
                    "tasks": [
                        t.model_dump(by_alias=True, exclude_none=True)
                        for t in tasks
                    ]
                },
                "id": data.get("id"),
            })

        elif method == "tasks/cancel":
            task_id = params.get("id")
            task = self.tasks.get(task_id)
            if task:
                task.status = TaskStatus(state=TaskState.CANCELED)
                return web.json_response({
                    "jsonrpc": "2.0",
                    "result": task.model_dump(by_alias=True, exclude_none=True),
                    "id": data.get("id"),
                })
            else:
                return web.json_response({
                    "jsonrpc": "2.0",
                    "error": {"code": -32602, "message": "Task not found"},
                    "id": data.get("id"),
                })

        return web.json_response({
            "jsonrpc": "2.0",
            "error": {"code": -32601, "message": "Method not found"},
            "id": data.get("id"),
        })


@pytest.fixture
async def mock_server(aiohttp_client):
    """Create mock A2A server."""
    mock = MockA2AServer()
    app = web.Application()
    app.router.add_get("/.well-known/agent.json", mock.handle_agent_card)
    app.router.add_post("/", mock.handle_jsonrpc)
    client = await aiohttp_client(app)
    return client, mock


class TestA2AConnectorWithMockServer:
    """Tests using mock A2A server."""

    @pytest.mark.asyncio
    async def test_connect_to_server(self, mock_server):
        """Test connecting to server."""
        client, mock = mock_server
        url = f"http://{client.host}:{client.port}"

        connector = A2ANetworkConnector(
            a2a_server_url=url,
            agent_id="test-agent",
        )

        result = await connector.connect_to_server()

        assert result is True
        assert connector.is_connected is True
        assert connector.agent_card is not None
        assert connector.agent_card.name == "Mock Agent"

        await connector.disconnect()

    @pytest.mark.asyncio
    async def test_disconnect(self, mock_server):
        """Test disconnecting from server."""
        client, mock = mock_server
        url = f"http://{client.host}:{client.port}"

        connector = A2ANetworkConnector(
            a2a_server_url=url,
            agent_id="test-agent",
        )

        await connector.connect_to_server()
        result = await connector.disconnect()

        assert result is True
        assert connector.is_connected is False

    @pytest.mark.asyncio
    async def test_send_message(self, mock_server):
        """Test sending a message."""
        client, mock = mock_server
        url = f"http://{client.host}:{client.port}"

        connector = A2ANetworkConnector(
            a2a_server_url=url,
            agent_id="test-agent",
        )

        await connector.connect_to_server()

        task = await connector.send_message("Hello, agent!")

        assert task is not None
        assert task.id == "test-task-123"
        assert connector.active_task_count == 1

        await connector.disconnect()

    @pytest.mark.asyncio
    async def test_send_message_with_context(self, mock_server):
        """Test sending message with context ID."""
        client, mock = mock_server
        url = f"http://{client.host}:{client.port}"

        connector = A2ANetworkConnector(
            a2a_server_url=url,
            agent_id="test-agent",
        )

        await connector.connect_to_server()

        task = await connector.send_message(
            "Hello!",
            context_id="my-context",
        )

        assert task is not None
        assert task.context_id == "my-context"

        await connector.disconnect()

    @pytest.mark.asyncio
    async def test_get_task(self, mock_server):
        """Test getting a task."""
        client, mock = mock_server
        url = f"http://{client.host}:{client.port}"

        connector = A2ANetworkConnector(
            a2a_server_url=url,
            agent_id="test-agent",
        )

        await connector.connect_to_server()

        # Create task first
        await connector.send_message("Hello!")

        # Get task
        task = await connector.get_task("test-task-123")

        assert task is not None
        assert task.id == "test-task-123"

        await connector.disconnect()

    @pytest.mark.asyncio
    async def test_get_nonexistent_task(self, mock_server):
        """Test getting nonexistent task."""
        client, mock = mock_server
        url = f"http://{client.host}:{client.port}"

        connector = A2ANetworkConnector(
            a2a_server_url=url,
            agent_id="test-agent",
        )

        await connector.connect_to_server()

        task = await connector.get_task("nonexistent")

        assert task is None

        await connector.disconnect()

    @pytest.mark.asyncio
    async def test_list_tasks(self, mock_server):
        """Test listing tasks."""
        client, mock = mock_server
        url = f"http://{client.host}:{client.port}"

        connector = A2ANetworkConnector(
            a2a_server_url=url,
            agent_id="test-agent",
        )

        await connector.connect_to_server()

        # Create a task
        await connector.send_message("Hello!")

        # List tasks
        tasks = await connector.list_tasks()

        assert len(tasks) == 1
        assert tasks[0].id == "test-task-123"

        await connector.disconnect()

    @pytest.mark.asyncio
    async def test_cancel_task(self, mock_server):
        """Test canceling a task."""
        client, mock = mock_server
        url = f"http://{client.host}:{client.port}"

        connector = A2ANetworkConnector(
            a2a_server_url=url,
            agent_id="test-agent",
        )

        await connector.connect_to_server()

        # Create task
        await connector.send_message("Hello!")

        # Cancel task
        task = await connector.cancel_task("test-task-123")

        assert task is not None
        assert task.status.state == TaskState.CANCELED

        await connector.disconnect()


class TestA2AConnectorEventSending:
    """Tests for sending events through connector."""

    @pytest.mark.asyncio
    async def test_send_event(self, mock_server):
        """Test sending an OpenAgents event."""
        client, mock = mock_server
        url = f"http://{client.host}:{client.port}"

        connector = A2ANetworkConnector(
            a2a_server_url=url,
            agent_id="test-agent",
        )

        await connector.connect_to_server()

        event = Event(
            event_name="user.message",
            source_id="test",
            payload={"text": "Hello from event!"},
        )

        response = await connector.send_event(event)

        assert response.success is True
        assert "task_id" in response.data

        await connector.disconnect()


class TestA2AConnectorPolling:
    """Tests for task polling."""

    @pytest.mark.asyncio
    async def test_poll_messages(self, mock_server):
        """Test polling for message updates."""
        client, mock = mock_server
        url = f"http://{client.host}:{client.port}"

        connector = A2ANetworkConnector(
            a2a_server_url=url,
            agent_id="test-agent",
        )

        await connector.connect_to_server()

        # Create a task
        await connector.send_message("Hello!")

        # Poll for messages (no changes expected)
        events = await connector.poll_messages()

        # Since no state changed, should be empty
        assert isinstance(events, list)

        await connector.disconnect()

    @pytest.mark.asyncio
    async def test_poll_detects_state_change(self, mock_server):
        """Test polling detects task state changes."""
        client, mock = mock_server
        url = f"http://{client.host}:{client.port}"

        connector = A2ANetworkConnector(
            a2a_server_url=url,
            agent_id="test-agent",
        )

        await connector.connect_to_server()

        # Create a task
        await connector.send_message("Hello!")

        # Change task state on server
        task = mock.tasks["test-task-123"]
        task.status = TaskStatus(state=TaskState.COMPLETED)

        # Poll for messages
        events = await connector.poll_messages()

        # Should detect the state change
        assert len(events) >= 1
        state_events = [e for e in events if "STATUS" in e.event_name.upper()]
        assert len(state_events) >= 1

        await connector.disconnect()


class TestA2AConnectorWithoutConnection:
    """Tests for connector behavior without connection."""

    @pytest.mark.asyncio
    async def test_fetch_agent_card_without_session(self):
        """Test fetching agent card fails without session."""
        connector = A2ANetworkConnector(
            a2a_server_url="https://example.com",
            agent_id="test-agent",
        )

        result = await connector.fetch_agent_card()
        assert result is None

    @pytest.mark.asyncio
    async def test_jsonrpc_call_without_session(self):
        """Test JSON-RPC call fails without session."""
        connector = A2ANetworkConnector(
            a2a_server_url="https://example.com",
            agent_id="test-agent",
        )

        result = await connector._jsonrpc_call("test/method", {})
        assert result is None


class TestA2AConnectorAgentCardProperty:
    """Tests for agent_card property."""

    def test_agent_card_none_initially(self):
        """Test agent_card is None initially."""
        connector = A2ANetworkConnector(
            a2a_server_url="https://example.com",
            agent_id="test-agent",
        )

        assert connector.agent_card is None

    @pytest.mark.asyncio
    async def test_agent_card_after_connect(self, mock_server):
        """Test agent_card is set after connect."""
        client, mock = mock_server
        url = f"http://{client.host}:{client.port}"

        connector = A2ANetworkConnector(
            a2a_server_url=url,
            agent_id="test-agent",
        )

        await connector.connect_to_server()

        assert connector.agent_card is not None
        assert connector.agent_card.name == "Mock Agent"

        await connector.disconnect()


class TestA2AConnectorSendA2AMessage:
    """Tests for sending A2A messages."""

    @pytest.mark.asyncio
    async def test_send_a2a_message(self, mock_server):
        """Test sending an A2AMessage object."""
        client, mock = mock_server
        url = f"http://{client.host}:{client.port}"

        connector = A2ANetworkConnector(
            a2a_server_url=url,
            agent_id="test-agent",
        )

        await connector.connect_to_server()

        message = A2AMessage(
            role=Role.USER,
            parts=[TextPart(text="Hello!")],
        )

        task = await connector.send_a2a_message(message)

        assert task is not None
        assert task.id == "test-task-123"

        await connector.disconnect()
