"""
Example demonstrating the unified network-level event system.

This example shows how to use network.events.subscribe() instead of the old
workspace.events.subscribe() approach.
"""

import asyncio
import logging
from openagents.core.network import AgentNetwork
from openagents.core.client import AgentClient
from openagents.models.event import Event, EventNames

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def main():
    """Demonstrate network-level event subscription."""
    
    print("🚀 Starting network with unified event system...")
    
    # Load network configuration
    network = AgentNetwork.load("examples/centralized_network_config.yaml")
    await network.initialize()
    
    # Create a client agent
    client = AgentClient("event-demo-agent")
    await client.connect("localhost", 8570)
    
    try:
        print("\n📡 Setting up event subscriptions...")
        
        # Subscribe to all project events using pattern matching
        print("🔔 Subscribing to project events...")
        project_subscription = network.events.subscribe(
            "event-demo-agent",
            ["project.*"]
        )
        
        # Subscribe to channel messages in specific channel
        print("🔔 Subscribing to channel messages...")
        channel_subscription = network.events.subscribe(
            "event-demo-agent", 
            ["channel.message.*"],
            channels=["general"]
        )
        
        # Subscribe to direct messages
        print("🔔 Subscribing to direct messages...")
        direct_subscription = network.events.subscribe(
            "event-demo-agent",
            ["agent.direct_message.*"]
        )
        
        # Create event queue for polling approach
        print("🔔 Creating event queue for polling...")
        network.events.register_agent("event-demo-agent")
        
        print(f"✅ Set up {len(network.events.get_agent_subscriptions('event-demo-agent'))} subscriptions")
        
        # Demonstrate event emission
        print("\n🎯 Emitting test events...")
        
        # Emit a project event
        project_event = Event(
            event_name=EventNames.PROJECT_CREATED,
            source_agent_id="event-demo-agent",
            payload={
                "project_id": "test-project-123",
                "project_name": "Demo Project",
                "project_goal": "Demonstrate event system"
            }
        )
        await network.emit_to_event_bus(project_event)
        print("📤 Emitted project.created event")
        
        # Emit a channel message event
        channel_event = Event(
            event_name=EventNames.CHANNEL_MESSAGE_POSTED,
            source_agent_id="event-demo-agent",
            target_channel="#general",
            payload={
                "text": "Hello from the unified event system!",
                "message_id": "msg-456"
            }
        )
        await network.emit_to_event_bus(channel_event)
        print("📤 Emitted channel.message.posted event")
        
        # Emit a direct message event
        direct_event = Event(
            event_name=EventNames.AGENT_DIRECT_MESSAGE_SENT,
            source_agent_id="event-demo-agent",
            destination_id="other-agent",
            payload={
                "text": "Direct message via events!",
                "message_id": "dm-789"
            }
        )
        await network.emit_to_event_bus(direct_event)
        print("📤 Emitted agent.message event")
        
        # Wait for events to be processed
        print("\n⏳ Waiting for events to be processed...")
        await asyncio.sleep(1)
        
        # Check event queue
        print("\n📥 Checking event queue...")
        events = await network.events.poll_events("event-demo-agent")
        event_count = len(events)
        for event in events:
            print(f"📨 Received event: {event.event_name}")
            print(f"   Source: {event.source_id}")
            print(f"   Payload: {event.payload}")
            print()
        
        print(f"✅ Processed {event_count} events from queue")
        
        # Show event bus statistics
        print("\n📊 Event Bus Statistics:")
        stats = network.events.get_stats()
        for key, value in stats.items():
            print(f"   {key}: {value}")
        
        # Demonstrate event filtering
        print("\n🔍 Demonstrating event filtering...")
        
        # Subscribe only to events from specific agent
        filtered_subscription = network.events.subscribe(
            "event-demo-agent",
            ["*"]  # All events
        )
        
        # Subscribe only to specific mod events
        mod_subscription = network.events.subscribe(
            "event-demo-agent",
            ["project.*"]
        )
        
        print("✅ Set up filtered subscriptions")
        
        # Clean up
        print("\n🧹 Cleaning up subscriptions...")
        network.events.unsubscribe(project_subscription.subscription_id)
        network.events.unsubscribe(channel_subscription.subscription_id)
        network.events.unsubscribe(direct_subscription.subscription_id)
        network.events.unsubscribe(filtered_subscription.subscription_id)
        network.events.unsubscribe(mod_subscription.subscription_id)
        network.events.remove_agent_event_queue("event-demo-agent")
        
        print("✅ Cleaned up all subscriptions and queues")
        
    except Exception as e:
        logger.error(f"Error in event demo: {e}")
        raise
    
    finally:
        # Clean up
        await client.disconnect()
        await network.shutdown()
        print("🏁 Demo completed")

if __name__ == "__main__":
    asyncio.run(main())
