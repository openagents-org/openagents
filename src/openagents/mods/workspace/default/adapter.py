"""
Agent-level default workspace mod for OpenAgents.

This mod provides basic workspace functionality and integrates with
thread messaging for communication capabilities.
"""

import logging
from typing import Dict, Any, List, Optional, Callable

from openagents.core.base_mod_adapter import BaseModAdapter
from openagents.models.messages import Event, EventNames
from openagents.models.tool import AgentTool

logger = logging.getLogger(__name__)


class DefaultWorkspaceAgentAdapter(BaseModAdapter):
    """
    Agent adapter for the default workspace mod.

    This adapter provides basic workspace functionality and integrates
    with thread messaging capabilities for agent communication.
    """

    def __init__(self, agent_id: str, **kwargs):
        """Initialize the default workspace adapter."""
        super().__init__(agent_id, **kwargs)
        self.workspace_data: Dict[str, Any] = {}

    def get_tools(self) -> List[AgentTool]:
        """
        Get available tools for the default workspace.

        Returns:
            List of available tools (empty for now as requested)
        """
        # No tools for now as requested
        return []

    def handle_message(self, message: Event) -> Optional[Event]:
        """
        Handle incoming messages for the workspace.

        Args:
            message: The incoming mod message

        Returns:
            Optional response message
        """
        logger.info(
            f"Default workspace adapter received message: {message.message_type}"
        )

        # For now, just log the message
        # Future implementation will handle workspace-specific messages
        return None

    def cleanup(self):
        """Clean up workspace resources."""
        logger.info(f"Cleaning up default workspace adapter for agent {self.agent_id}")
        self.workspace_data.clear()
        super().cleanup()
