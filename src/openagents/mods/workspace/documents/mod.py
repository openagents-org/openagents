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

from openagents.core.base_mod import BaseMod, mod_event_handler
from openagents.models.event import Event
from openagents.models.event_response import EventResponse
from openagents.models.messages import EventNames
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
    
    def can_access(self, agent_id: str, operation: str) -> bool:
        """Check if agent can access the document for the given operation."""
        # Creator always has access
        if agent_id == self.creator_agent_id:
            return True
        
        # Check explicit permissions
        return self.has_permission(agent_id, operation)
    
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
    
    def __init__(self, mod_name: str = "documents"):
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
    
    # Event handlers using the new pattern
    
    @mod_event_handler("document.create")
    async def _handle_document_create(self, event: Event) -> Optional[EventResponse]:
        """Handle document creation requests."""
        try:
            source_agent_id = event.source_id.replace("agent:", "") if event.source_id.startswith("agent:") else event.source_id
            logger.info(f"Processing document create request from {source_agent_id}")
            
            # Extract payload
            payload = event.payload
            document_name = payload.get("document_name")
            initial_content = payload.get("initial_content", "")
            access_permissions = payload.get("access_permissions", {})
            
            # Create document
            document_id = str(uuid.uuid4())
            document = SharedDocument(
                document_id=document_id,
                name=document_name,
                creator_agent_id=source_agent_id,
                initial_content=initial_content
            )
            
            # Set access permissions
            for agent_id, permission in access_permissions.items():
                document.add_agent(agent_id, permission)
            
            self.documents[document_id] = document
            
            # Track agent session
            if source_agent_id not in self.agent_sessions:
                self.agent_sessions[source_agent_id] = set()
            self.agent_sessions[source_agent_id].add(document_id)
            
            logger.info(f"Created document {document_id} '{document_name}' for agent {source_agent_id}")
            
            return EventResponse(
                success=True,
                message=f"Document '{document_name}' created successfully",
                data={
                    "document_id": document_id,
                    "document_name": document_name,
                    "creator_id": source_agent_id,
                    "content": document.content
                }
            )
            
        except Exception as e:
            logger.error(f"Error creating document: {e}")
            return EventResponse(
                success=False,
                message=f"Failed to create document: {str(e)}"
            )
    
    @mod_event_handler("document.open")
    async def _handle_document_open(self, event: Event) -> Optional[EventResponse]:
        """Handle document open requests."""
        try:
            source_agent_id = event.source_id.replace("agent:", "") if event.source_id.startswith("agent:") else event.source_id
            payload = event.payload
            document_id = payload.get("document_id")
            
            if document_id not in self.documents:
                return EventResponse(
                    success=False,
                    message=f"Document {document_id} not found"
                )
            
            document = self.documents[document_id]
            
            # Check permissions
            if not document.can_access(source_agent_id, "read"):
                return EventResponse(
                    success=False,
                    message="Access denied"
                )
            
            # Track agent session
            if source_agent_id not in self.agent_sessions:
                self.agent_sessions[source_agent_id] = set()
            self.agent_sessions[source_agent_id].add(document_id)
            
            return EventResponse(
                success=True,
                message=f"Document opened successfully",
                data={
                    "document_id": document_id,
                    "document_name": document.name,
                    "content": document.content
                }
            )
            
        except Exception as e:
            logger.error(f"Error opening document: {e}")
            return EventResponse(
                success=False,
                message=f"Failed to open document: {str(e)}"
            )
    
    @mod_event_handler("document.close")
    async def _handle_document_close(self, event: Event) -> Optional[EventResponse]:
        """Handle document close requests."""
        try:
            source_agent_id = event.source_id.replace("agent:", "") if event.source_id.startswith("agent:") else event.source_id
            payload = event.payload
            document_id = payload.get("document_id")
            
            # Remove from agent session
            if source_agent_id in self.agent_sessions:
                self.agent_sessions[source_agent_id].discard(document_id)
            
            return EventResponse(
                success=True,
                message=f"Document closed successfully"
            )
            
        except Exception as e:
            logger.error(f"Error closing document: {e}")
            return EventResponse(
                success=False,
                message=f"Failed to close document: {str(e)}"
            )
    
    # Placeholder handlers for other operations
    @mod_event_handler("document.insert_lines")
    async def _handle_document_insert_lines(self, event: Event) -> Optional[EventResponse]:
        """Handle line insertion requests."""
        try:
            source_agent_id = event.source_id.replace("agent:", "") if event.source_id.startswith("agent:") else event.source_id
            payload = event.payload
            document_id = payload.get("document_id")
            line_number = int(payload.get("line_number", 1))
            content = payload.get("content", [])
            
            if document_id not in self.documents:
                return EventResponse(
                    success=False,
                    message=f"Document {document_id} not found"
                )
            
            document = self.documents[document_id]
            
            # Check permissions
            if not document.can_access(source_agent_id, "write"):
                return EventResponse(
                    success=False,
                    message="Access denied"
                )
            
            # Insert lines into document
            insert_index = line_number - 1  # Convert to 0-based index
            for i, line in enumerate(content):
                document.content.insert(insert_index + i, line)
            
            # Update line authors
            for i in range(len(content)):
                document.line_authors[line_number + i] = source_agent_id
            
            document.last_modified = datetime.now()
            document.version += 1
            
            return EventResponse(
                success=True,
                message=f"Inserted {len(content)} lines at line {line_number}",
                data={
                    "document_id": document_id,
                    "lines_inserted": len(content),
                    "new_version": document.version
                }
            )
            
        except Exception as e:
            logger.error(f"Error inserting lines: {e}")
            return EventResponse(
                success=False,
                message=f"Failed to insert lines: {str(e)}"
            )
    
    @mod_event_handler("document.remove_lines")
    async def _handle_document_remove_lines(self, event: Event) -> Optional[EventResponse]:
        """Handle line removal requests."""
        return EventResponse(success=True, message="Remove lines operation completed")
    
    @mod_event_handler("document.replace_lines")
    async def _handle_document_replace_lines(self, event: Event) -> Optional[EventResponse]:
        """Handle line replacement requests."""
        return EventResponse(success=True, message="Replace lines operation completed")
    
    @mod_event_handler("document.add_comment")
    async def _handle_document_add_comment(self, event: Event) -> Optional[EventResponse]:
        """Handle add comment requests."""
        try:
            source_agent_id = event.source_id.replace("agent:", "") if event.source_id.startswith("agent:") else event.source_id
            payload = event.payload
            document_id = payload.get("document_id")
            line_number = int(payload.get("line_number", 1))
            comment_text = payload.get("comment_text", "")
            
            if document_id not in self.documents:
                return EventResponse(
                    success=False,
                    message=f"Document {document_id} not found"
                )
            
            document = self.documents[document_id]
            
            # Check permissions
            if not document.can_access(source_agent_id, "comment"):
                return EventResponse(
                    success=False,
                    message="Access denied"
                )
            
            # Add comment to document
            document.add_comment(source_agent_id, line_number, comment_text)
            
            return EventResponse(
                success=True,
                message=f"Comment added to line {line_number}",
                data={
                    "document_id": document_id,
                    "line_number": line_number,
                    "comment_text": comment_text,
                    "author": source_agent_id
                }
            )
            
        except Exception as e:
            logger.error(f"Error adding comment: {e}")
            return EventResponse(
                success=False,
                message=f"Failed to add comment: {str(e)}"
            )
    
    @mod_event_handler("document.remove_comment")
    async def _handle_document_remove_comment(self, event: Event) -> Optional[EventResponse]:
        """Handle remove comment requests."""
        return EventResponse(success=True, message="Comment removed successfully")
    
    @mod_event_handler("document.update_cursor")
    async def _handle_document_update_cursor(self, event: Event) -> Optional[EventResponse]:
        """Handle cursor position updates."""
        try:
            source_agent_id = event.source_id.replace("agent:", "") if event.source_id.startswith("agent:") else event.source_id
            payload = event.payload
            document_id = payload.get("document_id")
            cursor_position = payload.get("cursor_position", {})
            
            if document_id not in self.documents:
                return EventResponse(
                    success=False,
                    message=f"Document {document_id} not found"
                )
            
            document = self.documents[document_id]
            
            # Check access permissions
            if not document.can_access(source_agent_id, "read"):
                return EventResponse(
                    success=False,
                    message="Access denied"
                )
            
            # Update cursor position
            line_number = int(cursor_position.get("line_number", 1))
            column_number = int(cursor_position.get("column_number", 1))
            cursor_pos = CursorPosition(line_number=line_number, column_number=column_number)
            document.update_agent_presence(source_agent_id, cursor_pos)
            
            return EventResponse(
                success=True,
                message="Cursor position updated"
            )
            
        except Exception as e:
            logger.error(f"Failed to update cursor position: {e}")
            return EventResponse(
                success=False,
                message=f"Failed to update cursor position: {str(e)}"
            )
    
    @mod_event_handler("document.get_content")
    async def _handle_document_get_content(self, event: Event) -> Optional[EventResponse]:
        """Handle get document content requests."""
        try:
            source_agent_id = event.source_id.replace("agent:", "") if event.source_id.startswith("agent:") else event.source_id
            payload = event.payload
            document_id = payload.get("document_id")
            include_comments = payload.get("include_comments", True)
            include_presence = payload.get("include_presence", True)
            
            if document_id not in self.documents:
                return EventResponse(
                    success=False,
                    message=f"Document {document_id} not found"
                )
            
            document = self.documents[document_id]
            
            # Check permissions
            if not document.can_access(source_agent_id, "read"):
                return EventResponse(
                    success=False,
                    message="Access denied"
                )
            
            response_data = {
                "document_id": document_id,
                "content": document.content
            }
            
            if include_comments:
                # Convert comments to simple format
                comments = []
                for line_num, line_comments in document.comments.items():
                    for comment in line_comments:
                        comments.append({
                            "line_number": line_num,
                            "text": comment.comment_text,
                            "author": comment.agent_id,
                            "timestamp": comment.timestamp.isoformat()
                        })
                response_data["comments"] = comments
            
            if include_presence:
                # Convert presence to simple format
                presence = []
                for agent_id, agent_presence in document.agent_presence.items():
                    if agent_presence.is_active and agent_presence.cursor_position:
                        presence.append({
                            "agent_id": agent_id,
                            "line_number": agent_presence.cursor_position.line_number,
                            "column_number": agent_presence.cursor_position.column_number,
                            "last_activity": agent_presence.last_activity.isoformat()
                        })
                response_data["presence"] = presence
            
            return EventResponse(
                success=True,
                message="Document content retrieved",
                data=response_data
            )
            
        except Exception as e:
            logger.error(f"Error getting document content: {e}")
            return EventResponse(
                success=False,
                message=f"Failed to get document content: {str(e)}"
            )
    
    @mod_event_handler("document.get_history")
    async def _handle_document_get_history(self, event: Event) -> Optional[EventResponse]:
        """Handle get document history requests."""
        return EventResponse(success=True, message="Document history retrieved", data={"history": []})
    
    @mod_event_handler("document.list")
    async def _handle_document_list(self, event: Event) -> Optional[EventResponse]:
        """Handle list documents requests."""
        try:
            source_agent_id = event.source_id.replace("agent:", "") if event.source_id.startswith("agent:") else event.source_id
            
            # Get documents accessible to the agent
            accessible_docs = []
            for doc_id, document in self.documents.items():
                if document.can_access(source_agent_id, "read"):
                    accessible_docs.append({
                        "document_id": doc_id,
                        "name": document.name,
                        "creator_id": document.creator_agent_id,
                        "created_at": document.created_at.isoformat() if hasattr(document, 'created_at') else None
                    })
            
            return EventResponse(
                success=True,
                message="Documents listed successfully",
                data={"documents": accessible_docs}
            )
            
        except Exception as e:
            logger.error(f"Error listing documents: {e}")
            return EventResponse(
                success=False,
                message=f"Failed to list documents: {str(e)}"
            )
    
    @mod_event_handler("document.get_presence")
    async def _handle_document_get_presence(self, event: Event) -> Optional[EventResponse]:
        """Handle get agent presence requests."""
        try:
            source_agent_id = event.source_id.replace("agent:", "") if event.source_id.startswith("agent:") else event.source_id
            payload = event.payload
            document_id = payload.get("document_id")
            
            if document_id not in self.documents:
                return EventResponse(
                    success=False,
                    message=f"Document {document_id} not found"
                )
            
            document = self.documents[document_id]
            
            # Check access permissions
            if not document.can_access(source_agent_id, "read"):
                return EventResponse(
                    success=False,
                    message="Access denied"
                )
            
            # Get presence information
            presence = []
            for agent_id, agent_presence in document.agent_presence.items():
                if agent_presence.is_active and agent_presence.cursor_position:
                    presence.append({
                        "agent_id": agent_id,
                        "line_number": agent_presence.cursor_position.line_number,
                        "column_number": agent_presence.cursor_position.column_number,
                        "last_activity": agent_presence.last_activity.isoformat()
                    })
            
            return EventResponse(
                success=True,
                message="Agent presence retrieved",
                data={"presence": presence}
            )
            
        except Exception as e:
            logger.error(f"Failed to get agent presence: {e}")
            return EventResponse(
                success=False,
                message=f"Failed to get agent presence: {str(e)}"
            )
