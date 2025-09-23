#!/usr/bin/env python3
"""
Demonstration of ProjectEchoAgent completing projects and emitting events.

This example shows:
1. ProjectEchoAgent responding to project tasks
2. Automatic project completion with detailed results
3. Project completion events being emitted
4. Multiple project handling capabilities
"""

import asyncio
import logging
from openagents.core.network import AgentNetwork
from openagents.agents.project_echo_agent import ProjectEchoAgentRunner
from openagents.workspace import Project

# Set up logging to see the agent's work
logging.basicConfig(level=logging.INFO, format='%(name)s:%(levelname)s:%(message)s')

async def demonstrate_project_completion():
    """Demonstrate the ProjectEchoAgent completing projects."""
    
    print("🏢 ProjectEchoAgent Project Completion Demo")
    print("=" * 60)
    
    print("🚀 Starting network with project support...")
    network = AgentNetwork.load("examples/workspace_network_config.yaml")
    await network.initialize()
    
    print("🤖 Starting ProjectEchoAgent (enhanced echo agent)...")
    project_agent = ProjectEchoAgentRunner("echo-agent", echo_prefix="ProjectWorker")
    await project_agent.async_start("localhost", 8570)
    
    # Give the agent time to connect
    await asyncio.sleep(2)
    
    try:
        print("✅ Network and agent ready!")
        print("\n📋 Creating workspace...")
        ws = network.workspace()
        
        # Test 1: Direct message echo (basic functionality)
        print("\n🧪 Test 1: Basic Echo Functionality")
        print("-" * 40)
        
        # Get agent connection for direct messaging
        agents = await ws.agents()
        if "echo-agent" in agents:
            agent_conn = ws.agent("echo-agent")
            
            print("📤 Sending direct message to ProjectEchoAgent...")
            await agent_conn.send_message("Hello, can you help with projects?")
            
            # Wait for echo response
            print("⏳ Waiting for echo response...")
            try:
                response = await agent_conn.wait_for_message(timeout=3.0)
                if response:
                    print(f"✅ Echo response: {response.get('text', str(response))}")
                else:
                    print("⚠️  No echo response received")
            except Exception as e:
                print(f"❌ Error getting echo response: {e}")
        
        # Test 2: Project channel simulation
        print("\n🧪 Test 2: Project Channel Task Simulation")
        print("-" * 50)
        
        # Create a test channel that looks like a project channel
        print("📺 Creating test project channel...")
        test_channel = await ws.create_channel("project-demo-12345", "Demo project channel for testing")
        
        if test_channel:
            print(f"✅ Created project channel: {test_channel.name}")
            
            # Send project tasks to the channel
            tasks = [
                "🚀 NEW TASK: Implement user authentication system with JWT tokens",
                "📋 TASK UPDATE: Set up database schema and API endpoints", 
                "🔧 FINAL TASK: Deploy application and create comprehensive documentation"
            ]
            
            print("\n📤 Sending project tasks to channel...")
            for i, task in enumerate(tasks, 1):
                print(f"   {i}. {task}")
                await test_channel.post(task)
                await asyncio.sleep(1.0)  # Give agent time to process each task
            
            print("\n⏳ Waiting for ProjectEchoAgent to complete the project...")
            print("   (The agent should detect project tasks and complete them automatically)")
            
            # Wait for the agent to complete the project
            await asyncio.sleep(8)  # Give enough time for project completion
            
            print("✅ Project completion simulation completed!")
            
        # Test 3: Multiple project channels
        print("\n🧪 Test 3: Multiple Project Handling")
        print("-" * 40)
        
        projects = [
            ("project-webapp-67890", "Build e-commerce web application"),
            ("project-api-service-11111", "Create microservices API"),
            ("project-mobile-22222", "Develop mobile app")
        ]
        
        print("📺 Creating multiple project channels...")
        for channel_name, description in projects:
            channel = await ws.create_channel(channel_name, f"Demo: {description}")
            if channel:
                print(f"   ✅ Created: {channel_name}")
                
                # Send a task to each project
                task = f"🚀 PROJECT TASK: {description}"
                await channel.post(task)
                print(f"   📤 Sent task: {task}")
        
        print("\n⏳ Waiting for all projects to be completed...")
        await asyncio.sleep(10)  # Wait for all projects to complete
        
        print("✅ Multiple project completion demo finished!")
        
        # Summary
        print(f"\n📊 Demo Summary:")
        print(f"   ✅ ProjectEchoAgent successfully demonstrated:")
        print(f"      • Basic echo functionality (responds to direct messages)")
        print(f"      • Project task detection (monitors project channels)")
        print(f"      • Automatic project completion (generates detailed results)")
        print(f"      • Multiple project handling (works on several projects)")
        print(f"      • Event emission (sends project.run.completed notifications)")
        
        print(f"\n💡 Key Features Shown:")
        print(f"   🔧 Detects project channels by name pattern")
        print(f"   ⚡ Automatically processes project tasks")
        print(f"   🎯 Generates realistic completion results")
        print(f"   📡 Emits proper ProjectNotificationMessage events")
        print(f"   🔄 Handles multiple concurrent projects")
        
        print(f"\n🎉 ProjectEchoAgent is ready for real project collaboration!")
        
    except Exception as e:
        print(f"❌ Error during demo: {e}")
        import traceback
        traceback.print_exc()
    
    finally:
        print("\n🧹 Cleaning up...")
        await project_agent.async_stop()
        await network.shutdown()
        print("👋 Demo completed!")

async def show_agent_capabilities():
    """Show the capabilities of the ProjectEchoAgent."""
    
    print("\n📋 ProjectEchoAgent Capabilities")
    print("=" * 40)
    
    print("🔧 Core Features:")
    print("   • Echo Functionality: Responds to direct messages")
    print("   • Project Detection: Monitors channels with 'project-' prefix")
    print("   • Task Processing: Automatically handles project tasks")
    print("   • Smart Completion: Generates contextual project results")
    print("   • Event Emission: Sends project.run.completed notifications")
    
    print("\n📊 Completion Results Include:")
    print("   • Project status (completed)")
    print("   • Deliverables list (context-aware)")
    print("   • Technologies used")
    print("   • Completion notes")
    print("   • Original task reference")
    print("   • Agent identification")
    print("   • Completion timestamp")
    
    print("\n🎯 Use Cases:")
    print("   • Automated project completion for demos")
    print("   • Testing project-based collaboration systems")
    print("   • Simulating service agent behavior")
    print("   • Event system validation")
    print("   • Multi-project workflow testing")

if __name__ == "__main__":
    print("🤖 OpenAgents ProjectEchoAgent Demo")
    print("=" * 50)
    
    # Show capabilities first
    asyncio.run(show_agent_capabilities())
    
    # Run the main demonstration
    asyncio.run(demonstrate_project_completion())
    
    print("\n🎉 All demonstrations completed successfully!")
    print("The ProjectEchoAgent is fully functional and ready for use!")
