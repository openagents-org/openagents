"""Tests for A2A Transport."""

import pytest
from unittest.mock import MagicMock, AsyncMock, patch
import json

from aiohttp import web
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop

from openagents.core.transports.a2a import A2ATransport, create_a2a_transport
from openagents.core.a2a_task_store import InMemoryTaskStore
from openagents.models.a2a import (
    Task,
    TaskState,
    TaskStatus,
    A2AMessage,
    Artifact,
    TextPart,
    Role,
    A2AErrorCode,
    create_text_message,
    create_task,
)
from openagents.models.transport import TransportType
from openagents.models.event_response import EventResponse


class TestA2ATransportConfig:
    """Tests for A2A transport configuration."""

    def test_default_config(self):
        """Test default configuration values."""
        transport = A2ATransport()

        assert transport.transport_type == TransportType.A2A
        assert transport.port == 8900
        assert transport.host == "0.0.0.0"

    def test_custom_port(self):
        """Test custom port configuration."""
        transport = A2ATransport(config={"port": 9000})
        assert transport.port == 9000

    def test_custom_host(self):
        """Test custom host configuration."""
        transport = A2ATransport(config={"host": "localhost"})
        assert transport.host == "localhost"

    def test_agent_config(self):
        """Test agent configuration."""
        transport = A2ATransport(config={
            "agent": {
                "name": "Test Agent",
                "version": "2.0.0",
                "description": "A test agent",
            }
        })

        card = transport._generate_agent_card()
        assert card.name == "Test Agent"
        assert card.version == "2.0.0"
        assert card.description == "A test agent"

    def test_auth_config(self):
        """Test authentication configuration."""
        transport = A2ATransport(config={
            "auth": {
                "type": "bearer",
                "token": "secret-token",
            }
        })

        assert transport.auth_config["type"] == "bearer"
        assert transport.auth_config["token"] == "secret-token"

    def test_custom_task_store(self):
        """Test using a custom task store."""
        custom_store = InMemoryTaskStore(max_tasks=50)
        transport = A2ATransport(task_store=custom_store)

        assert transport.task_store is custom_store


class TestAgentCard:
    """Tests for Agent Card generation."""

    def test_default_agent_card(self):
        """Test default agent card generation."""
        transport = A2ATransport()
        card = transport._generate_agent_card()

        assert card.name == "OpenAgents Network"
        assert card.version == "1.0.0"
        assert card.protocol_version == "0.3"
        assert card.capabilities.streaming is False
        assert card.capabilities.push_notifications is False

    def test_agent_card_with_provider(self):
        """Test agent card with provider info."""
        transport = A2ATransport(config={
            "agent": {
                "provider": {
                    "organization": "TestOrg",
                    "url": "https://testorg.com",
                }
            }
        })
        card = transport._generate_agent_card()

        assert card.provider is not None
        assert card.provider.organization == "TestOrg"
        assert card.provider.url == "https://testorg.com"

    def test_agent_card_url(self):
        """Test agent card URL generation."""
        transport = A2ATransport(config={
            "port": 9000,
            "host": "127.0.0.1",
        })
        card = transport._generate_agent_card()

        assert "127.0.0.1:9000" in card.url

    def test_agent_card_custom_url(self):
        """Test agent card with custom URL."""
        transport = A2ATransport(config={
            "agent": {
                "url": "https://myagent.example.com/a2a",
            }
        })
        card = transport._generate_agent_card()

        assert card.url == "https://myagent.example.com/a2a"


class TestSkillCollection:
    """Tests for skill collection from network."""

    def test_collect_skills_no_network(self):
        """Test skill collection without network returns empty list."""
        transport = A2ATransport()
        skills = transport._collect_skills_from_agents()

        assert skills == []

    def test_collect_skills_from_mods_no_network(self):
        """Test mod skill collection without network returns empty list."""
        transport = A2ATransport()
        skills = transport._collect_skills_from_mods()

        assert skills == []

    def test_collect_skills_with_mock_network(self):
        """Test skill collection with mock network."""
        # Create mock network with agents
        mock_network = MagicMock()
        mock_topology = MagicMock()
        mock_agent_conn = MagicMock()
        mock_agent_conn.metadata = {
            "skills": [
                {
                    "id": "translate",
                    "name": "Translation",
                    "description": "Translates text",
                    "tags": ["language"],
                }
            ]
        }
        mock_agent_conn.is_remote = MagicMock(return_value=False)
        mock_topology.agent_registry = {"agent-1": mock_agent_conn}
        mock_topology.get_all_remote_skills = MagicMock(return_value=[])
        mock_network.topology = mock_topology

        transport = A2ATransport(network=mock_network)
        skills = transport._collect_skills_from_local_agents()

        assert len(skills) == 1
        assert skills[0].id == "agent-1.translate"
        assert skills[0].name == "Translation"
        assert "agent-1" in skills[0].tags

    def test_collect_skills_from_mods_with_mock(self):
        """Test mod skill collection with mock network."""
        # Create mock network with mods
        mock_network = MagicMock()
        mock_mod = MagicMock()
        mock_mod.get_tools = MagicMock(return_value=[
            {"name": "search", "description": "Search the web"}
        ])
        mock_network.mods = {"search_mod": mock_mod}
        mock_network.topology = None

        transport = A2ATransport(network=mock_network)
        skills = transport._collect_skills_from_mods()

        assert len(skills) == 1
        assert "mod.search_mod.search" == skills[0].id


class TestJSONRPCResponses:
    """Tests for JSON-RPC response generation."""

    def test_jsonrpc_success(self):
        """Test JSON-RPC success response."""
        transport = A2ATransport()
        response = transport._jsonrpc_success("req-1", {"status": "ok"})

        data = json.loads(response.body)
        assert data["jsonrpc"] == "2.0"
        assert data["id"] == "req-1"
        assert data["result"]["status"] == "ok"

    def test_jsonrpc_error(self):
        """Test JSON-RPC error response."""
        transport = A2ATransport()
        response = transport._jsonrpc_error(
            "req-1",
            A2AErrorCode.INVALID_PARAMS,
            "Invalid parameters",
        )

        data = json.loads(response.body)
        assert data["jsonrpc"] == "2.0"
        assert data["id"] == "req-1"
        assert data["error"]["code"] == A2AErrorCode.INVALID_PARAMS
        assert data["error"]["message"] == "Invalid parameters"

    def test_jsonrpc_error_with_data(self):
        """Test JSON-RPC error response with additional data."""
        transport = A2ATransport()
        response = transport._jsonrpc_error(
            "req-1",
            A2AErrorCode.INTERNAL_ERROR,
            "Internal error",
            data={"details": "Stack trace here"},
        )

        data = json.loads(response.body)
        assert data["error"]["data"]["details"] == "Stack trace here"


class TestA2ATransportAsync(AioHTTPTestCase):
    """Async tests for A2A transport HTTP endpoints."""

    async def get_application(self):
        """Get the aiohttp application for testing."""
        self.transport = A2ATransport(config={
            "agent": {
                "name": "Test Agent",
                "version": "1.0.0",
            }
        })
        return self.transport.app

    @unittest_run_loop
    async def test_agent_card_endpoint(self):
        """Test GET /.well-known/agent.json returns agent card."""
        resp = await self.client.request("GET", "/.well-known/agent.json")

        assert resp.status == 200
        data = await resp.json()
        assert data["name"] == "Test Agent"
        assert data["protocolVersion"] == "0.3"

    @unittest_run_loop
    async def test_info_endpoint(self):
        """Test GET / returns info."""
        resp = await self.client.request("GET", "/")

        assert resp.status == 200
        data = await resp.json()
        assert data["protocol"] == "a2a"
        assert data["status"] == "running"

    @unittest_run_loop
    async def test_cors_headers(self):
        """Test CORS headers are present."""
        resp = await self.client.request("GET", "/")

        assert "Access-Control-Allow-Origin" in resp.headers
        assert resp.headers["Access-Control-Allow-Origin"] == "*"

    @unittest_run_loop
    async def test_options_request(self):
        """Test OPTIONS preflight request."""
        resp = await self.client.request("OPTIONS", "/")

        assert resp.status == 200
        assert "Access-Control-Allow-Methods" in resp.headers

    @unittest_run_loop
    async def test_jsonrpc_parse_error(self):
        """Test JSON-RPC parse error for invalid JSON."""
        resp = await self.client.request(
            "POST", "/",
            data="not valid json",
            headers={"Content-Type": "application/json"},
        )

        assert resp.status == 200  # JSON-RPC always returns 200
        data = await resp.json()
        assert data["error"]["code"] == A2AErrorCode.PARSE_ERROR

    @unittest_run_loop
    async def test_jsonrpc_method_not_found(self):
        """Test JSON-RPC method not found error."""
        resp = await self.client.request(
            "POST", "/",
            json={
                "jsonrpc": "2.0",
                "method": "unknown/method",
                "id": "1",
            },
        )

        data = await resp.json()
        assert data["error"]["code"] == A2AErrorCode.METHOD_NOT_FOUND

    @unittest_run_loop
    async def test_send_message_creates_task(self):
        """Test message/send creates a new task."""
        resp = await self.client.request(
            "POST", "/",
            json={
                "jsonrpc": "2.0",
                "method": "message/send",
                "params": {
                    "message": {
                        "role": "user",
                        "parts": [{"type": "text", "text": "Hello!"}],
                    }
                },
                "id": "1",
            },
        )

        data = await resp.json()
        assert "result" in data
        assert "id" in data["result"]
        assert "status" in data["result"]

    @unittest_run_loop
    async def test_send_message_with_context(self):
        """Test message/send with context ID."""
        resp = await self.client.request(
            "POST", "/",
            json={
                "jsonrpc": "2.0",
                "method": "message/send",
                "params": {
                    "message": {
                        "role": "user",
                        "parts": [{"type": "text", "text": "Hello!"}],
                    },
                    "contextId": "ctx-123",
                },
                "id": "1",
            },
        )

        data = await resp.json()
        assert data["result"]["contextId"] == "ctx-123"

    @unittest_run_loop
    async def test_get_task(self):
        """Test tasks/get retrieves a task."""
        # First create a task
        create_resp = await self.client.request(
            "POST", "/",
            json={
                "jsonrpc": "2.0",
                "method": "message/send",
                "params": {
                    "message": {
                        "role": "user",
                        "parts": [{"type": "text", "text": "Test"}],
                    }
                },
                "id": "1",
            },
        )
        create_data = await create_resp.json()
        task_id = create_data["result"]["id"]

        # Get the task
        get_resp = await self.client.request(
            "POST", "/",
            json={
                "jsonrpc": "2.0",
                "method": "tasks/get",
                "params": {"id": task_id},
                "id": "2",
            },
        )

        data = await get_resp.json()
        assert data["result"]["id"] == task_id

    @unittest_run_loop
    async def test_get_task_not_found(self):
        """Test tasks/get with nonexistent task."""
        resp = await self.client.request(
            "POST", "/",
            json={
                "jsonrpc": "2.0",
                "method": "tasks/get",
                "params": {"id": "nonexistent"},
                "id": "1",
            },
        )

        data = await resp.json()
        assert data["error"]["code"] == A2AErrorCode.INVALID_PARAMS

    @unittest_run_loop
    async def test_get_task_missing_id(self):
        """Test tasks/get without task ID."""
        resp = await self.client.request(
            "POST", "/",
            json={
                "jsonrpc": "2.0",
                "method": "tasks/get",
                "params": {},
                "id": "1",
            },
        )

        data = await resp.json()
        assert data["error"]["code"] == A2AErrorCode.INVALID_PARAMS

    @unittest_run_loop
    async def test_list_tasks_empty(self):
        """Test tasks/list with no tasks."""
        # Clear the store
        await self.transport.task_store.clear()

        resp = await self.client.request(
            "POST", "/",
            json={
                "jsonrpc": "2.0",
                "method": "tasks/list",
                "params": {},
                "id": "1",
            },
        )

        data = await resp.json()
        assert data["result"]["tasks"] == []

    @unittest_run_loop
    async def test_list_tasks(self):
        """Test tasks/list returns tasks."""
        # Create a task first
        await self.client.request(
            "POST", "/",
            json={
                "jsonrpc": "2.0",
                "method": "message/send",
                "params": {
                    "message": {
                        "role": "user",
                        "parts": [{"type": "text", "text": "Test"}],
                    }
                },
                "id": "1",
            },
        )

        resp = await self.client.request(
            "POST", "/",
            json={
                "jsonrpc": "2.0",
                "method": "tasks/list",
                "params": {},
                "id": "2",
            },
        )

        data = await resp.json()
        assert len(data["result"]["tasks"]) >= 1

    @unittest_run_loop
    async def test_cancel_task(self):
        """Test tasks/cancel cancels a working task."""
        # Create a task
        create_resp = await self.client.request(
            "POST", "/",
            json={
                "jsonrpc": "2.0",
                "method": "message/send",
                "params": {
                    "message": {
                        "role": "user",
                        "parts": [{"type": "text", "text": "Test"}],
                    }
                },
                "id": "1",
            },
        )
        create_data = await create_resp.json()
        task_id = create_data["result"]["id"]

        # Set task to working state
        await self.transport.task_store.update_task_state(
            task_id, TaskState.WORKING
        )

        # Cancel the task
        cancel_resp = await self.client.request(
            "POST", "/",
            json={
                "jsonrpc": "2.0",
                "method": "tasks/cancel",
                "params": {"id": task_id},
                "id": "2",
            },
        )

        data = await cancel_resp.json()
        assert data["result"]["status"]["state"] == "canceled"

    @unittest_run_loop
    async def test_cancel_completed_task_fails(self):
        """Test tasks/cancel fails for completed task."""
        # Create a task
        create_resp = await self.client.request(
            "POST", "/",
            json={
                "jsonrpc": "2.0",
                "method": "message/send",
                "params": {
                    "message": {
                        "role": "user",
                        "parts": [{"type": "text", "text": "Test"}],
                    }
                },
                "id": "1",
            },
        )
        create_data = await create_resp.json()
        task_id = create_data["result"]["id"]

        # Task is already completed (no event handler)

        # Try to cancel - should fail
        cancel_resp = await self.client.request(
            "POST", "/",
            json={
                "jsonrpc": "2.0",
                "method": "tasks/cancel",
                "params": {"id": task_id},
                "id": "2",
            },
        )

        data = await cancel_resp.json()
        assert "error" in data


class TestA2ATransportAuth(AioHTTPTestCase):
    """Tests for A2A transport authentication."""

    async def get_application(self):
        """Get the aiohttp application with auth config."""
        self.transport = A2ATransport(config={
            "auth": {
                "type": "bearer",
                "token": "secret-test-token",
            }
        })
        return self.transport.app

    @unittest_run_loop
    async def test_auth_required_without_token(self):
        """Test request fails without auth token."""
        resp = await self.client.request(
            "POST", "/",
            json={
                "jsonrpc": "2.0",
                "method": "tasks/list",
                "params": {},
                "id": "1",
            },
        )

        data = await resp.json()
        assert data["error"]["code"] == A2AErrorCode.AUTH_REQUIRED

    @unittest_run_loop
    async def test_auth_with_valid_token(self):
        """Test request succeeds with valid token."""
        resp = await self.client.request(
            "POST", "/",
            json={
                "jsonrpc": "2.0",
                "method": "tasks/list",
                "params": {},
                "id": "1",
            },
            headers={"Authorization": "Bearer secret-test-token"},
        )

        data = await resp.json()
        assert "result" in data

    @unittest_run_loop
    async def test_auth_with_invalid_token(self):
        """Test request fails with invalid token."""
        resp = await self.client.request(
            "POST", "/",
            json={
                "jsonrpc": "2.0",
                "method": "tasks/list",
                "params": {},
                "id": "1",
            },
            headers={"Authorization": "Bearer wrong-token"},
        )

        data = await resp.json()
        assert data["error"]["code"] == A2AErrorCode.AUTH_REQUIRED


class TestEventResponseProcessing:
    """Tests for event response processing."""

    @pytest.fixture
    def transport(self):
        """Create a transport for testing."""
        return A2ATransport()

    @pytest.mark.asyncio
    async def test_process_success_response(self, transport):
        """Test processing successful event response."""
        # Create a task
        message = create_text_message("Test", Role.USER)
        task = create_task(message)
        await transport.task_store.create_task(task)

        # Process success response
        response = EventResponse(success=True, data={"text": "Result"})
        await transport._process_event_response(task.id, response)

        # Verify task is completed
        updated = await transport.task_store.get_task(task.id)
        assert updated.status.state == TaskState.COMPLETED
        assert len(updated.artifacts) == 1

    @pytest.mark.asyncio
    async def test_process_failure_response(self, transport):
        """Test processing failed event response."""
        # Create a task
        message = create_text_message("Test", Role.USER)
        task = create_task(message)
        await transport.task_store.create_task(task)

        # Process failure response
        response = EventResponse(success=False, message="Error occurred")
        await transport._process_event_response(task.id, response)

        # Verify task is failed
        updated = await transport.task_store.get_task(task.id)
        assert updated.status.state == TaskState.FAILED

    @pytest.mark.asyncio
    async def test_process_none_response(self, transport):
        """Test processing None response (no event handler)."""
        # Create a task
        message = create_text_message("Test", Role.USER)
        task = create_task(message)
        await transport.task_store.create_task(task)

        # Process None response
        await transport._process_event_response(task.id, None)

        # Verify task is completed
        updated = await transport.task_store.get_task(task.id)
        assert updated.status.state == TaskState.COMPLETED


class TestTransportFactoryFunction:
    """Tests for create_a2a_transport factory function."""

    def test_create_default_transport(self):
        """Test creating transport with defaults."""
        transport = create_a2a_transport()

        assert isinstance(transport, A2ATransport)
        assert transport.port == 8900

    def test_create_transport_with_config(self):
        """Test creating transport with config."""
        transport = create_a2a_transport(config={"port": 9000})

        assert transport.port == 9000

    def test_create_transport_with_task_store(self):
        """Test creating transport with custom task store."""
        custom_store = InMemoryTaskStore()
        transport = create_a2a_transport(task_store=custom_store)

        assert transport.task_store is custom_store


class TestA2AAgentConnectivity(AioHTTPTestCase):
    """Tests for A2A agent connectivity (A2A-aligned approach)."""

    async def get_application(self):
        """Get the aiohttp application for testing."""
        self.transport = A2ATransport(config={
            "agent": {
                "name": "Test Agent Network",
            }
        })
        return self.transport.app

    @unittest_run_loop
    async def test_agents_announce_missing_url(self):
        """Test agents/announce fails without url."""
        resp = await self.client.request(
            "POST", "/",
            json={
                "jsonrpc": "2.0",
                "method": "agents/announce",
                "params": {},
                "id": "1",
            },
        )

        data = await resp.json()
        assert data["error"]["code"] == A2AErrorCode.INVALID_PARAMS

    @unittest_run_loop
    async def test_agents_withdraw(self):
        """Test agents/withdraw method for nonexistent agent."""
        resp = await self.client.request(
            "POST", "/",
            json={
                "jsonrpc": "2.0",
                "method": "agents/withdraw",
                "params": {"agent_id": "nonexistent-agent"},
                "id": "1",
            },
        )

        data = await resp.json()
        assert "result" in data
        assert data["result"]["success"] is False
        # Error can be either "Agent not found or not a remote agent" (when topology exists)
        # or "Network topology not available" (when no network)
        assert "error" in data["result"]

    @unittest_run_loop
    async def test_agents_withdraw_missing_id(self):
        """Test agents/withdraw fails without agent_id."""
        resp = await self.client.request(
            "POST", "/",
            json={
                "jsonrpc": "2.0",
                "method": "agents/withdraw",
                "params": {},
                "id": "1",
            },
        )

        data = await resp.json()
        assert data["error"]["code"] == A2AErrorCode.INVALID_PARAMS

    @unittest_run_loop
    async def test_agents_list_empty(self):
        """Test agents/list with no agents."""
        resp = await self.client.request(
            "POST", "/",
            json={
                "jsonrpc": "2.0",
                "method": "agents/list",
                "params": {},
                "id": "1",
            },
        )

        data = await resp.json()
        assert "result" in data
        assert "agents" in data["result"]
        assert data["result"]["total"] == 0

    @unittest_run_loop
    async def test_agents_list_with_filters(self):
        """Test agents/list with filters."""
        resp = await self.client.request(
            "POST", "/",
            json={
                "jsonrpc": "2.0",
                "method": "agents/list",
                "params": {
                    "include_local": True,
                    "include_remote": False,
                },
                "id": "1",
            },
        )

        data = await resp.json()
        assert "result" in data
        assert "agents" in data["result"]

    @unittest_run_loop
    async def test_events_send(self):
        """Test events/send method."""
        resp = await self.client.request(
            "POST", "/",
            json={
                "jsonrpc": "2.0",
                "method": "events/send",
                "params": {
                    "event_name": "user.message",
                    "source_id": "test-agent",
                    "destination_id": "other-agent",
                    "payload": {"text": "Hello!"},
                },
                "id": "1",
            },
        )

        data = await resp.json()
        assert "result" in data
        assert data["result"]["success"] is True
        assert data["result"]["event_name"] == "user.message"

    @unittest_run_loop
    async def test_events_send_missing_event_name(self):
        """Test events/send fails without event_name."""
        resp = await self.client.request(
            "POST", "/",
            json={
                "jsonrpc": "2.0",
                "method": "events/send",
                "params": {
                    "source_id": "test-agent",
                },
                "id": "1",
            },
        )

        data = await resp.json()
        assert data["error"]["code"] == A2AErrorCode.INVALID_PARAMS

    @unittest_run_loop
    async def test_events_send_missing_source_id(self):
        """Test events/send fails without source_id."""
        resp = await self.client.request(
            "POST", "/",
            json={
                "jsonrpc": "2.0",
                "method": "events/send",
                "params": {
                    "event_name": "user.message",
                },
                "id": "1",
            },
        )

        data = await resp.json()
        assert data["error"]["code"] == A2AErrorCode.INVALID_PARAMS
