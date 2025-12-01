"""
Agent-level shared artifact adapter for OpenAgents.

This adapter provides tools for agents to interact with the shared artifact system.
"""

import logging
from typing import Dict, Any, List, Optional
from pathlib import Path

from openagents.core.base_mod_adapter import BaseModAdapter
from openagents.models.event import Event, EventVisibility
from openagents.models.tool import AgentTool

logger = logging.getLogger(__name__)


class SharedArtifactAdapter(BaseModAdapter):
    """Agent-level shared artifact adapter implementation.

    This adapter provides tools for agents to create, read, update, delete,
    and list shared artifacts.
    """

    def __init__(self):
        """Initialize the shared artifact adapter for an agent."""
        super().__init__(mod_name="shared_artifact")

        # Track pending requests
        self.pending_requests: Dict[str, Dict[str, Any]] = {}
        self.completed_requests: Dict[str, Dict[str, Any]] = {}

        logger.info(f"Initializing Shared Artifact adapter for agent")

    def initialize(self) -> bool:
        """Initialize the adapter.

        Returns:
            bool: True if initialization was successful, False otherwise
        """
        logger.info(f"Shared Artifact adapter initialized for agent {self.agent_id}")
        return True

    def shutdown(self) -> bool:
        """Shutdown the adapter.

        Returns:
            bool: True if shutdown was successful, False otherwise
        """
        # Clear all state
        self.pending_requests.clear()
        self.completed_requests.clear()

        return True

    async def process_incoming_mod_message(self, message: Event) -> None:
        """Process an incoming mod message.

        Args:
            message: The mod message to process
        """
        logger.debug(f"Received mod message from {message.source_id}")

        # Handle different event types based on event name
        event_name = message.event_name

        if event_name == "shared_artifact.create.response":
            await self._handle_artifact_create_response(message)
        elif event_name == "shared_artifact.get.response":
            await self._handle_artifact_get_response(message)
        elif event_name == "shared_artifact.update.response":
            await self._handle_artifact_update_response(message)
        elif event_name == "shared_artifact.delete.response":
            await self._handle_artifact_delete_response(message)
        elif event_name == "shared_artifact.list.response":
            await self._handle_artifact_list_response(message)
        elif event_name == "shared_artifact.notification.created":
            await self._handle_artifact_created_notification(message)
        elif event_name == "shared_artifact.notification.updated":
            await self._handle_artifact_updated_notification(message)
        elif event_name == "shared_artifact.notification.deleted":
            await self._handle_artifact_deleted_notification(message)
        else:
            logger.debug(f"Unhandled shared artifact event: {event_name}")

    async def create_artifact(
        self,
        content: str,
        name: Optional[str] = None,
        mime_type: str = "text/plain",
        allowed_agent_groups: Optional[List[str]] = None,
    ) -> Optional[str]:
        """Create a new artifact.

        Args:
            content: The content of the artifact (base64 encoded for binary files)
            name: Optional natural language name for the artifact
            mime_type: MIME type of the content (default: "text/plain")
            allowed_agent_groups: List of agent groups that can access this artifact (empty = all)

        Returns:
            Optional[str]: Artifact ID if successful, None otherwise
        """
        if self.connector is None:
            logger.error(
                f"Cannot create artifact: connector is None for agent {self.agent_id}"
            )
            return None

        try:
            # Create artifact creation event
            message = Event(
                event_name="shared_artifact.create",
                source_id=self.agent_id,
                relevant_mod="openagents.mods.workspace.shared_artifact",
                visibility=EventVisibility.MOD_ONLY,
                payload={
                    "content": content,
                    "name": name,
                    "mime_type": mime_type,
                    "allowed_agent_groups": allowed_agent_groups or [],
                },
            )

            # Store pending request
            self.pending_requests[message.event_id] = {
                "action": "create",
                "timestamp": message.timestamp,
            }

            # Send event
            await self.connector.send_event(message)
            logger.debug(f"Sent artifact creation request")

            # Wait for response
            import asyncio

            for _ in range(50):  # 50 * 0.2 = 10 seconds
                if message.event_id in self.completed_requests:
                    result = self.completed_requests.pop(message.event_id)
                    if result.get("success"):
                        artifact_id = result.get("artifact_id")
                        logger.info(f"Artifact created: {artifact_id}")
                        return artifact_id
                    else:
                        logger.error(
                            f"Artifact creation failed: {result.get('error', 'Unknown error')}"
                        )
                        return None

                await asyncio.sleep(0.2)

            # Timeout
            logger.warning("Artifact creation timed out")
            if message.event_id in self.pending_requests:
                del self.pending_requests[message.event_id]
            return None

        except Exception as e:
            logger.error(f"Error creating artifact: {e}")
            return None

    async def get_artifact(self, artifact_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve an artifact.

        Args:
            artifact_id: ID of the artifact to retrieve

        Returns:
            Optional[Dict[str, Any]]: Artifact data if successful, None otherwise
        """
        if self.connector is None:
            logger.error(f"Cannot get artifact: connector is None for agent {self.agent_id}")
            return None

        try:
            # Create artifact get event
            message = Event(
                event_name="shared_artifact.get",
                source_id=self.agent_id,
                relevant_mod="openagents.mods.workspace.shared_artifact",
                visibility=EventVisibility.MOD_ONLY,
                payload={"artifact_id": artifact_id},
            )

            # Store pending request
            self.pending_requests[message.event_id] = {
                "action": "get",
                "artifact_id": artifact_id,
                "timestamp": message.timestamp,
            }

            # Send event
            await self.connector.send_event(message)
            logger.debug(f"Sent artifact get request for {artifact_id}")

            # Wait for response
            import asyncio

            for _ in range(50):  # 50 * 0.2 = 10 seconds
                if message.event_id in self.completed_requests:
                    result = self.completed_requests.pop(message.event_id)
                    if result.get("success"):
                        logger.info(f"Artifact retrieved: {artifact_id}")
                        return result
                    else:
                        logger.error(
                            f"Artifact retrieval failed: {result.get('error', 'Unknown error')}"
                        )
                        return None

                await asyncio.sleep(0.2)

            # Timeout
            logger.warning(f"Artifact retrieval timed out for {artifact_id}")
            if message.event_id in self.pending_requests:
                del self.pending_requests[message.event_id]
            return None

        except Exception as e:
            logger.error(f"Error retrieving artifact: {e}")
            return None

    async def update_artifact(self, artifact_id: str, content: str) -> bool:
        """Update an artifact.

        Args:
            artifact_id: ID of the artifact to update
            content: New content for the artifact (base64 encoded for binary files)

        Returns:
            bool: True if successful, False otherwise
        """
        if self.connector is None:
            logger.error(
                f"Cannot update artifact: connector is None for agent {self.agent_id}"
            )
            return False

        try:
            # Create artifact update event
            message = Event(
                event_name="shared_artifact.update",
                source_id=self.agent_id,
                relevant_mod="openagents.mods.workspace.shared_artifact",
                visibility=EventVisibility.MOD_ONLY,
                payload={"artifact_id": artifact_id, "content": content},
            )

            # Store pending request
            self.pending_requests[message.event_id] = {
                "action": "update",
                "artifact_id": artifact_id,
                "timestamp": message.timestamp,
            }

            # Send event
            await self.connector.send_event(message)
            logger.debug(f"Sent artifact update request for {artifact_id}")

            # Wait for response
            import asyncio

            for _ in range(50):  # 50 * 0.2 = 10 seconds
                if message.event_id in self.completed_requests:
                    result = self.completed_requests.pop(message.event_id)
                    if result.get("success"):
                        logger.info(f"Artifact updated: {artifact_id}")
                        return True
                    else:
                        logger.error(
                            f"Artifact update failed: {result.get('error', 'Unknown error')}"
                        )
                        return False

                await asyncio.sleep(0.2)

            # Timeout
            logger.warning(f"Artifact update timed out for {artifact_id}")
            if message.event_id in self.pending_requests:
                del self.pending_requests[message.event_id]
            return False

        except Exception as e:
            logger.error(f"Error updating artifact: {e}")
            return False

    async def delete_artifact(self, artifact_id: str) -> bool:
        """Delete an artifact.

        Args:
            artifact_id: ID of the artifact to delete

        Returns:
            bool: True if successful, False otherwise
        """
        if self.connector is None:
            logger.error(
                f"Cannot delete artifact: connector is None for agent {self.agent_id}"
            )
            return False

        try:
            # Create artifact delete event
            message = Event(
                event_name="shared_artifact.delete",
                source_id=self.agent_id,
                relevant_mod="openagents.mods.workspace.shared_artifact",
                visibility=EventVisibility.MOD_ONLY,
                payload={"artifact_id": artifact_id},
            )

            # Store pending request
            self.pending_requests[message.event_id] = {
                "action": "delete",
                "artifact_id": artifact_id,
                "timestamp": message.timestamp,
            }

            # Send event
            await self.connector.send_event(message)
            logger.debug(f"Sent artifact delete request for {artifact_id}")

            # Wait for response
            import asyncio

            for _ in range(50):  # 50 * 0.2 = 10 seconds
                if message.event_id in self.completed_requests:
                    result = self.completed_requests.pop(message.event_id)
                    if result.get("success"):
                        logger.info(f"Artifact deleted: {artifact_id}")
                        return True
                    else:
                        logger.error(
                            f"Artifact deletion failed: {result.get('error', 'Unknown error')}"
                        )
                        return False

                await asyncio.sleep(0.2)

            # Timeout
            logger.warning(f"Artifact deletion timed out for {artifact_id}")
            if message.event_id in self.pending_requests:
                del self.pending_requests[message.event_id]
            return False

        except Exception as e:
            logger.error(f"Error deleting artifact: {e}")
            return False

    async def list_artifacts(self, mime_type: Optional[str] = None) -> Optional[List[Dict[str, Any]]]:
        """List artifacts with optional filtering.

        Args:
            mime_type: Optional MIME type filter

        Returns:
            Optional[List[Dict[str, Any]]]: List of artifacts if successful, None otherwise
        """
        if self.connector is None:
            logger.error(f"Cannot list artifacts: connector is None for agent {self.agent_id}")
            return None

        try:
            # Create artifact list event
            payload = {}
            if mime_type:
                payload["mime_type"] = mime_type

            message = Event(
                event_name="shared_artifact.list",
                source_id=self.agent_id,
                relevant_mod="openagents.mods.workspace.shared_artifact",
                visibility=EventVisibility.MOD_ONLY,
                payload=payload,
            )

            # Store pending request
            self.pending_requests[message.event_id] = {
                "action": "list",
                "timestamp": message.timestamp,
            }

            # Send event
            await self.connector.send_event(message)
            logger.debug(f"Sent artifact list request")

            # Wait for response
            import asyncio

            for _ in range(50):  # 50 * 0.2 = 10 seconds
                if message.event_id in self.completed_requests:
                    result = self.completed_requests.pop(message.event_id)
                    if result.get("success"):
                        artifacts = result.get("artifacts", [])
                        logger.info(f"Listed {len(artifacts)} artifacts")
                        return artifacts
                    else:
                        logger.error(
                            f"Artifact listing failed: {result.get('error', 'Unknown error')}"
                        )
                        return None

                await asyncio.sleep(0.2)

            # Timeout
            logger.warning("Artifact listing timed out")
            if message.event_id in self.pending_requests:
                del self.pending_requests[message.event_id]
            return None

        except Exception as e:
            logger.error(f"Error listing artifacts: {e}")
            return None

    async def _handle_artifact_create_response(self, message: Event) -> None:
        """Handle artifact create response.

        Args:
            message: The response message
        """
        request_id = message.response_to
        if request_id and request_id in self.pending_requests:
            self.completed_requests[request_id] = message.payload or {}
            del self.pending_requests[request_id]

    async def _handle_artifact_get_response(self, message: Event) -> None:
        """Handle artifact get response.

        Args:
            message: The response message
        """
        request_id = message.response_to
        if request_id and request_id in self.pending_requests:
            self.completed_requests[request_id] = message.payload or {}
            del self.pending_requests[request_id]

    async def _handle_artifact_update_response(self, message: Event) -> None:
        """Handle artifact update response.

        Args:
            message: The response message
        """
        request_id = message.response_to
        if request_id and request_id in self.pending_requests:
            self.completed_requests[request_id] = message.payload or {}
            del self.pending_requests[request_id]

    async def _handle_artifact_delete_response(self, message: Event) -> None:
        """Handle artifact delete response.

        Args:
            message: The response message
        """
        request_id = message.response_to
        if request_id and request_id in self.pending_requests:
            self.completed_requests[request_id] = message.payload or {}
            del self.pending_requests[request_id]

    async def _handle_artifact_list_response(self, message: Event) -> None:
        """Handle artifact list response.

        Args:
            message: The response message
        """
        request_id = message.response_to
        if request_id and request_id in self.pending_requests:
            self.completed_requests[request_id] = message.payload or {}
            del self.pending_requests[request_id]

    async def _handle_artifact_created_notification(self, message: Event) -> None:
        """Handle artifact created notification.

        Args:
            message: The notification message
        """
        payload = message.payload or {}
        artifact_id = payload.get("artifact_id")
        logger.info(f"Received artifact created notification for {artifact_id}")

        # Notify any registered handlers if needed
        # This could be extended to support custom callbacks

    async def _handle_artifact_updated_notification(self, message: Event) -> None:
        """Handle artifact updated notification.

        Args:
            message: The notification message
        """
        payload = message.payload or {}
        artifact_id = payload.get("artifact_id")
        logger.info(f"Received artifact updated notification for {artifact_id}")

        # Notify any registered handlers if needed

    async def _handle_artifact_deleted_notification(self, message: Event) -> None:
        """Handle artifact deleted notification.

        Args:
            message: The notification message
        """
        payload = message.payload or {}
        artifact_id = payload.get("artifact_id")
        logger.info(f"Received artifact deleted notification for {artifact_id}")

        # Notify any registered handlers if needed

    def get_tools(self) -> List[AgentTool]:
        """Get the tools for the mod adapter.

        Returns:
            List[AgentTool]: The tools for the mod adapter
        """
        tools = []

        # Tool 1: Create artifact
        create_artifact_tool = AgentTool(
            name="create_artifact",
            description="Create a new shared artifact with optional agent group access control. Supports both text and binary files (use base64 encoding for binary content).",
            input_schema={
                "type": "object",
                "properties": {
                    "content": {
                        "type": "string",
                        "description": "The content of the artifact (base64 encoded for binary files)",
                    },
                    "name": {
                        "type": "string",
                        "description": "Optional natural language name for the artifact (e.g., 'Monthly Sales Report')",
                    },
                    "mime_type": {
                        "type": "string",
                        "description": "MIME type of the content (default: text/plain)",
                        "default": "text/plain",
                    },
                    "allowed_agent_groups": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of agent groups that can access this artifact (empty = all agents)",
                        "default": [],
                    },
                },
                "required": ["content"],
            },
            func=self.create_artifact,
        )
        tools.append(create_artifact_tool)

        # Tool 2: Get artifact
        get_artifact_tool = AgentTool(
            name="get_artifact",
            description="Retrieve a shared artifact by ID",
            input_schema={
                "type": "object",
                "properties": {
                    "artifact_id": {
                        "type": "string",
                        "description": "ID of the artifact to retrieve",
                    }
                },
                "required": ["artifact_id"],
            },
            func=self.get_artifact,
        )
        tools.append(get_artifact_tool)

        # Tool 3: Update artifact
        update_artifact_tool = AgentTool(
            name="update_artifact",
            description="Update an existing shared artifact",
            input_schema={
                "type": "object",
                "properties": {
                    "artifact_id": {
                        "type": "string",
                        "description": "ID of the artifact to update",
                    },
                    "content": {
                        "type": "string",
                        "description": "New content for the artifact (base64 encoded for binary files)",
                    },
                },
                "required": ["artifact_id", "content"],
            },
            func=self.update_artifact,
        )
        tools.append(update_artifact_tool)

        # Tool 4: Delete artifact
        delete_artifact_tool = AgentTool(
            name="delete_artifact",
            description="Delete a shared artifact",
            input_schema={
                "type": "object",
                "properties": {
                    "artifact_id": {
                        "type": "string",
                        "description": "ID of the artifact to delete",
                    }
                },
                "required": ["artifact_id"],
            },
            func=self.delete_artifact,
        )
        tools.append(delete_artifact_tool)

        # Tool 5: List artifacts
        list_artifacts_tool = AgentTool(
            name="list_artifacts",
            description="List shared artifacts with optional MIME type filtering",
            input_schema={
                "type": "object",
                "properties": {
                    "mime_type": {
                        "type": "string",
                        "description": "Optional MIME type filter (e.g., 'application/json', 'image/png')",
                    }
                },
            },
            func=self.list_artifacts,
        )
        tools.append(list_artifacts_tool)

        return tools
