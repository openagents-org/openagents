"""
Basic gRPC client communication test.

This test verifies that two real gRPC clients can:
1. Connect to the network using workspace_test.yaml
2. Send raw events to each other
3. Observe messages being received

No mocks - uses real gRPC clients and network infrastructure.
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
    
    # Update the gRPC transport port to avoid conflicts
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
async def grpc_client_a(test_network):
    """Create first gRPC client."""
    network, config, grpc_port, http_port = test_network
    
    client = AgentClient(agent_id="client-a")
    await client.connect("localhost", http_port)
    
    # Give client time to connect
    await asyncio.sleep(1.0)
    
    yield client
    
    # Cleanup
    try:
        await client.disconnect()
    except Exception as e:
        print(f"Error disconnecting client-a: {e}")


@pytest.fixture  
async def grpc_client_b(test_network):
    """Create second gRPC client."""
    network, config, grpc_port, http_port = test_network
    
    client = AgentClient(agent_id="client-b")
    await client.connect("localhost", http_port)
    
    # Give client time to connect
    await asyncio.sleep(1.0)
    
    yield client
    
    # Cleanup
    try:
        await client.disconnect()
    except Exception as e:
        print(f"Error disconnecting client-b: {e}")


@pytest.mark.asyncio
async def test_basic_grpc_event_communication(grpc_client_a, grpc_client_b):
    """Test that one gRPC client can send an event to another and it's received."""
    
    print("🔍 Testing basic gRPC client event communication...")
    
    # Create a simple event
    test_event = Event(
        event_name="test.message",
        source_id="client-a", 
        destination_id="client-b",
        payload={"text": "Hello from client A!", "test_id": "basic_comm_test"},
        event_id="test-event-001"
    )
    
    # Clear any existing received messages
    client_b_messages = []
    
    # Set up message handler for client B to capture received events
    async def message_handler(event):
        print(f"📨 Client B received event: {event.event_name} from {event.source_id}")
        print(f"   Payload: {event.payload}")
        client_b_messages.append(event)
    
    # Register the handler using the new event handler API
    grpc_client_b.register_event_handler(message_handler, ["test.message"])
    
    print("✅ Clients connected, sending event...")
    
    # Client A sends event to Client B
    print(f"🔧 DEBUG: About to call send_event with event: {test_event.event_name}")
    try:
        success = await grpc_client_a.send_event(test_event)
        print(f"📤 Send result: {success}")
        assert success, "Client A should be able to send event"
    except Exception as e:
        print(f"❌ ERROR during send_message: {e}")
        raise
    
    # Wait for message processing and polling
    print("⏳ Waiting for message processing...")
    
    # Give time for message routing and polling
    for i in range(10):  # Wait up to 10 seconds
        await asyncio.sleep(1.0)
        
        # Check if we received the message
        if client_b_messages:
            break
        
        print(f"   Checking after {i+1} seconds...")
    
    # Verify client B received the event
    print(f"📥 Client B received {len(client_b_messages)} messages")
    
    for msg in client_b_messages:
        print(f"   Message: {msg.event_name} from {msg.source_id}")
        print(f"   Payload: {msg.payload}")
    
    # Find our test message
    test_messages = [
        msg for msg in client_b_messages 
        if (msg.source_id == "client-a" and 
            msg.payload and 
            msg.payload.get("test_id") == "basic_comm_test")
    ]
    
    assert len(test_messages) >= 1, f"Client B should have received test message. Got {len(client_b_messages)} total messages"
    
    received_event = test_messages[0]
    assert received_event.event_name == "test.message"
    assert received_event.source_id == "client-a"
    assert received_event.destination_id == "client-b"
    assert received_event.payload["text"] == "Hello from client A!"
    assert received_event.payload["test_id"] == "basic_comm_test"
    
    print("✅ Basic gRPC event communication test PASSED")
    print(f"   Client A successfully sent event to Client B")
    print(f"   Message received with correct content: {received_event.payload['text']}")


@pytest.mark.asyncio
async def test_multiple_messages_grpc_communication(grpc_client_a, grpc_client_b):
    """Test that client A can send multiple messages to client B and all are received."""
    
    print("🔍 Testing multiple messages gRPC communication...")
    
    # Number of messages to send
    num_messages = 5
    
    # Clear any existing received messages
    client_b_messages = []
    
    # Set up message handler for client B to capture received events
    async def message_handler(event):
        print(f"📨 Client B received event: {event.event_name} from {event.source_id}")
        print(f"   Payload: {event.payload}")
        client_b_messages.append(event)
    
    # Register the handler using the new event handler API
    grpc_client_b.register_event_handler(message_handler, ["test.multiple"])
    
    print(f"✅ Clients connected, sending {num_messages} events...")
    
    # Create and send multiple events from Client A to Client B
    sent_events = []
    for i in range(num_messages):
        test_event = Event(
            event_name="test.multiple",
            source_id="client-a", 
            destination_id="client-b",
            payload={
                "text": f"Message {i+1} from client A!", 
                "test_id": "multiple_comm_test",
                "message_number": i+1,
                "total_messages": num_messages
            },
            event_id=f"test-multiple-{i+1:03d}"
        )
        sent_events.append(test_event)
        
        print(f"🔧 DEBUG: Sending message {i+1}/{num_messages}")
        try:
            success = await grpc_client_a.send_event(test_event)
            print(f"📤 Send result for message {i+1}: {success}")
            assert success, f"Client A should be able to send message {i+1}"
            
            # Small delay between messages to avoid overwhelming the system
            await asyncio.sleep(0.1)
            
        except Exception as e:
            print(f"❌ ERROR during send_event for message {i+1}: {e}")
            raise
    
    # Wait for message processing and polling
    print("⏳ Waiting for multiple message processing...")
    
    # Give time for message routing and polling - longer timeout for multiple messages
    for i in range(15):  # Wait up to 15 seconds
        await asyncio.sleep(1.0)
        
        # Force polling if supported
        if hasattr(grpc_client_b.connector, 'poll_messages'):
            await grpc_client_b.connector.poll_messages()
            
        # Check if we received all messages
        test_messages = [
            msg for msg in client_b_messages 
            if (msg.source_id == "client-a" and 
                msg.payload and 
                msg.payload.get("test_id") == "multiple_comm_test")
        ]
        
        print(f"   After {i+1}s: Received {len(test_messages)}/{num_messages} test messages")
        
        if len(test_messages) >= num_messages:
            break
    
    # Verify client B received all events
    print(f"📥 Client B received {len(client_b_messages)} total messages")
    
    for msg in client_b_messages:
        print(f"   Message: {msg.event_name} from {msg.source_id}")
        print(f"   Payload: {msg.payload}")
    
    # Find our test messages
    test_messages = [
        msg for msg in client_b_messages 
        if (msg.source_id == "client-a" and 
            msg.payload and 
            msg.payload.get("test_id") == "multiple_comm_test")
    ]
    
    assert len(test_messages) == num_messages, f"Client B should have received all {num_messages} test messages. Got {len(test_messages)} test messages out of {len(client_b_messages)} total messages"
    
    # Verify all messages are correct and in order
    received_numbers = []
    for msg in test_messages:
        assert msg.event_name == "test.multiple"
        assert msg.source_id == "client-a"
        assert msg.destination_id == "client-b"
        assert msg.payload["test_id"] == "multiple_comm_test"
        assert msg.payload["total_messages"] == num_messages
        
        message_number = msg.payload["message_number"]
        # Convert to int since gRPC may convert to float during serialization
        message_number_int = int(message_number)
        received_numbers.append(message_number_int)
        
        expected_text = f"Message {message_number_int} from client A!"
        assert msg.payload["text"] == expected_text, f"Message {message_number} has incorrect text. Expected: '{expected_text}', Got: '{msg.payload['text']}'"
    
    # Verify we received all message numbers (order doesn't matter due to async nature)
    received_numbers.sort()
    expected_numbers = list(range(1, num_messages + 1))
    assert received_numbers == expected_numbers, f"Missing message numbers. Expected {expected_numbers}, got {received_numbers}"
    
    print("✅ Multiple messages gRPC communication test PASSED")
    print(f"   Client A successfully sent {num_messages} events to Client B")
    print(f"   All {len(test_messages)} messages received with correct content")
    print(f"   Message numbers received: {sorted(received_numbers)}")


@pytest.mark.asyncio
async def test_list_agents_grpc_communication(grpc_client_a, grpc_client_b):
    """Test that clients can list other agents in the network."""
    
    print("🔍 Testing list_agents gRPC communication...")
    
    # Give clients a moment to fully register
    await asyncio.sleep(1.0)
    
    # Test client A listing agents
    print("📋 Client A requesting agent list...")
    try:
        agents_from_a = await grpc_client_a.list_agents()
        print(f"📥 Client A received agent list: {agents_from_a}")
        
        # Verify the response structure
        assert isinstance(agents_from_a, list), "list_agents should return a list"
        
        # Should have at least client-a and client-b
        agent_ids = [agent.get("agent_id") for agent in agents_from_a if agent.get("agent_id")]
        print(f"🔍 Found agent IDs: {agent_ids}")
        
        # Both clients should be in the list
        assert "client-a" in agent_ids, "client-a should be in the agent list"
        assert "client-b" in agent_ids, "client-b should be in the agent list"
        assert len(agent_ids) >= 2, "Should have at least 2 agents (client-a and client-b)"
        
        # Verify agent info structure
        for agent in agents_from_a:
            assert "agent_id" in agent, "Each agent should have an agent_id"
            assert "name" in agent, "Each agent should have a name"
            assert "connected" in agent, "Each agent should have a connected status"
            print(f"   Agent: {agent['agent_id']}, Name: {agent['name']}, Connected: {agent['connected']}")
            
    except Exception as e:
        print(f"❌ ERROR during list_agents for client A: {e}")
        raise
    
    # Test client B listing agents
    print("📋 Client B requesting agent list...")
    try:
        agents_from_b = await grpc_client_b.list_agents()
        print(f"📥 Client B received agent list: {agents_from_b}")
        
        # Verify the response structure
        assert isinstance(agents_from_b, list), "list_agents should return a list"
        
        # Should have at least client-a and client-b
        agent_ids_b = [agent.get("agent_id") for agent in agents_from_b if agent.get("agent_id")]
        print(f"🔍 Found agent IDs from B: {agent_ids_b}")
        
        # Both clients should be in the list
        assert "client-a" in agent_ids_b, "client-a should be in the agent list from B"
        assert "client-b" in agent_ids_b, "client-b should be in the agent list from B"
        assert len(agent_ids_b) >= 2, "Should have at least 2 agents (client-a and client-b)"
        
        # Both clients should see the same agents
        assert set(agent_ids) == set(agent_ids_b), "Both clients should see the same agent list"
        
    except Exception as e:
        print(f"❌ ERROR during list_agents for client B: {e}")
        raise
    
    print("✅ List agents gRPC communication test PASSED")
    print(f"   Both clients successfully retrieved agent list")
    print(f"   Found {len(agent_ids)} agents: {agent_ids}")


@pytest.mark.asyncio
async def test_agent_unregister_list_agents(grpc_client_a, grpc_client_b):
    """Test that list_agents correctly reflects agent disconnections."""
    
    print("🔍 Testing agent unregister and list_agents...")
    
    # Give clients a moment to fully register
    await asyncio.sleep(1.0)
    
    # First, verify both clients are registered
    print("📋 Step 1: Verify both clients are initially registered...")
    agents_initial = await grpc_client_a.list_agents()
    agent_ids_initial = [agent.get("agent_id") for agent in agents_initial if agent.get("agent_id")]
    print(f"🔍 Initial agents: {agent_ids_initial}")
    
    assert "client-a" in agent_ids_initial, "client-a should be in initial agent list"
    assert "client-b" in agent_ids_initial, "client-b should be in initial agent list"
    assert len(agent_ids_initial) >= 2, "Should have at least 2 agents initially"
    
    # Disconnect client B
    print("📋 Step 2: Disconnecting client-b...")
    try:
        await grpc_client_b.disconnect()
        print("✅ Client B disconnected successfully")
    except Exception as e:
        print(f"⚠️ Warning during client B disconnect: {e}")
    
    # Give the network time to process the disconnection
    await asyncio.sleep(2.0)
    
    # Check agent list from client A - should no longer include client B
    print("📋 Step 3: Checking agent list after client-b disconnect...")
    try:
        agents_after_disconnect = await grpc_client_a.list_agents()
        agent_ids_after = [agent.get("agent_id") for agent in agents_after_disconnect if agent.get("agent_id")]
        print(f"🔍 Agents after disconnect: {agent_ids_after}")
        
        # Verify client A is still there
        assert "client-a" in agent_ids_after, "client-a should still be in agent list"
        
        # Verify client B is no longer there
        assert "client-b" not in agent_ids_after, "client-b should NOT be in agent list after disconnect"
        
        # Verify the count decreased
        assert len(agent_ids_after) == len(agent_ids_initial) - 1, f"Agent count should decrease by 1. Before: {len(agent_ids_initial)}, After: {len(agent_ids_after)}"
        
        print(f"✅ Agent list correctly updated: {len(agent_ids_initial)} → {len(agent_ids_after)} agents")
        
    except Exception as e:
        print(f"❌ ERROR during list_agents after disconnect: {e}")
        raise
    
    # Try to reconnect client B and verify it appears again
    print("📋 Step 4: Reconnecting client-b...")
    try:
        # Note: We can't easily reconnect the same fixture, so we'll create a new connection
        # For this test, we'll just verify the disconnect worked properly
        print("✅ Disconnect test completed successfully")
        
    except Exception as e:
        print(f"❌ ERROR during reconnection test: {e}")
        raise
    
    print("✅ Agent unregister and list_agents test PASSED")
    print(f"   Successfully verified agent list updates on disconnect")
    print(f"   Initial agents: {agent_ids_initial}")
    print(f"   After disconnect: {agent_ids_after}")


@pytest.mark.asyncio
async def test_event_subscription_filtering(grpc_client_a, grpc_client_b):
    """Test that event subscription filtering works correctly."""
    
    print("🔍 Testing event subscription filtering...")
    
    # Track received messages for client B
    client_b_messages = []
    
    # Set up message handler for client B
    async def subscription_handler(event):
        print(f"📨 Client B received subscribed event: {event.event_name} from {event.source_id}")
        client_b_messages.append(event)
    
    # Register handler for specific patterns only
    grpc_client_b.register_event_handler(subscription_handler)
    
    # Subscribe to specific event patterns
    print("📋 Client B subscribing to event patterns...")
    subscription_response = await grpc_client_b.subscribe_events(["test.subscription.*", "allowed.event"])
    print(f"📥 Subscription response: {subscription_response}")
    
    # Give subscription time to take effect
    await asyncio.sleep(1.0)
    
    # Create test events - some should match, others should not
    test_events = [
        # These should NOT match the subscription patterns
        Event(
            event_name="test.other.message",
            source_id="client-a",
            destination_id="client-b",
            payload={"text": "Should NOT be received - doesn't match patterns", "should_receive": False},
            event_id="sub-004"
        ),
        Event(
            event_name="random.event",
            source_id="client-a",
            destination_id="client-b",
            payload={"text": "Should NOT be received - doesn't match patterns", "should_receive": False},
            event_id="sub-005"
        ),
        Event(
            event_name="system.notification",
            source_id="client-a",
            destination_id="client-b",
            payload={"text": "Should NOT be received - doesn't match patterns", "should_receive": False},
            event_id="sub-006"
        ),
        Event(
            event_name="test.subscription.message",
            source_id="client-a",
            destination_id="client-b",
            payload={"text": "Should be received - matches test.subscription.*", "should_receive": True},
            event_id="sub-001"
        ),
        Event(
            event_name="test.subscription.data",
            source_id="client-a", 
            destination_id="client-b",
            payload={"text": "Should be received - matches test.subscription.*", "should_receive": True},
            event_id="sub-002"
        ),
        Event(
            event_name="allowed.event",
            source_id="client-a",
            destination_id="client-b", 
            payload={"text": "Should be received - exact match", "should_receive": True},
            event_id="sub-003"
        )
    ]
    
    # Send all test events
    print(f"📤 Sending {len(test_events)} test events...")
    for i, event in enumerate(test_events):
        success = await grpc_client_a.send_event(event)
        print(f"   Event {i+1}: {event.event_name} - Send result: {success}")
        assert success, f"Should be able to send event {event.event_name}"
        
        # Small delay between events
        await asyncio.sleep(0.1)
    
    # Wait for message processing
    print("⏳ Waiting for subscription filtering to process events...")
    
    # Wait longer to ensure all events have been processed
    for i in range(15):
        await asyncio.sleep(1.0)
        
        print(f"   After {i+1}s: Client B received {len(client_b_messages)} events")
        
        # Check if we've received the expected events (stop early if we have enough)
        matching_events = [msg for msg in client_b_messages if msg.payload.get("should_receive") == True]
        if len(matching_events) >= 3:  # We expect 3 matching events
            break
    
    # Analyze received events
    print(f"📥 Client B received {len(client_b_messages)} total events")
    
    for msg in client_b_messages:
        should_receive = msg.payload.get("should_receive", "unknown")
        print(f"   Received: {msg.event_name} - Should receive: {should_receive}")
    
    # Verify subscription filtering worked correctly
    matching_events = [msg for msg in client_b_messages if msg.payload.get("should_receive") == True]
    non_matching_events = [msg for msg in client_b_messages if msg.payload.get("should_receive") == False]
    
    # Should have received all 3 matching events
    assert len(matching_events) == 3, f"Should receive 3 matching events, got {len(matching_events)}"
    
    # Should NOT have received any non-matching events
    assert len(non_matching_events) == 0, f"Should not receive non-matching events, but got {len(non_matching_events)}: {[msg.event_name for msg in non_matching_events]}"
    
    # Verify the specific events that should have been received
    received_event_names = [msg.event_name for msg in matching_events]
    expected_event_names = ["test.subscription.message", "test.subscription.data", "allowed.event"]
    
    for expected_name in expected_event_names:
        assert expected_name in received_event_names, f"Should have received event: {expected_name}"
    
    print("✅ Event subscription filtering test PASSED")
    print(f"   Correctly received {len(matching_events)} matching events")
    print(f"   Correctly filtered out {6 - len(matching_events)} non-matching events")
    print(f"   Received events: {received_event_names}")


@pytest.mark.asyncio
async def test_bidirectional_grpc_communication(grpc_client_a, grpc_client_b):
    """Test bidirectional communication between two gRPC clients."""
    
    print("🔍 Testing bidirectional gRPC communication...")
    
    # Track received messages for both clients
    client_a_messages = []
    client_b_messages = []
    
    # Set up message handlers
    async def handler_a(event):
        print(f"📨 Client A received: {event.event_name} from {event.source_id}")
        client_a_messages.append(event)
        
    async def handler_b(event):
        print(f"📨 Client B received: {event.event_name} from {event.source_id}")
        client_b_messages.append(event)
    
    # Register handlers using the new event handler API
    grpc_client_a.register_event_handler(handler_a, ["bidirectional.test"])
    grpc_client_b.register_event_handler(handler_b, ["bidirectional.test"])
    
    # Client A sends to Client B
    event_a_to_b = Event(
        event_name="bidirectional.test",
        source_id="client-a",
        destination_id="client-b", 
        payload={"text": "A to B message", "direction": "a_to_b"},
        event_id="bidir-001"
    )
    
    # Client B sends to Client A
    event_b_to_a = Event(
        event_name="bidirectional.test",
        source_id="client-b",
        destination_id="client-a",
        payload={"text": "B to A message", "direction": "b_to_a"},
        event_id="bidir-002"
    )
    
    # Send both messages
    success_a = await grpc_client_a.send_event(event_a_to_b)
    success_b = await grpc_client_b.send_event(event_b_to_a)
    
    print(f"📤 Client A send result: {success_a}")
    print(f"📤 Client B send result: {success_b}")
    
    assert success_a and success_b, "Both clients should be able to send events"
    
    # Wait for message processing
    print("⏳ Waiting for bidirectional message processing...")
    
    for i in range(10):
        await asyncio.sleep(1.0)
        
        # Check if both received messages
        a_received = any(msg.payload.get("direction") == "b_to_a" for msg in client_a_messages)
        b_received = any(msg.payload.get("direction") == "a_to_b" for msg in client_b_messages)
        
        if a_received and b_received:
            break
            
        print(f"   After {i+1}s: A received {len(client_a_messages)}, B received {len(client_b_messages)}")
    
    # Verify both directions worked
    a_received_from_b = [msg for msg in client_a_messages if msg.source_id == "client-b"]
    b_received_from_a = [msg for msg in client_b_messages if msg.source_id == "client-a"]
    
    assert len(a_received_from_b) >= 1, "Client A should receive message from Client B"
    assert len(b_received_from_a) >= 1, "Client B should receive message from Client A"
    
    print("✅ Bidirectional gRPC communication test PASSED")
    print(f"   Client A received {len(a_received_from_b)} messages from B")
    print(f"   Client B received {len(b_received_from_a)} messages from A")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s", "--tb=short"])