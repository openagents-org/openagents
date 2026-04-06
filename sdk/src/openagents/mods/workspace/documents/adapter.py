"""
Agent-level documents mod for OpenAgents.

This standalone mod provides simple document management with:
- Document creation and storage
- Document saving and content persistence
- Document renaming
- Document history tracking
"""

import logging
from typing import Dict, Any, List
from datetime import datetime

from openagents.core.base_mod_adapter import BaseModAdapter
from openagents.models.event import Event, EventVisibility
from openagents.models.tool import AgentTool
from .document_messages import (
    CreateDocumentMessage,
    SaveDocumentMessage,
    RenameDocumentMessage,
    GetDocumentMessage,
    GetDocumentHistoryMessage,
    ListDocumentsMessage,
    DocumentOperationResponse,
    DocumentGetResponse,
    DocumentListResponse,
    DocumentHistoryResponse,
)

logger = logging.getLogger(__name__)


class DocumentsAgentAdapter(BaseModAdapter):
    """Agent-level documents mod implementation.

    This standalone mod provides:
    - Document creation and storage
    - Document saving
    - Document renaming
    - Document history
    """

    def __init__(self):
        """Initialize the documents adapter for an agent."""
        super().__init__(mod_name="documents")

    def initialize(self) -> bool:
        """Initialize the adapter.

        Returns:
            bool: True if initialization was successful, False otherwise
        """
        logger.info(f"Initializing Documents adapter for agent {self.agent_id}")
        return True

    def shutdown(self) -> bool:
        """Shutdown the adapter.

        Returns:
            bool: True if shutdown was successful, False otherwise
        """
        logger.info(f"Shut down Documents adapter for agent {self.agent_id}")
        return True

    def get_tools(self) -> List[AgentTool]:
        """Get the list of tools provided by this adapter.

        Returns:
            List[AgentTool]: List of available tools
        """
        return [
            AgentTool(
                name="create_document",
                description="Create a new document",
                parameters={
                    "type": "object",
                    "properties": {
                        "document_name": {
                            "type": "string",
                            "description": "Name of the document",
                        },
                        "initial_content": {
                            "type": "string",
                            "description": "Initial content of the document",
                            "default": "",
                        },
                        "access_permissions": {
                            "type": "object",
                            "description": "Agent access permissions (agent_id -> permission_level)",
                            "default": {},
                        },
                    },
                    "required": ["document_name"],
                },
                func=self.create_document,
            ),
            AgentTool(
                name="save_document",
                description="Save document content",
                parameters={
                    "type": "object",
                    "properties": {
                        "document_id": {
                            "type": "string",
                            "description": "ID of the document to save",
                        },
                        "content": {
                            "type": "string",
                            "description": "Document content to save",
                        },
                    },
                    "required": ["document_id", "content"],
                },
                func=self.save_document,
            ),
            AgentTool(
                name="rename_document",
                description="Rename a document",
                parameters={
                    "type": "object",
                    "properties": {
                        "document_id": {
                            "type": "string",
                            "description": "ID of the document to rename",
                        },
                        "new_name": {
                            "type": "string",
                            "description": "New name for the document",
                        },
                    },
                    "required": ["document_id", "new_name"],
                },
                func=self.rename_document,
            ),
            AgentTool(
                name="get_document",
                description="Get document content",
                parameters={
                    "type": "object",
                    "properties": {
                        "document_id": {
                            "type": "string",
                            "description": "ID of the document",
                        }
                    },
                    "required": ["document_id"],
                },
                func=self.get_document,
            ),
            AgentTool(
                name="get_document_history",
                description="Get the operation history of a document",
                parameters={
                    "type": "object",
                    "properties": {
                        "document_id": {
                            "type": "string",
                            "description": "ID of the document",
                        },
                        "limit": {
                            "type": "integer",
                            "description": "Maximum number of operations to retrieve",
                            "default": 50,
                            "minimum": 1,
                            "maximum": 500,
                        },
                        "offset": {
                            "type": "integer",
                            "description": "Number of operations to skip",
                            "default": 0,
                            "minimum": 0,
                        },
                    },
                    "required": ["document_id"],
                },
                func=self.get_document_history,
            ),
            AgentTool(
                name="list_documents",
                description="List all available documents",
                parameters={
                    "type": "object",
                    "properties": {},
                    "required": [],
                },
                func=self.list_documents,
            ),
        ]

    # Tool implementation methods

    async def create_document(
        self,
        document_name: str,
        initial_content: str = "",
        access_permissions: Dict[str, str] = None,
    ) -> Dict[str, Any]:
        """Create a new document.

        Args:
            document_name: Name of the document
            initial_content: Initial content of the document
            access_permissions: Agent access permissions

        Returns:
            Dict containing operation result
        """
        try:
            if access_permissions is None:
                access_permissions = {}

            payload = {
                "document_name": document_name,
                "initial_content": initial_content,
                "access_permissions": access_permissions,
                "sender_id": self.agent_id,
            }

            # Send event to network
            return await self._send_event("document.create", payload)

        except Exception as e:
            logger.error(f"Failed to create document: {e}")
            return {"status": "error", "message": str(e)}

    async def save_document(self, document_id: str, content: str) -> Dict[str, Any]:
        """Save document content.

        Args:
            document_id: ID of the document to save
            content: Document content to save

        Returns:
            Dict containing operation result
        """
        try:
            payload = {
                "document_id": document_id,
                "content": content,
                "sender_id": self.agent_id,
            }

            # Send event to network
            return await self._send_event("document.save", payload)

        except Exception as e:
            logger.error(f"Failed to save document: {e}")
            return {"status": "error", "message": str(e)}

    async def rename_document(self, document_id: str, new_name: str) -> Dict[str, Any]:
        """Rename a document.

        Args:
            document_id: ID of the document to rename
            new_name: New name for the document

        Returns:
            Dict containing operation result
        """
        try:
            payload = {
                "document_id": document_id,
                "new_name": new_name,
                "sender_id": self.agent_id,
            }

            # Send event to network
            return await self._send_event("document.rename", payload)

        except Exception as e:
            logger.error(f"Failed to rename document: {e}")
            return {"status": "error", "message": str(e)}

    async def get_document(self, document_id: str) -> Dict[str, Any]:
        """Get document content.

        Args:
            document_id: ID of the document

        Returns:
            Dict containing operation result
        """
        try:
            payload = {"document_id": document_id, "sender_id": self.agent_id}

            # Send event to network
            return await self._send_event("document.get", payload)

        except Exception as e:
            logger.error(f"Failed to get document: {e}")
            return {"status": "error", "message": str(e)}

    async def get_document_history(
        self, document_id: str, limit: int = 50, offset: int = 0
    ) -> Dict[str, Any]:
        """Get the operation history of a document.

        Args:
            document_id: ID of the document
            limit: Maximum number of operations to retrieve
            offset: Number of operations to skip

        Returns:
            Dict containing operation result
        """
        try:
            payload = {
                "document_id": document_id,
                "limit": limit,
                "offset": offset,
                "sender_id": self.agent_id,
            }

            # Send event to network
            return await self._send_event("document.get_history", payload)

        except Exception as e:
            logger.error(f"Failed to get document history: {e}")
            return {"status": "error", "message": str(e)}

    async def list_documents(self) -> Dict[str, Any]:
        """List all available documents.

        Returns:
            Dict containing operation result
        """
        try:
            payload = {"sender_id": self.agent_id}

            # Send event to network
            return await self._send_event("document.list", payload)

        except Exception as e:
            logger.error(f"Failed to list documents: {e}")
            return {"status": "error", "message": str(e)}

    async def _send_event(
        self, event_name: str, payload: Dict[str, Any], destination_id: str = None
    ) -> Dict[str, Any]:
        """Send an event to the network using the new event system.

        Args:
            event_name: Name of the event
            payload: Event payload
            destination_id: Destination for the event (defaults to mod destination)

        Returns:
            Dict containing the response from the network
        """
        try:
            if destination_id is None:
                destination_id = f"mod:openagents.mods.workspace.documents"

            event = Event(
                event_name=event_name,
                source_id=f"agent:{self.agent_id}",
                destination_id=destination_id,
                payload=payload,
                visibility=EventVisibility.NETWORK,
            )

            response = await self.connector.send_event(event)

            if response and response.success:
                return {
                    "status": "success",
                    "data": response.data,
                    "message": response.message,
                }
            else:
                return {
                    "status": "error",
                    "message": response.message if response else "No response received",
                }

        except Exception as e:
            logger.error(f"Failed to send event {event_name}: {e}")
            return {"status": "error", "message": str(e)}
