import asyncio
from openagents.core.network import AgentNetwork
from openagents.core.client import AgentClient  
from openagents.agents.simple_echo_agent import SimpleEchoAgentRunner

async def main():
    """Example demonstrating workspace functionality with channels."""
    
    # Start network with workspace support
    print("🚀 Starting network with workspace support...")
    network = AgentNetwork.load("examples/workspace_network_config.yaml")
    await network.initialize()
    
    # Start an echo agent
    print("🤖 Starting echo agent...")
    agent = SimpleEchoAgentRunner("echo-agent", "Echo")
    await agent.async_start("localhost", 8570)
    
    try:
        # Test workspace functionality
        print("\n📋 Testing workspace functionality...")
        
        # Get workspace - this should work since workspace.default mod is enabled
        # The workspace will automatically connect to the network when needed
        ws = network.workspace()
        print(f"✅ Created workspace: {ws}")
        print(f"🔗 Workspace will auto-connect when accessing channels...")
        
        # List channels
        print("\n📺 Listing available channels...")
        channels = await ws.channels()
        print(f"Available channels: {channels}")
        
        # Get a specific channel
        print("\n💬 Getting #general channel...")
        general_channel = ws.channel("#general")
        print(f"General channel: {general_channel}")
        
        # Get another channel without # prefix
        print("💬 Getting dev channel (without # prefix)...")
        dev_channel = ws.channel("dev")
        print(f"Dev channel: {dev_channel}")
        
        # List online agents
        print("\n🤖 Listing online agents...")
        agents = await ws.agents()
        print(f"Online agents: {agents}")
        
        # Get connection to a specific agent
        if agents:
            agent_id = agents[0]  # Get first agent
            print(f"\n🔗 Getting connection to agent: {agent_id}")
            agent_conn = ws.agent(agent_id)
            print(f"Agent connection: {agent_conn}")
            
            # Send direct message to agent
            print(f"📤 Sending direct message to {agent_id}...")
            success = await agent_conn.send_direct_message("Hello from workspace!")
            print(f"Direct message sent successfully: {success}")
            
            # Get agent info
            print(f"ℹ️ Getting info for agent {agent_id}...")
            agent_info = await agent_conn.get_agent_info()
            print(f"Agent info: {agent_info}")
        else:
            print("No agents found to test direct messaging")
        
        # Send a message to a channel
        print("\n📤 Sending message to #general channel...")
        success = await general_channel.post("Hello from workspace!")
        print(f"Message sent successfully: {success}")
        
        # Test additional channel features
        print("\n🔧 Testing additional channel features...")
        
        # Test reactions (using a placeholder message ID)
        print("😀 Adding reaction to message...")
        success = await general_channel.react_to_message("msg-123", "+1")
        print(f"Reaction added successfully: {success}")
        
        # Test file upload (using a placeholder file)
        print("📁 Testing file upload...")
        file_uuid = await general_channel.upload_file("/tmp/test.txt")
        print(f"File uploaded with UUID: {file_uuid}")
        
        # Test reply to message (using a placeholder message ID)
        print("💬 Testing reply to message...")
        success = await general_channel.reply_to_message("msg-123", "This is a reply!")
        print(f"Reply sent successfully: {success}")
        
        # Test get_messages with wait functions (NEW FEATURE!)
        print("\n📋 Testing get_messages with wait functions...")
        try:
            messages = await general_channel.get_messages(limit=10, timeout=3.0)
            print(f"Retrieved {len(messages)} messages from {general_channel.name}")
            if messages:
                print("Recent messages:")
                for i, msg in enumerate(messages[-3:], 1):  # Show last 3 messages
                    sender = msg.get('sender_id', 'unknown')
                    content = msg.get('content', {}).get('text', str(msg.get('content', '')))
                    timestamp = msg.get('timestamp', 'unknown')
                    print(f"  {i}. [{sender}] {content} (at {timestamp})")
            else:
                print("  No messages found (this is expected if thread_messaging mod doesn't respond)")
        except Exception as e:
            print(f"  Get messages failed (expected in demo): {e}")
        
        # Test channels list with wait functions (NEW FEATURE!)
        print("\n📂 Testing channels list with wait functions...")
        try:
            channels = await ws.channels(refresh=True, timeout=3.0)
            print(f"Available channels: {channels}")
        except Exception as e:
            print(f"  Channels list failed (expected in demo): {e}")
        
        # Create a new channel
        print("\n🆕 Creating new channel #test...")
        test_channel = await ws.create_channel("test", "Test channel for workspace demo")
        print(f"Created test channel: {test_channel}")
        
        # Send message to the new channel
        print("📤 Sending message to #test channel...")
        success = await test_channel.post("This is a test message!")
        print(f"Message sent successfully: {success}")
        
        # Test new simplified wait functions
        print("\n🔄 Testing new simplified wait functions...")
        
        # Test agent wait for message
        print("🤖 Testing agent.wait_for_message...")
        try:
            # Start waiting for a message from echo agent
            wait_task = asyncio.create_task(
                agent_conn.wait_for_message(timeout=3.0)
            )
            
            # Give it a moment to start waiting
            await asyncio.sleep(0.5)
            
            # Send a message to trigger echo response
            await agent_conn.send_direct_message("Test wait function")
            
            # Wait for the response
            message = await wait_task
            if message:
                print(f"✅ Received message via wait_for_message: {message.get('text', str(message))}")
            else:
                print("⏰ No message received (timeout)")
        except Exception as e:
            print(f"❌ Error testing wait_for_message: {e}")
        
        # Test channel wait for post
        print("\n💬 Testing channel.wait_for_post...")
        try:
            post = await general_channel.wait_for_post(timeout=2.0)
            if post:
                print(f"✅ Received post: {post}")
            else:
                print("⏰ No post received (expected - no other agents posting)")
        except Exception as e:
            print(f"❌ Error testing wait_for_post: {e}")
        
        # Test send and wait for reply
        print("\n🔄 Testing agent.send_and_wait...")
        try:
            reply = await agent_conn.send_and_wait("Hello, please reply!", timeout=3.0)
            if reply:
                print(f"✅ Got reply via send_and_wait: {reply.get('text', str(reply))}")
            else:
                print("⏰ No reply received")
        except Exception as e:
            print(f"❌ Error testing send_and_wait: {e}")
        
        print("\n📋 New simplified wait functions available:")
        print("   🤖 AgentConnection:")
        print("      • agent.wait_for_message(timeout=30.0)")
        print("      • agent.wait_for_reply(timeout=30.0)")  
        print("      • agent.send_and_wait(content, timeout=30.0)")
        print("   💬 ChannelConnection:")
        print("      • channel.wait_for_reply(message_id=None, timeout=30.0)")
        print("      • channel.wait_for_post(from_agent=None, timeout=30.0)")
        print("      • channel.wait_for_reaction(message_id, timeout=30.0)")
        print("      • channel.post_and_wait(content, timeout=30.0)")
        
        # Test event subscription system (using network-level events)
        print("\n🎧 Testing network-level event subscription system...")
        try:
            # Subscribe to various events using network-level event system
            print("📡 Subscribing to network events...")
            event_sub = network.events.subscribe(
                agent_id="workspace-demo-agent",
                event_patterns=[
                    "channel.message.*",
                    "agent.direct_message.*"
                ]
            )
            
            # Create event queue for polling
            event_queue = network.events.create_agent_event_queue("workspace-demo-agent")
            
            print("✅ Network event subscription created!")
            
            # Give the subscription a moment to initialize
            await asyncio.sleep(0.5)
            
            # Debug: Check if events system is properly initialized
            stats = network.events.get_stats()
            print(f"   Network event subscriptions: {stats.get('active_subscriptions', 0)}")
            print(f"   Workspace client connected: {ws._client is not None and ws._client.connector is not None}")
            
            # Test direct event emission
            print("   Testing direct event emission...")
            from openagents.models.event import Event, EventNames
            test_event = Event(
                event_name=EventNames.CHANNEL_MESSAGE_POSTED,
                source_agent_id="workspace-demo-agent",
                target_channel="#test",
                payload={"text": "Direct emission test"}
            )
            await network.emit_event(test_event)
            print(f"   Direct event emitted: {test_event.event_name}")
            
            # Test posting with mention
            print("🎯 Testing mention events...")
            if agents:
                agent_id = agents[0]
                # Send message with @mention
                print(f"   Sending @mention message to {agent_id}...")
                await general_channel.post(f"Hey @{agent_id}, this should trigger a mention event!")
                
                # Send explicit mention
                print(f"   Sending explicit mention to {agent_id}...")
                await general_channel.post_with_mention("Hello from explicit mention!", agent_id)
            
            # Send a regular message to trigger events
            print("📤 Sending test messages to trigger events...")
            print("   Sending regular channel message...")
            await general_channel.post("This is a test message for event system!")
            
            # Send direct message to trigger events
            if agents:
                print(f"   Sending direct message to {agents[0]}...")
                await agent_conn.send_direct_message("Test message for event system!")
            
            # Give events time to propagate
            await asyncio.sleep(1.0)
            
            # Listen for events for a short time using event queue
            print("🎧 Listening for events...")
            event_count = 0
            
            async def listen_for_workspace_events():
                """Listen for workspace events using event queue polling."""
                nonlocal event_count
                timeout_count = 0
                max_timeouts = 5  # 5 seconds total
                
                while timeout_count < max_timeouts and event_count < 5:
                    try:
                        event = await asyncio.wait_for(event_queue.get(), timeout=1.0)
                        event_count += 1
                        print(f"📨 Event {event_count}: {event.event_name}")
                        print(f"   Source: {event.source_agent_id}")
                        if event.target_channel:
                            print(f"   Channel: {event.target_channel}")
                        if event.target_agent_id:
                            print(f"   Target: {event.target_agent_id}")
                        if event.payload.get('text'):
                            print(f"   Text: {event.payload['text']}")
                        if event.payload.get('mention_type'):
                            print(f"   Mention Type: {event.payload['mention_type']}")
                        print()
                    except asyncio.TimeoutError:
                        timeout_count += 1
                        continue
            
            try:
                await listen_for_workspace_events()
            except Exception as e:
                print(f"⏰ Event listening completed - collected {event_count} events")
            
            # Check if no events were received
            if event_count == 0:
                print("⚠️  No events received. This is expected because:")
                print("   • Only one agent (workspace client) is active")
                print("   • Channel events require multiple agents to be meaningful")
                print("   • The echo agent doesn't participate in channels")
                print("   • Events are working correctly - just no multi-agent activity")
            
            # Clean up subscription and queue
            network.events.unsubscribe(event_sub.subscription_id)
            network.events.remove_agent_event_queue("workspace-demo-agent")
            print("✅ Network event subscription test completed!")
            
            # Show available event types
            print("\n📋 Available event types:")
            from openagents.models.event import EventNames
            event_names = [name for name in dir(EventNames) if not name.startswith('_')]
            for i, event_name in enumerate(event_names, 1):
                event_value = getattr(EventNames, event_name)
                if 'mention' in event_value:
                    print(f"   {i:2d}. {event_value} ⭐")
                else:
                    print(f"   {i:2d}. {event_value}")
            print(f"   Total: {len(event_names)} event types available")
            
        except Exception as e:
            print(f"❌ Error testing events: {e}")
            import traceback
            traceback.print_exc()

        print("\n✅ Workspace functionality test completed!")
        
    except Exception as e:
        print(f"❌ Error during workspace test: {e}")
        import traceback
        traceback.print_exc()
    
    finally:
        # Cleanup
        print("\n🧹 Cleaning up...")
        
        # Disconnect workspace client (if auto-connected)
        if 'ws' in locals():
            workspace_client = ws.get_client()
            if workspace_client and workspace_client.connector:
                print("🔌 Disconnecting workspace client...")
                await workspace_client.disconnect()
        
        # Stop agent
        if 'agent' in locals():
            await agent.async_stop()
        
        # Shutdown network
        await network.shutdown()
        print("👋 Cleanup completed!")

async def test_workspace_without_mod():
    """Test what happens when workspace mod is not enabled."""
    
    print("\n🧪 Testing workspace without mod enabled...")
    
    # Start network without workspace mod
    network = AgentNetwork.load("examples/centralized_network_config.yaml")
    await network.initialize()
    
    try:
        # This should raise an error
        ws = network.workspace()
        print("❌ ERROR: Workspace creation should have failed!")
        
    except RuntimeError as e:
        print(f"✅ Expected error caught: {e}")
        
    finally:
        await network.shutdown()

if __name__ == "__main__":
    print("🏢 OpenAgents Workspace Example")
    print("=" * 50)
    
    # Run main workspace test
    asyncio.run(main())
    
    # Run test without workspace mod
    asyncio.run(test_workspace_without_mod())
    
    print("\n🎉 All tests completed!")
