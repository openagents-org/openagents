"""
Tests for the agent_discovery protocol in OpenAgents.

This module contains tests for the agent discovery protocol functionality,
including capability announcement and agent discovery.
"""

import asyncio
import pytest
import logging
from typing import Dict, Any, List
import random

from src.openagents.core.client import AgentClient
from src.openagents.core.network import AgentNetworkServer
from src.openagents.protocols.discovery.agent_discovery.adapter import AgentDiscoveryAdapter
from src.openagents.protocols.discovery.agent_discovery.protocol import AgentDiscoveryProtocol
from src.openagents.models.messages import ProtocolMessage

# Configure logging for tests
logger = logging.getLogger(__name__)


class TestAgentDiscovery:
    """Test cases for the agent discovery protocol."""

    @pytest.fixture(autouse=True)
    async def setup_and_teardown(self):
        """Set up and tear down the test environment."""
        # Initialize test data
        self.host = "127.0.0.1"
        self.port = 8765  # Use the same port for server and client
        self.network = None
        self.agents = {}
        self.discovery_adapters = {}
        self.discovery_results = []
        
        # Setup is done, yield control back to the test
        yield
        
        # Clean up after the test
        await self.cleanup()

    async def cleanup(self):
        """Clean up test resources."""
        logger.info("Cleaning up test resources")
        
        # Disconnect all agents
        for agent_id, agent in self.agents.items():
            try:
                await agent.disconnect()
            except Exception as e:
                logger.error(f"Error disconnecting agent {agent_id}: {e}")
        
        # Stop the network
        if self.network:
            try:
                self.network.stop()
            except Exception as e:
                logger.error(f"Error stopping network: {e}")
        
        # Force garbage collection to clean up resources
        gc = __import__('gc')
        gc.collect()

    async def setup_network(self):
        """Set up the network for testing."""
        logger.info("Setting up network")
        
        # Use a random port to avoid conflicts
        self.port = random.randint(8766, 8999)
        
        self.network = AgentNetworkServer("TestNetwork", host=self.host, port=self.port)
        
        # Register agent discovery protocol by name
        self.network.register_protocol("openagents.protocols.discovery.agent_discovery")
        
        # Start the network (not awaiting since it's not an async method)
        self.network.start()
        
        # Give the network a moment to start up
        await asyncio.sleep(0.5)

    async def setup_provider_agent(self, agent_id: str, capabilities: Dict[str, Any]):
        """Set up a provider agent with capabilities.
        
        Args:
            agent_id: ID for the agent
            capabilities: Capabilities to announce
        """
        logger.info(f"Setting up provider agent {agent_id}")
        
        # Create agent client
        agent = AgentClient(agent_id)
        
        # Add agent discovery adapter
        discovery_adapter = AgentDiscoveryAdapter()
        agent.register_protocol_adapter(discovery_adapter)
        
        # Create metadata for the agent
        metadata = {
            "name": f"Provider Agent {agent_id}",
            "type": "provider",
            "capabilities": capabilities
        }
        
        # Connect to network with metadata
        await agent.connect_to_server(self.host, self.port, metadata)
        
        # Set capabilities
        await discovery_adapter.set_capabilities(capabilities)
        
        # Store agent and adapter for later use
        self.agents[agent_id] = agent
        self.discovery_adapters[agent_id] = discovery_adapter
        
        # Wait a bit for capabilities to be announced
        await asyncio.sleep(0.5)
        
        return agent, discovery_adapter

    async def setup_consumer_agent(self, agent_id: str):
        """Set up a consumer agent for discovering other agents.
        
        Args:
            agent_id: ID for the agent
        """
        logger.info(f"Setting up consumer agent {agent_id}")
        
        # Create agent client
        agent = AgentClient(agent_id)
        
        # Add agent discovery adapter
        discovery_adapter = AgentDiscoveryAdapter()
        agent.register_protocol_adapter(discovery_adapter)
        
        # Create metadata for the agent
        metadata = {
            "name": f"Consumer Agent {agent_id}",
            "type": "consumer"
        }
        
        # Connect to network with metadata
        await agent.connect_to_server(self.host, self.port, metadata)
        logger.info(f"Consumer agent {agent_id} connected")
        
        # Store consumer agent and adapter
        self.agents[agent_id] = agent
        self.discovery_adapters[agent_id] = discovery_adapter
        
        # Wait a bit for connection to establish
        await asyncio.sleep(0.5)
        
        return agent, discovery_adapter

    @pytest.mark.asyncio
    async def test_capability_announcement(self):
        """Test that agents can announce their capabilities."""
        # Set up network
        await self.setup_network()
        
        # Set up provider agent
        agent_id = "test_provider_1"
        capabilities = {
            "type": "service",
            "service_type": "text_generation",
            "language_models": ["gpt-4", "claude-3"],
            "max_tokens": 8192,
            "supports_streaming": True
        }
        
        await self.setup_provider_agent(agent_id, capabilities)
        
        # Get the network state to verify capabilities were announced
        protocol = self.network.protocols["openagents.protocols.discovery.agent_discovery"]
        state = protocol.get_state()
        
        # Assert that the agent's capabilities are in the network state
        assert agent_id in state["agent_capabilities"]
        assert state["agent_capabilities"][agent_id] == capabilities

    @pytest.mark.asyncio
    async def test_capability_discovery_exact_match(self):
        """Test that agents can discover other agents with exact capability matches."""
        # Set up network
        await self.setup_network()
        
        # Set up provider agents with different capabilities
        provider_capabilities = [
            {
                "type": "service",
                "service_type": "text_generation",
                "language_models": ["gpt-4", "claude-3"],
                "max_tokens": 8192,
                "supports_streaming": True
            },
            {
                "type": "service",
                "service_type": "image_generation",
                "models": ["dall-e-3", "stable-diffusion"],
                "max_resolution": "1024x1024",
                "supports_streaming": False
            },
            {
                "type": "service",
                "service_type": "text_generation",
                "language_models": ["llama-3"],
                "max_tokens": 4096,
                "supports_streaming": False
            }
        ]
        
        for i, capabilities in enumerate(provider_capabilities):
            await self.setup_provider_agent(f"provider_{i}", capabilities)
        
        # Set up consumer agent
        await self.setup_consumer_agent("consumer_agent")
        
        # Discover agents with exact capability match
        query = {
            "type": "service",
            "service_type": "image_generation"
        }
        
        results = await self.discovery_adapters["consumer_agent"].discover_agents(query)
        
        # Assert that only the matching agent is found
        assert len(results) == 1
        assert results[0]["agent_id"] == "provider_1"
        
    @pytest.mark.asyncio
    async def test_capability_discovery_partial_match(self):
        """Test that agents can discover other agents with partial capability matches."""
        # Set up network
        await self.setup_network()
        
        # Set up provider agents with different capabilities
        provider_capabilities = [
            {
                "type": "service",
                "service_type": "text_generation",
                "language_models": ["gpt-4", "claude-3"],
                "max_tokens": 8192,
                "supports_streaming": True
            },
            {
                "type": "service",
                "service_type": "image_generation",
                "models": ["dall-e-3", "stable-diffusion"],
                "max_resolution": "1024x1024",
                "supports_streaming": False
            },
            {
                "type": "service",
                "service_type": "text_generation",
                "language_models": ["llama-3"],
                "max_tokens": 4096,
                "supports_streaming": False
            }
        ]
        
        for i, capabilities in enumerate(provider_capabilities):
            await self.setup_provider_agent(f"provider_{i}", capabilities)
        
        # Set up consumer agent
        await self.setup_consumer_agent("consumer_agent")
        
        # Discover agents with partial capability match
        query = {
            "type": "service",
            "service_type": "text_generation"
        }
        
        results = await self.discovery_adapters["consumer_agent"].discover_agents(query)
        
        # Assert that both text generation agents are found
        assert len(results) == 2
        agent_ids = [result["agent_id"] for result in results]
        assert "provider_0" in agent_ids
        assert "provider_2" in agent_ids

    @pytest.mark.asyncio
    async def test_capability_update(self):
        """Test that agents can update their capabilities."""
        # Set up network
        await self.setup_network()
        
        # Set up provider agent
        agent_id = "test_provider_update"
        initial_capabilities = {
            "type": "service",
            "service_type": "text_generation",
            "language_models": ["gpt-4"],
            "max_tokens": 4096,
            "supports_streaming": False
        }
        
        _, discovery_adapter = await self.setup_provider_agent(agent_id, initial_capabilities)
        
        # Get the network state to verify initial capabilities
        protocol = self.network.protocols["openagents.protocols.discovery.agent_discovery"]
        initial_state = protocol.get_state()
        print(f"Initial state: {initial_state}")
        
        # Update capabilities
        updated_capabilities = {
            "type": "service",
            "service_type": "text_generation",
            "language_models": ["gpt-4", "claude-3"],
            "max_tokens": 8192,
            "supports_streaming": True
        }
        
        print(f"Updating capabilities to: {updated_capabilities}")
        await discovery_adapter.update_capabilities(updated_capabilities)
        
        # Wait a bit for capabilities to be updated
        await asyncio.sleep(0.5)
        
        # Get the network state to verify capabilities were updated
        protocol = self.network.protocols["openagents.protocols.discovery.agent_discovery"]
        state = protocol.get_state()
        print(f"Updated state: {state}")
        
        # Assert that the agent's capabilities are updated in the network state
        assert agent_id in state["agent_capabilities"]
        
        # Check that the updated fields are present
        for key, value in updated_capabilities.items():
            print(f"Checking key: {key}, expected: {value}, actual: {state['agent_capabilities'][agent_id][key]}")
            assert state["agent_capabilities"][agent_id][key] == value

    @pytest.mark.asyncio
    async def test_agent_unregistration(self):
        """Test that agent capabilities are removed when an agent unregisters."""
        # Set up network
        await self.setup_network()
        
        # Set up provider agent
        agent_id = "test_provider_unregister"
        capabilities = {
            "type": "service",
            "service_type": "text_generation",
            "language_models": ["gpt-4"],
            "max_tokens": 4096
        }
        
        agent, _ = await self.setup_provider_agent(agent_id, capabilities)
        
        # Verify agent capabilities are in the network state
        protocol = self.network.protocols["openagents.protocols.discovery.agent_discovery"]
        state = protocol.get_state()
        assert agent_id in state["agent_capabilities"]
        
        # Disconnect the agent
        await agent.disconnect()
        
        # Wait a bit for unregistration to complete
        await asyncio.sleep(0.5)
        
        # Verify agent capabilities are removed from the network state
        state = protocol.get_state()
        assert agent_id not in state["agent_capabilities"]

    @pytest.mark.asyncio
    async def test_nested_capability_matching(self):
        """Test that agents can discover other agents with nested capability matches."""
        # Set up network
        await self.setup_network()
        
        # Set up provider agent with nested capabilities
        agent_id = "test_provider_nested"
        capabilities = {
            "type": "service",
            "service_type": "text_generation",
            "models": {
                "gpt-4": {
                    "version": "turbo",
                    "max_tokens": 8192
                },
                "claude-3": {
                    "version": "opus",
                    "max_tokens": 100000
                }
            },
            "supports_streaming": True
        }
        
        await self.setup_provider_agent(agent_id, capabilities)
        
        # Set up consumer agent
        await self.setup_consumer_agent("consumer_agent")
        
        # Discover agents with nested capability match
        query = {
            "type": "service",
            "models": {
                "claude-3": {
                    "version": "opus"
                }
            }
        }
        
        results = await self.discovery_adapters["consumer_agent"].discover_agents(query)
        
        # Assert that the agent is found
        assert len(results) == 1
        assert results[0]["agent_id"] == agent_id
        assert results[0]["capabilities"] == capabilities 