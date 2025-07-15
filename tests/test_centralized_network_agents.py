"""
Test case for centralized network with two agent clients.

This test demonstrates:
1. Creating a centralized network (server)
2. Creating two agent clients that connect to the network
3. Having agents send messages to each other
4. Verifying message delivery works correctly
"""

import asyncio
import pytest
import logging
import time
import random
from typing import Dict, Any, List

from src.openagents.core.network import AgentNetwork, create_network
from src.openagents.models.network_config import NetworkConfig, NetworkMode
from src.openagents.models.transport import TransportType
from src.openagents.models.messages import DirectMessage, BroadcastMessage

# Configure logging for tests
logger = logging.getLogger(__name__)


class TestCentralizedNetworkAgents:
    """Test case for centralized network with agent clients."""

    @pytest.fixture(autouse=True)
    async def setup_and_teardown(self):
        """Set up and tear down test environment."""
        # Test configuration
        self.host = "127.0.0.1"
        self.port = random.randint(9000, 9999)
        
        # Networks (server and clients)
        self.server_network = None
        self.agent1_network = None
        self.agent2_network = None
        
        # Message storage for verification
        self.agent1_received_messages: List[Dict[str, Any]] = []
        self.agent2_received_messages: List[Dict[str, Any]] = []
        
        logger.info(f"Test setup: Using port {self.port}")
        
        yield
        
        # Cleanup
        await self._cleanup_networks()
        logger.info("Test cleanup completed")

    async def _cleanup_networks(self):
        """Clean up all networks."""
        networks = [self.server_network, self.agent1_network, self.agent2_network]
        for network in networks:
            if network and network.is_running:
                try:
                    await network.stop()
                    logger.info(f"Stopped network: {network.network_id}")
                except Exception as e:
                    logger.warning(f"Error stopping network: {e}")

    async def _create_server_network(self) -> AgentNetwork:
        """Create and start the centralized server network."""
        config = NetworkConfig(
            name="CentralizedServer",
            mode=NetworkMode.CENTRALIZED,
            host=self.host,
            port=self.port,
            transport=TransportType.WEBSOCKET,
            server_mode=True,
            node_id="central-server"
        )
        
        network = create_network(config)
        await network.start()
        logger.info(f"Started centralized server on {self.host}:{self.port}")
        return network

    async def _create_agent_network(self, agent_id: str, agent_name: str) -> AgentNetwork:
        """Create and start an agent client network."""
        config = NetworkConfig(
            name=agent_name,
            mode=NetworkMode.CENTRALIZED,
            host=self.host,
            port=self.port,
            transport=TransportType.WEBSOCKET,
            server_mode=False,
            node_id=agent_id,
            coordinator_url=f"ws://{self.host}:{self.port}"
        )
        
        network = create_network(config)
        
        # Set up message handler for this agent
        if agent_id == "agent-1":
            network.add_message_handler("direct", self._agent1_message_handler)
            network.add_message_handler("broadcast", self._agent1_message_handler)
        else:
            network.add_message_handler("direct", self._agent2_message_handler)
            network.add_message_handler("broadcast", self._agent2_message_handler)
        
        await network.start()
        logger.info(f"Started agent client: {agent_name} ({agent_id})")
        return network

    async def _agent1_message_handler(self, message):
        """Message handler for agent 1."""
        logger.info(f"Agent 1 received message: {message}")
        self.agent1_received_messages.append({
            'type': message.message_type,
            'content': message.content,
            'sender': message.sender_id,
            'timestamp': time.time()
        })

    async def _agent2_message_handler(self, message):
        """Message handler for agent 2."""
        logger.info(f"Agent 2 received message: {message}")
        self.agent2_received_messages.append({
            'type': message.message_type,
            'content': message.content,
            'sender': message.sender_id,
            'timestamp': time.time()
        })

    @pytest.mark.asyncio
    async def test_centralized_network_setup(self):
        """Test that we can set up a centralized network with server and clients."""
        # Start the centralized server
        self.server_network = await self._create_server_network()
        assert self.server_network.is_running
        
        # Give server time to start up
        await asyncio.sleep(0.5)
        
        # Start agent clients
        self.agent1_network = await self._create_agent_network("agent-1", "Agent1")
        self.agent2_network = await self._create_agent_network("agent-2", "Agent2")
        
        assert self.agent1_network.is_running
        assert self.agent2_network.is_running
        
        # Give clients time to connect
        await asyncio.sleep(1.0)
        
        logger.info("All networks started successfully")

    @pytest.mark.asyncio
    async def test_direct_message_between_agents(self):
        """Test direct messaging between two agents through centralized server."""
        # Set up the network
        await self.test_centralized_network_setup()
        
        # Agent 1 sends a direct message to Agent 2
        message_content = "Hello Agent 2, this is Agent 1!"
        direct_message = DirectMessage(
            sender_id="agent-1",
            recipient_id="agent-2",
            content=message_content,
            message_id=f"msg-{int(time.time())}"
        )
        
        logger.info(f"Agent 1 sending direct message to Agent 2: {message_content}")
        await self.agent1_network.send_message(direct_message)
        
        # Wait for message delivery
        await asyncio.sleep(2.0)
        
        # Verify Agent 2 received the message
        assert len(self.agent2_received_messages) == 1
        received_msg = self.agent2_received_messages[0]
        assert received_msg['content'] == message_content
        assert received_msg['sender'] == "agent-1"
        assert received_msg['type'] == "direct"
        
        # Verify Agent 1 did not receive its own message
        assert len(self.agent1_received_messages) == 0
        
        logger.info("Direct message test passed!")

    @pytest.mark.asyncio
    async def test_bidirectional_messaging(self):
        """Test bidirectional messaging between agents."""
        # Set up the network
        await self.test_centralized_network_setup()
        
        # Agent 1 sends message to Agent 2
        msg1_content = "Hello from Agent 1!"
        direct_message1 = DirectMessage(
            sender_id="agent-1",
            recipient_id="agent-2",
            content=msg1_content,
            message_id=f"msg1-{int(time.time())}"
        )
        
        await self.agent1_network.send_message(direct_message1)
        await asyncio.sleep(1.0)
        
        # Agent 2 sends response to Agent 1
        msg2_content = "Hello back from Agent 2!"
        direct_message2 = DirectMessage(
            sender_id="agent-2",
            recipient_id="agent-1",
            content=msg2_content,
            message_id=f"msg2-{int(time.time())}"
        )
        
        await self.agent2_network.send_message(direct_message2)
        await asyncio.sleep(1.0)
        
        # Verify both agents received their respective messages
        assert len(self.agent2_received_messages) == 1
        assert self.agent2_received_messages[0]['content'] == msg1_content
        assert self.agent2_received_messages[0]['sender'] == "agent-1"
        
        assert len(self.agent1_received_messages) == 1
        assert self.agent1_received_messages[0]['content'] == msg2_content
        assert self.agent1_received_messages[0]['sender'] == "agent-2"
        
        logger.info("Bidirectional messaging test passed!")

    @pytest.mark.asyncio
    async def test_broadcast_messaging(self):
        """Test broadcast messaging through centralized server."""
        # Set up the network
        await self.test_centralized_network_setup()
        
        # Agent 1 sends a broadcast message
        broadcast_content = "Hello everyone, this is a broadcast from Agent 1!"
        broadcast_message = BroadcastMessage(
            sender_id="agent-1",
            content=broadcast_content,
            message_id=f"broadcast-{int(time.time())}"
        )
        
        logger.info(f"Agent 1 sending broadcast message: {broadcast_content}")
        await self.agent1_network.send_message(broadcast_message)
        
        # Wait for message delivery
        await asyncio.sleep(2.0)
        
        # Verify Agent 2 received the broadcast message
        assert len(self.agent2_received_messages) == 1
        received_msg = self.agent2_received_messages[0]
        assert received_msg['content'] == broadcast_content
        assert received_msg['sender'] == "agent-1"
        assert received_msg['type'] == "broadcast"
        
        # Note: Agent 1 might or might not receive its own broadcast depending on implementation
        # This is typically configurable behavior
        
        logger.info("Broadcast messaging test passed!")

    @pytest.mark.asyncio
    async def test_multiple_message_exchange(self):
        """Test multiple messages exchanged between agents."""
        # Set up the network
        await self.test_centralized_network_setup()
        
        # Send multiple messages in sequence
        messages = [
            ("agent-1", "agent-2", "Message 1 from A1 to A2"),
            ("agent-2", "agent-1", "Response 1 from A2 to A1"),
            ("agent-1", "agent-2", "Message 2 from A1 to A2"),
            ("agent-2", "agent-1", "Response 2 from A2 to A1"),
        ]
        
        for sender, recipient, content in messages:
            message = DirectMessage(
                sender_id=sender,
                recipient_id=recipient,
                content=content,
                message_id=f"msg-{sender}-{int(time.time())}-{random.randint(1000, 9999)}"
            )
            
            if sender == "agent-1":
                await self.agent1_network.send_message(message)
            else:
                await self.agent2_network.send_message(message)
            
            # Small delay between messages
            await asyncio.sleep(0.5)
        
        # Wait for all messages to be delivered
        await asyncio.sleep(2.0)
        
        # Verify message counts
        assert len(self.agent1_received_messages) == 2  # 2 messages sent to agent-1
        assert len(self.agent2_received_messages) == 2  # 2 messages sent to agent-2
        
        # Verify message contents
        agent1_contents = [msg['content'] for msg in self.agent1_received_messages]
        agent2_contents = [msg['content'] for msg in self.agent2_received_messages]
        
        assert "Response 1 from A2 to A1" in agent1_contents
        assert "Response 2 from A2 to A1" in agent1_contents
        assert "Message 1 from A1 to A2" in agent2_contents
        assert "Message 2 from A1 to A2" in agent2_contents
        
        logger.info("Multiple message exchange test passed!")

    @pytest.mark.asyncio
    async def test_network_resilience(self):
        """Test network behavior when an agent disconnects and reconnects."""
        # Set up the network
        await self.test_centralized_network_setup()
        
        # Send initial message to verify connectivity
        test_message = DirectMessage(
            sender_id="agent-1",
            recipient_id="agent-2",
            content="Initial connectivity test",
            message_id=f"initial-{int(time.time())}"
        )
        await self.agent1_network.send_message(test_message)
        await asyncio.sleep(1.0)
        
        assert len(self.agent2_received_messages) == 1
        
        # Simulate agent 2 disconnect
        logger.info("Simulating agent 2 disconnect")
        await self.agent2_network.stop()
        await asyncio.sleep(1.0)
        
        # Agent 1 tries to send message while Agent 2 is disconnected
        disconnected_message = DirectMessage(
            sender_id="agent-1",
            recipient_id="agent-2",
            content="Message while disconnected",
            message_id=f"disconnected-{int(time.time())}"
        )
        await self.agent1_network.send_message(disconnected_message)
        await asyncio.sleep(1.0)
        
        # Reconnect Agent 2
        logger.info("Reconnecting agent 2")
        self.agent2_received_messages.clear()  # Clear old messages
        self.agent2_network = await self._create_agent_network("agent-2", "Agent2Reconnected")
        await asyncio.sleep(1.0)
        
        # Send message after reconnection
        reconnected_message = DirectMessage(
            sender_id="agent-1",
            recipient_id="agent-2",
            content="Message after reconnection",
            message_id=f"reconnected-{int(time.time())}"
        )
        await self.agent1_network.send_message(reconnected_message)
        await asyncio.sleep(2.0)
        
        # Verify the reconnected agent can receive new messages
        assert len(self.agent2_received_messages) >= 1
        latest_msg = self.agent2_received_messages[-1]
        assert latest_msg['content'] == "Message after reconnection"
        
        logger.info("Network resilience test passed!")


if __name__ == "__main__":
    # Allow running this test file directly for debugging
    import sys
    import os
    
    # Add the project root to Python path
    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    sys.path.insert(0, project_root)
    
    # Configure logging
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    # Run a simple test
    async def simple_test():
        test_instance = TestCentralizedNetworkAgents()
        await test_instance.setup_and_teardown().__anext__()
        try:
            await test_instance.test_direct_message_between_agents()
            print("✅ Direct messaging test passed!")
            
            await test_instance.test_bidirectional_messaging()
            print("✅ Bidirectional messaging test passed!")
            
            print("🎉 All tests completed successfully!")
        except Exception as e:
            print(f"❌ Test failed: {e}")
            import traceback
            traceback.print_exc()
        finally:
            await test_instance._cleanup_networks()
    
    # Run the test
    asyncio.run(simple_test())