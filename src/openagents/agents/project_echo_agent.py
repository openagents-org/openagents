import logging
import asyncio
import random
from typing import Dict, List, Optional

from openagents.agents.runner import AgentRunner
from openagents.models.message_thread import MessageThread
from openagents.models.messages import BaseMessage, DirectMessage, BroadcastMessage, ModMessage
from openagents.workspace.project_messages import ProjectNotificationMessage

logger = logging.getLogger(__name__)


class ProjectEchoAgentRunner(AgentRunner):
    """An enhanced echo agent that can participate in projects and complete them.
    
    This agent:
    1. Echoes back direct messages (like the original echo agent)
    2. Monitors project channels for new tasks
    3. Automatically completes projects with random responses
    4. Emits project.run.completed events
    """

    def __init__(self, agent_id: str, protocol_names: Optional[List[str]] = None, ignored_sender_ids: Optional[List[str]] = None, echo_prefix: Optional[str] = "ProjectEcho"):
        """Initialize the ProjectEchoAgentRunner.
        
        Args:
            agent_id: Unique identifier for this agent
            protocol_names: List of protocol names to register with
            ignored_sender_ids: List of sender IDs to ignore messages from
            echo_prefix: Prefix to add to echoed messages (default: "ProjectEcho")
        """
        super().__init__(agent_id=agent_id, ignored_sender_ids=ignored_sender_ids)
        self.echo_prefix = echo_prefix or "ProjectEcho"
        self.message_count = 0
        self.active_projects = set()  # Track projects we're working on
        self.project_tasks = {}  # Track tasks for each project
        
        # Random responses for project completion
        self.completion_responses = [
            {
                "status": "completed",
                "deliverables": ["User authentication system", "Login/logout functionality", "Password reset feature"],
                "technologies_used": ["Python", "FastAPI", "JWT", "bcrypt"],
                "completion_notes": "Successfully implemented secure user authentication with JWT tokens and password hashing."
            },
            {
                "status": "completed", 
                "deliverables": ["Database schema", "API endpoints", "Frontend components"],
                "technologies_used": ["React", "TypeScript", "PostgreSQL", "REST API"],
                "completion_notes": "Built complete full-stack solution with responsive UI and robust backend."
            },
            {
                "status": "completed",
                "deliverables": ["Deployment pipeline", "Testing suite", "Documentation"],
                "technologies_used": ["Docker", "GitHub Actions", "Jest", "Swagger"],
                "completion_notes": "Established CI/CD pipeline with comprehensive testing and API documentation."
            },
            {
                "status": "completed",
                "deliverables": ["Performance optimization", "Security audit", "Code review"],
                "technologies_used": ["Redis", "SSL/TLS", "OWASP", "SonarQube"],
                "completion_notes": "Optimized application performance and implemented security best practices."
            }
        ]

    async def react(self, message_threads: Dict[str, MessageThread], incoming_thread_id: str, incoming_message: BaseMessage):
        """React to incoming messages and handle project participation."""
        self.message_count += 1
        sender_id = incoming_message.sender_id
        content = incoming_message.content
        
        # Extract text content
        if isinstance(content, dict):
            text = content.get('text', str(content))
        else:
            text = str(content)
        
        logger.info(f"🤖 ProjectEcho agent processing message from {sender_id}: {text}")
        logger.info(f"   Message type: {type(incoming_message).__name__}")
        logger.info(f"   Thread ID: {incoming_thread_id}")
        logger.info(f"   Content: {content}")
        
        # Handle different message types
        if isinstance(incoming_message, DirectMessage):
            logger.info("   → Handling as DirectMessage")
            await self._handle_direct_message(sender_id, text)
            
        elif isinstance(incoming_message, BroadcastMessage):
            logger.info("   → Handling as BroadcastMessage")
            await self._handle_broadcast_message(sender_id, text)
            
        elif isinstance(incoming_message, ModMessage):
            logger.info("   → Handling as ModMessage")
            await self._handle_mod_message(incoming_message)
            
        else:
            logger.info(f"   → Unknown message type: {type(incoming_message)}")
            
        # Check if this is a project channel message
        await self._check_project_channel_message(incoming_thread_id, incoming_message, text)

    async def _handle_direct_message(self, sender_id: str, text: str):
        """Handle direct messages with echo functionality."""
        logger.info(f"Processing direct message from {sender_id}")
        
        # Create echo response
        echo_text = f"{self.echo_prefix}: {text}"
        echo_message = DirectMessage(
            sender_id=self.client.agent_id,
            target_agent_id=sender_id,
            message_type="direct_message",
            content={"text": echo_text},
            text_representation=echo_text,
            requires_response=False
        )
        
        # Send the echo message back
        await self.client.send_direct_message(echo_message)
        logger.info(f"✅ Sent echo message back to {sender_id}: {echo_text}")

    async def _handle_broadcast_message(self, sender_id: str, text: str):
        """Handle broadcast messages with greeting functionality."""
        logger.info(f"Processing broadcast message from {sender_id}")
        
        # Respond to greetings in broadcast messages
        if "hello" in text.lower() and sender_id != self.client.agent_id:
            greeting_text = f"Hello {sender_id}! I'm a project-aware echo agent. I can participate in projects and complete them!"
            greeting_message = DirectMessage(
                sender_id=self.client.agent_id,
                target_agent_id=sender_id,
                message_type="direct_message",
                content={"text": greeting_text},
                text_representation=greeting_text,
                requires_response=False
            )
            await self.client.send_direct_message(greeting_message)
            logger.info(f"✅ Sent greeting message to {sender_id}")

    async def _handle_mod_message(self, message: ModMessage):
        """Handle ModMessage notifications, especially channel message notifications."""
        logger.info(f"🔥 PROCESSING MODMESSAGE from {message.sender_id}: {message.content}")
        
        # Check if this is a channel message notification
        if message.content.get("action") == "channel_message_notification":
            channel_msg_data = message.content.get("message", {})
            channel = message.content.get("channel", "")
            
            logger.info(f"🔥 RECEIVED CHANNEL MESSAGE NOTIFICATION for {channel}")
            logger.info(f"🔥 Message data: {channel_msg_data}")
            
            # Extract the actual message content
            text = channel_msg_data.get("content", {}).get("text", "")
            sender_id = channel_msg_data.get("sender_id", "")
            
            # Skip our own messages
            if sender_id == self.client.agent_id:
                logger.info(f"🔥 SKIPPING our own message in {channel}")
                return
            
            logger.info(f"🔥 PROCESSING channel message from {sender_id} in {channel}: {text}")
            
            # Check if this is a project channel and handle the task
            if channel.startswith("#project-") or "project" in channel.lower():
                logger.info(f"🔥 DETECTED PROJECT CHANNEL - handling task!")
                await self._handle_project_task_from_channel(channel, sender_id, text, channel_msg_data)
            else:
                logger.info(f"🔥 NOT A PROJECT CHANNEL: {channel}")
        else:
            logger.info(f"🔥 NOT A CHANNEL MESSAGE NOTIFICATION: action={message.content.get('action')}")

    async def _check_project_channel_message(self, thread_id: str, message: BaseMessage, text: str):
        """Check if this is a project channel message and handle project tasks."""
        # Check if this is a project channel (starts with "project-")
        if thread_id.startswith("project-") or "project" in thread_id.lower():
            logger.info(f"Detected project channel message in {thread_id}: {text}")
            
            # Extract project ID from thread/channel name
            project_id = self._extract_project_id(thread_id)
            if project_id:
                await self._handle_project_task(project_id, message, text)

    def _extract_project_id(self, thread_id: str) -> Optional[str]:
        """Extract project ID from thread/channel name."""
        # Handle different project channel naming patterns
        if thread_id.startswith("project-"):
            # Format: "project-{project_id[:8]}" or similar
            return thread_id.replace("project-", "")
        elif "project" in thread_id.lower():
            # Try to extract UUID-like patterns
            parts = thread_id.split("-")
            if len(parts) > 1:
                return "-".join(parts[1:])  # Return everything after "project"
        return None

    async def _handle_project_task_from_channel(self, channel: str, sender_id: str, text: str, message_data: dict):
        """Handle a project task received from a channel message notification."""
        # Extract project ID from channel name
        project_id = self._extract_project_id(channel)
        if not project_id:
            logger.warning(f"Could not extract project ID from channel {channel}")
            return
            
        logger.info(f"Handling project task for project {project_id} from channel {channel}: {text}")
        
        # Add project to active projects
        self.active_projects.add(project_id)
        
        # Track the task
        if project_id not in self.project_tasks:
            self.project_tasks[project_id] = []
        self.project_tasks[project_id].append({
            "task": text,
            "sender": sender_id,
            "timestamp": message_data.get("timestamp", 0),
            "channel": channel
        })
        
        # Simulate working on the task (wait a bit)
        work_delay = random.uniform(2.0, 5.0)  # Random delay between 2-5 seconds
        logger.info(f"🔧 Working on project {project_id} task for {work_delay:.1f} seconds...")
        await asyncio.sleep(work_delay)
        
        # Complete the project with a random response
        await self._complete_project(project_id, text)

    async def _handle_project_task(self, project_id: str, message: BaseMessage, text: str):
        """Handle a task in a project channel (legacy method)."""
        sender_id = message.sender_id
        
        # Skip our own messages
        if sender_id == self.client.agent_id:
            return
            
        logger.info(f"Handling project task for project {project_id}: {text}")
        
        # Add project to active projects
        self.active_projects.add(project_id)
        
        # Track the task
        if project_id not in self.project_tasks:
            self.project_tasks[project_id] = []
        self.project_tasks[project_id].append({
            "task": text,
            "sender": sender_id,
            "timestamp": message.timestamp
        })
        
        # Simulate working on the task (wait a bit)
        work_delay = random.uniform(2.0, 5.0)  # Random delay between 2-5 seconds
        logger.info(f"Working on project {project_id} task for {work_delay:.1f} seconds...")
        await asyncio.sleep(work_delay)
        
        # Complete the project with a random response
        await self._complete_project(project_id, text)

    async def _complete_project(self, project_id: str, original_task: str):
        """Complete a project with a random response."""
        # Choose a random completion response
        completion_data = random.choice(self.completion_responses)
        
        # Customize the response based on the original task
        customized_response = completion_data.copy()
        customized_response["original_task"] = original_task
        customized_response["agent_id"] = self.client.agent_id
        customized_response["project_id"] = project_id
        customized_response["completion_time"] = "2024-01-01T12:00:00Z"
        
        # Add task-specific customizations
        if "web" in original_task.lower() or "app" in original_task.lower():
            customized_response["deliverables"].append("Web application deployed")
        if "auth" in original_task.lower():
            customized_response["deliverables"].append("Authentication system tested")
        if "api" in original_task.lower():
            customized_response["deliverables"].append("API documentation updated")
        
        logger.info(f"Completing project {project_id} with response: {customized_response}")
        
        # Send project completion notification
        completion_message = ProjectNotificationMessage(
            sender_id=self.client.agent_id,
            project_id=project_id,
            notification_type="completion",
            content={
                "results": customized_response,
                "completed_by": self.client.agent_id,
                "completion_summary": f"Project completed successfully by {self.echo_prefix} agent"
            }
        )
        
        try:
            # Send the completion message to the project mod
            await self.client.connector.send_message(completion_message)
            logger.info(f"✅ Sent project completion notification for project {project_id}")
            
            # Remove from active projects
            self.active_projects.discard(project_id)
            
        except Exception as e:
            logger.error(f"❌ Failed to send project completion notification: {e}")

    async def setup(self):
        """Setup the agent."""
        logger.info(f"Setting up ProjectEcho agent {self.client.agent_id}")
        
    async def teardown(self):
        """Teardown the agent."""
        logger.info(f"Tearing down ProjectEcho agent {self.client.agent_id}")
        
        # Complete any remaining active projects
        for project_id in list(self.active_projects):
            logger.info(f"Completing remaining project {project_id} during teardown")
            await self._complete_project(project_id, "Agent shutdown - completing remaining work")
