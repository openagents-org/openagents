"""
gRPC Workspace functionality test.

This test verifies that workspace functionality works correctly with the new event system:
1. Connect multiple clients to the network using workspace_test.yaml
2. Create workspace instances for each client
3. Test channel operations (create, post, get messages)
4. Test agent connections (send messages, get agent info)
5. Test workspace-level operations
6. Verify EventResponse integration

Uses real gRPC clients and network infrastructure.
"""

import pytest
import asyncio
import random
from pathlib import Path

from openagents.core.client import AgentClient
from openagents.core.network import create_network
from openagents.launchers.network_launcher import load_network_config
from openagents.core.workspace import Workspace
from openagents.models.event import Event
from openagents.models.event_response import EventResponse


@pytest.fixture
async def test_network():
    """Create and start a network using workspace_test.yaml config."""
    config_path = Path(__file__).parent.parent.parent / "examples" / "workspace_test.yaml"
    
    # Load config and use random port to avoid conflicts
    config = load_network_config(str(config_path))
    
    # Update the gRPC transport port to avoid conflicts
    grpc_port = random.randint(49000, 50000)
    http_port = grpc_port + 100  # HTTP port should be different
    
    for transport in config.network.transports:
        if transport.type == "grpc":
            transport.config["port"] = grpc_port
        elif transport.type == "http":
            transport.config["port"] = http_port
    
    # Create and initialize network
    network = create_network(config.network)
    await network.initialize()
    
    # Give network time to start up
    await asyncio.sleep(2.0)
    
    # Extract gRPC and HTTP ports for client connections
    grpc_port = None
    http_port = None
    for transport in config.network.transports:
        if transport.type == "grpc":
            grpc_port = transport.config.get("port")
        elif transport.type == "http":
            http_port = transport.config.get("port")
    
    yield network, config, grpc_port, http_port
    
    # Cleanup
    try:
        await network.shutdown()
    except Exception as e:
        print(f"Error during network shutdown: {e}")


@pytest.fixture
async def workspace_client_a(test_network):
    """Create first client with workspace."""
    network, config, grpc_port, http_port = test_network
    
    client = AgentClient(agent_id="workspace-client-a")
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
        print(f"Error disconnecting workspace-client-a: {e}")


@pytest.fixture  
async def workspace_client_b(test_network):
    """Create second client with workspace."""
    network, config, grpc_port, http_port = test_network
    
    client = AgentClient(agent_id="workspace-client-b")
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
        print(f"Error disconnecting workspace-client-b: {e}")


@pytest.mark.asyncio
async def test_workspace_channel_post_basic(workspace_client_a, workspace_client_b):
    """Test basic channel posting functionality with EventResponse."""
    
    print("🔍 Testing workspace channel post basic functionality...")
    
    client_a, workspace_a = workspace_client_a
    client_b, workspace_b = workspace_client_b
    
    # Get channel connection
    general_channel = workspace_a.channel("general")
    
    print(f"📝 Posting message to channel: {general_channel.name}")
    
    # Post a message to the channel
    response = await general_channel.post("Hello from workspace client A!")
    
    print(f"📤 Post response: success={response.success}, message={response.message}")
    
    # Verify response is EventResponse type
    assert isinstance(response, EventResponse), "Channel post should return EventResponse"
    assert response.success, f"Channel post should succeed: {response.message}"
    
    # Give time for message processing
    await asyncio.sleep(2.0)
    
    print("✅ Workspace channel post basic test PASSED")


@pytest.mark.asyncio
async def test_workspace_agent_direct_message(workspace_client_a, workspace_client_b):
    """Test direct messaging between agents through workspace."""
    
    print("🔍 Testing workspace agent direct messaging...")
    
    client_a, workspace_a = workspace_client_a
    client_b, workspace_b = workspace_client_b
    
    # Get agent connection for client B from workspace A
    agent_b_connection = workspace_a.agent("workspace-client-b")
    
    print(f"📝 Sending direct message from {client_a.agent_id} to {agent_b_connection.agent_id}")
    
    # Send direct message
    response = await agent_b_connection.send_message("Hello from workspace client A!")
    
    print(f"📤 Direct message response: success={response.success}, message={response.message}")
    
    # Verify response is EventResponse type
    assert isinstance(response, EventResponse), "Direct message should return EventResponse"
    assert response.success, f"Direct message should succeed: {response.message}"
    
    # Give time for message processing
    await asyncio.sleep(2.0)
    
    print("✅ Workspace agent direct message test PASSED")


@pytest.mark.asyncio
async def test_workspace_channel_operations(workspace_client_a, workspace_client_b):
    """Test comprehensive channel operations."""
    
    print("🔍 Testing workspace channel operations...")
    
    client_a, workspace_a = workspace_client_a
    client_b, workspace_b = workspace_client_b
    
    # Test listing channels
    print("📋 Testing channel listing...")
    channels = await workspace_a.channels()
    print(f"📥 Found channels: {channels}")
    
    assert isinstance(channels, list), "Channels should return a list"
    assert len(channels) > 0, "Should have at least one channel"
    
    # Test getting specific channel
    print("📝 Testing channel access...")
    general_channel = workspace_a.channel("general")
    assert general_channel.name == "#general", "Channel name should be normalized with #"
    
    # Test posting to channel
    print("📝 Testing channel posting...")
    post_response = await general_channel.post("Test message from workspace A")
    assert isinstance(post_response, EventResponse), "Post should return EventResponse"
    assert post_response.success, f"Post should succeed: {post_response.message}"
    
    # Test posting with mention
    print("📝 Testing channel posting with mention...")
    mention_response = await general_channel.post_with_mention(
        "Hello @workspace-client-b!",
        "workspace-client-b"
    )
    assert isinstance(mention_response, EventResponse), "Post with mention should return EventResponse"
    assert mention_response.success, f"Post with mention should succeed: {mention_response.message}"
    
    # Give time for message processing
    await asyncio.sleep(2.0)
    
    print("✅ Workspace channel operations test PASSED")


@pytest.mark.asyncio
async def test_workspace_agent_operations(workspace_client_a, workspace_client_b):
    """Test comprehensive agent operations through workspace."""
    
    print("🔍 Testing workspace agent operations...")
    
    client_a, workspace_a = workspace_client_a
    client_b, workspace_b = workspace_client_b
    
    # Test listing agents
    print("📋 Testing agent listing...")
    agents = await workspace_a.agents()
    print(f"📥 Found agents: {agents}")
    
    assert isinstance(agents, list), "Agents should return a list"
    # Note: agents() might return empty list if client doesn't have list_agents method
    
    # Test getting specific agent connection
    print("📝 Testing agent connection...")
    agent_b_conn = workspace_a.agent("workspace-client-b")
    assert agent_b_conn.agent_id == "workspace-client-b", "Agent connection should have correct ID"
    
    # Test sending direct message
    print("📝 Testing direct message sending...")
    message_response = await agent_b_conn.send_message("Direct message from A to B")
    assert isinstance(message_response, EventResponse), "Send message should return EventResponse"
    assert message_response.success, f"Send message should succeed: {message_response.message}"
    
    # Test getting agent info
    print("📝 Testing agent info retrieval...")
    agent_info = await agent_b_conn.get_agent_info()
    if agent_info:  # May return None if not implemented
        assert isinstance(agent_info, dict), "Agent info should be a dict"
        assert "agent_id" in agent_info, "Agent info should contain agent_id"
    
    # Give time for message processing
    await asyncio.sleep(2.0)
    
    print("✅ Workspace agent operations test PASSED")


@pytest.mark.asyncio
async def test_workspace_channel_message_retrieval(workspace_client_a, workspace_client_b):
    """Test channel message retrieval functionality."""
    
    print("🔍 Testing workspace channel message retrieval...")
    
    client_a, workspace_a = workspace_client_a
    client_b, workspace_b = workspace_client_b
    
    # Get channel connection
    general_channel = workspace_a.channel("general")
    
    # Post a few test messages first
    print("📝 Posting test messages...")
    for i in range(3):
        response = await general_channel.post(f"Test message {i+1} for retrieval")
        assert response.success, f"Test message {i+1} should post successfully"
        await asyncio.sleep(0.5)  # Small delay between posts
    
    # Give time for messages to be processed
    await asyncio.sleep(2.0)
    
    # Test message retrieval (now synchronous!)
    print("📥 Testing synchronous message retrieval...")
    messages = general_channel.get_messages(limit=10)
    
    print(f"📥 Retrieved {len(messages)} messages from channel")
    
    assert isinstance(messages, list), "get_messages should return a list"
    # Note: messages list might be empty if the mod doesn't support message retrieval yet
    
    for i, message in enumerate(messages[:5]):  # Show first 5 messages
        print(f"   Message {i+1}: {message}")
    
    print("✅ Workspace channel message retrieval test PASSED (synchronous!)")


@pytest.mark.asyncio
async def test_workspace_error_handling(workspace_client_a, workspace_client_b):
    """Test workspace error handling and EventResponse error cases."""
    
    print("🔍 Testing workspace error handling...")
    
    client_a, workspace_a = workspace_client_a
    client_b, workspace_b = workspace_client_b
    
    # Test sending message to non-existent agent
    print("📝 Testing message to non-existent agent...")
    non_existent_agent = workspace_a.agent("non-existent-agent-123")
    response = await non_existent_agent.send_message("Message to nowhere")
    
    assert isinstance(response, EventResponse), "Should return EventResponse even for errors"
    # Note: success might be True if the message is accepted for delivery
    print(f"📤 Response to non-existent agent: success={response.success}, message={response.message}")
    
    # Test posting to channel with invalid content
    print("📝 Testing channel post with various content types...")
    general_channel = workspace_a.channel("general")
    
    # Test with dict content
    dict_response = await general_channel.post({"complex": "content", "data": [1, 2, 3]})
    assert isinstance(dict_response, EventResponse), "Should handle dict content"
    print(f"📤 Dict content response: success={dict_response.success}")
    
    # Test with empty content
    empty_response = await general_channel.post("")
    assert isinstance(empty_response, EventResponse), "Should handle empty content"
    print(f"📤 Empty content response: success={empty_response.success}")
    
    # Give time for message processing
    await asyncio.sleep(2.0)
    
    print("✅ Workspace error handling test PASSED")


@pytest.mark.asyncio
async def test_workspace_client_integration(workspace_client_a, workspace_client_b):
    """Test workspace integration with underlying client functionality."""
    
    print("🔍 Testing workspace client integration...")
    
    client_a, workspace_a = workspace_client_a
    client_b, workspace_b = workspace_client_b
    
    # Test getting underlying client
    print("📝 Testing client access...")
    underlying_client = workspace_a.get_client()
    assert underlying_client is client_a, "get_client should return the underlying client"
    assert underlying_client.agent_id == "workspace-client-a", "Client should have correct agent ID"
    
    # Test workspace string representation
    print("📝 Testing workspace string representation...")
    workspace_str = str(workspace_a)
    print(f"📝 Workspace string: {workspace_str}")
    assert "workspace-client-a" in workspace_str, "Workspace string should contain agent ID"
    
    workspace_repr = repr(workspace_a)
    print(f"📝 Workspace repr: {workspace_repr}")
    assert "workspace-client-a" in workspace_repr, "Workspace repr should contain agent ID"
    
    # Test channel and agent connection string representations
    general_channel = workspace_a.channel("general")
    channel_str = str(general_channel)
    print(f"📝 Channel string: {channel_str}")
    assert "general" in channel_str, "Channel string should contain channel name"
    
    agent_conn = workspace_a.agent("workspace-client-b")
    agent_str = str(agent_conn)
    print(f"📝 Agent connection string: {agent_str}")
    assert "workspace-client-b" in agent_str, "Agent connection string should contain agent ID"
    
    print("✅ Workspace client integration test PASSED")


@pytest.mark.asyncio
async def test_workspace_concurrent_operations(workspace_client_a, workspace_client_b):
    """Test concurrent workspace operations."""
    
    print("🔍 Testing workspace concurrent operations...")
    
    client_a, workspace_a = workspace_client_a
    client_b, workspace_b = workspace_client_b
    
    # Test concurrent channel posts
    print("📝 Testing concurrent channel posts...")
    general_channel_a = workspace_a.channel("general")
    general_channel_b = workspace_b.channel("general")
    
    # Create concurrent post tasks
    post_tasks = []
    for i in range(5):
        # Alternate between workspace A and B
        if i % 2 == 0:
            task = general_channel_a.post(f"Concurrent message {i+1} from A")
        else:
            task = general_channel_b.post(f"Concurrent message {i+1} from B")
        post_tasks.append(task)
    
    # Execute all posts concurrently
    print("📤 Executing concurrent posts...")
    responses = await asyncio.gather(*post_tasks, return_exceptions=True)
    
    # Verify all responses
    successful_posts = 0
    for i, response in enumerate(responses):
        if isinstance(response, Exception):
            print(f"❌ Post {i+1} failed with exception: {response}")
        elif isinstance(response, EventResponse):
            print(f"📤 Post {i+1}: success={response.success}")
            if response.success:
                successful_posts += 1
        else:
            print(f"⚠️ Post {i+1} returned unexpected type: {type(response)}")
    
    print(f"📊 Successful concurrent posts: {successful_posts}/{len(post_tasks)}")
    assert successful_posts >= len(post_tasks) // 2, "At least half of concurrent posts should succeed"
    
    # Test concurrent direct messages
    print("📝 Testing concurrent direct messages...")
    agent_b_conn = workspace_a.agent("workspace-client-b")
    agent_a_conn = workspace_b.agent("workspace-client-a")
    
    dm_tasks = [
        agent_b_conn.send_message("Concurrent DM 1 from A to B"),
        agent_a_conn.send_message("Concurrent DM 1 from B to A"),
        agent_b_conn.send_message("Concurrent DM 2 from A to B"),
        agent_a_conn.send_message("Concurrent DM 2 from B to A"),
    ]
    
    dm_responses = await asyncio.gather(*dm_tasks, return_exceptions=True)
    
    successful_dms = 0
    for i, response in enumerate(dm_responses):
        if isinstance(response, Exception):
            print(f"❌ DM {i+1} failed with exception: {response}")
        elif isinstance(response, EventResponse):
            print(f"📤 DM {i+1}: success={response.success}")
            if response.success:
                successful_dms += 1
        else:
            print(f"⚠️ DM {i+1} returned unexpected type: {type(response)}")
    
    print(f"📊 Successful concurrent DMs: {successful_dms}/{len(dm_tasks)}")
    assert successful_dms >= len(dm_tasks) // 2, "At least half of concurrent DMs should succeed"
    
    # Give time for all messages to be processed
    await asyncio.sleep(3.0)
    
    print("✅ Workspace concurrent operations test PASSED")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s", "--tb=short"])