"""
Agent-level task delegation adapter for OpenAgents.

This adapter provides tools for agents to delegate tasks, report progress,
complete/fail tasks, and query task information.
"""

import logging
from typing import Any, Dict, List, Optional

from openagents.core.base_mod_adapter import BaseModAdapter
from openagents.models.event import Event
from openagents.models.tool import AgentTool

logger = logging.getLogger(__name__)


class TaskDelegationAdapter(BaseModAdapter):
    """
    Agent adapter for the task delegation mod.

    This adapter provides tools for:
    - Delegating tasks to other agents
    - Reporting progress on assigned tasks
    - Completing or failing tasks
    - Listing and querying tasks
    """

    def __init__(self):
        """Initialize the task delegation adapter."""
        super().__init__(mod_name="openagents.mods.coordination.task_delegation")
        logger.info("Initializing Task Delegation adapter")

    def get_tools(self) -> List[AgentTool]:
        """Get the tools provided by this adapter.

        Returns:
            List of AgentTool objects for task delegation operations
        """
        tools = []

        # Tool 1: Delegate task
        delegate_tool = AgentTool(
            name="delegate_task",
            description="Delegate a task to another agent with description and optional payload",
            input_schema={
                "type": "object",
                "properties": {
                    "assignee_id": {
                        "type": "string",
                        "description": "ID of the agent to assign the task to",
                    },
                    "description": {
                        "type": "string",
                        "description": "Description of the task",
                    },
                    "payload": {
                        "type": "object",
                        "description": "Optional task data/parameters",
                        "default": {},
                    },
                    "timeout_seconds": {
                        "type": "integer",
                        "description": "Optional timeout in seconds (default 300)",
                        "default": 300,
                    },
                },
                "required": ["assignee_id", "description"],
            },
            func=self.delegate_task,
        )
        tools.append(delegate_tool)

        # Tool 2: Report progress
        report_tool = AgentTool(
            name="report_task_progress",
            description="Report progress on an assigned task",
            input_schema={
                "type": "object",
                "properties": {
                    "task_id": {
                        "type": "string",
                        "description": "ID of the task to report progress on",
                    },
                    "message": {
                        "type": "string",
                        "description": "Progress message",
                    },
                    "data": {
                        "type": "object",
                        "description": "Optional progress data",
                        "default": None,
                    },
                },
                "required": ["task_id", "message"],
            },
            func=self.report_progress,
        )
        tools.append(report_tool)

        # Tool 3: Complete task
        complete_tool = AgentTool(
            name="complete_task",
            description="Mark an assigned task as completed with result data",
            input_schema={
                "type": "object",
                "properties": {
                    "task_id": {
                        "type": "string",
                        "description": "ID of the task to complete",
                    },
                    "result": {
                        "type": "object",
                        "description": "Result data for the completed task",
                        "default": {},
                    },
                },
                "required": ["task_id"],
            },
            func=self.complete_task,
        )
        tools.append(complete_tool)

        # Tool 4: Fail task
        fail_tool = AgentTool(
            name="fail_task",
            description="Mark an assigned task as failed with an error message",
            input_schema={
                "type": "object",
                "properties": {
                    "task_id": {
                        "type": "string",
                        "description": "ID of the task to fail",
                    },
                    "error": {
                        "type": "string",
                        "description": "Error message explaining why the task failed",
                    },
                },
                "required": ["task_id", "error"],
            },
            func=self.fail_task,
        )
        tools.append(fail_tool)

        # Tool 5: List tasks
        list_tool = AgentTool(
            name="list_tasks",
            description="List tasks delegated by you or assigned to you",
            input_schema={
                "type": "object",
                "properties": {
                    "role": {
                        "type": "string",
                        "enum": ["delegated_by_me", "assigned_to_me"],
                        "description": "Filter by role (default: delegated_by_me)",
                        "default": "delegated_by_me",
                    },
                    "status": {
                        "type": "array",
                        "items": {
                            "type": "string",
                            "enum": ["in_progress", "completed", "failed", "timed_out"],
                        },
                        "description": "Filter by status (optional)",
                        "default": [],
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of tasks to return (default 20)",
                        "default": 20,
                    },
                    "offset": {
                        "type": "integer",
                        "description": "Number of tasks to skip for pagination (default 0)",
                        "default": 0,
                    },
                },
                "required": [],
            },
            func=self.list_tasks,
        )
        tools.append(list_tool)

        # Tool 6: Get task details
        get_tool = AgentTool(
            name="get_task",
            description="Get detailed information about a specific task",
            input_schema={
                "type": "object",
                "properties": {
                    "task_id": {
                        "type": "string",
                        "description": "ID of the task to retrieve",
                    },
                },
                "required": ["task_id"],
            },
            func=self.get_task,
        )
        tools.append(get_tool)

        return tools

    async def delegate_task(
        self,
        assignee_id: str,
        description: str,
        payload: Optional[Dict[str, Any]] = None,
        timeout_seconds: int = 300,
    ) -> Dict[str, Any]:
        """Delegate a task to another agent.

        Args:
            assignee_id: ID of the agent to assign the task to
            description: Description of the task
            payload: Optional task data/parameters
            timeout_seconds: Timeout in seconds (default 300)

        Returns:
            Response containing task_id and status on success, or error on failure
        """
        if self.agent_client is None:
            logger.error("Cannot delegate task: agent_client not available")
            return {
                "success": False,
                "error": "Agent client not available",
            }

        event = Event(
            event_name="task.delegate",
            source_id=self.agent_id,
            payload={
                "assignee_id": assignee_id,
                "description": description,
                "payload": payload or {},
                "timeout_seconds": timeout_seconds,
            },
            relevant_mod="openagents.mods.coordination.task_delegation",
        )

        try:
            response = await self.agent_client.send_event(event)
            if response:
                return {
                    "success": response.success,
                    "message": response.message,
                    "data": response.data,
                }
            return {
                "success": False,
                "error": "No response received",
            }
        except Exception as e:
            logger.error(f"Error delegating task: {e}")
            return {
                "success": False,
                "error": str(e),
            }

    async def report_progress(
        self,
        task_id: str,
        message: str,
        data: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Report progress on an assigned task.

        Args:
            task_id: ID of the task
            message: Progress message
            data: Optional progress data

        Returns:
            Response indicating success or failure
        """
        if self.agent_client is None:
            logger.error("Cannot report progress: agent_client not available")
            return {
                "success": False,
                "error": "Agent client not available",
            }

        event = Event(
            event_name="task.report",
            source_id=self.agent_id,
            payload={
                "task_id": task_id,
                "progress": {
                    "message": message,
                    "data": data,
                },
            },
            relevant_mod="openagents.mods.coordination.task_delegation",
        )

        try:
            response = await self.agent_client.send_event(event)
            if response:
                return {
                    "success": response.success,
                    "message": response.message,
                    "data": response.data,
                }
            return {
                "success": False,
                "error": "No response received",
            }
        except Exception as e:
            logger.error(f"Error reporting progress: {e}")
            return {
                "success": False,
                "error": str(e),
            }

    async def complete_task(
        self,
        task_id: str,
        result: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Complete an assigned task with result data.

        Args:
            task_id: ID of the task to complete
            result: Result data for the completed task

        Returns:
            Response indicating success or failure
        """
        if self.agent_client is None:
            logger.error("Cannot complete task: agent_client not available")
            return {
                "success": False,
                "error": "Agent client not available",
            }

        event = Event(
            event_name="task.complete",
            source_id=self.agent_id,
            payload={
                "task_id": task_id,
                "result": result or {},
            },
            relevant_mod="openagents.mods.coordination.task_delegation",
        )

        try:
            response = await self.agent_client.send_event(event)
            if response:
                return {
                    "success": response.success,
                    "message": response.message,
                    "data": response.data,
                }
            return {
                "success": False,
                "error": "No response received",
            }
        except Exception as e:
            logger.error(f"Error completing task: {e}")
            return {
                "success": False,
                "error": str(e),
            }

    async def fail_task(
        self,
        task_id: str,
        error: str,
    ) -> Dict[str, Any]:
        """Mark an assigned task as failed.

        Args:
            task_id: ID of the task to fail
            error: Error message explaining why the task failed

        Returns:
            Response indicating success or failure
        """
        if self.agent_client is None:
            logger.error("Cannot fail task: agent_client not available")
            return {
                "success": False,
                "error": "Agent client not available",
            }

        event = Event(
            event_name="task.fail",
            source_id=self.agent_id,
            payload={
                "task_id": task_id,
                "error": error,
            },
            relevant_mod="openagents.mods.coordination.task_delegation",
        )

        try:
            response = await self.agent_client.send_event(event)
            if response:
                return {
                    "success": response.success,
                    "message": response.message,
                    "data": response.data,
                }
            return {
                "success": False,
                "error": "No response received",
            }
        except Exception as e:
            logger.error(f"Error failing task: {e}")
            return {
                "success": False,
                "error": str(e),
            }

    async def list_tasks(
        self,
        role: str = "delegated_by_me",
        status: Optional[List[str]] = None,
        limit: int = 20,
        offset: int = 0,
    ) -> Dict[str, Any]:
        """List tasks delegated by you or assigned to you.

        Args:
            role: Filter by role ("delegated_by_me" or "assigned_to_me")
            status: Optional list of statuses to filter by
            limit: Maximum number of tasks to return
            offset: Number of tasks to skip for pagination

        Returns:
            Response containing list of tasks
        """
        if self.agent_client is None:
            logger.error("Cannot list tasks: agent_client not available")
            return {
                "success": False,
                "error": "Agent client not available",
            }

        event = Event(
            event_name="task.list",
            source_id=self.agent_id,
            payload={
                "filter": {
                    "role": role,
                    "status": status or [],
                },
                "limit": limit,
                "offset": offset,
            },
            relevant_mod="openagents.mods.coordination.task_delegation",
        )

        try:
            response = await self.agent_client.send_event(event)
            if response:
                return {
                    "success": response.success,
                    "message": response.message,
                    "data": response.data,
                }
            return {
                "success": False,
                "error": "No response received",
            }
        except Exception as e:
            logger.error(f"Error listing tasks: {e}")
            return {
                "success": False,
                "error": str(e),
            }

    async def get_task(self, task_id: str) -> Dict[str, Any]:
        """Get detailed information about a specific task.

        Args:
            task_id: ID of the task to retrieve

        Returns:
            Response containing task details
        """
        if self.agent_client is None:
            logger.error("Cannot get task: agent_client not available")
            return {
                "success": False,
                "error": "Agent client not available",
            }

        event = Event(
            event_name="task.get",
            source_id=self.agent_id,
            payload={
                "task_id": task_id,
            },
            relevant_mod="openagents.mods.coordination.task_delegation",
        )

        try:
            response = await self.agent_client.send_event(event)
            if response:
                return {
                    "success": response.success,
                    "message": response.message,
                    "data": response.data,
                }
            return {
                "success": False,
                "error": "No response received",
            }
        except Exception as e:
            logger.error(f"Error getting task: {e}")
            return {
                "success": False,
                "error": str(e),
            }

    async def process_incoming_event(self, event: Event) -> Optional[Event]:
        """Process incoming events for task notifications.

        Args:
            event: The incoming event

        Returns:
            The event (possibly modified) or None to stop processing
        """
        # Handle task-related notifications
        if event.event_name.startswith("task.notification."):
            logger.info(f"Received task notification: {event.event_name}")
            logger.debug(f"Notification payload: {event.payload}")

        return event

    def shutdown(self) -> bool:
        """Shutdown the adapter gracefully."""
        logger.info("Shutting down Task Delegation adapter")
        return super().shutdown()
