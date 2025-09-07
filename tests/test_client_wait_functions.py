"""
Tests for AgentClient wait functions in OpenAgents.

This module tests the wait_direct_message, wait_broadcast_message, and wait_mod_message
functions that allow clients to wait for specific messages with conditions and timeouts.
"""

import asyncio
import pytest
import logging
import random
from typing import List, Dict, Any

from openagents.core.network import AgentNetwork
from openagents.core.client import AgentClient
from openagents.models.network_config import NetworkConfig, NetworkMode
from openagents.models.messages import Event, EventNames
from openagents.agents.simple_echo_agent import SimpleEchoAgentRunner

# Configure logging for tests
logger = logging.getLogger(__name__)


class TestClientWaitFunctions:
    """Test cases for AgentClient wait functions."""

    @pytest.fixture(autouse=True)
    async def setup_and_teardown(self):
        """Set up and tear down test environment."""
        # Initialize test data
        self.host = "127.0.0.1"
        self.port = random.randint(9000, 9099)
        self.network = None
        self.clients: List[AgentClient] = []
        self.agents: List[SimpleEchoAgentRunner] = []
        
        logger.info(f"Setting up test environment on {self.host}:{self.port}")
        
        # Setup is done, yield control back to the test
        yield
        
        # Clean up after the test
        logger.info("Cleaning up test environment...")
        
        # Disconnect all clients
        for client in self.clients:
            try:
                if client.connector:
                    await client.disconnect()
            except Exception as e:
                logger.warning(f"Error disconnecting client {client.agent_id}: {e}")
        
        # Stop all agents
        for agent in self.agents:
            try:
                await agent.async_stop()
            except Exception as e:
                logger.warning(f"Error stopping agent {agent.agent_id}: {e}")
        
        # Shutdown network
        if self.network:
            try:
                await self.network.shutdown()
            except Exception as e:
                logger.warning(f"Error shutting down network: {e}")
        
        logger.info("Test cleanup completed")

    async def create_network(self) -> AgentNetwork:
        """Create and initialize a test network."""
        config = NetworkConfig(
            name="TestWaitFunctionsNetwork",
            mode=NetworkMode.CENTRALIZED,
            host=self.host,
            port=self.port,
            server_mode=True,
            transport="websocket"
        )
        
        network = AgentNetwork(config)
        await network.initialize()
        self.network = network
        return network

    async def create_client(self, agent_id: str) -> AgentClient:
        """Create and connect a test client."""
        client = AgentClient(agent_id)
        await client.connect(self.host, self.port)
        self.clients.append(client)
        return client

    async def create_echo_agent(self, agent_id: str) -> SimpleEchoAgentRunner:
        """Create and start an echo agent."""
        agent = SimpleEchoAgentRunner(agent_id, "Echo")
        await agent.async_start(self.host, self.port)
        self.agents.append(agent)
        return agent

    @pytest.mark.asyncio
    async def test_wait_direct_message_basic(self):
        """Test basic wait_direct_message functionality."""
        logger.info("Testing basic wait_direct_message...")
        
        # Create network and agents
        await self.create_network()
        echo_agent = await self.create_echo_agent("echo-agent")
        client = await self.create_client("test-client")
        
        # Wait a moment for connections to stabilize
        await asyncio.sleep(0.5)
        
        # Send a message and wait for response
        msg = Event(event_name="agent.direct_message.sent", source_id="test-client", target_agent_id="echo-agent", payload={"text": "Hello Echo!", "message_type": "direct_message"})
        
        # Send message and immediately start waiting
        await client.send_direct_message(msg)
        
        # Wait for response
        response = await client.wait_direct_message(timeout=5.0)
        
        # Verify response
        assert response is not None, "Should receive a response from echo agent"
        assert response.source_id == "echo-agent", f"Response should be from echo-agent, got {response.source_id}"
        assert "Echo: Hello Echo!" in response.payload.get("text", ""), f"Response should contain echoed text, got {response.payload}"
        
        logger.info("✅ Basic wait_direct_message test passed")

    @pytest.mark.asyncio
    async def test_wait_direct_message_with_condition(self):
        """Test wait_direct_message with condition filtering."""
        logger.info("Testing wait_direct_message with condition...")
        
        # Create network and agents
        await self.create_network()
        echo_agent = await self.create_echo_agent("echo-agent")
        client = await self.create_client("test-client")
        
        # Wait a moment for connections to stabilize
        await asyncio.sleep(0.5)
        
        # Send a message
        msg = Event(event_name="agent.direct_message.sent", source_id="test-client", target_agent_id="echo-agent", payload={"text": "Test condition filtering", "message_type": "direct_message"}
        )
        await client.send_direct_message(msg)
        
        # Wait for response from specific sender with condition
        response = await client.wait_direct_message(
            condition=lambda msg: msg.source_id == "echo-agent" and "condition" in msg.payload.get("text", ""),
            timeout=5.0
        )
        
        # Verify response
        assert response is not None, "Should receive a response matching condition"
        assert response.source_id == "echo-agent", "Response should be from echo-agent"
        assert "condition" in response.payload.get("text", ""), "Response should contain 'condition'"
        
        logger.info("✅ Conditional wait_direct_message test passed")

    @pytest.mark.asyncio
    async def test_wait_direct_message_timeout(self):
        """Test wait_direct_message timeout behavior."""
        logger.info("Testing wait_direct_message timeout...")
        
        # Create network and client (no echo agent to respond)
        await self.create_network()
        client = await self.create_client("test-client")
        
        # Wait a moment for connections to stabilize
        await asyncio.sleep(0.5)
        
        # Wait for a message that will never come
        start_time = asyncio.get_event_loop().time()
        response = await client.wait_direct_message(timeout=2.0)
        end_time = asyncio.get_event_loop().time()
        
        # Verify timeout behavior
        assert response is None, "Should return None on timeout"
        elapsed_time = end_time - start_time
        assert 1.8 <= elapsed_time <= 2.5, f"Should timeout after ~2 seconds, took {elapsed_time:.2f}s"
        
        logger.info("✅ Timeout wait_direct_message test passed")

    @pytest.mark.asyncio
    async def test_wait_broadcast_message(self):
        """Test wait_broadcast_message functionality."""
        logger.info("Testing wait_broadcast_message...")
        
        # Create network and clients
        await self.create_network()
        sender_client = await self.create_client("sender-client")
        receiver_client = await self.create_client("receiver-client")
        
        # Wait a moment for connections to stabilize
        await asyncio.sleep(0.5)
        
        # Start waiting for broadcast message
        wait_task = asyncio.create_task(
            receiver_client.wait_broadcast_message(timeout=5.0)
        )
        
        # Give the wait task a moment to start
        await asyncio.sleep(0.1)
        
        # Send broadcast message
        broadcast_msg = Event(event_name="agent.broadcast_message.sent", source_id="sender-client", payload={"text": "Hello everyone!", "message_type": "broadcast_message"}
        )
        await sender_client.send_broadcast_message(broadcast_msg)
        
        # Wait for the response
        response = await wait_task
        
        # Verify response
        assert response is not None, "Should receive broadcast message"
        assert response.source_id == "sender-client", "Broadcast should be from sender-client"
        assert "Hello everyone!" in response.payload.get("text", ""), "Should contain broadcast text"
        
        logger.info("✅ Broadcast message wait test passed")

    @pytest.mark.asyncio
    async def test_wait_mod_message_timeout(self):
        """Test wait_mod_message timeout (no mod messages expected in basic setup)."""
        logger.info("Testing wait_mod_message timeout...")
        
        # Create network and client
        await self.create_network()
        client = await self.create_client("test-client")
        
        # Wait a moment for connections to stabilize
        await asyncio.sleep(0.5)
        
        # Wait for mod message that won't come
        start_time = asyncio.get_event_loop().time()
        response = await client.wait_mod_message(timeout=1.0)
        end_time = asyncio.get_event_loop().time()
        
        # Verify timeout behavior
        assert response is None, "Should return None on timeout (no mod messages expected)"
        elapsed_time = end_time - start_time
        assert 0.8 <= elapsed_time <= 1.5, f"Should timeout after ~1 second, took {elapsed_time:.2f}s"
        
        logger.info("✅ Mod message timeout test passed")

    @pytest.mark.asyncio
    async def test_multiple_concurrent_waiters(self):
        """Test multiple clients waiting for messages concurrently."""
        logger.info("Testing multiple concurrent waiters...")
        
        # Create network and agents
        await self.create_network()
        echo_agent = await self.create_echo_agent("echo-agent")
        client1 = await self.create_client("client-1")
        client2 = await self.create_client("client-2")
        
        # Wait a moment for connections to stabilize
        await asyncio.sleep(0.5)
        
        # Start both clients waiting
        wait_task1 = asyncio.create_task(
            client1.wait_direct_message(
                condition=lambda msg: "client-1" in msg.payload.get("text", ""),
                timeout=5.0
            )
        )
        wait_task2 = asyncio.create_task(
            client2.wait_direct_message(
                condition=lambda msg: "client-2" in msg.payload.get("text", ""),
                timeout=5.0
            )
        )
        
        # Give wait tasks a moment to start
        await asyncio.sleep(0.1)
        
        # Send messages to trigger responses
        msg1 = Event(event_name="agent.direct_message.sent", source_id="client-1", target_agent_id="echo-agent", payload={"text": "Message for client-1", "message_type": "direct_message"}
        )
        msg2 = Event(event_name="agent.direct_message.sent", source_id="client-2", target_agent_id="echo-agent", payload={"text": "Message for client-2", "message_type": "direct_message"}
        )
        
        await client1.send_direct_message(msg1)
        await client2.send_direct_message(msg2)
        
        # Wait for both responses
        response1, response2 = await asyncio.gather(wait_task1, wait_task2)
        
        # Verify both responses
        assert response1 is not None, "Client 1 should receive response"
        assert response2 is not None, "Client 2 should receive response"
        assert "client-1" in response1.payload.get("text", ""), "Response 1 should contain 'client-1'"
        assert "client-2" in response2.payload.get("text", ""), "Response 2 should contain 'client-2'"
        
        logger.info("✅ Multiple concurrent waiters test passed")

    @pytest.mark.asyncio
    async def test_wait_function_cleanup(self):
        """Test that wait functions properly clean up after timeout or completion."""
        logger.info("Testing wait function cleanup...")
        
        # Create network and client
        await self.create_network()
        client = await self.create_client("test-client")
        
        # Wait a moment for connections to stabilize
        await asyncio.sleep(0.5)
        
        # Check initial state
        initial_waiters = len(client._message_waiters["direct_message"])
        
        # Start a wait that will timeout
        response = await client.wait_direct_message(timeout=0.5)
        
        # Check that waiters list is cleaned up
        final_waiters = len(client._message_waiters["direct_message"])
        
        assert response is None, "Should timeout and return None"
        assert final_waiters == initial_waiters, "Waiters list should be cleaned up after timeout"
        
        logger.info("✅ Wait function cleanup test passed")
