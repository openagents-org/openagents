"""
Unit tests for the AgentNetwork class.

This module contains tests for the enhanced network functionality including:
- Network initialization and configuration
- Agent registration and discovery
- Message routing and delivery
- Transport and topology integration
- Network statistics and monitoring
"""

import pytest
import asyncio
import logging
import time
import sys
import os
from unittest.mock import AsyncMock, MagicMock, patch
from typing import Dict, Any, List, Optional

# Add the src directory to the Python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../src')))

from openagents.core.network import AgentNetwork, create_network
from openagents.models.network_config import NetworkConfig, NetworkMode
from openagents.models.transport import TransportType, AgentInfo
from openagents.models.messages import (
    BaseMessage,
    DirectMessage,
    BroadcastMessage,
    ProtocolMessage
)

# Configure logging for tests
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)


class TestNetworkConfig:
    """Test network configuration creation and validation."""
    
    def test_basic_network_config(self):
        """Test creating a basic network configuration."""
        config = NetworkConfig(
            name="TestNetwork",
            mode=NetworkMode.CENTRALIZED,
            host="127.0.0.1",
            port=8765,
            transport=TransportType.WEBSOCKET
        )
        
        assert config.name == "TestNetwork"
        assert config.mode == "centralized"  # Config returns string values
        assert config.host == "127.0.0.1"
        assert config.port == 8765
        assert config.transport == "websocket"  # Config returns string values
    
    def test_decentralized_network_config(self):
        """Test creating a decentralized network configuration."""
        config = NetworkConfig(
            name="P2PNetwork",
            mode=NetworkMode.DECENTRALIZED,
            host="0.0.0.0",
            port=4001,
            transport=TransportType.WEBSOCKET,
            bootstrap_nodes=["node1", "node2"]
        )
        
        assert config.mode == "decentralized"  # Config returns string values
        assert config.bootstrap_nodes == ["node1", "node2"]


class TestAgentNetwork:
    """Test cases for the AgentNetwork class."""
    
    @pytest.fixture
    def network_config(self):
        """Create a test network configuration."""
        return NetworkConfig(
            name="TestNetwork",
            mode=NetworkMode.CENTRALIZED,
            host="127.0.0.1",
            port=8765,
            transport=TransportType.WEBSOCKET,
            server_mode=True
        )
    
    @pytest.fixture
    def network(self, network_config):
        """Create a test network instance."""
        return AgentNetwork(network_config)
    
    def test_network_initialization(self, network, network_config):
        """Test network initialization."""
        assert network.network_name == "TestNetwork"
        assert network.config == network_config
        assert not network.is_running
        assert network.start_time is None
        assert network.topology is not None
        assert isinstance(network.message_handlers, dict)
        assert isinstance(network.agent_handlers, dict)
    
    @pytest.mark.asyncio
    async def test_network_lifecycle(self, network):
        """Test network initialization and shutdown."""
        # Mock the topology methods
        network.topology.initialize = AsyncMock(return_value=True)
        network.topology.shutdown = AsyncMock(return_value=True)
        
        # Test initialization
        result = await network.initialize()
        assert result is True
        assert network.is_running is True
        assert network.start_time is not None
        network.topology.initialize.assert_called_once()
        
        # Test shutdown
        result = await network.shutdown()
        assert result is True
        assert network.is_running is False
        network.topology.shutdown.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_agent_registration(self, network):
        """Test agent registration."""
        # Mock the topology register_agent method
        network.topology.register_agent = AsyncMock(return_value=True)
        
        agent_id = "test_agent"
        metadata = {
            "name": "Test Agent",
            "capabilities": ["chat", "search"],
            "version": "1.0.0"
        }
        
        result = await network.register_agent(agent_id, metadata)
        assert result is True
        network.topology.register_agent.assert_called_once()
        
        # Verify the AgentInfo was created correctly
        call_args = network.topology.register_agent.call_args[0][0]
        assert isinstance(call_args, AgentInfo)
        assert call_args.agent_id == agent_id
        assert call_args.capabilities == ["chat", "search"]
    
    @pytest.mark.asyncio
    async def test_agent_unregistration(self, network):
        """Test agent unregistration."""
        # Mock the topology unregister_agent method
        network.topology.unregister_agent = AsyncMock(return_value=True)
        
        agent_id = "test_agent"
        result = await network.unregister_agent(agent_id)
        assert result is True
        network.topology.unregister_agent.assert_called_once_with(agent_id)
    
    @pytest.mark.asyncio
    async def test_message_sending(self, network):
        """Test message sending through the network."""
        # Mock the topology route_message method
        network.topology.route_message = AsyncMock(return_value=True)
        
        message = DirectMessage(
            sender_id="agent1",
            target_agent_id="agent2",
            content={"text": "Hello, agent2!"}
        )
        
        result = await network.send_message(message)
        assert result is True
        network.topology.route_message.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_agent_discovery(self, network):
        """Test agent discovery."""
        # Mock the topology discover_peers method
        mock_agents = [
            AgentInfo(
                agent_id="agent1",
                metadata={"name": "Agent 1"},
                capabilities=["chat"],
                transport_type=TransportType.WEBSOCKET,
                address="127.0.0.1:8765"
            ),
            AgentInfo(
                agent_id="agent2", 
                metadata={"name": "Agent 2"},
                capabilities=["search"],
                transport_type=TransportType.WEBSOCKET,
                address="127.0.0.1:8766"
            )
        ]
        network.topology.discover_peers = AsyncMock(return_value=mock_agents)
        
        # Test discovery without capability filter
        agents = await network.discover_agents()
        assert len(agents) == 2
        assert agents[0].agent_id == "agent1"
        
        # Test discovery with capability filter
        agents = await network.discover_agents(["chat"])
        network.topology.discover_peers.assert_called_with(["chat"])
    
    def test_get_agents(self, network):
        """Test getting all agents."""
        # Mock the topology get_agents method
        mock_agents = {
            "agent1": AgentInfo(
                agent_id="agent1",
                metadata={"name": "Agent 1"},
                capabilities=["chat"],
                transport_type=TransportType.WEBSOCKET,
                address="127.0.0.1:8765"
            )
        }
        network.topology.get_agents = MagicMock(return_value=mock_agents)
        
        agents = network.get_agents()
        assert len(agents) == 1
        assert "agent1" in agents
        assert agents["agent1"].agent_id == "agent1"
    
    def test_get_agent(self, network):
        """Test getting a specific agent."""
        # Mock the topology get_agent method
        mock_agent = AgentInfo(
            agent_id="agent1",
            metadata={"name": "Agent 1"},
            capabilities=["chat"],
            transport_type=TransportType.WEBSOCKET,
            address="127.0.0.1:8765"
        )
        network.topology.get_agent = MagicMock(return_value=mock_agent)
        
        agent = network.get_agent("agent1")
        assert agent is not None
        assert agent.agent_id == "agent1"
        
        # Test non-existent agent
        network.topology.get_agent = MagicMock(return_value=None)
        agent = network.get_agent("nonexistent")
        assert agent is None
    
    def test_message_handler_registration(self, network):
        """Test message handler registration."""
        handler = AsyncMock()
        message_type = "test_message"
        
        network.register_message_handler(message_type, handler)
        assert message_type in network.message_handlers
        assert handler in network.message_handlers[message_type]
    
    def test_agent_handler_registration(self, network):
        """Test agent handler registration."""
        handler = AsyncMock()
        
        network.register_agent_handler(handler)
        assert "agent_registration" in network.agent_handlers
        assert handler in network.agent_handlers["agent_registration"]
    
    def test_network_stats(self, network):
        """Test network statistics generation."""
        # Mock the get_agents method
        mock_agents = {
            "agent1": AgentInfo(
                agent_id="agent1",
                metadata={"name": "Agent 1"},
                capabilities=["chat"],
                transport_type=TransportType.WEBSOCKET,
                address="127.0.0.1:8765",
                last_seen=time.time()
            )
        }
        network.topology.get_agents = MagicMock(return_value=mock_agents)
        network.is_running = True
        network.start_time = time.time() - 10  # 10 seconds ago
        
        stats = network.get_network_stats()
        assert stats["network_name"] == "TestNetwork"
        assert stats["is_running"] is True
        assert stats["agent_count"] == 1
        assert "agent1" in stats["agents"]
        assert stats["uptime_seconds"] >= 9  # Should be around 10 seconds


class TestNetworkFactory:
    """Test network creation functions."""
    
    def test_create_network(self):
        """Test create_network factory function."""
        config = NetworkConfig(
            name="FactoryTestNetwork",
            mode=NetworkMode.CENTRALIZED,
            transport=TransportType.WEBSOCKET
        )
        
        network = create_network(config)
        assert isinstance(network, AgentNetwork)
        assert network.network_name == "FactoryTestNetwork"
        assert network.config == config


class TestBackwardCompatibility:
    """Test backward compatibility features."""
    
    def test_legacy_aliases(self):
        """Test that legacy aliases still work."""
        from openagents.core.network import AgentNetworkServer, EnhancedAgentNetwork, create_enhanced_network
        
        # Test aliases point to the correct classes/functions
        assert AgentNetworkServer is AgentNetwork
        assert EnhancedAgentNetwork is AgentNetwork
        assert create_enhanced_network is create_network


class TestErrorHandling:
    """Test error handling scenarios."""
    
    @pytest.mark.asyncio
    async def test_initialization_failure(self):
        """Test handling of initialization failures."""
        config = NetworkConfig(
            name="FailNetwork",
            mode=NetworkMode.CENTRALIZED,
            transport=TransportType.WEBSOCKET
        )
        network = AgentNetwork(config)
        
        # Mock topology initialization to fail
        network.topology.initialize = AsyncMock(return_value=False)
        
        result = await network.initialize()
        assert result is False
        assert network.is_running is False
    
    @pytest.mark.asyncio
    async def test_registration_failure(self):
        """Test handling of agent registration failures."""
        config = NetworkConfig(
            name="FailNetwork",
            mode=NetworkMode.CENTRALIZED,
            transport=TransportType.WEBSOCKET
        )
        network = AgentNetwork(config)
        
        # Mock topology registration to fail
        network.topology.register_agent = AsyncMock(return_value=False)
        
        result = await network.register_agent("agent1", {"name": "Agent 1"})
        assert result is False
    
    @pytest.mark.asyncio
    async def test_message_sending_failure(self):
        """Test handling of message sending failures."""
        config = NetworkConfig(
            name="FailNetwork",
            mode=NetworkMode.CENTRALIZED,
            transport=TransportType.WEBSOCKET
        )
        network = AgentNetwork(config)
        
        # Mock topology route_message to fail
        network.topology.route_message = AsyncMock(return_value=False)
        
        message = DirectMessage(
            sender_id="agent1",
            target_agent_id="agent2",
            content={"text": "Hello!"}
        )
        
        result = await network.send_message(message)
        assert result is False


if __name__ == "__main__":
    pytest.main([__file__]) 