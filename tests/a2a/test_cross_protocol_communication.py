"""Integration tests for cross-protocol communication between gRPC and A2A agents."""

import pytest
import asyncio
import json
from unittest.mock import MagicMock, AsyncMock, patch
from aiohttp import web
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop
import aiohttp

from openagents.core.topology import CentralizedTopology
from openagents.core.transports.a2a import A2ATransport
from openagents.models.transport import TransportType, AgentConnection, RemoteAgentStatus
from openagents.models.network_config import NetworkConfig, NetworkMode
from openagents.models.event import Event
from openagents.models.a2a import AgentCard, AgentSkill, AgentCapabilities


# =============================================================================
# Fixtures
# =============================================================================

@pytest.fixture
def network_config():
    """Create a network configuration for testing."""
    config = MagicMock(spec=NetworkConfig)
    config.transports = []
    config.heartbeat_interval = 30
    config.connection_timeout = 60
    config.agent_groups = {}
    config.default_agent_group = "default"
    config.requires_password = False
    config.remote_agents = {
        "card_refresh_interval": 300,
        "health_check_interval": 60,
        "max_failures_before_stale": 3,
        "remove_after_failures": 10,
        "request_timeout": 5,
    }
    return config


@pytest.fixture
def topology(network_config):
    """Create a topology for testing."""
    return CentralizedTopology("test-node", network_config)


@pytest.fixture
def mock_a2a_agent_card():
    """Create a mock A2A agent card."""
    return AgentCard(
        name="A2A Summarizer Agent",
        version="1.0.0",
        description="A summarization agent using A2A protocol",
        url="http://localhost:8901",
        protocol_version="0.3",
        skills=[
            AgentSkill(
                id="summarize",
                name="Text Summarization",
                description="Summarizes text content",
                tags=["text", "nlp"],
            ),
        ],
        capabilities=AgentCapabilities(),
    )


# =============================================================================
# Test: Unified Agent Registry
# =============================================================================

class TestUnifiedAgentRegistry:
    """Test that both gRPC and A2A agents appear in the unified registry."""

    @pytest.mark.asyncio
    async def test_grpc_agent_registers_as_local(self, topology):
        """Test that a gRPC agent registers as a local agent."""
        # Register a gRPC agent
        grpc_connection = AgentConnection(
            agent_id="translator-agent",
            transport_type=TransportType.GRPC,
            metadata={
                "name": "Translator Agent",
                "skills": [{"id": "translate", "name": "Translation"}]
            },
            capabilities=["translate"],
        )
        topology.agent_registry["translator-agent"] = grpc_connection

        # Verify it's a local agent
        assert "translator-agent" in topology.agent_registry
        assert not grpc_connection.is_remote()
        assert grpc_connection.transport_type == TransportType.GRPC

        # Verify it appears in local agents list
        local_agents = topology.get_local_agents()
        assert len(local_agents) == 1
        assert local_agents[0].agent_id == "translator-agent"

        # Verify it doesn't appear in remote agents list
        remote_agents = topology.get_remote_agents()
        assert len(remote_agents) == 0

    @pytest.mark.asyncio
    async def test_a2a_agent_registers_as_remote(self, topology, mock_a2a_agent_card):
        """Test that an A2A agent registers as a remote agent."""
        with patch.object(topology, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_a2a_agent_card

            # Announce A2A agent
            connection = await topology.announce_remote_agent(
                url="http://localhost:8901",
                preferred_id="summarizer-agent",
            )

            # Verify it's a remote agent
            assert connection.agent_id == "summarizer-agent"
            assert connection.is_remote()
            assert connection.transport_type == TransportType.A2A
            assert connection.address == "http://localhost:8901"
            assert connection.agent_card is not None

            # Verify it appears in remote agents list
            remote_agents = topology.get_remote_agents()
            assert len(remote_agents) == 1
            assert remote_agents[0].agent_id == "summarizer-agent"

            # Verify it doesn't appear in local agents list
            local_agents = topology.get_local_agents()
            assert len(local_agents) == 0

    @pytest.mark.asyncio
    async def test_mixed_agents_in_registry(self, topology, mock_a2a_agent_card):
        """Test that both local and remote agents coexist in registry."""
        # Add gRPC agent (local)
        grpc_connection = AgentConnection(
            agent_id="translator-agent",
            transport_type=TransportType.GRPC,
            capabilities=["translate"],
        )
        topology.agent_registry["translator-agent"] = grpc_connection

        # Add A2A agent (remote)
        with patch.object(topology, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_a2a_agent_card
            await topology.announce_remote_agent(
                url="http://localhost:8901",
                preferred_id="summarizer-agent",
            )

        # Verify both are in registry
        assert len(topology.agent_registry) == 2
        assert "translator-agent" in topology.agent_registry
        assert "summarizer-agent" in topology.agent_registry

        # Verify separation
        local_agents = topology.get_local_agents()
        remote_agents = topology.get_remote_agents()
        assert len(local_agents) == 1
        assert len(remote_agents) == 1
        assert local_agents[0].agent_id == "translator-agent"
        assert remote_agents[0].agent_id == "summarizer-agent"


# =============================================================================
# Test: Agent Lookup Across Protocols
# =============================================================================

class TestAgentLookup:
    """Test agent lookup works regardless of protocol."""

    @pytest.mark.asyncio
    async def test_lookup_grpc_agent_by_id(self, topology):
        """Test looking up a gRPC agent by ID."""
        grpc_connection = AgentConnection(
            agent_id="translator-agent",
            transport_type=TransportType.GRPC,
        )
        topology.agent_registry["translator-agent"] = grpc_connection

        # Lookup
        found = topology.agent_registry.get("translator-agent")
        assert found is not None
        assert found.agent_id == "translator-agent"
        assert found.transport_type == TransportType.GRPC

    @pytest.mark.asyncio
    async def test_lookup_a2a_agent_by_id(self, topology, mock_a2a_agent_card):
        """Test looking up an A2A agent by ID."""
        with patch.object(topology, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_a2a_agent_card
            await topology.announce_remote_agent(
                url="http://localhost:8901",
                preferred_id="summarizer-agent",
            )

        # Lookup by ID
        found = topology.agent_registry.get("summarizer-agent")
        assert found is not None
        assert found.agent_id == "summarizer-agent"
        assert found.transport_type == TransportType.A2A

    @pytest.mark.asyncio
    async def test_lookup_a2a_agent_by_url(self, topology, mock_a2a_agent_card):
        """Test looking up an A2A agent by URL."""
        with patch.object(topology, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_a2a_agent_card
            await topology.announce_remote_agent(
                url="http://localhost:8901",
                preferred_id="summarizer-agent",
            )

        # Lookup by URL
        found = topology.get_agent_by_url("http://localhost:8901")
        assert found is not None
        assert found.agent_id == "summarizer-agent"


# =============================================================================
# Test: Skill Discovery Across Protocols
# =============================================================================

class TestSkillDiscovery:
    """Test skill discovery works across different protocols."""

    @pytest.mark.asyncio
    async def test_collect_skills_from_both_agent_types(self, topology, mock_a2a_agent_card):
        """Test collecting skills from both local and remote agents."""
        # Add gRPC agent with skills in metadata
        grpc_connection = AgentConnection(
            agent_id="translator-agent",
            transport_type=TransportType.GRPC,
            metadata={
                "skills": [
                    {"id": "translate", "name": "Translation", "description": "Translates text"}
                ]
            },
        )
        topology.agent_registry["translator-agent"] = grpc_connection

        # Add A2A agent
        with patch.object(topology, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_a2a_agent_card
            await topology.announce_remote_agent(
                url="http://localhost:8901",
                preferred_id="summarizer-agent",
            )

        # Get remote skills (from A2A agents)
        remote_skills = topology.get_all_remote_skills()
        assert len(remote_skills) == 1
        assert remote_skills[0].id == "remote.summarizer-agent.summarize"
        assert "remote" in remote_skills[0].tags

        # Local agent skills are in metadata (different access pattern)
        local_agent = topology.agent_registry["translator-agent"]
        local_skills = local_agent.metadata.get("skills", [])
        assert len(local_skills) == 1
        assert local_skills[0]["id"] == "translate"


# =============================================================================
# Test: Cross-Protocol Event Routing
# =============================================================================

class TestCrossProtocolRouting:
    """Test event routing between different protocol agents."""

    @pytest.mark.asyncio
    async def test_determine_route_for_grpc_agent(self, topology):
        """Test that routing correctly identifies gRPC transport for local agent."""
        grpc_connection = AgentConnection(
            agent_id="translator-agent",
            transport_type=TransportType.GRPC,
        )
        topology.agent_registry["translator-agent"] = grpc_connection

        # Lookup the agent to determine route
        target = topology.agent_registry.get("translator-agent")
        assert target is not None
        assert target.transport_type == TransportType.GRPC
        assert not target.is_remote()

    @pytest.mark.asyncio
    async def test_determine_route_for_a2a_agent(self, topology, mock_a2a_agent_card):
        """Test that routing correctly identifies A2A transport for remote agent."""
        with patch.object(topology, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_a2a_agent_card
            await topology.announce_remote_agent(
                url="http://localhost:8901",
                preferred_id="summarizer-agent",
            )

        # Lookup the agent to determine route
        target = topology.agent_registry.get("summarizer-agent")
        assert target is not None
        assert target.transport_type == TransportType.A2A
        assert target.is_remote()
        assert target.address == "http://localhost:8901"

    @pytest.mark.asyncio
    async def test_route_event_based_on_destination(self, topology, mock_a2a_agent_card):
        """Test that events can be routed based on destination agent's transport."""
        # Setup both agents
        grpc_connection = AgentConnection(
            agent_id="translator-agent",
            transport_type=TransportType.GRPC,
        )
        topology.agent_registry["translator-agent"] = grpc_connection

        with patch.object(topology, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_a2a_agent_card
            await topology.announce_remote_agent(
                url="http://localhost:8901",
                preferred_id="summarizer-agent",
            )

        # Create an event from gRPC agent to A2A agent
        event = Event(
            event_name="summarize.request",
            source_id="translator-agent",
            destination_id="summarizer-agent",
            payload={"text": "Long text to summarize"},
        )

        # Lookup destination to determine routing
        source = topology.agent_registry.get(event.source_id)
        destination = topology.agent_registry.get(event.destination_id)

        assert source is not None
        assert destination is not None
        assert source.transport_type == TransportType.GRPC
        assert destination.transport_type == TransportType.A2A

        # The network would use destination.transport_type to route
        # For A2A, it would POST to destination.address


# =============================================================================
# Test: A2A Transport with Mock Network
# =============================================================================

class TestA2ATransportWithMockNetwork:
    """Test A2A transport methods with a mock network and topology."""

    @pytest.fixture
    def mock_network(self, topology, mock_a2a_agent_card):
        """Create a mock network with topology."""
        network = MagicMock()
        network.topology = topology
        return network

    @pytest.mark.asyncio
    async def test_agents_announce_via_transport(self, mock_network, mock_a2a_agent_card):
        """Test announcing an agent via A2A transport."""
        transport = A2ATransport(network=mock_network)

        with patch.object(
            mock_network.topology, 'fetch_agent_card', new_callable=AsyncMock
        ) as mock_fetch:
            mock_fetch.return_value = mock_a2a_agent_card

            result = await transport._handle_announce_agent({
                "url": "http://localhost:8901",
                "agent_id": "summarizer-agent",
            })

            assert result["success"] is True
            assert result["agent_id"] == "summarizer-agent"
            assert "summarizer-agent" in mock_network.topology.agent_registry

    @pytest.mark.asyncio
    async def test_agents_list_shows_both_types(self, mock_network, mock_a2a_agent_card):
        """Test that agents/list returns both local and remote agents."""
        transport = A2ATransport(network=mock_network)
        topology = mock_network.topology

        # Add local gRPC agent
        grpc_connection = AgentConnection(
            agent_id="translator-agent",
            transport_type=TransportType.GRPC,
            metadata={"skills": []},
        )
        topology.agent_registry["translator-agent"] = grpc_connection

        # Add remote A2A agent
        with patch.object(topology, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_a2a_agent_card
            await topology.announce_remote_agent(
                url="http://localhost:8901",
                preferred_id="summarizer-agent",
            )

        # Call agents/list
        result = await transport._handle_list_agents({})

        assert result["total"] == 2
        assert result["local_count"] == 1
        assert result["remote_count"] == 1

        agent_ids = [a["agent_id"] for a in result["agents"]]
        assert "translator-agent" in agent_ids
        assert "summarizer-agent" in agent_ids

        # Check types
        for agent in result["agents"]:
            if agent["agent_id"] == "translator-agent":
                assert agent["type"] == "local"
                assert agent["transport"] == "grpc"
            elif agent["agent_id"] == "summarizer-agent":
                assert agent["type"] == "remote"
                assert agent["transport"] == "a2a"

    @pytest.mark.asyncio
    async def test_agents_list_filter_by_type(self, mock_network, mock_a2a_agent_card):
        """Test filtering agents by type in agents/list."""
        transport = A2ATransport(network=mock_network)
        topology = mock_network.topology

        # Add both agents
        grpc_connection = AgentConnection(
            agent_id="translator-agent",
            transport_type=TransportType.GRPC,
            metadata={},
        )
        topology.agent_registry["translator-agent"] = grpc_connection

        with patch.object(topology, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_a2a_agent_card
            await topology.announce_remote_agent(
                url="http://localhost:8901",
                preferred_id="summarizer-agent",
            )

        # Get only local agents
        result = await transport._handle_list_agents({
            "include_local": True,
            "include_remote": False,
        })
        assert result["total"] == 1
        assert result["agents"][0]["agent_id"] == "translator-agent"

        # Get only remote agents
        result = await transport._handle_list_agents({
            "include_local": False,
            "include_remote": True,
        })
        assert result["total"] == 1
        assert result["agents"][0]["agent_id"] == "summarizer-agent"


# =============================================================================
# Test: Full Integration with Mock A2A Server
# =============================================================================

class TestFullCrossProtocolIntegration:
    """Full integration test with a mock A2A server."""

    @pytest.fixture
    def mock_a2a_server_app(self, mock_a2a_agent_card):
        """Create a mock A2A server application."""
        app = web.Application()

        async def serve_agent_card(request):
            return web.json_response(mock_a2a_agent_card.model_dump())

        async def health_check(request):
            return web.json_response({"status": "healthy"})

        async def handle_jsonrpc(request):
            data = await request.json()
            method = data.get("method")
            params = data.get("params", {})
            request_id = data.get("id")

            if method == "message/send":
                message = params.get("message", {})
                parts = message.get("parts", [])
                text = next(
                    (p.get("text", "") for p in parts if p.get("type") == "text"),
                    ""
                )

                return web.json_response({
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "result": {
                        "id": f"task-{request_id}",
                        "status": {"state": "completed"},
                        "artifacts": [{
                            "name": "summary",
                            "parts": [{"type": "text", "text": f"[Summary] {text[:20]}..."}]
                        }]
                    }
                })

            return web.json_response({
                "jsonrpc": "2.0",
                "id": request_id,
                "error": {"code": -32601, "message": "Method not found"}
            })

        app.router.add_get("/.well-known/agent.json", serve_agent_card)
        app.router.add_get("/", health_check)
        app.router.add_post("/", handle_jsonrpc)

        return app

    @pytest.mark.asyncio
    async def test_announce_real_a2a_server(self, topology, mock_a2a_server_app):
        """Test announcing a real A2A server to the topology."""
        # Start mock A2A server
        runner = web.AppRunner(mock_a2a_server_app)
        await runner.setup()
        site = web.TCPSite(runner, "localhost", 18901)
        await site.start()

        try:
            # Announce the agent
            connection = await topology.announce_remote_agent(
                url="http://localhost:18901",
                preferred_id="test-summarizer",
            )

            # Verify registration
            assert connection.agent_id == "test-summarizer"
            assert connection.is_remote()
            assert connection.agent_card is not None
            assert connection.agent_card.name == "A2A Summarizer Agent"
            assert len(connection.agent_card.skills) == 1
            assert connection.agent_card.skills[0].id == "summarize"

        finally:
            await runner.cleanup()

    @pytest.mark.asyncio
    async def test_cross_protocol_message_flow(self, topology, mock_a2a_server_app):
        """Test complete message flow from gRPC agent to A2A agent."""
        # Start mock A2A server
        runner = web.AppRunner(mock_a2a_server_app)
        await runner.setup()
        site = web.TCPSite(runner, "localhost", 18902)
        await site.start()

        try:
            # Register gRPC agent
            grpc_connection = AgentConnection(
                agent_id="grpc-translator",
                transport_type=TransportType.GRPC,
                capabilities=["translate"],
            )
            topology.agent_registry["grpc-translator"] = grpc_connection

            # Announce A2A agent
            a2a_connection = await topology.announce_remote_agent(
                url="http://localhost:18902",
                preferred_id="a2a-summarizer",
            )

            # Verify both are registered
            assert "grpc-translator" in topology.agent_registry
            assert "a2a-summarizer" in topology.agent_registry

            # Create event from gRPC to A2A
            event = Event(
                event_name="summarize.request",
                source_id="grpc-translator",
                destination_id="a2a-summarizer",
                payload={"text": "This is a long document that needs summarization."},
            )

            # Lookup destination
            dest = topology.agent_registry.get(event.destination_id)
            assert dest is not None
            assert dest.is_remote()

            # Simulate what network would do: send to A2A endpoint
            async with aiohttp.ClientSession() as session:
                request_data = {
                    "jsonrpc": "2.0",
                    "method": "message/send",
                    "params": {
                        "message": {
                            "role": "user",
                            "parts": [{"type": "text", "text": event.payload["text"]}]
                        }
                    },
                    "id": "1"
                }

                async with session.post(dest.address, json=request_data) as resp:
                    result = await resp.json()

                    assert "result" in result
                    assert result["result"]["status"]["state"] == "completed"
                    assert len(result["result"]["artifacts"]) == 1

        finally:
            await runner.cleanup()

    @pytest.mark.asyncio
    async def test_health_check_on_a2a_agent(self, topology, mock_a2a_server_app):
        """Test health check on a registered A2A agent."""
        # Start mock A2A server
        runner = web.AppRunner(mock_a2a_server_app)
        await runner.setup()
        site = web.TCPSite(runner, "localhost", 18903)
        await site.start()

        try:
            # Announce A2A agent
            await topology.announce_remote_agent(
                url="http://localhost:18903",
                preferred_id="healthy-agent",
            )

            # Perform health check
            is_healthy = await topology.health_check_remote_agent("healthy-agent")
            assert is_healthy is True

            conn = topology.agent_registry.get("healthy-agent")
            assert conn.remote_status == RemoteAgentStatus.ACTIVE

        finally:
            await runner.cleanup()

    @pytest.mark.asyncio
    async def test_a2a_agent_becomes_stale_when_unreachable(self, topology, mock_a2a_server_app):
        """Test that A2A agent is marked stale when server goes down."""
        # Start mock A2A server
        runner = web.AppRunner(mock_a2a_server_app)
        await runner.setup()
        site = web.TCPSite(runner, "localhost", 18904)
        await site.start()

        try:
            # Announce A2A agent
            await topology.announce_remote_agent(
                url="http://localhost:18904",
                preferred_id="soon-stale-agent",
            )

            # Stop the server to simulate failure
            await runner.cleanup()

            # Simulate multiple failures
            for _ in range(topology.max_failures_before_stale):
                await topology._handle_remote_failure("soon-stale-agent")

            # Check status
            conn = topology.agent_registry.get("soon-stale-agent")
            assert conn.remote_status == RemoteAgentStatus.STALE

        except Exception:
            await runner.cleanup()


# =============================================================================
# Test: Events/Send Cross-Protocol
# =============================================================================

class TestEventsSendCrossProtocol(AioHTTPTestCase):
    """Test the events/send method for cross-protocol communication."""

    async def get_application(self):
        """Get the aiohttp application for testing."""
        # Create mock network with topology
        config = MagicMock(spec=NetworkConfig)
        config.transports = []
        config.heartbeat_interval = 30
        config.connection_timeout = 60
        config.agent_groups = {}
        config.default_agent_group = "default"
        config.requires_password = False
        config.remote_agents = {}

        self.topology = CentralizedTopology("test-node", config)
        self.mock_network = MagicMock()
        self.mock_network.topology = self.topology

        # Add a gRPC agent
        grpc_connection = AgentConnection(
            agent_id="grpc-agent",
            transport_type=TransportType.GRPC,
        )
        self.topology.agent_registry["grpc-agent"] = grpc_connection

        self.transport = A2ATransport(network=self.mock_network)
        return self.transport.app

    @unittest_run_loop
    async def test_send_event_to_grpc_agent(self):
        """Test sending an event to a gRPC agent via events/send."""
        resp = await self.client.request(
            "POST", "/",
            json={
                "jsonrpc": "2.0",
                "method": "events/send",
                "params": {
                    "event_name": "translate.request",
                    "source_id": "external-a2a-agent",
                    "destination_id": "grpc-agent",
                    "payload": {"text": "Hello", "lang": "es"}
                },
                "id": "1",
            },
        )

        data = await resp.json()
        assert "result" in data
        assert data["result"]["success"] is True
        assert data["result"]["event_name"] == "translate.request"

    @unittest_run_loop
    async def test_send_event_captures_source_destination(self):
        """Test that events/send correctly captures source and destination."""
        resp = await self.client.request(
            "POST", "/",
            json={
                "jsonrpc": "2.0",
                "method": "events/send",
                "params": {
                    "event_name": "task.complete",
                    "source_id": "a2a-summarizer",
                    "destination_id": "grpc-agent",
                    "payload": {"result": "Summarized text"}
                },
                "id": "2",
            },
        )

        data = await resp.json()
        assert data["result"]["success"] is True
        # The event would be routed to grpc-agent via gRPC transport


# =============================================================================
# Test: Agent Card Collection Across Protocols
# =============================================================================

class TestAgentCardCollection:
    """Test Agent Card / skill collection across protocols."""

    @pytest.mark.asyncio
    async def test_generate_agent_card_includes_all_skills(self, topology, mock_a2a_agent_card):
        """Test that generated Agent Card includes skills from all sources."""
        # Create mock network
        mock_network = MagicMock()
        mock_network.topology = topology

        # Add gRPC agent with skills
        grpc_connection = AgentConnection(
            agent_id="translator",
            transport_type=TransportType.GRPC,
            metadata={
                "skills": [
                    {"id": "translate", "name": "Translation", "description": "Translates text"}
                ]
            },
        )
        topology.agent_registry["translator"] = grpc_connection

        # Add A2A agent
        with patch.object(topology, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_a2a_agent_card
            await topology.announce_remote_agent(
                url="http://localhost:8901",
                preferred_id="summarizer",
            )

        # Create transport and generate card
        transport = A2ATransport(network=mock_network)
        card = transport._generate_agent_card()

        # Card should include skills from both local and remote agents
        skill_ids = [s.id for s in card.skills]

        # Local agent skills are prefixed with agent ID
        assert "translator.translate" in skill_ids

        # Remote agent skills are prefixed with "remote.{agent_id}"
        assert "remote.summarizer.summarize" in skill_ids
