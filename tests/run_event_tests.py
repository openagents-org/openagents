#!/usr/bin/env python3
"""
Test runner for event subscription tests.

This script runs the event subscription tests and demonstrates
the new event interface functionality.
"""

import asyncio
import sys
import os
import logging

# Add the project root to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

logger = logging.getLogger(__name__)


async def run_simple_event_test():
    """Run a simple event subscription test without pytest."""
    
    print("🧪 Running Simple Event Subscription Test")
    print("=" * 50)
    
    try:
        # Import here to avoid import issues
        from src.openagents.core.network import AgentNetwork
        from src.openagents.agents.simple_echo_agent import SimpleEchoAgentRunner
        import tempfile
        import yaml
        import random
        
        # Create test network config
        host = "127.0.0.1"
        port = random.randint(9400, 9499)
        
        config_data = {
            "network": {
                "name": "SimpleEventTest",
                "mode": "centralized",
                "host": host,
                "port": port,
                "server_mode": True,
                "transport": "websocket",
                "mods": [
                    {
                        "name": "openagents.mods.communication.thread_messaging",
                        "enabled": True,
                        "config": {}
                    },
                    {
                        "name": "openagents.mods.workspace.default", 
                        "enabled": True,
                        "config": {}
                    }
                ]
            },
            "log_level": "INFO"
        }
        
        # Write temporary config
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as f:
            yaml.dump(config_data, f)
            temp_config_path = f.name
        
        network = None
        echo_agent = None
        
        try:
            # Initialize network
            print(f"🚀 Starting network on {host}:{port}...")
            network = AgentNetwork.load(temp_config_path)
            await network.initialize()
            
            # Start echo agent
            print("🤖 Starting echo agent...")
            echo_agent = SimpleEchoAgentRunner("echo-agent", "Echo")
            await echo_agent.async_start(host, port)
            
            # Wait for connections to stabilize
            await asyncio.sleep(2.0)
            
            # Test the exact interface requested!
            print("\n📡 Testing event subscription interface...")
            ws = network.workspace()
            
            # Subscribe to typed events
            sub = ws.events.subscribe([
                "agent.direct_message.received", 
                "channel.post.created", 
                "channel.message.received"
            ])
            
            print("✅ Subscription created!")
            print(f"📋 Available event types: {len(ws.events.get_available_event_types())}")
            
            # Generate some events
            print("\n📤 Generating events...")
            channel = ws.channel("#general")
            await channel.post("Hello from test runner!")
            
            echo_conn = ws.agent("echo-agent")
            await echo_conn.send_direct_message("Test message for echo")
            
            # Read events using the exact interface requested
            print("\n🎧 Listening for events...")
            event_count = 0
            max_events = 3
            
            async def collect_simple_events():
                """Collect events from subscription."""
                nonlocal event_count
                async for ev in sub:
                    print(f"📨 EVENT: {ev.event_name}")
                    print(f"   Source: {ev.source_agent_id}")
                    print(f"   Channel: {ev.channel}")
                    print(f"   Data: {ev.data}")
                    print(f"   Timestamp: {ev.timestamp}")
                    print()
                    
                    event_count += 1
                    if event_count >= max_events:
                        break
            
            try:
                await asyncio.wait_for(collect_simple_events(), timeout=10.0)
            except asyncio.TimeoutError:
                print(f"⏰ Timeout reached, received {event_count} events")
            
            # Clean up subscription
            ws.events.unsubscribe(sub)
            print("🔌 Unsubscribed from events")
            
            print(f"\n✅ Test completed! Received {event_count} events")
            
        finally:
            # Cleanup
            print("\n🧹 Cleaning up...")
            
            if echo_agent:
                await echo_agent.async_stop()
            
            if network:
                await network.shutdown()
            
            # Remove temp config file
            if os.path.exists(temp_config_path):
                os.unlink(temp_config_path)
            
            print("👋 Cleanup completed!")
            
    except Exception as e:
        print(f"❌ Test failed: {e}")
        import traceback
        traceback.print_exc()
        return False
    
    return True


async def run_filtered_event_test():
    """Run a test with event filtering."""
    
    print("\n🎯 Running Filtered Event Subscription Test")
    print("=" * 50)
    
    try:
        from src.openagents.core.network import AgentNetwork
        import tempfile
        import yaml
        import random
        
        # Create test network
        host = "127.0.0.1"
        port = random.randint(9500, 9599)
        
        config_data = {
            "network": {
                "name": "FilteredEventTest",
                "mode": "centralized",
                "host": host,
                "port": port,
                "server_mode": True,
                "transport": "websocket",
                "mods": [
                    {
                        "name": "openagents.mods.communication.thread_messaging",
                        "enabled": True,
                        "config": {}
                    },
                    {
                        "name": "openagents.mods.workspace.default", 
                        "enabled": True,
                        "config": {}
                    }
                ]
            },
            "log_level": "INFO"
        }
        
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as f:
            yaml.dump(config_data, f)
            temp_config_path = f.name
        
        network = None
        
        try:
            # Initialize network
            print(f"🚀 Starting network on {host}:{port}...")
            network = AgentNetwork.load(temp_config_path)
            await network.initialize()
            
            await asyncio.sleep(1.0)
            
            # Test filtered subscriptions
            ws = network.workspace()
            
            # Subscribe with channel filter
            sub = ws.events.subscribe(
                ["channel.post.created"],
                filters={"channel": "#general"}
            )
            
            print("✅ Filtered subscription created (only #general events)")
            
            # Generate events in different channels
            print("\n📤 Generating events in multiple channels...")
            general_channel = ws.channel("#general")
            dev_channel = ws.channel("#dev")
            
            await general_channel.post("Message in #general - should be received")
            await dev_channel.post("Message in #dev - should be filtered out")
            await general_channel.post("Another message in #general - should be received")
            
            # Listen for filtered events
            print("\n🎧 Listening for filtered events (only #general)...")
            event_count = 0
            
            async def collect_filtered_events():
                """Collect filtered events from subscription."""
                nonlocal event_count
                async for ev in sub:
                    print(f"📨 FILTERED EVENT: {ev.event_name} in {ev.channel}")
                    print(f"   Text: {ev.data.get('text', 'N/A')}")
                    
                    # Verify it's from #general
                    assert ev.channel == "#general", f"Expected #general, got {ev.channel}"
                    
                    event_count += 1
                    if event_count >= 2:
                        break
            
            try:
                await asyncio.wait_for(collect_filtered_events(), timeout=5.0)
            except asyncio.TimeoutError:
                print(f"⏰ Timeout reached, received {event_count} filtered events")
            
            ws.events.unsubscribe(sub)
            print(f"\n✅ Filtered test completed! Received {event_count} events (all from #general)")
            
        finally:
            if network:
                await network.shutdown()
            
            if os.path.exists(temp_config_path):
                os.unlink(temp_config_path)
                
    except Exception as e:
        print(f"❌ Filtered test failed: {e}")
        import traceback
        traceback.print_exc()
        return False
    
    return True


async def main():
    """Run all event subscription tests."""
    
    print("🎪 OpenAgents Event Subscription Test Runner")
    print("=" * 60)
    
    try:
        # Run simple test
        success1 = await run_simple_event_test()
        
        # Wait between tests
        await asyncio.sleep(2.0)
        
        # Run filtered test
        success2 = await run_filtered_event_test()
        
        # Summary
        print("\n📊 Test Results Summary")
        print("=" * 30)
        print(f"Simple Event Test: {'✅ PASSED' if success1 else '❌ FAILED'}")
        print(f"Filtered Event Test: {'✅ PASSED' if success2 else '❌ FAILED'}")
        
        if success1 and success2:
            print("\n🎉 All tests passed! Event subscription interface is working correctly.")
            return 0
        else:
            print("\n💥 Some tests failed. Check the output above for details.")
            return 1
            
    except KeyboardInterrupt:
        print("\n⏹️ Tests interrupted by user")
        return 1
    except Exception as e:
        print(f"\n❌ Test runner failed: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
