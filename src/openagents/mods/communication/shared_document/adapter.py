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
from openagents.models.messages import ModMessage
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
    AgentPresence
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
            mod_name="shared_document"
        )
        
        # Event handlers
        self.document_handlers: Dict[str, DocumentHandler] = {}
        self.operation_handlers: Dict[str, OperationHandler] = {}
        self.presence_handlers: Dict[str, PresenceHandler] = {}
        
        # Document state tracking
        self.open_documents: Dict[str, Dict[str, Any]] = {}  # document_id -> document_state
        self.pending_operations: Dict[str, Dict[str, Any]] = {}  # operation_id -> operation_metadata
        
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
            
            message = CreateDocumentMessage(
                document_name=document_name,
                initial_content=initial_content,
                access_permissions=access_permissions,
                sender_id=self.agent_id
            )
            
            # Send message to network
            await self._send_message(message)
            
            return {
                "status": "success",
                "message": f"Document creation request sent for '{document_name}'"
            }
            
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
            message = OpenDocumentMessage(
                document_id=document_id,
                sender_id=self.agent_id
            )
            
            # Send message to network
            await self._send_message(message)
            
            return {
                "status": "success",
                "message": f"Document open request sent for {document_id}"
            }
            
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
            message = CloseDocumentMessage(
                document_id=document_id,
                sender_id=self.agent_id
            )
            
            # Send message to network
            await self._send_message(message)
            
            # Remove from local tracking
            if document_id in self.open_documents:
                del self.open_documents[document_id]
            
            if document_id in self.agent_cursors:
                del self.agent_cursors[document_id]
            
            return {
                "status": "success",
                "message": f"Document close request sent for {document_id}"
            }
            
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
            message = InsertLinesMessage(
                document_id=document_id,
                line_number=line_number,
                content=content,
                sender_id=self.agent_id
            )
            
            # Send message to network
            await self._send_message(message)
            
            return {
                "status": "success",
                "message": f"Insert operation sent for {len(content)} lines at line {line_number}"
            }
            
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
            message = RemoveLinesMessage(
                document_id=document_id,
                start_line=start_line,
                end_line=end_line,
                sender_id=self.agent_id
            )
            
            # Send message to network
            await self._send_message(message)
            
            return {
                "status": "success",
                "message": f"Remove operation sent for lines {start_line}-{end_line}"
            }
            
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
            message = ReplaceLinesMessage(
                document_id=document_id,
                start_line=start_line,
                end_line=end_line,
                content=content,
                sender_id=self.agent_id
            )
            
            # Send message to network
            await self._send_message(message)
            
            return {
                "status": "success",
                "message": f"Replace operation sent for lines {start_line}-{end_line} with {len(content)} new lines"
            }
            
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
            message = AddCommentMessage(
                document_id=document_id,
                line_number=line_number,
                comment_text=comment_text,
                sender_id=self.agent_id
            )
            
            # Send message to network
            await self._send_message(message)
            
            return {
                "status": "success",
                "message": f"Comment added to line {line_number}"
            }
            
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
            message = RemoveCommentMessage(
                document_id=document_id,
                comment_id=comment_id,
                sender_id=self.agent_id
            )
            
            # Send message to network
            await self._send_message(message)
            
            return {
                "status": "success",
                "message": f"Comment removal request sent for {comment_id}"
            }
            
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
            
            message = UpdateCursorPositionMessage(
                document_id=document_id,
                cursor_position=cursor_position,
                sender_id=self.agent_id
            )
            
            # Update local tracking
            self.agent_cursors[document_id] = cursor_position
            
            # Send message to network
            await self._send_message(message)
            
            return {
                "status": "success",
                "message": f"Cursor position updated to line {line_number}, column {column_number}"
            }
            
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
            message = GetDocumentContentMessage(
                document_id=document_id,
                include_comments=include_comments,
                include_presence=include_presence,
                sender_id=self.agent_id
            )
            
            # Send message to network
            await self._send_message(message)
            
            return {
                "status": "success",
                "message": f"Document content request sent for {document_id}"
            }
            
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
            message = GetDocumentHistoryMessage(
                document_id=document_id,
                limit=limit,
                offset=offset,
                sender_id=self.agent_id
            )
            
            # Send message to network
            await self._send_message(message)
            
            return {
                "status": "success",
                "message": f"Document history request sent for {document_id}"
            }
            
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
            message = ListDocumentsMessage(
                include_closed=include_closed,
                sender_id=self.agent_id
            )
            
            # Send message to network
            await self._send_message(message)
            
            return {
                "status": "success",
                "message": "Document list request sent"
            }
            
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
            message = GetAgentPresenceMessage(
                document_id=document_id,
                sender_id=self.agent_id
            )
            
            # Send message to network
            await self._send_message(message)
            
            return {
                "status": "success",
                "message": f"Agent presence request sent for {document_id}"
            }
            
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
    
    async def _send_message(self, message: Any) -> None:
        """Send a message to the network.
        
        Args:
            message: The message to send
        """
        try:
            mod_message = ModMessage(
                mod="shared_document",
                content=message.model_dump(),
                sender_id=self.agent_id,
                relevant_agent_id=self.agent_id
            )
            
            await self.network_interface.send_mod_message(mod_message)
            
        except Exception as e:
            logger.error(f"Failed to send message: {e}")
            raise
