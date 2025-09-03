import asyncio
from openagents.core.network import AgentNetwork
from openagents.workspace import Project

async def main():
    """Simple example demonstrating minimal project usage in workspace."""
    
    # Start network with project support
    print("🚀 Starting network with project support...")
    network = AgentNetwork.load("examples/workspace_network_config.yaml")
    await network.initialize()
    
    try:
        # Get workspace
        print("📋 Creating workspace...")
        ws = network.workspace()
        print(f"✅ Workspace created: {ws}")
        
        # Create a simple project
        print("\n🆕 Creating a new project...")
        my_project = Project(
            goal="Create a simple hello world application",
            name="Hello World Project"
        )
        
        print(f"📝 Project created:")
        print(f"   Name: {my_project.name}")
        print(f"   Goal: {my_project.goal}")
        print(f"   ID: {my_project.project_id}")
        
        # Start the project
        print("\n🚀 Starting the project...")
        try:
            result = await ws.start_project(my_project, timeout=10.0)
            
            if result.get("success"):
                print(f"✅ Project started successfully!")
                print(f"   Project ID: {result['project_id']}")
                print(f"   Channel: {result['channel_name']}")
                print(f"   Service Agents: {result['service_agents']}")
                
                # Get project status
                print(f"\n📊 Getting project status...")
                status_result = await ws.get_project_status(result['project_id'])
                
                if status_result.get("success"):
                    print(f"✅ Project status: {status_result['status']}")
                else:
                    print(f"❌ Failed to get status: {status_result.get('error')}")
                
                # List all projects
                print(f"\n📋 Listing all projects...")
                projects_result = await ws.list_projects()
                
                if projects_result.get("success"):
                    projects = projects_result.get('projects', [])
                    print(f"✅ Found {len(projects)} project(s)")
                    for project in projects:
                        print(f"   • {project['name']} - {project['status']}")
                
                # Subscribe to project events to wait for completion
                print(f"\n🎧 Subscribing to project events...")
                try:
                    event_sub = ws.events.subscribe([
                        "project.run.completed",
                        "project.run.failed",
                        "project.started"
                    ])
                    
                    print("✅ Event subscription created!")
                    print("⏳ Waiting for project.run.completed event...")
                    
                    # Listen for events with timeout (Python 3.10 compatible)
                    completion_received = False
                    
                    async def listen_for_completion():
                        """Listen for project completion events."""
                        nonlocal completion_received
                        async for event in event_sub:
                            print(f"📨 Event: {event.event_name}")
                            if event.source_agent_id:
                                print(f"   Source: {event.source_agent_id}")
                            if event.data:
                                print(f"   Data: {event.data}")
                            
                            # Check for project completion
                            if event.event_name == "project.run.completed":
                                completion_received = True
                                print(f"🎉 PROJECT COMPLETED!")
                                if event.data.get('results'):
                                    print(f"   Results: {event.data['results']}")
                                break
                            elif event.event_name == "project.run.failed":
                                print(f"❌ PROJECT FAILED!")
                                if event.data.get('error'):
                                    print(f"   Error: {event.data['error']}")
                                break
                    
                    try:
                        await asyncio.wait_for(listen_for_completion(), timeout=15.0)
                    except asyncio.TimeoutError:
                        print(f"⏰ Timeout waiting for project completion")
                    
                    if completion_received:
                        print("✅ Successfully received project.run.completed event!")
                    else:
                        print("⚠️  No completion event received within timeout")
                        print("   Note: Service agents may be needed to complete the project")
                    
                    # Clean up subscription
                    ws.events.unsubscribe(event_sub)
                    
                except Exception as e:
                    print(f"❌ Error with event subscription: {e}")
                
            else:
                print(f"❌ Failed to start project: {result.get('error')}")
        
        except Exception as e:
            print(f"❌ Project start failed: {e}")
            print("   Note: This may happen if project mod is not properly configured")
        
        print("\n✅ Project example completed!")
        
    except Exception as e:
        print(f"❌ Error during project example: {e}")
    
    finally:
        # Cleanup
        print("\n🧹 Cleaning up...")
        await network.shutdown()
        print("👋 Cleanup completed!")

if __name__ == "__main__":
    print("🏢 OpenAgents Simple Project Example")
    print("=" * 45)
    asyncio.run(main())
