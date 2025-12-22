"""
Agent-level avatar adapter for OpenAgents.

This adapter provides avatar management capabilities for individual agents.
"""

import logging
import base64
from typing import Dict, Any, List, Optional

from openagents.core.base_mod_adapter import BaseModAdapter
from openagents.models.messages import Event
from openagents.models.tool import AgentTool

logger = logging.getLogger(__name__)


class AvatarAdapter(BaseModAdapter):
    """Agent-level avatar adapter implementation.

    This adapter provides:
    - Set avatar for the agent
    - Get avatar for any agent
    - Batch get avatars
    - Clear avatar for the agent
    - Avatar tools for LLM agents
    """

    def __init__(self):
        """Initialize the avatar adapter for an agent."""
        super().__init__(mod_name="avatar")
        logger.info("Initializing Avatar agent adapter")

    def initialize(self) -> bool:
        """Initialize the adapter.

        Returns:
            bool: True if initialization was successful
        """
        logger.info("Avatar agent adapter initialized successfully")
        return True

    def shutdown(self) -> bool:
        """Shutdown the adapter gracefully.

        Returns:
            bool: True if shutdown was successful
        """
        logger.info("Avatar agent adapter shutting down")
        return True

    def on_connect(self) -> None:
        """Called when the adapter is connected to the network."""
        logger.info(f"Avatar adapter connected for agent {self.agent_id}")

    def on_disconnect(self) -> None:
        """Called when the adapter is disconnected from the network."""
        logger.info(f"Avatar adapter disconnected for agent {self.agent_id}")

    async def set_avatar(
        self, image_data: str, mime_type: str = "image/png"
    ) -> Dict[str, Any]:
        """Set the agent's avatar image.

        Args:
            image_data: Base64-encoded image data
            mime_type: MIME type of the image

        Returns:
            Dict with result
        """
        event = Event(
            event_name="avatar.set",
            source_id=self.agent_id,
            destination_id="",
            payload={"image_data": image_data, "mime_type": mime_type},
        )

        try:
            if self.connector:
                response = await self.connector.send_message(event)
                if response and hasattr(response, 'data'):
                    return {
                        "success": True,
                        "data": response.data
                    }
                return {"success": True, "message": "Avatar set"}
            else:
                return {"success": False, "error": "No connector available"}
        except Exception as e:
            logger.error(f"Error setting avatar: {e}")
            return {"success": False, "error": str(e)}

    async def clear_avatar(self) -> Dict[str, Any]:
        """Clear the agent's avatar.

        Returns:
            Dict with result
        """
        event = Event(
            event_name="avatar.clear",
            source_id=self.agent_id,
            destination_id="",
            payload={},
        )

        try:
            if self.connector:
                response = await self.connector.send_message(event)
                if response and hasattr(response, 'data'):
                    return {
                        "success": True,
                        "data": response.data
                    }
                return {"success": True, "message": "Avatar cleared"}
            else:
                return {"success": False, "error": "No connector available"}
        except Exception as e:
            logger.error(f"Error clearing avatar: {e}")
            return {"success": False, "error": str(e)}

    async def get_avatar(
        self, agent_id: str, include_data: bool = False
    ) -> Dict[str, Any]:
        """Get avatar information for an agent.

        Args:
            agent_id: ID of the agent to get avatar for
            include_data: Whether to include base64 image data

        Returns:
            Dict with avatar info
        """
        event = Event(
            event_name="avatar.get",
            source_id=self.agent_id,
            destination_id="",
            payload={"agent_id": agent_id, "include_data": include_data},
        )

        try:
            if self.connector:
                response = await self.connector.send_message(event)
                if response and hasattr(response, 'data'):
                    return {
                        "success": True,
                        "data": response.data
                    }
                return {"success": False, "error": "No response received"}
            else:
                return {"success": False, "error": "No connector available"}
        except Exception as e:
            logger.error(f"Error getting avatar: {e}")
            return {"success": False, "error": str(e)}

    async def get_batch(self, agent_ids: List[str]) -> Dict[str, Any]:
        """Get avatars for multiple agents.

        Args:
            agent_ids: List of agent IDs

        Returns:
            Dict with avatars
        """
        event = Event(
            event_name="avatar.get_batch",
            source_id=self.agent_id,
            destination_id="",
            payload={"agent_ids": agent_ids},
        )

        try:
            if self.connector:
                response = await self.connector.send_message(event)
                if response and hasattr(response, 'data'):
                    return {
                        "success": True,
                        "data": response.data
                    }
                return {"success": False, "error": "No response received"}
            else:
                return {"success": False, "error": "No connector available"}
        except Exception as e:
            logger.error(f"Error getting batch avatars: {e}")
            return {"success": False, "error": str(e)}

    def get_tools(self) -> List[AgentTool]:
        """Get the tools for the avatar adapter.

        Returns:
            List[AgentTool]: The tools for the avatar adapter
        """
        tools = []

        # Set avatar tool
        tools.append(
            AgentTool(
                name="set_avatar",
                description="Set the agent's avatar image from a file path or base64 data",
                parameters={
                    "type": "object",
                    "properties": {
                        "file_path": {
                            "type": "string",
                            "description": "Path to image file (optional, use either file_path or image_data)",
                        },
                        "image_data": {
                            "type": "string",
                            "description": "Base64-encoded image data (optional, use either file_path or image_data)",
                        },
                        "mime_type": {
                            "type": "string",
                            "description": "MIME type of the image (e.g., image/png, image/jpeg)",
                            "default": "image/png",
                        },
                    },
                },
                handler=self._handle_set_avatar_tool,
            )
        )

        # Get avatar tool
        tools.append(
            AgentTool(
                name="get_avatar",
                description="Get avatar information for an agent",
                parameters={
                    "type": "object",
                    "properties": {
                        "agent_id": {
                            "type": "string",
                            "description": "Agent ID to get avatar for",
                        },
                        "include_data": {
                            "type": "boolean",
                            "description": "Whether to include base64 image data",
                            "default": False,
                        },
                    },
                    "required": ["agent_id"],
                },
                handler=self._handle_get_avatar_tool,
            )
        )

        # Clear avatar tool
        tools.append(
            AgentTool(
                name="clear_avatar",
                description="Clear the agent's avatar",
                parameters={"type": "object", "properties": {}},
                handler=self._handle_clear_avatar_tool,
            )
        )

        return tools

    async def _handle_set_avatar_tool(
        self, parameters: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Handle set avatar tool execution.

        Args:
            parameters: Tool parameters

        Returns:
            Dict with result
        """
        file_path = parameters.get("file_path")
        image_data = parameters.get("image_data")
        mime_type = parameters.get("mime_type", "image/png")

        # If file path provided, read and encode
        if file_path and not image_data:
            try:
                with open(file_path, "rb") as f:
                    image_bytes = f.read()
                    image_data = base64.b64encode(image_bytes).decode()
            except Exception as e:
                return {"success": False, "error": f"Error reading file: {e}"}

        if not image_data:
            return {
                "success": False,
                "error": "Either file_path or image_data must be provided",
            }

        return await self.set_avatar(image_data, mime_type)

    async def _handle_get_avatar_tool(
        self, parameters: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Handle get avatar tool execution.

        Args:
            parameters: Tool parameters

        Returns:
            Dict with avatar info
        """
        agent_id = parameters.get("agent_id")
        include_data = parameters.get("include_data", False)

        if not agent_id:
            return {"success": False, "error": "agent_id is required"}

        return await self.get_avatar(agent_id, include_data)

    async def _handle_clear_avatar_tool(
        self, parameters: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Handle clear avatar tool execution.

        Args:
            parameters: Tool parameters

        Returns:
            Dict with result
        """
        return await self.clear_avatar()
