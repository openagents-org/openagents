"""
Agent adapter for the default project mod.

This adapter provides tools for agents to interact with project-based collaboration.
"""

import logging
import asyncio
from typing import Dict, Any, List, Optional
from openagents.core.base_mod_adapter import BaseModAdapter
from openagents.models.tool import AgentTool
from openagents.models.messages import Event, EventNames
from openagents.workspace.project import Project
from openagents.workspace.project_messages import (
    ProjectCreationMessage,
    ProjectStatusMessage,
    ProjectNotificationMessage,
    ProjectChannelMessage,
    ProjectListMessage,
)

logger = logging.getLogger(__name__)


class DefaultProjectAgentAdapter(BaseModAdapter):
    """Agent adapter for default project functionality."""

    def __init__(self, mod_name: str = "project.default"):
        """Initialize the project agent adapter."""
        super().__init__(mod_name=mod_name)
        self._pending_responses: Dict[str, asyncio.Future] = {}

    def get_tools(self) -> List[AgentTool]:
        """Get the tools provided by this adapter.

        Returns:
            List of tools for project management
        """
        return [
            AgentTool(
                name="start_project",
                description="Start a new project with specified goal. Service agents are automatically configured from the mod settings.",
                parameters={
                    "type": "object",
                    "properties": {
                        "goal": {
                            "type": "string",
                            "description": "The goal or description of the project",
                        },
                        "name": {
                            "type": "string",
                            "description": "Optional name for the project (auto-generated if not provided)",
                        },
                        "config": {
                            "type": "object",
                            "description": "Optional project-specific configuration (e.g., priority, deadline, technologies)",
                            "default": {},
                        },
                    },
                    "required": ["goal"],
                },
            ),
            AgentTool(
                name="get_project_status",
                description="Get the status and details of a project",
                parameters={
                    "type": "object",
                    "properties": {
                        "project_id": {
                            "type": "string",
                            "description": "ID of the project to get status for",
                        }
                    },
                    "required": ["project_id"],
                },
            ),
            AgentTool(
                name="list_projects",
                description="List all projects associated with this agent",
                parameters={
                    "type": "object",
                    "properties": {
                        "filter_status": {
                            "type": "string",
                            "description": "Optional status filter (created, running, completed, failed, stopped, paused)",
                            "enum": [
                                "created",
                                "running",
                                "completed",
                                "failed",
                                "stopped",
                                "paused",
                            ],
                        }
                    },
                },
            ),
            AgentTool(
                name="stop_project",
                description="Stop a running project",
                parameters={
                    "type": "object",
                    "properties": {
                        "project_id": {
                            "type": "string",
                            "description": "ID of the project to stop",
                        }
                    },
                    "required": ["project_id"],
                },
            ),
            AgentTool(
                name="pause_project",
                description="Pause a running project",
                parameters={
                    "type": "object",
                    "properties": {
                        "project_id": {
                            "type": "string",
                            "description": "ID of the project to pause",
                        }
                    },
                    "required": ["project_id"],
                },
            ),
            AgentTool(
                name="resume_project",
                description="Resume a paused project",
                parameters={
                    "type": "object",
                    "properties": {
                        "project_id": {
                            "type": "string",
                            "description": "ID of the project to resume",
                        }
                    },
                    "required": ["project_id"],
                },
            ),
            AgentTool(
                name="join_project",
                description="Join an existing project as a service agent",
                parameters={
                    "type": "object",
                    "properties": {
                        "project_id": {
                            "type": "string",
                            "description": "ID of the project to join",
                        }
                    },
                    "required": ["project_id"],
                },
            ),
            AgentTool(
                name="leave_project",
                description="Leave a project",
                parameters={
                    "type": "object",
                    "properties": {
                        "project_id": {
                            "type": "string",
                            "description": "ID of the project to leave",
                        }
                    },
                    "required": ["project_id"],
                },
            ),
            AgentTool(
                name="send_project_notification",
                description="Send a notification or update about project progress",
                parameters={
                    "type": "object",
                    "properties": {
                        "project_id": {
                            "type": "string",
                            "description": "ID of the project",
                        },
                        "notification_type": {
                            "type": "string",
                            "description": "Type of notification",
                            "enum": [
                                "progress",
                                "completion",
                                "error",
                                "input_required",
                            ],
                        },
                        "content": {
                            "type": "object",
                            "description": "Notification content and data",
                        },
                        "target_agent_id": {
                            "type": "string",
                            "description": "Optional specific agent to notify",
                        },
                    },
                    "required": ["project_id", "notification_type", "content"],
                },
            ),
        ]

    async def start_project(
        self,
        goal: str,
        name: Optional[str] = None,
        config: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Start a new project.

        Service agents are automatically configured from the mod settings,
        so you don't need to specify them when creating a project.

        Args:
            goal: The goal or description of the project
            name: Optional name for the project
            config: Optional project-specific configuration

        Returns:
            Dict containing project creation result
        """
        if config is None:
            config = {}

        # Create project instance to get ID
        project = Project(goal=goal, name=name, config=config)

        # Create project creation message
        message = ProjectCreationMessage(
            sender_id=self._agent_id,
            project_id=project.project_id,
            project_name=project.name,
            project_goal=goal,
            config=config,
        )

        # Send message and wait for response
        response = await self._send_and_wait_for_response(message)

        if response and response.get("success"):
            logger.info(f"Successfully created project {project.project_id}")
            return {
                "success": True,
                "project_id": project.project_id,
                "project_name": response.get("project_name"),
                "channel_name": response.get("channel_name"),
                "service_agents": response.get("service_agents", []),
            }
        else:
            error = (
                response.get("error", "Unknown error")
                if response
                else "No response received"
            )
            logger.error(f"Failed to create project: {error}")
            return {"success": False, "error": error}

    async def get_project_status(self, project_id: str) -> Dict[str, Any]:
        """Get the status of a project.

        Args:
            project_id: ID of the project

        Returns:
            Dict containing project status and details
        """
        message = ProjectStatusMessage(
            sender_id=self._agent_id, project_id=project_id, action="get_status"
        )

        response = await self._send_and_wait_for_response(message)

        if response and response.get("success"):
            return {
                "success": True,
                "project_id": project_id,
                "status": response.get("status"),
                "project_data": response.get("project_data", {}),
            }
        else:
            error = (
                response.get("error", "Unknown error")
                if response
                else "No response received"
            )
            return {"success": False, "error": error}

    async def list_projects(
        self, filter_status: Optional[str] = None
    ) -> Dict[str, Any]:
        """List all projects associated with this agent.

        Args:
            filter_status: Optional status filter

        Returns:
            Dict containing list of projects
        """
        message = ProjectListMessage(
            sender_id=self._agent_id, filter_status=filter_status
        )

        response = await self._send_and_wait_for_response(message)

        if response and response.get("success"):
            return {
                "success": True,
                "projects": response.get("projects", []),
                "total_count": response.get("total_count", 0),
            }
        else:
            error = (
                response.get("error", "Unknown error")
                if response
                else "No response received"
            )
            return {"success": False, "error": error}

    async def stop_project(self, project_id: str) -> Dict[str, Any]:
        """Stop a project.

        Args:
            project_id: ID of the project to stop

        Returns:
            Dict containing operation result
        """
        return await self._change_project_status(project_id, "stop")

    async def pause_project(self, project_id: str) -> Dict[str, Any]:
        """Pause a project.

        Args:
            project_id: ID of the project to pause

        Returns:
            Dict containing operation result
        """
        return await self._change_project_status(project_id, "pause")

    async def resume_project(self, project_id: str) -> Dict[str, Any]:
        """Resume a project.

        Args:
            project_id: ID of the project to resume

        Returns:
            Dict containing operation result
        """
        return await self._change_project_status(project_id, "resume")

    async def join_project(self, project_id: str) -> Dict[str, Any]:
        """Join a project as a service agent.

        Args:
            project_id: ID of the project to join

        Returns:
            Dict containing operation result
        """
        message = ProjectChannelMessage(
            sender_id=self._agent_id, project_id=project_id, action="join"
        )

        response = await self._send_and_wait_for_response(message)

        if response and response.get("success"):
            return {
                "success": True,
                "project_id": project_id,
                "service_agents": response.get("service_agents", []),
            }
        else:
            error = (
                response.get("error", "Unknown error")
                if response
                else "No response received"
            )
            return {"success": False, "error": error}

    async def leave_project(self, project_id: str) -> Dict[str, Any]:
        """Leave a project.

        Args:
            project_id: ID of the project to leave

        Returns:
            Dict containing operation result
        """
        message = ProjectChannelMessage(
            sender_id=self._agent_id, project_id=project_id, action="leave"
        )

        response = await self._send_and_wait_for_response(message)

        if response and response.get("success"):
            return {
                "success": True,
                "project_id": project_id,
                "service_agents": response.get("service_agents", []),
            }
        else:
            error = (
                response.get("error", "Unknown error")
                if response
                else "No response received"
            )
            return {"success": False, "error": error}

    async def send_project_notification(
        self,
        project_id: str,
        notification_type: str,
        content: Dict[str, Any],
        target_agent_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Send a project notification.

        Args:
            project_id: ID of the project
            notification_type: Type of notification
            content: Notification content
            target_agent_id: Optional specific agent to notify

        Returns:
            Dict containing operation result
        """
        message = ProjectNotificationMessage(
            sender_id=self._agent_id,
            project_id=project_id,
            notification_type=notification_type,
            content=content,
            target_agent_id=target_agent_id,
        )

        # For notifications, we don't necessarily need to wait for a response
        mod_message = Event(
            sender_id=self._agent_id,
            relevant_mod="openagents.mods.project.default",
            content=message.model_dump(),
        )

        try:
            await self._connector.send_message(mod_message)
            return {"success": True, "message": "Notification sent"}
        except Exception as e:
            logger.error(f"Failed to send project notification: {e}")
            return {"success": False, "error": str(e)}

    async def _change_project_status(
        self, project_id: str, action: str
    ) -> Dict[str, Any]:
        """Change project status.

        Args:
            project_id: ID of the project
            action: Action to perform (start, stop, pause, resume)

        Returns:
            Dict containing operation result
        """
        message = ProjectStatusMessage(
            sender_id=self._agent_id, project_id=project_id, action=action
        )

        response = await self._send_and_wait_for_response(message)

        if response and response.get("success"):
            return {
                "success": True,
                "project_id": project_id,
                "status": response.get("status"),
                "project_data": response.get("project_data", {}),
            }
        else:
            error = (
                response.get("error", "Unknown error")
                if response
                else "No response received"
            )
            return {"success": False, "error": error}

    async def _send_and_wait_for_response(
        self, message, timeout: float = 10.0
    ) -> Optional[Dict[str, Any]]:
        """Send a message and wait for response.

        Args:
            message: Message to send
            timeout: Timeout in seconds

        Returns:
            Response content or None if timeout/error
        """
        request_id = message.message_id

        # Create future for response
        future = asyncio.Future()
        self._pending_responses[request_id] = future

        # Send message
        mod_message = Event(
            sender_id=self._agent_id,
            relevant_mod="openagents.mods.project.default",
            content=message.model_dump(),
        )

        try:
            await self._connector.send_message(mod_message)

            # Wait for response
            response = await asyncio.wait_for(future, timeout=timeout)
            return response

        except asyncio.TimeoutError:
            logger.warning(f"Timeout waiting for response to {request_id}")
            return None
        except Exception as e:
            logger.error(f"Error sending message or waiting for response: {e}")
            return None
        finally:
            # Clean up
            self._pending_responses.pop(request_id, None)

    async def handle_message(self, message) -> None:
        """Handle incoming messages.

        Args:
            message: Incoming message
        """
        if (
            isinstance(message, Event)
            and message.mod == "openagents.mods.project.default"
        ):
            content = message.content
            action = content.get("action")
            request_id = content.get("request_id")

            # Handle responses to our requests
            if request_id and request_id in self._pending_responses:
                future = self._pending_responses[request_id]
                if not future.done():
                    future.set_result(content)
                return

            # Handle notifications and other messages
            if action == "project_notification":
                await self._handle_project_notification(content)
            elif action == "project_message_received":
                await self._handle_project_message(content)
            else:
                logger.debug(f"Received project message with action: {action}")

    async def _handle_project_notification(self, content: Dict[str, Any]) -> None:
        """Handle project notification.

        Args:
            content: Notification content
        """
        notification_type = content.get("notification_type")
        project_id = content.get("project_id")
        project_name = content.get("project_name")

        logger.info(
            f"Received project notification: {notification_type} for project {project_name} ({project_id})"
        )

        # Here you could emit events or call handlers based on notification type
        # For now, just log the notification

    async def _handle_project_message(self, content: Dict[str, Any]) -> None:
        """Handle project message.

        Args:
            content: Message content
        """
        project_id = content.get("project_id")
        original_message = content.get("original_message", {})

        logger.info(
            f"Received project message for project {project_id}: {original_message}"
        )

        # Here you could process the message and take appropriate actions
        # For now, just log the message
