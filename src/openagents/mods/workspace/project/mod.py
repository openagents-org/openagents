"""
Network-level project mod for OpenAgents workspace functionality.

This mod provides comprehensive project management including:
- Template-based project creation
- Project lifecycle management  
- State and artifact management
- Private channel integration
- Permission-based access control
"""

import logging
import asyncio
import time
from typing import Dict, Any, List, Optional, Set
from openagents.core.base_mod import BaseMod
from openagents.models.event import Event, EventVisibility
from openagents.models.event_response import EventResponse
from openagents.workspace.project import Project, ProjectTemplate, ProjectStatus
from openagents.workspace.project_messages import *

logger = logging.getLogger(__name__)


class DefaultProjectNetworkMod(BaseMod):
    """Network-level mod for project management functionality."""

    def __init__(self, mod_name: str = "project.default"):
        """Initialize the project network mod."""
        super().__init__(mod_name=mod_name)

        # Project and template storage
        self.projects: Dict[str, Project] = {}
        self.templates: Dict[str, ProjectTemplate] = {}
        
        # Agent tracking
        self.agent_projects: Dict[str, Set[str]] = {}  # agent_id -> project_ids
        
        # Configuration
        self.max_concurrent_projects = 10
        self.template_config = {}

        logger.info(f"Initializing Project network mod")

    async def process_event(self, event: Event) -> Optional[EventResponse]:
        """Override base class to route to our process_system_message method."""
        return await self.process_system_message(event)

    def initialize(self) -> bool:
        """Initialize the mod with configuration."""
        config = self.config or {}
        
        # Load basic config
        self.max_concurrent_projects = config.get("max_concurrent_projects", 10)
        
        # Load project templates from network configuration
        self.template_config = config.get("project_templates", {})
        self._load_templates()

        logger.info(f"Project mod initialized with {len(self.templates)} templates")
        return True

    def _load_templates(self) -> None:
        """Load project templates from configuration."""
        from .template_tools import validate_template_tool_names

        for template_id, template_data in self.template_config.items():
            try:
                template = ProjectTemplate(
                    template_id=template_id,
                    name=template_data.get("name", template_id),
                    description=template_data.get("description", ""),
                    agent_groups=template_data.get("agent_groups", []),
                    context=template_data.get("context", ""),
                    # Tool configuration fields
                    expose_as_tool=template_data.get("expose_as_tool", False),
                    tool_name=template_data.get("tool_name"),
                    tool_description=template_data.get("tool_description"),
                    input_schema=template_data.get("input_schema"),
                    tool_mode=template_data.get("tool_mode", "sync")
                )
                self.templates[template_id] = template
                tool_info = f" (exposed as tool, mode={template.tool_mode})" if template.expose_as_tool else ""
                logger.info(f"Loaded template: {template_id}{tool_info}")
            except Exception as e:
                logger.error(f"Failed to load template {template_id}: {e}")

        # Validate tool names are unique
        errors = validate_template_tool_names(self.templates)
        for error in errors:
            logger.error(f"Template tool configuration error: {error}")

    def shutdown(self) -> bool:
        """Shutdown the mod gracefully."""
        # Stop all running projects
        for project in self.projects.values():
            if project.is_active():
                project.stop()

        self.projects.clear()
        self.templates.clear()
        self.agent_projects.clear()

        logger.info("Project mod shutdown completed")
        return True

    async def handle_register_agent(self, agent_id: str, metadata: Dict[str, Any]) -> Optional[EventResponse]:
        """Register an agent with the project mod."""
        if agent_id not in self.agent_projects:
            self.agent_projects[agent_id] = set()
        logger.info(f"Registered agent {agent_id} with Project mod")
        return None

    async def handle_unregister_agent(self, agent_id: str) -> Optional[EventResponse]:
        """Unregister an agent from the project mod."""
        if agent_id in self.agent_projects:
            # Remove agent from all their projects
            project_ids = self.agent_projects[agent_id].copy()
            for project_id in project_ids:
                if project_id in self.projects:
                    project = self.projects[project_id]
                    if agent_id in project.authorized_agents:
                        project.authorized_agents.remove(agent_id)
                    if agent_id in project.collaborators:
                        project.collaborators.remove(agent_id)

            del self.agent_projects[agent_id]
        logger.info(f"Unregistered agent {agent_id} from Project mod")
        return None

    async def process_system_message(self, message: Event) -> Optional[EventResponse]:
        """Process a project mod message with granular event routing."""
        try:
            event_name = message.event_name
            source_id = message.source_id
            
            logger.info(f"🔧 PROJECT MOD: Received event: {event_name} from {source_id}")

            # Route to specific handlers based on event name
            if event_name == "project.template.list":
                return await self._handle_template_list(message)
            elif event_name == "project.list":
                return await self._handle_project_list(message)
            elif event_name == "project.start":
                return await self._handle_project_start(message)
            elif event_name == "project.stop":
                return await self._handle_project_stop(message)
            elif event_name == "project.complete":
                return await self._handle_project_complete(message)
            elif event_name == "project.get":
                return await self._handle_project_get(message)
            elif event_name == "project.message.send":
                return await self._handle_project_message_send(message)
            elif event_name == "project.global_state.set":
                return await self._handle_global_state_set(message)
            elif event_name == "project.global_state.get":
                return await self._handle_global_state_get(message)
            elif event_name == "project.global_state.list":
                return await self._handle_global_state_list(message)
            elif event_name == "project.global_state.delete":
                return await self._handle_global_state_delete(message)
            elif event_name == "project.agent_state.set":
                return await self._handle_agent_state_set(message)
            elif event_name == "project.agent_state.get":
                return await self._handle_agent_state_get(message)
            elif event_name == "project.agent_state.list":
                return await self._handle_agent_state_list(message)
            elif event_name == "project.agent_state.delete":
                return await self._handle_agent_state_delete(message)
            elif event_name == "project.artifact.set":
                return await self._handle_artifact_set(message)
            elif event_name == "project.artifact.get":
                return await self._handle_artifact_get(message)
            elif event_name == "project.artifact.list":
                return await self._handle_artifact_list(message)
            elif event_name == "project.artifact.delete":
                return await self._handle_artifact_delete(message)

            else:
                # Only handle events that start with "project."
                # Return None for other events to let them pass through to other mods/agents
                if event_name.startswith("project."):
                    logger.warning(f"Unknown project event: {event_name}")
                    return EventResponse(
                        success=False,
                        message=f"Unknown event: {event_name}",
                        data={"error": "Unknown event type"}
                    )
                else:
                    # Not a project event - let it pass through
                    logger.debug(f"Non-project event {event_name}, passing through")
                    return None

        except Exception as e:
            logger.error(f"Error processing project mod message: {e}")
            import traceback
            traceback.print_exc()
            return EventResponse(
                success=False,
                message=f"Error processing project event: {str(e)}",
                data={"error": str(e)}
            )

    # Template Management Handlers

    async def _handle_template_list(self, message: Event) -> EventResponse:
        """Handle project template list request."""
        templates_data = []
        for template in self.templates.values():
            templates_data.append({
                "template_id": template.template_id,
                "name": template.name,
                "description": template.description,
                "agent_groups": template.agent_groups,
                "context": template.context
            })

        return EventResponse(
            success=True,
            message="Templates listed successfully",
            data={"templates": templates_data}
        )

    # Project Query Handlers

    async def _handle_project_list(self, message: Event) -> EventResponse:
        """Handle project list request - returns all projects accessible by the requesting agent."""
        source_id = message.source_id
        payload = message.payload or {}
        
        # Optional filters
        status_filter = payload.get("status")  # Filter by status (e.g., "running", "completed")
        include_archived = payload.get("include_archived", True)  # Include completed/stopped/failed projects
        
        # Get all projects that the requesting agent has access to
        accessible_projects = []
        
        for project in self.projects.values():
            # Check if agent has access to this project
            # For project listing, we use a relaxed permission check similar to project.get
            # This allows agents to see projects they've been part of even if agent_id changed
            has_access = (
                source_id in project.authorized_agents or
                source_id == project.initiator_agent_id or
                source_id in project.collaborators
            )
            
            if not has_access:
                continue
            
            # Apply status filter if provided
            if status_filter and project.status.value != status_filter:
                continue
            
            # Apply archived filter
            if not include_archived and project.is_completed():
                continue
            
            # Build project summary
            project_summary = {
                "project_id": project.project_id,
                "name": project.name,
                "goal": project.goal,
                "template_id": project.template_id,
                "status": project.status.value,
                "initiator_agent_id": project.initiator_agent_id,
                "created_timestamp": project.created_timestamp,
                "started_timestamp": project.started_timestamp,
                "completed_timestamp": project.completed_timestamp,
                "summary": project.summary,
                "authorized_agents": project.authorized_agents,
                "collaborators": project.collaborators,
                "agent_groups": project.agent_groups,
            }
            accessible_projects.append(project_summary)
        
        # Sort by created_timestamp descending (most recent first)
        accessible_projects.sort(key=lambda p: p["created_timestamp"], reverse=True)
        
        logger.info(f"Agent {source_id} listed {len(accessible_projects)} accessible projects")
        
        return EventResponse(
            success=True,
            message=f"Found {len(accessible_projects)} accessible projects",
            data={
                "projects": accessible_projects,
                "total_count": len(accessible_projects)
            }
        )

    # Project Lifecycle Handlers

    async def _handle_project_start(self, message: Event) -> EventResponse:
        """Handle project start request."""
        payload = message.payload or {}
        template_id = payload.get("template_id")
        goal = payload.get("goal")
        name = payload.get("name")
        collaborators = payload.get("collaborators", [])

        # Validate template exists
        if template_id not in self.templates:
            return EventResponse(
                success=False,
                message=f"Template {template_id} not found",
                data={"error": "Template not found"}
            )

        # Check concurrent project limit
        active_projects = sum(1 for p in self.projects.values() if p.is_active())
        if active_projects >= self.max_concurrent_projects:
            return EventResponse(
                success=False,
                message=f"Maximum concurrent projects ({self.max_concurrent_projects}) reached",
                data={"error": "Project limit exceeded"}
            )

        template = self.templates[template_id]

        # Create project
        project = Project(
            goal=goal,
            template_id=template_id,
            initiator_agent_id=message.source_id,
            name=name,
            context=template.context,
            collaborators=collaborators,
            agent_groups=template.agent_groups.copy()
        )

        # Resolve authorized agents
        authorized_agents = await self._resolve_authorized_agents(project)
        project.authorized_agents = authorized_agents

        # Store project
        self.projects[project.project_id] = project

        # Update agent tracking
        for agent_id in authorized_agents:
            if agent_id not in self.agent_projects:
                self.agent_projects[agent_id] = set()
            self.agent_projects[agent_id].add(project.project_id)

        # Start the project
        project.start()

        # Send notifications to all authorized agents
        await self._send_project_started_notifications(project)

        logger.info(f"Started project {project.project_id} with {len(authorized_agents)} authorized agents")

        return EventResponse(
            success=True,
            message="Project started successfully",
            data={
                "project_id": project.project_id,
                "authorized_agents": authorized_agents
            }
        )

    async def _handle_project_stop(self, message: Event) -> EventResponse:
        """Handle project stop request."""
        payload = message.payload or {}
        project_id = payload.get("project_id")
        reason = payload.get("reason")

        project, error_response = await self._get_project_with_permission(project_id, message.source_id)
        if error_response:
            return error_response

        project.stop()

        # Send notifications
        await self._send_project_stopped_notifications(project, message.source_id, reason)

        logger.info(f"Stopped project {project_id}")

        return EventResponse(
            success=True,
            message="Project stopped successfully",
            data={
                "project_id": project_id,
                "stopped_timestamp": project.completed_timestamp
            }
        )

    async def _handle_project_complete(self, message: Event) -> EventResponse:
        """Handle project complete request."""
        payload = message.payload or {}
        project_id = payload.get("project_id")
        summary = payload.get("summary")

        project, error_response = await self._get_project_with_permission(project_id, message.source_id)
        if error_response:
            return error_response

        project.complete(summary)

        # Send notifications
        await self._send_project_completed_notifications(project, message.source_id, summary)

        logger.info(f"Completed project {project_id}")

        return EventResponse(
            success=True,
            message="Project completed successfully",
            data={
                "project_id": project_id,
                "completed_timestamp": project.completed_timestamp
            }
        )

    async def _handle_project_get(self, message: Event) -> EventResponse:
        """Handle project get request."""
        payload = message.payload or {}
        project_id = payload.get("project_id")

        # NOTE:
        # For project.get we intentionally relax the strict permission check used by
        # mutating operations (stop/complete/message/state/artifacts).
        # In Studio "project mode" a user might reconnect with a different agent_id
        # (e.g. after an agent_id conflict resolution), which would previously cause
        # an "Access denied" error when simply trying to view an existing project.
        #
        # Viewing basic project metadata is safe to expose to any registered agent,
        # while write operations still require full authorization and continue to use
        # _get_project_with_permission.
        if project_id not in self.projects:
            return EventResponse(
                success=False,
                message=f"Project {project_id} not found",
                data={"error": "Project not found"},
            )

        project = self.projects[project_id]

        return EventResponse(
            success=True,
            message="Project retrieved successfully",
            data={
                "project": {
                    "project_id": project.project_id,
                    "name": project.name,
                    "goal": project.goal,
                    "context": project.context,
                    "template_id": project.template_id,
                    "status": project.status.value,
                    "initiator_agent_id": project.initiator_agent_id,
                    "collaborators": project.collaborators,
                    "authorized_agents": project.authorized_agents,
                    "created_timestamp": project.created_timestamp,
                    "started_timestamp": project.started_timestamp,
                    "artifacts": project.artifacts,
                    "messages": project.messages
                }
            }
        )

    # Messaging Handler

    async def _handle_project_message_send(self, message: Event) -> EventResponse:
        """Handle project message send request."""
        payload = message.payload or {}
        project_id = payload.get("project_id")
        content = payload.get("content")
        reply_to_id = payload.get("reply_to_id")
        attachments = payload.get("attachments", [])

        # NOTE:
        # Similar to project.get, we relax the strict permission check for sending
        # messages to a project chat room. In Studio project mode the browser might
        # reconnect with a new agent_id (e.g. after conflict resolution). If we
        # kept using _get_project_with_permission here, users would be unable to
        # send messages to projects they created in a previous session and would
        # constantly see "Access denied" errors.
        #
        # For demo/workspace scenarios, allowing any registered agent to post
        # messages to an existing project is acceptable, while mutating project
        # lifecycle/state/artifacts remains strictly protected.
        if project_id not in self.projects:
            return EventResponse(
                success=False,
                message=f"Project {project_id} not found",
                data={"error": "Project not found"}
            )

        project = self.projects[project_id]

        # Generate message ID
        message_id = f"msg_{int(time.time())}_{message.source_id[:8]}"
        timestamp = int(time.time())

        # Store message in project history
        message_data = {
            "message_id": message_id,
            "sender_id": message.source_id,
            "content": content,
            "reply_to_id": reply_to_id,
            "attachments": attachments,
            "timestamp": timestamp
        }
        project.messages.append(message_data)
        logger.info(f"Stored message {message_id} in project {project_id} history")

        # Send via messaging system (integrate with messaging mod)
        await self._send_to_messaging_system(project, message.source_id, content, reply_to_id, attachments, message_id)

        # Send notifications to other authorized agents
        await self._send_message_received_notifications(project, message.source_id, message_id, content, reply_to_id, timestamp)

        return EventResponse(
            success=True,
            message="Message sent successfully",
            data={
                "message_id": message_id,
                "timestamp": timestamp
            }
        )

    # Global State Handlers

    async def _handle_global_state_set(self, message: Event) -> EventResponse:
        """Handle global state set request."""
        payload = message.payload or {}
        project_id = payload.get("project_id")
        key = payload.get("key")
        value = payload.get("value")

        project, error_response = await self._get_project_with_permission(project_id, message.source_id)
        if error_response:
            return error_response

        previous_value = project.set_global_state(key, value)

        data = {"key": key}
        if previous_value is not None:
            data["previous_value"] = previous_value

        return EventResponse(
            success=True,
            message="Global state set successfully",
            data=data
        )

    async def _handle_global_state_get(self, message: Event) -> EventResponse:
        """Handle global state get request."""
        payload = message.payload or {}
        project_id = payload.get("project_id")
        key = payload.get("key")

        project, error_response = await self._get_project_with_permission(project_id, message.source_id)
        if error_response:
            return error_response

        value = project.get_global_state(key)

        return EventResponse(
            success=True,
            message="Global state retrieved successfully",
            data={
                "key": key,
                "value": value
            }
        )

    async def _handle_global_state_list(self, message: Event) -> EventResponse:
        """Handle global state list request."""
        payload = message.payload or {}
        project_id = payload.get("project_id")

        project, error_response = await self._get_project_with_permission(project_id, message.source_id)
        if error_response:
            return error_response

        return EventResponse(
            success=True,
            message="Global state listed successfully",
            data={"state": project.global_state}
        )

    async def _handle_global_state_delete(self, message: Event) -> EventResponse:
        """Handle global state delete request."""
        payload = message.payload or {}
        project_id = payload.get("project_id")
        key = payload.get("key")

        project, error_response = await self._get_project_with_permission(project_id, message.source_id)
        if error_response:
            return error_response

        deleted_value = project.delete_global_state(key)

        return EventResponse(
            success=True,
            message="Global state deleted successfully",
            data={
                "key": key,
                "deleted_value": deleted_value
            }
        )

    # Agent State Handlers

    async def _handle_agent_state_set(self, message: Event) -> EventResponse:
        """Handle agent state set request."""
        payload = message.payload or {}
        project_id = payload.get("project_id")
        key = payload.get("key")
        value = payload.get("value")

        project, error_response = await self._get_project_with_permission(project_id, message.source_id)
        if error_response:
            return error_response

        previous_value = project.set_agent_state(message.source_id, key, value)

        return EventResponse(
            success=True,
            message="Agent state set successfully",
            data={
                "agent_id": message.source_id,
                "key": key
            }
        )

    async def _handle_agent_state_get(self, message: Event) -> EventResponse:
        """Handle agent state get request."""
        payload = message.payload or {}
        project_id = payload.get("project_id")
        key = payload.get("key")
        agent_id = payload.get("agent_id", message.source_id)

        project, error_response = await self._get_project_with_permission(project_id, message.source_id)
        if error_response:
            return error_response

        # Only allow reading own state or if authorized
        if agent_id != message.source_id:
            return EventResponse(
                success=False,
                message="Cannot access other agents' state",
                data={"error": "Access denied"}
            )

        value = project.get_agent_state(agent_id, key)

        return EventResponse(
            success=True,
            message="Agent state retrieved successfully",
            data={
                "agent_id": agent_id,
                "key": key,
                "value": value
            }
        )

    async def _handle_agent_state_list(self, message: Event) -> EventResponse:
        """Handle agent state list request."""
        payload = message.payload or {}
        project_id = payload.get("project_id")
        agent_id = payload.get("agent_id", message.source_id)

        project, error_response = await self._get_project_with_permission(project_id, message.source_id)
        if error_response:
            return error_response

        # Only allow reading own state
        if agent_id != message.source_id:
            return EventResponse(
                success=False,
                message="Cannot access other agents' state",
                data={"error": "Access denied"}
            )

        state = project.get_agent_state_dict(agent_id)

        return EventResponse(
            success=True,
            message="Agent state listed successfully",
            data={
                "agent_id": agent_id,
                "state": state
            }
        )

    async def _handle_agent_state_delete(self, message: Event) -> EventResponse:
        """Handle agent state delete request."""
        payload = message.payload or {}
        project_id = payload.get("project_id")
        key = payload.get("key")

        project, error_response = await self._get_project_with_permission(project_id, message.source_id)
        if error_response:
            return error_response

        deleted_value = project.delete_agent_state(message.source_id, key)

        return EventResponse(
            success=True,
            message="Agent state deleted successfully",
            data={
                "agent_id": message.source_id,
                "key": key,
                "deleted_value": deleted_value
            }
        )

    # Artifact Handlers

    async def _handle_artifact_set(self, message: Event) -> EventResponse:
        """Handle artifact set request."""
        payload = message.payload or {}
        project_id = payload.get("project_id")
        key = payload.get("key")
        value = payload.get("value")

        project, error_response = await self._get_project_with_permission(project_id, message.source_id)
        if error_response:
            return error_response

        previous_value = project.set_artifact(key, value)

        # Send artifact updated notification
        await self._send_artifact_updated_notifications(project, message.source_id, key, "set")

        data = {"key": key}
        if previous_value is not None:
            data["previous_value"] = previous_value

        return EventResponse(
            success=True,
            message="Artifact set successfully",
            data=data
        )

    async def _handle_artifact_get(self, message: Event) -> EventResponse:
        """Handle artifact get request."""
        payload = message.payload or {}
        project_id = payload.get("project_id")
        key = payload.get("key")

        project, error_response = await self._get_project_with_permission(project_id, message.source_id)
        if error_response:
            return error_response

        value = project.get_artifact(key)

        return EventResponse(
            success=True,
            message="Artifact retrieved successfully",
            data={
                "key": key,
                "value": value
            }
        )

    async def _handle_artifact_list(self, message: Event) -> EventResponse:
        """Handle artifact list request."""
        payload = message.payload or {}
        project_id = payload.get("project_id")

        project, error_response = await self._get_project_with_permission(project_id, message.source_id)
        if error_response:
            return error_response

        artifacts = project.list_artifacts()

        return EventResponse(
            success=True,
            message="Artifacts listed successfully",
            data={"artifacts": artifacts}
        )

    async def _handle_artifact_delete(self, message: Event) -> EventResponse:
        """Handle artifact delete request."""
        payload = message.payload or {}
        project_id = payload.get("project_id")
        key = payload.get("key")

        project, error_response = await self._get_project_with_permission(project_id, message.source_id)
        if error_response:
            return error_response

        deleted_value = project.delete_artifact(key)

        # Send artifact updated notification
        await self._send_artifact_updated_notifications(project, message.source_id, key, "delete")

        return EventResponse(
            success=True,
            message="Artifact deleted successfully",
            data={
                "key": key,
                "deleted_value": deleted_value
            }
        )

    # Utility Methods

    async def _get_project_with_permission(self, project_id: str, agent_id: str) -> tuple[Optional[Project], Optional[EventResponse]]:
        """Get project and verify agent has permission."""
        if project_id not in self.projects:
            error_response = EventResponse(
                success=False,
                message=f"Project {project_id} not found",
                data={"error": "Project not found"}
            )
            return None, error_response

        project = self.projects[project_id]
        if agent_id not in project.authorized_agents:
            error_response = EventResponse(
                success=False,
                message=f"Access denied to project {project_id}",
                data={"error": "Access denied"}
            )
            return None, error_response

        return project, None

    async def _resolve_authorized_agents(self, project: Project) -> List[str]:
        """Resolve agent groups to actual agent IDs and combine with collaborators."""
        authorized = set([project.initiator_agent_id])
        authorized.update(project.collaborators)

        # Resolve agent groups from network topology
        if hasattr(self, 'network') and self.network:
            for group_name in project.agent_groups:
                # Get agents in this group from network topology
                group_agents = self._get_agents_in_group(group_name)
                authorized.update(group_agents)
        return list(authorized)

    def _get_agents_in_group(self, group_name: str) -> List[str]:
        """Get all agent IDs in a specific group."""
        if not hasattr(self, 'network') or not self.network:
            return []
        if not hasattr(self.network, 'topology') or not self.network.topology:
            return []

        agents_in_group = []
        agent_group_membership = getattr(self.network.topology, 'agent_group_membership', {})
        for agent_id, agent_group in agent_group_membership.items():
            if agent_group == group_name:
                agents_in_group.append(agent_id)
        return agents_in_group


    # Notification Methods

    async def _send_project_started_notifications(self, project: Project) -> None:
        """Send project started notifications to all authorized agents."""
        logger.info(f"Attempting to send project started notifications for project {project.project_id}")
        
        if not hasattr(self, 'network') or not self.network:
            logger.error("Project mod is not bound to network - cannot send notifications")
            return
        
        # Recompute authorized agents to get current network state
        authorized_agents = await self._resolve_authorized_agents(project)
        logger.info(f"Authorized agents: {authorized_agents}")
        
        for agent_id in authorized_agents:
            logger.info(f"Sending project.notification.started to agent {agent_id}")
            notification = Event(
                event_name="project.notification.started",
                source_id="mod:openagents.mods.workspace.project",
                destination_id=agent_id,
                payload={
                    "project_id": project.project_id,
                    "goal": project.goal,
                    "context": project.context,
                    "initiator_agent_id": project.initiator_agent_id,
                    "template_id": project.template_id,
                    "started_timestamp": project.started_timestamp
                }
            )
            await self.send_event(notification)
            
            # try:
            #     # Send notification directly to the agent instead of through mod processing
            #     # Use network's event gateway to deliver to agent directly
            #     if hasattr(self.network, 'event_gateway'):
            #         await self.network.event_gateway.deliver_to_agent(notification, agent_id)
            #         logger.info(f"Project notification delivered directly to agent {agent_id}")
            #     else:
            #         # Fallback to normal event processing
            #         response = await self.send_event(notification)
            #         logger.info(f"Project notification sent to {agent_id}, response: {response}")
            # except Exception as e:
            #     logger.error(f"Failed to send project notification to {agent_id}: {e}")
            #     import traceback
            #     traceback.print_exc()

    async def _send_project_stopped_notifications(self, project: Project, stopped_by: str, reason: Optional[str]) -> None:
        """Send project stopped notifications."""
        if not hasattr(self, 'network') or not self.network:
            return
        
        # Recompute authorized agents to get current network state
        authorized_agents = await self._resolve_authorized_agents(project)
        
        for agent_id in authorized_agents:
            notification = Event(
                event_name="project.notification.stopped",
                source_id="mod:openagents.mods.workspace.project",
                destination_id=agent_id,
                payload={
                    "project_id": project.project_id,
                    "stopped_by": stopped_by,
                    "reason": reason,
                    "stopped_timestamp": project.completed_timestamp
                }
            )
            await self.send_event(notification)

    async def _send_project_completed_notifications(self, project: Project, completed_by: str, summary: str) -> None:
        """Send project completed notifications."""
        if not hasattr(self, 'network') or not self.network:
            return
        
        # Recompute authorized agents to get current network state
        authorized_agents = await self._resolve_authorized_agents(project)
        
        for agent_id in authorized_agents:
            notification = Event(
                event_name="project.notification.completed",
                source_id="mod:openagents.mods.workspace.project",
                destination_id=agent_id,
                payload={
                    "project_id": project.project_id,
                    "completed_by": completed_by,
                    "summary": summary,
                    "completed_timestamp": project.completed_timestamp
                }
            )
            await self.send_event(notification)

    async def _send_message_received_notifications(self, project: Project, sender_id: str, message_id: str, content: Dict[str, Any], reply_to_id: Optional[str], timestamp: int) -> None:
        """Send message received notifications."""
        if not hasattr(self, 'network') or not self.network:
            return
        
        # Recompute authorized agents to get current network state
        authorized_agents = await self._resolve_authorized_agents(project)
        
        for agent_id in authorized_agents:
            if agent_id != sender_id:  # Don't notify sender
                notification = Event(
                    event_name="project.notification.message_received",
                    source_id="mod:openagents.mods.workspace.project",
                    destination_id=agent_id,
                    payload={
                        "project_id": project.project_id,
                        "message_id": message_id,
                        "sender_id": sender_id,
                        "content": content,
                        "reply_to_id": reply_to_id,
                        "timestamp": timestamp
                    }
                )
                await self.send_event(notification)

    async def _send_artifact_updated_notifications(self, project: Project, updated_by: str, key: str, action: str) -> None:
        """Send artifact updated notifications."""
        if not hasattr(self, 'network') or not self.network:
            return
        
        # Recompute authorized agents to get current network state
        authorized_agents = await self._resolve_authorized_agents(project)
        
        for agent_id in authorized_agents:
            if agent_id != updated_by:  # Don't notify updater
                notification = Event(
                    event_name="project.notification.artifact_updated",
                    source_id="mod:openagents.mods.workspace.project",
                    destination_id=agent_id,
                    payload={
                        "project_id": project.project_id,
                        "updated_by": updated_by,
                        "key": key,
                        "action": action,
                        "timestamp": int(time.time())
                    }
                )
                await self.send_event(notification)

    async def _send_to_messaging_system(self, project: Project, sender_id: str, content: Dict[str, Any], reply_to_id: Optional[str], attachments: List[Dict[str, Any]], message_id: str) -> None:
        """Send message to messaging system for project channel."""
        # This would integrate with the messaging mod
        # For now, just log the message sending
        logger.info(f"Sending message {message_id} to project {project.project_id} channel from {sender_id}")
        
        # In a real implementation, this would:
        # 1. Create or get the project's private channel
        # 2. Send the message via the messaging mod
        # 3. Handle attachments appropriately

    def get_state(self) -> Dict[str, Any]:
        """Get the current state of the project mod."""
        active_projects = sum(1 for p in self.projects.values() if p.is_active())
        completed_projects = sum(1 for p in self.projects.values() if p.status in [ProjectStatus.COMPLETED, ProjectStatus.FAILED, ProjectStatus.STOPPED])

        return {
            "total_projects": len(self.projects),
            "active_projects": active_projects,
            "completed_projects": completed_projects,
            "total_templates": len(self.templates),
            "agents_with_projects": len(self.agent_projects),
            "config": {
                "max_concurrent_projects": self.max_concurrent_projects,
            },
        }