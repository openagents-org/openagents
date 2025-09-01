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
        
        # Send a message to a channel
        print("\n📤 Sending message to #general channel...")
        success = await general_channel.send_message("Hello from workspace!")
        print(f"Message sent successfully: {success}")
        
        # Create a new channel
        print("\n🆕 Creating new channel #test...")
        test_channel = await ws.create_channel("test", "Test channel for workspace demo")
        print(f"Created test channel: {test_channel}")
        
        # Send message to the new channel
        print("📤 Sending message to #test channel...")
        success = await test_channel.send_message("This is a test message!")
        print(f"Message sent successfully: {success}")
        
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
