"""Tests for A2A Agent Registry."""

import pytest
import asyncio
from unittest.mock import AsyncMock, patch, MagicMock
import time

from openagents.core.a2a_registry import A2AAgentRegistry
from openagents.models.transport import (
    TransportType,
    AgentConnection,
    RemoteAgentStatus,
)
from openagents.models.a2a import AgentCard, AgentSkill, AgentCapabilities


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
def registry_config():
    """Create a registry config for testing."""
    return {
        "card_refresh_interval": 300,
        "health_check_interval": 60,
        "max_failures_before_stale": 3,
        "remove_after_failures": 10,
        "request_timeout": 5,
    }


@pytest.fixture
def registry(registry_config):
    """Create an A2A agent registry for testing."""
    reg = A2AAgentRegistry(registry_config)
    # Set up an agent registry dict that the A2AAgentRegistry will use
    agent_registry = {}
    reg.set_agent_registry(agent_registry)
    return reg


class TestRegistryConfig:
    """Tests for registry configuration."""

    def test_default_config(self):
        """Test default configuration values."""
        registry = A2AAgentRegistry()
        agent_registry = {}
        registry.set_agent_registry(agent_registry)

        assert registry.card_refresh_interval == 300
        assert registry.health_check_interval == 60
        assert registry.max_failures_before_stale == 3
        assert registry.remove_after_failures == 10

    def test_custom_config(self, registry_config):
        """Test custom configuration values."""
        config = {
            "card_refresh_interval": 600,
            "health_check_interval": 120,
            "max_failures_before_stale": 5,
            "remove_after_failures": 20,
        }

        registry = A2AAgentRegistry(config)

        assert registry.card_refresh_interval == 600
        assert registry.health_check_interval == 120
        assert registry.max_failures_before_stale == 5
        assert registry.remove_after_failures == 20


class TestAgentIdResolution:
    """Tests for agent ID resolution."""

    def test_derive_id_from_simple_url(self, registry):
        """Test deriving ID from a simple URL."""
        agent_id = registry._derive_id_from_url("https://translate.example.com")
        assert agent_id == "translate-example-com"

    def test_derive_id_from_url_with_path(self, registry):
        """Test deriving ID from URL with path."""
        agent_id = registry._derive_id_from_url("https://api.agents.io/translator")
        assert agent_id == "api-agents-io-translator"

    def test_derive_id_from_url_with_port(self, registry):
        """Test deriving ID from URL with port."""
        agent_id = registry._derive_id_from_url("https://localhost:8080")
        assert agent_id == "localhost-8080"

    def test_sanitize_id(self, registry):
        """Test ID sanitization."""
        assert registry._sanitize_id("My Agent!@#") == "my-agent"
        assert registry._sanitize_id("Test--Agent") == "test-agent"
        assert registry._sanitize_id("agent_123") == "agent-123"

    def test_resolve_with_preferred_id(self, registry):
        """Test resolving with preferred ID."""
        agent_id = registry._resolve_agent_id(
            "https://example.com",
            preferred_id="my-agent"
        )
        assert agent_id == "my-agent"

    def test_resolve_without_preferred_id(self, registry):
        """Test resolving without preferred ID derives from URL."""
        agent_id = registry._resolve_agent_id(
            "https://translate.example.com",
            preferred_id=None
        )
        assert agent_id == "translate-example-com"

    def test_make_unique_id(self, registry):
        """Test making unique ID."""
        unique_id = registry._make_unique_id("my-agent")
        assert unique_id.startswith("my-agent-")
        assert len(unique_id) > len("my-agent-")


class TestUrlNormalization:
    """Tests for URL normalization."""

    def test_normalize_https_url(self, registry):
        """Test normalizing HTTPS URL."""
        url = registry._normalize_url("https://example.com/")
        assert url == "https://example.com"

    def test_normalize_http_url(self, registry):
        """Test normalizing HTTP URL."""
        url = registry._normalize_url("http://example.com")
        assert url == "http://example.com"

    def test_normalize_url_without_scheme(self, registry):
        """Test normalizing URL without scheme adds HTTPS."""
        url = registry._normalize_url("example.com")
        assert url == "https://example.com"

    def test_get_agent_card_url(self, registry):
        """Test getting agent card URL."""
        card_url = registry._get_agent_card_url("https://example.com")
        assert card_url == "https://example.com/.well-known/agent.json"


class TestAgentAnnouncement:
    """Tests for agent announcement."""

    @pytest.mark.asyncio
    async def test_announce_agent(self, registry, mock_agent_card):
        """Test announcing an A2A agent."""
        with patch.object(registry, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            connection = await registry.announce_agent(
                url="https://test.example.com",
                preferred_id="test-agent"
            )

            assert connection.agent_id == "test-agent"
            assert connection.address == "https://test.example.com"
            assert connection.remote_status == RemoteAgentStatus.ACTIVE
            assert connection.agent_card == mock_agent_card
            assert connection.transport_type == TransportType.A2A
            assert registry.agent_count() == 1

    @pytest.mark.asyncio
    async def test_announce_derives_id_from_url(self, registry, mock_agent_card):
        """Test announcing without preferred ID derives from URL."""
        with patch.object(registry, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            connection = await registry.announce_agent(url="https://translate.example.com")

            assert connection.agent_id == "translate-example-com"

    @pytest.mark.asyncio
    async def test_announce_same_url_returns_existing(self, registry, mock_agent_card):
        """Test announcing same URL returns existing entry."""
        with patch.object(registry, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            conn1 = await registry.announce_agent(url="https://test.example.com", preferred_id="agent1")
            conn2 = await registry.announce_agent(url="https://test.example.com", preferred_id="agent2")

            assert conn1.agent_id == conn2.agent_id
            assert registry.agent_count() == 1

    @pytest.mark.asyncio
    async def test_announce_id_conflict_generates_unique(self, registry, mock_agent_card):
        """Test announcing with conflicting ID generates unique ID."""
        with patch.object(registry, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            conn1 = await registry.announce_agent(
                url="https://agent1.example.com",
                preferred_id="shared-id"
            )
            conn2 = await registry.announce_agent(
                url="https://agent2.example.com",
                preferred_id="shared-id"
            )

            assert conn1.agent_id == "shared-id"
            assert conn2.agent_id.startswith("shared-id-")
            assert conn1.agent_id != conn2.agent_id

    @pytest.mark.asyncio
    async def test_announce_with_metadata(self, registry, mock_agent_card):
        """Test announcing with metadata."""
        with patch.object(registry, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            connection = await registry.announce_agent(
                url="https://test.example.com",
                preferred_id="test-agent",
                metadata={"custom": "data"}
            )

            assert connection.metadata == {"custom": "data"}

    @pytest.mark.asyncio
    async def test_announce_emits_event(self, registry, mock_agent_card):
        """Test announcing emits event."""
        events = []

        async def capture_event(name, data):
            events.append((name, data))

        registry.set_event_callback(capture_event)

        with patch.object(registry, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            await registry.announce_agent(url="https://test.example.com", preferred_id="test-agent")

        assert len(events) == 1
        assert events[0][0] == "agent.a2a.announced"
        assert events[0][1]["agent_id"] == "test-agent"


class TestAgentWithdrawal:
    """Tests for agent withdrawal."""

    @pytest.mark.asyncio
    async def test_withdraw_agent(self, registry, mock_agent_card):
        """Test withdrawing an A2A agent."""
        with patch.object(registry, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            await registry.announce_agent(url="https://test.example.com", preferred_id="test-agent")
            assert registry.agent_count() == 1

            success = await registry.withdraw_agent("test-agent")

            assert success is True
            assert registry.agent_count() == 0

    @pytest.mark.asyncio
    async def test_withdraw_nonexistent_agent(self, registry):
        """Test withdrawing nonexistent agent returns False."""
        success = await registry.withdraw_agent("nonexistent")
        assert success is False

    @pytest.mark.asyncio
    async def test_withdraw_non_a2a_agent_fails(self, registry):
        """Test withdrawing a non-A2A agent returns False."""
        # Add a non-A2A agent directly to the registry
        local_conn = AgentConnection(
            agent_id="local-agent",
            transport_type=TransportType.GRPC,
        )
        registry._agent_registry["local-agent"] = local_conn

        success = await registry.withdraw_agent("local-agent")
        assert success is False
        assert "local-agent" in registry._agent_registry

    @pytest.mark.asyncio
    async def test_withdraw_emits_event(self, registry, mock_agent_card):
        """Test withdrawing emits event."""
        events = []

        async def capture_event(name, data):
            events.append((name, data))

        registry.set_event_callback(capture_event)

        with patch.object(registry, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            await registry.announce_agent(url="https://test.example.com", preferred_id="test-agent")
            await registry.withdraw_agent("test-agent")

        assert any(e[0] == "agent.a2a.withdrawn" for e in events)


class TestAgentLookup:
    """Tests for agent lookup."""

    @pytest.mark.asyncio
    async def test_get_a2a_agents(self, registry, mock_agent_card):
        """Test getting all A2A agents."""
        with patch.object(registry, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            await registry.announce_agent(url="https://agent1.example.com", preferred_id="agent1")
            await registry.announce_agent(url="https://agent2.example.com", preferred_id="agent2")

            agents = registry.get_a2a_agents()

            assert len(agents) == 2

    @pytest.mark.asyncio
    async def test_get_a2a_agents_excludes_non_a2a(self, registry, mock_agent_card):
        """Test getting A2A agents excludes non-A2A agents."""
        with patch.object(registry, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            # Add a non-A2A agent
            local_conn = AgentConnection(
                agent_id="local-agent",
                transport_type=TransportType.GRPC,
            )
            registry._agent_registry["local-agent"] = local_conn

            # Add an A2A agent
            await registry.announce_agent(url="https://agent1.example.com", preferred_id="a2a-agent")

            a2a_agents = registry.get_a2a_agents()

            assert len(a2a_agents) == 1
            assert a2a_agents[0].agent_id == "a2a-agent"

    @pytest.mark.asyncio
    async def test_get_by_url(self, registry, mock_agent_card):
        """Test getting an agent by URL."""
        with patch.object(registry, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            await registry.announce_agent(url="https://test.example.com", preferred_id="test-agent")

            connection = registry.get_agent_by_url("https://test.example.com")

            assert connection is not None
            assert connection.agent_id == "test-agent"

    @pytest.mark.asyncio
    async def test_get_a2a_agents_with_status_filter(self, registry, mock_agent_card):
        """Test getting A2A agents filtered by status."""
        with patch.object(registry, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            await registry.announce_agent(url="https://agent1.example.com", preferred_id="agent1")
            await registry.announce_agent(url="https://agent2.example.com", preferred_id="agent2")

            # Mark one as stale
            registry._agent_registry["agent1"].remote_status = RemoteAgentStatus.STALE

            active_agents = registry.get_a2a_agents(status=RemoteAgentStatus.ACTIVE)

            assert len(active_agents) == 1
            assert active_agents[0].agent_id == "agent2"


class TestSkillCollection:
    """Tests for skill collection from A2A agents."""

    @pytest.mark.asyncio
    async def test_get_all_skills(self, registry, mock_agent_card):
        """Test getting all skills from A2A agents."""
        with patch.object(registry, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            await registry.announce_agent(url="https://test.example.com", preferred_id="test-agent")

            skills = registry.get_all_skills()

            assert len(skills) == 2
            assert skills[0].id == "a2a.test-agent.translate"
            assert skills[1].id == "a2a.test-agent.summarize"
            assert "a2a" in skills[0].tags
            assert "test-agent" in skills[0].tags

    @pytest.mark.asyncio
    async def test_get_skills_excludes_stale_agents(self, registry, mock_agent_card):
        """Test that stale agents are excluded from skill collection."""
        with patch.object(registry, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            await registry.announce_agent(url="https://test.example.com", preferred_id="test-agent")

            # Mark as stale
            registry._agent_registry["test-agent"].remote_status = RemoteAgentStatus.STALE

            skills = registry.get_all_skills()

            assert len(skills) == 0


class TestHealthChecks:
    """Tests for health check functionality."""

    @pytest.mark.asyncio
    async def test_health_check_success(self, registry, mock_agent_card):
        """Test successful health check."""
        with patch.object(registry, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            await registry.announce_agent(url="https://test.example.com", preferred_id="test-agent")

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

            result = await registry.health_check_agent("test-agent")

            assert result is True
            assert registry._agent_registry["test-agent"].remote_status == RemoteAgentStatus.ACTIVE

    @pytest.mark.asyncio
    async def test_health_check_failure_increments_count(self, registry, mock_agent_card):
        """Test failed health check increments failure count."""
        with patch.object(registry, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            await registry.announce_agent(url="https://test.example.com", preferred_id="test-agent")

        with patch('aiohttp.ClientSession') as mock_session_class:
            mock_session = MagicMock()
            mock_session.__aenter__ = AsyncMock(side_effect=Exception("Connection failed"))
            mock_session_class.return_value = mock_session

            result = await registry.health_check_agent("test-agent")

            assert result is False
            assert registry._agent_registry["test-agent"].failure_count == 1

    @pytest.mark.asyncio
    async def test_health_check_marks_stale_after_failures(self, registry, mock_agent_card):
        """Test agent is marked stale after max failures."""
        with patch.object(registry, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            await registry.announce_agent(url="https://test.example.com", preferred_id="test-agent")

        # Simulate multiple failures
        for _ in range(3):
            await registry._handle_failure("test-agent")

        assert registry._agent_registry["test-agent"].remote_status == RemoteAgentStatus.STALE

    @pytest.mark.asyncio
    async def test_health_check_removes_after_max_failures(self, registry, mock_agent_card):
        """Test agent is removed after max failures."""
        with patch.object(registry, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            await registry.announce_agent(url="https://test.example.com", preferred_id="test-agent")

        # Simulate many failures
        for _ in range(10):
            await registry._handle_failure("test-agent")

        assert registry.agent_count() == 0


class TestCardRefresh:
    """Tests for agent card refresh."""

    @pytest.mark.asyncio
    async def test_refresh_card_success(self, registry, mock_agent_card):
        """Test successful card refresh."""
        with patch.object(registry, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            await registry.announce_agent(url="https://test.example.com", preferred_id="test-agent")

            # Create updated card
            updated_card = AgentCard(
                name="Updated Agent",
                version="2.0.0",
                description="Updated description",
                url="https://test.example.com",
                skills=[],
            )
            mock_fetch.return_value = updated_card

            result = await registry.refresh_agent_card("test-agent")

            assert result is not None
            assert result.name == "Updated Agent"
            assert registry._agent_registry["test-agent"].agent_card.name == "Updated Agent"

    @pytest.mark.asyncio
    async def test_refresh_card_nonexistent_agent(self, registry):
        """Test refreshing card for nonexistent agent."""
        result = await registry.refresh_agent_card("nonexistent")
        assert result is None


class TestAgentConnectionMethods:
    """Tests for AgentConnection helper methods."""

    def test_is_a2a_for_a2a_agent(self):
        """Test is_a2a returns True for A2A agents."""
        connection = AgentConnection(
            agent_id="a2a-agent",
            transport_type=TransportType.A2A,
            address="https://example.com",
        )
        assert connection.is_a2a() is True

    def test_is_a2a_for_non_a2a_agent(self):
        """Test is_a2a returns False for non-A2A agents."""
        connection = AgentConnection(
            agent_id="local-agent",
            transport_type=TransportType.GRPC,
        )
        assert connection.is_a2a() is False

    def test_is_healthy_for_active_a2a(self):
        """Test is_healthy returns True for active A2A agents."""
        connection = AgentConnection(
            agent_id="a2a-agent",
            transport_type=TransportType.A2A,
            address="https://example.com",
            remote_status=RemoteAgentStatus.ACTIVE,
        )
        assert connection.is_healthy() is True

    def test_is_healthy_for_stale_a2a(self):
        """Test is_healthy returns False for stale A2A agents."""
        connection = AgentConnection(
            agent_id="a2a-agent",
            transport_type=TransportType.A2A,
            address="https://example.com",
            remote_status=RemoteAgentStatus.STALE,
        )
        assert connection.is_healthy() is False

    def test_is_healthy_for_non_a2a_agent(self):
        """Test is_healthy returns True for non-A2A agents."""
        connection = AgentConnection(
            agent_id="local-agent",
            transport_type=TransportType.GRPC,
        )
        assert connection.is_healthy() is True


class TestAgentCounts:
    """Tests for agent count methods."""

    @pytest.mark.asyncio
    async def test_agent_counts(self, registry, mock_agent_card):
        """Test agent count methods."""
        with patch.object(registry, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            # Initially empty
            assert registry.agent_count() == 0
            assert registry.active_agent_count() == 0

            # Add agents
            await registry.announce_agent(url="https://agent1.example.com", preferred_id="agent1")
            await registry.announce_agent(url="https://agent2.example.com", preferred_id="agent2")

            assert registry.agent_count() == 2
            assert registry.active_agent_count() == 2

            # Mark one as stale
            registry._agent_registry["agent1"].remote_status = RemoteAgentStatus.STALE

            assert registry.agent_count() == 2
            assert registry.active_agent_count() == 1
