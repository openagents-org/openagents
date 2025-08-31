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
    AcquireLineLockMessage,
    ReleaseLineLockMessage,
    LineLockResponse,
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
        
        # Line authorship tracking (line_number -> agent_id)
        self.line_authors: Dict[int, str] = {}
        initial_lines = len(self.content)
        for i in range(1, initial_lines + 1):
            self.line_authors[i] = creator_agent_id  # Creator owns all initial lines
        
        # Line locking mechanism (line_number -> {agent_id, timestamp, timeout})
        self.line_locks: Dict[int, Dict[str, Any]] = {}
        self.lock_timeout_seconds = 30  # Locks expire after 30 seconds of inactivity
        
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
            
            # Allow expanding the document - only check that start_line is valid
            if start_line > len(self.content) + 1:
                raise ValueError(f"Start line {start_line} exceeds document length + 1: {len(self.content) + 1}")
            
            # Check for line locks - prevent editing locked lines
            locked_lines = []
            for line_num in range(start_line, min(end_line + 1, len(self.content) + 1)):
                if self.is_line_locked_by_other(agent_id, line_num):
                    locked_lines.append(line_num)
            
            if locked_lines:
                lock_info = []
                for line_num in locked_lines:
                    lock_agent = self.line_locks[line_num]['agent_id']
                    lock_info.append(f"line {line_num} (locked by {lock_agent})")
                raise ValueError(f"Cannot edit locked lines: {', '.join(lock_info)}")
            
            # If end_line exceeds current content, we'll expand the document
            if end_line > len(self.content):
                logger.info(f"Expanding document from {len(self.content)} lines to accommodate {end_line} lines")
            
            # Remove comments in the range being replaced
            for line_num in range(start_line, end_line + 1):
                if line_num in self.comments:
                    del self.comments[line_num]
            
            # Replace lines (convert to 0-based indices)
            start_index = start_line - 1
            end_index = end_line - 1
            
            # If we're expanding beyond current content, adjust the slice
            if end_index >= len(self.content):
                # Expanding the document - replace from start_index to end of current content
                self.content[start_index:] = content
            else:
                # Normal replacement within existing content
                self.content[start_index:end_index + 1] = content
            
            # Update line authorship for replaced lines
            # Clear old authorship for replaced range
            for line_num in range(start_line, end_line + 1):
                if line_num in self.line_authors:
                    del self.line_authors[line_num]
            
            # Set new authorship for all new content lines
            for i, _ in enumerate(content):
                line_num = start_line + i
                self.line_authors[line_num] = agent_id
            
            # Shift authorship for lines after the replacement if document length changed
            lines_added = len(content)
            lines_removed = end_line - start_line + 1
            line_shift = lines_added - lines_removed
            
            if line_shift != 0:
                # Shift line authorship for lines after the replacement
                old_authors = dict(self.line_authors)
                for line_num in sorted(old_authors.keys(), reverse=True):
                    if line_num > end_line:
                        new_line_num = line_num + line_shift
                        if new_line_num > 0:
                            self.line_authors[new_line_num] = old_authors[line_num]
                        del self.line_authors[line_num]
            
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
            "active_agents": list(self.active_agents),
            "line_locks": self._get_active_line_locks()
        }
    
    def _get_active_line_locks(self) -> Dict[int, str]:
        """Get currently active line locks (line_number -> agent_id)."""
        current_time = datetime.now()
        active_locks = {}
        
        # Clean up expired locks and collect active ones
        expired_locks = []
        for line_number, lock_info in self.line_locks.items():
            lock_time = lock_info.get('timestamp', current_time)
            if isinstance(lock_time, str):
                lock_time = datetime.fromisoformat(lock_time)
            
            time_diff = (current_time - lock_time).total_seconds()
            if time_diff > self.lock_timeout_seconds:
                expired_locks.append(line_number)
            else:
                active_locks[line_number] = lock_info['agent_id']
        
        # Remove expired locks
        for line_number in expired_locks:
            del self.line_locks[line_number]
        
        return active_locks
    
    def acquire_line_lock(self, agent_id: str, line_number: int) -> bool:
        """Acquire a lock on a specific line. Returns True if successful."""
        try:
            # Validate line number
            if line_number < 1 or line_number > len(self.content):
                return False
            
            current_time = datetime.now()
            
            # Check if line is already locked by another agent
            if line_number in self.line_locks:
                existing_lock = self.line_locks[line_number]
                existing_agent = existing_lock['agent_id']
                lock_time = existing_lock.get('timestamp', current_time)
                
                if isinstance(lock_time, str):
                    lock_time = datetime.fromisoformat(lock_time)
                
                # If locked by same agent, refresh the lock
                if existing_agent == agent_id:
                    self.line_locks[line_number]['timestamp'] = current_time
                    return True
                
                # Check if existing lock has expired
                time_diff = (current_time - lock_time).total_seconds()
                if time_diff <= self.lock_timeout_seconds:
                    return False  # Line is locked by another agent
                
                # Lock has expired, remove it
                del self.line_locks[line_number]
            
            # Acquire the lock
            self.line_locks[line_number] = {
                'agent_id': agent_id,
                'timestamp': current_time
            }
            
            logger.info(f"Agent {agent_id} acquired lock on line {line_number}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to acquire line lock: {e}")
            return False
    
    def release_line_lock(self, agent_id: str, line_number: int) -> bool:
        """Release a lock on a specific line. Returns True if successful."""
        try:
            if line_number not in self.line_locks:
                return True  # Already unlocked
            
            lock_info = self.line_locks[line_number]
            if lock_info['agent_id'] != agent_id:
                return False  # Can't release someone else's lock
            
            del self.line_locks[line_number]
            logger.info(f"Agent {agent_id} released lock on line {line_number}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to release line lock: {e}")
            return False
    
    def release_all_agent_locks(self, agent_id: str) -> int:
        """Release all locks held by an agent. Returns number of locks released."""
        try:
            released_count = 0
            locks_to_remove = []
            
            for line_number, lock_info in self.line_locks.items():
                if lock_info['agent_id'] == agent_id:
                    locks_to_remove.append(line_number)
            
            for line_number in locks_to_remove:
                del self.line_locks[line_number]
                released_count += 1
            
            if released_count > 0:
                logger.info(f"Released {released_count} locks for agent {agent_id}")
            
            return released_count
            
        except Exception as e:
            logger.error(f"Failed to release agent locks: {e}")
            return 0
    
    def is_line_locked_by_other(self, agent_id: str, line_number: int) -> bool:
        """Check if a line is locked by another agent."""
        if line_number not in self.line_locks:
            return False
        
        lock_info = self.line_locks[line_number]
        if lock_info['agent_id'] == agent_id:
            return False  # Locked by same agent
        
        # Check if lock has expired
        current_time = datetime.now()
        lock_time = lock_info.get('timestamp', current_time)
        if isinstance(lock_time, str):
            lock_time = datetime.fromisoformat(lock_time)
        
        time_diff = (current_time - lock_time).total_seconds()
        if time_diff > self.lock_timeout_seconds:
            # Lock expired, remove it
            del self.line_locks[line_number]
            return False
        
        return True  # Locked by another agent

class SharedDocumentNetworkMod(BaseMod):
    """Network-level shared document mod implementation.
    
    This standalone mod enables:
    - Collaborative document editing
    - Real-time synchronization
    - Line-based operations
    - Commenting system
    - Agent presence tracking
    """
    
    def __init__(self, mod_name: str = "shared_document"):
        """Initialize the shared document mod."""
        super().__init__(mod_name=mod_name)
        
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
    
    async def process_mod_message(self, message: ModMessage) -> None:
        """Process incoming mod messages."""
        try:
            source_agent_id = message.sender_id or message.relevant_agent_id or "unknown"
            logger.info(f"Processing mod message from {source_agent_id}: {type(message)} - {message}")
            
            # Extract the actual message content from the mod message
            content = message.content if hasattr(message, 'content') else message
            message_type = content.get('message_type') if isinstance(content, dict) else getattr(content, 'message_type', None)
            
            # Extract request_id from the ModMessage for response matching
            request_id = getattr(message, 'request_id', None)
            
            logger.info(f"Message type: {message_type}, Content: {content}, Request ID: {request_id}")
            
            # Parse the content into the appropriate message type
            if message_type == "create_document":
                doc_message = CreateDocumentMessage(**content)
                await self._handle_create_document(doc_message, source_agent_id, request_id)
            elif message_type == "list_documents":
                doc_message = ListDocumentsMessage(**content)
                await self._handle_list_documents(doc_message, source_agent_id, request_id)
            elif message_type == "open_document":
                doc_message = OpenDocumentMessage(**content)
                await self._handle_open_document(doc_message, source_agent_id, request_id)
            elif message_type == "close_document":
                doc_message = CloseDocumentMessage(**content)
                await self._handle_close_document(doc_message, source_agent_id, request_id)
            elif message_type == "insert_lines":
                doc_message = InsertLinesMessage(**content)
                await self._handle_insert_lines(doc_message, source_agent_id, request_id)
            elif message_type == "remove_lines":
                doc_message = RemoveLinesMessage(**content)
                await self._handle_remove_lines(doc_message, source_agent_id, request_id)
            elif message_type == "replace_lines":
                doc_message = ReplaceLinesMessage(**content)
                await self._handle_replace_lines(doc_message, source_agent_id, request_id)
            elif message_type == "add_comment":
                doc_message = AddCommentMessage(**content)
                await self._handle_add_comment(doc_message, source_agent_id, request_id)
            elif message_type == "remove_comment":
                doc_message = RemoveCommentMessage(**content)
                await self._handle_remove_comment(doc_message, source_agent_id, request_id)
            elif message_type == "update_cursor_position":
                doc_message = UpdateCursorPositionMessage(**content)
                await self._handle_update_cursor_position(doc_message, source_agent_id, request_id)
            elif message_type == "acquire_line_lock":
                doc_message = AcquireLineLockMessage(**content)
                await self._handle_acquire_line_lock(doc_message, source_agent_id, request_id)
            elif message_type == "release_line_lock":
                doc_message = ReleaseLineLockMessage(**content)
                await self._handle_release_line_lock(doc_message, source_agent_id, request_id)
            elif message_type == "get_document_content":
                doc_message = GetDocumentContentMessage(**content)
                await self._handle_get_document_content(doc_message, source_agent_id, request_id)
            elif message_type == "get_document_history":
                doc_message = GetDocumentHistoryMessage(**content)
                await self._handle_get_document_history(doc_message, source_agent_id, request_id)
            elif message_type == "get_agent_presence":
                doc_message = GetAgentPresenceMessage(**content)
                await self._handle_get_agent_presence(doc_message, source_agent_id, request_id)
            else:
                logger.warning(f"Unknown message type: {message_type}")
                
        except Exception as e:
            logger.error(f"Error processing mod message from {source_agent_id}: {e}")
            await self._send_error_response(source_agent_id, str(e))

    async def process_message(self, message: BaseMessage, source_agent_id: str) -> None:
        """Legacy process_message method - delegates to process_mod_message."""
        try:
            if isinstance(message, ModMessage):
                await self.process_mod_message(message)
            else:
                logger.warning(f"Received non-mod message: {type(message)}")
                
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
    
    async def _handle_create_document(self, message: CreateDocumentMessage, source_agent_id: str, request_id: str = None) -> None:
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
                sender_id=self.network.network_id
            )
            
            await self._send_response(source_agent_id, response, request_id)
            
            logger.info(f"Created document {document_id} by agent {source_agent_id}")
            
        except Exception as e:
            logger.error(f"Failed to create document: {e}")
            await self._send_error_response(source_agent_id, str(e))
    
    async def _handle_open_document(self, message: OpenDocumentMessage, source_agent_id: str, request_id: str = None) -> None:
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
            
            # Send document content with properly serialized agent presence
            serialized_presence = []
            for presence in document.agent_presence.values():
                # Use model_dump with mode='json' to properly serialize datetime objects
                presence_dict = presence.model_dump(mode='json')
                serialized_presence.append(presence_dict)
            
            response = DocumentContentResponse(
                document_id=document_id,
                content=document.content.copy(),
                comments=[
                    comment for comments in document.comments.values()
                    for comment in comments
                ],
                agent_presence=serialized_presence,
                version=document.version,
                line_authors=document.line_authors.copy(),
                line_locks=document._get_active_line_locks(),
                sender_id=self.network.network_id
            )
            
            await self._send_response(source_agent_id, response, request_id)
            
            # Notify other agents about new presence
            await self._broadcast_presence_update(document_id, source_agent_id)
            
            logger.info(f"Agent {source_agent_id} opened document {document_id}")
            
        except Exception as e:
            logger.error(f"Failed to open document: {e}")
            await self._send_error_response(source_agent_id, str(e))
    
    async def _handle_close_document(self, message: CloseDocumentMessage, source_agent_id: str, request_id: str = None) -> None:
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
                sender_id=self.network.network_id
            )
            
            await self._send_response(source_agent_id, response, request_id)
            
            # Notify other agents about presence change
            if document_id in self.documents:
                await self._broadcast_presence_update(document_id, source_agent_id)
            
            logger.info(f"Agent {source_agent_id} closed document {document_id}")
            
        except Exception as e:
            logger.error(f"Failed to close document: {e}")
            await self._send_error_response(source_agent_id, str(e))
    
    async def _handle_insert_lines(self, message: InsertLinesMessage, source_agent_id: str, request_id: str = None) -> None:
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
                sender_id=self.network.network_id
            )
            
            await self._send_response(source_agent_id, response, request_id)
            
            # Broadcast operation to other agents
            await self._broadcast_operation(document_id, message, source_agent_id)
            
            logger.info(f"Agent {source_agent_id} inserted {len(message.content)} lines at {message.line_number} in document {document_id}")
            
        except Exception as e:
            logger.error(f"Failed to insert lines: {e}")
            await self._send_error_response(source_agent_id, str(e))
    
    async def _handle_remove_lines(self, message: RemoveLinesMessage, source_agent_id: str, request_id: str = None) -> None:
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
                sender_id=self.network.network_id
            )
            
            await self._send_response(source_agent_id, response, request_id)
            
            # Broadcast operation to other agents
            await self._broadcast_operation(document_id, message, source_agent_id)
            
            logger.info(f"Agent {source_agent_id} removed lines {message.start_line}-{message.end_line} in document {document_id}")
            
        except Exception as e:
            logger.error(f"Failed to remove lines: {e}")
            await self._send_error_response(source_agent_id, str(e))
    
    async def _handle_replace_lines(self, message: ReplaceLinesMessage, source_agent_id: str, request_id: str = None) -> None:
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
                sender_id=self.network.network_id
            )
            
            await self._send_response(source_agent_id, response, request_id)
            
            # Broadcast operation to other agents
            await self._broadcast_operation(document_id, message, source_agent_id)
            
            logger.info(f"Agent {source_agent_id} replaced lines {message.start_line}-{message.end_line} in document {document_id}")
            
        except Exception as e:
            logger.error(f"Failed to replace lines: {e}")
            await self._send_error_response(source_agent_id, str(e))
    
    async def _handle_add_comment(self, message: AddCommentMessage, source_agent_id: str, request_id: str = None) -> None:
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
                sender_id=self.network.network_id
            )
            
            await self._send_response(source_agent_id, response, request_id)
            
            # Broadcast comment to other agents
            await self._broadcast_operation(document_id, message, source_agent_id)
            
            logger.info(f"Agent {source_agent_id} added comment to line {message.line_number} in document {document_id}")
            
        except Exception as e:
            logger.error(f"Failed to add comment: {e}")
            await self._send_error_response(source_agent_id, str(e))
    
    async def _handle_remove_comment(self, message: RemoveCommentMessage, source_agent_id: str, request_id: str = None) -> None:
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
                sender_id=self.network.network_id
            )
            
            await self._send_response(source_agent_id, response, request_id)
            
            # Broadcast comment removal to other agents
            await self._broadcast_operation(document_id, message, source_agent_id)
            
            logger.info(f"Agent {source_agent_id} removed comment {message.comment_id} in document {document_id}")
            
        except Exception as e:
            logger.error(f"Failed to remove comment: {e}")
            await self._send_error_response(source_agent_id, str(e))
    
    async def _handle_update_cursor_position(self, message: UpdateCursorPositionMessage, source_agent_id: str, request_id: str = None) -> None:
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
    
    async def _handle_get_document_content(self, message: GetDocumentContentMessage, source_agent_id: str, request_id: str = None) -> None:
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
                line_authors=document.line_authors.copy(),
                line_locks=document._get_active_line_locks(),
                sender_id=self.network.network_id
            )
            
            await self._send_response(source_agent_id, response, request_id)
            
        except Exception as e:
            logger.error(f"Failed to get document content: {e}")
            await self._send_error_response(source_agent_id, str(e))
    
    async def _handle_get_document_history(self, message: GetDocumentHistoryMessage, source_agent_id: str, request_id: str = None) -> None:
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
                sender_id=self.network.network_id
            )
            
            await self._send_response(source_agent_id, response, request_id)
            
        except Exception as e:
            logger.error(f"Failed to get document history: {e}")
            await self._send_error_response(source_agent_id, str(e))
    
    async def _handle_list_documents(self, message: ListDocumentsMessage, source_agent_id: str, request_id: str = None) -> None:
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
                sender_id=self.network.network_id
            )
            
            await self._send_response(source_agent_id, response, request_id)
            
        except Exception as e:
            logger.error(f"Failed to list documents: {e}")
            await self._send_error_response(source_agent_id, str(e))
    
    async def _handle_get_agent_presence(self, message: GetAgentPresenceMessage, source_agent_id: str, request_id: str = None) -> None:
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
                sender_id=self.network.network_id
            )
            
            await self._send_response(source_agent_id, response, request_id)
            
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
                        sender_id=self.network.network_id,
                        relevant_agent_id=agent_id
                    )
                    await self.network.send_message(mod_message)
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
            sender_id=self.network.network_id
        )
        
        # Send to all active agents except the one whose presence changed
        for other_agent_id in document.active_agents:
            if other_agent_id != agent_id:
                try:
                    mod_message = ModMessage(
                        mod="shared_document",
                        content=presence_message.model_dump(),
                        sender_id=self.network.network_id,
                        relevant_agent_id=other_agent_id
                    )
                    await self.network.send_message(mod_message)
                except Exception as e:
                    logger.error(f"Failed to broadcast presence update to agent {other_agent_id}: {e}")
    
    async def _send_response(self, target_agent_id: str, response: BaseMessage, request_id: str = None) -> None:
        """Send a response message to an agent."""
        try:
            # Include request_id in the content for proper matching
            content = response.model_dump(mode='json')
            logger.info(f"🔧 _send_response - Original content keys: {list(content.keys())}")
            logger.info(f"🔧 _send_response - Received request_id: {request_id}")
            
            if request_id:
                content['request_id'] = request_id
                logger.info(f"🔧 _send_response - Added request_id to content: {request_id}")
            
            logger.info(f"🔧 _send_response - Final content keys: {list(content.keys())}")
            logger.info(f"🔧 _send_response - Final content request_id: {content.get('request_id', 'NOT_FOUND')}")
            
            mod_message = ModMessage(
                mod="openagents.mods.work.shared_document",
                content=content,
                sender_id=self.network.network_id,
                relevant_agent_id=target_agent_id
            )
            await self.network.send_message(mod_message)
        except Exception as e:
            logger.error(f"Failed to send response to agent {target_agent_id}: {e}")
    
    async def _send_error_response(self, target_agent_id: str, error_message: str) -> None:
        """Send an error response to an agent."""
        try:
            response = DocumentOperationResponse(
                operation_id=str(uuid.uuid4()),
                success=False,
                error_message=error_message,
                sender_id=self.network.network_id
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
    
    async def _handle_acquire_line_lock(self, message: AcquireLineLockMessage, source_agent_id: str, request_id: str = None) -> None:
        """Handle line lock acquisition request."""
        try:
            document_id = message.document_id
            line_number = message.line_number
            
            if document_id not in self.documents:
                await self._send_error_response(source_agent_id, f"Document {document_id} not found", request_id)
                return
            
            document = self.documents[document_id]
            
            # Attempt to acquire the lock
            success = document.acquire_line_lock(source_agent_id, line_number)
            
            # Determine who holds the lock if acquisition failed
            locked_by = None
            error_message = None
            if not success:
                if line_number in document.line_locks:
                    locked_by = document.line_locks[line_number]['agent_id']
                    error_message = f"Line {line_number} is locked by {locked_by}"
                else:
                    error_message = f"Failed to acquire lock on line {line_number}"
            
            # Send response
            response = LineLockResponse(
                document_id=document_id,
                line_number=line_number,
                success=success,
                locked_by=locked_by,
                error_message=error_message,
                sender_id=self.network.network_id
            )
            
            await self._send_response(source_agent_id, response, request_id)
            
            # If lock was acquired, broadcast the update to other agents
            if success:
                await self._broadcast_line_lock_update(document_id, line_number, source_agent_id, 'acquired')
            
        except Exception as e:
            logger.error(f"Failed to handle acquire line lock: {e}")
            await self._send_error_response(source_agent_id, str(e), request_id)
    
    async def _handle_release_line_lock(self, message: ReleaseLineLockMessage, source_agent_id: str, request_id: str = None) -> None:
        """Handle line lock release request."""
        try:
            document_id = message.document_id
            line_number = message.line_number
            
            if document_id not in self.documents:
                await self._send_error_response(source_agent_id, f"Document {document_id} not found", request_id)
                return
            
            document = self.documents[document_id]
            
            # Attempt to release the lock
            success = document.release_line_lock(source_agent_id, line_number)
            
            error_message = None
            if not success:
                if line_number in document.line_locks:
                    current_holder = document.line_locks[line_number]['agent_id']
                    if current_holder != source_agent_id:
                        error_message = f"Cannot release lock held by {current_holder}"
                    else:
                        error_message = f"Failed to release lock on line {line_number}"
                else:
                    error_message = f"Line {line_number} is not locked"
            
            # Send response
            response = LineLockResponse(
                document_id=document_id,
                line_number=line_number,
                success=success,
                locked_by=None,
                error_message=error_message,
                sender_id=self.network.network_id
            )
            
            await self._send_response(source_agent_id, response, request_id)
            
            # If lock was released, broadcast the update to other agents
            if success:
                await self._broadcast_line_lock_update(document_id, line_number, source_agent_id, 'released')
            
        except Exception as e:
            logger.error(f"Failed to handle release line lock: {e}")
            await self._send_error_response(source_agent_id, str(e), request_id)
    
    async def _broadcast_line_lock_update(self, document_id: str, line_number: int, agent_id: str, action: str) -> None:
        """Broadcast line lock updates to all agents in the document."""
        try:
            if document_id not in self.documents:
                return
            
            document = self.documents[document_id]
            
            # Create a document content response with updated line locks
            response = DocumentContentResponse(
                document_id=document_id,
                content=document.content.copy(),
                comments=[],  # Don't include comments in lock updates
                agent_presence=[],  # Don't include presence in lock updates
                version=document.version,
                line_authors=document.line_authors.copy(),
                line_locks=document._get_active_line_locks(),
                sender_id=self.network.network_id
            )
            
            # Send to all agents except the one who triggered the change
            for active_agent_id in document.active_agents:
                if active_agent_id != agent_id:
                    await self._send_response(active_agent_id, response)
            
            logger.info(f"Broadcasted line lock update for line {line_number} in document {document_id} ({action} by {agent_id})")
            
        except Exception as e:
            logger.error(f"Failed to broadcast line lock update: {e}")
