"""
Tests for the openconvert_discovery protocol in OpenAgents.

This module contains tests for OpenConvert discovery functionality
including capability announcement and agent discovery.
"""

import asyncio
import pytest
import logging
import random
from typing import Dict, Any, List

from src.openagents.core.network import AgentNetwork, create_network
from src.openagents.models.network_config import NetworkConfig, NetworkMode
from src.openagents.protocols.discovery.openconvert_discovery.protocol import OpenConvertDiscoveryProtocol
from src.openagents.protocols.discovery.openconvert_discovery.adapter import OpenConvertDiscoveryAdapter
from src.openagents.core.client import AgentClient

# Configure logging for tests
logger = logging.getLogger(__name__)


class TestOpenConvertDiscovery:
    """Test cases for OpenConvert discovery using the new network architecture."""

    @pytest.fixture(autouse=True)
    async def setup_and_teardown(self):
        """Set up and tear down the test environment."""
        # Initialize test data
        self.host = "127.0.0.1"
        self.port = random.randint(9000, 9999)
        self.network = None
        self.clients: List[AgentClient] = []
        
        # Setup is done, yield control back to the test
        yield
        
        # Clean up after the test
        await self.cleanup()

    async def cleanup(self):
        """Clean up test resources."""
        logger.info("Cleaning up test resources")
        
        # Disconnect all clients
        for client in self.clients:
            try:
                await client.disconnect()
            except Exception as e:
                logger.error(f"Error disconnecting client: {e}")
        
        # Stop the network
        if self.network:
            try:
                await self.network.shutdown()
            except Exception as e:
                logger.error(f"Error stopping network: {e}")

    async def setup_network(self):
        """Set up the network for testing."""
        logger.info(f"Setting up network on {self.host}:{self.port}")
        
        # Create network configuration
        config = NetworkConfig(
            name="OpenConvertTestNetwork",
            mode=NetworkMode.CENTRALIZED,
            host=self.host,
            port=self.port,
            server_mode=True,
            encryption_enabled=False  # Disable encryption for testing
        )
        
        # Create the network
        self.network = create_network(config)
        
        # Initialize the network
        success = await self.network.initialize()
        if not success:
            raise RuntimeError("Failed to initialize network")
        
        # Register the OpenConvert discovery protocol with the network
        openconvert_protocol = OpenConvertDiscoveryProtocol(network=self.network)
        self.network.protocols["openagents.protocols.discovery.openconvert_discovery"] = openconvert_protocol
        openconvert_protocol.bind_network(self.network)
        openconvert_protocol.initialize()
        
        # Register a message handler to route protocol messages to the appropriate protocol
        async def route_protocol_message(message) -> None:
            """Route protocol messages to the appropriate protocol."""
            if hasattr(message, 'protocol') and message.protocol in self.network.protocols:
                protocol = self.network.protocols[message.protocol]
                if hasattr(protocol, 'process_protocol_message'):
                    try:
                        await protocol.process_protocol_message(message)
                    except Exception as e:
                        logger.error(f"Error processing protocol message in {message.protocol}: {e}")
        
        self.network.register_message_handler("protocol_message", route_protocol_message)
        
        logger.info(f"Network initialized on {self.host}:{self.port} with OpenConvert protocol")
        
        # Give the network a moment to start up
        await asyncio.sleep(1.0)

    async def create_test_agent(self, agent_id: str, conversion_capabilities: Dict[str, Any]) -> tuple[AgentClient, OpenConvertDiscoveryAdapter]:
        """Create a test agent with OpenConvert discovery capabilities."""
        # Create agent client
        client = AgentClient(agent_id)
        
        # Connect to network
        success = await client.connect_to_server(
            host=self.host,
            port=self.port,
            metadata={
                "name": f"Test Agent {agent_id}",
                "type": "conversion_service",
                "capabilities": ["file_conversion", "openconvert"],
                "version": "1.0.0"
            }
        )
        
        if not success:
            raise RuntimeError(f"Failed to connect agent {agent_id}")
        
        # Register OpenConvert discovery protocol
        discovery_adapter = OpenConvertDiscoveryAdapter()
        client.register_protocol_adapter(discovery_adapter)
        
        # Set conversion capabilities
        await discovery_adapter.set_conversion_capabilities(conversion_capabilities)
        
        # Store client for cleanup
        self.clients.append(client)
        
        logger.info(f"Created test agent {agent_id} with {len(conversion_capabilities.get('conversion_pairs', []))} conversion pairs")
        
        return client, discovery_adapter

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_capability_announcement(self):
        """Test that agents can announce their conversion capabilities."""
        # Set up network
        await self.setup_network()
        
        # Create conversion capabilities
        capabilities = {
            "conversion_pairs": [
                {"from": "text/plain", "to": "text/markdown"},
                {"from": "text/markdown", "to": "text/html"},
                {"from": "application/pdf", "to": "text/plain"}
            ],
            "description": "Test document conversion agent"
        }
        
        # Create and register agent
        client, discovery_adapter = await self.create_test_agent("doc-agent-1", capabilities)
        
        # Wait for capability announcement to propagate
        await asyncio.sleep(2.0)
        
        # Check that the network protocol has registered the capabilities
        openconvert_protocol = None
        if hasattr(self.network, 'protocols') and self.network.protocols:
            for protocol in self.network.protocols.values():
                if isinstance(protocol, OpenConvertDiscoveryProtocol):
                    openconvert_protocol = protocol
                    break
        
        assert openconvert_protocol is not None, "OpenConvert protocol not found in network"
        
        # Get the protocol state
        state = openconvert_protocol.get_state()
        agent_capabilities = state.get("agent_conversion_capabilities", {})
        
        logger.info(f"Network registered capabilities: {agent_capabilities}")
        
        # Verify the agent's capabilities are registered
        assert "doc-agent-1" in agent_capabilities, "Agent capabilities not registered in network"
        
        registered_caps = agent_capabilities["doc-agent-1"]
        assert "conversion_pairs" in registered_caps, "Conversion pairs not found in registered capabilities"
        assert len(registered_caps["conversion_pairs"]) == 3, "Incorrect number of conversion pairs registered"
        assert registered_caps["description"] == "Test document conversion agent", "Description not registered correctly"

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_agent_discovery_single_agent(self):
        """Test discovering a single agent with specific conversion capabilities."""
        # Set up network
        await self.setup_network()
        
        # Create conversion capabilities for doc agent
        doc_capabilities = {
            "conversion_pairs": [
                {"from": "text/plain", "to": "text/markdown"},
                {"from": "text/markdown", "to": "text/html"},
                {"from": "application/pdf", "to": "text/plain"}
            ],
            "description": "Document conversion agent"
        }
        
        # Create doc agent
        doc_client, doc_discovery = await self.create_test_agent("doc-agent", doc_capabilities)
        
        # Wait for capabilities to be announced and registered
        await asyncio.sleep(2.0)
        
        # Create a test client for discovery
        test_client, test_discovery = await self.create_test_agent("test-client", {
            "conversion_pairs": [],
            "description": "Test client for discovery"
        })
        
        # Test discovery for txt -> md conversion
        logger.info("Testing discovery for text/plain -> text/markdown")
        discovered_agents = await test_discovery.discover_conversion_agents(
            "text/plain", 
            "text/markdown"
        )
        
        logger.info(f"Discovered {len(discovered_agents)} agents: {[a['agent_id'] for a in discovered_agents]}")
        
        # Verify discovery results
        assert len(discovered_agents) == 1, f"Expected 1 agent, found {len(discovered_agents)}"
        assert discovered_agents[0]["agent_id"] == "doc-agent", "Wrong agent discovered"
        
        # Verify the agent's capabilities in the result
        agent_caps = discovered_agents[0]["conversion_capabilities"]
        assert "conversion_pairs" in agent_caps, "Conversion pairs not in discovery result"
        assert len(agent_caps["conversion_pairs"]) == 3, "Incorrect number of conversion pairs in result"

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_agent_discovery_multiple_agents(self):
        """Test discovering multiple agents with overlapping capabilities."""
        # Set up network
        await self.setup_network()
        
        # Create different agents with different capabilities
        agents_data = [
            {
                "agent_id": "doc-agent",
                "capabilities": {
                    "conversion_pairs": [
                        {"from": "text/plain", "to": "text/markdown"},
                        {"from": "text/markdown", "to": "text/html"},
                        {"from": "application/pdf", "to": "text/plain"}
                    ],
                    "description": "Document conversion specialist"
                }
            },
            {
                "agent_id": "text-agent", 
                "capabilities": {
                    "conversion_pairs": [
                        {"from": "text/plain", "to": "text/markdown"},
                        {"from": "text/plain", "to": "text/html"},
                        {"from": "text/markdown", "to": "text/plain"}
                    ],
                    "description": "Text format converter"
                }
            },
            {
                "agent_id": "image-agent",
                "capabilities": {
                    "conversion_pairs": [
                        {"from": "image/jpeg", "to": "image/png"},
                        {"from": "image/png", "to": "image/jpeg"},
                        {"from": "image/bmp", "to": "image/png"}
                    ],
                    "description": "Image format converter"
                }
            }
        ]
        
        # Create all agents
        created_agents = []
        for agent_data in agents_data:
            client, discovery = await self.create_test_agent(
                agent_data["agent_id"], 
                agent_data["capabilities"]
            )
            created_agents.append((client, discovery))
        
        # Wait for all capabilities to be announced
        await asyncio.sleep(3.0)
        
        # Create test client for discovery
        test_client, test_discovery = await self.create_test_agent("test-client", {
            "conversion_pairs": [],
            "description": "Test client"
        })
        
        # Test 1: Discover agents that can convert text/plain -> text/markdown
        logger.info("Testing discovery for text/plain -> text/markdown")
        txt_md_agents = await test_discovery.discover_conversion_agents(
            "text/plain", 
            "text/markdown"
        )
        
        # Should find both doc-agent and text-agent
        assert len(txt_md_agents) == 2, f"Expected 2 agents for txt->md, found {len(txt_md_agents)}"
        agent_ids = [agent["agent_id"] for agent in txt_md_agents]
        assert "doc-agent" in agent_ids, "doc-agent not found in txt->md discovery"
        assert "text-agent" in agent_ids, "text-agent not found in txt->md discovery"
        
        # Test 2: Discover agents that can convert image/jpeg -> image/png  
        logger.info("Testing discovery for image/jpeg -> image/png")
        img_agents = await test_discovery.discover_conversion_agents(
            "image/jpeg",
            "image/png"
        )
        
        # Should find only image-agent
        assert len(img_agents) == 1, f"Expected 1 agent for img conversion, found {len(img_agents)}"
        assert img_agents[0]["agent_id"] == "image-agent", "Wrong agent found for image conversion"
        
        # Test 3: Discover agents for non-existent conversion
        logger.info("Testing discovery for non-existent conversion")
        no_agents = await test_discovery.discover_conversion_agents(
            "application/unknown",
            "text/mystery"
        )
        
        # Should find no agents
        assert len(no_agents) == 0, f"Expected 0 agents for unknown conversion, found {len(no_agents)}"

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_agent_discovery_with_description_filter(self):
        """Test discovering agents with description filtering."""
        # Set up network
        await self.setup_network()
        
        # Create agents with different descriptions
        agents_data = [
            {
                "agent_id": "specialist-agent",
                "capabilities": {
                    "conversion_pairs": [
                        {"from": "text/plain", "to": "text/markdown"}
                    ],
                    "description": "Specialized OCR and text processing service"
                }
            },
            {
                "agent_id": "general-agent",
                "capabilities": {
                    "conversion_pairs": [
                        {"from": "text/plain", "to": "text/markdown"}
                    ],
                    "description": "General purpose document converter"
                }
            }
        ]
        
        # Create agents
        for agent_data in agents_data:
            await self.create_test_agent(
                agent_data["agent_id"], 
                agent_data["capabilities"]
            )
        
        # Wait for capabilities to be announced
        await asyncio.sleep(2.0)
        
        # Create test client
        test_client, test_discovery = await self.create_test_agent("test-client", {
            "conversion_pairs": [],
            "description": "Test client"
        })
        
        # Test discovery with description filter
        logger.info("Testing discovery with description filter")
        ocr_agents = await test_discovery.discover_conversion_agents(
            "text/plain",
            "text/markdown",
            description_contains="OCR"
        )
        
        # Should find only the specialist agent
        assert len(ocr_agents) == 1, f"Expected 1 agent with OCR description, found {len(ocr_agents)}"
        assert ocr_agents[0]["agent_id"] == "specialist-agent", "Wrong agent found with description filter"

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_discovery_timeout_handling(self):
        """Test that discovery handles timeouts gracefully."""
        # Set up network
        await self.setup_network()
        
        # Create test client but no conversion agents
        test_client, test_discovery = await self.create_test_agent("test-client", {
            "conversion_pairs": [],
            "description": "Test client"
        })
        
        # Test discovery when no agents exist
        logger.info("Testing discovery timeout with no agents")
        
        start_time = asyncio.get_event_loop().time()
        discovered_agents = await test_discovery.discover_conversion_agents(
            "text/plain", 
            "text/markdown"
        )
        end_time = asyncio.get_event_loop().time()
        
        # Should return empty list and respect timeout
        assert len(discovered_agents) == 0, "Should find no agents when none exist"
        assert end_time - start_time < 20, "Discovery should timeout reasonably quickly"  # Less than default timeout
        
        logger.info(f"Discovery completed in {end_time - start_time:.2f} seconds with no results")

if __name__ == "__main__":
    # Allow running the test directly
    pytest.main([__file__, "-v"]) 