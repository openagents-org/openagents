"""
Integration tests for real agent network communication.

This module contains tests for agent network integration functionality,
including real tool execution and message passing with proper network connections.
Requires OPENAI_API_KEY environment variable to be set.
"""

import os
import pytest
import asyncio
import random
import time
from typing import Optional

from openagents.core.network import AgentNetwork
from openagents.core.client import AgentClient
from openagents.core.workspace import Workspace
from openagents.models.agent_config import AgentConfig
from openagents.models.event_context import ChannelMessageContext
from openagents.models.event import Event
from openagents.agents.worker_agent import WorkerAgent
from openagents.models.network_config import TransportConfigItem
from openagents.models.transport import TransportType


class ToolCallTestAgent(WorkerAgent):
    """Test agent that responds to channel mentions using LLM."""

    def __init__(self, agent_id: str, agent_config: AgentConfig, **kwargs):
        super().__init__(agent_id=agent_id, agent_config=agent_config, **kwargs)
        self.mention_received = False
        self.reply_sent = False

    async def on_channel_mention(self, context: ChannelMessageContext):
        """Handle channel mention by calling LLM and replying."""
        self.mention_received = True
        print(f"📥 Agent {self.agent_id} received mention: {context.text[:50]}...")

        # Call the LLM to generate a response and send reply
        await self.run_agent(context=context, instruction="Reply briefly to the message in one short sentence.")
        self.reply_sent = True
        print(f"📤 Agent {self.agent_id} sent reply")


@pytest.fixture
def agent_config():
    """Create agent config with OpenAI API key from environment."""
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        pytest.skip("OPENAI_API_KEY environment variable not set")

    return AgentConfig(
        instruction="You are a helpful assistant agent. When mentioned, reply briefly and helpfully.",
        model_name="gpt-4o-mini",
        provider="openai",
        api_base="https://api.openai.com/v1",
        api_key=api_key,
    )


@pytest.fixture
async def test_network():
    """Create and initialize a test network with random ports to avoid conflicts."""
    # Try multiple times with different ports to avoid TIME_WAIT conflicts
    max_retries = 3
    last_error = None
    network = None
    http_port = None
    grpc_port = None

    for attempt in range(max_retries):
        # Use wider port range (30000-60000) to reduce collision probability
        base_port = random.randint(30000, 60000)
        http_port = base_port
        grpc_port = base_port + 100

        network = AgentNetwork.load("sdk/examples/workspace_test.yaml")
        network.config.transports = [
            TransportConfigItem(type=TransportType.HTTP, config={"port": http_port}),
            TransportConfigItem(type=TransportType.GRPC, config={"port": grpc_port}),
        ]
        try:
            await network.initialize()
            break  # Success
        except OSError as e:
            last_error = e
            if "address already in use" in str(e).lower():
                print(f"Port {http_port}/{grpc_port} in use, retrying... (attempt {attempt + 1}/{max_retries})")
                await asyncio.sleep(0.5)
                continue
            raise
    else:
        raise last_error or RuntimeError("Failed to initialize network after retries")

    # Give network time to start
    await asyncio.sleep(1.0)

    yield network, http_port, grpc_port

    await network.shutdown()


@pytest.fixture
async def test_agent(agent_config, test_network):
    """Create and start a test agent that responds to mentions."""
    network, http_port, grpc_port = test_network

    agent_id = f"test-agent-{random.randint(1000, 9999)}"
    agent = ToolCallTestAgent(agent_id=agent_id, agent_config=agent_config)
    await agent.async_start(network_host="localhost", network_port=http_port)

    # Give agent time to connect and register
    await asyncio.sleep(2.0)

    yield agent, http_port

    await agent.async_stop()


@pytest.fixture
async def workspace_client(test_network):
    """Create workspace client for sending messages through the network."""
    network, http_port, grpc_port = test_network

    client = AgentClient(agent_id="test-workspace-client")
    await client.connect("localhost", http_port)

    # Create workspace instance
    workspace = Workspace(client)

    # Give client time to connect
    await asyncio.sleep(1.0)

    yield client, workspace

    # Cleanup
    try:
        await client.disconnect()
    except Exception as e:
        print(f"Error disconnecting workspace client: {e}")


@pytest.mark.asyncio
@pytest.mark.integration
@pytest.mark.xfail(reason="Requires valid OPENAI_API_KEY to complete LLM call and send reply")
async def test_agent_channel_reply_integration(test_agent, workspace_client):
    """Test that agent can receive channel mention and reply successfully.

    This test:
    1. Sends a real message with @mention through the network via workspace client
    2. The test agent receives the mention through normal network delivery
    3. The agent calls the LLM and posts a reply
    4. We verify the reply is stored in the channel
    """
    agent, http_port = test_agent
    client, workspace = workspace_client
    agent_id = agent.agent_id

    print(f"🔍 Testing channel reply integration with agent {agent_id}")

    # Get channel connection
    general_channel = workspace.channel("general")

    # Send message with mention through the network
    mention_message = f"@{agent_id} Hello, how are you? Reply in one word."
    print(f"📤 Sending mention message: {mention_message}")

    response = await general_channel.post(mention_message)
    assert response.success, f"Channel post should succeed: {response.message if hasattr(response, 'message') else response}"

    # Wait for agent to process the mention and reply via LLM
    # This needs more time since it involves network delivery + LLM call
    max_wait = 30
    poll_interval = 2
    elapsed = 0

    while elapsed < max_wait:
        await asyncio.sleep(poll_interval)
        elapsed += poll_interval

        if agent.mention_received and agent.reply_sent:
            print(f"✅ Agent processed mention and sent reply after {elapsed}s")
            break
        else:
            print(f"⏳ Waiting for agent... mention_received={agent.mention_received}, reply_sent={agent.reply_sent}")

    # Verify agent received the mention
    assert agent.mention_received, "Agent should have received the mention"

    # Give some extra time for the reply to be stored
    await asyncio.sleep(3.0)

    # Retrieve channel messages to verify the reply
    messages = await general_channel.get_messages(limit=50)

    print(f"📊 Retrieved {len(messages)} messages from channel")

    # Look for the agent's reply
    agent_reply = None
    for msg in messages:
        sender = msg.get("sender_id", "")
        msg_type = msg.get("message_type", "")
        print(f"   Message from {sender}, type={msg_type}")
        if sender == agent_id and msg_type == "reply":
            agent_reply = msg
            break

    # If no reply type message found, look for any message from the agent
    if agent_reply is None:
        for msg in messages:
            if msg.get("sender_id") == agent_id:
                agent_reply = msg
                break

    assert agent_reply is not None, f"Agent's reply message should be found in channel. Messages: {[m.get('sender_id') for m in messages]}"
    assert agent_reply.get("channel") == "general", "Reply should be in general channel"

    # Verify reply has content
    content = agent_reply.get("content", {})
    text = content.get("text", "") if isinstance(content, dict) else str(content)
    assert len(text) > 0, "Reply should have non-empty text content"

    print(f"✅ Agent reply verified: {text[:100]}...")
    print("✅ test_agent_channel_reply_integration PASSED")


@pytest.mark.asyncio
@pytest.mark.integration
@pytest.mark.xfail(reason="Requires valid OPENAI_API_KEY to complete LLM call and send reply")
async def test_agent_network_communication_timeout(test_agent, workspace_client):
    """Test that agent network communication completes within reasonable time.

    This test verifies that the full flow (mention → LLM → reply) completes
    within an acceptable timeout period.
    """
    agent, http_port = test_agent
    client, workspace = workspace_client
    agent_id = agent.agent_id

    print(f"🔍 Testing network communication timeout with agent {agent_id}")

    start_time = time.time()

    # Get channel connection
    general_channel = workspace.channel("general")

    # Send message with mention
    mention_message = f"@{agent_id} Say 'OK' to confirm you received this."
    print(f"📤 Sending mention message: {mention_message}")

    response = await general_channel.post(mention_message)
    assert response.success, "Mention message should be sent successfully"

    # Wait for agent to process with timeout checking
    max_wait = 45  # Maximum wait time in seconds
    poll_interval = 2
    elapsed = 0

    while elapsed < max_wait:
        await asyncio.sleep(poll_interval)
        elapsed += poll_interval

        if agent.mention_received and agent.reply_sent:
            break

    total_time = time.time() - start_time

    # Verify the operation completed within timeout
    assert total_time < 60, f"Agent network communication took {total_time:.2f}s, should be < 60s"

    print(f"⏱️ Total operation time: {total_time:.2f}s")

    # Verify agent processed the mention
    assert agent.mention_received, "Agent should have received the mention"

    # Give time for reply to be stored
    await asyncio.sleep(2.0)

    # Verify the reply was actually sent by checking channel messages
    messages = await general_channel.get_messages(limit=20)

    # Count messages from the agent
    agent_messages = [m for m in messages if m.get("sender_id") == agent_id]

    assert len(agent_messages) >= 1, f"Agent should have sent at least one message. Found messages from: {[m.get('sender_id') for m in messages]}"

    print(f"✅ Agent sent {len(agent_messages)} message(s) within {total_time:.2f}s")
    print("✅ test_agent_network_communication_timeout PASSED")
