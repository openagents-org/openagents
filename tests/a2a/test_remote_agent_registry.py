"""Tests for Remote Agent Management in NetworkTopology."""

import pytest
import asyncio
from unittest.mock import AsyncMock, patch, MagicMock
import time

from openagents.core.topology import NetworkTopology, CentralizedTopology
from openagents.models.transport import (
    TransportType,
    AgentConnection,
    RemoteAgentStatus,
)
from openagents.models.a2a import AgentCard, AgentSkill, AgentCapabilities
from openagents.models.network_config import NetworkConfig


@pytest.fixture
def mock_agent_card():
    """Create a mock agent card."""
    return AgentCard(
        name="Test Agent",
        version="1.0.0",
        description="A test agent",
        url="https://test.example.com",
        protocol_version="0.3",
        skills=[
            AgentSkill(
                id="translate",
                name="Translation",
                description="Translates text",
                tags=["language"],
            ),
            AgentSkill(
                id="summarize",
                name="Summarization",
                description="Summarizes text",
                tags=["text"],
            ),
        ],
        capabilities=AgentCapabilities(),
    )


@pytest.fixture
def network_config():
    """Create a network config for testing."""
    config = MagicMock(spec=NetworkConfig)
    config.remote_agents = {
        "card_refresh_interval": 300,
        "health_check_interval": 60,
        "max_failures_before_stale": 3,
        "remove_after_failures": 10,
        "request_timeout": 5,
    }
    config.transports = []
    config.heartbeat_interval = 30
    config.connection_timeout = 60
    config.agent_groups = {}
    config.default_agent_group = "default"
    config.requires_password = False
    return config


@pytest.fixture
def topology(network_config):
    """Create a topology for testing."""
    return CentralizedTopology("test-node", network_config)


class TestRemoteAgentConfig:
    """Tests for remote agent configuration."""

    def test_default_config(self):
        """Test default configuration values."""
        config = MagicMock(spec=NetworkConfig)
        config.remote_agents = None
        config.transports = []
        config.agent_groups = {}
        config.default_agent_group = "default"
        config.requires_password = False

        topology = CentralizedTopology("test-node", config)

        assert topology.card_refresh_interval == 300
        assert topology.health_check_interval == 60
        assert topology.max_failures_before_stale == 3
        assert topology.remove_after_failures == 10

    def test_custom_config(self, network_config):
        """Test custom configuration values."""
        network_config.remote_agents = {
            "card_refresh_interval": 600,
            "health_check_interval": 120,
            "max_failures_before_stale": 5,
            "remove_after_failures": 20,
        }

        topology = CentralizedTopology("test-node", network_config)

        assert topology.card_refresh_interval == 600
        assert topology.health_check_interval == 120
        assert topology.max_failures_before_stale == 5
        assert topology.remove_after_failures == 20


class TestAgentIdResolution:
    """Tests for agent ID resolution."""

    def test_derive_id_from_simple_url(self, topology):
        """Test deriving ID from a simple URL."""
        agent_id = topology._derive_id_from_url("https://translate.example.com")
        assert agent_id == "translate-example-com"

    def test_derive_id_from_url_with_path(self, topology):
        """Test deriving ID from URL with path."""
        agent_id = topology._derive_id_from_url("https://api.agents.io/translator")
        assert agent_id == "api-agents-io-translator"

    def test_derive_id_from_url_with_port(self, topology):
        """Test deriving ID from URL with port."""
        agent_id = topology._derive_id_from_url("https://localhost:8080")
        assert agent_id == "localhost-8080"

    def test_sanitize_id(self, topology):
        """Test ID sanitization."""
        assert topology._sanitize_id("My Agent!@#") == "my-agent"
        assert topology._sanitize_id("Test--Agent") == "test-agent"
        assert topology._sanitize_id("agent_123") == "agent-123"

    def test_resolve_with_preferred_id(self, topology):
        """Test resolving with preferred ID."""
        agent_id = topology._resolve_agent_id(
            "https://example.com",
            preferred_id="my-agent"
        )
        assert agent_id == "my-agent"

    def test_resolve_without_preferred_id(self, topology):
        """Test resolving without preferred ID derives from URL."""
        agent_id = topology._resolve_agent_id(
            "https://translate.example.com",
            preferred_id=None
        )
        assert agent_id == "translate-example-com"

    def test_make_unique_id(self, topology):
        """Test making unique ID."""
        unique_id = topology._make_unique_id("my-agent")
        assert unique_id.startswith("my-agent-")
        assert len(unique_id) > len("my-agent-")


class TestUrlNormalization:
    """Tests for URL normalization."""

    def test_normalize_https_url(self, topology):
        """Test normalizing HTTPS URL."""
        url = topology._normalize_url("https://example.com/")
        assert url == "https://example.com"

    def test_normalize_http_url(self, topology):
        """Test normalizing HTTP URL."""
        url = topology._normalize_url("http://example.com")
        assert url == "http://example.com"

    def test_normalize_url_without_scheme(self, topology):
        """Test normalizing URL without scheme adds HTTPS."""
        url = topology._normalize_url("example.com")
        assert url == "https://example.com"

    def test_get_agent_card_url(self, topology):
        """Test getting agent card URL."""
        card_url = topology._get_agent_card_url("https://example.com")
        assert card_url == "https://example.com/.well-known/agent.json"


class TestAgentAnnouncement:
    """Tests for agent announcement."""

    @pytest.mark.asyncio
    async def test_announce_agent(self, topology, mock_agent_card):
        """Test announcing a remote agent."""
        with patch.object(topology, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            connection = await topology.announce_remote_agent(
                url="https://test.example.com",
                preferred_id="test-agent"
            )

            assert connection.agent_id == "test-agent"
            assert connection.address == "https://test.example.com"
            assert connection.remote_status == RemoteAgentStatus.ACTIVE
            assert connection.agent_card == mock_agent_card
            assert connection.transport_type == TransportType.A2A
            assert topology.remote_agent_count() == 1

    @pytest.mark.asyncio
    async def test_announce_derives_id_from_url(self, topology, mock_agent_card):
        """Test announcing without preferred ID derives from URL."""
        with patch.object(topology, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            connection = await topology.announce_remote_agent(url="https://translate.example.com")

            assert connection.agent_id == "translate-example-com"

    @pytest.mark.asyncio
    async def test_announce_same_url_returns_existing(self, topology, mock_agent_card):
        """Test announcing same URL returns existing entry."""
        with patch.object(topology, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            conn1 = await topology.announce_remote_agent(url="https://test.example.com", preferred_id="agent1")
            conn2 = await topology.announce_remote_agent(url="https://test.example.com", preferred_id="agent2")

            assert conn1.agent_id == conn2.agent_id
            assert topology.remote_agent_count() == 1

    @pytest.mark.asyncio
    async def test_announce_id_conflict_generates_unique(self, topology, mock_agent_card):
        """Test announcing with conflicting ID generates unique ID."""
        with patch.object(topology, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            conn1 = await topology.announce_remote_agent(
                url="https://agent1.example.com",
                preferred_id="shared-id"
            )
            conn2 = await topology.announce_remote_agent(
                url="https://agent2.example.com",
                preferred_id="shared-id"
            )

            assert conn1.agent_id == "shared-id"
            assert conn2.agent_id.startswith("shared-id-")
            assert conn1.agent_id != conn2.agent_id

    @pytest.mark.asyncio
    async def test_announce_with_metadata(self, topology, mock_agent_card):
        """Test announcing with metadata."""
        with patch.object(topology, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            connection = await topology.announce_remote_agent(
                url="https://test.example.com",
                preferred_id="test-agent",
                metadata={"custom": "data"}
            )

            assert connection.metadata == {"custom": "data"}

    @pytest.mark.asyncio
    async def test_announce_emits_event(self, topology, mock_agent_card):
        """Test announcing emits event."""
        events = []

        async def capture_event(name, data):
            events.append((name, data))

        topology.set_remote_event_callback(capture_event)

        with patch.object(topology, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            await topology.announce_remote_agent(url="https://test.example.com", preferred_id="test-agent")

        assert len(events) == 1
        assert events[0][0] == "agent.remote.announced"
        assert events[0][1]["agent_id"] == "test-agent"


class TestAgentWithdrawal:
    """Tests for agent withdrawal."""

    @pytest.mark.asyncio
    async def test_withdraw_agent(self, topology, mock_agent_card):
        """Test withdrawing a remote agent."""
        with patch.object(topology, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            await topology.announce_remote_agent(url="https://test.example.com", preferred_id="test-agent")
            assert topology.remote_agent_count() == 1

            success = await topology.withdraw_remote_agent("test-agent")

            assert success is True
            assert topology.remote_agent_count() == 0

    @pytest.mark.asyncio
    async def test_withdraw_nonexistent_agent(self, topology):
        """Test withdrawing nonexistent agent returns False."""
        success = await topology.withdraw_remote_agent("nonexistent")
        assert success is False

    @pytest.mark.asyncio
    async def test_withdraw_local_agent_fails(self, topology):
        """Test withdrawing a local agent returns False."""
        # Add a local agent
        local_conn = AgentConnection(
            agent_id="local-agent",
            transport_type=TransportType.GRPC,
        )
        topology.agent_registry["local-agent"] = local_conn

        success = await topology.withdraw_remote_agent("local-agent")
        assert success is False
        assert "local-agent" in topology.agent_registry

    @pytest.mark.asyncio
    async def test_withdraw_emits_event(self, topology, mock_agent_card):
        """Test withdrawing emits event."""
        events = []

        async def capture_event(name, data):
            events.append((name, data))

        topology.set_remote_event_callback(capture_event)

        with patch.object(topology, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            await topology.announce_remote_agent(url="https://test.example.com", preferred_id="test-agent")
            await topology.withdraw_remote_agent("test-agent")

        assert any(e[0] == "agent.remote.withdrawn" for e in events)


class TestAgentLookup:
    """Tests for agent lookup."""

    @pytest.mark.asyncio
    async def test_get_agent(self, topology, mock_agent_card):
        """Test getting an agent by ID."""
        with patch.object(topology, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            await topology.announce_remote_agent(url="https://test.example.com", preferred_id="test-agent")

            connection = topology.get_agent_connection("test-agent")

            assert connection is not None
            assert connection.agent_id == "test-agent"

    @pytest.mark.asyncio
    async def test_get_nonexistent_agent(self, topology):
        """Test getting nonexistent agent returns None."""
        connection = topology.get_agent_connection("nonexistent")
        assert connection is None

    @pytest.mark.asyncio
    async def test_get_by_url(self, topology, mock_agent_card):
        """Test getting an agent by URL."""
        with patch.object(topology, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            await topology.announce_remote_agent(url="https://test.example.com", preferred_id="test-agent")

            connection = topology.get_agent_by_url("https://test.example.com")

            assert connection is not None
            assert connection.agent_id == "test-agent"

    @pytest.mark.asyncio
    async def test_get_remote_agents(self, topology, mock_agent_card):
        """Test getting all remote agents."""
        with patch.object(topology, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            await topology.announce_remote_agent(url="https://agent1.example.com", preferred_id="agent1")
            await topology.announce_remote_agent(url="https://agent2.example.com", preferred_id="agent2")

            agents = topology.get_remote_agents()

            assert len(agents) == 2

    @pytest.mark.asyncio
    async def test_get_local_agents(self, topology, mock_agent_card):
        """Test getting local agents excludes remote agents."""
        with patch.object(topology, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            # Add a local agent
            local_conn = AgentConnection(
                agent_id="local-agent",
                transport_type=TransportType.GRPC,
            )
            topology.agent_registry["local-agent"] = local_conn

            # Add a remote agent
            await topology.announce_remote_agent(url="https://agent1.example.com", preferred_id="remote-agent")

            local_agents = topology.get_local_agents()
            remote_agents = topology.get_remote_agents()

            assert len(local_agents) == 1
            assert local_agents[0].agent_id == "local-agent"
            assert len(remote_agents) == 1
            assert remote_agents[0].agent_id == "remote-agent"

    @pytest.mark.asyncio
    async def test_get_remote_agents_with_status_filter(self, topology, mock_agent_card):
        """Test getting remote agents filtered by status."""
        with patch.object(topology, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            await topology.announce_remote_agent(url="https://agent1.example.com", preferred_id="agent1")
            await topology.announce_remote_agent(url="https://agent2.example.com", preferred_id="agent2")

            # Mark one as stale
            topology.agent_registry["agent1"].remote_status = RemoteAgentStatus.STALE

            active_agents = topology.get_remote_agents(status=RemoteAgentStatus.ACTIVE)

            assert len(active_agents) == 1
            assert active_agents[0].agent_id == "agent2"


class TestSkillCollection:
    """Tests for skill collection from remote agents."""

    @pytest.mark.asyncio
    async def test_get_all_skills(self, topology, mock_agent_card):
        """Test getting all skills from remote agents."""
        with patch.object(topology, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            await topology.announce_remote_agent(url="https://test.example.com", preferred_id="test-agent")

            skills = topology.get_all_remote_skills()

            assert len(skills) == 2
            assert skills[0].id == "remote.test-agent.translate"
            assert skills[1].id == "remote.test-agent.summarize"
            assert "remote" in skills[0].tags
            assert "test-agent" in skills[0].tags

    @pytest.mark.asyncio
    async def test_get_skills_excludes_stale_agents(self, topology, mock_agent_card):
        """Test that stale agents are excluded from skill collection."""
        with patch.object(topology, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            await topology.announce_remote_agent(url="https://test.example.com", preferred_id="test-agent")

            # Mark as stale
            topology.agent_registry["test-agent"].remote_status = RemoteAgentStatus.STALE

            skills = topology.get_all_remote_skills()

            assert len(skills) == 0


class TestHealthChecks:
    """Tests for health check functionality."""

    @pytest.mark.asyncio
    async def test_health_check_success(self, topology, mock_agent_card):
        """Test successful health check."""
        with patch.object(topology, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            await topology.announce_remote_agent(url="https://test.example.com", preferred_id="test-agent")

        with patch('aiohttp.ClientSession') as mock_session_class:
            mock_session = MagicMock()
            mock_response = MagicMock()
            mock_response.status = 200

            mock_session.__aenter__ = AsyncMock(return_value=mock_session)
            mock_session.__aexit__ = AsyncMock(return_value=None)
            mock_session.get = MagicMock(return_value=MagicMock(
                __aenter__=AsyncMock(return_value=mock_response),
                __aexit__=AsyncMock(return_value=None)
            ))
            mock_session_class.return_value = mock_session

            result = await topology.health_check_remote_agent("test-agent")

            assert result is True
            assert topology.agent_registry["test-agent"].remote_status == RemoteAgentStatus.ACTIVE

    @pytest.mark.asyncio
    async def test_health_check_failure_increments_count(self, topology, mock_agent_card):
        """Test failed health check increments failure count."""
        with patch.object(topology, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            await topology.announce_remote_agent(url="https://test.example.com", preferred_id="test-agent")

        with patch('aiohttp.ClientSession') as mock_session_class:
            mock_session = MagicMock()
            mock_session.__aenter__ = AsyncMock(side_effect=Exception("Connection failed"))
            mock_session_class.return_value = mock_session

            result = await topology.health_check_remote_agent("test-agent")

            assert result is False
            assert topology.agent_registry["test-agent"].failure_count == 1

    @pytest.mark.asyncio
    async def test_health_check_marks_stale_after_failures(self, topology, mock_agent_card):
        """Test agent is marked stale after max failures."""
        with patch.object(topology, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            await topology.announce_remote_agent(url="https://test.example.com", preferred_id="test-agent")

        # Simulate multiple failures
        for _ in range(3):
            await topology._handle_remote_failure("test-agent")

        assert topology.agent_registry["test-agent"].remote_status == RemoteAgentStatus.STALE

    @pytest.mark.asyncio
    async def test_health_check_removes_after_max_failures(self, topology, mock_agent_card):
        """Test agent is removed after max failures."""
        with patch.object(topology, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            await topology.announce_remote_agent(url="https://test.example.com", preferred_id="test-agent")

        # Simulate many failures
        for _ in range(10):
            await topology._handle_remote_failure("test-agent")

        assert topology.remote_agent_count() == 0


class TestCardRefresh:
    """Tests for agent card refresh."""

    @pytest.mark.asyncio
    async def test_refresh_card_success(self, topology, mock_agent_card):
        """Test successful card refresh."""
        with patch.object(topology, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            await topology.announce_remote_agent(url="https://test.example.com", preferred_id="test-agent")

            # Create updated card
            updated_card = AgentCard(
                name="Updated Agent",
                version="2.0.0",
                description="Updated description",
                url="https://test.example.com",
                skills=[],
            )
            mock_fetch.return_value = updated_card

            result = await topology.refresh_agent_card("test-agent")

            assert result is not None
            assert result.name == "Updated Agent"
            assert topology.agent_registry["test-agent"].agent_card.name == "Updated Agent"

    @pytest.mark.asyncio
    async def test_refresh_card_nonexistent_agent(self, topology):
        """Test refreshing card for nonexistent agent."""
        result = await topology.refresh_agent_card("nonexistent")
        assert result is None


class TestAgentConnectionMethods:
    """Tests for AgentConnection helper methods."""

    def test_is_remote_for_a2a_agent(self, topology, mock_agent_card):
        """Test is_remote returns True for A2A agents with address."""
        connection = AgentConnection(
            agent_id="remote-agent",
            transport_type=TransportType.A2A,
            address="https://example.com",
        )
        assert connection.is_remote() is True

    def test_is_remote_for_local_agent(self):
        """Test is_remote returns False for local agents."""
        connection = AgentConnection(
            agent_id="local-agent",
            transport_type=TransportType.GRPC,
        )
        assert connection.is_remote() is False

    def test_is_healthy_for_active_remote(self):
        """Test is_healthy returns True for active remote agents."""
        connection = AgentConnection(
            agent_id="remote-agent",
            transport_type=TransportType.A2A,
            address="https://example.com",
            remote_status=RemoteAgentStatus.ACTIVE,
        )
        assert connection.is_healthy() is True

    def test_is_healthy_for_stale_remote(self):
        """Test is_healthy returns False for stale remote agents."""
        connection = AgentConnection(
            agent_id="remote-agent",
            transport_type=TransportType.A2A,
            address="https://example.com",
            remote_status=RemoteAgentStatus.STALE,
        )
        assert connection.is_healthy() is False

    def test_is_healthy_for_local_agent(self):
        """Test is_healthy returns True for local agents."""
        connection = AgentConnection(
            agent_id="local-agent",
            transport_type=TransportType.GRPC,
        )
        assert connection.is_healthy() is True


class TestAgentCounts:
    """Tests for agent count methods."""

    @pytest.mark.asyncio
    async def test_agent_counts(self, topology, mock_agent_card):
        """Test agent count methods."""
        with patch.object(topology, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            # Initially empty
            assert topology.remote_agent_count() == 0
            assert topology.active_remote_count() == 0

            # Add agents
            await topology.announce_remote_agent(url="https://agent1.example.com", preferred_id="agent1")
            await topology.announce_remote_agent(url="https://agent2.example.com", preferred_id="agent2")

            assert topology.remote_agent_count() == 2
            assert topology.active_remote_count() == 2

            # Mark one as stale
            topology.agent_registry["agent1"].remote_status = RemoteAgentStatus.STALE

            assert topology.remote_agent_count() == 2
            assert topology.active_remote_count() == 1
