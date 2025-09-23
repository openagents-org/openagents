#!/usr/bin/env python3
"""
Test script to verify that agent IDs are correctly passed in received events.
"""

import asyncio
import tempfile
import time
from pathlib import Path

from src.openagents.core.client import AgentClient
from src.openagents.core.network import create_network
from src.openagents.launchers.network_launcher import load_network_config
from src.openagents.models.event import Event


async def test_agent_id_in_received_events():
    """Test that received events contain correct agent ID information."""
    print("🔍 Testing agent ID information in received events...")
    
    # Load test network config
    config_path = Path(__file__).parent / "examples" / "workspace_test.yaml"
    config = load_network_config(str(config_path))
    config.network.port = 47200  # Use a specific port to avoid conflicts
    
    # Create and initialize network
    network = create_network(config.network)
    await network.initialize()
    await asyncio.sleep(1.0)  # Give network time to start
    
    try:
        # Create two clients
        client_a = AgentClient(agent_id="agent-alpha")
        client_b = AgentClient(agent_id="agent-beta")
        
        # Connect both clients
        await client_a.connect(config.network.host, config.network.port)
        await client_b.connect(config.network.host, config.network.port)
        await asyncio.sleep(1.0)  # Give clients time to connect
        
        # Storage for received events
        received_events = []
        
        # Set up message handler for client B
        async def event_inspector(event):
            print(f"📨 Received event:")
            print(f"   event_name: {event.event_name}")
            print(f"   source_id: {event.source_id}")
            print(f"   target_agent_id: {event.target_agent_id}")
            print(f"   payload: {event.payload}")
            
            # Store event for verification
            received_events.append({
                'event_name': event.event_name,
                'source_id': event.source_id,
                'target_agent_id': event.target_agent_id,
                'payload': event.payload
            })
        
        # Register handler for test messages
        if hasattr(client_b.connector, 'register_message_handler'):
            client_b.connector.register_message_handler("agent.id.test", event_inspector)
        
        # Create test event from client A to client B
        test_event = Event(
            event_name="agent.id.test",
            source_id="agent-alpha",
            destination_id="agent-beta",
            payload={"message": "Testing agent ID propagation", "timestamp": time.time()}
        )
        
        print("📤 Sending test event from agent-alpha to agent-beta...")
        success = await client_a.connector.send_message(test_event)
        print(f"Send result: {success}")
        
        # Wait for message processing
        print("⏳ Waiting for message delivery...")
        for i in range(10):
            await asyncio.sleep(1.0)
            if received_events:
                break
            print(f"   Waiting... {i+1}s")
        
        # Verify results
        print(f"📥 Received {len(received_events)} events")
        
        if received_events:
            event_data = received_events[0]
            print("\n✅ Event Analysis:")
            print(f"   Can identify sender: {event_data['source_id']} == 'agent-alpha' → {event_data['source_id'] == 'agent-alpha'}")
            print(f"   Can identify target: {event_data['target_agent_id']} == 'agent-beta' → {event_data['target_agent_id'] == 'agent-beta'}")
            print(f"   Event name preserved: {event_data['event_name']} == 'agent.id.test' → {event_data['event_name'] == 'agent.id.test'}")
            print(f"   Payload preserved: {event_data['payload']['message'] == 'Testing agent ID propagation'}")
            
            # Verify all fields are correct
            assert event_data['source_id'] == 'agent-alpha', f"Expected source_id 'agent-alpha', got '{event_data['source_id']}'"
            assert event_data['target_agent_id'] == 'agent-beta', f"Expected target_agent_id 'agent-beta', got '{event_data['target_agent_id']}'"
            assert event_data['event_name'] == 'agent.id.test', f"Expected event_name 'agent.id.test', got '{event_data['event_name']}'"
            
            print("\n🎉 SUCCESS: Agent ID information is correctly passed in received events!")
            return True
        else:
            print("\n❌ FAILED: No events were received")
            return False
            
    finally:
        # Cleanup
        try:
            await client_a.disconnect()
            await client_b.disconnect()
        except:
            pass
        try:
            await network.shutdown()
        except:
            pass


if __name__ == "__main__":
    result = asyncio.run(test_agent_id_in_received_events())
    if result:
        print("\n✅ Test PASSED: Agent IDs are correctly transmitted in events")
        exit(0)
    else:
        print("\n❌ Test FAILED: Agent ID transmission issue detected")
        exit(1)