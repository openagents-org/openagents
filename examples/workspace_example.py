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
