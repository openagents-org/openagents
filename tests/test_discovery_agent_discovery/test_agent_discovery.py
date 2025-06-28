"""
Tests for the agent_discovery protocol in OpenAgents.

This module contains simplified tests for agent discovery functionality
using the new AgentNetwork architecture.
"""

import asyncio
import pytest
import logging
from typing import Dict, Any, List
import random

from src.openagents.core.network import AgentNetwork, create_network
from src.openagents.models.network_config import NetworkConfig, NetworkMode

# Configure logging for tests
logger = logging.getLogger(__name__)


class TestAgentDiscovery:
    """Test cases for agent discovery using the new network architecture."""

    @pytest.fixture(autouse=True)
    async def setup_and_teardown(self):
        """Set up and tear down the test environment."""
        # Initialize test data
        self.host = "127.0.0.1"
        self.port = 8765
        self.network = None
        
        # Setup is done, yield control back to the test
        yield
        
        # Clean up after the test
        await self.cleanup()

    async def cleanup(self):
        """Clean up test resources."""
        logger.info("Cleaning up test resources")
        
        # Stop the network
        if self.network:
            try:
                await self.network.shutdown()
            except Exception as e:
                logger.error(f"Error stopping network: {e}")

    async def setup_network(self):
        """Set up the network for testing."""
        logger.info("Setting up network")
        
        # Use a random port to avoid conflicts
        self.port = random.randint(8766, 8999)
        
        # Create network configuration
        config = NetworkConfig(
            name="TestNetwork",
            mode=NetworkMode.CENTRALIZED,
            host=self.host,
            port=self.port,
            server_mode=True
        )
        
        # Create the network
        self.network = create_network(config)
        
        # Initialize the network
        success = await self.network.initialize()
        if not success:
            raise RuntimeError("Failed to initialize network")
        
        logger.info(f"Network initialized on {self.host}:{self.port}")
        
        # Give the network a moment to start up
        await asyncio.sleep(0.5)

    @pytest.mark.asyncio
    async def test_capability_announcement(self):
        """Test that agents can be registered with capabilities."""
        # Set up network
        await self.setup_network()
        
        # Register an agent with capabilities
        agent_id = "test_provider_1"
        capabilities = ["text_generation", "chat", "streaming"]
        metadata = {
            "name": "Provider Agent 1",
            "type": "service",
            "capabilities": capabilities,
            "language_models": ["gpt-4", "claude-3"],
            "max_tokens": 8192,
            "supports_streaming": True
        }
        
        # Register the agent
        success = await self.network.register_agent(agent_id, metadata)
        assert success, "Failed to register agent"
        
        # Verify the agent is registered
        agents = self.network.get_agents()
        assert agent_id in agents
        
        agent_info = agents[agent_id]
        assert agent_info.agent_id == agent_id
        assert agent_info.capabilities == capabilities
        assert agent_info.metadata["name"] == "Provider Agent 1"

    @pytest.mark.asyncio
    async def test_capability_discovery_exact_match(self):
        """Test that agents can be discovered by capabilities."""
        # Set up network
        await self.setup_network()
        
        # Register multiple agents with different capabilities
        agents_data = [
            {
                "agent_id": "text_agent",
                "capabilities": ["text_generation", "chat"],
                "metadata": {"name": "Text Agent", "service_type": "text_generation"}
            },
            {
                "agent_id": "image_agent", 
                "capabilities": ["image_generation", "art"],
                "metadata": {"name": "Image Agent", "service_type": "image_generation"}
            },
            {
                "agent_id": "multi_agent",
                "capabilities": ["text_generation", "image_generation", "chat"],
                "metadata": {"name": "Multi Agent", "service_type": "multi_modal"}
            }
        ]
        
        # Register all agents
        for agent_data in agents_data:
            metadata = agent_data["metadata"].copy()
            metadata["capabilities"] = agent_data["capabilities"]
            success = await self.network.register_agent(agent_data["agent_id"], metadata)
            assert success, f"Failed to register {agent_data['agent_id']}"
        
        # Discover agents with specific capabilities
        text_agents = await self.network.discover_agents(["text_generation"])
        assert len(text_agents) == 2  # text_agent and multi_agent
        
        text_agent_ids = [agent.agent_id for agent in text_agents]
        assert "text_agent" in text_agent_ids
        assert "multi_agent" in text_agent_ids
        
        # Discover agents with image capabilities
        image_agents = await self.network.discover_agents(["image_generation"])
        assert len(image_agents) == 2  # image_agent and multi_agent
        
        image_agent_ids = [agent.agent_id for agent in image_agents]
        assert "image_agent" in image_agent_ids
        assert "multi_agent" in image_agent_ids

    @pytest.mark.asyncio
    async def test_capability_discovery_partial_match(self):
        """Test that agents can be discovered with multiple capability requirements."""
        # Set up network
        await self.setup_network()
        
        # Register agents with overlapping capabilities
        agents_data = [
            {
                "agent_id": "basic_text",
                "capabilities": ["text_generation"],
                "metadata": {"name": "Basic Text Agent"}
            },
            {
                "agent_id": "chat_text",
                "capabilities": ["text_generation", "chat"],
                "metadata": {"name": "Chat Text Agent"}
            },
            {
                "agent_id": "streaming_chat",
                "capabilities": ["text_generation", "chat", "streaming"],
                "metadata": {"name": "Streaming Chat Agent"}
            }
        ]
        
        # Register all agents
        for agent_data in agents_data:
            metadata = agent_data["metadata"].copy()
            metadata["capabilities"] = agent_data["capabilities"]
            success = await self.network.register_agent(agent_data["agent_id"], metadata)
            assert success, f"Failed to register {agent_data['agent_id']}"
        
        # Discover agents that support both text_generation and chat
        chat_capable = await self.network.discover_agents(["text_generation", "chat"])
        assert len(chat_capable) == 2  # chat_text and streaming_chat
        
        chat_agent_ids = [agent.agent_id for agent in chat_capable]
        assert "chat_text" in chat_agent_ids
        assert "streaming_chat" in chat_agent_ids
        assert "basic_text" not in chat_agent_ids

    @pytest.mark.asyncio
    async def test_agent_unregistration(self):
        """Test that agents are properly removed when unregistered."""
        # Set up network
        await self.setup_network()
        
        # Register an agent
        agent_id = "test_unregister"
        metadata = {
            "name": "Test Unregister Agent",
            "capabilities": ["test_capability"]
        }
        
        success = await self.network.register_agent(agent_id, metadata)
        assert success, "Failed to register agent"
        
        # Verify agent is registered
        agents = self.network.get_agents()
        assert agent_id in agents
        
        # Unregister the agent
        success = await self.network.unregister_agent(agent_id)
        assert success, "Failed to unregister agent"
        
        # Verify agent is removed
        agents = self.network.get_agents()
        assert agent_id not in agents
        
        # Verify agent is not discovered
        discovered = await self.network.discover_agents(["test_capability"])
        discovered_ids = [agent.agent_id for agent in discovered]
        assert agent_id not in discovered_ids

    @pytest.mark.asyncio
    async def test_get_specific_agent(self):
        """Test getting a specific agent by ID."""
        # Set up network
        await self.setup_network()
        
        # Register an agent
        agent_id = "specific_agent"
        metadata = {
            "name": "Specific Test Agent",
            "capabilities": ["specific_capability"],
            "version": "1.0.0"
        }
        
        success = await self.network.register_agent(agent_id, metadata)
        assert success, "Failed to register agent"
        
        # Get the specific agent
        agent_info = self.network.get_agent(agent_id)
        assert agent_info is not None
        assert agent_info.agent_id == agent_id
        assert agent_info.metadata["name"] == "Specific Test Agent"
        assert agent_info.metadata["version"] == "1.0.0"
        
        # Try to get a non-existent agent
        non_existent = self.network.get_agent("non_existent_agent")
        assert non_existent is None 