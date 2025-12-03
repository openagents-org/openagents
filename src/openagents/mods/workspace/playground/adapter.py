"""
Agent-level Interactive Playground adapter for OpenAgents.

This adapter provides tools for agents to interact with playground sessions,
including session management, artifact handling, and task creation.
"""

import logging
from typing import Any, Dict, List, Optional

from openagents.core.base_mod_adapter import BaseModAdapter
from openagents.models.event import Event
from openagents.models.tool import AgentTool

logger = logging.getLogger(__name__)


class PlaygroundAdapter(BaseModAdapter):
    """
    Agent adapter for the Interactive Playground mod.

    This adapter provides tools for:
    - Creating and managing playground sessions
    - Managing artifacts (shared outputs)
    - Creating tasks on the session's Kanban board
    - Joining/leaving sessions
    """

    def __init__(self):
        """Initialize the Playground adapter."""
        super().__init__(mod_name="openagents.mods.workspace.playground")
        logger.info("Initializing Playground adapter")

    def get_tools(self) -> List[AgentTool]:
        """Get the tools provided by this adapter."""
        tools = []

        # ============ Session Tools ============

        tools.append(AgentTool(
            name="playground_create",
            description="Create a new interactive playground session for collaborative research or work",
            input_schema={
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Name of the playground session",
                    },
                    "description": {
                        "type": "string",
                        "description": "Description of the session purpose",
                        "default": "",
                    },
                    "goal": {
                        "type": "string",
                        "description": "Goal or objective of the session",
                    },
                    "context": {
                        "type": "string",
                        "description": "Additional context for participants",
                    },
                    "allowed_agent_groups": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Agent groups allowed to access (empty = all)",
                        "default": [],
                    },
                    "create_board": {
                        "type": "boolean",
                        "description": "Whether to create a Kanban board",
                        "default": True,
                    },
                },
                "required": ["name"],
            },
            func=self.create_session,
        ))

        tools.append(AgentTool(
            name="playground_start",
            description="Start an existing playground session",
            input_schema={
                "type": "object",
                "properties": {
                    "session_id": {
                        "type": "string",
                        "description": "ID of the session to start",
                    },
                },
                "required": ["session_id"],
            },
            func=self.start_session,
        ))

        tools.append(AgentTool(
            name="playground_get",
            description="Get details of a playground session",
            input_schema={
                "type": "object",
                "properties": {
                    "session_id": {
                        "type": "string",
                        "description": "ID of the session",
                    },
                },
                "required": ["session_id"],
            },
            func=self.get_session,
        ))

        tools.append(AgentTool(
            name="playground_list",
            description="List accessible playground sessions",
            input_schema={
                "type": "object",
                "properties": {
                    "status": {
                        "type": "string",
                        "enum": ["created", "active", "paused", "completed", "archived"],
                        "description": "Filter by status",
                    },
                },
                "required": [],
            },
            func=self.list_sessions,
        ))

        tools.append(AgentTool(
            name="playground_join",
            description="Join a playground session",
            input_schema={
                "type": "object",
                "properties": {
                    "session_id": {
                        "type": "string",
                        "description": "ID of the session to join",
                    },
                },
                "required": ["session_id"],
            },
            func=self.join_session,
        ))

        tools.append(AgentTool(
            name="playground_leave",
            description="Leave a playground session",
            input_schema={
                "type": "object",
                "properties": {
                    "session_id": {
                        "type": "string",
                        "description": "ID of the session to leave",
                    },
                },
                "required": ["session_id"],
            },
            func=self.leave_session,
        ))

        tools.append(AgentTool(
            name="playground_complete",
            description="Complete a playground session (owner only)",
            input_schema={
                "type": "object",
                "properties": {
                    "session_id": {
                        "type": "string",
                        "description": "ID of the session to complete",
                    },
                    "summary": {
                        "type": "string",
                        "description": "Summary of what was accomplished",
                    },
                },
                "required": ["session_id"],
            },
            func=self.complete_session,
        ))

        # ============ Artifact Tools ============

        tools.append(AgentTool(
            name="playground_artifact_set",
            description="Set or update an artifact (shared output) in the session",
            input_schema={
                "type": "object",
                "properties": {
                    "session_id": {
                        "type": "string",
                        "description": "ID of the session",
                    },
                    "key": {
                        "type": "string",
                        "description": "Artifact key/name",
                    },
                    "value": {
                        "type": "string",
                        "description": "Artifact content",
                    },
                },
                "required": ["session_id", "key", "value"],
            },
            func=self.set_artifact,
        ))

        tools.append(AgentTool(
            name="playground_artifact_get",
            description="Get an artifact from the session",
            input_schema={
                "type": "object",
                "properties": {
                    "session_id": {
                        "type": "string",
                        "description": "ID of the session",
                    },
                    "key": {
                        "type": "string",
                        "description": "Artifact key/name",
                    },
                },
                "required": ["session_id", "key"],
            },
            func=self.get_artifact,
        ))

        tools.append(AgentTool(
            name="playground_artifact_list",
            description="List all artifacts in the session",
            input_schema={
                "type": "object",
                "properties": {
                    "session_id": {
                        "type": "string",
                        "description": "ID of the session",
                    },
                },
                "required": ["session_id"],
            },
            func=self.list_artifacts,
        ))

        # ============ Task Tools ============

        tools.append(AgentTool(
            name="playground_task_create",
            description="Create a task (Kanban card) in the session's board",
            input_schema={
                "type": "object",
                "properties": {
                    "session_id": {
                        "type": "string",
                        "description": "ID of the session",
                    },
                    "title": {
                        "type": "string",
                        "description": "Task title",
                    },
                    "description": {
                        "type": "string",
                        "description": "Task description",
                        "default": "",
                    },
                    "assignee_id": {
                        "type": "string",
                        "description": "Agent ID to assign the task to",
                    },
                    "labels": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Labels for the task",
                        "default": [],
                    },
                    "priority": {
                        "type": "string",
                        "enum": ["low", "medium", "high", "urgent"],
                        "description": "Task priority",
                        "default": "medium",
                    },
                },
                "required": ["session_id", "title"],
            },
            func=self.create_task,
        ))

        return tools

    async def _send_event(self, event_name: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Send an event to the Playground mod and return the response."""
        if self.agent_client is None:
            logger.error(f"Cannot send {event_name}: agent_client not available")
            return {"success": False, "error": "Agent client not available"}

        event = Event(
            event_name=event_name,
            source_id=self.agent_id,
            payload=payload,
            relevant_mod="openagents.mods.workspace.playground",
        )

        try:
            response = await self.agent_client.send_event(event)
            if response:
                return {
                    "success": response.success,
                    "message": response.message,
                    "data": response.data,
                }
            return {"success": False, "error": "No response received"}
        except Exception as e:
            logger.error(f"Error sending {event_name}: {e}")
            return {"success": False, "error": str(e)}

    # ============ Session Methods ============

    async def create_session(
        self,
        name: str,
        description: str = "",
        goal: Optional[str] = None,
        context: Optional[str] = None,
        allowed_agent_groups: Optional[List[str]] = None,
        create_board: bool = True,
    ) -> Dict[str, Any]:
        """Create a new playground session."""
        payload = {
            "name": name,
            "description": description,
            "create_board": create_board,
        }
        if goal:
            payload["goal"] = goal
        if context:
            payload["context"] = context
        if allowed_agent_groups:
            payload["allowed_agent_groups"] = allowed_agent_groups

        return await self._send_event("playground.create", payload)

    async def start_session(self, session_id: str) -> Dict[str, Any]:
        """Start a playground session."""
        return await self._send_event("playground.start", {"session_id": session_id})

    async def get_session(self, session_id: str) -> Dict[str, Any]:
        """Get session details."""
        return await self._send_event("playground.get", {"session_id": session_id})

    async def list_sessions(self, status: Optional[str] = None) -> Dict[str, Any]:
        """List accessible sessions."""
        payload = {}
        if status:
            payload["status"] = status
        return await self._send_event("playground.list", payload)

    async def join_session(self, session_id: str) -> Dict[str, Any]:
        """Join a session."""
        return await self._send_event("playground.join", {"session_id": session_id})

    async def leave_session(self, session_id: str) -> Dict[str, Any]:
        """Leave a session."""
        return await self._send_event("playground.leave", {"session_id": session_id})

    async def complete_session(
        self, session_id: str, summary: Optional[str] = None
    ) -> Dict[str, Any]:
        """Complete a session."""
        payload = {"session_id": session_id}
        if summary:
            payload["summary"] = summary
        return await self._send_event("playground.complete", payload)

    # ============ Artifact Methods ============

    async def set_artifact(
        self, session_id: str, key: str, value: str
    ) -> Dict[str, Any]:
        """Set an artifact in the session."""
        return await self._send_event(
            "playground.artifact.set",
            {"session_id": session_id, "key": key, "value": value},
        )

    async def get_artifact(self, session_id: str, key: str) -> Dict[str, Any]:
        """Get an artifact from the session."""
        return await self._send_event(
            "playground.artifact.get",
            {"session_id": session_id, "key": key},
        )

    async def list_artifacts(self, session_id: str) -> Dict[str, Any]:
        """List artifacts in the session."""
        return await self._send_event(
            "playground.artifact.list",
            {"session_id": session_id},
        )

    # ============ Task Methods ============

    async def create_task(
        self,
        session_id: str,
        title: str,
        description: str = "",
        assignee_id: Optional[str] = None,
        labels: Optional[List[str]] = None,
        priority: str = "medium",
    ) -> Dict[str, Any]:
        """Create a task in the session's Kanban board."""
        payload = {
            "session_id": session_id,
            "title": title,
            "description": description,
            "priority": priority,
        }
        if assignee_id:
            payload["assignee_id"] = assignee_id
        if labels:
            payload["labels"] = labels

        return await self._send_event("playground.task.create", payload)

    async def process_incoming_event(self, event: Event) -> Optional[Event]:
        """Process incoming Playground notification events."""
        if event.event_name.startswith("playground.notification."):
            logger.info(f"Received Playground notification: {event.event_name}")
            logger.debug(f"Notification payload: {event.payload}")

        return event

    def shutdown(self) -> bool:
        """Shutdown the adapter gracefully."""
        logger.info("Shutting down Playground adapter")
        return super().shutdown()
