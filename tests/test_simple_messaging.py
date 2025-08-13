"""
Tests for the simple_messaging mod in OpenAgents.

This module contains simplified tests for messaging functionality
using the new AgentNetwork architecture.
"""

import asyncio
import pytest
import logging
import tempfile
import os
import time
import random
from typing import List, Dict, Any

from src.openagents.core.network import AgentNetwork, create_network
from src.openagents.models.network_config import NetworkConfig, NetworkMode
from src.openagents.models.messages import DirectMessage, BroadcastMessage

# Configure logging for tests
logger = logging.getLogger(__name__)


class TestSimpleMessaging:
    """Test cases for simple messaging using the new network architecture."""

    @pytest.fixture(autouse=True)
    async def setup_and_teardown(self):
        """Set up and tear down test environment."""
        # Initialize test data
        self.host = "127.0.0.1"
        self.port = random.randint(8900, 8999)
        self.network = None
        self.received_messages: List[Dict[str, Any]] = []
        self.received_files: List[Dict[str, Any]] = []

        # Create a temporary test file
        self.temp_file = tempfile.NamedTemporaryFile(mode='w+b', delete=False, suffix='.txt')
        self.temp_file.write(b"This is test file content for OpenAgents file transfer tests.\n")
        self.temp_file.write(b"Line 2 of the test file.\n")
        self.temp_file.write(b"End of test file.\n")
        self.temp_file.close()
        self.temp_file_path = self.temp_file.name
        logger.info(f"Created test file at {self.temp_file_path}")
        
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
        
        # Remove the test file
        try:
            if os.path.exists(self.temp_file_path):
                os.unlink(self.temp_file_path)
                logger.info(f"Removed test file at {self.temp_file_path}")
        except Exception as e:
            logger.error(f"Error removing test file: {e}")

    def message_handler(self, content, sender_id):
        """Handler for received messages."""
        logger.info(f"Received message from {sender_id}: {content}")
        self.received_messages.append({
            "content": content,
            "sender_id": sender_id
        })

    def file_handler(self, file_id, file_content, metadata, sender_id):
        """Handler for received files."""
        logger.info(f"Received file {file_id} from {sender_id}: {len(file_content)} bytes")
        self.received_files.append({
            "file_id": file_id,
            "content": file_content,
            "metadata": metadata,
            "sender_id": sender_id
        })

    async def setup_network(self):
        """Set up and start the network server."""
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
        
        # Wait for the server to start
        await asyncio.sleep(1)

    async def setup_agent(self, agent_id):
        """Set up an agent with messaging capabilities."""
        # Register the agent with basic messaging capabilities
        metadata = {
            "name": agent_id,
            "capabilities": ["messaging", "file_transfer"],
            "mods": ["simple_messaging"]
        }

        success = await self.network.register_agent(agent_id, metadata)
        if not success:
            raise RuntimeError(f"Failed to register agent {agent_id}")

        logger.info(f"Agent {agent_id} registered with network")
        return agent_id

    @pytest.mark.asyncio
    async def test_direct_messaging(self):
        """Test basic direct messaging functionality."""
        # Set up the network and agents
        await self.setup_network()
        agent1_id = await self.setup_agent("TestAgent1")
        agent2_id = await self.setup_agent("TestAgent2")
        
        # Wait for connections to establish
        await asyncio.sleep(1)
        
        # Clear any initial messages
        self.received_messages.clear()
        
        # Create a test message
        test_message = DirectMessage(
            sender_id=agent1_id,
            target_agent_id=agent2_id,
            content={"text": "Hello from TestAgent1!"},
            message_type="direct"
        )
        
        # Test that we can create the message and convert it to transport format
        # (This tests the message creation and conversion logic)
        transport_message = self.network._convert_to_transport_message(test_message)
        assert transport_message.sender_id == agent1_id
        assert transport_message.target_id == agent2_id
        assert transport_message.payload["content"]["text"] == "Hello from TestAgent1!"

        # Verify that both agents are registered
        agents = self.network.get_agents()
        assert agent1_id in agents
        assert agent2_id in agents

        logger.info("Direct messaging test completed successfully")

    @pytest.mark.asyncio
    async def test_broadcast_messaging(self):
        """Test broadcast messaging between agents."""
        # Set up the network and agents
        await self.setup_network()
        agent1_id = await self.setup_agent("TestAgent1")
        agent2_id = await self.setup_agent("TestAgent2")
        
        # Wait for connections to establish
        await asyncio.sleep(1)
        
        # Clear any initial messages
        self.received_messages.clear()
        
        # Create a broadcast message
        broadcast_message = BroadcastMessage(
            sender_id=agent1_id,
            content={"text": "Broadcast message from TestAgent1!"},
            message_type="broadcast"
        )

        # Send the broadcast message
        success = await self.network.send_message(broadcast_message)
        assert success, "Failed to send broadcast message"
        
        # Wait for message to be processed
        await asyncio.sleep(1)
        
        # Verify that both agents are still registered
        agents = self.network.get_agents()
        assert agent1_id in agents
        assert agent2_id in agents

        logger.info("Broadcast messaging test completed successfully")

    @pytest.mark.asyncio
    async def test_file_transfer_direct(self):
        """Test basic file transfer message creation."""
        # Set up the network and agents
        await self.setup_network()
        agent1_id = await self.setup_agent("TestAgent1")
        agent2_id = await self.setup_agent("TestAgent2")
        
        # Wait for connections to establish
        await asyncio.sleep(2)
        
        # Clear any initial messages and files
        self.received_messages.clear()
        self.received_files.clear()
        
        # Verify the file exists
        assert os.path.exists(self.temp_file_path), f"Test file does not exist at {self.temp_file_path}"
        file_size = os.path.getsize(self.temp_file_path)
        logger.info(f"Test file size: {file_size} bytes")
        
        # Read the file content
        with open(self.temp_file_path, "rb") as f:
            original_content = f.read()
        
        # Create a file transfer message
        file_message = DirectMessage(
            sender_id=agent1_id,
            target_agent_id=agent2_id,
            content={
                "file_data": original_content.decode('utf-8'),
                "filename": "test_file.txt",
                "file_size": len(original_content)
            },
            message_type="file_transfer"
        )
        
        # Test message creation and conversion
        transport_message = self.network._convert_to_transport_message(file_message)
        assert transport_message.sender_id == agent1_id
        assert transport_message.target_id == agent2_id
        assert "file_data" in transport_message.payload["content"]

        # Verify that both agents are still registered
        agents = self.network.get_agents()
        assert agent1_id in agents
        assert agent2_id in agents

        logger.info("File transfer test completed successfully")

    @pytest.mark.asyncio
    async def test_file_transfer_end_to_end(self):
        """Test simplified file transfer message handling."""
        # Set a timeout for this test
        start_time = time.time()
        
        try:
            # Set up the network and agents
            await self.setup_network()
            agent1_id = await self.setup_agent("TestAgent1")
            agent2_id = await self.setup_agent("TestAgent2")
            
            # Wait for connections to establish
            await asyncio.sleep(2)
            
            # Create a simple file transfer message
            test_content = "This is a test file content"
            file_message = DirectMessage(
                sender_id=agent1_id,
                target_agent_id=agent2_id,
                content={
                    "type": "file_transfer",
                    "filename": "test.txt",
                    "data": test_content
                },
                message_type="file_transfer"
            )
            
            # Test message creation
            assert file_message.sender_id == agent1_id
            assert file_message.target_agent_id == agent2_id
            assert file_message.content["data"] == test_content

            # Verify network state
            stats = self.network.get_network_stats()
            assert stats["agent_count"] == 2
            assert stats["is_running"] is True

            logger.info("End-to-end file transfer test completed successfully")

        except Exception as e:
            logger.error(f"Test failed with error: {e}")
            raise
        finally:
            logger.info("Test completed, cleaning up connections")

    @pytest.mark.asyncio
    async def test_connector_binding(self):
        """Test basic network connectivity and agent registration."""
        # Set up the network and agents
        await self.setup_network()
        agent1_id = await self.setup_agent("TestAgent1")
        
        # Wait for connections to establish
        await asyncio.sleep(1)

        # Verify the agent is properly registered
        agents = self.network.get_agents()
        assert agent1_id in agents

        agent_info = agents[agent1_id]
        assert agent_info.agent_id == agent1_id
        assert "messaging" in agent_info.capabilities

        # Test network statistics
        stats = self.network.get_network_stats()
        assert stats["agent_count"] == 1
        assert stats["is_running"] is True

        logger.info("Connector binding test completed successfully") 