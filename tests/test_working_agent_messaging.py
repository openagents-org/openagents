"""
Working test case using existing OpenAgents AgentRunner implementation.

This test demonstrates:
1. Creating two agents using the existing AgentRunner class
2. One agent sending a message to another agent 
3. Confirming the other agent receives the message
4. Using existing network and agent runner infrastructure
"""

import asyncio
import pytest
import logging
import time
import random
import sys
import os
from typing import Dict, Any, List

# Add the src directory to the Python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../src')))

from openagents.agents.runner import AgentRunner
from openagents.models.messages import DirectMessage, BroadcastMessage, BaseMessage
from openagents.models.message_thread import MessageThread
from openagents.core.network import create_network
from openagents.models.network_config import NetworkConfig, NetworkMode
from openagents.models.transport import TransportType

# Configure logging for tests
logger = logging.getLogger(__name__)


class TestAgent(AgentRunner):
    """Test agent that uses existing AgentRunner implementation."""
    
    def __init__(self, agent_id: str):
        super().__init__(agent_id=agent_id)
        self.received_messages = []
        self.is_ready = False
        
    async def react(self, message_threads: Dict[str, MessageThread], incoming_thread_id: str, incoming_message: BaseMessage):
        """React to incoming messages."""
        logger.info(f"🎯 Agent {self.client.agent_id} received message from {incoming_message.sender_id}")
        logger.info(f"   Message type: {type(incoming_message).__name__}")
        logger.info(f"   Content: {incoming_message.content}")
        
        # Store the received message for verification
        self.received_messages.append({
            'sender_id': incoming_message.sender_id,
            'content': incoming_message.content,
            'message_type': type(incoming_message).__name__,
            'timestamp': time.time()
        })
        
        logger.info(f"✅ Agent {self.client.agent_id} stored received message (total: {len(self.received_messages)})")
        
    async def setup(self):
        """Setup after connection."""
        logger.info(f"🚀 Agent {self.client.agent_id} is ready!")
        self.is_ready = True
        
    async def teardown(self):
        """Cleanup before disconnection."""
        logger.info(f"🔴 Agent {self.client.agent_id} shutting down")
        self.is_ready = False


class TestWorkingAgentMessaging:
    """Test actual message exchange between agents using existing AgentRunner."""

    @pytest.fixture(autouse=True)
    async def setup_and_teardown(self):
        """Set up and tear down test environment."""
        # Test configuration
        self.host = "127.0.0.1"
        self.port = random.randint(8000, 9999)
        
        # Server and agents
        self.server_network = None
        self.agent1 = None
        self.agent2 = None
        
        logger.info(f"Test setup: Using port {self.port}")
        
        yield
        
        # Cleanup
        if self.agent1 and self.agent1._running:
            await self.agent1._async_stop()
        if self.agent2 and self.agent2._running:
            await self.agent2._async_stop()
        if self.server_network and self.server_network.is_running:
            await self.server_network.shutdown()
            
        logger.info("Test cleanup completed")

    async def create_server(self):
        """Create OpenAgents network server."""
        config = NetworkConfig(
            name="TestServer",
            mode=NetworkMode.CENTRALIZED,
            host=self.host,
            port=self.port,
            transport=TransportType.WEBSOCKET,
            server_mode=True,
            node_id="test-server"
        )
        
        self.server_network = create_network(config)
        result = await self.server_network.initialize()
        assert result is True
        logger.info(f"✅ Server created on {self.host}:{self.port}")
        
        # Wait a moment for server to be ready
        await asyncio.sleep(0.5)

    async def create_agents(self):
        """Create two test agents."""
        # Create agents
        self.agent1 = TestAgent("test-agent-1")
        self.agent2 = TestAgent("test-agent-2")
        
        # Start the agent runners (this connects them and starts their message processing loops)
        await self.agent1._async_start(
            host=self.host, 
            port=self.port,
            metadata={"name": "TestAgent1", "type": "test"}
        )
        
        await self.agent2._async_start(
            host=self.host, 
            port=self.port,
            metadata={"name": "TestAgent2", "type": "test"}
        )
        
        # Wait for connections to stabilize
        await asyncio.sleep(2.0)
        
        logger.info("✅ Both agents connected and ready")

    @pytest.mark.asyncio
    async def test_direct_message_exchange(self):
        """Test direct message exchange between agents."""
        # Set up server and agents
        await self.create_server()
        await self.create_agents()
        
        # Verify agents are ready
        assert self.agent1.is_ready
        assert self.agent2.is_ready
        assert len(self.agent2.received_messages) == 0
        
        # Agent 1 sends a direct message to Agent 2
        test_message = DirectMessage(
            sender_id=self.agent1.client.agent_id,
            target_agent_id=self.agent2.client.agent_id,
            protocol="openagents.protocols.communication.simple_messaging",
            message_type="direct_message",
            content={"text": "Hello Agent 2, this is Agent 1!"},
            text_representation="Hello Agent 2, this is Agent 1!",
            requires_response=False
        )
        
        logger.info(f"📤 Agent 1 sending direct message to Agent 2")
        
        # Send the message using existing client infrastructure
        await self.agent1.client.send_direct_message(test_message)
        
        logger.info("✅ Message sent, waiting for delivery...")
        
        # Wait for message delivery and processing
        await asyncio.sleep(3.0)
        
        # Verify Agent 2 received the message
        logger.info(f"📥 Agent 2 received {len(self.agent2.received_messages)} messages")
        
        assert len(self.agent2.received_messages) >= 1, f"Agent 2 should have received at least 1 message, got {len(self.agent2.received_messages)}"
        
        received_msg = self.agent2.received_messages[0]
        assert received_msg['sender_id'] == self.agent1.client.agent_id
        assert received_msg['content']['text'] == "Hello Agent 2, this is Agent 1!"
        assert received_msg['message_type'] == "DirectMessage"
        
        logger.info("🎉 Direct message exchange test PASSED!")

    @pytest.mark.asyncio
    async def test_broadcast_message(self):
        """Test broadcast message from one agent."""
        # Set up server and agents
        await self.create_server()
        await self.create_agents()
        
        # Clear any existing messages
        self.agent1.received_messages.clear()
        self.agent2.received_messages.clear()
        
        # Agent 1 sends a broadcast message
        broadcast_message = BroadcastMessage(
            sender_id=self.agent1.client.agent_id,
            protocol="openagents.protocols.communication.simple_messaging",
            message_type="broadcast_message",
            content={"text": "Hello everyone! This is a broadcast from Agent 1!"},
            text_representation="Hello everyone! This is a broadcast from Agent 1!",
            requires_response=False
        )
        
        logger.info(f"📡 Agent 1 sending broadcast message")
        
        # Send the broadcast message
        await self.agent1.client.send_broadcast_message(broadcast_message)
        
        logger.info("✅ Broadcast sent, waiting for delivery...")
        
        # Wait for message delivery
        await asyncio.sleep(3.0)
        
        # Verify Agent 2 received the broadcast (Agent 1 shouldn't receive its own broadcast)
        logger.info(f"📥 Agent 2 received {len(self.agent2.received_messages)} messages")
        logger.info(f"📥 Agent 1 received {len(self.agent1.received_messages)} messages")
        
        assert len(self.agent2.received_messages) >= 1, f"Agent 2 should have received the broadcast message"
        
        received_msg = self.agent2.received_messages[0]
        assert received_msg['sender_id'] == self.agent1.client.agent_id
        assert received_msg['content']['text'] == "Hello everyone! This is a broadcast from Agent 1!"
        assert received_msg['message_type'] == "BroadcastMessage"
        
        logger.info("🎉 Broadcast message test PASSED!")

    @pytest.mark.asyncio 
    async def test_bidirectional_messaging(self):
        """Test bidirectional messaging between agents."""
        # Set up server and agents
        await self.create_server()
        await self.create_agents()
        
        # Clear any existing messages
        self.agent1.received_messages.clear()
        self.agent2.received_messages.clear()
        
        # Agent 1 → Agent 2
        message1 = DirectMessage(
            sender_id=self.agent1.client.agent_id,
            target_agent_id=self.agent2.client.agent_id,
            protocol="openagents.protocols.communication.simple_messaging",
            message_type="direct_message",
            content={"text": "Hello Agent 2!"},
            text_representation="Hello Agent 2!",
            requires_response=False
        )
        
        # Agent 2 → Agent 1
        message2 = DirectMessage(
            sender_id=self.agent2.client.agent_id,
            target_agent_id=self.agent1.client.agent_id,
            protocol="openagents.protocols.communication.simple_messaging",
            message_type="direct_message",
            content={"text": "Hello back, Agent 1!"},
            text_representation="Hello back, Agent 1!",
            requires_response=False
        )
        
        logger.info("📤 Sending bidirectional messages")
        
        # Send messages
        await self.agent1.client.send_direct_message(message1)
        await asyncio.sleep(1.0)  # Stagger messages
        await self.agent2.client.send_direct_message(message2)
        
        # Wait for delivery
        await asyncio.sleep(3.0)
        
        # Verify both agents received messages
        assert len(self.agent1.received_messages) >= 1, "Agent 1 should have received reply"
        assert len(self.agent2.received_messages) >= 1, "Agent 2 should have received initial message"
        
        # Check Agent 2 received message from Agent 1
        agent2_msg = self.agent2.received_messages[0]
        assert agent2_msg['sender_id'] == self.agent1.client.agent_id
        assert agent2_msg['content']['text'] == "Hello Agent 2!"
        
        # Check Agent 1 received reply from Agent 2
        agent1_msg = self.agent1.received_messages[0]
        assert agent1_msg['sender_id'] == self.agent2.client.agent_id
        assert agent1_msg['content']['text'] == "Hello back, Agent 1!"
        
        logger.info("🎉 Bidirectional messaging test PASSED!")


if __name__ == "__main__":
    # Configure logging for standalone execution
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    async def run_tests():
        test_instance = TestWorkingAgentMessaging()
        await test_instance.setup_and_teardown().__anext__()
        
        try:
            await test_instance.test_direct_message_exchange()
            print("✅ Direct message test passed!")
            
            # Reset for next test
            await test_instance.setup_and_teardown().__anext__()
            await test_instance.test_broadcast_message()
            print("✅ Broadcast message test passed!")
            
            # Reset for next test
            await test_instance.setup_and_teardown().__anext__()
            await test_instance.test_bidirectional_messaging()
            print("✅ Bidirectional messaging test passed!")
            
            print("🎉 All tests passed!")
            
        except Exception as e:
            print(f"❌ Test failed: {e}")
            import traceback
            traceback.print_exc()
        finally:
            # Cleanup
            if test_instance.agent1 and test_instance.agent1._running:
                await test_instance.agent1._async_stop()
            if test_instance.agent2 and test_instance.agent2._running:
                await test_instance.agent2._async_stop()
            if test_instance.server_network and test_instance.server_network.is_running:
                await test_instance.server_network.shutdown()

    # Run the tests
    asyncio.run(run_tests())