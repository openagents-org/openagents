"""
Agent-level shared document mod for OpenAgents.

This standalone mod provides collaborative document editing with:
- Real-time document synchronization
- Line-based operations (insert, remove, replace)
- Line-specific commenting
- Agent presence tracking
- Conflict resolution
"""

import logging
import uuid
from typing import Dict, Any, List, Optional, Callable, Union
from datetime import datetime

from openagents.core.base_mod_adapter import BaseModAdapter
from openagents.models.messages import Event
from openagents.models.event import Event, EventVisibility
from openagents.models.tool import AgentAdapterTool
from .document_messages import (
    CreateDocumentMessage,
    OpenDocumentMessage,
    CloseDocumentMessage,
    InsertLinesMessage,
    RemoveLinesMessage,
    ReplaceLinesMessage,
    AddCommentMessage,
    RemoveCommentMessage,
    UpdateCursorPositionMessage,
    GetDocumentContentMessage,
    GetDocumentHistoryMessage,
    ListDocumentsMessage,
    GetAgentPresenceMessage,
    DocumentOperationResponse,
    DocumentContentResponse,
    DocumentListResponse,
    DocumentHistoryResponse,
    AgentPresenceResponse,
    CursorPosition,
    DocumentComment,
    AgentPresence,
    # OT Collaborative Editing Messages
    HistoryDocumentMessage,
    IdentityDocumentMessage,
    UserInfoMessage,
    UserCursorMessage,
    LanguageDocumentMessage,
    ErrorDocumentMessage,
    EditDocumentMessage,
    # OT Operation Types
    OTOperation,
    OTRetain,
    OTInsert,
    OTDelete,
    OTCompositeOperation,
    CursorInfo,
    SelectionInfo,
    UserInfo
)

logger = logging.getLogger(__name__)

# Type definitions for handlers
DocumentHandler = Callable[[Dict[str, Any]], None]
OperationHandler = Callable[[str, Dict[str, Any]], None]  # operation_type, operation_data
PresenceHandler = Callable[[str, List[Dict[str, Any]]], None]  # document_id, presence_list

class SharedDocumentAgentAdapter(BaseModAdapter):
    """Agent-level shared document mod implementation.
    
    This standalone mod provides:
    - Collaborative document editing
    - Real-time synchronization  
    - Line-based operations
    - Commenting system
    - Agent presence tracking
    """
    
    def __init__(self):
        """Initialize the shared document adapter for an agent."""
        super().__init__(
            mod_name="documents"
        )
        
        # Event handlers
        self.document_handlers: Dict[str, DocumentHandler] = {}
        self.operation_handlers: Dict[str, OperationHandler] = {}
        self.presence_handlers: Dict[str, PresenceHandler] = {}
        
        # Document state tracking
        self.open_documents: Dict[str, Dict[str, Any]] = {}  # document_id -> document_state
        self.pending_operations: Dict[str, Dict[str, Any]] = {}  # operation_id -> operation_metadata
        
        # OT Collaborative Editing State
        self.ot_documents: Dict[str, Dict[str, Any]] = {}  # document_id -> ot_state
        self.user_identity: Optional[Dict[str, Any]] = None  # Current user identity
        self.document_revisions: Dict[str, int] = {}  # document_id -> current_revision
        self.pending_edits: Dict[str, Dict[str, Any]] = {}  # edit_id -> edit_metadata
        
        # Presence tracking
        self.agent_cursors: Dict[str, CursorPosition] = {}  # document_id -> cursor_position
        
    def initialize(self) -> bool:
        """Initialize the adapter.
        
        Returns:
            bool: True if initialization was successful, False otherwise
        """
        logger.info(f"Initializing SharedDocument adapter for agent {self.agent_id}")
        return True
    
    def shutdown(self) -> bool:
        """Shutdown the adapter.
        
        Returns:
            bool: True if shutdown was successful, False otherwise
        """
        # Close all open documents
        for document_id in list(self.open_documents.keys()):
            try:
                self.close_document(document_id)
            except Exception as e:
                logger.error(f"Error closing document {document_id} during shutdown: {e}")
        
        logger.info(f"Shut down SharedDocument adapter for agent {self.agent_id}")
        return True
    
    def get_tools(self) -> List[AgentAdapterTool]:
        """Get the list of tools provided by this adapter.
        
        Returns:
            List[AgentAdapterTool]: List of available tools
        """
        return [
            AgentAdapterTool(
                name="create_document",
                description="Create a new shared document",
                parameters={
                    "type": "object",
                    "properties": {
                        "document_name": {
                            "type": "string",
                            "description": "Name of the document"
                        },
                        "initial_content": {
                            "type": "string",
                            "description": "Initial content of the document",
                            "default": ""
                        },
                        "access_permissions": {
                            "type": "object",
                            "description": "Agent access permissions (agent_id -> permission_level)",
                            "default": {}
                        }
                    },
                    "required": ["document_name"]
                },
                func=self.create_document
            ),
            AgentAdapterTool(
                name="open_document",
                description="Open an existing shared document",
                parameters={
                    "type": "object",
                    "properties": {
                        "document_id": {
                            "type": "string",
                            "description": "ID of the document to open"
                        }
                    },
                    "required": ["document_id"]
                },
                func=self.open_document
            ),
            AgentAdapterTool(
                name="close_document",
                description="Close a shared document",
                parameters={
                    "type": "object",
                    "properties": {
                        "document_id": {
                            "type": "string",
                            "description": "ID of the document to close"
                        }
                    },
                    "required": ["document_id"]
                },
                func=self.close_document
            ),
            AgentAdapterTool(
                name="insert_lines",
                description="Insert lines into a document at a specific position",
                parameters={
                    "type": "object",
                    "properties": {
                        "document_id": {
                            "type": "string",
                            "description": "ID of the document"
                        },
                        "line_number": {
                            "type": "integer",
                            "description": "Line number to insert at (1-based)",
                            "minimum": 1
                        },
                        "content": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Lines to insert"
                        }
                    },
                    "required": ["document_id", "line_number", "content"]
                },
                func=self.insert_lines
            ),
            AgentAdapterTool(
                name="remove_lines",
                description="Remove lines from a document",
                parameters={
                    "type": "object",
                    "properties": {
                        "document_id": {
                            "type": "string",
                            "description": "ID of the document"
                        },
                        "start_line": {
                            "type": "integer",
                            "description": "Start line number to remove (1-based)",
                            "minimum": 1
                        },
                        "end_line": {
                            "type": "integer",
                            "description": "End line number to remove (1-based, inclusive)",
                            "minimum": 1
                        }
                    },
                    "required": ["document_id", "start_line", "end_line"]
                },
                func=self.remove_lines
            ),
            AgentAdapterTool(
                name="replace_lines",
                description="Replace lines in a document with new content",
                parameters={
                    "type": "object",
                    "properties": {
                        "document_id": {
                            "type": "string",
                            "description": "ID of the document"
                        },
                        "start_line": {
                            "type": "integer",
                            "description": "Start line number to replace (1-based)",
                            "minimum": 1
                        },
                        "end_line": {
                            "type": "integer",
                            "description": "End line number to replace (1-based, inclusive)",
                            "minimum": 1
                        },
                        "content": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "New content lines"
                        }
                    },
                    "required": ["document_id", "start_line", "end_line", "content"]
                },
                func=self.replace_lines
            ),
            AgentAdapterTool(
                name="add_comment",
                description="Add a comment to a specific line in the document",
                parameters={
                    "type": "object",
                    "properties": {
                        "document_id": {
                            "type": "string",
                            "description": "ID of the document"
                        },
                        "line_number": {
                            "type": "integer",
                            "description": "Line number to comment on (1-based)",
                            "minimum": 1
                        },
                        "comment_text": {
                            "type": "string",
                            "description": "Comment content"
                        }
                    },
                    "required": ["document_id", "line_number", "comment_text"]
                },
                func=self.add_comment
            ),
            AgentAdapterTool(
                name="remove_comment",
                description="Remove a comment from the document",
                parameters={
                    "type": "object",
                    "properties": {
                        "document_id": {
                            "type": "string",
                            "description": "ID of the document"
                        },
                        "comment_id": {
                            "type": "string",
                            "description": "ID of the comment to remove"
                        }
                    },
                    "required": ["document_id", "comment_id"]
                },
                func=self.remove_comment
            ),
            AgentAdapterTool(
                name="update_cursor_position",
                description="Update the agent's cursor position in the document",
                parameters={
                    "type": "object",
                    "properties": {
                        "document_id": {
                            "type": "string",
                            "description": "ID of the document"
                        },
                        "line_number": {
                            "type": "integer",
                            "description": "Line number (1-based)",
                            "minimum": 1
                        },
                        "column_number": {
                            "type": "integer",
                            "description": "Column number (1-based)",
                            "minimum": 1,
                            "default": 1
                        }
                    },
                    "required": ["document_id", "line_number"]
                },
                func=self.update_cursor_position
            ),
            AgentAdapterTool(
                name="get_document_content",
                description="Get the current content of a document",
                parameters={
                    "type": "object",
                    "properties": {
                        "document_id": {
                            "type": "string",
                            "description": "ID of the document"
                        },
                        "include_comments": {
                            "type": "boolean",
                            "description": "Whether to include comments",
                            "default": True
                        },
                        "include_presence": {
                            "type": "boolean",
                            "description": "Whether to include agent presence",
                            "default": True
                        }
                    },
                    "required": ["document_id"]
                },
                func=self.get_document_content
            ),
            AgentAdapterTool(
                name="get_document_history",
                description="Get the operation history of a document",
                parameters={
                    "type": "object",
                    "properties": {
                        "document_id": {
                            "type": "string",
                            "description": "ID of the document"
                        },
                        "limit": {
                            "type": "integer",
                            "description": "Maximum number of operations to retrieve",
                            "default": 50,
                            "minimum": 1,
                            "maximum": 500
                        },
                        "offset": {
                            "type": "integer",
                            "description": "Number of operations to skip",
                            "default": 0,
                            "minimum": 0
                        }
                    },
                    "required": ["document_id"]
                },
                func=self.get_document_history
            ),
            AgentAdapterTool(
                name="list_documents",
                description="List all available documents",
                parameters={
                    "type": "object",
                    "properties": {
                        "include_closed": {
                            "type": "boolean",
                            "description": "Whether to include closed documents",
                            "default": False
                        }
                    },
                    "required": []
                },
                func=self.list_documents
            ),
            AgentAdapterTool(
                name="get_agent_presence",
                description="Get agent presence information for a document",
                parameters={
                    "type": "object",
                    "properties": {
                        "document_id": {
                            "type": "string",
                            "description": "ID of the document"
                        }
                    },
                    "required": ["document_id"]
                },
                func=self.get_agent_presence
            ),
            # OT Collaborative Editing Tools
            AgentAdapterTool(
                name="submit_edit_operation",
                description="Submit an OT edit operation for collaborative editing",
                parameters={
                    "type": "object",
                    "properties": {
                        "document_id": {
                            "type": "string",
                            "description": "ID of the document"
                        },
                        "revision": {
                            "type": "integer",
                            "description": "Document revision this operation is based on"
                        },
                        "operation": {
                            "type": "array",
                            "items": {
                                "oneOf": [
                                    {"type": "integer"},
                                    {"type": "string"}
                                ]
                            },
                            "description": "OT operation in simple format [retain, 'insert', -delete, ...]"
                        }
                    },
                    "required": ["document_id", "revision", "operation"]
                },
                func=self.submit_edit_operation
            ),
            AgentAdapterTool(
                name="request_document_history",
                description="Request complete operation history for a document",
                parameters={
                    "type": "object",
                    "properties": {
                        "document_id": {
                            "type": "string",
                            "description": "ID of the document"
                        }
                    },
                    "required": ["document_id"]
                },
                func=self.request_document_history
            ),
            AgentAdapterTool(
                name="request_user_identity",
                description="Request user identity assignment for collaborative editing",
                parameters={
                    "type": "object",
                    "properties": {},
                    "required": []
                },
                func=self.request_user_identity
            ),
            AgentAdapterTool(
                name="join_collaborative_session",
                description="Join a collaborative editing session for a document",
                parameters={
                    "type": "object",
                    "properties": {
                        "document_id": {
                            "type": "string",
                            "description": "ID of the document"
                        },
                        "user_name": {
                            "type": "string",
                            "description": "Display name for the user"
                        },
                        "user_color": {
                            "type": "string",
                            "description": "Color for cursor/selection display",
                            "default": "#000000"
                        }
                    },
                    "required": ["document_id", "user_name"]
                },
                func=self.join_collaborative_session
            ),
            AgentAdapterTool(
                name="leave_collaborative_session",
                description="Leave a collaborative editing session for a document",
                parameters={
                    "type": "object",
                    "properties": {
                        "document_id": {
                            "type": "string",
                            "description": "ID of the document"
                        }
                    },
                    "required": ["document_id"]
                },
                func=self.leave_collaborative_session
            ),
            AgentAdapterTool(
                name="update_cursor_position",
                description="Update cursor position and selection in collaborative editing",
                parameters={
                    "type": "object",
                    "properties": {
                        "document_id": {
                            "type": "string",
                            "description": "ID of the document"
                        },
                        "cursor_position": {
                            "type": "integer",
                            "description": "Cursor position in the document"
                        },
                        "selection_start": {
                            "type": "integer",
                            "description": "Selection start position (optional)"
                        },
                        "selection_end": {
                            "type": "integer",
                            "description": "Selection end position (optional)"
                        }
                    },
                    "required": ["document_id", "cursor_position"]
                },
                func=self.update_cursor_position_ot
            ),
            AgentAdapterTool(
                name="set_document_language",
                description="Set the programming language for syntax highlighting",
                parameters={
                    "type": "object",
                    "properties": {
                        "document_id": {
                            "type": "string",
                            "description": "ID of the document"
                        },
                        "language": {
                            "type": "string",
                            "description": "Programming language identifier (e.g., 'python', 'javascript', 'markdown')"
                        }
                    },
                    "required": ["document_id", "language"]
                },
                func=self.set_document_language
            )
        ]
    
    # Tool implementation methods
    
    async def create_document(self, document_name: str, initial_content: str = "", access_permissions: Dict[str, str] = None) -> Dict[str, Any]:
        """Create a new shared document.
        
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
                "sender_id": self.agent_id
            }
            
            # Send event to network
            return await self._send_event("document.create", payload)
            
        except Exception as e:
            logger.error(f"Failed to create document: {e}")
            return {
                "status": "error",
                "message": str(e)
            }
    
    async def open_document(self, document_id: str) -> Dict[str, Any]:
        """Open an existing shared document.
        
        Args:
            document_id: ID of the document to open
            
        Returns:
            Dict containing operation result
        """
        try:
            payload = {
                "document_id": document_id,
                "sender_id": self.agent_id
            }
            
            # Send event to network
            return await self._send_event("document.open", payload)
            
        except Exception as e:
            logger.error(f"Failed to open document: {e}")
            return {
                "status": "error",
                "message": str(e)
            }
    
    async def close_document(self, document_id: str) -> Dict[str, Any]:
        """Close a shared document.
        
        Args:
            document_id: ID of the document to close
            
        Returns:
            Dict containing operation result
        """
        try:
            payload = {
                "document_id": document_id,
                "sender_id": self.agent_id
            }
            
            # Send event to network
            result = await self._send_event("document.close", payload)
            
            # Remove from local tracking if successful
            if result.get("status") == "success":
                if document_id in self.open_documents:
                    del self.open_documents[document_id]
                
                if document_id in self.agent_cursors:
                    del self.agent_cursors[document_id]
            
            return result
            
        except Exception as e:
            logger.error(f"Failed to close document: {e}")
            return {
                "status": "error",
                "message": str(e)
            }
    
    async def insert_lines(self, document_id: str, line_number: int, content: List[str]) -> Dict[str, Any]:
        """Insert lines into a document.
        
        Args:
            document_id: ID of the document
            line_number: Line number to insert at (1-based)
            content: Lines to insert
            
        Returns:
            Dict containing operation result
        """
        try:
            payload = {
                "document_id": document_id,
                "line_number": line_number,
                "content": content,
                "sender_id": self.agent_id
            }
            
            # Send event to network
            return await self._send_event("document.insert_lines", payload)
            
        except Exception as e:
            logger.error(f"Failed to insert lines: {e}")
            return {
                "status": "error",
                "message": str(e)
            }
    
    async def remove_lines(self, document_id: str, start_line: int, end_line: int) -> Dict[str, Any]:
        """Remove lines from a document.
        
        Args:
            document_id: ID of the document
            start_line: Start line number (1-based)
            end_line: End line number (1-based, inclusive)
            
        Returns:
            Dict containing operation result
        """
        try:
            payload = {
                "document_id": document_id,
                "start_line": start_line,
                "end_line": end_line,
                "sender_id": self.agent_id
            }
            
            # Send event to network
            return await self._send_event("document.remove_lines", payload)
            
        except Exception as e:
            logger.error(f"Failed to remove lines: {e}")
            return {
                "status": "error",
                "message": str(e)
            }
    
    async def replace_lines(self, document_id: str, start_line: int, end_line: int, content: List[str]) -> Dict[str, Any]:
        """Replace lines in a document.
        
        Args:
            document_id: ID of the document
            start_line: Start line number (1-based)
            end_line: End line number (1-based, inclusive)
            content: New content lines
            
        Returns:
            Dict containing operation result
        """
        try:
            payload = {
                "document_id": document_id,
                "start_line": start_line,
                "end_line": end_line,
                "content": content,
                "sender_id": self.agent_id
            }
            
            # Send event to network
            return await self._send_event("document.replace_lines", payload)
            
        except Exception as e:
            logger.error(f"Failed to replace lines: {e}")
            return {
                "status": "error",
                "message": str(e)
            }
    
    async def add_comment(self, document_id: str, line_number: int, comment_text: str) -> Dict[str, Any]:
        """Add a comment to a line in the document.
        
        Args:
            document_id: ID of the document
            line_number: Line number to comment on (1-based)
            comment_text: Comment content
            
        Returns:
            Dict containing operation result
        """
        try:
            payload = {
                "document_id": document_id,
                "line_number": line_number,
                "comment_text": comment_text,
                "sender_id": self.agent_id
            }
            
            # Send event to network
            return await self._send_event("document.add_comment", payload)
            
        except Exception as e:
            logger.error(f"Failed to add comment: {e}")
            return {
                "status": "error",
                "message": str(e)
            }
    
    async def remove_comment(self, document_id: str, comment_id: str) -> Dict[str, Any]:
        """Remove a comment from the document.
        
        Args:
            document_id: ID of the document
            comment_id: ID of the comment to remove
            
        Returns:
            Dict containing operation result
        """
        try:
            payload = {
                "document_id": document_id,
                "comment_id": comment_id,
                "sender_id": self.agent_id
            }
            
            # Send event to network
            return await self._send_event("document.remove_comment", payload)
            
        except Exception as e:
            logger.error(f"Failed to remove comment: {e}")
            return {
                "status": "error",
                "message": str(e)
            }
    
    async def update_cursor_position(self, document_id: str, line_number: int, column_number: int = 1) -> Dict[str, Any]:
        """Update the agent's cursor position.
        
        Args:
            document_id: ID of the document
            line_number: Line number (1-based)
            column_number: Column number (1-based)
            
        Returns:
            Dict containing operation result
        """
        try:
            cursor_position = CursorPosition(
                line_number=line_number,
                column_number=column_number
            )
            
            payload = {
                "document_id": document_id,
                "cursor_position": {
                    "line_number": line_number,
                    "column_number": column_number
                },
                "sender_id": self.agent_id
            }
            
            # Update local tracking
            self.agent_cursors[document_id] = cursor_position
            
            # Send event to network
            return await self._send_event("document.update_cursor", payload)
            
        except Exception as e:
            logger.error(f"Failed to update cursor position: {e}")
            return {
                "status": "error",
                "message": str(e)
            }
    
    async def get_document_content(self, document_id: str, include_comments: bool = True, include_presence: bool = True) -> Dict[str, Any]:
        """Get the current content of a document.
        
        Args:
            document_id: ID of the document
            include_comments: Whether to include comments
            include_presence: Whether to include agent presence
            
        Returns:
            Dict containing operation result
        """
        try:
            payload = {
                "document_id": document_id,
                "include_comments": include_comments,
                "include_presence": include_presence,
                "sender_id": self.agent_id
            }
            
            # Send event to network
            return await self._send_event("document.get_content", payload)
            
        except Exception as e:
            logger.error(f"Failed to get document content: {e}")
            return {
                "status": "error",
                "message": str(e)
            }
    
    async def get_document_history(self, document_id: str, limit: int = 50, offset: int = 0) -> Dict[str, Any]:
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
                "sender_id": self.agent_id
            }
            
            # Send event to network
            return await self._send_event("document.get_history", payload)
            
        except Exception as e:
            logger.error(f"Failed to get document history: {e}")
            return {
                "status": "error",
                "message": str(e)
            }
    
    async def list_documents(self, include_closed: bool = False) -> Dict[str, Any]:
        """List all available documents.
        
        Args:
            include_closed: Whether to include closed documents
            
        Returns:
            Dict containing operation result
        """
        try:
            payload = {
                "include_closed": include_closed,
                "sender_id": self.agent_id
            }
            
            # Send event to network
            return await self._send_event("document.list", payload)
            
        except Exception as e:
            logger.error(f"Failed to list documents: {e}")
            return {
                "status": "error",
                "message": str(e)
            }
    
    async def get_agent_presence(self, document_id: str) -> Dict[str, Any]:
        """Get agent presence information for a document.
        
        Args:
            document_id: ID of the document
            
        Returns:
            Dict containing operation result
        """
        try:
            payload = {
                "document_id": document_id,
                "sender_id": self.agent_id
            }
            
            # Send event to network
            return await self._send_event("document.get_presence", payload)
            
        except Exception as e:
            logger.error(f"Failed to get agent presence: {e}")
            return {
                "status": "error",
                "message": str(e)
            }
    
    # Event handler registration methods
    
    def register_document_handler(self, handler_name: str, handler: DocumentHandler) -> None:
        """Register a handler for document events.
        
        Args:
            handler_name: Name of the handler
            handler: Handler function
        """
        self.document_handlers[handler_name] = handler
    
    def register_operation_handler(self, handler_name: str, handler: OperationHandler) -> None:
        """Register a handler for operation events.
        
        Args:
            handler_name: Name of the handler
            handler: Handler function
        """
        self.operation_handlers[handler_name] = handler
    
    def register_presence_handler(self, handler_name: str, handler: PresenceHandler) -> None:
        """Register a handler for presence events.
        
        Args:
            handler_name: Name of the handler
            handler: Handler function
        """
        self.presence_handlers[handler_name] = handler
    
    # Message processing
    
    async def process_incoming_message(self, message_data: Dict[str, Any], source_agent_id: str) -> None:
        """Process incoming messages from the network.
        
        Args:
            message_data: The message data
            source_agent_id: ID of the source agent
        """
        try:
            message_type = message_data.get("message_type")
            
            if message_type == "document_operation_response":
                await self._handle_operation_response(message_data)
            elif message_type == "document_content_response":
                await self._handle_document_content_response(message_data)
            elif message_type == "document_list_response":
                await self._handle_document_list_response(message_data)
            elif message_type == "document_history_response":
                await self._handle_document_history_response(message_data)
            elif message_type == "agent_presence_response":
                await self._handle_agent_presence_response(message_data)
            elif message_type in ["insert_lines", "remove_lines", "replace_lines", "add_comment", "remove_comment"]:
                await self._handle_operation_broadcast(message_data, source_agent_id)
            elif message_type == "update_cursor_position":
                await self._handle_presence_broadcast(message_data, source_agent_id)
            else:
                logger.warning(f"Unknown message type: {message_type}")
                
        except Exception as e:
            logger.error(f"Error processing incoming message: {e}")
    
    async def _handle_operation_response(self, message_data: Dict[str, Any]) -> None:
        """Handle operation response messages."""
        try:
            operation_id = message_data.get("operation_id")
            success = message_data.get("success", False)
            error_message = message_data.get("error_message")
            conflict_detected = message_data.get("conflict_detected", False)
            
            if operation_id in self.pending_operations:
                operation_info = self.pending_operations[operation_id]
                del self.pending_operations[operation_id]
                
                # Call registered handlers
                for handler in self.operation_handlers.values():
                    try:
                        handler("response", {
                            "operation_id": operation_id,
                            "operation_info": operation_info,
                            "success": success,
                            "error_message": error_message,
                            "conflict_detected": conflict_detected
                        })
                    except Exception as e:
                        logger.error(f"Error in operation handler: {e}")
            
        except Exception as e:
            logger.error(f"Error handling operation response: {e}")
    
    async def _handle_document_content_response(self, message_data: Dict[str, Any]) -> None:
        """Handle document content response messages."""
        try:
            document_id = message_data.get("document_id")
            content = message_data.get("content", [])
            comments = message_data.get("comments", [])
            agent_presence = message_data.get("agent_presence", [])
            version = message_data.get("version", 1)
            
            # Update local document state
            self.open_documents[document_id] = {
                "content": content,
                "comments": comments,
                "agent_presence": agent_presence,
                "version": version,
                "last_updated": datetime.now().isoformat()
            }
            
            # Call registered handlers
            for handler in self.document_handlers.values():
                try:
                    handler({
                        "event": "content_updated",
                        "document_id": document_id,
                        "content": content,
                        "comments": comments,
                        "agent_presence": agent_presence,
                        "version": version
                    })
                except Exception as e:
                    logger.error(f"Error in document handler: {e}")
            
        except Exception as e:
            logger.error(f"Error handling document content response: {e}")
    
    async def _handle_document_list_response(self, message_data: Dict[str, Any]) -> None:
        """Handle document list response messages."""
        try:
            documents = message_data.get("documents", [])
            
            # Call registered handlers
            for handler in self.document_handlers.values():
                try:
                    handler({
                        "event": "document_list",
                        "documents": documents
                    })
                except Exception as e:
                    logger.error(f"Error in document handler: {e}")
            
        except Exception as e:
            logger.error(f"Error handling document list response: {e}")
    
    async def _handle_document_history_response(self, message_data: Dict[str, Any]) -> None:
        """Handle document history response messages."""
        try:
            document_id = message_data.get("document_id")
            operations = message_data.get("operations", [])
            total_operations = message_data.get("total_operations", 0)
            
            # Call registered handlers
            for handler in self.document_handlers.values():
                try:
                    handler({
                        "event": "history_updated",
                        "document_id": document_id,
                        "operations": operations,
                        "total_operations": total_operations
                    })
                except Exception as e:
                    logger.error(f"Error in document handler: {e}")
            
        except Exception as e:
            logger.error(f"Error handling document history response: {e}")
    
    async def _handle_agent_presence_response(self, message_data: Dict[str, Any]) -> None:
        """Handle agent presence response messages."""
        try:
            document_id = message_data.get("document_id")
            agent_presence = message_data.get("agent_presence", [])
            
            # Call registered handlers
            for handler in self.presence_handlers.values():
                try:
                    handler(document_id, agent_presence)
                except Exception as e:
                    logger.error(f"Error in presence handler: {e}")
            
        except Exception as e:
            logger.error(f"Error handling agent presence response: {e}")
    
    async def _handle_operation_broadcast(self, message_data: Dict[str, Any], source_agent_id: str) -> None:
        """Handle operation broadcast messages from other agents."""
        try:
            operation_type = message_data.get("message_type")
            document_id = message_data.get("document_id")
            
            # Call registered handlers
            for handler in self.operation_handlers.values():
                try:
                    handler(operation_type, {
                        "document_id": document_id,
                        "source_agent_id": source_agent_id,
                        "operation_data": message_data
                    })
                except Exception as e:
                    logger.error(f"Error in operation handler: {e}")
            
        except Exception as e:
            logger.error(f"Error handling operation broadcast: {e}")
    
    async def _handle_presence_broadcast(self, message_data: Dict[str, Any], source_agent_id: str) -> None:
        """Handle presence broadcast messages from other agents."""
        try:
            document_id = message_data.get("document_id")
            cursor_position = message_data.get("cursor_position", {})
            
            # Call registered handlers
            for handler in self.presence_handlers.values():
                try:
                    handler(document_id, [{
                        "agent_id": source_agent_id,
                        "cursor_position": cursor_position,
                        "last_activity": datetime.now().isoformat(),
                        "is_active": True
                    }])
                except Exception as e:
                    logger.error(f"Error in presence handler: {e}")
            
        except Exception as e:
            logger.error(f"Error handling presence broadcast: {e}")
    
    async def _send_event(self, event_name: str, payload: Dict[str, Any], destination_id: str = None) -> Dict[str, Any]:
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
                visibility=EventVisibility.NETWORK
            )
            
            response = await self.connector.send_event(event)
            
            if response and response.success:
                return {
                    "status": "success",
                    "data": response.data,
                    "message": response.message
                }
            else:
                return {
                    "status": "error", 
                    "message": response.message if response else "No response received"
                }
            
        except Exception as e:
            logger.error(f"Failed to send event {event_name}: {e}")
            return {
                "status": "error",
                "message": str(e)
            }
    
    # OT Collaborative Editing Tool Implementation Methods
    
    async def submit_edit_operation(self, document_id: str, revision: int, operation: List[Union[int, str]]) -> Dict[str, Any]:
        """Submit an OT edit operation for collaborative editing.
        
        Args:
            document_id: ID of the document
            revision: Document revision this operation is based on
            operation: OT operation in simple format [retain, "insert", -delete, ...]
            
        Returns:
            Dict with operation result
        """
        try:
            if self.connector is None:
                return {
                    "status": "error",
                    "message": "Agent is not connected to network"
                }
            
            # Create edit message
            edit_message = EditMessage(
                source_id=self.agent_id,
                document_id=document_id,
                revision=revision,
                operation=operation,
                payload={
                    "document_id": document_id,
                    "revision": revision,
                    "operation": operation
                }
            )
            
            # Send to network
            await self.connector.send_mod_message(edit_message)
            
            # Track pending edit
            edit_id = edit_message.event_id
            self.pending_edits[edit_id] = {
                "document_id": document_id,
                "revision": revision,
                "operation": operation,
                "timestamp": datetime.now()
            }
            
            logger.info(f"Submitted edit operation for document {document_id} at revision {revision}")
            
            return {
                "status": "success",
                "message": "Edit operation submitted",
                "edit_id": edit_id
            }
            
        except Exception as e:
            logger.error(f"Failed to submit edit operation: {e}")
            return {
                "status": "error",
                "message": str(e)
            }
    
    async def request_document_history(self, document_id: str) -> Dict[str, Any]:
        """Request complete operation history for a document.
        
        Args:
            document_id: ID of the document
            
        Returns:
            Dict with request result
        """
        try:
            if self.connector is None:
                return {
                    "status": "error",
                    "message": "Agent is not connected to network"
                }
            
            # Create history request message
            history_message = HistoryMessage(
                source_id=self.agent_id,
                document_id=document_id,
                payload={
                    "document_id": document_id
                }
            )
            
            # Send to network
            await self.connector.send_mod_message(history_message)
            
            logger.info(f"Requested history for document {document_id}")
            
            return {
                "status": "success",
                "message": "History request sent"
            }
            
        except Exception as e:
            logger.error(f"Failed to request document history: {e}")
            return {
                "status": "error",
                "message": str(e)
            }
    
    async def request_user_identity(self) -> Dict[str, Any]:
        """Request user identity assignment for collaborative editing.
        
        Returns:
            Dict with request result
        """
        try:
            if self.connector is None:
                return {
                    "status": "error",
                    "message": "Agent is not connected to network"
                }
            
            # Create identity request message
            identity_message = IdentityMessage(
                source_id=self.agent_id,
                payload={}
            )
            
            # Send to network
            await self.connector.send_mod_message(identity_message)
            
            logger.info("Requested user identity assignment")
            
            return {
                "status": "success",
                "message": "Identity request sent"
            }
            
        except Exception as e:
            logger.error(f"Failed to request user identity: {e}")
            return {
                "status": "error",
                "message": str(e)
            }
    
    async def join_collaborative_session(self, document_id: str, user_name: str, user_color: str = "#000000") -> Dict[str, Any]:
        """Join a collaborative editing session for a document.
        
        Args:
            document_id: ID of the document
            user_name: Display name for the user
            user_color: Color for cursor/selection display
            
        Returns:
            Dict with join result
        """
        try:
            if self.connector is None:
                return {
                    "status": "error",
                    "message": "Agent is not connected to network"
                }
            
            # Create user info message for joining
            user_info = {
                "user_id": self.agent_id,
                "name": user_name,
                "color": user_color,
                "is_active": True
            }
            
            user_info_message = UserInfoMessage(
                source_id=self.agent_id,
                document_id=document_id,
                user_info=user_info,
                action="join",
                payload={
                    "document_id": document_id,
                    "user_info": user_info,
                    "action": "join"
                }
            )
            
            # Send to network
            await self.connector.send_mod_message(user_info_message)
            
            # Update local state
            if document_id not in self.ot_documents:
                self.ot_documents[document_id] = {}
            
            self.ot_documents[document_id]["user_info"] = user_info
            
            logger.info(f"Joined collaborative session for document {document_id} as {user_name}")
            
            return {
                "status": "success",
                "message": f"Joined collaborative session as {user_name}",
                "user_info": user_info
            }
            
        except Exception as e:
            logger.error(f"Failed to join collaborative session: {e}")
            return {
                "status": "error",
                "message": str(e)
            }
    
    async def leave_collaborative_session(self, document_id: str) -> Dict[str, Any]:
        """Leave a collaborative editing session for a document.
        
        Args:
            document_id: ID of the document
            
        Returns:
            Dict with leave result
        """
        try:
            if self.connector is None:
                return {
                    "status": "error",
                    "message": "Agent is not connected to network"
                }
            
            # Get current user info
            user_info = {}
            if document_id in self.ot_documents and "user_info" in self.ot_documents[document_id]:
                user_info = self.ot_documents[document_id]["user_info"]
            
            # Create user info message for leaving
            user_info_message = UserInfoMessage(
                source_id=self.agent_id,
                document_id=document_id,
                user_info=user_info,
                action="leave",
                payload={
                    "document_id": document_id,
                    "user_info": user_info,
                    "action": "leave"
                }
            )
            
            # Send to network
            await self.connector.send_mod_message(user_info_message)
            
            # Clean up local state
            if document_id in self.ot_documents:
                del self.ot_documents[document_id]
            
            logger.info(f"Left collaborative session for document {document_id}")
            
            return {
                "status": "success",
                "message": "Left collaborative session"
            }
            
        except Exception as e:
            logger.error(f"Failed to leave collaborative session: {e}")
            return {
                "status": "error",
                "message": str(e)
            }
    
    async def update_cursor_position_ot(self, document_id: str, cursor_position: int, selection_start: Optional[int] = None, selection_end: Optional[int] = None) -> Dict[str, Any]:
        """Update cursor position and selection in collaborative editing.
        
        Args:
            document_id: ID of the document
            cursor_position: Cursor position in the document
            selection_start: Selection start position (optional)
            selection_end: Selection end position (optional)
            
        Returns:
            Dict with update result
        """
        try:
            if self.connector is None:
                return {
                    "status": "error",
                    "message": "Agent is not connected to network"
                }
            
            # Prepare cursor data
            cursor_data = {
                "cursors": [cursor_position],
                "selections": []
            }
            
            # Add selection if provided
            if selection_start is not None and selection_end is not None:
                cursor_data["selections"] = [[selection_start, selection_end]]
            
            # Create cursor message
            cursor_message = UserCursorMessage(
                source_id=self.agent_id,
                document_id=document_id,
                cursor_data=cursor_data,
                payload={
                    "document_id": document_id,
                    "cursor_data": cursor_data
                }
            )
            
            # Send to network
            await self.connector.send_mod_message(cursor_message)
            
            logger.debug(f"Updated cursor position for document {document_id}: {cursor_position}")
            
            return {
                "status": "success",
                "message": "Cursor position updated",
                "cursor_data": cursor_data
            }
            
        except Exception as e:
            logger.error(f"Failed to update cursor position: {e}")
            return {
                "status": "error",
                "message": str(e)
            }
    
    async def set_document_language(self, document_id: str, language: str) -> Dict[str, Any]:
        """Set the programming language for syntax highlighting.
        
        Args:
            document_id: ID of the document
            language: Programming language identifier
            
        Returns:
            Dict with update result
        """
        try:
            if self.connector is None:
                return {
                    "status": "error",
                    "message": "Agent is not connected to network"
                }
            
            # Create language message
            language_message = LanguageMessage(
                source_id=self.agent_id,
                document_id=document_id,
                language=language,
                payload={
                    "document_id": document_id,
                    "language": language
                }
            )
            
            # Send to network
            await self.connector.send_mod_message(language_message)
            
            logger.info(f"Set language for document {document_id}: {language}")
            
            return {
                "status": "success",
                "message": f"Document language set to {language}",
                "language": language
            }
            
        except Exception as e:
            logger.error(f"Failed to set document language: {e}")
            return {
                "status": "error",
                "message": str(e)
            }
    
    # OT Event Processing Methods
    
    async def process_incoming_mod_message(self, message: Event) -> Optional[Event]:
        """Process incoming mod messages including OT collaborative editing events.
        
        Args:
            message: The mod message to process
            
        Returns:
            Optional[Event]: None if message was handled, message if not handled
        """
        try:
            event_name = message.event_name
            
            # Handle OT collaborative editing events
            if event_name == "document.history":
                await self._handle_history_message(message)
                return None
            elif event_name == "document.identity":
                await self._handle_identity_message(message)
                return None
            elif event_name == "document.user_info":
                await self._handle_user_info_message(message)
                return None
            elif event_name == "document.user_cursor":
                await self._handle_user_cursor_message(message)
                return None
            elif event_name == "document.language":
                await self._handle_language_message(message)
                return None
            elif event_name == "document.error":
                await self._handle_error_message(message)
                return None
            
            # Let parent class handle other messages
            return message
            
        except Exception as e:
            logger.error(f"Error processing incoming mod message: {e}")
            return message
    
    async def _handle_history_message(self, message: Event):
        """Handle incoming history messages."""
        try:
            payload = message.payload
            document_id = payload.get("document_id", "")
            
            # Extract history data from payload
            history_data = payload.get("History", {})
            start_revision = history_data.get("start", 0)
            operations = history_data.get("operations", [])
            current_content = payload.get("current_content", "")
            
            # Update local document state
            if document_id not in self.ot_documents:
                self.ot_documents[document_id] = {}
            
            self.ot_documents[document_id].update({
                "history": {
                    "start": start_revision,
                    "operations": operations
                },
                "content": current_content,
                "last_updated": datetime.now()
            })
            
            # Update revision tracking
            if operations:
                latest_operation = max(operations, key=lambda op: op.get("id", 0))
                self.document_revisions[document_id] = latest_operation.get("id", start_revision)
            else:
                self.document_revisions[document_id] = start_revision
            
            # Call registered handlers
            for handler in self.document_handlers.values():
                try:
                    handler({
                        "event": "history_received",
                        "document_id": document_id,
                        "history": history_data,
                        "content": current_content
                    })
                except Exception as e:
                    logger.error(f"Error in document handler: {e}")
            
            logger.info(f"Received history for document {document_id}: {len(operations)} operations")
            
        except Exception as e:
            logger.error(f"Error handling history message: {e}")
    
    async def _handle_identity_message(self, message: Event):
        """Handle incoming identity assignment messages."""
        try:
            payload = message.payload
            
            # Extract identity data from payload
            identity_data = payload.get("Identity", {})
            user_id = identity_data.get("user_id", "")
            color = identity_data.get("color", "#000000")
            
            # Update local identity
            self.user_identity = {
                "user_id": user_id,
                "color": color,
                "assigned_at": datetime.now()
            }
            
            # Call registered handlers
            for handler in self.document_handlers.values():
                try:
                    handler({
                        "event": "identity_assigned",
                        "user_id": user_id,
                        "color": color
                    })
                except Exception as e:
                    logger.error(f"Error in document handler: {e}")
            
            logger.info(f"Received identity assignment: {user_id} with color {color}")
            
        except Exception as e:
            logger.error(f"Error handling identity message: {e}")
    
    async def _handle_user_info_message(self, message: Event):
        """Handle incoming user info messages."""
        try:
            payload = message.payload
            document_id = payload.get("document_id", "")
            
            # Extract user info data from payload
            user_info_data = payload.get("UserInfo", {})
            action = user_info_data.get("action", "")
            user_info = user_info_data.get("user_info", {})
            
            # Call registered handlers
            for handler in self.document_handlers.values():
                try:
                    handler({
                        "event": "user_info_updated",
                        "document_id": document_id,
                        "action": action,
                        "user_info": user_info
                    })
                except Exception as e:
                    logger.error(f"Error in document handler: {e}")
            
            logger.debug(f"Received user info update for document {document_id}: {action}")
            
        except Exception as e:
            logger.error(f"Error handling user info message: {e}")
    
    async def _handle_user_cursor_message(self, message: Event):
        """Handle incoming user cursor messages."""
        try:
            payload = message.payload
            document_id = payload.get("document_id", "")
            
            # Extract cursor data from payload
            cursor_data = payload.get("CursorData", {})
            
            # Call registered handlers
            for handler in self.document_handlers.values():
                try:
                    handler({
                        "event": "cursor_updated",
                        "document_id": document_id,
                        "cursor_data": cursor_data
                    })
                except Exception as e:
                    logger.error(f"Error in document handler: {e}")
            
            logger.debug(f"Received cursor update for document {document_id}")
            
        except Exception as e:
            logger.error(f"Error handling user cursor message: {e}")
    
    async def _handle_language_message(self, message: Event):
        """Handle incoming language change messages."""
        try:
            payload = message.payload
            document_id = payload.get("document_id", "")
            
            # Extract language data from payload
            language_data = payload.get("Language", {})
            language = language_data.get("language", "")
            
            # Update local document state
            if document_id in self.ot_documents:
                self.ot_documents[document_id]["language"] = language
            
            # Call registered handlers
            for handler in self.document_handlers.values():
                try:
                    handler({
                        "event": "language_changed",
                        "document_id": document_id,
                        "language": language
                    })
                except Exception as e:
                    logger.error(f"Error in document handler: {e}")
            
            logger.info(f"Received language change for document {document_id}: {language}")
            
        except Exception as e:
            logger.error(f"Error handling language message: {e}")
    
    async def _handle_error_message(self, message: Event):
        """Handle incoming error messages."""
        try:
            payload = message.payload
            document_id = payload.get("document_id", "")
            
            # Extract error data from payload
            error_data = payload.get("Error", {})
            error_type = error_data.get("type", "")
            error_message = error_data.get("message", "")
            error_details = error_data.get("details", {})
            
            # Call registered handlers
            for handler in self.document_handlers.values():
                try:
                    handler({
                        "event": "error_occurred",
                        "document_id": document_id,
                        "error_type": error_type,
                        "error_message": error_message,
                        "error_details": error_details
                    })
                except Exception as e:
                    logger.error(f"Error in document handler: {e}")
            
            logger.warning(f"Received error for document {document_id}: {error_type} - {error_message}")
            
        except Exception as e:
            logger.error(f"Error handling error message: {e}")
