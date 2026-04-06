import logging
import asyncio
import random
from typing import Dict, List, Optional

from openagents.agents.runner import AgentRunner
from openagents.models.event_thread import EventThread
from openagents.models.messages import Event, EventNames
from openagents.models.event import Event
from openagents.models.event_context import EventContext
from openagents.workspace.project_messages import ProjectCompleteMessage

logger = logging.getLogger(__name__)


class ProjectEchoAgentRunner(AgentRunner):
    """An enhanced echo agent that can participate in projects and complete them.

    This agent:
    1. Echoes back direct messages (like the original echo agent)
    2. Monitors project channels for new tasks
    3. Automatically completes projects with random responses
    4. Emits project.run.completed events
    """

    def __init__(
        self,
        agent_id: str,
        protocol_names: Optional[List[str]] = None,
        ignored_sender_ids: Optional[List[str]] = None,
        echo_prefix: Optional[str] = "ProjectEcho",
    ):
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
        self.discovered_projects = set()  # Track projects discovered from events

        # Random responses for project completion
        self.completion_responses = [
            {
                "status": "completed",
                "deliverables": [
                    "User authentication system",
                    "Login/logout functionality",
                    "Password reset feature",
                ],
                "technologies_used": ["Python", "FastAPI", "JWT", "bcrypt"],
                "completion_notes": "Successfully implemented secure user authentication with JWT tokens and password hashing.",
            },
            {
                "status": "completed",
                "deliverables": [
                    "Database schema",
                    "API endpoints",
                    "Frontend components",
                ],
                "technologies_used": ["React", "TypeScript", "PostgreSQL", "REST API"],
                "completion_notes": "Built complete full-stack solution with responsive UI and robust backend.",
            },
            {
                "status": "completed",
                "deliverables": [
                    "Deployment pipeline",
                    "Testing suite",
                    "Documentation",
                ],
                "technologies_used": ["Docker", "GitHub Actions", "Jest", "Swagger"],
                "completion_notes": "Established CI/CD pipeline with comprehensive testing and API documentation.",
            },
            {
                "status": "completed",
                "deliverables": [
                    "Performance optimization",
                    "Security audit",
                    "Code review",
                ],
                "technologies_used": ["Redis", "SSL/TLS", "OWASP", "SonarQube"],
                "completion_notes": "Optimized application performance and implemented security best practices.",
            },
        ]

    async def react(self, context: EventContext):
        """React to incoming messages and handle project participation."""
        incoming_message = context.incoming_event
        incoming_thread_id = context.incoming_thread_id
        event_threads = context.event_threads

        self.message_count += 1
        sender_id = incoming_message.source_id
        content = incoming_message.payload

        # Extract text content
        if isinstance(content, dict):
            text = content.get("text", str(content))
        else:
            text = str(content)

        logger.info(f"🤖 ProjectEcho agent processing message from {sender_id}: {text}")
        logger.info(f"   Message type: {type(incoming_message).__name__}")
        logger.info(f"   Thread ID: {incoming_thread_id}")
        logger.info(f"   Content: {content}")

        # Handle different message types
        if isinstance(incoming_message, Event):
            logger.info("   → Handling as Event")
            await self._handle_direct_message(sender_id, text)

        elif isinstance(incoming_message, Event):
            logger.info("   → Handling as Event")
            await self._handle_broadcast_message(sender_id, text)

        elif isinstance(incoming_message, Event):
            logger.info("   → Handling as Event")
            await self._handle_mod_message(incoming_message)

        else:
            logger.info(f"   → Unknown message type: {type(incoming_message)}")

        # Check if this is a project channel message
        await self._check_project_channel_message(
            incoming_thread_id, incoming_message, text
        )

    async def _handle_direct_message(self, sender_id: str, text: str):
        """Handle direct messages with echo functionality."""
        logger.info(f"Processing direct message from {sender_id}")

        # Create echo response
        echo_text = f"{self.echo_prefix}: {text}"
        echo_message = Event(
            event_name="agent.message",
            source_id=self.client.agent_id,
            destination_id=sender_id,
            payload={"text": echo_text},
            text_representation=echo_text,
            requires_response=False,
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
            greeting_message = Event(
                sender_id=self.client.agent_id,
                destination_id=sender_id,
                message_type="direct_message",
                content={"text": greeting_text},
                text_representation=greeting_text,
                requires_response=False,
            )
            await self.client.send_direct_message(greeting_message)
            logger.info(f"✅ Sent greeting message to {sender_id}")

    async def _handle_mod_message(self, message: Event):
        """Handle Event notifications, especially channel message notifications."""
        logger.info(f"🔧 PROJECT ECHO AGENT: Received Event from {message.source_id}")
        logger.info(f"🔧 PROJECT ECHO AGENT: Event content: {message.payload}")

        # Check if this is a channel message notification
        if message.payload.get("action") == "channel_message_notification":
            channel_msg_data = message.payload.get("message", {})
            channel = message.content.get("channel", "")

            logger.info(
                f"🔧 PROJECT ECHO AGENT: Received channel message notification for {channel}"
            )

            # Extract the actual message content
            text = channel_msg_data.get("content", {}).get("text", "")
            sender_id = channel_msg_data.get("sender_id", "")

            # Skip our own messages
            if sender_id == self.client.agent_id:
                logger.info(
                    f"🔧 PROJECT ECHO AGENT: Skipping our own message in {channel}"
                )
                return

            logger.info(
                f"🔧 PROJECT ECHO AGENT: Processing channel message from {sender_id} in {channel}: {text}"
            )

            # Check if this is a project channel and handle the task
            # Handle both "project-" and "#project-" formats
            channel_name = channel.lstrip("#")  # Remove # prefix if present
            if channel_name.startswith("project-") or "project" in channel_name.lower():
                logger.info(
                    f"🔧 PROJECT ECHO AGENT: Detected project channel - handling task!"
                )
                await self._handle_project_task_from_channel(
                    channel, sender_id, text, channel_msg_data
                )
            else:
                logger.info(f"🔧 PROJECT ECHO AGENT: Not a project channel: {channel}")
        elif message.content.get("action") == "project_event":
            # Handle project events to discover real project IDs
            event_type = message.content.get("event_type", "")
            project_data = message.content.get("data", {})

            if event_type == "project.created":
                project_id = project_data.get("project_id")
                if project_id:
                    self.discovered_projects.add(project_id)
                    logger.info(
                        f"🔧 PROJECT ECHO AGENT: Discovered new project: {project_id}"
                    )
        else:
            logger.info(
                f"🔧 PROJECT ECHO AGENT: Not a channel message notification: action={message.content.get('action')}"
            )

    async def _check_project_channel_message(
        self, thread_id: str, message: Event, text: str
    ):
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

    async def _handle_project_task_from_channel(
        self, channel: str, sender_id: str, text: str, message_data: dict
    ):
        """Handle a project task received from a channel message notification."""
        # Extract project ID from channel name
        project_id = self._extract_project_id(channel)
        if not project_id:
            logger.warning(f"Could not extract project ID from channel {channel}")
            return

        logger.info(
            f"Handling project task for project {project_id} from channel {channel}: {text}"
        )

        # Add project to active projects
        self.active_projects.add(project_id)

        # Track the task
        if project_id not in self.project_tasks:
            self.project_tasks[project_id] = []
        self.project_tasks[project_id].append(
            {
                "task": text,
                "sender": sender_id,
                "timestamp": message_data.get("timestamp", 0),
                "channel": channel,
            }
        )

        # Simulate working on the task (wait a bit)
        work_delay = random.uniform(2.0, 5.0)  # Random delay between 2-5 seconds
        logger.info(
            f"🔧 Working on project {project_id} task for {work_delay:.1f} seconds..."
        )
        await asyncio.sleep(work_delay)

        # Complete the project with a random response
        await self._complete_project(project_id, text)

    async def _handle_project_task(self, project_id: str, message: Event, text: str):
        """Handle a task in a project channel."""
        sender_id = message.source_id

        # Skip our own messages
        if sender_id == self.client.agent_id:
            return

        logger.info(f"Handling project task for project {project_id}: {text}")

        # Add project to active projects
        self.active_projects.add(project_id)

        # Track the task
        if project_id not in self.project_tasks:
            self.project_tasks[project_id] = []
        self.project_tasks[project_id].append(
            {"task": text, "sender": sender_id, "timestamp": message.timestamp}
        )

        # Simulate working on the task (wait a bit)
        work_delay = random.uniform(2.0, 5.0)  # Random delay between 2-5 seconds
        logger.info(
            f"Working on project {project_id} task for {work_delay:.1f} seconds..."
        )
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

        logger.info(
            f"Completing project {project_id} with response: {customized_response}"
        )

        # Send project completion notification using new event system
        completion_summary = f"Project completed successfully by {self.echo_prefix} agent. Results: {customized_response}"
        completion_message = ProjectCompleteMessage(
            project_id=project_id,
            summary=completion_summary,
            source_id=self.client.agent_id
        )

        try:
            # Send the completion message to the project mod
            await self.client.connector.send_message(completion_message)
            logger.info(
                f"✅ Sent project completion notification for project {project_id}"
            )

            # Remove from active projects
            self.active_projects.discard(project_id)

        except Exception as e:
            logger.error(f"❌ Failed to send project completion notification: {e}")

    async def _periodic_channel_check(self):
        """Periodically check for project activity and auto-complete projects.

        This is a workaround for gRPC transport not supporting bidirectional messaging.
        In a real implementation, the agent would receive channel message notifications directly.
        """
        logger.info("🔧 Starting periodic project monitoring (gRPC workaround)...")

        # Wait a bit for the system to settle
        await asyncio.sleep(5.0)

        # Simulate project completion for demo purposes
        # In a real implementation, this would be triggered by actual channel messages
        project_completed = False

        while not project_completed:
            try:
                await asyncio.sleep(3.0)  # Check every 3 seconds

                # Check if there are any projects that need to be completed
                # For the demo, we'll complete any project after detecting activity
                logger.info("🔧 PROJECT ECHO AGENT: Checking for project activity...")

                # Complete any discovered projects
                # This is a demo workaround - in production, this would be event-driven
                if not project_completed and self.discovered_projects:
                    logger.info(
                        "🔧 PROJECT ECHO AGENT: Found discovered projects to complete"
                    )

                    # Complete the first discovered project
                    project_id = next(iter(self.discovered_projects))
                    logger.info(
                        f"🔧 PROJECT ECHO AGENT: Completing discovered project {project_id}"
                    )

                    # Complete the project
                    await self._complete_project(
                        project_id,
                        "Project completed by ProjectEchoAgent via periodic monitoring",
                    )
                    project_completed = True

                    logger.info("✅ PROJECT ECHO AGENT: Real project completion sent!")
                elif not project_completed:
                    logger.info(
                        "🔧 PROJECT ECHO AGENT: No discovered projects yet, waiting..."
                    )

            except Exception as e:
                logger.error(f"Error in periodic project monitoring: {e}")
                await asyncio.sleep(5.0)  # Wait longer on error

    async def setup(self):
        """Setup the agent."""
        logger.info(f"Setting up ProjectEcho agent {self.client.agent_id}")

        # Manually load ThreadMessagingAgentAdapter if not already loaded
        logger.info(
            f"🔧 Available mod adapters: {list(self.client.mod_adapters.keys())}"
        )

        if "ThreadMessagingAgentAdapter" not in self.client.mod_adapters:
            logger.info("🔧 ThreadMessagingAgentAdapter not found, loading manually...")
            try:
                from openagents.utils.mod_loaders import load_mod_adapters

                thread_adapters = load_mod_adapters(
                    ["openagents.mods.workspace.messaging"]
                )
                for adapter in thread_adapters:
                    self.client.register_mod_adapter(adapter)
                    logger.info(f"🔧 Manually loaded adapter: {adapter.mod_name}")
            except Exception as e:
                logger.error(
                    f"Failed to manually load ThreadMessagingAgentAdapter: {e}"
                )

        # Register with thread messaging adapter for channel notifications
        thread_adapter = None
        for key in [
            "ThreadMessagingAgentAdapter",
            "thread_messaging",
            "openagents.mods.workspace.messaging",
        ]:
            if key in self.client.mod_adapters:
                thread_adapter = self.client.mod_adapters[key]
                logger.info(f"🔧 Found thread messaging adapter with key: {key}")
                break

        if thread_adapter:
            thread_adapter.set_agent_mod_message_handler(self._handle_mod_message)
            logger.info(
                "🔧 Registered with thread messaging adapter for channel notifications"
            )

            # Start periodic channel checking as a workaround for gRPC transport limitations
            logger.info(
                "🔧 Starting periodic channel message checking (gRPC workaround)"
            )
            asyncio.create_task(self._periodic_channel_check())
        else:
            logger.warning(
                "⚠️  Thread messaging adapter not found - channel notifications may not work"
            )
            logger.warning(
                f"⚠️  Available adapters: {list(self.client.mod_adapters.keys())}"
            )

    async def teardown(self):
        """Teardown the agent."""
        logger.info(f"Tearing down ProjectEcho agent {self.client.agent_id}")

        # Complete any remaining active projects
        for project_id in list(self.active_projects):
            logger.info(f"Completing remaining project {project_id} during teardown")
            await self._complete_project(
                project_id, "Agent shutdown - completing remaining work"
            )
