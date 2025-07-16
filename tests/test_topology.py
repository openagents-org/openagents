"""
Unit tests for the topology layer.

This module contains tests for network topology abstractions and implementations:
- NetworkTopology base class
- CentralizedTopology implementation  
- DecentralizedTopology implementation
- Agent registration and discovery
- Message routing
"""

import pytest
import asyncio
import sys
import os
import time
from unittest.mock import AsyncMock, MagicMock

# Add the src directory to the Python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../src')))

from openagents.core.topology import CentralizedTopology, DecentralizedTopology, NetworkMode, create_topology
from openagents.models.transport import TransportType, AgentInfo


class TestTopologyCreation:
    """Test topology creation and basic functionality."""
    
    def test_create_centralized_topology(self):
        """Test creating centralized topology."""
        config = {
            "transport": TransportType.WEBSOCKET,
            "host": "127.0.0.1",
            "port": 8765,
            "server_mode": True
        }
        
        topology = create_topology(NetworkMode.CENTRALIZED, "test-net", config)
        assert isinstance(topology, CentralizedTopology)
        # Test the attributes that actually exist
        assert topology.node_id == "test-net"
        assert isinstance(topology.agents, dict)
        assert topology.server_mode is True
    
    def test_create_decentralized_topology(self):
        """Test creating decentralized topology."""
        config = {
            "transport": TransportType.WEBSOCKET,
            "host": "0.0.0.0",
            "port": 4001,
            "bootstrap_nodes": ["node1"]
        }
        
        topology = create_topology(NetworkMode.DECENTRALIZED, "test-p2p", config)
        assert isinstance(topology, DecentralizedTopology)
        # Test the attributes that actually exist
        assert topology.node_id == "test-p2p"
        assert isinstance(topology.agents, dict)
        assert "node1" in topology.bootstrap_nodes


class TestCentralizedTopology:
    """Test CentralizedTopology functionality."""
    
    @pytest.fixture
    def topology(self):
        """Create a CentralizedTopology instance."""
        config = {
            "transport": TransportType.WEBSOCKET,
            "host": "127.0.0.1",
            "port": 8765,
            "server_mode": True
        }
        return CentralizedTopology("test-network", config)
    
    @pytest.mark.asyncio
    async def test_agent_registration(self, topology):
        """Test agent registration."""
        agent = AgentInfo(
            agent_id="agent1",
            metadata={"name": "Agent 1"},
            capabilities=["chat"],
            transport_type=TransportType.WEBSOCKET,
            address="127.0.0.1:8765"
        )
        
        result = await topology.register_agent(agent)
        assert result is True
        assert "agent1" in topology.agents
    
    @pytest.mark.asyncio
    async def test_agent_discovery(self, topology):
        """Test agent discovery."""
        agent1 = AgentInfo(
            agent_id="agent1",
            metadata={"name": "Agent 1"},
            capabilities=["chat"],
            transport_type=TransportType.WEBSOCKET,
            address="127.0.0.1:8765"
        )
        
        await topology.register_agent(agent1)
        
        # Test discovery
        agents = await topology.discover_peers()
        assert len(agents) == 1
        assert agents[0].agent_id == "agent1"
    
    def test_get_agents(self, topology):
        """Test getting all agents."""
        assert len(topology.get_agents()) == 0
        
        agent = AgentInfo(
            agent_id="agent1",
            metadata={"name": "Agent 1"},
            capabilities=["chat"],
            transport_type=TransportType.WEBSOCKET,
            address="127.0.0.1:8765"
        )
        topology.agents["agent1"] = agent
        
        agents = topology.get_agents()
        assert len(agents) == 1
        assert "agent1" in agents


if __name__ == "__main__":
    pytest.main([__file__])
 