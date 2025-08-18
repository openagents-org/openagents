"""
Network-level shared document mod for OpenAgents.

This standalone mod enables collaborative document editing with:
- Real-time document synchronization
- Line-based operations (insert, remove, replace)
- Line-specific commenting
- Agent presence tracking
- Conflict resolution
"""

import logging
import uuid
import copy
from typing import Dict, Any, List, Optional, Set
from datetime import datetime, timedelta

from openagents.core.base_mod import BaseMod
from openagents.models.messages import BaseMessage, ModMessage
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
    DocumentOperation,
    DocumentComment,
    AgentPresence,
    CursorPosition,
    LineRange
)

logger = logging.getLogger(__name__)

class SharedDocument:
    """Represents a shared document with version control and collaboration features."""
    
    def __init__(self, document_id: str, name: str, creator_agent_id: str, initial_content: str = ""):
        """Initialize a shared document."""
        self.document_id = document_id
        self.name = name
        self.creator_agent_id = creator_agent_id
        self.created_timestamp = datetime.now()
        self.last_modified = datetime.now()
        self.version = 1
        
        # Document content (list of lines)
        self.content: List[str] = initial_content.split('\n') if initial_content else [""]
        
        # Document metadata
        self.comments: Dict[int, List[DocumentComment]] = {}  # line_number -> [comments]
        self.agent_presence: Dict[str, AgentPresence] = {}  # agent_id -> presence
        self.access_permissions: Dict[str, str] = {}  # agent_id -> permission level
        self.operation_history: List[DocumentOperation] = []
        
        # Active agents
        self.active_agents: Set[str] = set()
        
        # Conflict tracking
        self.pending_operations: Dict[str, DocumentOperation] = {}
    
    def add_agent(self, agent_id: str, permission: str = "read_write") -> bool:
        """Add an agent to the document with specified permissions."""
        self.access_permissions[agent_id] = permission
        self.active_agents.add(agent_id)
        
        # Initialize agent presence
        self.agent_presence[agent_id] = AgentPresence(
            agent_id=agent_id,
            cursor_position=CursorPosition(line_number=1, column_number=1),
            last_activity=datetime.now(),
            is_active=True
        )
        
        return True
    
    def remove_agent(self, agent_id: str) -> bool:
        """Remove an agent from the document."""
        if agent_id in self.active_agents:
            self.active_agents.remove(agent_id)
        
        if agent_id in self.agent_presence:
            self.agent_presence[agent_id].is_active = False
        
        return True
    
    def has_permission(self, agent_id: str, operation: str) -> bool:
        """Check if agent has permission for the operation."""
        if agent_id not in self.access_permissions:
            return False
        
        permission = self.access_permissions[agent_id]
        
        if permission == "read_only":
            return operation in ["read", "comment"]
        elif permission == "read_write":
            return True
        elif permission == "admin":
            return True
        
        return False
    
    def update_agent_presence(self, agent_id: str, cursor_position: Optional[CursorPosition] = None) -> bool:
        """Update an agent's presence information."""
        if agent_id not in self.agent_presence:
            self.agent_presence[agent_id] = AgentPresence(agent_id=agent_id)
        
        presence = self.agent_presence[agent_id]
        presence.last_activity = datetime.now()
        presence.is_active = True
        
        if cursor_position:
            presence.cursor_position = cursor_position
        
        return True
    
    def insert_lines(self, agent_id: str, line_number: int, content: List[str]) -> DocumentOperation:
        """Insert lines at the specified position."""
        operation = DocumentOperation(
            document_id=self.document_id,
            agent_id=agent_id,
            operation_type="insert_lines"
        )
        
        try:
            # Validate line number
            if line_number < 1 or line_number > len(self.content) + 1:
                raise ValueError(f"Invalid line number: {line_number}")
            
            # Insert lines (convert to 0-based index)
            insert_index = line_number - 1
            for i, line in enumerate(content):
                self.content.insert(insert_index + i, line)
            
            # Update version and metadata
            self.version += 1
            self.last_modified = datetime.now()
            self.operation_history.append(operation)
            self.update_agent_presence(agent_id)
            
            # Update line numbers for comments after the insertion point
            self._shift_comments_after_line(line_number - 1, len(content))
            
            return operation
            
        except Exception as e:
            logger.error(f"Failed to insert lines: {e}")
            raise
    
    def remove_lines(self, agent_id: str, start_line: int, end_line: int) -> DocumentOperation:
        """Remove lines in the specified range."""
        operation = DocumentOperation(
            document_id=self.document_id,
            agent_id=agent_id,
            operation_type="remove_lines"
        )
        
        try:
            # Validate line range
            if start_line < 1 or end_line < 1 or start_line > end_line:
                raise ValueError(f"Invalid line range: {start_line}-{end_line}")
            
            if start_line > len(self.content) or end_line > len(self.content):
                raise ValueError(f"Line range exceeds document length: {len(self.content)}")
            
            # Remove lines (convert to 0-based indices)
            start_index = start_line - 1
            end_index = end_line - 1
            
            # Remove comments in the range being deleted
            for line_num in range(start_line, end_line + 1):
                if line_num in self.comments:
                    del self.comments[line_num]
            
            # Remove the lines
            del self.content[start_index:end_index + 1]
            
            # If we removed all lines, add an empty line
            if not self.content:
                self.content = [""]
            
            # Update version and metadata
            self.version += 1
            self.last_modified = datetime.now()
            self.operation_history.append(operation)
            self.update_agent_presence(agent_id)
            
            # Shift comments after the removed range
            lines_removed = end_line - start_line + 1
            self._shift_comments_after_line(end_line, -lines_removed)
            
            return operation
            
        except Exception as e:
            logger.error(f"Failed to remove lines: {e}")
            raise
    
    def replace_lines(self, agent_id: str, start_line: int, end_line: int, content: List[str]) -> DocumentOperation:
        """Replace lines in the specified range with new content."""
        operation = DocumentOperation(
            document_id=self.document_id,
            agent_id=agent_id,
            operation_type="replace_lines"
        )
        
        try:
            # Validate line range
            if start_line < 1 or end_line < 1 or start_line > end_line:
                raise ValueError(f"Invalid line range: {start_line}-{end_line}")
            
            if start_line > len(self.content) or end_line > len(self.content):
                raise ValueError(f"Line range exceeds document length: {len(self.content)}")
            
            # Remove comments in the range being replaced
            for line_num in range(start_line, end_line + 1):
                if line_num in self.comments:
                    del self.comments[line_num]
            
            # Replace lines (convert to 0-based indices)
            start_index = start_line - 1
            end_index = end_line - 1
            
            # Replace the content
            self.content[start_index:end_index + 1] = content
            
            # Update version and metadata
            self.version += 1
            self.last_modified = datetime.now()
            self.operation_history.append(operation)
            self.update_agent_presence(agent_id)
            
            # Adjust comments after the replaced range
            lines_removed = end_line - start_line + 1
            lines_added = len(content)
            net_change = lines_added - lines_removed
            
            if net_change != 0:
                self._shift_comments_after_line(end_line, net_change)
            
            return operation
            
        except Exception as e:
            logger.error(f"Failed to replace lines: {e}")
            raise
    
    def add_comment(self, agent_id: str, line_number: int, comment_text: str) -> DocumentComment:
        """Add a comment to the specified line."""
        try:
            # Validate line number
            if line_number < 1 or line_number > len(self.content):
                raise ValueError(f"Invalid line number: {line_number}")
            
            # Create comment
            comment = DocumentComment(
                line_number=line_number,
                agent_id=agent_id,
                comment_text=comment_text
            )
            
            # Add to comments
            if line_number not in self.comments:
                self.comments[line_number] = []
            
            self.comments[line_number].append(comment)
            
            # Update metadata
            self.last_modified = datetime.now()
            self.update_agent_presence(agent_id)
            
            return comment
            
        except Exception as e:
            logger.error(f"Failed to add comment: {e}")
            raise
    
    def remove_comment(self, agent_id: str, comment_id: str) -> bool:
        """Remove a comment by ID."""
        try:
            # Find and remove the comment
            for line_number, comments in self.comments.items():
                for i, comment in enumerate(comments):
                    if comment.comment_id == comment_id:
                        # Check if agent can remove this comment
                        if comment.agent_id != agent_id and not self.has_permission(agent_id, "admin"):
                            raise ValueError("Agent can only remove their own comments")
                        
                        comments.pop(i)
                        
                        # Remove empty comment lists
                        if not comments:
                            del self.comments[line_number]
                        
                        self.last_modified = datetime.now()
                        self.update_agent_presence(agent_id)
                        return True
            
            raise ValueError(f"Comment not found: {comment_id}")
            
        except Exception as e:
            logger.error(f"Failed to remove comment: {e}")
            raise
    
    def _shift_comments_after_line(self, line_number: int, shift: int) -> None:
        """Shift comment line numbers after a specific line."""
        if shift == 0:
            return
        
        # Create a new comments dict with shifted line numbers
        new_comments = {}
        
        for line_num, comments in self.comments.items():
            if line_num <= line_number:
                # Comments before/at the shift point stay the same
                new_comments[line_num] = comments
            else:
                # Comments after the shift point get moved
                new_line_num = line_num + shift
                if new_line_num > 0:  # Only keep comments with positive line numbers
                    new_comments[new_line_num] = comments
                    # Update the line number in each comment
                    for comment in comments:
                        comment.line_number = new_line_num
        
        self.comments = new_comments
    
    def get_document_state(self) -> Dict[str, Any]:
        """Get the current state of the document."""
        return {
            "document_id": self.document_id,
            "name": self.name,
            "version": self.version,
            "content": self.content.copy(),
            "comments": {
                line_num: [comment.model_dump() for comment in comments]
                for line_num, comments in self.comments.items()
            },
            "agent_presence": {
                agent_id: presence.model_dump()
                for agent_id, presence in self.agent_presence.items()
            },
            "last_modified": self.last_modified.isoformat(),
            "active_agents": list(self.active_agents)
        }

class SharedDocumentNetworkMod(BaseMod):
    """Network-level shared document mod implementation.
    
    This standalone mod enables:
    - Collaborative document editing
    - Real-time synchronization
    - Line-based operations
    - Commenting system
    - Agent presence tracking
    """
    
    def __init__(self):
        """Initialize the shared document mod."""
        super().__init__(mod_name="shared_document")
        
        # Document storage
        self.documents: Dict[str, SharedDocument] = {}
        
        # Agent session tracking
        self.agent_sessions: Dict[str, Set[str]] = {}  # agent_id -> {document_ids}
        
        # Operation sequencing
        self.operation_sequence: int = 0
        
        # Cleanup tracking
        self.last_cleanup = datetime.now()
        self.cleanup_interval = timedelta(minutes=30)
    
    def initialize(self) -> bool:
        """Initialize the mod."""
        logger.info("Initializing SharedDocument network mod")
        return True
    
    def shutdown(self) -> bool:
        """Shutdown the mod."""
        logger.info("Shutting down SharedDocument network mod")
        return True
    
    async def process_message(self, message: BaseMessage, source_agent_id: str) -> None:
        """Process incoming messages."""
        try:
            if isinstance(message, CreateDocumentMessage):
                await self._handle_create_document(message, source_agent_id)
            elif isinstance(message, OpenDocumentMessage):
                await self._handle_open_document(message, source_agent_id)
            elif isinstance(message, CloseDocumentMessage):
                await self._handle_close_document(message, source_agent_id)
            elif isinstance(message, InsertLinesMessage):
                await self._handle_insert_lines(message, source_agent_id)
            elif isinstance(message, RemoveLinesMessage):
                await self._handle_remove_lines(message, source_agent_id)
            elif isinstance(message, ReplaceLinesMessage):
                await self._handle_replace_lines(message, source_agent_id)
            elif isinstance(message, AddCommentMessage):
                await self._handle_add_comment(message, source_agent_id)
            elif isinstance(message, RemoveCommentMessage):
                await self._handle_remove_comment(message, source_agent_id)
            elif isinstance(message, UpdateCursorPositionMessage):
                await self._handle_update_cursor_position(message, source_agent_id)
            elif isinstance(message, GetDocumentContentMessage):
                await self._handle_get_document_content(message, source_agent_id)
            elif isinstance(message, GetDocumentHistoryMessage):
                await self._handle_get_document_history(message, source_agent_id)
            elif isinstance(message, ListDocumentsMessage):
                await self._handle_list_documents(message, source_agent_id)
            elif isinstance(message, GetAgentPresenceMessage):
                await self._handle_get_agent_presence(message, source_agent_id)
            else:
                logger.warning(f"Unknown message type: {type(message)}")
                
        except Exception as e:
            logger.error(f"Error processing message from {source_agent_id}: {e}")
            await self._send_error_response(source_agent_id, str(e))
    
    async def _handle_create_document(self, message: CreateDocumentMessage, source_agent_id: str) -> None:
        """Handle document creation."""
        try:
            document_id = str(uuid.uuid4())
            
            # Create the document
            document = SharedDocument(
                document_id=document_id,
                name=message.document_name,
                creator_agent_id=source_agent_id,
                initial_content=message.initial_content or ""
            )
            
            # Set permissions
            document.access_permissions = message.access_permissions.copy()
            document.access_permissions[source_agent_id] = "admin"  # Creator gets admin rights
            
            # Add creator as active agent
            document.add_agent(source_agent_id, "admin")
            
            # Store the document
            self.documents[document_id] = document
            
            # Track agent session
            if source_agent_id not in self.agent_sessions:
                self.agent_sessions[source_agent_id] = set()
            self.agent_sessions[source_agent_id].add(document_id)
            
            # Send success response
            response = DocumentOperationResponse(
                operation_id=document_id,
                success=True,
                sender_id=self.network.node_id
            )
            
            await self._send_response(source_agent_id, response)
            
            logger.info(f"Created document {document_id} by agent {source_agent_id}")
            
        except Exception as e:
            logger.error(f"Failed to create document: {e}")
            await self._send_error_response(source_agent_id, str(e))
    
    async def _handle_open_document(self, message: OpenDocumentMessage, source_agent_id: str) -> None:
        """Handle document opening."""
        try:
            document_id = message.document_id
            
            if document_id not in self.documents:
                raise ValueError(f"Document not found: {document_id}")
            
            document = self.documents[document_id]
            
            # Check permissions
            if not document.has_permission(source_agent_id, "read"):
                raise ValueError("Agent does not have permission to access this document")
            
            # Add agent to document
            permission = document.access_permissions.get(source_agent_id, "read_only")
            document.add_agent(source_agent_id, permission)
            
            # Track agent session
            if source_agent_id not in self.agent_sessions:
                self.agent_sessions[source_agent_id] = set()
            self.agent_sessions[source_agent_id].add(document_id)
            
            # Send document content
            response = DocumentContentResponse(
                document_id=document_id,
                content=document.content.copy(),
                comments=[
                    comment for comments in document.comments.values()
                    for comment in comments
                ],
                agent_presence=list(document.agent_presence.values()),
                version=document.version,
                sender_id=self.network.node_id
            )
            
            await self._send_response(source_agent_id, response)
            
            # Notify other agents about new presence
            await self._broadcast_presence_update(document_id, source_agent_id)
            
            logger.info(f"Agent {source_agent_id} opened document {document_id}")
            
        except Exception as e:
            logger.error(f"Failed to open document: {e}")
            await self._send_error_response(source_agent_id, str(e))
    
    async def _handle_close_document(self, message: CloseDocumentMessage, source_agent_id: str) -> None:
        """Handle document closing."""
        try:
            document_id = message.document_id
            
            if document_id in self.documents:
                document = self.documents[document_id]
                document.remove_agent(source_agent_id)
            
            # Remove from agent session
            if source_agent_id in self.agent_sessions:
                self.agent_sessions[source_agent_id].discard(document_id)
            
            # Send success response
            response = DocumentOperationResponse(
                operation_id=str(uuid.uuid4()),
                success=True,
                sender_id=self.network.node_id
            )
            
            await self._send_response(source_agent_id, response)
            
            # Notify other agents about presence change
            if document_id in self.documents:
                await self._broadcast_presence_update(document_id, source_agent_id)
            
            logger.info(f"Agent {source_agent_id} closed document {document_id}")
            
        except Exception as e:
            logger.error(f"Failed to close document: {e}")
            await self._send_error_response(source_agent_id, str(e))
    
    async def _handle_insert_lines(self, message: InsertLinesMessage, source_agent_id: str) -> None:
        """Handle line insertion."""
        try:
            document_id = message.document_id
            
            if document_id not in self.documents:
                raise ValueError(f"Document not found: {document_id}")
            
            document = self.documents[document_id]
            
            # Check permissions
            if not document.has_permission(source_agent_id, "write"):
                raise ValueError("Agent does not have write permission")
            
            # Perform the operation
            operation = document.insert_lines(source_agent_id, message.line_number, message.content)
            
            # Send success response
            response = DocumentOperationResponse(
                operation_id=operation.operation_id,
                success=True,
                sender_id=self.network.node_id
            )
            
            await self._send_response(source_agent_id, response)
            
            # Broadcast operation to other agents
            await self._broadcast_operation(document_id, message, source_agent_id)
            
            logger.info(f"Agent {source_agent_id} inserted {len(message.content)} lines at {message.line_number} in document {document_id}")
            
        except Exception as e:
            logger.error(f"Failed to insert lines: {e}")
            await self._send_error_response(source_agent_id, str(e))
    
    async def _handle_remove_lines(self, message: RemoveLinesMessage, source_agent_id: str) -> None:
        """Handle line removal."""
        try:
            document_id = message.document_id
            
            if document_id not in self.documents:
                raise ValueError(f"Document not found: {document_id}")
            
            document = self.documents[document_id]
            
            # Check permissions
            if not document.has_permission(source_agent_id, "write"):
                raise ValueError("Agent does not have write permission")
            
            # Perform the operation
            operation = document.remove_lines(source_agent_id, message.start_line, message.end_line)
            
            # Send success response
            response = DocumentOperationResponse(
                operation_id=operation.operation_id,
                success=True,
                sender_id=self.network.node_id
            )
            
            await self._send_response(source_agent_id, response)
            
            # Broadcast operation to other agents
            await self._broadcast_operation(document_id, message, source_agent_id)
            
            logger.info(f"Agent {source_agent_id} removed lines {message.start_line}-{message.end_line} in document {document_id}")
            
        except Exception as e:
            logger.error(f"Failed to remove lines: {e}")
            await self._send_error_response(source_agent_id, str(e))
    
    async def _handle_replace_lines(self, message: ReplaceLinesMessage, source_agent_id: str) -> None:
        """Handle line replacement."""
        try:
            document_id = message.document_id
            
            if document_id not in self.documents:
                raise ValueError(f"Document not found: {document_id}")
            
            document = self.documents[document_id]
            
            # Check permissions
            if not document.has_permission(source_agent_id, "write"):
                raise ValueError("Agent does not have write permission")
            
            # Perform the operation
            operation = document.replace_lines(source_agent_id, message.start_line, message.end_line, message.content)
            
            # Send success response
            response = DocumentOperationResponse(
                operation_id=operation.operation_id,
                success=True,
                sender_id=self.network.node_id
            )
            
            await self._send_response(source_agent_id, response)
            
            # Broadcast operation to other agents
            await self._broadcast_operation(document_id, message, source_agent_id)
            
            logger.info(f"Agent {source_agent_id} replaced lines {message.start_line}-{message.end_line} in document {document_id}")
            
        except Exception as e:
            logger.error(f"Failed to replace lines: {e}")
            await self._send_error_response(source_agent_id, str(e))
    
    async def _handle_add_comment(self, message: AddCommentMessage, source_agent_id: str) -> None:
        """Handle comment addition."""
        try:
            document_id = message.document_id
            
            if document_id not in self.documents:
                raise ValueError(f"Document not found: {document_id}")
            
            document = self.documents[document_id]
            
            # Check permissions (commenting allowed for read_only as well)
            if not document.has_permission(source_agent_id, "comment"):
                raise ValueError("Agent does not have comment permission")
            
            # Add the comment
            comment = document.add_comment(source_agent_id, message.line_number, message.comment_text)
            
            # Send success response
            response = DocumentOperationResponse(
                operation_id=comment.comment_id,
                success=True,
                sender_id=self.network.node_id
            )
            
            await self._send_response(source_agent_id, response)
            
            # Broadcast comment to other agents
            await self._broadcast_operation(document_id, message, source_agent_id)
            
            logger.info(f"Agent {source_agent_id} added comment to line {message.line_number} in document {document_id}")
            
        except Exception as e:
            logger.error(f"Failed to add comment: {e}")
            await self._send_error_response(source_agent_id, str(e))
    
    async def _handle_remove_comment(self, message: RemoveCommentMessage, source_agent_id: str) -> None:
        """Handle comment removal."""
        try:
            document_id = message.document_id
            
            if document_id not in self.documents:
                raise ValueError(f"Document not found: {document_id}")
            
            document = self.documents[document_id]
            
            # Remove the comment (permission check is done inside the method)
            success = document.remove_comment(source_agent_id, message.comment_id)
            
            # Send success response
            response = DocumentOperationResponse(
                operation_id=message.comment_id,
                success=success,
                sender_id=self.network.node_id
            )
            
            await self._send_response(source_agent_id, response)
            
            # Broadcast comment removal to other agents
            await self._broadcast_operation(document_id, message, source_agent_id)
            
            logger.info(f"Agent {source_agent_id} removed comment {message.comment_id} in document {document_id}")
            
        except Exception as e:
            logger.error(f"Failed to remove comment: {e}")
            await self._send_error_response(source_agent_id, str(e))
    
    async def _handle_update_cursor_position(self, message: UpdateCursorPositionMessage, source_agent_id: str) -> None:
        """Handle cursor position update."""
        try:
            document_id = message.document_id
            
            if document_id not in self.documents:
                raise ValueError(f"Document not found: {document_id}")
            
            document = self.documents[document_id]
            
            # Update presence
            document.update_agent_presence(source_agent_id, message.cursor_position)
            
            # Broadcast presence update to other agents
            await self._broadcast_presence_update(document_id, source_agent_id)
            
        except Exception as e:
            logger.error(f"Failed to update cursor position: {e}")
    
    async def _handle_get_document_content(self, message: GetDocumentContentMessage, source_agent_id: str) -> None:
        """Handle document content request."""
        try:
            document_id = message.document_id
            
            if document_id not in self.documents:
                raise ValueError(f"Document not found: {document_id}")
            
            document = self.documents[document_id]
            
            # Check permissions
            if not document.has_permission(source_agent_id, "read"):
                raise ValueError("Agent does not have read permission")
            
            # Prepare response
            comments = []
            if message.include_comments:
                comments = [
                    comment for comments in document.comments.values()
                    for comment in comments
                ]
            
            agent_presence = []
            if message.include_presence:
                agent_presence = list(document.agent_presence.values())
            
            response = DocumentContentResponse(
                document_id=document_id,
                content=document.content.copy(),
                comments=comments,
                agent_presence=agent_presence,
                version=document.version,
                sender_id=self.network.node_id
            )
            
            await self._send_response(source_agent_id, response)
            
        except Exception as e:
            logger.error(f"Failed to get document content: {e}")
            await self._send_error_response(source_agent_id, str(e))
    
    async def _handle_get_document_history(self, message: GetDocumentHistoryMessage, source_agent_id: str) -> None:
        """Handle document history request."""
        try:
            document_id = message.document_id
            
            if document_id not in self.documents:
                raise ValueError(f"Document not found: {document_id}")
            
            document = self.documents[document_id]
            
            # Check permissions
            if not document.has_permission(source_agent_id, "read"):
                raise ValueError("Agent does not have read permission")
            
            # Get operation history with pagination
            total_operations = len(document.operation_history)
            start_index = max(0, total_operations - message.offset - message.limit)
            end_index = max(0, total_operations - message.offset)
            
            operations = [
                op.model_dump() for op in document.operation_history[start_index:end_index]
            ]
            operations.reverse()  # Most recent first
            
            response = DocumentHistoryResponse(
                document_id=document_id,
                operations=operations,
                total_operations=total_operations,
                sender_id=self.network.node_id
            )
            
            await self._send_response(source_agent_id, response)
            
        except Exception as e:
            logger.error(f"Failed to get document history: {e}")
            await self._send_error_response(source_agent_id, str(e))
    
    async def _handle_list_documents(self, message: ListDocumentsMessage, source_agent_id: str) -> None:
        """Handle document list request."""
        try:
            documents = []
            
            for doc_id, document in self.documents.items():
                # Check if agent has access
                if document.has_permission(source_agent_id, "read"):
                    doc_info = {
                        "document_id": doc_id,
                        "name": document.name,
                        "creator": document.creator_agent_id,
                        "created": document.created_timestamp.isoformat(),
                        "last_modified": document.last_modified.isoformat(),
                        "version": document.version,
                        "active_agents": list(document.active_agents),
                        "permission": document.access_permissions.get(source_agent_id, "none")
                    }
                    
                    # Include closed documents if requested
                    if message.include_closed or source_agent_id in document.active_agents:
                        documents.append(doc_info)
            
            response = DocumentListResponse(
                documents=documents,
                sender_id=self.network.node_id
            )
            
            await self._send_response(source_agent_id, response)
            
        except Exception as e:
            logger.error(f"Failed to list documents: {e}")
            await self._send_error_response(source_agent_id, str(e))
    
    async def _handle_get_agent_presence(self, message: GetAgentPresenceMessage, source_agent_id: str) -> None:
        """Handle agent presence request."""
        try:
            document_id = message.document_id
            
            if document_id not in self.documents:
                raise ValueError(f"Document not found: {document_id}")
            
            document = self.documents[document_id]
            
            # Check permissions
            if not document.has_permission(source_agent_id, "read"):
                raise ValueError("Agent does not have read permission")
            
            response = AgentPresenceResponse(
                document_id=document_id,
                agent_presence=list(document.agent_presence.values()),
                sender_id=self.network.node_id
            )
            
            await self._send_response(source_agent_id, response)
            
        except Exception as e:
            logger.error(f"Failed to get agent presence: {e}")
            await self._send_error_response(source_agent_id, str(e))
    
    async def _broadcast_operation(self, document_id: str, operation_message: BaseMessage, source_agent_id: str) -> None:
        """Broadcast an operation to all other agents working on the document."""
        if document_id not in self.documents:
            return
        
        document = self.documents[document_id]
        
        # Send to all active agents except the source
        for agent_id in document.active_agents:
            if agent_id != source_agent_id:
                try:
                    mod_message = ModMessage(
                        mod="shared_document",
                        content=operation_message.model_dump(),
                        sender_id=self.network.node_id,
                        relevant_agent_id=agent_id
                    )
                    await self.network.send_message(agent_id, mod_message)
                except Exception as e:
                    logger.error(f"Failed to broadcast operation to agent {agent_id}: {e}")
    
    async def _broadcast_presence_update(self, document_id: str, agent_id: str) -> None:
        """Broadcast agent presence update to all other agents in the document."""
        if document_id not in self.documents:
            return
        
        document = self.documents[document_id]
        
        if agent_id not in document.agent_presence:
            return
        
        presence_message = GetAgentPresenceMessage(
            document_id=document_id,
            source_agent_id=self.network.node_id
        )
        
        # Send to all active agents except the one whose presence changed
        for other_agent_id in document.active_agents:
            if other_agent_id != agent_id:
                try:
                    mod_message = ModMessage(
                        mod="shared_document",
                        content=presence_message.model_dump(),
                        sender_id=self.network.node_id,
                        relevant_agent_id=other_agent_id
                    )
                    await self.network.send_message(other_agent_id, mod_message)
                except Exception as e:
                    logger.error(f"Failed to broadcast presence update to agent {other_agent_id}: {e}")
    
    async def _send_response(self, target_agent_id: str, response: BaseMessage) -> None:
        """Send a response message to an agent."""
        try:
            mod_message = ModMessage(
                mod="shared_document",
                content=response.model_dump(),
                sender_id=self.network.node_id,
                relevant_agent_id=target_agent_id
            )
            await self.network.send_message(target_agent_id, mod_message)
        except Exception as e:
            logger.error(f"Failed to send response to agent {target_agent_id}: {e}")
    
    async def _send_error_response(self, target_agent_id: str, error_message: str) -> None:
        """Send an error response to an agent."""
        try:
            response = DocumentOperationResponse(
                operation_id=str(uuid.uuid4()),
                success=False,
                error_message=error_message,
                sender_id=self.network.node_id
            )
            await self._send_response(target_agent_id, response)
        except Exception as e:
            logger.error(f"Failed to send error response to agent {target_agent_id}: {e}")
    
    async def cleanup_inactive_agents(self) -> None:
        """Clean up inactive agents from documents."""
        now = datetime.now()
        
        if now - self.last_cleanup < self.cleanup_interval:
            return
        
        timeout_threshold = now - timedelta(minutes=10)
        
        for document in self.documents.values():
            inactive_agents = []
            
            for agent_id, presence in document.agent_presence.items():
                if presence.last_activity < timeout_threshold:
                    inactive_agents.append(agent_id)
            
            for agent_id in inactive_agents:
                document.remove_agent(agent_id)
                logger.info(f"Removed inactive agent {agent_id} from document {document.document_id}")
        
        self.last_cleanup = now
