"""
Test cases for agent discovery mod functionality.

Tests capability management, agent search, agent listing, and notifications.
"""

import pytest
import time
from unittest.mock import MagicMock, AsyncMock, patch

from openagents.mods.discovery.agent_discovery.mod import (
    AgentDiscoveryMod,
    AgentInfo,
    MOD_NAME,
)
from openagents.mods.discovery.agent_discovery.adapter import (
    AgentDiscoveryAdapter,
)
from openagents.models.event import Event


class TestAgentInfoModel:
    """Test AgentInfo data model."""

    def test_agent_info_creation(self):
        """Test basic agent info creation."""
        info = AgentInfo(
            agent_id="agent-123",
            agent_group="researchers",
            capabilities={"language_models": ["gpt-4"]},
            connected_at=1700000000.0
        )

        assert info.agent_id == "agent-123"
        assert info.agent_group == "researchers"
        assert info.capabilities == {"language_models": ["gpt-4"]}
        assert info.connected_at == 1700000000.0

    def test_agent_info_defaults(self):
        """Test agent info with default values."""
        info = AgentInfo(agent_id="agent-456")

        assert info.agent_id == "agent-456"
        assert info.agent_group is None
        assert info.capabilities == {}
        assert info.connected_at is not None


class TestAgentDiscoveryMod:
    """Test AgentDiscoveryMod functionality."""

    @pytest.fixture
    def mod(self):
        """Create a fresh mod instance for testing."""
        mod = AgentDiscoveryMod()
        # Mock the network
        mod._network = MagicMock()
        mod._network.topology = MagicMock()
        mod._network.topology.agent_group_membership = {}
        mod._network.process_event = AsyncMock(return_value=None)
        return mod

    def test_mod_initialization(self, mod):
        """Test mod initializes correctly."""
        assert mod.mod_name == MOD_NAME
        assert mod._agent_registry == {}

    def test_mod_initialize(self, mod):
        """Test mod initialize method."""
        assert mod.initialize() is True

    def test_mod_shutdown(self, mod):
        """Test mod shutdown method."""
        mod._agent_registry["agent-1"] = AgentInfo(agent_id="agent-1")
        assert mod.shutdown() is True
        assert mod._agent_registry == {}

    @pytest.mark.asyncio
    async def test_handle_register_agent(self, mod):
        """Test agent registration handler."""
        mod._network.topology.agent_group_membership = {"agent-1": "researchers"}
        
        result = await mod.handle_register_agent(
            "agent-1",
            {"capabilities": {"tools": ["web_search"]}}
        )

        assert result is None  # Registration doesn't return a response
        assert "agent-1" in mod._agent_registry
        assert mod._agent_registry["agent-1"].agent_group == "researchers"
        assert mod._agent_registry["agent-1"].capabilities == {"tools": ["web_search"]}

    @pytest.mark.asyncio
    async def test_handle_unregister_agent(self, mod):
        """Test agent unregistration handler."""
        mod._agent_registry["agent-1"] = AgentInfo(
            agent_id="agent-1",
            capabilities={"tools": ["web_search"]}
        )

        result = await mod.handle_unregister_agent("agent-1")

        assert result is None
        assert "agent-1" not in mod._agent_registry

    @pytest.mark.asyncio
    async def test_handle_capabilities_set(self, mod):
        """Test setting agent capabilities."""
        event = Event(
            event_name="discovery.capabilities.set",
            source_id="agent-alice",
            payload={
                "capabilities": {
                    "language_models": ["gpt-4", "claude-3"],
                    "tools": ["web_search", "code_execution"]
                }
            }
        )

        response = await mod._handle_capabilities_set(event)

        assert response is not None
        assert response.success is True
        assert response.message == "Capabilities updated"
        assert response.data["agent_id"] == "agent-alice"
        assert "language_models" in response.data["capabilities"]

    @pytest.mark.asyncio
    async def test_handle_capabilities_set_invalid(self, mod):
        """Test setting invalid capabilities."""
        event = Event(
            event_name="discovery.capabilities.set",
            source_id="agent-alice",
            payload={"capabilities": "invalid"}
        )

        response = await mod._handle_capabilities_set(event)

        assert response is not None
        assert response.success is False
        assert "dictionary" in response.message.lower()

    @pytest.mark.asyncio
    async def test_handle_capabilities_get(self, mod):
        """Test getting agent capabilities."""
        mod._agent_registry["agent-bob"] = AgentInfo(
            agent_id="agent-bob",
            capabilities={"tools": ["web_search"]}
        )

        event = Event(
            event_name="discovery.capabilities.get",
            source_id="agent-alice",
            payload={"agent_id": "agent-bob"}
        )

        response = await mod._handle_capabilities_get(event)

        assert response is not None
        assert response.success is True
        assert response.data["agent_id"] == "agent-bob"
        assert response.data["capabilities"]["tools"] == ["web_search"]

    @pytest.mark.asyncio
    async def test_handle_capabilities_get_not_found(self, mod):
        """Test getting capabilities for non-existent agent."""
        event = Event(
            event_name="discovery.capabilities.get",
            source_id="agent-alice",
            payload={"agent_id": "agent-unknown"}
        )

        response = await mod._handle_capabilities_get(event)

        assert response is not None
        assert response.success is True
        assert response.data["capabilities"] is None

    @pytest.mark.asyncio
    async def test_handle_capabilities_get_missing_agent_id(self, mod):
        """Test getting capabilities without agent_id."""
        event = Event(
            event_name="discovery.capabilities.get",
            source_id="agent-alice",
            payload={}
        )

        response = await mod._handle_capabilities_get(event)

        assert response is not None
        assert response.success is False

    @pytest.mark.asyncio
    async def test_handle_agents_search(self, mod):
        """Test searching agents by capability filter."""
        mod._agent_registry["agent-bob"] = AgentInfo(
            agent_id="agent-bob",
            agent_group="researchers",
            capabilities={"tools": ["web_search", "code_execution"]}
        )
        mod._agent_registry["agent-carol"] = AgentInfo(
            agent_id="agent-carol",
            agent_group="coordinators",
            capabilities={"tools": ["database_query"]}
        )

        event = Event(
            event_name="discovery.agents.search",
            source_id="agent-alice",
            payload={"filter": {"tools": ["web_search"]}}
        )

        response = await mod._handle_agents_search(event)

        assert response is not None
        assert response.success is True
        assert response.data["count"] == 1
        assert response.data["agents"][0]["agent_id"] == "agent-bob"

    @pytest.mark.asyncio
    async def test_handle_agents_search_no_match(self, mod):
        """Test searching agents with no matches."""
        mod._agent_registry["agent-bob"] = AgentInfo(
            agent_id="agent-bob",
            capabilities={"tools": ["code_execution"]}
        )

        event = Event(
            event_name="discovery.agents.search",
            source_id="agent-alice",
            payload={"filter": {"tools": ["web_search"]}}
        )

        response = await mod._handle_agents_search(event)

        assert response is not None
        assert response.success is True
        assert response.data["count"] == 0
        assert response.data["agents"] == []

    @pytest.mark.asyncio
    async def test_handle_agents_list(self, mod):
        """Test listing all agents."""
        mod._agent_registry["agent-bob"] = AgentInfo(
            agent_id="agent-bob",
            agent_group="researchers",
            capabilities={"tools": ["web_search"]}
        )
        mod._agent_registry["agent-carol"] = AgentInfo(
            agent_id="agent-carol",
            agent_group="coordinators",
            capabilities={"tools": ["database_query"]}
        )

        event = Event(
            event_name="discovery.agents.list",
            source_id="agent-alice",
            payload={}
        )

        response = await mod._handle_agents_list(event)

        assert response is not None
        assert response.success is True
        assert response.data["count"] == 2

    @pytest.mark.asyncio
    async def test_handle_agents_list_with_filter(self, mod):
        """Test listing agents with filter."""
        mod._agent_registry["agent-bob"] = AgentInfo(
            agent_id="agent-bob",
            capabilities={"tools": ["web_search"]}
        )
        mod._agent_registry["agent-carol"] = AgentInfo(
            agent_id="agent-carol",
            capabilities={"tools": ["database_query"]}
        )

        event = Event(
            event_name="discovery.agents.list",
            source_id="agent-alice",
            payload={"filter": {"tools": ["web_search"]}}
        )

        response = await mod._handle_agents_list(event)

        assert response is not None
        assert response.success is True
        assert response.data["count"] == 1
        assert response.data["agents"][0]["agent_id"] == "agent-bob"

    def test_get_state(self, mod):
        """Test getting mod state."""
        mod._agent_registry["agent-bob"] = AgentInfo(
            agent_id="agent-bob",
            capabilities={"tools": ["web_search"]}
        )

        state = mod.get_state()

        assert state["agent_count"] == 1
        assert "agent-bob" in state["agents"]


class TestCapabilityMatching:
    """Test capability matching logic."""

    @pytest.fixture
    def mod(self):
        """Create a fresh mod instance for testing."""
        return AgentDiscoveryMod()

    def test_match_empty_query(self, mod):
        """Test matching with empty query matches everything."""
        capabilities = {"tools": ["web_search"]}
        assert mod._match_capabilities({}, capabilities) is True

    def test_match_list_single_item(self, mod):
        """Test matching list with single item."""
        query = {"tools": ["web_search"]}
        capabilities = {"tools": ["web_search", "code_execution"]}
        assert mod._match_capabilities(query, capabilities) is True

    def test_match_list_multiple_items(self, mod):
        """Test matching list with multiple items (any match)."""
        query = {"tools": ["web_search", "database"]}
        capabilities = {"tools": ["web_search", "code_execution"]}
        assert mod._match_capabilities(query, capabilities) is True

    def test_match_list_no_match(self, mod):
        """Test matching list with no matches."""
        query = {"tools": ["database"]}
        capabilities = {"tools": ["web_search", "code_execution"]}
        assert mod._match_capabilities(query, capabilities) is False

    def test_match_scalar_value(self, mod):
        """Test matching scalar values."""
        query = {"specialization": "research"}
        capabilities = {"specialization": "research", "tools": ["web_search"]}
        assert mod._match_capabilities(query, capabilities) is True

    def test_match_scalar_no_match(self, mod):
        """Test matching scalar values with no match."""
        query = {"specialization": "development"}
        capabilities = {"specialization": "research"}
        assert mod._match_capabilities(query, capabilities) is False

    def test_match_nested_dict(self, mod):
        """Test matching nested dictionaries."""
        query = {"config": {"model": "gpt-4"}}
        capabilities = {"config": {"model": "gpt-4", "temperature": 0.7}}
        assert mod._match_capabilities(query, capabilities) is True

    def test_match_nested_dict_no_match(self, mod):
        """Test matching nested dictionaries with no match."""
        query = {"config": {"model": "claude-3"}}
        capabilities = {"config": {"model": "gpt-4"}}
        assert mod._match_capabilities(query, capabilities) is False

    def test_match_missing_key(self, mod):
        """Test matching with missing key."""
        query = {"tools": ["web_search"]}
        capabilities = {"specialization": "research"}
        assert mod._match_capabilities(query, capabilities) is False


class TestAgentDiscoveryAdapter:
    """Test AgentDiscoveryAdapter functionality."""

    @pytest.fixture
    def adapter(self):
        """Create a fresh adapter instance for testing."""
        adapter = AgentDiscoveryAdapter()
        adapter._agent_id = "agent-test"
        return adapter

    def test_adapter_initialization(self, adapter):
        """Test adapter initializes correctly."""
        assert adapter.mod_name == MOD_NAME
        assert adapter._capabilities == {}

    def test_adapter_initialize(self, adapter):
        """Test adapter initialize method."""
        assert adapter.initialize() is True

    def test_adapter_shutdown(self, adapter):
        """Test adapter shutdown method."""
        assert adapter.shutdown() is True

    def test_get_tools(self, adapter):
        """Test adapter returns tools."""
        tools = adapter.get_tools()

        assert len(tools) == 4
        tool_names = [t.name for t in tools]
        assert "set_capabilities" in tool_names
        assert "get_agent_capabilities" in tool_names
        assert "search_agents" in tool_names
        assert "list_agents" in tool_names

    @pytest.mark.asyncio
    async def test_set_capabilities_not_connected(self, adapter):
        """Test setting capabilities when not connected."""
        result = await adapter.set_capabilities({"tools": ["web_search"]})

        assert result["success"] is True
        assert "locally" in result["message"]
        assert adapter._capabilities == {"tools": ["web_search"]}

    @pytest.mark.asyncio
    async def test_get_capabilities_not_connected(self, adapter):
        """Test getting capabilities when not connected."""
        result = await adapter.get_capabilities("agent-bob")

        assert result is None

    @pytest.mark.asyncio
    async def test_search_agents_not_connected(self, adapter):
        """Test searching agents when not connected."""
        result = await adapter.search_agents({"tools": ["web_search"]})

        assert result == []

    @pytest.mark.asyncio
    async def test_list_agents_not_connected(self, adapter):
        """Test listing agents when not connected."""
        result = await adapter.list_agents()

        assert result == []

    @pytest.mark.asyncio
    async def test_process_incoming_event_notification(self, adapter):
        """Test processing incoming notification event."""
        event = Event(
            event_name="discovery.notification.agent_connected",
            source_id="mod:discovery",
            payload={"agent_id": "agent-new"}
        )

        result = await adapter.process_incoming_event(event)

        # Notification events should pass through
        assert result is event

    @pytest.mark.asyncio
    async def test_process_incoming_event_other(self, adapter):
        """Test processing other incoming events."""
        event = Event(
            event_name="other.event",
            source_id="agent-bob",
            payload={}
        )

        result = await adapter.process_incoming_event(event)

        assert result is event
