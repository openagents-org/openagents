"""Tests for Remote Agent Registry."""

import pytest
import asyncio
from unittest.mock import AsyncMock, patch, MagicMock
import time

from openagents.core.remote_agent_registry import (
    RemoteAgentRegistry,
    RemoteAgentEntry,
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
def registry():
    """Create a registry for testing."""
    return RemoteAgentRegistry(config={
        "card_refresh_interval": 300,
        "health_check_interval": 60,
        "max_failures_before_stale": 3,
        "remove_after_failures": 10,
        "request_timeout": 5,
    })


class TestRemoteAgentRegistryConfig:
    """Tests for registry configuration."""

    def test_default_config(self):
        """Test default configuration values."""
        registry = RemoteAgentRegistry()

        assert registry.card_refresh_interval == 300
        assert registry.health_check_interval == 60
        assert registry.max_failures_before_stale == 3
        assert registry.remove_after_failures == 10

    def test_custom_config(self):
        """Test custom configuration values."""
        registry = RemoteAgentRegistry(config={
            "card_refresh_interval": 600,
            "health_check_interval": 120,
            "max_failures_before_stale": 5,
            "remove_after_failures": 20,
        })

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
        """Test announcing a remote agent."""
        with patch.object(registry, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            entry = await registry.announce(
                url="https://test.example.com",
                preferred_id="test-agent"
            )

            assert entry.agent_id == "test-agent"
            assert entry.url == "https://test.example.com"
            assert entry.status == RemoteAgentStatus.ACTIVE
            assert entry.agent_card == mock_agent_card
            assert registry.agent_count() == 1

    @pytest.mark.asyncio
    async def test_announce_derives_id_from_url(self, registry, mock_agent_card):
        """Test announcing without preferred ID derives from URL."""
        with patch.object(registry, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            entry = await registry.announce(url="https://translate.example.com")

            assert entry.agent_id == "translate-example-com"

    @pytest.mark.asyncio
    async def test_announce_same_url_returns_existing(self, registry, mock_agent_card):
        """Test announcing same URL returns existing entry."""
        with patch.object(registry, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            entry1 = await registry.announce(url="https://test.example.com", preferred_id="agent1")
            entry2 = await registry.announce(url="https://test.example.com", preferred_id="agent2")

            assert entry1.agent_id == entry2.agent_id
            assert registry.agent_count() == 1

    @pytest.mark.asyncio
    async def test_announce_id_conflict_generates_unique(self, registry, mock_agent_card):
        """Test announcing with conflicting ID generates unique ID."""
        with patch.object(registry, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            entry1 = await registry.announce(
                url="https://agent1.example.com",
                preferred_id="shared-id"
            )
            entry2 = await registry.announce(
                url="https://agent2.example.com",
                preferred_id="shared-id"
            )

            assert entry1.agent_id == "shared-id"
            assert entry2.agent_id.startswith("shared-id-")
            assert entry1.agent_id != entry2.agent_id

    @pytest.mark.asyncio
    async def test_announce_with_metadata(self, registry, mock_agent_card):
        """Test announcing with metadata."""
        with patch.object(registry, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            entry = await registry.announce(
                url="https://test.example.com",
                preferred_id="test-agent",
                metadata={"custom": "data"}
            )

            assert entry.metadata == {"custom": "data"}

    @pytest.mark.asyncio
    async def test_announce_emits_event(self, registry, mock_agent_card):
        """Test announcing emits event."""
        events = []

        async def capture_event(name, data):
            events.append((name, data))

        registry._event_callback = capture_event

        with patch.object(registry, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            await registry.announce(url="https://test.example.com", preferred_id="test-agent")

        assert len(events) == 1
        assert events[0][0] == "agent.remote.announced"
        assert events[0][1]["agent_id"] == "test-agent"


class TestAgentWithdrawal:
    """Tests for agent withdrawal."""

    @pytest.mark.asyncio
    async def test_withdraw_agent(self, registry, mock_agent_card):
        """Test withdrawing a remote agent."""
        with patch.object(registry, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            await registry.announce(url="https://test.example.com", preferred_id="test-agent")
            assert registry.agent_count() == 1

            success = await registry.withdraw("test-agent")

            assert success is True
            assert registry.agent_count() == 0

    @pytest.mark.asyncio
    async def test_withdraw_nonexistent_agent(self, registry):
        """Test withdrawing nonexistent agent returns False."""
        success = await registry.withdraw("nonexistent")
        assert success is False

    @pytest.mark.asyncio
    async def test_withdraw_emits_event(self, registry, mock_agent_card):
        """Test withdrawing emits event."""
        events = []

        async def capture_event(name, data):
            events.append((name, data))

        registry._event_callback = capture_event

        with patch.object(registry, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            await registry.announce(url="https://test.example.com", preferred_id="test-agent")
            await registry.withdraw("test-agent")

        assert any(e[0] == "agent.remote.withdrawn" for e in events)


class TestAgentLookup:
    """Tests for agent lookup."""

    @pytest.mark.asyncio
    async def test_get_agent(self, registry, mock_agent_card):
        """Test getting an agent by ID."""
        with patch.object(registry, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            await registry.announce(url="https://test.example.com", preferred_id="test-agent")

            entry = await registry.get("test-agent")

            assert entry is not None
            assert entry.agent_id == "test-agent"

    @pytest.mark.asyncio
    async def test_get_nonexistent_agent(self, registry):
        """Test getting nonexistent agent returns None."""
        entry = await registry.get("nonexistent")
        assert entry is None

    @pytest.mark.asyncio
    async def test_get_by_url(self, registry, mock_agent_card):
        """Test getting an agent by URL."""
        with patch.object(registry, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            await registry.announce(url="https://test.example.com", preferred_id="test-agent")

            entry = await registry.get_by_url("https://test.example.com")

            assert entry is not None
            assert entry.agent_id == "test-agent"

    @pytest.mark.asyncio
    async def test_list_agents(self, registry, mock_agent_card):
        """Test listing all agents."""
        with patch.object(registry, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            await registry.announce(url="https://agent1.example.com", preferred_id="agent1")
            await registry.announce(url="https://agent2.example.com", preferred_id="agent2")

            agents = await registry.list()

            assert len(agents) == 2

    @pytest.mark.asyncio
    async def test_list_active_agents(self, registry, mock_agent_card):
        """Test listing only active agents."""
        with patch.object(registry, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            await registry.announce(url="https://agent1.example.com", preferred_id="agent1")
            await registry.announce(url="https://agent2.example.com", preferred_id="agent2")

            # Mark one as stale
            registry._agents["agent1"].status = RemoteAgentStatus.STALE

            active_agents = await registry.list_active()

            assert len(active_agents) == 1
            assert active_agents[0].agent_id == "agent2"


class TestSkillCollection:
    """Tests for skill collection from remote agents."""

    @pytest.mark.asyncio
    async def test_get_all_skills(self, registry, mock_agent_card):
        """Test getting all skills from remote agents."""
        with patch.object(registry, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            await registry.announce(url="https://test.example.com", preferred_id="test-agent")

            skills = registry.get_all_skills()

            assert len(skills) == 2
            assert skills[0].id == "remote.test-agent.translate"
            assert skills[1].id == "remote.test-agent.summarize"
            assert "remote" in skills[0].tags
            assert "test-agent" in skills[0].tags

    @pytest.mark.asyncio
    async def test_get_skills_excludes_stale_agents(self, registry, mock_agent_card):
        """Test that stale agents are excluded from skill collection."""
        with patch.object(registry, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            await registry.announce(url="https://test.example.com", preferred_id="test-agent")

            # Mark as stale
            registry._agents["test-agent"].status = RemoteAgentStatus.STALE

            skills = registry.get_all_skills()

            assert len(skills) == 0


class TestHealthChecks:
    """Tests for health check functionality."""

    @pytest.mark.asyncio
    async def test_health_check_success(self, registry, mock_agent_card):
        """Test successful health check."""
        with patch.object(registry, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            await registry.announce(url="https://test.example.com", preferred_id="test-agent")

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

            result = await registry.health_check("test-agent")

            assert result is True
            assert registry._agents["test-agent"].status == RemoteAgentStatus.ACTIVE

    @pytest.mark.asyncio
    async def test_health_check_failure_increments_count(self, registry, mock_agent_card):
        """Test failed health check increments failure count."""
        with patch.object(registry, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            await registry.announce(url="https://test.example.com", preferred_id="test-agent")

        with patch('aiohttp.ClientSession') as mock_session_class:
            mock_session = MagicMock()
            mock_session.__aenter__ = AsyncMock(side_effect=Exception("Connection failed"))
            mock_session_class.return_value = mock_session

            result = await registry.health_check("test-agent")

            assert result is False
            assert registry._agents["test-agent"].failure_count == 1

    @pytest.mark.asyncio
    async def test_health_check_marks_stale_after_failures(self, registry, mock_agent_card):
        """Test agent is marked stale after max failures."""
        with patch.object(registry, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            await registry.announce(url="https://test.example.com", preferred_id="test-agent")

        # Simulate multiple failures
        for _ in range(3):
            await registry._handle_failure("test-agent")

        assert registry._agents["test-agent"].status == RemoteAgentStatus.STALE

    @pytest.mark.asyncio
    async def test_health_check_removes_after_max_failures(self, registry, mock_agent_card):
        """Test agent is removed after max failures."""
        with patch.object(registry, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            await registry.announce(url="https://test.example.com", preferred_id="test-agent")

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

            await registry.announce(url="https://test.example.com", preferred_id="test-agent")

            # Create updated card
            updated_card = AgentCard(
                name="Updated Agent",
                version="2.0.0",
                description="Updated description",
                url="https://test.example.com",
                skills=[],
            )
            mock_fetch.return_value = updated_card

            result = await registry.refresh_card("test-agent")

            assert result is not None
            assert result.name == "Updated Agent"
            assert registry._agents["test-agent"].agent_card.name == "Updated Agent"

    @pytest.mark.asyncio
    async def test_refresh_card_nonexistent_agent(self, registry):
        """Test refreshing card for nonexistent agent."""
        result = await registry.refresh_card("nonexistent")
        assert result is None


class TestRegistryLifecycle:
    """Tests for registry lifecycle management."""

    @pytest.mark.asyncio
    async def test_start_and_stop(self, registry):
        """Test starting and stopping the registry."""
        await registry.start()
        assert registry._running is True
        assert registry._refresh_task is not None
        assert registry._health_check_task is not None

        await registry.stop()
        assert registry._running is False
        assert registry._refresh_task is None
        assert registry._health_check_task is None

    @pytest.mark.asyncio
    async def test_clear_registry(self, registry, mock_agent_card):
        """Test clearing the registry."""
        with patch.object(registry, 'fetch_agent_card', new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = mock_agent_card

            await registry.announce(url="https://agent1.example.com", preferred_id="agent1")
            await registry.announce(url="https://agent2.example.com", preferred_id="agent2")

            assert registry.agent_count() == 2

            await registry.clear()

            assert registry.agent_count() == 0

    def test_agent_count(self, registry):
        """Test agent count methods."""
        assert registry.agent_count() == 0
        assert registry.active_count() == 0
