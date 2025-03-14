"""
Unit tests for the Network class.

This module contains tests for the core Network functionality including:
- Network initialization and configuration
- Protocol registration
- Agent connection handling
- Message routing and delivery
- Broadcast messaging
- Protocol message handling
"""

import unittest
import asyncio
import json
import logging
import time
import sys
import os
from unittest.mock import MagicMock, patch
from typing import Dict, Any, List, Optional

# Add the src directory to the Python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../src')))

from openagents.core.network import AgentNetworkServer
from openagents.core.base_protocol import BaseProtocol
from openagents.models.messages import (
    BaseMessage,
    DirectMessage,
    BroadcastMessage,
    ProtocolMessage
)

# Configure logging
# logging.basicConfig(
#     level=logging.DEBUG,
#     format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
# )

class MockWebSocket:
    """Mock WebSocket for testing."""
    
    def __init__(self):
        self.sent_messages = []
        self.closed = False
        self.close_code = None
        self.close_reason = None
        self.receive_queue = asyncio.Queue()
    
    async def send(self, message):
        """Mock send method."""
        self.sent_messages.append(message)
    
    async def recv(self):
        """Mock receive method."""
        return await self.receive_queue.get()
    
    async def close(self, code=1000, reason=""):
        """Mock close method."""
        self.closed = True
        self.close_code = code
        self.close_reason = reason
    
    def add_message_to_queue(self, message):
        """Add a message to the receive queue."""
        self.receive_queue.put_nowait(message)
    
    def __aiter__(self):
        """Make the mock WebSocket iterable."""
        return self
    
    async def __anext__(self):
        """Get the next message from the queue."""
        try:
            return await self.receive_queue.get()
        except asyncio.CancelledError:
            raise StopAsyncIteration


class MockProtocol(BaseProtocol):
    """Mock protocol for testing."""
    
    def __init__(self):
        super().__init__(protocol_name="MockProtocol")
        self.registered_agents = {}
        self.processed_messages = []
        self.processed_direct_messages = []
        self.processed_broadcast_messages = []
        self.processed_protocol_messages = []
    
    def handle_register_agent(self, agent_id: str, metadata: Dict[str, Any]) -> None:
        """Handle agent registration."""
        self.registered_agents[agent_id] = metadata
    
    def handle_unregister_agent(self, agent_id: str) -> None:
        """Handle agent unregistration."""
        if agent_id in self.registered_agents:
            del self.registered_agents[agent_id]
    
    async def process_direct_message(self, message: DirectMessage) -> Optional[DirectMessage]:
        """Process a direct message."""
        self.processed_direct_messages.append(message)
        return message
    
    async def process_broadcast_message(self, message: BroadcastMessage) -> Optional[BroadcastMessage]:
        """Process a broadcast message."""
        self.processed_broadcast_messages.append(message)
        return message
    
    async def process_protocol_message(self, message: ProtocolMessage) -> None:
        """Process a protocol message."""
        self.processed_protocol_messages.append(message)
    
    def get_network_state(self) -> Dict[str, Any]:
        """Get the protocol state."""
        return {
            "registered_agents": list(self.registered_agents.keys()),
            "processed_messages": len(self.processed_messages)
        }


class TestNetwork(unittest.TestCase):
    """Test cases for the Network class."""
    
    def setUp(self):
        """Set up test environment before each test."""
        # Patch AgentConnection to accept MockWebSocket
        self.agent_connection_patch = patch('openagents.core.network.AgentConnection')
        self.mock_agent_connection = self.agent_connection_patch.start()
        self.mock_agent_connection.side_effect = lambda **kwargs: MagicMock(**kwargs)
        
        self.network = AgentNetworkServer(
            network_name="TestNetwork",
            network_id="test-network-id",
            host="localhost",
            port=8765,
            metadata={"version": "1.0.0"}
        )
        
        # Create mock protocol
        self.mock_protocol = MockProtocol()
        self.network.register_protocol(self.mock_protocol)
        
        # Set up async event loop
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)
    
    def tearDown(self):
        """Clean up test environment after each test."""
        self.network.stop()
        self.loop.close()
        self.agent_connection_patch.stop()
    
    def test_network_initialization(self):
        """Test network initialization."""
        self.assertEqual(self.network.network_name, "TestNetwork")
        self.assertEqual(self.network.network_id, "test-network-id")
        self.assertEqual(self.network.host, "localhost")
        self.assertEqual(self.network.port, 8765)
        self.assertEqual(self.network.metadata, {"version": "1.0.0"})
        self.assertFalse(self.network.is_running)
        self.assertEqual(len(self.network.protocols), 1)
        self.assertEqual(len(self.network.connections), 0)
        self.assertEqual(len(self.network.agents), 0)
    
    def test_register_protocol(self):
        """Test protocol registration."""
        # Register another protocol with a different name
        class AnotherMockProtocol(BaseProtocol):
            def __init__(self):
                super().__init__(protocol_name="AnotherMockProtocol")
        
        another_protocol = AnotherMockProtocol()
        result = self.network.register_protocol(another_protocol)
        
        self.assertTrue(result)
        self.assertEqual(len(self.network.protocols), 2)
        self.assertIs(another_protocol.network, self.network)
        
        # Try to register the same protocol again
        result = self.network.register_protocol(another_protocol)
        self.assertFalse(result)
        self.assertEqual(len(self.network.protocols), 2)
    
    def test_start_stop(self):
        """Test starting and stopping the network."""
        # Mock the _run_server method to avoid actually starting the server
        with patch.object(self.network, '_run_server', return_value=asyncio.Future()), \
             patch('asyncio.create_task', side_effect=lambda coro: coro):
            # Start the network
            self.network.start()
            self.assertTrue(self.network.is_running)
            
            # Stop the network
            self.network.stop()
            self.assertFalse(self.network.is_running)
    
    async def _test_agent_registration(self):
        """Test agent registration."""
        # Create mock websocket
        websocket = MockWebSocket()
        
        # Add registration message to queue
        registration_message = json.dumps({
            "type": "openagents_register",
            "agent_id": "test-agent",
            "metadata": {
                "name": "Test Agent",
                "protocols": ["messaging"],
                "capabilities": ["chat"]
            }
        })
        websocket.add_message_to_queue(registration_message)
        
        # Handle connection
        connection_task = asyncio.create_task(
            self.network.handle_connection(websocket)
        )
        
        # Wait a bit for processing
        await asyncio.sleep(0.1)
        
        # Check that the agent was registered
        self.assertIn("test-agent", self.network.agents)
        self.assertIn("test-agent", self.network.connections)
        self.assertIn("test-agent", self.mock_protocol.registered_agents)
        
        # Check response message
        self.assertEqual(len(websocket.sent_messages), 1)
        response = json.loads(websocket.sent_messages[0])
        self.assertEqual(response["type"], "openagents_register_response")
        self.assertTrue(response["success"])
        self.assertEqual(response["network_name"], "TestNetwork")
        self.assertEqual(response["network_id"], "test-network-id")
        
        # Cancel the connection task
        connection_task.cancel()
        try:
            await connection_task
        except asyncio.CancelledError:
            pass
    
    async def _test_duplicate_agent_registration(self):
        """Test duplicate agent registration."""
        # Create mock websockets
        websocket1 = MockWebSocket()
        websocket2 = MockWebSocket()
        
        # Add registration messages to queues
        registration_message = json.dumps({
            "type": "openagents_register",
            "agent_id": "test-agent",
            "metadata": {"name": "Test Agent"}
        })
        websocket1.add_message_to_queue(registration_message)
        websocket2.add_message_to_queue(registration_message)
        
        # Manually add the agent to the agents dictionary to simulate registration
        self.network.agents["test-agent"] = {"name": "Test Agent"}
        self.network.connections["test-agent"] = MagicMock(
            agent_id="test-agent",
            connection=websocket1,
            metadata={"name": "Test Agent"},
            last_activity=time.time()
        )
        
        # Check that the agent is registered
        self.assertIn("test-agent", self.network.agents)
        self.assertIn("test-agent", self.network.connections)
        
        # Handle second connection
        async def handle_second_connection():
            await self.network.handle_connection(websocket2)
        
        try:
            await asyncio.wait_for(handle_second_connection(), timeout=0.5)
        except asyncio.TimeoutError:
            pass  # This is expected as the connection handler might wait for more messages
        
        # Check second websocket was closed
        self.assertTrue(websocket2.closed)
        self.assertEqual(websocket2.close_code, 1008)
        
        # Check error response
        self.assertGreaterEqual(len(websocket2.sent_messages), 1)
        response = json.loads(websocket2.sent_messages[0])
        self.assertEqual(response["type"], "openagents_register_response")
        self.assertFalse(response["success"])
        self.assertIn("already connected", response["error"])
    
    async def _test_direct_message_handling(self):
        """Test direct message handling."""
        # Register two agents
        self.network.register_agent("agent1", {"name": "Agent 1"})
        self.network.register_agent("agent2", {"name": "Agent 2"})
        
        # Create mock connections
        websocket1 = MockWebSocket()
        websocket2 = MockWebSocket()
        
        self.network.connections["agent1"] = MagicMock(
            agent_id="agent1",
            connection=websocket1,
            metadata={"name": "Agent 1"},
            last_activity=time.time()
        )
        
        self.network.connections["agent2"] = MagicMock(
            agent_id="agent2",
            connection=websocket2,
            metadata={"name": "Agent 2"},
            last_activity=time.time()
        )
        
        # Create direct message
        direct_message = DirectMessage(
            sender_id="agent1",
            target_agent_id="agent2",
            content={"text": "Hello, Agent 2!"}
        )
        
        # Mock is_running property
        with patch.object(self.network, 'is_running', True):
            # Send the message
            result = await self.network.send_direct_message(direct_message)
        
        # Check result
        self.assertTrue(result)
        
        # Check that the message was processed by the protocol
        self.assertEqual(len(self.mock_protocol.processed_direct_messages), 1)
        processed_message = self.mock_protocol.processed_direct_messages[0]
        self.assertEqual(processed_message.sender_id, "agent1")
        self.assertEqual(processed_message.target_agent_id, "agent2")
        
        # Check that the message was sent to agent2
        self.assertEqual(len(websocket2.sent_messages), 1)
        sent_message = json.loads(websocket2.sent_messages[0])
        self.assertEqual(sent_message["type"], "message")
        self.assertEqual(sent_message["data"]["sender_id"], "agent1")
        self.assertEqual(sent_message["data"]["target_agent_id"], "agent2")
        self.assertEqual(sent_message["data"]["content"]["text"], "Hello, Agent 2!")
    
    async def _test_broadcast_message_handling(self):
        """Test broadcast message handling."""
        # Register three agents
        self.network.register_agent("agent1", {"name": "Agent 1"})
        self.network.register_agent("agent2", {"name": "Agent 2"})
        self.network.register_agent("agent3", {"name": "Agent 3"})
        
        # Create mock connections
        websocket1 = MockWebSocket()
        websocket2 = MockWebSocket()
        websocket3 = MockWebSocket()
        
        self.network.connections["agent1"] = MagicMock(
            agent_id="agent1",
            connection=websocket1,
            metadata={"name": "Agent 1"},
            last_activity=time.time()
        )
        
        self.network.connections["agent2"] = MagicMock(
            agent_id="agent2",
            connection=websocket2,
            metadata={"name": "Agent 2"},
            last_activity=time.time()
        )
        
        self.network.connections["agent3"] = MagicMock(
            agent_id="agent3",
            connection=websocket3,
            metadata={"name": "Agent 3"},
            last_activity=time.time()
        )
        
        # Create broadcast message
        broadcast_message = BroadcastMessage(
            sender_id="agent1",
            content={"text": "Hello, everyone!"},
            exclude_agent_ids=["agent3"]  # Exclude agent3
        )
        
        # Mock is_running property
        with patch.object(self.network, 'is_running', True):
            # Send the message
            result = await self.network.send_broadcast_message(broadcast_message)
        
        # Check result
        self.assertTrue(result)
        
        # Check that the message was processed by the protocol
        self.assertEqual(len(self.mock_protocol.processed_broadcast_messages), 1)
        processed_message = self.mock_protocol.processed_broadcast_messages[0]
        self.assertEqual(processed_message.sender_id, "agent1")
        
        # Check that the message was sent to agent2 but not to agent1 (sender) or agent3 (excluded)
        self.assertEqual(len(websocket1.sent_messages), 0)  # Sender doesn't receive own broadcast
        self.assertEqual(len(websocket2.sent_messages), 1)  # Agent2 receives the broadcast
        self.assertEqual(len(websocket3.sent_messages), 0)  # Agent3 is excluded
        
        # Check the message sent to agent2
        sent_message = json.loads(websocket2.sent_messages[0])
        self.assertEqual(sent_message["type"], "message")
        self.assertEqual(sent_message["data"]["sender_id"], "agent1")
        self.assertEqual(sent_message["data"]["content"]["text"], "Hello, everyone!")
    
    async def _test_protocol_message_handling(self):
        """Test protocol message handling."""
        # Register an agent
        self.network.register_agent("agent1", {"name": "Agent 1"})
        
        # Create mock connection
        websocket1 = MockWebSocket()
        
        self.network.connections["agent1"] = MagicMock(
            agent_id="agent1",
            connection=websocket1,
            metadata={"name": "Agent 1"},
            last_activity=time.time()
        )
        
        # Create protocol message
        protocol_message = ProtocolMessage(
            sender_id="agent1",
            protocol="MockProtocol",
            content={"action": "test"},
            direction="inbound",
            relevant_agent_id="agent1"
        )
        
        # Mock is_running property
        with patch.object(self.network, 'is_running', True):
            # Send the message
            result = await self.network.send_protocol_message(protocol_message)
        
        # Check result
        self.assertTrue(result)
        
        # Check that the message was processed by the protocol
        self.assertEqual(len(self.mock_protocol.processed_protocol_messages), 1)
        processed_message = self.mock_protocol.processed_protocol_messages[0]
        self.assertEqual(processed_message.sender_id, "agent1")
        self.assertEqual(processed_message.protocol, "MockProtocol")
        self.assertEqual(processed_message.content["action"], "test")
    
    def test_agent_registration(self):
        """Test agent registration."""
        self.loop.run_until_complete(self._test_agent_registration())
    
    def test_duplicate_agent_registration(self):
        """Test duplicate agent registration."""
        self.loop.run_until_complete(self._test_duplicate_agent_registration())
    
    def test_direct_message_handling(self):
        """Test direct message handling."""
        self.loop.run_until_complete(self._test_direct_message_handling())
    
    def test_broadcast_message_handling(self):
        """Test broadcast message handling."""
        self.loop.run_until_complete(self._test_broadcast_message_handling())
    
    def test_protocol_message_handling(self):
        """Test protocol message handling."""
        self.loop.run_until_complete(self._test_protocol_message_handling())
    
    def test_get_state(self):
        """Test getting network state."""
        # Register some agents
        self.network.register_agent("agent1", {"name": "Agent 1"})
        self.network.register_agent("agent2", {"name": "Agent 2"})
        
        # Get state
        state = self.network.get_state()
        
        # Check state
        self.assertEqual(state["network_id"], "test-network-id")
        self.assertEqual(state["network_name"], "TestNetwork")
        self.assertEqual(state["agent_count"], 2)
        self.assertEqual(state["connected_count"], 0)
        self.assertIn("MockProtocol", state["protocols"])
        self.assertEqual(state["protocols"]["MockProtocol"]["registered_agents"], ["agent1", "agent2"])


if __name__ == "__main__":
    unittest.main() 