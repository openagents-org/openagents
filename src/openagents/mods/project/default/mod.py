"""
Network-level default project mod for OpenAgents.

This mod provides project-based collaboration functionality including:
- Project creation and management
- Private channel creation for projects
- Service agent coordination
- Project lifecycle events
- Long-horizon task support
"""

import logging
import asyncio
import time
from typing import Dict, Any, List, Optional, Set
from datetime import datetime

from openagents.core.base_mod import BaseMod
from openagents.models.messages import Event, EventNames
from openagents.models.event import Event
from openagents.workspace.project import Project
from openagents.workspace.project_messages import (
    ProjectCreationMessage,
    ProjectStatusMessage,
    ProjectNotificationMessage,
    ProjectChannelMessage,
    ProjectListMessage
)

logger = logging.getLogger(__name__)


class DefaultProjectNetworkMod(BaseMod):
    """
    Network-level mod for default project functionality.
    
    This mod manages project-based collaboration at the network level,
    creating private channels for projects and coordinating service agents.
    """
    
    def __init__(self, mod_name: str = "project.default"):
        """Initialize the default project network mod."""
        super().__init__(mod_name=mod_name)
        
        # Project management
        self.projects: Dict[str, Project] = {}  # project_id -> Project
        self.agent_projects: Dict[str, Set[str]] = {}  # agent_id -> {project_ids}
        self.project_channels: Dict[str, str] = {}  # project_id -> channel_name
        self.channel_projects: Dict[str, str] = {}  # channel_name -> project_id
        
        # Configuration
        self.max_concurrent_projects = 10
        self.default_service_agents: List[str] = []
        self.project_channel_prefix = "project-"
        self.auto_invite_service_agents = True
        self.project_timeout_hours = 24
        self.enable_project_persistence = True
        
        logger.info(f"Initializing Project network mod")
    
    def initialize(self) -> bool:
        """Initialize the mod with configuration."""
        # Load configuration
        config = self.config or {}
        self.max_concurrent_projects = config.get('max_concurrent_projects', 10)
        self.default_service_agents = config.get('default_service_agents', [])
        self.project_channel_prefix = config.get('project_channel_prefix', 'project-')
        self.auto_invite_service_agents = config.get('auto_invite_service_agents', True)
        self.project_timeout_hours = config.get('project_timeout_hours', 24)
        self.enable_project_persistence = config.get('enable_project_persistence', True)
        
        logger.info(f"Project mod initialized with config: {config}")
        return True
    
    def shutdown(self) -> bool:
        """Shutdown the mod gracefully."""
        # Stop all running projects
        for project in self.projects.values():
            if project.is_active():
                project.stop()
        
        # Clear all state
        self.projects.clear()
        self.agent_projects.clear()
        self.project_channels.clear()
        self.channel_projects.clear()
        
        logger.info("Project mod shutdown completed")
        return True
    
    def handle_register_agent(self, agent_id: str, metadata: Dict[str, Any]) -> None:
        """Register an agent with the project mod.
        
        Args:
            agent_id: Unique identifier for the agent
            metadata: Agent metadata including capabilities
        """
        # Initialize agent's project set
        if agent_id not in self.agent_projects:
            self.agent_projects[agent_id] = set()
        
        logger.info(f"Registered agent {agent_id} with Project mod")
    
    def handle_unregister_agent(self, agent_id: str) -> None:
        """Unregister an agent from the project mod.
        
        Args:
            agent_id: Unique identifier for the agent
        """
        if agent_id in self.agent_projects:
            # Remove agent from all their projects
            project_ids = self.agent_projects[agent_id].copy()
            for project_id in project_ids:
                if project_id in self.projects:
                    project = self.projects[project_id]
                    if agent_id in project.service_agents:
                        project.service_agents.remove(agent_id)
                    
                    # Emit agent left event
                    asyncio.create_task(self._emit_project_event(
                        "project.agent.left",
                        project_id,
                        agent_id,
                        {"left_agent_id": agent_id}
                    ))
            
            del self.agent_projects[agent_id]
        
        logger.info(f"Unregistered agent {agent_id} from Project mod")
    
    async def process_system_message(self, message: Event) -> None:
        """Process a mod message.
        
        Args:
            message: The mod message to process
        """
        try:
            content = message.content
            event_name = getattr(message, 'event_name', '')
            
            # Try to determine action from event_name first, fallback to message_type in payload
            message_type = content.get("message_type") if isinstance(content, dict) else None
            
            logger.info(f"🔧 PROJECT MOD: Received event: {event_name}")
            logger.info(f"🔧 PROJECT MOD: Message content keys: {list(content.keys())}")
            logger.info(f"🔧 PROJECT MOD: Sender: {message.sender_id}")
            
            # Route based on event_name patterns first, then fallback to message_type
            if event_name == "project.create" or event_name == "project.creation.request" or message_type == "project_creation":
                logger.info(f"🔧 PROJECT MOD: Processing project creation")
                # Extract request_id from content before creating the message
                request_id = content.get('request_id', message.message_id)
                logger.info(f"🔧 PROJECT MOD: Extracted request_id: {request_id}")
                inner_message = ProjectCreationMessage(**content)
                # Pass the original event_name for action determination
                inner_message.event_name = event_name
                # Store request_id in the message for response correlation
                inner_message.request_id = request_id
                await self._process_project_creation(inner_message)
            elif event_name == "project.status" or event_name == "project.status.request" or message_type == "project_status":
                logger.info(f"🔧 PROJECT MOD: Processing project status")
                # Extract request_id from content before creating the message
                request_id = content.get('request_id', message.message_id)
                logger.info(f"🔧 PROJECT MOD: Extracted request_id: {request_id}")
                inner_message = ProjectStatusMessage(**content)
                # Pass the original event_name for action determination
                inner_message.event_name = event_name
                # Store request_id in the message for response correlation
                inner_message.request_id = request_id
                await self._process_project_status(inner_message)
            elif event_name == "project.notification" or event_name == "project.notify" or message_type == "project_notification":
                logger.info(f"🔧 PROJECT MOD: Processing project notification")
                inner_message = ProjectNotificationMessage(**content)
                # Pass the original event_name for action determination
                inner_message.event_name = event_name
                await self._process_project_notification(inner_message)
            elif event_name == "project.channel" or event_name == "project.channel.request" or message_type == "project_channel":
                logger.info(f"🔧 PROJECT MOD: Processing project channel")
                inner_message = ProjectChannelMessage(**content)
                # Pass the original event_name for action determination
                inner_message.event_name = event_name
                await self._process_project_channel(inner_message)
            elif event_name == "project.list" or event_name == "project.list.request" or message_type == "project_list":
                logger.info(f"🔧 PROJECT MOD: Processing project list")
                # Extract request_id from content before creating the message
                request_id = content.get('request_id', message.message_id)
                logger.info(f"🔧 PROJECT MOD: Extracted request_id: {request_id}")
                inner_message = ProjectListMessage(**content)
                # Pass the original event_name for action determination
                inner_message.event_name = event_name
                # Store request_id in the message for response correlation
                inner_message.request_id = request_id
                await self._process_project_list(inner_message)
            else:
                logger.warning(f"Unknown project event: {event_name} / message_type: {message_type}")
        except Exception as e:
            logger.error(f"Error processing project mod message: {e}")
            import traceback
            traceback.print_exc()
        return message
    
    async def _process_project_creation(self, message: ProjectCreationMessage) -> None:
        """Process a project creation request.
        
        Args:
            message: The project creation message
        """
        # Check if we've reached the maximum number of concurrent projects
        active_projects = sum(1 for p in self.projects.values() if p.is_active())
        if active_projects >= self.max_concurrent_projects:
            await self._send_error_response(
                message.sender_id,
                message.message_id,
                f"Maximum concurrent projects ({self.max_concurrent_projects}) reached"
            )
            return
        
        # Create the project
        project = Project(
            project_id=message.project_id,
            name=message.project_name,
            goal=message.project_goal,
            creator_agent_id=message.sender_id,
            config=message.config.copy()
        )
        
        # Automatically add configured service agents
        if self.auto_invite_service_agents and self.default_service_agents:
            project.service_agents = self.default_service_agents.copy()
            logger.info(f"Automatically added {len(project.service_agents)} service agents to project: {project.service_agents}")
        else:
            logger.info("No service agents configured or auto-invite disabled")
        
        # Store the project
        self.projects[project.project_id] = project
        
        # Add creator to agent_projects mapping
        if message.sender_id not in self.agent_projects:
            self.agent_projects[message.sender_id] = set()
        self.agent_projects[message.sender_id].add(project.project_id)
        
        # Create private channel for the project
        channel_name = f"{self.project_channel_prefix}{project.project_id[:8]}"
        project.channel_name = channel_name
        self.project_channels[project.project_id] = channel_name
        self.channel_projects[channel_name] = project.project_id
        
        # Create the channel via thread messaging mod
        await self._create_project_channel(project, channel_name)
        
        # Post the project goal as the initial message in the channel
        await self._post_project_goal_to_channel(project, channel_name)
        
        # Emit project created event
        await self._emit_project_event(
            "project.created",
            project.project_id,
            message.sender_id,
            {
                "project_name": project.name,
                "project_goal": project.goal,
                "channel_name": channel_name,
                "service_agents": project.service_agents
            }
        )
        
        # Send success response
        # Use request_id from message for response correlation
        request_id = getattr(message, 'request_id', message.message_id)
        logger.info(f"🔧 PROJECT MOD: Sending response with request_id: {request_id}")
        
        await self._send_project_response(
            message.sender_id,
            request_id,
            "project_creation_response",
            {
                "success": True,
                "project_id": project.project_id,
                "project_name": project.name,
                "channel_name": channel_name,
                "service_agents": project.service_agents
            }
        )
        
        logger.info(f"Created project {project.project_id} ({project.name}) with channel {channel_name}")
    
    async def _process_project_status(self, message: ProjectStatusMessage) -> None:
        """Process a project status request.
        
        Args:
            message: The project status message
        """
        project_id = message.project_id
        
        # Determine action from event_name if possible, fallback to message.action
        action = getattr(message, 'action', 'get_status')
        
        # Use event_name to determine action if available
        if hasattr(message, 'event_name') and message.event_name:
            if "start" in message.event_name:
                action = "start"
            elif "stop" in message.event_name:
                action = "stop"
            elif "pause" in message.event_name:
                action = "pause"
            elif "resume" in message.event_name:
                action = "resume"
            elif "status" in message.event_name or "get" in message.event_name:
                action = "get_status"
        
        if project_id not in self.projects:
            request_id = getattr(message, 'request_id', message.message_id)
            await self._send_error_response(
                message.sender_id,
                request_id,
                f"Project {project_id} not found"
            )
            return
        
        project = self.projects[project_id]
        
        if action == "start":
            if project.status == "created" or project.status == "paused":
                project.start()
                
                # Emit project started event
                await self._emit_project_event(
                    "project.started",
                    project_id,
                    message.sender_id,
                    {"project_name": project.name}
                )
                
                # Notify service agents
                await self._notify_service_agents(project, "project_started")
                
                logger.info(f"Started project {project_id}")
            
        elif action == "stop":
            if project.is_active():
                project.stop()
                
                # Emit project stopped event
                await self._emit_project_event(
                    "project.stopped",
                    project_id,
                    message.sender_id,
                    {"project_name": project.name}
                )
                
                logger.info(f"Stopped project {project_id}")
            
        elif action == "pause":
            if project.status == "running":
                project.pause()
                
                # Emit project status changed event
                await self._emit_project_event(
                    "project.status.changed",
                    project_id,
                    message.sender_id,
                    {"project_name": project.name, "new_status": "paused"}
                )
                
                logger.info(f"Paused project {project_id}")
            
        elif action == "resume":
            if project.status == "paused":
                project.resume()
                
                # Emit project status changed event
                await self._emit_project_event(
                    "project.status.changed",
                    project_id,
                    message.sender_id,
                    {"project_name": project.name, "new_status": "running"}
                )
                
                logger.info(f"Resumed project {project_id}")
            
        elif action == "get_status":
            # Just return the current status - no state change needed
            logger.info(f"Getting status for project {project_id}")
        
        # Send status response
        request_id = getattr(message, 'request_id', message.message_id)
        logger.info(f"🔧 PROJECT MOD: Sending status response with request_id: {request_id}")
        await self._send_project_response(
            message.sender_id,
            request_id,
            "project_status_response",
            {
                "success": True,
                "project_id": project_id,
                "status": project.status,
                "project_data": project.to_dict()
            }
        )
    
    async def _process_project_notification(self, message: ProjectNotificationMessage) -> None:
        """Process a project notification.
        
        Args:
            message: The project notification message
        """
        logger.info(f"🔧 PROJECT MOD: Processing project notification - project_id: {message.project_id}, type: {message.notification_type}")
        
        project_id = message.project_id
        notification_type = message.notification_type
        
        # Check if this is a short project ID that needs to be mapped to full ID
        if project_id not in self.projects:
            # Try to find the full project ID by checking if this is a short ID
            full_project_id = None
            for full_id in self.projects.keys():
                if full_id.startswith(project_id):
                    full_project_id = full_id
                    break
            
            if full_project_id:
                logger.info(f"🔧 PROJECT MOD: Mapped short project ID {project_id} to full ID {full_project_id}")
                project_id = full_project_id
            else:
                logger.warning(f"Received notification for unknown project {project_id}")
                logger.info(f"🔧 PROJECT MOD: Available projects: {list(self.projects.keys())}")
                return
        
        project = self.projects[project_id]
        
        # Handle different notification types
        if notification_type == "completion":
            logger.info(f"🔧 PROJECT MOD: Handling completion for project {project_id}")
            project.complete(message.content.get("results"))
            
            logger.info(f"🔧 PROJECT MOD: Emitting project.run.completed event for project {project_id}")
            # Emit project completed event
            await self._emit_project_event(
                "project.run.completed",
                project_id,
                message.sender_id,
                {
                    "project_name": project.name,
                    "results": project.results
                }
            )
            
        elif notification_type == "error":
            error_msg = message.content.get("error", "Unknown error")
            project.fail(error_msg)
            
            # Emit project failed event
            await self._emit_project_event(
                "project.run.failed",
                project_id,
                message.sender_id,
                {
                    "project_name": project.name,
                    "error": error_msg
                }
            )
            
        elif notification_type == "input_required":
            # Emit input required event
            await self._emit_project_event(
                "project.run.requires_input",
                project_id,
                message.sender_id,
                {
                    "project_name": project.name,
                    "input_request": message.content
                }
            )
            
        elif notification_type == "progress":
            # Update project progress
            project.update_progress(message.content)
            
            # Emit progress notification event
            await self._emit_project_event(
                "project.run.notification",
                project_id,
                message.sender_id,
                {
                    "project_name": project.name,
                    "notification_type": "progress",
                    "progress": message.content
                }
            )
        
        # Forward notification to project creator and interested agents
        await self._forward_project_notification(project, message)
        
        logger.debug(f"Processed {notification_type} notification for project {project_id}")
    
    async def _process_project_channel(self, message: ProjectChannelMessage) -> None:
        """Process project channel operations.
        
        Args:
            message: The project channel message
        """
        project_id = message.project_id
        
        # Determine action from event_name if possible, fallback to message.action
        action = getattr(message, 'action', 'join')
        
        # Use event_name to determine action if available
        if hasattr(message, 'event_name') and message.event_name:
            if "join" in message.event_name:
                action = "join"
            elif "leave" in message.event_name:
                action = "leave"
        
        if project_id not in self.projects:
            await self._send_error_response(
                message.sender_id,
                message.message_id,
                f"Project {project_id} not found"
            )
            return
        
        project = self.projects[project_id]
        
        if action == "join":
            # Add agent to project
            if message.sender_id not in project.service_agents:
                project.service_agents.append(message.sender_id)
                
                # Add to agent_projects mapping
                if message.sender_id not in self.agent_projects:
                    self.agent_projects[message.sender_id] = set()
                self.agent_projects[message.sender_id].add(project_id)
                
                # Emit agent joined event
                await self._emit_project_event(
                    "project.agent.joined",
                    project_id,
                    message.sender_id,
                    {"joined_agent_id": message.sender_id}
                )
                
                logger.info(f"Agent {message.sender_id} joined project {project_id}")
        
        elif action == "leave":
            # Remove agent from project
            if message.sender_id in project.service_agents:
                project.service_agents.remove(message.sender_id)
                
                # Remove from agent_projects mapping
                if message.sender_id in self.agent_projects:
                    self.agent_projects[message.sender_id].discard(project_id)
                
                # Emit agent left event
                await self._emit_project_event(
                    "project.agent.left",
                    project_id,
                    message.sender_id,
                    {"left_agent_id": message.sender_id}
                )
                
                logger.info(f"Agent {message.sender_id} left project {project_id}")
        
        # Send response
        await self._send_project_response(
            message.sender_id,
            message.message_id,
            "project_channel_response",
            {
                "success": True,
                "project_id": project_id,
                "action": action,
                "service_agents": project.service_agents
            }
        )
    
    async def _process_project_list(self, message: ProjectListMessage) -> None:
        """Process a project list request.
        
        Args:
            message: The project list message
        """
        filter_status = message.filter_status
        
        # Get projects for the requesting agent
        agent_projects = self.agent_projects.get(message.sender_id, set())
        
        projects_data = []
        for project_id in agent_projects:
            if project_id in self.projects:
                project = self.projects[project_id]
                
                # Apply status filter if specified
                if filter_status and project.status != filter_status:
                    continue
                
                projects_data.append({
                    "project_id": project.project_id,
                    "name": project.name,
                    "goal": project.goal,
                    "status": project.status,
                    "created_timestamp": project.created_timestamp,
                    "started_timestamp": project.started_timestamp,
                    "completed_timestamp": project.completed_timestamp,
                    "channel_name": project.channel_name,
                    "service_agents": project.service_agents,
                    "progress": project.progress
                })
        
        # Send response
        request_id = getattr(message, 'request_id', message.message_id)
        logger.info(f"🔧 PROJECT MOD: Sending list response with request_id: {request_id}")
        await self._send_project_response(
            message.sender_id,
            request_id,
            "project_list_response",
            {
                "success": True,
                "projects": projects_data,
                "total_count": len(projects_data)
            }
        )
    
    async def _create_project_channel(self, project: Project, channel_name: str) -> None:
        """Create a private channel for the project.
        
        Args:
            project: The project to create a channel for
            channel_name: Name of the channel to create
        """
        # This would integrate with the thread messaging mod to create a channel
        # For now, we'll just log the channel creation
        logger.info(f"Creating project channel {channel_name} for project {project.project_id}")
        
        # In a real implementation, this would:
        # 1. Send a message to thread messaging mod to create the channel
        # 2. Invite all service agents to the channel
        # 3. Set up channel permissions for project-only access
    
    async def _post_project_goal_to_channel(self, project: Project, channel_name: str) -> None:
        """Post the project goal as the initial message in the project channel.
        
        Args:
            project: The project whose goal to post
            channel_name: Name of the channel to post to
        """
        try:
            # Create a message with the project goal
            goal_message = f"🎯 **Project Goal**: {project.goal}\n\n" \
                          f"📋 **Project**: {project.name}\n" \
                          f"🆔 **Project ID**: {project.project_id}\n\n" \
                          f"Welcome to the project channel! This is where we'll collaborate to achieve the project goal."
            
            # Send the goal message to the channel via thread messaging mod
            if hasattr(self, 'network') and self.network:
                from openagents.core.transport import Message
                import time
                
                # Create a transport message for the thread messaging mod
                transport_message = Message(
                    source_id=project.creator_agent_id,
                    target_id="",  # Broadcast to mod
                    message_type="mod_message",
                    payload={
                        "mod": "openagents.mods.workspace.messaging",
                        "action": "channel_message",
                        "relevant_agent_id": project.creator_agent_id,
                        "message_type": "channel_message",
                        "sender_id": project.creator_agent_id,
                        "channel": f"#{channel_name}",
                        "content": {"text": goal_message},
                        "system_message": True  # Mark as system message
                    },
                    message_id=f"project-goal-{project.project_id}",
                    timestamp=int(time.time())
                )
                
                # Send through network's mod message handler
                await self.network._handle_mod_message(transport_message)
                logger.info(f"Posted project goal to channel #{channel_name}")
            else:
                logger.warning(f"Cannot post project goal - network not available")
                
        except Exception as e:
            logger.error(f"Failed to post project goal to channel {channel_name}: {e}")
    
    async def _notify_service_agents(self, project: Project, notification_type: str) -> None:
        """Notify service agents about project events.
        
        Args:
            project: The project
            notification_type: Type of notification
        """
        for agent_id in project.service_agents:
            notification = Event(
                event_name="project.notification",
                source_id=self.network.network_id,
                relevant_mod="openagents.mods.project.default",
                destination_id=agent_id,
                payload={
                    "action": "project_notification",
                    "notification_type": notification_type,
                    "project_id": project.project_id,
                    "project_name": project.name,
                    "project_goal": project.goal,
                    "channel_name": project.channel_name
                }
            )
            
            try:
                await self.network.send_message(notification)
                logger.debug(f"Sent {notification_type} notification to agent {agent_id}")
            except Exception as e:
                logger.error(f"Failed to send notification to {agent_id}: {e}")
    
    async def _forward_project_notification(self, project: Project, message: ProjectNotificationMessage) -> None:
        """Forward project notification to interested parties.
        
        Args:
            project: The project
            message: The original notification message
        """
        # Forward to project creator
        if project.creator_agent_id and project.creator_agent_id != message.sender_id:
            notification = Event(
                event_name="project.message_received",
                source_id=self.network.network_id,
                relevant_mod="openagents.mods.project.default",
                destination_id=project.creator_agent_id,
                payload={
                    "action": "project_message_received",
                    "project_id": project.project_id,
                    "original_message": message.model_dump()
                }
            )
            
            try:
                await self.network.send_message(notification)
            except Exception as e:
                logger.error(f"Failed to forward notification to creator {project.creator_agent_id}: {e}")
    
    async def _emit_project_event(self, event_type: str, project_id: str, agent_id: str, data: Dict[str, Any]) -> None:
        """Emit a project-related event using the unified network event system.
        
        Args:
            event_type: Type of event to emit
            project_id: ID of the project
            agent_id: ID of the agent triggering the event
            data: Additional event data
        """
        logger.info(f"🔧 PROJECT MOD: Emitting event {event_type} for project {project_id} by agent {agent_id}")
        
        try:
            # Use the new unified event system
            from openagents.models.event import Event, EventVisibility
            
            # Create the event using the new Event structure
            event = Event(
                event_name=event_type,
                source_id=agent_id,
                relevant_mod="project.default",
                payload={
                    "project_id": project_id,
                    "project_name": data.get("project_name", ""),
                    **data
                },
                visibility=EventVisibility.NETWORK  # Make project events visible to entire network
            )
            
            # Emit through the network's unified event system
            if hasattr(self.network, 'emit_event'):
                await self.network.emit_event(event)
                logger.info(f"🔧 PROJECT MOD: Emitted {event_type} event via network event system")
            else:
                logger.warning("Network event system not available")
                
        except Exception as e:
            logger.error(f"Failed to emit project event {event_type}: {e}")
    
    async def _send_project_response(self, agent_id: str, request_id: str, action: str, content: Dict[str, Any]) -> None:
        """Send a response message to an agent.
        
        Args:
            agent_id: ID of the agent to send to
            request_id: ID of the original request
            action: Response action type
            content: Response content
        """
        from openagents.models.messages import Event, EventNames
        
        # Send response as Event to ensure proper routing
        response_content = {
            "action": action,
            "request_id": request_id,
            **content
        }
        
        response = Event(
            event_name="project.response",
            source_id=self.network.network_id,
            relevant_mod="openagents.mods.project.default",
            destination_id=agent_id,
            payload=response_content
        )
        
        try:
            await self.network.send_message(response)
            logger.debug(f"Sent project response to {agent_id}: {action} for request {request_id}")
        except Exception as e:
            logger.error(f"Failed to send response to {agent_id}: {e}")
    
    async def _send_error_response(self, agent_id: str, request_id: str, error: str) -> None:
        """Send an error response to an agent.
        
        Args:
            agent_id: ID of the agent to send to
            request_id: ID of the original request
            error: Error message
        """
        await self._send_project_response(
            agent_id,
            request_id,
            "error_response",
            {"success": False, "error": error}
        )
    
    def get_state(self) -> Dict[str, Any]:
        """Get the current state of the project mod.
        
        Returns:
            Dict[str, Any]: Current mod state
        """
        active_projects = sum(1 for p in self.projects.values() if p.is_active())
        completed_projects = sum(1 for p in self.projects.values() if p.is_completed())
        
        return {
            "total_projects": len(self.projects),
            "active_projects": active_projects,
            "completed_projects": completed_projects,
            "project_channels": len(self.project_channels),
            "agents_with_projects": len(self.agent_projects),
            "config": {
                "max_concurrent_projects": self.max_concurrent_projects,
                "default_service_agents": self.default_service_agents,
                "project_channel_prefix": self.project_channel_prefix,
                "auto_invite_service_agents": self.auto_invite_service_agents
            }
        }
