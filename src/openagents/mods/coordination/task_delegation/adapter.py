"""
Agent-level task delegation adapter for OpenAgents.

This adapter provides tools for agents to delegate tasks, report progress,
complete/fail tasks, and query task information. Updated for A2A compatibility.
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
    - Delegating tasks to other agents (local or external A2A)
    - Accepting or rejecting assigned tasks
    - Reporting progress on assigned tasks
    - Completing or failing tasks
    - Canceling delegated tasks
    - Listing and querying tasks
    """

    def __init__(self, mod_config: Optional[Dict[str, Any]] = None):
        """Initialize the task delegation adapter.

        Args:
            mod_config: Optional configuration dictionary with keys:
                - auto_accept_tasks: bool (default True) - Automatically accept assigned tasks
        """
        super().__init__(mod_name="openagents.mods.coordination.task_delegation")

        # Parse config
        config = mod_config or {}
        self.auto_accept_tasks = config.get("auto_accept_tasks", True)

        logger.info(
            f"Initializing Task Delegation adapter (A2A-compatible, auto_accept={self.auto_accept_tasks})"
        )

    def get_tools(self) -> List[AgentTool]:
        """Get the tools provided by this adapter.

        Returns:
            List of AgentTool objects for task delegation operations
        """
        tools = []

        # Tool 1: Delegate task
        delegate_tool = AgentTool(
            name="delegate_task",
            description=(
                "Delegate a task to another agent. The assignee can be a local agent ID "
                "or an external A2A agent URL (e.g., 'https://agent.example.com' or 'a2a:agent-id')"
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "assignee_id": {
                        "type": "string",
                        "description": (
                            "ID of the agent to assign the task to. Can be a local agent ID, "
                            "an A2A URL (https://...), or an A2A registry reference (a2a:agent-id)"
                        ),
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

        # Tool 2 & 3: Accept/Reject task (only if auto_accept is disabled)
        if not self.auto_accept_tasks:
            accept_tool = AgentTool(
                name="accept_task",
                description="Accept a task that has been assigned to you. This moves the task to working state.",
                input_schema={
                    "type": "object",
                    "properties": {
                        "task_id": {
                            "type": "string",
                            "description": "ID of the task to accept",
                        },
                    },
                    "required": ["task_id"],
                },
                func=self.accept_task,
            )
            tools.append(accept_tool)

            reject_tool = AgentTool(
                name="reject_task",
                description="Reject a task that has been assigned to you. Provide a reason for rejection.",
                input_schema={
                    "type": "object",
                    "properties": {
                        "task_id": {
                            "type": "string",
                            "description": "ID of the task to reject",
                        },
                        "reason": {
                            "type": "string",
                            "description": "Reason for rejecting the task",
                            "default": "Task rejected by assignee",
                        },
                    },
                    "required": ["task_id"],
                },
                func=self.reject_task,
            )
            tools.append(reject_tool)

        # Tool 4: Report progress
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

        # Tool 5: Complete task
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
                        "description": "Result data for the completed task (can be string, number, object, array, etc.)",
                    },
                },
                "required": ["task_id"],
            },
            func=self.complete_task,
        )
        tools.append(complete_tool)

        # Tool 6: Fail task
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

        # Tool 7: Cancel task
        cancel_tool = AgentTool(
            name="cancel_task",
            description="Cancel a task that you delegated. Only the delegator can cancel a task.",
            input_schema={
                "type": "object",
                "properties": {
                    "task_id": {
                        "type": "string",
                        "description": "ID of the task to cancel",
                    },
                },
                "required": ["task_id"],
            },
            func=self.cancel_task,
        )
        tools.append(cancel_tool)

        # Tool 8: List tasks
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
                            "enum": [
                                "submitted",
                                "working",
                                "completed",
                                "failed",
                                "canceled",
                                "rejected",
                                "input-required",
                                "auth-required",
                            ],
                        },
                        "description": "Filter by A2A task status",
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

        # Tool 9: Get task details
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

        # Tool 10: Route task by capability
        route_tool = AgentTool(
            name="route_task",
            description=(
                "Route a task to an agent based on required capabilities. "
                "Use structured matching (required_capabilities) or natural language "
                "(capability_description with optional LLM config)."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "description": {
                        "type": "string",
                        "description": "Description of the task",
                    },
                    "required_capabilities": {
                        "type": "object",
                        "description": (
                            "Structured capability filter. Agent must have ALL specified. "
                            "Use this OR capability_description, not both."
                        ),
                        "properties": {
                            "skills": {
                                "type": "array",
                                "items": {"type": "string"},
                                "description": "Required skill IDs",
                            },
                            "tags": {
                                "type": "array",
                                "items": {"type": "string"},
                                "description": "Required tags",
                            },
                            "input_modes": {
                                "type": "array",
                                "items": {"type": "string"},
                                "description": "Required input modes (text, file, data)",
                            },
                            "output_modes": {
                                "type": "array",
                                "items": {"type": "string"},
                                "description": "Required output modes (text, file, data)",
                            },
                        },
                    },
                    "capability_description": {
                        "type": "string",
                        "description": (
                            "Natural language description of needed capabilities. "
                            "Use this OR required_capabilities, not both."
                        ),
                    },
                    "llm_config": {
                        "type": "object",
                        "description": "Optional LLM configuration for natural language matching",
                        "properties": {
                            "model": {
                                "type": "string",
                                "description": "Model to use for matching",
                            },
                            "prompt": {
                                "type": "string",
                                "description": "Custom prompt template",
                            },
                        },
                    },
                    "payload": {
                        "type": "object",
                        "description": "Optional task data/parameters",
                        "default": {},
                    },
                    "timeout_seconds": {
                        "type": "integer",
                        "description": "Timeout in seconds (default 300)",
                        "default": 300,
                    },
                    "selection_strategy": {
                        "type": "string",
                        "enum": ["first", "random"],
                        "description": "How to select from matching agents (default: first)",
                        "default": "first",
                    },
                    "fallback_assignee_id": {
                        "type": "string",
                        "description": "Agent ID to use if no capability match found",
                    },
                },
                "required": ["description"],
            },
            func=self.route_task,
        )
        tools.append(route_tool)

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
            assignee_id: ID of the agent to assign the task to (can be A2A URL)
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

    async def accept_task(self, task_id: str) -> Dict[str, Any]:
        """Accept a task assigned to you.

        Args:
            task_id: ID of the task to accept

        Returns:
            Response indicating success or failure
        """
        if self.agent_client is None:
            logger.error("Cannot accept task: agent_client not available")
            return {
                "success": False,
                "error": "Agent client not available",
            }

        event = Event(
            event_name="task.accept",
            source_id=self.agent_id,
            payload={"task_id": task_id},
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
            logger.error(f"Error accepting task: {e}")
            return {
                "success": False,
                "error": str(e),
            }

    async def reject_task(
        self,
        task_id: str,
        reason: str = "Task rejected by assignee",
    ) -> Dict[str, Any]:
        """Reject a task assigned to you.

        Args:
            task_id: ID of the task to reject
            reason: Reason for rejection

        Returns:
            Response indicating success or failure
        """
        if self.agent_client is None:
            logger.error("Cannot reject task: agent_client not available")
            return {
                "success": False,
                "error": "Agent client not available",
            }

        event = Event(
            event_name="task.reject",
            source_id=self.agent_id,
            payload={
                "task_id": task_id,
                "reason": reason,
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
            logger.error(f"Error rejecting task: {e}")
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
        result: Optional[Any] = None,
    ) -> Dict[str, Any]:
        """Complete an assigned task with result data.

        Args:
            task_id: ID of the task to complete
            result: Result data for the completed task (can be any type: string, dict, list, etc.)

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
                "result": result if result is not None else {},
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

    async def cancel_task(self, task_id: str) -> Dict[str, Any]:
        """Cancel a task that you delegated.

        Args:
            task_id: ID of the task to cancel

        Returns:
            Response indicating success or failure
        """
        if self.agent_client is None:
            logger.error("Cannot cancel task: agent_client not available")
            return {
                "success": False,
                "error": "Agent client not available",
            }

        event = Event(
            event_name="task.cancel",
            source_id=self.agent_id,
            payload={"task_id": task_id},
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
            logger.error(f"Error canceling task: {e}")
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

    async def route_task(
        self,
        description: str,
        required_capabilities: Optional[Dict[str, Any]] = None,
        capability_description: Optional[str] = None,
        llm_config: Optional[Dict[str, Any]] = None,
        payload: Optional[Dict[str, Any]] = None,
        timeout_seconds: int = 300,
        selection_strategy: str = "first",
        fallback_assignee_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Route a task to an agent based on required capabilities.

        Args:
            description: Description of the task
            required_capabilities: Structured capability filter (skills, tags, modes)
            capability_description: Natural language description of needed capabilities
            llm_config: Optional LLM config for natural language matching
            payload: Optional task data/parameters
            timeout_seconds: Timeout in seconds (default 300)
            selection_strategy: How to select from matches ("first" or "random")
            fallback_assignee_id: Agent to use if no capability match found

        Returns:
            Response containing task_id and assigned agent on success
        """
        if self.agent_client is None:
            logger.error("Cannot route task: agent_client not available")
            return {
                "success": False,
                "error": "Agent client not available",
            }

        if not required_capabilities and not capability_description:
            return {
                "success": False,
                "error": "Either required_capabilities or capability_description is required",
            }

        event_payload = {
            "description": description,
            "payload": payload or {},
            "timeout_seconds": timeout_seconds,
            "selection_strategy": selection_strategy,
        }

        if required_capabilities:
            event_payload["required_capabilities"] = required_capabilities
        if capability_description:
            event_payload["capability_description"] = capability_description
        if llm_config:
            event_payload["llm_config"] = llm_config
        if fallback_assignee_id:
            event_payload["fallback_assignee_id"] = fallback_assignee_id

        event = Event(
            event_name="task.route",
            source_id=self.agent_id,
            payload=event_payload,
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
            logger.error(f"Error routing task: {e}")
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

            # Auto-accept assigned tasks if enabled
            if (
                event.event_name == "task.notification.assigned"
                and self.auto_accept_tasks
            ):
                task_id = event.payload.get("task_id")
                if task_id:
                    logger.info(
                        f"Auto-accepting task {task_id} (auto_accept_tasks=True)"
                    )
                    try:
                        await self.accept_task(task_id=task_id)
                    except Exception as e:
                        logger.error(f"Failed to auto-accept task {task_id}: {e}")

        return event

    def shutdown(self) -> bool:
        """Shutdown the adapter gracefully."""
        logger.info("Shutting down Task Delegation adapter")
        return super().shutdown()
