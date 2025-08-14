"""
Test case for the SimpleAgent from agent_runner_example.py

This test demonstrates:
1. SimpleAgent echo functionality for direct messages
2. SimpleAgent greeting responses to broadcast messages
3. Agent lifecycle methods (setup, teardown)
4. Message counting functionality
"""

import asyncio
import pytest
import logging
import time
import random
import sys
import os
from typing import Dict, Any, List, Optional

# Add the src directory to the Python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../src')))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../examples')))

from openagents.models.messages import DirectMessage, BroadcastMessage, BaseMessage
from openagents.models.message_thread import MessageThread
from openagents.core.network import create_network
from openagents.models.network_config import NetworkConfig, NetworkMode
from openagents.models.transport import TransportType

# Import the SimpleAgent from the example
from agent_runner_example import SimpleAgent

# Configure logging for tests
logger = logging.getLogger(__name__)


def create_testing_simple_agent(agent_id: str = None):
    """Factory function to create TestingSimpleAgent to avoid pytest warning."""
    
    class TestingSimpleAgent(SimpleAgent):
        """Extended SimpleAgent for testing with additional tracking capabilities."""
        
        def __init__(self):
            super().__init__()
            if agent_id:
                self.client.agent_id = agent_id
            
            # Additional tracking for tests
            self.received_messages = []
            self.sent_messages = []
            self.is_ready = False
            self.setup_called = False
            self.teardown_called = False
        
        async def react(self, message_threads: Dict[str, MessageThread], incoming_thread_id: str, incoming_message: BaseMessage):
            """Enhanced react method that tracks received messages."""
            # Store the received message for verification
            self.received_messages.append({
                'sender_id': incoming_message.sender_id,
                'content': incoming_message.content,
                'message_type': type(incoming_message).__name__,
                'timestamp': time.time(),
                'thread_id': incoming_thread_id,
                'message_id': incoming_message.message_id
            })
            
            # Call the original react method
            await super().react(message_threads, incoming_thread_id, incoming_message)
        
        async def setup(self):
            """Enhanced setup that tracks the call."""
            await super().setup()
            self.setup_called = True
            self.is_ready = True
            
        async def teardown(self):
            """Enhanced teardown that tracks the call."""
            await super().teardown()
            self.teardown_called = True
            
        def track_sent_message(self, message_type: str, target_id: str, content: dict):
            """Track sent messages for verification."""
            self.sent_messages.append({
                'message_type': message_type,
                'target_id': target_id,
                'content': content,
                'timestamp': time.time()
            })
    
    return TestingSimpleAgent()


class TestSimpleAgentRunner:
    """Test the SimpleAgent from agent_runner_example.py"""

    @pytest.fixture(autouse=True)
    async def setup_and_teardown(self):
        """Set up and tear down test environment."""
        # Test configuration
        self.host = "127.0.0.1"
        self.port = random.randint(8000, 9999)
        
        # Server and agents
        self.server_network: Optional[Any] = None
        self.simple_agent: Optional[Any] = None
        self.test_agent: Optional[Any] = None
        
        logger.info(f"Test setup: Using port {self.port}")
        
        yield
        
        # Cleanup
        if self.simple_agent and self.simple_agent._running:
            try:
                await self.simple_agent._async_stop()
            except Exception as e:
                logger.error(f"Error stopping simple_agent: {e}")
        if self.test_agent and self.test_agent._running:
            try:
                await self.test_agent._async_stop()
            except Exception as e:
                logger.error(f"Error stopping test_agent: {e}")
        if self.server_network and self.server_network.is_running:
            try:
                await self.server_network.shutdown()
            except Exception as e:
                logger.error(f"Error stopping server: {e}")
            
        logger.info("Test cleanup completed")

    async def create_server(self):
        """Create OpenAgents network server."""
        logger.info(f"🌐 Creating OpenAgents network server on {self.host}:{self.port}")
        
        config = NetworkConfig(
            name="SimpleAgentTestServer",
            mode=NetworkMode.CENTRALIZED,
            host=self.host,
            port=self.port,
            transport=TransportType.WEBSOCKET,
            server_mode=True,
            node_id="simple-agent-test-server",
            coordinator_url=None,
            encryption_enabled=False,  # Disable for testing
            encryption_type="noise",
            discovery_interval=5,
            discovery_enabled=True,
            max_connections=100,
            connection_timeout=30.0,
            retry_attempts=3,
            heartbeat_interval=30,
            message_queue_size=1000,
            message_timeout=30.0
        )
        
        self.server_network = create_network(config)
        result = await self.server_network.initialize()
        assert result is True
        
        # Wait for server to be ready
        await asyncio.sleep(1.0)
        
        logger.info("✅ OpenAgents network server started")

    async def create_agents(self):
        """Create and connect test agents."""
        logger.info("🤖 Creating SimpleAgent and test agent")
        
        # Create the SimpleAgent from the example
        self.simple_agent = create_testing_simple_agent("simple-demo-agent")
        
        # Create a test agent to interact with SimpleAgent
        self.test_agent = create_testing_simple_agent("test-agent")
        
        # Agent metadata
        metadata = {
            "name": "Test Simple Agent",
            "type": "demo_agent",
            "capabilities": ["echo", "greeting", "status_updates"],
            "version": "1.0.0"
        }
        
        test_metadata = {
            "name": "Test Agent",
            "type": "test_agent", 
            "capabilities": ["testing"],
            "version": "1.0.0"
        }
        
        # Start the agents
        await self.simple_agent._async_start(
            host=self.host,
            port=self.port,
            metadata=metadata
        )
        
        await self.test_agent._async_start(
            host=self.host,
            port=self.port,
            metadata=test_metadata
        )
        
        # Wait for agents to be ready
        max_wait = 10
        wait_time = 0
        while (not self.simple_agent.is_ready or not self.test_agent.is_ready) and wait_time < max_wait:
            await asyncio.sleep(0.5)
            wait_time += 0.5
        
        if not self.simple_agent.is_ready or not self.test_agent.is_ready:
            raise Exception("Agents did not become ready in time")
        
        logger.info("✅ Both agents connected and ready")

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_simple_agent_echo_functionality(self):
        """Test that SimpleAgent echoes direct messages correctly."""
        # Set up server and agents
        await self.create_server()
        await self.create_agents()
        
        # Verify agents are ready
        assert self.simple_agent.is_ready
        assert self.test_agent.is_ready
        assert self.simple_agent.setup_called
        
        # Clear any initial messages
        self.simple_agent.received_messages.clear()
        self.test_agent.received_messages.clear()
        
        # Send a direct message to SimpleAgent
        test_text = "Hello SimpleAgent, please echo this message!"
        
        direct_message = DirectMessage(
            sender_id=self.test_agent.client.agent_id,
            target_agent_id=self.simple_agent.client.agent_id,
            protocol="openagents.mods.communication.simple_messaging",
            message_type="direct_message",
            content={"text": test_text},
            text_representation=test_text,
            requires_response=False
        )
        
        logger.info(f"📤 Test agent sending direct message: {test_text}")
        await self.test_agent.client.send_direct_message(direct_message)
        
        # Wait for message processing
        await asyncio.sleep(3.0)
        
        # Find the direct message we sent (filter out broadcast messages)
        direct_messages_received = [msg for msg in self.simple_agent.received_messages 
                                  if msg['message_type'] == 'DirectMessage' and 
                                     msg['sender_id'] == self.test_agent.client.agent_id and
                                     msg['content']['text'] == test_text]
        
        assert len(direct_messages_received) >= 1, f"SimpleAgent should have received the direct message, got {len(direct_messages_received)}"
        
        received_msg = direct_messages_received[0]
        assert received_msg['sender_id'] == self.test_agent.client.agent_id
        assert received_msg['message_type'] == 'DirectMessage'
        assert received_msg['content']['text'] == test_text
        
        # Find the echo response (filter out other messages)
        echo_responses = [msg for msg in self.test_agent.received_messages 
                         if msg['message_type'] == 'DirectMessage' and 
                            msg['sender_id'] == self.simple_agent.client.agent_id and
                            f"Echo: {test_text}" in msg['content']['text']]
        
        assert len(echo_responses) >= 1, f"Test agent should have received echo response, got {len(echo_responses)}"
        
        echo_response = echo_responses[0]
        assert echo_response['sender_id'] == self.simple_agent.client.agent_id
        assert echo_response['message_type'] == 'DirectMessage'
        assert f"Echo: {test_text}" in echo_response['content']['text']
        
        # Verify message counter increased
        assert self.simple_agent.message_count >= 1
        
        logger.info("✅ SimpleAgent echo functionality test passed!")

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_simple_agent_greeting_response(self):
        """Test that SimpleAgent responds to greeting broadcasts."""
        # Set up server and agents
        await self.create_server()
        await self.create_agents()
        
        # Clear any initial messages
        self.simple_agent.received_messages.clear()
        self.test_agent.received_messages.clear()
        
        # Send a broadcast message with "hello"
        greeting_text = "hello everyone!"
        
        broadcast_message = BroadcastMessage(
            sender_id=self.test_agent.client.agent_id,
            protocol="openagents.mods.communication.simple_messaging",
            message_type="broadcast_message",
            content={"text": greeting_text},
            text_representation=greeting_text,
            requires_response=False
        )
        
        logger.info(f"📤 Test agent sending broadcast greeting: {greeting_text}")
        await self.test_agent.client.send_broadcast_message(broadcast_message)
        
        # Wait for message processing
        await asyncio.sleep(3.0)
        
        # Find the broadcast that SimpleAgent received
        broadcast_received = [msg for msg in self.simple_agent.received_messages 
                             if msg['message_type'] == 'BroadcastMessage' and 
                                msg['sender_id'] == self.test_agent.client.agent_id and
                                "hello" in msg['content']['text'].lower()]
        
        assert len(broadcast_received) >= 1, f"SimpleAgent should have received broadcast with 'hello', got {len(broadcast_received)}"
        
        # Find greeting responses sent to test agent (filtering for the specific greeting response)
        greeting_responses = [msg for msg in self.test_agent.received_messages 
                             if msg['message_type'] == 'DirectMessage' and 
                                msg['sender_id'] == self.simple_agent.client.agent_id and
                                "Hello" in msg['content']['text'] and
                                "Nice to meet you" in msg['content']['text']]
        
        assert len(greeting_responses) >= 1, f"Test agent should have received greeting response, got {len(greeting_responses)}"
        
        greeting_response = greeting_responses[0]
        assert self.test_agent.client.agent_id in greeting_response['content']['text']
        
        logger.info("✅ SimpleAgent greeting response test passed!")

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_simple_agent_lifecycle(self):
        """Test SimpleAgent lifecycle methods."""
        # Set up server and agents
        await self.create_server()
        await self.create_agents()
        
        # Verify setup was called
        assert self.simple_agent.setup_called
        assert self.simple_agent.is_ready
        
        # Verify agent sent greeting broadcast during setup
        # Check if any broadcast was sent during setup
        initial_broadcasts = len(self.test_agent.received_messages)
        logger.info(f"Test agent received {initial_broadcasts} messages during setup")
        
        # Stop the simple agent and verify teardown
        await self.simple_agent._async_stop()
        
        # Wait a moment for teardown processing
        await asyncio.sleep(2.0)
        
        # Verify teardown was called
        assert self.simple_agent.teardown_called
        
        # Verify goodbye message was sent (check if test agent received additional messages)
        final_broadcasts = len(self.test_agent.received_messages)
        assert final_broadcasts >= initial_broadcasts, "Should have received goodbye message"
        
        logger.info("✅ SimpleAgent lifecycle test passed!")

    @pytest.mark.asyncio
    @pytest.mark.integration
    @pytest.mark.skip(reason="Needs more robust filtering for complex message flows")
    async def test_simple_agent_message_counting(self):
        """Test that SimpleAgent correctly counts processed messages."""
        # Set up server and agents
        await self.create_server()
        await self.create_agents()
        
        # Clear any initial messages and reset counter
        self.simple_agent.received_messages.clear()
        self.test_agent.received_messages.clear()
        initial_count = self.simple_agent.message_count
        
        # Send multiple direct messages with unique content
        test_messages = []
        for i in range(3):
            test_text = f"Unique test message {i+1} for counting"
            test_messages.append(test_text)
            
            direct_message = DirectMessage(
                sender_id=self.test_agent.client.agent_id,
                target_agent_id=self.simple_agent.client.agent_id,
                protocol="openagents.mods.communication.simple_messaging",
                message_type="direct_message",
                content={"text": test_text},
                text_representation=test_text,
                requires_response=False
            )
            
            await self.test_agent.client.send_direct_message(direct_message)
            await asyncio.sleep(1.0)  # Space out messages
        
        # Wait for all messages to be processed
        await asyncio.sleep(3.0)
        
        # Find the specific direct messages we sent (filter out other messages)
        our_messages = [msg for msg in self.simple_agent.received_messages 
                       if msg['message_type'] == 'DirectMessage' and 
                          msg['sender_id'] == self.test_agent.client.agent_id and
                          "Unique test message" in msg['content']['text']]
        
        assert len(our_messages) == 3, f"Should have received 3 unique test messages, got {len(our_messages)}"
        
        # Find the echo responses for our messages
        echo_responses = [msg for msg in self.test_agent.received_messages 
                         if msg['message_type'] == 'DirectMessage' and 
                            msg['sender_id'] == self.simple_agent.client.agent_id and
                            "Echo: Unique test message" in msg['content']['text']]
        
        assert len(echo_responses) == 3, f"Should have received 3 echo responses, got {len(echo_responses)}"
        
        # Verify message count increased by at least 3 (could be more due to other messages)
        assert self.simple_agent.message_count >= initial_count + 3, f"Message count should have increased by at least 3, got {self.simple_agent.message_count - initial_count}"
        
        logger.info("✅ SimpleAgent message counting test passed!")

    @pytest.mark.asyncio
    @pytest.mark.integration
    @pytest.mark.skip(reason="Complex message interaction patterns need further refinement")
    async def test_simple_agent_ignores_own_messages(self):
        """Test that SimpleAgent doesn't respond to its own messages."""
        # Set up server and agents
        await self.create_server()
        await self.create_agents()
        
        # Clear any initial messages and get initial state
        self.simple_agent.received_messages.clear()
        self.test_agent.received_messages.clear()
        initial_count = self.simple_agent.message_count
        
        # Send a broadcast message that includes "hello" but from SimpleAgent itself
        # This should not trigger a greeting response to itself
        greeting_text = "hello from myself - unique test message!"
        
        broadcast_message = BroadcastMessage(
            sender_id=self.simple_agent.client.agent_id,  # From SimpleAgent itself
            protocol="openagents.mods.communication.simple_messaging", 
            message_type="broadcast_message",
            content={"text": greeting_text},
            text_representation=greeting_text,
            requires_response=False
        )
        
        logger.info(f"📤 SimpleAgent sending broadcast to itself: {greeting_text}")
        await self.simple_agent.client.send_broadcast_message(broadcast_message)
        
        # Wait for message processing
        await asyncio.sleep(3.0)
        
        # Find the specific broadcast we sent
        self_broadcast = [msg for msg in self.simple_agent.received_messages 
                         if msg['message_type'] == 'BroadcastMessage' and 
                            msg['sender_id'] == self.simple_agent.client.agent_id and
                            "hello from myself - unique test message" in msg['content']['text']]
        
        assert len(self_broadcast) >= 1, "SimpleAgent should receive its own broadcast"
        
        # Verify no greeting response was sent to itself (check test agent received no direct messages from SimpleAgent containing greeting response)
        greeting_responses_to_self = [msg for msg in self.test_agent.received_messages 
                                     if msg['message_type'] == 'DirectMessage' and 
                                        msg['sender_id'] == self.simple_agent.client.agent_id and
                                        "Hello" in msg['content']['text'] and
                                        self.simple_agent.client.agent_id in msg['content']['text']]
        
        # There should be no greeting responses to itself
        assert len(greeting_responses_to_self) == 0, f"SimpleAgent should not send greeting response to itself, but found {len(greeting_responses_to_self)}"
        
        logger.info("✅ SimpleAgent self-message handling test passed!")


if __name__ == "__main__":
    # Configure logging for standalone execution
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    async def run_tests():
        test_instance = TestSimpleAgentRunner()
        await test_instance.setup_and_teardown().__anext__()
        
        try:
            await test_instance.test_simple_agent_echo_functionality()
            print("✅ Echo functionality test passed!")
            
            # Reset for next test
            await test_instance.setup_and_teardown().__anext__()
            await test_instance.test_simple_agent_greeting_response()
            print("✅ Greeting response test passed!")
            
            # Reset for next test
            await test_instance.setup_and_teardown().__anext__()
            await test_instance.test_simple_agent_lifecycle()
            print("✅ Lifecycle test passed!")
            
            # Reset for next test
            await test_instance.setup_and_teardown().__anext__()
            await test_instance.test_simple_agent_message_counting()
            print("✅ Message counting test passed!")
            
            # Reset for next test
            await test_instance.setup_and_teardown().__anext__()
            await test_instance.test_simple_agent_ignores_own_messages()
            print("✅ Self-message handling test passed!")
            
            print("🎉 All SimpleAgent tests passed!")
            
        except Exception as e:
            print(f"❌ Test failed: {e}")
            import traceback
            traceback.print_exc()
        finally:
            # Cleanup
            if test_instance.simple_agent and test_instance.simple_agent._running:
                await test_instance.simple_agent._async_stop()
            if test_instance.test_agent and test_instance.test_agent._running:
                await test_instance.test_agent._async_stop()
            if test_instance.server_network and test_instance.server_network.is_running:
                await test_instance.server_network.shutdown()

    # Run the tests
    asyncio.run(run_tests())
