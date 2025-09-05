"""
Examples demonstrating WorkerAgent functionality in a network environment.

This module shows how to create different types of agents using the WorkerAgent
base class, connect them to a network, and demonstrate agent-to-agent communication
and project-based collaboration.
"""

import asyncio
import logging
from typing import Dict, Any, List

from openagents.core.network import AgentNetwork
from openagents.workspace import Project
from openagents.agents.worker_agent import (
    WorkerAgent, 
    EventContext, 
    ChannelMessageContext, 
    ReplyMessageContext,
    ReactionContext,
    FileContext,
    # Project context classes (only available when project mod is enabled)
    ProjectEventContext,
    ProjectCompletedContext,
    ProjectMessageContext,
    ProjectNotificationContext
)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class EchoAgent(WorkerAgent):
    """Simple echo agent that responds to direct messages."""
    
    default_agent_id = "echo"
    
    async def on_direct(self, msg: EventContext):
        """Echo back direct messages."""
        await self.send_direct(to=msg.sender_id, text=f"Echo: {msg.text}")
        logger.info(f"Echoed message from {msg.sender_id}")

    async def on_channel_mention(self, msg: ChannelMessageContext):
        """Respond when mentioned in channels."""
        await self.send_channel(
            channel=msg.channel,
            text=f"Hi {msg.sender_id}! You mentioned me. I'm an echo bot - send me a DM!",
            mention=msg.sender_id
        )


class HelpfulAgent(WorkerAgent):
    """Agent that provides helpful responses and demonstrates WorkerAgent features."""
    
    default_agent_id = "helpful"
    auto_mention_response = True
    default_channels = ["#general", "#help"]
    
    async def on_direct(self, msg: EventContext):
        """Handle direct messages with helpful responses."""
        text = msg.text.lower()
        
        if "hello" in text or "hi" in text:
            await self.send_direct(
                to=msg.sender_id,
                text=f"Hello {msg.sender_id}! I'm a helpful agent that demonstrates WorkerAgent capabilities."
            )
        elif "help" in text:
            await self.send_direct(
                to=msg.sender_id,
                text="I'm here to help! I can respond to messages, participate in channels, and demonstrate WorkerAgent features."
            )
        elif "history" in text:
            # Demonstrate message history functionality
            recent_messages = await self.get_recent_direct_messages(msg.sender_id, count=3)
            if recent_messages:
                await self.send_direct(
                    to=msg.sender_id,
                    text=f"📜 Found {len(recent_messages)} recent messages in our conversation."
                )
            else:
                await self.send_direct(to=msg.sender_id, text="No recent conversation history found.")
        else:
            await self.send_direct(
                to=msg.sender_id,
                text="I received your message! I'm a helpful agent that demonstrates WorkerAgent capabilities."
            )
    
    async def on_channel_mention(self, msg: ChannelMessageContext):
        """Respond when mentioned in channels."""
        await self.send_channel(
            channel=msg.channel,
            text=f"Hi {msg.sender_id}! I'm a helpful agent. Send me a DM if you'd like to chat!",
            mention=msg.sender_id
        )
    
    async def on_channel_post(self, msg: ChannelMessageContext):
        """Handle channel posts (when not mentioned)."""
        # Only respond to help requests
        if "help" in msg.text.lower() and "?" in msg.text.lower():
            await self.send_channel(
                channel=msg.channel,
                text="I can help! Mention me (@helpful) or send me a DM.",
                mention=msg.sender_id
            )
    
    async def on_file_upload(self, msg: FileContext):
        """Handle file uploads."""
        await self.send_direct(
            to=msg.sender_id,
            text=f"📁 I received your file: {msg.filename} ({msg.file_size} bytes)"
        )
    



class ProjectManagerAgent(WorkerAgent):
    """Agent that manages project-related activities."""
    
    default_agent_id = "project-manager"
    default_channels = ["#general", "#projects"]
    
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.active_projects: Dict[str, Dict[str, Any]] = {}
    
    async def on_channel_post(self, msg: ChannelMessageContext):
        """Monitor project channels for activity."""
        if msg.channel.startswith("#project-"):
            # Handle messages in project channels
            project_id = msg.channel.replace("#project-", "")
            
            # Track project activity
            if project_id not in self.active_projects:
                self.active_projects[project_id] = {
                    "channel": msg.channel,
                    "participants": set(),
                    "messages": 0,
                    "last_activity": msg.timestamp
                }
            
            self.active_projects[project_id]["participants"].add(msg.sender_id)
            self.active_projects[project_id]["messages"] += 1
            self.active_projects[project_id]["last_activity"] = msg.timestamp
            
            # Respond to specific keywords
            if "help" in msg.text.lower():
                await self.send_reply(
                    reply_to_id=msg.message_id,
                    text="I'm tracking this project! Let me know if you need status updates or assistance."
                )
        elif "project" in msg.text.lower() and "create" in msg.text.lower():
            # Handle project creation requests
            await self.send_reply(
                reply_to_id=msg.message_id,
                text=f"I can help create a project! Send me a direct message with details, {msg.sender_id}."
            )
    
    async def on_channel_mention(self, msg: ChannelMessageContext):
        """Handle mentions in project contexts."""
        if msg.channel.startswith("#project-"):
            await self.send_channel(
                channel=msg.channel,
                text=f"Hi {msg.sender_id}! I'm monitoring this project. How can I help?",
                mention=msg.sender_id
            )
        else:
            await self.send_channel(
                channel=msg.channel,
                text=f"Hi {msg.sender_id}! I manage projects. Mention me in project channels or ask me to create one!",
                mention=msg.sender_id
            )
    
    async def on_direct(self, msg: EventContext):
        """Handle direct project management requests."""
        text = msg.text.lower()
        
        if "project" in text and "status" in text:
            # Send project status summary
            if not self.active_projects:
                await self.send_direct(
                    to=msg.sender_id,
                    text="No active projects currently being tracked."
                )
            else:
                status_lines = ["📊 **Active Projects:**"]
                for project_id, info in self.active_projects.items():
                    participants_count = len(info["participants"])
                    status_lines.append(
                        f"• {project_id}: {info['messages']} messages, {participants_count} participants"
                    )
                
                await self.send_direct(
                    to=msg.sender_id,
                    text="\n".join(status_lines)
                )
        elif "project" in text and "create" in text:
            # Handle direct project creation requests
            import uuid
            project_id = str(uuid.uuid4())[:8]
            
            self.active_projects[project_id] = {
                "channel": f"#project-{project_id}",
                "creator": msg.sender_id,
                "participants": {msg.sender_id},
                "messages": 0,
                "created": msg.timestamp,
                "last_activity": msg.timestamp
            }
            
            await self.send_direct(
                to=msg.sender_id,
                text=f"✅ Created project {project_id}! Channel: #project-{project_id}"
            )
        else:
            await self.send_direct(
                to=msg.sender_id,
                text="I'm a project manager! I can help create projects and track their status. What do you need?"
            )
    



class FileProcessorAgent(WorkerAgent):
    """Agent that processes uploaded files."""
    
    default_agent_id = "file-processor"
    
    async def on_file_received(self, msg: FileContext):
        """Process uploaded files."""
        logger.info(f"Processing file: {msg.filename} from {msg.sender_id}")
        
        # Simulate file processing
        await asyncio.sleep(1)  # Simulate processing time
        
        # Analyze file
        file_info = {
            "filename": msg.filename,
            "size": msg.file_size,
            "type": msg.mime_type,
            "processed": True
        }
        
        # Send processing result
        result_text = f"""
📁 **File Processed Successfully!**

• **File:** {msg.filename}
• **Size:** {msg.file_size} bytes
• **Type:** {msg.mime_type}
• **Status:** ✅ Processed

The file has been analyzed and is ready for use.
        """
        
        await self.send_direct(to=msg.sender_id, text=result_text.strip())
        
        # Add a reaction to show we processed it
        await self.react_to(msg.message_id, "check")
    
    async def on_direct(self, msg: EventContext):
        """Handle direct messages about file processing."""
        if "file" in msg.text.lower():
            await self.send_direct(
                to=msg.sender_id,
                text="I process uploaded files! Just upload a file and I'll analyze it for you."
            )
        else:
            await self.send_direct(
                to=msg.sender_id,
                            text="Hi! I'm a file processor. Upload any file and I'll process it for you!"
        )


class ProjectWorkerAgent(WorkerAgent):
    """Agent that demonstrates project functionality (only works when project mod is enabled)."""
    
    default_agent_id = "project-worker"
    auto_join_projects = True
    project_keywords = ["development", "coding", "implementation"]
    max_concurrent_projects = 2
    
    async def on_startup(self):
        """Check if project functionality is available."""
        if self.has_project_mod():
            logger.info(f"🚀 ProjectWorkerAgent '{self.default_agent_id}' started with project support!")
            logger.info(f"   Auto-join projects: {self.auto_join_projects}")
            logger.info(f"   Project keywords: {self.project_keywords}")
            logger.info(f"   Max concurrent projects: {self.max_concurrent_projects}")
        else:
            logger.info(f"📝 ProjectWorkerAgent '{self.default_agent_id}' started without project support (project mod not enabled)")
    
    async def on_direct(self, msg: EventContext):
        """Handle direct messages with project management commands."""
        text = msg.text.lower()
        
        if "create project" in text:
            if not self.has_project_mod():
                await self.send_direct(
                    to=msg.sender_id,
                    text="❌ Project functionality not available - project mod not enabled"
                )
                return
            
            # Extract project goal from message
            goal = text.replace("create project", "").strip()
            if not goal:
                goal = "New project created via direct message"
            
            try:
                result = await self.create_project(
                    goal=goal,
                    name=f"Project by {msg.sender_id}",
                    config={
                        "priority": "medium",
                        "created_by": msg.sender_id,
                        "created_via": "direct_message"
                    }
                )
                
                if result.get("success"):
                    project_id = result["project_id"]
                    channel = result.get("channel_name", "N/A")
                    
                    response = f"""
✅ **Project Created Successfully!**

• **Project ID**: {project_id}
• **Goal**: {goal}
• **Channel**: {channel}
• **Status**: Running

I'll monitor this project and help with tasks!
                    """.strip()
                    
                    await self.send_direct(to=msg.sender_id, text=response)
                else:
                    await self.send_direct(
                        to=msg.sender_id,
                        text=f"❌ Failed to create project: {result.get('error', 'Unknown error')}"
                    )
                    
            except Exception as e:
                await self.send_direct(
                    to=msg.sender_id,
                    text=f"❌ Error creating project: {str(e)}"
                )
        
        elif "list projects" in text or "my projects" in text:
            if not self.has_project_mod():
                await self.send_direct(
                    to=msg.sender_id,
                    text="❌ Project functionality not available - project mod not enabled"
                )
                return
            
            try:
                projects = await self.list_my_projects()
                active_projects = self.get_active_projects()
                
                if not projects and not active_projects:
                    await self.send_direct(
                        to=msg.sender_id,
                        text="📋 No projects found. Say 'create project <goal>' to create one!"
                    )
                    return
                
                response_lines = ["📋 **Your Projects:**"]
                
                # Show active projects first
                if active_projects:
                    response_lines.append("\n**🟢 Active Projects:**")
                    for project_id in active_projects:
                        project_info = self._active_projects.get(project_id, {})
                        name = project_info.get("name", "Unknown")
                        channel = project_info.get("channel", "N/A")
                        response_lines.append(f"• **{name}** ({project_id[:8]}...)")
                        response_lines.append(f"  Channel: {channel}")
                
                # Show all projects from server
                if projects:
                    response_lines.append(f"\n**📊 All Projects ({len(projects)} total):**")
                    for i, project in enumerate(projects[:5], 1):  # Show first 5
                        name = project.get("name", "Unknown")
                        status = project.get("status", "unknown")
                        project_id = project.get("project_id", "")
                        response_lines.append(f"{i}. **{name}** - {status} ({project_id[:8]}...)")
                    
                    if len(projects) > 5:
                        response_lines.append(f"... and {len(projects) - 5} more")
                
                await self.send_direct(to=msg.sender_id, text="\n".join(response_lines))
                
            except Exception as e:
                await self.send_direct(
                    to=msg.sender_id,
                    text=f"❌ Error listing projects: {str(e)}"
                )
        
        elif "project status" in text:
            # Extract project ID from message
            words = text.split()
            project_id = None
            for word in words:
                if len(word) > 8 and "-" in word:  # Looks like a project ID
                    project_id = word
                    break
            
            if not project_id:
                await self.send_direct(
                    to=msg.sender_id,
                    text="Please specify a project ID: 'project status <project_id>'"
                )
                return
            
            if not self.has_project_mod():
                await self.send_direct(
                    to=msg.sender_id,
                    text="❌ Project functionality not available - project mod not enabled"
                )
                return
            
            try:
                status = await self.get_project_status(project_id)
                
                if status.get("success"):
                    project_data = status.get("project_data", {})
                    status_text = f"""
📊 **Project Status**

• **ID**: {project_id}
• **Name**: {project_data.get('name', 'Unknown')}
• **Status**: {project_data.get('status', 'Unknown')}
• **Goal**: {project_data.get('goal', 'N/A')}
• **Created**: {project_data.get('created_timestamp', 'N/A')}
• **Channel**: {project_data.get('channel_name', 'N/A')}
                    """.strip()
                    
                    await self.send_direct(to=msg.sender_id, text=status_text)
                else:
                    await self.send_direct(
                        to=msg.sender_id,
                        text=f"❌ Failed to get project status: {status.get('error', 'Unknown error')}"
                    )
                    
            except Exception as e:
                await self.send_direct(
                    to=msg.sender_id,
                    text=f"❌ Error getting project status: {str(e)}"
                )
        
        else:
            # Default help message
            help_text = """
🤖 **ProjectWorkerAgent Commands:**

• `create project <goal>` - Create a new project
• `list projects` - List all your projects  
• `project status <project_id>` - Get project status

"""
            if self.has_project_mod():
                help_text += f"✅ Project functionality is **enabled**\n"
                help_text += f"📊 Active projects: {len(self.get_active_projects())}"
            else:
                help_text += "❌ Project functionality is **disabled** (project mod not enabled)"
            
            await self.send_direct(to=msg.sender_id, text=help_text.strip())
    
    async def on_project_started(self, event: ProjectEventContext):
        """Handle when a project is started."""
        logger.info(f"🚀 Project started: {event.project_name} ({event.project_id})")
        
        # Send welcome message to project channel
        if event.project_channel:
            await self.send_project_message(
                event.project_id,
                f"🤖 {self.default_agent_id} has joined the project! Ready to help with {event.project_name}"
            )
    
    async def on_project_message(self, event: ProjectMessageContext):
        """Handle messages in project channels."""
        # Skip our own messages
        if event.sender_id == self.client.agent_id:
            return
        
        logger.info(f"📨 Project message in {event.project_name}: {event.message_text}")
        
        text = event.message_text.lower()
        
        if "help" in text or f"@{self.default_agent_id}" in text:
            await self.send_project_message(
                event.project_id,
                f"Hi! I'm {self.default_agent_id}, ready to help with this project. What do you need?"
            )
        
        elif "status" in text:
            try:
                # Get project history
                history = await self.get_project_history(event.project_id, limit=10)
                message_count = len(history)
                
                # Get participants
                participants = set()
                for msg in history:
                    sender = msg.get("sender_id", "")
                    if sender:
                        participants.add(sender)
                
                status_msg = f"""
📊 **Project Status Update**

• **Messages**: {message_count} recent
• **Active participants**: {len(participants)}
• **My status**: Active and monitoring
• **Ready to help**: ✅

Recent activity looks good! Let me know if you need assistance.
                """.strip()
                
                await self.send_project_message(event.project_id, status_msg)
                
            except Exception as e:
                logger.error(f"Error getting project status: {e}")
                await self.send_project_message(
                    event.project_id,
                    "I encountered an error getting the project status, but I'm still here to help!"
                )
        
        elif "complete" in text or "done" in text:
            # Simulate project completion
            try:
                results = {
                    "status": "completed",
                    "deliverables": ["Task analysis", "Implementation plan", "Status monitoring"],
                    "technologies_used": ["OpenAgents", "Python", "AsyncIO"],
                    "completion_notes": f"Project completed successfully with assistance from {self.default_agent_id}"
                }
                
                await self.complete_project(
                    event.project_id,
                    results=results,
                    summary=f"Project '{event.project_name}' completed successfully"
                )
                
                logger.info(f"✅ Completed project {event.project_id}")
                
            except Exception as e:
                logger.error(f"Error completing project: {e}")
                await self.send_project_message(
                    event.project_id,
                    f"I tried to complete the project but encountered an error: {str(e)}"
                )
    
    async def on_project_completed(self, event: ProjectCompletedContext):
        """Handle project completion events."""
        logger.info(f"🎉 Project completed: {event.project_name} by {event.completed_by}")
        
        # Could send notifications, update databases, etc.
        if hasattr(event, 'results') and event.results:
            logger.info(f"   Results: {event.results}")
        if hasattr(event, 'completion_summary') and event.completion_summary:
            logger.info(f"   Summary: {event.completion_summary}")
    
    async def on_project_notification(self, event: ProjectNotificationContext):
        """Handle project notifications."""
        logger.info(f"📢 Project notification ({event.notification_type}): {event.project_name}")
        
        if event.notification_type == "progress":
            # Could respond to progress updates
            pass
        elif event.notification_type == "error":
            # Could help with error resolution
            logger.warning(f"   Error in project {event.project_id}: {event.content}")
    
    async def on_channel_post(self, msg: ChannelMessageContext):
        """Handle channel posts, including project channels."""
        # Check if this is a project channel
        if self.is_project_channel(msg.channel):
            project_id = self.get_project_id_from_channel(msg.channel)
            if project_id:
                logger.info(f"📨 Message in project channel {msg.channel} (project {project_id})")
                # The project event system should handle this, but we can add extra logic here
        else:
            # Regular channel handling
            if "project" in msg.text.lower() and "help" in msg.text.lower():
                await self.send_channel(
                    channel=msg.channel,
                    text=f"I can help with projects! Send me a DM to create or manage projects.",
                    mention=msg.sender_id
                )


async def main():
    """Main function demonstrating WorkerAgent functionality in a network environment."""
    
    print("🚀 Starting WorkerAgent Network Example...")
    print("=" * 60)
    
    # Start network with project support
    print("🌐 Starting network with project support...")
    network = AgentNetwork.load("examples/workspace_network_config.yaml")
    await network.initialize()
    
    # Debug: Check loaded mods
    print(f"🔧 Loaded mods: {list(network.mods.keys())}")
    if "openagents.mods.project.default" in network.mods:
        print("✅ Project mod loaded successfully")
    else:
        print("⚠️  Project mod not loaded - project features will be limited")
    
    # Wait for network to fully initialize
    print("⏳ Waiting for network to fully initialize...")
    await asyncio.sleep(2.0)
    
    # Create and start agents
    print("🤖 Creating WorkerAgent instances...")
    
    # Create different types of agents
    echo_agent = EchoAgent(agent_id="echo-worker")
    helpful_agent = HelpfulAgent(agent_id="helpful-worker") 
    project_worker = ProjectWorkerAgent(agent_id="project-worker")
    file_processor = FileProcessorAgent(agent_id="file-worker")
    
    agents = [echo_agent, helpful_agent, project_worker, file_processor]
    
    try:
        # Start all agents
        print("🔌 Connecting agents to network...")
        for i, agent in enumerate(agents):
            print(f"   Starting {agent.default_agent_id} agent ({agent.client.agent_id})...")
            try:
                await agent.async_start("localhost", 8570)
                print(f"   ✅ {agent.default_agent_id} agent connected successfully")
            except Exception as e:
                print(f"   ❌ Failed to start {agent.default_agent_id} agent: {e}")
                raise
        
        # Give agents time to connect and register
        print("⏳ Waiting for agents to fully connect...")
        await asyncio.sleep(3)
        
        # Demonstrate agent interactions
        print("\n📋 Demonstrating agent interactions...")
        
        # Get workspace for testing
        print("🔧 Creating workspace...")
        ws = network.workspace()
        
        # Test 1: Direct messaging between agents
        print("\n💬 Test 1: Direct messaging...")
        await helpful_agent.send_direct(
            to="echo-worker",
            text="Hello echo agent! This is a test message from helpful agent."
        )
        print("   ✅ Sent direct message from helpful to echo agent")
        
        # Test 2: Channel communication
        print("\n📢 Test 2: Channel communication...")
        # Create a test channel
        test_channel = ws.channel("#general")
        await test_channel.post("🎉 WorkerAgent network is now active! All agents are connected.")
        print("   ✅ Posted message to #general channel")
        
        # Test 3: Agent mentions
        await test_channel.post("Hey @helpful-worker, can you show us your capabilities?")
        print("   ✅ Mentioned helpful agent in channel")
        
        # Test 4: Project creation (if project mod is available)
        if "openagents.mods.project.default" in network.mods:
            print("\n🚀 Test 4: Project-based collaboration...")
            
            # Create a test project
            test_project = Project(
                goal="Demonstrate WorkerAgent project collaboration",
                name="WorkerAgent Demo Project"
            )
            test_project.config = {
                "demo": True,
                "agents": ["project-worker", "helpful-worker"]
            }
            
            print(f"📝 Creating project: {test_project.name}")
            try:
                result = await ws.start_project(test_project, timeout=10.0)
                if result.get("success"):
                    print(f"✅ Project created successfully!")
                    print(f"   Project ID: {result['project_id']}")
                    print(f"   Channel: {result['channel_name']}")
                    
                    # Send some tasks to the project channel
                    project_channel = ws.channel(result['channel_name'])
                    await project_channel.post("🎯 TASK: Analyze system requirements")
                    await asyncio.sleep(1)
                    await project_channel.post("🔧 TASK: Design architecture")
                    await asyncio.sleep(1)
                    await project_channel.post("✅ TASK: Implement solution")
                    
                    print("   ✅ Sent tasks to project channel")
                    
                    # Wait for project worker to process
                    print("   ⏳ Waiting for project worker to process tasks...")
                    await asyncio.sleep(5)
                    
                else:
                    print(f"❌ Project creation failed: {result.get('error')}")
            except Exception as e:
                print(f"❌ Project creation error: {e}")
        
        # Test 5: File processing simulation
        print("\n📁 Test 5: File processing simulation...")
        # Simulate file upload notification
        await helpful_agent.send_direct(
            to="file-worker",
            text="📎 Simulated file upload: demo.txt (1024 bytes, text/plain)"
        )
        print("   ✅ Sent file processing request")
        
        # Test 6: Command handling
        print("\n⚡ Test 6: Command handling...")
        await helpful_agent.send_direct(
            to="helpful-worker",
            text="/help"
        )
        print("   ✅ Sent help command to helpful agent")
        
        # Let agents interact for a while
        print("\n🎭 Letting agents interact...")
        print("   📋 Agents are now running and can communicate with each other")
        print("   📋 Check the logs to see their interactions")
        print("   📋 Press Ctrl+C to stop the demo")
        
        # Monitor for a bit
        for i in range(10):
            await asyncio.sleep(2)
            print(f"   ⏱️  Running... ({i+1}/10)")
        
        print("\n✅ Demo completed successfully!")
        
        # Show summary
        print(f"\n📊 Demo Summary:")
        print(f"   ✅ Network started with {len(network.mods)} mods")
        print(f"   ✅ {len(agents)} WorkerAgent instances connected")
        print(f"   ✅ Direct messaging demonstrated")
        print(f"   ✅ Channel communication demonstrated")
        print(f"   ✅ Agent mentions demonstrated")
        if "openagents.mods.project.default" in network.mods:
            print(f"   ✅ Project-based collaboration demonstrated")
        print(f"   ✅ File processing simulation demonstrated")
        print(f"   ✅ Command handling demonstrated")
        print(f"   💡 WorkerAgent provides a convenient interface for all these features!")
        
    except Exception as e:
        print(f"❌ Error during demo: {e}")
        import traceback
        traceback.print_exc()
    
    finally:
        # Cleanup
        print("\n🧹 Cleaning up...")
        
        # Stop all agents
        for agent in agents:
            try:
                await agent.async_stop()
                print(f"   ✅ Stopped {agent.default_agent_id} agent")
            except Exception as e:
                print(f"   ⚠️  Error stopping {agent.default_agent_id} agent: {e}")
        
        # Shutdown network
        await network.shutdown()
        print("   ✅ Network shutdown complete")
        print("👋 Demo cleanup completed!")


async def run_simple_agents():
    """Simple example of running agents without network setup (for testing)."""
    
    print("🧪 Running simple agent test (no network)...")
    
    # Create agents
    echo = EchoAgent(agent_id="echo-test")
    helpful = HelpfulAgent(agent_id="helpful-test")
    
    agents = [echo, helpful]
    
    try:
        # Start agents (they will try to connect to existing network)
        for agent in agents:
            print(f"Starting {agent.default_agent_id} agent...")
            await agent.async_start(host="localhost", port=8570)
        
        print("Agents started. Running for 10 seconds...")
        await asyncio.sleep(10)
        
    except Exception as e:
        print(f"Error: {e}")
    finally:
        # Stop agents
        for agent in agents:
            await agent.async_stop()
        print("Simple test completed.")


if __name__ == "__main__":
    print("🏢 OpenAgents WorkerAgent Network Example")
    print("=" * 60)
    
    # Run the main network demo
    asyncio.run(main())
