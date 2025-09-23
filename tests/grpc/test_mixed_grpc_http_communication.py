"""
Mixed gRPC-HTTP client communication test.

This test verifies that clients using different transport types can communicate:
1. One client connects using gRPC transport (enforced)
2. Another client connects using HTTP transport (enforced)  
3. Both clients can send events to each other
4. Messages are properly routed between different transport types

No mocks - uses real gRPC and HTTP clients with network infrastructure.
"""

import pytest
import asyncio
import random
from pathlib import Path

from openagents.core.client import AgentClient
from openagents.core.network import create_network
from openagents.launchers.network_launcher import load_network_config
from openagents.models.event import Event
from openagents.models.network_config import NetworkMode
from openagents.core.topology import NetworkMode as TopologyNetworkMode


@pytest.fixture
async def test_network():
    """Create and start a network using workspace_test.yaml config."""
    config_path = Path(__file__).parent.parent.parent / "examples" / "workspace_test.yaml"
    
    # Load config and use random port to avoid conflicts
    config = load_network_config(str(config_path))
    
    # Update the gRPC and HTTP transport ports to avoid conflicts
    grpc_port = random.randint(47000, 48000)
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
    await asyncio.sleep(1.0)
    
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
async def grpc_client(test_network):
    """Create gRPC client with enforced gRPC transport."""
    network, config, grpc_port, http_port = test_network
    
    client = AgentClient(agent_id="grpc-client")
    # Use enforce_transport_type to force gRPC transport selection
    await client.connect("localhost", http_port, enforce_transport_type="grpc")
    
    # Give client time to connect
    await asyncio.sleep(1.0)
    
    yield client
    
    # Cleanup
    try:
        await client.disconnect()
    except Exception as e:
        print(f"Error disconnecting grpc-client: {e}")


@pytest.fixture  
async def http_client(test_network):
    """Create HTTP client with enforced HTTP transport."""
    network, config, grpc_port, http_port = test_network
    
    client = AgentClient(agent_id="http-client")
    # Use enforce_transport_type to force HTTP transport selection
    await client.connect("localhost", http_port, enforce_transport_type="http")
    
    # Give client time to connect
    await asyncio.sleep(1.0)
    
    yield client
    
    # Cleanup
    try:
        await client.disconnect()
    except Exception as e:
        print(f"Error disconnecting http-client: {e}")


@pytest.mark.asyncio
async def test_grpc_to_http_communication(grpc_client, http_client):
    """Test that gRPC client can send events to HTTP client."""
    
    print("🔍 Testing gRPC to HTTP client communication...")
    
    # Verify clients are using different connector types
    assert hasattr(grpc_client, 'connector'), "gRPC client should have a connector"
    assert hasattr(http_client, 'connector'), "HTTP client should have a connector"
    print(f"🔧 gRPC Client connector type: {type(grpc_client.connector).__name__}")
    print(f"🔧 HTTP Client connector type: {type(http_client.connector).__name__}")
    
    # Verify they're using different transport types
    assert "GRPC" in type(grpc_client.connector).__name__, "Should be using gRPC connector"
    assert "HTTP" in type(http_client.connector).__name__, "Should be using HTTP connector"
    
    # Create a test event from gRPC client to HTTP client
    test_event = Event(
        event_name="mixed.grpc_to_http",
        source_id="grpc-client", 
        destination_id="http-client",
        payload={"text": "Hello from gRPC client to HTTP client!", "test_id": "grpc_to_http_test"},
        event_id="mixed-grpc-to-http-001"
    )
    
    # Clear any existing received messages
    http_client_messages = []
    
    # Set up message handler for HTTP client to capture received events
    async def message_handler(event):
        print(f"📨 HTTP Client received event: {event.event_name} from {event.source_id}")
        print(f"   Payload: {event.payload}")
        http_client_messages.append(event)
    
    # Register the handler
    http_client.register_event_handler(message_handler, ["mixed.grpc_to_http"])
    
    print("✅ Mixed clients connected, sending event from gRPC to HTTP...")
    
    # gRPC client sends event to HTTP client
    print(f"🔧 DEBUG: gRPC client sending event: {test_event.event_name}")
    try:
        success = await grpc_client.send_event(test_event)
        print(f"📤 gRPC to HTTP Send result: {success}")
        assert success, "gRPC client should be able to send event to HTTP client"
    except Exception as e:
        print(f"❌ ERROR during gRPC to HTTP send_event: {e}")
        raise
    
    # Wait for message processing and polling
    print("⏳ Waiting for mixed transport message processing...")
    
    # Give time for message routing and polling
    for i in range(10):  # Wait up to 10 seconds
        await asyncio.sleep(1.0)
        
        # Check if we received the message
        if http_client_messages:
            break
        
        print(f"   Checking after {i+1} seconds...")
    
    # Verify HTTP client received the event
    print(f"📥 HTTP Client received {len(http_client_messages)} messages")
    
    for msg in http_client_messages:
        print(f"   Message: {msg.event_name} from {msg.source_id}")
        print(f"   Payload: {msg.payload}")
    
    # Find our test message
    test_messages = [
        msg for msg in http_client_messages 
        if (msg.source_id == "grpc-client" and 
            msg.payload and 
            msg.payload.get("test_id") == "grpc_to_http_test")
    ]
    
    assert len(test_messages) >= 1, f"HTTP client should have received test message from gRPC client. Got {len(http_client_messages)} total messages"
    
    received_event = test_messages[0]
    assert received_event.event_name == "mixed.grpc_to_http"
    assert received_event.source_id == "grpc-client"
    assert received_event.destination_id == "http-client"
    assert received_event.payload["text"] == "Hello from gRPC client to HTTP client!"
    assert received_event.payload["test_id"] == "grpc_to_http_test"
    
    print("✅ gRPC to HTTP communication test PASSED")
    print(f"   gRPC client successfully sent event to HTTP client")
    print(f"   Message received with correct content: {received_event.payload['text']}")


@pytest.mark.asyncio
async def test_http_to_grpc_communication(grpc_client, http_client):
    """Test that HTTP client can send events to gRPC client."""
    
    print("🔍 Testing HTTP to gRPC client communication...")
    
    # Create a test event from HTTP client to gRPC client
    test_event = Event(
        event_name="mixed.http_to_grpc",
        source_id="http-client", 
        destination_id="grpc-client",
        payload={"text": "Hello from HTTP client to gRPC client!", "test_id": "http_to_grpc_test"},
        event_id="mixed-http-to-grpc-001"
    )
    
    # Clear any existing received messages
    grpc_client_messages = []
    
    # Set up message handler for gRPC client to capture received events
    async def message_handler(event):
        print(f"📨 gRPC Client received event: {event.event_name} from {event.source_id}")
        print(f"   Payload: {event.payload}")
        grpc_client_messages.append(event)
    
    # Register the handler
    grpc_client.register_event_handler(message_handler, ["mixed.http_to_grpc"])
    
    print("✅ Mixed clients connected, sending event from HTTP to gRPC...")
    
    # HTTP client sends event to gRPC client
    print(f"🔧 DEBUG: HTTP client sending event: {test_event.event_name}")
    try:
        success = await http_client.send_event(test_event)
        print(f"📤 HTTP to gRPC Send result: {success}")
        assert success, "HTTP client should be able to send event to gRPC client"
    except Exception as e:
        print(f"❌ ERROR during HTTP to gRPC send_event: {e}")
        raise
    
    # Wait for message processing and polling
    print("⏳ Waiting for mixed transport message processing...")
    
    # Give time for message routing and polling
    for i in range(10):  # Wait up to 10 seconds
        await asyncio.sleep(1.0)
        
        # Check if we received the message
        if grpc_client_messages:
            break
        
        print(f"   Checking after {i+1} seconds...")
    
    # Verify gRPC client received the event
    print(f"📥 gRPC Client received {len(grpc_client_messages)} messages")
    
    for msg in grpc_client_messages:
        print(f"   Message: {msg.event_name} from {msg.source_id}")
        print(f"   Payload: {msg.payload}")
    
    # Find our test message
    test_messages = [
        msg for msg in grpc_client_messages 
        if (msg.source_id == "http-client" and 
            msg.payload and 
            msg.payload.get("test_id") == "http_to_grpc_test")
    ]
    
    assert len(test_messages) >= 1, f"gRPC client should have received test message from HTTP client. Got {len(grpc_client_messages)} total messages"
    
    received_event = test_messages[0]
    assert received_event.event_name == "mixed.http_to_grpc"
    assert received_event.source_id == "http-client"
    assert received_event.destination_id == "grpc-client"
    assert received_event.payload["text"] == "Hello from HTTP client to gRPC client!"
    assert received_event.payload["test_id"] == "http_to_grpc_test"
    
    print("✅ HTTP to gRPC communication test PASSED")
    print(f"   HTTP client successfully sent event to gRPC client")
    print(f"   Message received with correct content: {received_event.payload['text']}")


@pytest.mark.asyncio
async def test_bidirectional_mixed_communication(grpc_client, http_client):
    """Test bidirectional communication between gRPC and HTTP clients."""
    
    print("🔍 Testing bidirectional mixed transport communication...")
    
    # Track received messages for both clients
    grpc_client_messages = []
    http_client_messages = []
    
    # Set up message handlers
    async def grpc_handler(event):
        print(f"📨 gRPC Client received: {event.event_name} from {event.source_id}")
        grpc_client_messages.append(event)
        
    async def http_handler(event):
        print(f"📨 HTTP Client received: {event.event_name} from {event.source_id}")
        http_client_messages.append(event)
    
    # Register handlers
    grpc_client.register_event_handler(grpc_handler, ["mixed.bidirectional"])
    http_client.register_event_handler(http_handler, ["mixed.bidirectional"])
    
    # gRPC client sends to HTTP client
    event_grpc_to_http = Event(
        event_name="mixed.bidirectional",
        source_id="grpc-client",
        destination_id="http-client", 
        payload={"text": "gRPC to HTTP message", "direction": "grpc_to_http"},
        event_id="mixed-bidir-001"
    )
    
    # HTTP client sends to gRPC client
    event_http_to_grpc = Event(
        event_name="mixed.bidirectional",
        source_id="http-client",
        destination_id="grpc-client",
        payload={"text": "HTTP to gRPC message", "direction": "http_to_grpc"},
        event_id="mixed-bidir-002"
    )
    
    # Send both messages
    success_grpc = await grpc_client.send_event(event_grpc_to_http)
    success_http = await http_client.send_event(event_http_to_grpc)
    
    print(f"📤 gRPC Client send result: {success_grpc}")
    print(f"📤 HTTP Client send result: {success_http}")
    
    assert success_grpc and success_http, "Both mixed transport clients should be able to send events"
    
    # Wait for message processing
    print("⏳ Waiting for bidirectional mixed transport message processing...")
    
    for i in range(10):
        await asyncio.sleep(1.0)
        
        # Check if both received messages
        grpc_received = any(msg.payload.get("direction") == "http_to_grpc" for msg in grpc_client_messages)
        http_received = any(msg.payload.get("direction") == "grpc_to_http" for msg in http_client_messages)
        
        if grpc_received and http_received:
            break
            
        print(f"   After {i+1}s: gRPC received {len(grpc_client_messages)}, HTTP received {len(http_client_messages)}")
    
    # Verify both directions worked
    grpc_received_from_http = [msg for msg in grpc_client_messages if msg.source_id == "http-client"]
    http_received_from_grpc = [msg for msg in http_client_messages if msg.source_id == "grpc-client"]
    
    assert len(grpc_received_from_http) >= 1, "gRPC client should receive message from HTTP client"
    assert len(http_received_from_grpc) >= 1, "HTTP client should receive message from gRPC client"
    
    print("✅ Bidirectional mixed transport communication test PASSED")
    print(f"   gRPC client received {len(grpc_received_from_http)} messages from HTTP client")
    print(f"   HTTP client received {len(http_received_from_grpc)} messages from gRPC client")


@pytest.mark.asyncio
async def test_mixed_list_agents(grpc_client, http_client):
    """Test that both gRPC and HTTP clients can see each other in agent lists."""
    
    print("🔍 Testing mixed transport agent listing...")
    
    # Give clients a moment to fully register
    await asyncio.sleep(1.0)
    
    # Test gRPC client listing agents
    print("📋 gRPC Client requesting agent list...")
    try:
        agents_from_grpc = await grpc_client.list_agents()
        print(f"📥 gRPC Client received agent list: {agents_from_grpc}")
        
        # Verify the response structure
        assert isinstance(agents_from_grpc, list), "list_agents should return a list"
        
        # Should have at least grpc-client and http-client
        agent_ids = [agent.get("agent_id") for agent in agents_from_grpc if agent.get("agent_id")]
        print(f"🔍 Found agent IDs from gRPC client: {agent_ids}")
        
        # Both clients should be in the list
        assert "grpc-client" in agent_ids, "grpc-client should be in the agent list"
        assert "http-client" in agent_ids, "http-client should be in the agent list"
        assert len(agent_ids) >= 2, "Should have at least 2 agents (grpc-client and http-client)"
            
    except Exception as e:
        print(f"❌ ERROR during list_agents for gRPC client: {e}")
        raise
    
    # Test HTTP client listing agents
    print("📋 HTTP Client requesting agent list...")
    try:
        agents_from_http = await http_client.list_agents()
        print(f"📥 HTTP Client received agent list: {agents_from_http}")
        
        # Verify the response structure
        assert isinstance(agents_from_http, list), "list_agents should return a list"
        
        # Should have at least grpc-client and http-client
        agent_ids_http = [agent.get("agent_id") for agent in agents_from_http if agent.get("agent_id")]
        print(f"🔍 Found agent IDs from HTTP client: {agent_ids_http}")
        
        # Both clients should be in the list
        assert "grpc-client" in agent_ids_http, "grpc-client should be in the agent list from HTTP client"
        assert "http-client" in agent_ids_http, "http-client should be in the agent list from HTTP client"
        assert len(agent_ids_http) >= 2, "Should have at least 2 agents (grpc-client and http-client)"
        
        # Both clients should see the same agents
        assert set(agent_ids) == set(agent_ids_http), "Both clients should see the same agent list"
        
    except Exception as e:
        print(f"❌ ERROR during list_agents for HTTP client: {e}")
        raise
    
    print("✅ Mixed transport agent listing test PASSED")
    print(f"   Both clients successfully retrieved agent list")
    print(f"   Found {len(agent_ids)} agents: {agent_ids}")
    print(f"   gRPC and HTTP clients can see each other in the network")


@pytest.mark.asyncio
async def test_mixed_multiple_messages(grpc_client, http_client):
    """Test multiple message exchange between gRPC and HTTP clients."""
    
    print("🔍 Testing multiple messages between mixed transports...")
    
    # Number of messages to send in each direction
    num_messages = 3
    
    # Track received messages
    grpc_client_messages = []
    http_client_messages = []
    
    # Set up message handlers
    async def grpc_handler(event):
        print(f"📨 gRPC Client received: {event.event_name} from {event.source_id}")
        grpc_client_messages.append(event)
        
    async def http_handler(event):
        print(f"📨 HTTP Client received: {event.event_name} from {event.source_id}")
        http_client_messages.append(event)
    
    # Register handlers
    grpc_client.register_event_handler(grpc_handler, ["mixed.multiple"])
    http_client.register_event_handler(http_handler, ["mixed.multiple"])
    
    print(f"✅ Sending {num_messages} messages in each direction...")
    
    # Send messages from gRPC to HTTP
    for i in range(num_messages):
        event = Event(
            event_name="mixed.multiple",
            source_id="grpc-client",
            destination_id="http-client",
            payload={
                "text": f"gRPC to HTTP message {i+1}",
                "direction": "grpc_to_http",
                "message_number": i+1,
                "test_id": "mixed_multiple_test"
            },
            event_id=f"mixed-grpc-to-http-{i+1:03d}"
        )
        
        success = await grpc_client.send_event(event)
        print(f"📤 gRPC to HTTP message {i+1}: {success}")
        assert success, f"gRPC client should be able to send message {i+1}"
        await asyncio.sleep(0.1)  # Small delay
    
    # Send messages from HTTP to gRPC
    for i in range(num_messages):
        event = Event(
            event_name="mixed.multiple",
            source_id="http-client",
            destination_id="grpc-client",
            payload={
                "text": f"HTTP to gRPC message {i+1}",
                "direction": "http_to_grpc", 
                "message_number": i+1,
                "test_id": "mixed_multiple_test"
            },
            event_id=f"mixed-http-to-grpc-{i+1:03d}"
        )
        
        success = await http_client.send_event(event)
        print(f"📤 HTTP to gRPC message {i+1}: {success}")
        assert success, f"HTTP client should be able to send message {i+1}"
        await asyncio.sleep(0.1)  # Small delay
    
    # Wait for message processing
    print("⏳ Waiting for multiple mixed transport message processing...")
    
    for i in range(15):  # Wait up to 15 seconds
        await asyncio.sleep(1.0)
        
        # Count test messages received
        grpc_test_messages = [
            msg for msg in grpc_client_messages 
            if msg.payload.get("test_id") == "mixed_multiple_test"
        ]
        http_test_messages = [
            msg for msg in http_client_messages 
            if msg.payload.get("test_id") == "mixed_multiple_test"
        ]
        
        print(f"   After {i+1}s: gRPC received {len(grpc_test_messages)}/{num_messages}, HTTP received {len(http_test_messages)}/{num_messages}")
        
        if len(grpc_test_messages) >= num_messages and len(http_test_messages) >= num_messages:
            break
    
    # Verify all messages were received
    grpc_test_messages = [
        msg for msg in grpc_client_messages 
        if msg.payload.get("test_id") == "mixed_multiple_test"
    ]
    http_test_messages = [
        msg for msg in http_client_messages 
        if msg.payload.get("test_id") == "mixed_multiple_test"
    ]
    
    assert len(grpc_test_messages) == num_messages, f"gRPC client should receive {num_messages} messages from HTTP client"
    assert len(http_test_messages) == num_messages, f"HTTP client should receive {num_messages} messages from gRPC client"
    
    # Verify message content and ordering
    for msg in grpc_test_messages:
        assert msg.source_id == "http-client"
        assert msg.payload["direction"] == "http_to_grpc"
        assert msg.payload["test_id"] == "mixed_multiple_test"
    
    for msg in http_test_messages:
        assert msg.source_id == "grpc-client"
        assert msg.payload["direction"] == "grpc_to_http"
        assert msg.payload["test_id"] == "mixed_multiple_test"
    
    print("✅ Multiple mixed transport messages test PASSED")
    print(f"   gRPC client received all {len(grpc_test_messages)} messages from HTTP client")
    print(f"   HTTP client received all {len(http_test_messages)} messages from gRPC client")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s", "--tb=short"])
