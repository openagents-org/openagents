"""
Agent-level Kanban adapter for OpenAgents.

This adapter provides tools for agents to interact with Kanban boards,
including board management, card operations, and column management.
"""

import logging
from typing import Any, Dict, List, Optional

from openagents.core.base_mod_adapter import BaseModAdapter
from openagents.models.event import Event
from openagents.models.tool import AgentTool

logger = logging.getLogger(__name__)


class KanbanAdapter(BaseModAdapter):
    """
    Agent adapter for the Kanban mod.

    This adapter provides tools for:
    - Creating and managing Kanban boards
    - Creating, updating, moving, and deleting cards
    - Managing columns on boards
    """

    def __init__(self):
        """Initialize the Kanban adapter."""
        super().__init__(mod_name="openagents.mods.coordination.kanban")
        logger.info("Initializing Kanban adapter")

    def get_tools(self) -> List[AgentTool]:
        """Get the tools provided by this adapter."""
        tools = []

        # ============ Board Tools ============

        tools.append(AgentTool(
            name="kanban_create_board",
            description="Create a new Kanban board with customizable columns",
            input_schema={
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Name of the board",
                    },
                    "description": {
                        "type": "string",
                        "description": "Description of the board",
                        "default": "",
                    },
                    "columns": {
                        "type": "array",
                        "description": "Custom columns (default: To Do, In Progress, Review, Done)",
                        "items": {
                            "type": "object",
                            "properties": {
                                "column_id": {"type": "string"},
                                "name": {"type": "string"},
                                "position": {"type": "integer"},
                                "wip_limit": {"type": "integer"},
                            },
                            "required": ["column_id", "name", "position"],
                        },
                    },
                    "project_id": {
                        "type": "string",
                        "description": "Optional project ID to link board to a project",
                    },
                    "allowed_agent_groups": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Agent groups allowed to access (empty = all)",
                        "default": [],
                    },
                },
                "required": ["name"],
            },
            func=self.create_board,
        ))

        tools.append(AgentTool(
            name="kanban_get_board",
            description="Get a Kanban board with all its cards",
            input_schema={
                "type": "object",
                "properties": {
                    "board_id": {
                        "type": "string",
                        "description": "ID of the board to retrieve",
                    },
                },
                "required": ["board_id"],
            },
            func=self.get_board,
        ))

        tools.append(AgentTool(
            name="kanban_list_boards",
            description="List all accessible Kanban boards",
            input_schema={
                "type": "object",
                "properties": {
                    "project_id": {
                        "type": "string",
                        "description": "Optional project ID to filter boards",
                    },
                },
                "required": [],
            },
            func=self.list_boards,
        ))

        # ============ Card Tools ============

        tools.append(AgentTool(
            name="kanban_create_card",
            description="Create a new card on a Kanban board",
            input_schema={
                "type": "object",
                "properties": {
                    "board_id": {
                        "type": "string",
                        "description": "ID of the board to add card to",
                    },
                    "title": {
                        "type": "string",
                        "description": "Title of the card",
                    },
                    "description": {
                        "type": "string",
                        "description": "Description of the card",
                        "default": "",
                    },
                    "column_id": {
                        "type": "string",
                        "description": "Column to place card in (default: first column)",
                    },
                    "assignee_id": {
                        "type": "string",
                        "description": "Agent ID to assign the card to",
                    },
                    "labels": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Labels/tags for the card",
                        "default": [],
                    },
                    "priority": {
                        "type": "string",
                        "enum": ["low", "medium", "high", "urgent"],
                        "description": "Priority level",
                        "default": "medium",
                    },
                    "metadata": {
                        "type": "object",
                        "description": "Additional metadata for the card",
                        "default": {},
                    },
                },
                "required": ["board_id", "title"],
            },
            func=self.create_card,
        ))

        tools.append(AgentTool(
            name="kanban_update_card",
            description="Update an existing card's details",
            input_schema={
                "type": "object",
                "properties": {
                    "card_id": {
                        "type": "string",
                        "description": "ID of the card to update",
                    },
                    "title": {
                        "type": "string",
                        "description": "New title",
                    },
                    "description": {
                        "type": "string",
                        "description": "New description",
                    },
                    "assignee_id": {
                        "type": "string",
                        "description": "New assignee agent ID",
                    },
                    "labels": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "New labels",
                    },
                    "priority": {
                        "type": "string",
                        "enum": ["low", "medium", "high", "urgent"],
                        "description": "New priority",
                    },
                    "metadata": {
                        "type": "object",
                        "description": "Additional metadata to merge",
                    },
                },
                "required": ["card_id"],
            },
            func=self.update_card,
        ))

        tools.append(AgentTool(
            name="kanban_move_card",
            description="Move a card to a different column (e.g., from 'To Do' to 'In Progress')",
            input_schema={
                "type": "object",
                "properties": {
                    "card_id": {
                        "type": "string",
                        "description": "ID of the card to move",
                    },
                    "column_id": {
                        "type": "string",
                        "description": "Target column ID to move the card to",
                    },
                    "position": {
                        "type": "integer",
                        "description": "Position within the column (optional, default: end)",
                    },
                },
                "required": ["card_id", "column_id"],
            },
            func=self.move_card,
        ))

        tools.append(AgentTool(
            name="kanban_delete_card",
            description="Delete a card from the board",
            input_schema={
                "type": "object",
                "properties": {
                    "card_id": {
                        "type": "string",
                        "description": "ID of the card to delete",
                    },
                },
                "required": ["card_id"],
            },
            func=self.delete_card,
        ))

        tools.append(AgentTool(
            name="kanban_list_cards",
            description="List cards on a board, optionally filtered by column or assignee",
            input_schema={
                "type": "object",
                "properties": {
                    "board_id": {
                        "type": "string",
                        "description": "ID of the board",
                    },
                    "column_id": {
                        "type": "string",
                        "description": "Filter by column ID",
                    },
                    "assignee_id": {
                        "type": "string",
                        "description": "Filter by assignee agent ID",
                    },
                },
                "required": ["board_id"],
            },
            func=self.list_cards,
        ))

        # ============ Column Tools ============

        tools.append(AgentTool(
            name="kanban_add_column",
            description="Add a new column to a board",
            input_schema={
                "type": "object",
                "properties": {
                    "board_id": {
                        "type": "string",
                        "description": "ID of the board",
                    },
                    "name": {
                        "type": "string",
                        "description": "Name of the new column",
                    },
                    "column_id": {
                        "type": "string",
                        "description": "Optional custom ID for the column",
                    },
                    "position": {
                        "type": "integer",
                        "description": "Position in the board (optional, default: end)",
                    },
                    "wip_limit": {
                        "type": "integer",
                        "description": "Work-in-progress limit for the column",
                    },
                },
                "required": ["board_id", "name"],
            },
            func=self.add_column,
        ))

        return tools

    async def _send_event(self, event_name: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Send an event to the Kanban mod and return the response."""
        if self.agent_client is None:
            logger.error(f"Cannot send {event_name}: agent_client not available")
            return {"success": False, "error": "Agent client not available"}

        event = Event(
            event_name=event_name,
            source_id=self.agent_id,
            payload=payload,
            relevant_mod="openagents.mods.coordination.kanban",
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

    # ============ Board Methods ============

    async def create_board(
        self,
        name: str,
        description: str = "",
        columns: Optional[List[Dict[str, Any]]] = None,
        project_id: Optional[str] = None,
        allowed_agent_groups: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """Create a new Kanban board."""
        payload = {
            "name": name,
            "description": description,
        }
        if columns:
            payload["columns"] = columns
        if project_id:
            payload["project_id"] = project_id
        if allowed_agent_groups:
            payload["allowed_agent_groups"] = allowed_agent_groups

        return await self._send_event("kanban.board.create", payload)

    async def get_board(self, board_id: str) -> Dict[str, Any]:
        """Get a Kanban board with all its cards."""
        return await self._send_event("kanban.board.get", {"board_id": board_id})

    async def list_boards(self, project_id: Optional[str] = None) -> Dict[str, Any]:
        """List all accessible Kanban boards."""
        payload = {}
        if project_id:
            payload["project_id"] = project_id
        return await self._send_event("kanban.board.list", payload)

    # ============ Card Methods ============

    async def create_card(
        self,
        board_id: str,
        title: str,
        description: str = "",
        column_id: Optional[str] = None,
        assignee_id: Optional[str] = None,
        labels: Optional[List[str]] = None,
        priority: str = "medium",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Create a new card on a board."""
        payload = {
            "board_id": board_id,
            "title": title,
            "description": description,
            "priority": priority,
        }
        if column_id:
            payload["column_id"] = column_id
        if assignee_id:
            payload["assignee_id"] = assignee_id
        if labels:
            payload["labels"] = labels
        if metadata:
            payload["metadata"] = metadata

        return await self._send_event("kanban.card.create", payload)

    async def update_card(
        self,
        card_id: str,
        title: Optional[str] = None,
        description: Optional[str] = None,
        assignee_id: Optional[str] = None,
        labels: Optional[List[str]] = None,
        priority: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Update an existing card."""
        payload = {"card_id": card_id}
        if title is not None:
            payload["title"] = title
        if description is not None:
            payload["description"] = description
        if assignee_id is not None:
            payload["assignee_id"] = assignee_id
        if labels is not None:
            payload["labels"] = labels
        if priority is not None:
            payload["priority"] = priority
        if metadata is not None:
            payload["metadata"] = metadata

        return await self._send_event("kanban.card.update", payload)

    async def move_card(
        self,
        card_id: str,
        column_id: str,
        position: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Move a card to a different column."""
        payload = {
            "card_id": card_id,
            "column_id": column_id,
        }
        if position is not None:
            payload["position"] = position

        return await self._send_event("kanban.card.move", payload)

    async def delete_card(self, card_id: str) -> Dict[str, Any]:
        """Delete a card from the board."""
        return await self._send_event("kanban.card.delete", {"card_id": card_id})

    async def list_cards(
        self,
        board_id: str,
        column_id: Optional[str] = None,
        assignee_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """List cards on a board."""
        payload = {"board_id": board_id}
        if column_id:
            payload["column_id"] = column_id
        if assignee_id:
            payload["assignee_id"] = assignee_id

        return await self._send_event("kanban.card.list", payload)

    # ============ Column Methods ============

    async def add_column(
        self,
        board_id: str,
        name: str,
        column_id: Optional[str] = None,
        position: Optional[int] = None,
        wip_limit: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Add a new column to a board."""
        payload = {
            "board_id": board_id,
            "name": name,
        }
        if column_id:
            payload["column_id"] = column_id
        if position is not None:
            payload["position"] = position
        if wip_limit is not None:
            payload["wip_limit"] = wip_limit

        return await self._send_event("kanban.column.add", payload)

    async def process_incoming_event(self, event: Event) -> Optional[Event]:
        """Process incoming Kanban notification events."""
        if event.event_name.startswith("kanban.notification."):
            logger.info(f"Received Kanban notification: {event.event_name}")
            logger.debug(f"Notification payload: {event.payload}")

        return event

    def shutdown(self) -> bool:
        """Shutdown the adapter gracefully."""
        logger.info("Shutting down Kanban adapter")
        return super().shutdown()
