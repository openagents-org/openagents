"""Shared document specific message models for OpenAgents."""

import uuid
from typing import Dict, List, Optional, Any, Union
from datetime import datetime
from pydantic import BaseModel, Field, field_validator
from openagents.models.event import Event
from dataclasses import dataclass, field

class DocumentOperation(BaseModel):
    """Base class for document operations."""
    
    operation_id: str = Field(default_factory=lambda: str(uuid.uuid4()), description="Unique operation ID")
    document_id: str = Field(..., description="Document ID")
    agent_id: str = Field(..., description="Agent performing the operation")
    timestamp: datetime = Field(default_factory=datetime.now, description="Operation timestamp")
    operation_type: str = Field(..., description="Type of operation")

class LineRange(BaseModel):
    """Represents a range of lines in a document."""
    
    start_line: int = Field(..., description="Start line number (1-based)")
    end_line: int = Field(..., description="End line number (1-based, inclusive)")
    
    @field_validator('start_line', 'end_line')
    @classmethod
    def validate_line_numbers(cls, v):
        """Validate line numbers are positive."""
        if v < 1:
            raise ValueError('Line numbers must be 1 or greater')
        return v
    
    def model_post_init(self, __context):
        """Validate that start_line <= end_line."""
        if self.start_line > self.end_line:
            raise ValueError('start_line must be <= end_line')

class CursorPosition(BaseModel):
    """Represents a cursor position in a document."""
    
    line_number: int = Field(..., description="Line number (1-based)")
    column_number: int = Field(1, description="Column number (1-based)")
    
    @field_validator('line_number', 'column_number')
    @classmethod
    def validate_position(cls, v):
        """Validate position values are positive."""
        if v < 1:
            raise ValueError('Position values must be 1 or greater')
        return v

class DocumentComment(BaseModel):
    """Represents a comment on a document line."""
    
    comment_id: str = Field(default_factory=lambda: str(uuid.uuid4()), description="Unique comment ID")
    line_number: int = Field(..., description="Line number the comment is attached to")
    agent_id: str = Field(..., description="Agent who created the comment")
    comment_text: str = Field(..., description="Comment content")
    timestamp: datetime = Field(default_factory=datetime.now, description="Comment timestamp")
    
    @field_validator('line_number')
    @classmethod
    def validate_line_number(cls, v):
        """Validate line number is positive."""
        if v < 1:
            raise ValueError('Line number must be 1 or greater')
        return v
    
    @field_validator('comment_text')
    @classmethod
    def validate_comment_text(cls, v):
        """Validate comment text length."""
        if len(v.strip()) == 0:
            raise ValueError('Comment text cannot be empty')
        if len(v) > 2000:
            raise ValueError('Comment text cannot exceed 2000 characters')
        return v

class AgentPresence(BaseModel):
    """Represents an agent's presence in a document."""
    
    agent_id: str = Field(..., description="Agent ID")
    cursor_position: Optional[CursorPosition] = Field(None, description="Agent's current cursor position")
    last_activity: datetime = Field(default_factory=datetime.now, description="Last activity timestamp")
    is_active: bool = Field(True, description="Whether agent is actively editing")

# Document Operation Message Types

@dataclass
class CreateDocumentMessage(Event):
    """Message for creating a new shared document."""
    
    # Document creation specific fields
    document_name: str = field(default="")
    initial_content: Optional[str] = field(default="")
    access_permissions: Dict[str, str] = field(default_factory=dict)
    
    def __init__(self, event_name: str = "document.creation.requested", source_id: str = "", **kwargs):
        """Initialize CreateDocumentMessage with proper event name."""
        # Handle backward compatibility for sender_id
        if 'sender_id' in kwargs:
            source_id = kwargs.pop('sender_id')
        
        # Extract document creation specific fields
        document_name = kwargs.pop('document_name', '')
        initial_content = kwargs.pop('initial_content', '')
        access_permissions = kwargs.pop('access_permissions', {})
        
        # Call parent constructor
        super().__init__(event_name=event_name, source_id=source_id, **kwargs)
        
        # Set document creation specific fields
        self.document_name = document_name
        self.initial_content = initial_content
        self.access_permissions = access_permissions
    
    # Backward compatibility properties
    @property
    def message_id(self) -> str:
        """Backward compatibility: message_id maps to event_id."""
        return self.event_id
    
    @message_id.setter
    def message_id(self, value: str):
        """Backward compatibility: message_id maps to event_id."""
        self.event_id = value
    
    @property
    def sender_id(self) -> str:
        """Backward compatibility: sender_id maps to source_id."""
        return self.source_id
    
    @sender_id.setter
    def sender_id(self, value: str):
        """Backward compatibility: sender_id maps to source_id."""
        self.source_id = value
    
    @property
    def content(self) -> Dict[str, Any]:
        """Backward compatibility: content maps to payload."""
        return self.payload
    
    @content.setter
    def content(self, value: Dict[str, Any]):
        """Backward compatibility: content maps to payload."""
        self.payload = value
    
    @property
    def message_type(self) -> str:
        """Backward compatibility: message_type derived from class name."""
        return "create_document"
    
    def model_dump(self) -> Dict[str, Any]:
        """Pydantic-style model dump for backward compatibility."""
        return {
            "event_id": self.event_id,
            "event_name": self.event_name,
            "timestamp": self.timestamp,
            "source_id": self.source_id,
            "source_type": self.source_type,
            "target_agent_id": self.target_agent_id,
            "target_channel": self.target_channel,
            "relevant_mod": self.relevant_mod,
            "requires_response": self.requires_response,
            "response_to": self.response_to,
            "payload": self.payload,
            "metadata": self.metadata,
            "text_representation": self.text_representation,
            "visibility": self.visibility.value if hasattr(self.visibility, 'value') else self.visibility,
            "allowed_agents": list(self.allowed_agents) if self.allowed_agents else None,
            # Document creation specific fields
            "document_name": self.document_name,
            "initial_content": self.initial_content,
            "access_permissions": self.access_permissions,
            # Backward compatibility fields
            "message_id": self.event_id,
            "sender_id": self.source_id,
            "message_type": self.message_type,
            "content": self.payload  # Backward compatibility: content maps to payload
        }
    
    @field_validator('document_name')
    @classmethod
    def validate_document_name(cls, v):
        """Validate document name."""
        if len(v.strip()) == 0:
            raise ValueError('Document name cannot be empty')
        if len(v) > 255:
            raise ValueError('Document name cannot exceed 255 characters')
        return v.strip()

class OpenDocumentMessage(Event):
    """Message for opening an existing document."""
    
    document_id: str = Field(..., description="Document ID to open")
    
    def __init__(self, event_name: str = "document.open.requested", source_id: str = "", **kwargs):
        """Initialize OpenDocumentMessage with proper event name."""
        # Extract document open specific fields
        document_id = kwargs.pop('document_id', '')
        
        # Call parent constructor
        super().__init__(event_name=event_name, source_id=source_id, **kwargs)
        
        # Set document open specific fields
        self.document_id = document_id

class CloseDocumentMessage(Event):
    """Message for closing a document."""
    
    document_id: str = Field(..., description="Document ID to close")
    
    def __init__(self, event_name: str = "document.close.requested", source_id: str = "", **kwargs):
        """Initialize CloseDocumentMessage with proper event name."""
        # Extract document close specific fields
        document_id = kwargs.pop('document_id', '')
        
        # Call parent constructor
        super().__init__(event_name=event_name, source_id=source_id, **kwargs)
        
        # Set document close specific fields
        self.document_id = document_id

@dataclass
class InsertLinesMessage(Event):
    """Message for inserting lines into a document."""
    
    # Document-specific fields
    document_id: str = field(default="")
    line_number: int = field(default=1)
    content: List[str] = field(default_factory=list)
    
    def __init__(self, event_name: str = "document.insert_lines.requested", source_id: str = "", **kwargs):
        """Initialize InsertLinesMessage with proper event name."""
        # Handle backward compatibility for sender_id
        if 'sender_id' in kwargs:
            source_id = kwargs.pop('sender_id')
        
        # Extract document-specific fields
        document_id = kwargs.pop('document_id', '')
        line_number = kwargs.pop('line_number', 1)
        content = kwargs.pop('content', [])
        
        # Validate line number
        if line_number < 1:
            raise ValueError('Line number must be 1 or greater')
        
        # Validate content
        if len(content) == 0:
            raise ValueError('Content cannot be empty')
        for line in content:
            if len(line) > 10000:
                raise ValueError('Line length cannot exceed 10000 characters')
        
        # Call parent constructor
        super().__init__(event_name=event_name, source_id=source_id, **kwargs)
        
        # Set document-specific fields
        self.document_id = document_id
        self.line_number = line_number
        self.content = content
    
    # Backward compatibility properties
    @property
    def sender_id(self) -> str:
        """Backward compatibility: sender_id maps to source_id."""
        return self.source_id
    
    @sender_id.setter
    def sender_id(self, value: str):
        """Backward compatibility: sender_id maps to source_id."""
        self.source_id = value
    
    @property
    def message_type(self) -> str:
        """Backward compatibility: message_type derived from class name."""
        return "insert_lines"
    
    def model_dump(self) -> Dict[str, Any]:
        """Pydantic-style model dump for backward compatibility."""
        return {
            "event_id": self.event_id,
            "event_name": self.event_name,
            "timestamp": self.timestamp,
            "source_id": self.source_id,
            "source_type": self.source_type,
            "target_agent_id": self.target_agent_id,
            "target_channel": self.target_channel,
            "relevant_mod": self.relevant_mod,
            "requires_response": self.requires_response,
            "response_to": self.response_to,
            "payload": self.payload,
            "metadata": self.metadata,
            "text_representation": self.text_representation,
            "visibility": self.visibility.value if hasattr(self.visibility, 'value') else self.visibility,
            "allowed_agents": list(self.allowed_agents) if self.allowed_agents else None,
            # Document-specific fields
            "document_id": self.document_id,
            "line_number": self.line_number,
            "content": self.content,
            # Backward compatibility fields
            "message_id": self.event_id,
            "sender_id": self.source_id,
            "message_type": self.message_type
        }

class RemoveLinesMessage(Event):
    """Message for removing lines from a document."""
    
    message_type: str = Field("remove_lines", description="Remove lines message type")
    document_id: str = Field(..., description="Document ID")
    start_line: int = Field(..., description="Start line number to remove (1-based)")
    end_line: int = Field(..., description="End line number to remove (1-based, inclusive)")
    
    @field_validator('start_line', 'end_line')
    @classmethod
    def validate_line_numbers(cls, v):
        """Validate line numbers are positive."""
        if v < 1:
            raise ValueError('Line numbers must be 1 or greater')
        return v
    
    def model_post_init(self, __context):
        """Validate that start_line <= end_line."""
        if self.start_line > self.end_line:
            raise ValueError('start_line must be <= end_line')

class ReplaceLinesMessage(Event):
    """Message for replacing lines in a document."""
    
    message_type: str = Field("replace_lines", description="Replace lines message type")
    document_id: str = Field(..., description="Document ID")
    start_line: int = Field(..., description="Start line number to replace (1-based)")
    end_line: int = Field(..., description="End line number to replace (1-based, inclusive)")
    content: List[str] = Field(..., description="New content lines")
    
    @field_validator('start_line', 'end_line')
    @classmethod
    def validate_line_numbers(cls, v):
        """Validate line numbers are positive."""
        if v < 1:
            raise ValueError('Line numbers must be 1 or greater')
        return v
    
    @field_validator('content')
    @classmethod
    def validate_content(cls, v):
        """Validate content lines."""
        for line in v:
            if len(line) > 10000:
                raise ValueError('Line length cannot exceed 10000 characters')
        return v
    
    def model_post_init(self, __context):
        """Validate that start_line <= end_line."""
        if self.start_line > self.end_line:
            raise ValueError('start_line must be <= end_line')

@dataclass
class AddCommentMessage(Event):
    """Message for adding a comment to a document line."""
    
    # Document-specific fields
    document_id: str = field(default="")
    line_number: int = field(default=1)
    comment_text: str = field(default="")
    
    def __init__(self, event_name: str = "document.add_comment.requested", source_id: str = "", **kwargs):
        """Initialize AddCommentMessage with proper event name."""
        # Handle backward compatibility for sender_id
        if 'sender_id' in kwargs:
            source_id = kwargs.pop('sender_id')
        
        # Extract document-specific fields
        document_id = kwargs.pop('document_id', '')
        line_number = kwargs.pop('line_number', 1)
        comment_text = kwargs.pop('comment_text', '')
        
        # Validate line number
        if line_number < 1:
            raise ValueError('Line number must be 1 or greater')
        
        # Validate comment text
        comment_text = comment_text.strip()
        if len(comment_text) == 0:
            raise ValueError('Comment text cannot be empty')
        if len(comment_text) > 2000:
            raise ValueError('Comment text cannot exceed 2000 characters')
        
        # Call parent constructor
        super().__init__(event_name=event_name, source_id=source_id, **kwargs)
        
        # Set document-specific fields
        self.document_id = document_id
        self.line_number = line_number
        self.comment_text = comment_text
    
    # Backward compatibility properties
    @property
    def sender_id(self) -> str:
        """Backward compatibility: sender_id maps to source_id."""
        return self.source_id
    
    @sender_id.setter
    def sender_id(self, value: str):
        """Backward compatibility: sender_id maps to source_id."""
        self.source_id = value
    
    @property
    def message_type(self) -> str:
        """Backward compatibility: message_type derived from class name."""
        return "add_comment"
    
    def model_dump(self) -> Dict[str, Any]:
        """Pydantic-style model dump for backward compatibility."""
        return {
            "event_id": self.event_id,
            "event_name": self.event_name,
            "timestamp": self.timestamp,
            "source_id": self.source_id,
            "source_type": self.source_type,
            "target_agent_id": self.target_agent_id,
            "target_channel": self.target_channel,
            "relevant_mod": self.relevant_mod,
            "requires_response": self.requires_response,
            "response_to": self.response_to,
            "payload": self.payload,
            "metadata": self.metadata,
            "text_representation": self.text_representation,
            "visibility": self.visibility.value if hasattr(self.visibility, 'value') else self.visibility,
            "allowed_agents": list(self.allowed_agents) if self.allowed_agents else None,
            # Document-specific fields
            "document_id": self.document_id,
            "line_number": self.line_number,
            "comment_text": self.comment_text,
            # Backward compatibility fields
            "message_id": self.event_id,
            "sender_id": self.source_id,
            "message_type": self.message_type
        }

class RemoveCommentMessage(Event):
    """Message for removing a comment from a document."""
    
    message_type: str = Field("remove_comment", description="Remove comment message type")
    document_id: str = Field(..., description="Document ID")
    comment_id: str = Field(..., description="Comment ID to remove")

@dataclass
class UpdateCursorPositionMessage(Event):
    """Message for updating an agent's cursor position."""
    
    # Document-specific fields
    document_id: str = field(default="")
    cursor_position: Optional[CursorPosition] = field(default=None)
    
    def __init__(self, event_name: str = "document.cursor_position.updated", source_id: str = "", **kwargs):
        """Initialize UpdateCursorPositionMessage with proper event name."""
        # Handle backward compatibility for sender_id
        if 'sender_id' in kwargs:
            source_id = kwargs.pop('sender_id')
        
        # Extract document-specific fields
        document_id = kwargs.pop('document_id', '')
        cursor_position = kwargs.pop('cursor_position', None)
        
        # Call parent constructor
        super().__init__(event_name=event_name, source_id=source_id, **kwargs)
        
        # Set document-specific fields
        self.document_id = document_id
        self.cursor_position = cursor_position
    
    # Backward compatibility properties
    @property
    def message_id(self) -> str:
        """Backward compatibility: message_id maps to event_id."""
        return self.event_id
    
    @message_id.setter
    def message_id(self, value: str):
        """Backward compatibility: message_id maps to event_id."""
        self.event_id = value
    
    @property
    def sender_id(self) -> str:
        """Backward compatibility: sender_id maps to source_id."""
        return self.source_id
    
    @sender_id.setter
    def sender_id(self, value: str):
        """Backward compatibility: sender_id maps to source_id."""
        self.source_id = value
    
    @property
    def content(self) -> Dict[str, Any]:
        """Backward compatibility: content maps to payload."""
        return self.payload
    
    @content.setter
    def content(self, value: Dict[str, Any]):
        """Backward compatibility: content maps to payload."""
        self.payload = value
    
    @property
    def message_type(self) -> str:
        """Backward compatibility: message_type derived from class name."""
        return "update_cursor_position"
    
    def model_dump(self) -> Dict[str, Any]:
        """Pydantic-style model dump for backward compatibility."""
        return {
            "event_id": self.event_id,
            "event_name": self.event_name,
            "timestamp": self.timestamp,
            "source_id": self.source_id,
            "source_type": self.source_type,
            "target_agent_id": self.target_agent_id,
            "target_channel": self.target_channel,
            "relevant_mod": self.relevant_mod,
            "requires_response": self.requires_response,
            "response_to": self.response_to,
            "payload": self.payload,
            "metadata": self.metadata,
            "text_representation": self.text_representation,
            "visibility": self.visibility.value if hasattr(self.visibility, 'value') else self.visibility,
            "allowed_agents": list(self.allowed_agents) if self.allowed_agents else None,
            # Document-specific fields
            "document_id": self.document_id,
            "cursor_position": self.cursor_position.model_dump() if self.cursor_position else None,
            # Backward compatibility fields
            "message_id": self.event_id,
            "sender_id": self.source_id,
            "message_type": self.message_type,
            "content": self.payload  # Backward compatibility: content maps to payload
        }

class GetDocumentContentMessage(Event):
    """Message for requesting document content."""
    
    message_type: str = Field("get_document_content", description="Get document content message type")
    document_id: str = Field(..., description="Document ID")
    include_comments: bool = Field(True, description="Whether to include comments")
    include_presence: bool = Field(True, description="Whether to include agent presence")

class GetDocumentHistoryMessage(Event):
    """Message for requesting document operation history."""
    
    message_type: str = Field("get_document_history", description="Get document history message type")
    document_id: str = Field(..., description="Document ID")
    limit: int = Field(50, description="Maximum number of operations to retrieve")
    offset: int = Field(0, description="Number of operations to skip")
    
    @field_validator('limit')
    @classmethod
    def validate_limit(cls, v):
        """Validate limit parameter."""
        if not 1 <= v <= 500:
            raise ValueError('limit must be between 1 and 500')
        return v

class ListDocumentsMessage(Event):
    """Message for listing available documents."""
    
    message_type: str = Field("list_documents", description="List documents message type")
    include_closed: bool = Field(False, description="Whether to include closed documents")

class GetAgentPresenceMessage(Event):
    """Message for getting agent presence information."""
    
    message_type: str = Field("get_agent_presence", description="Get agent presence message type")
    document_id: str = Field(..., description="Document ID")

# Response message types

class DocumentOperationResponse(Event):
    """Response message for document operations."""
    
    message_type: str = Field("document_operation_response", description="Document operation response type")
    operation_id: str = Field(..., description="Original operation ID")
    success: bool = Field(..., description="Whether operation was successful")
    error_message: Optional[str] = Field(None, description="Error message if operation failed")
    conflict_detected: bool = Field(False, description="Whether a conflict was detected")
    conflict_details: Optional[Dict[str, Any]] = Field(None, description="Conflict resolution details")

class DocumentContentResponse(Event):
    """Response message containing document content."""
    
    message_type: str = Field("document_content_response", description="Document content response type")
    document_id: str = Field(..., description="Document ID")
    content: List[str] = Field(..., description="Document lines")
    comments: List[DocumentComment] = Field(default_factory=list, description="Document comments")
    agent_presence: List[AgentPresence] = Field(default_factory=list, description="Agent presence information")
    version: int = Field(..., description="Document version number")
    line_authors: Optional[Dict[int, str]] = Field(default_factory=dict, description="Line authorship mapping (line_number -> agent_id)")
    line_locks: Optional[Dict[int, str]] = Field(default_factory=dict, description="Line locks mapping (line_number -> agent_id)")

class DocumentListResponse(Event):
    """Response message containing list of documents."""
    
    message_type: str = Field("document_list_response", description="Document list response type")
    documents: List[Dict[str, Any]] = Field(..., description="List of document metadata")

class DocumentHistoryResponse(Event):
    """Response message containing document operation history."""
    
    message_type: str = Field("document_history_response", description="Document history response type")
    document_id: str = Field(..., description="Document ID")
    operations: List[Dict[str, Any]] = Field(..., description="Operation history")
    total_operations: int = Field(..., description="Total number of operations")

class AgentPresenceResponse(Event):
    """Response message containing agent presence information."""
    
    message_type: str = Field("agent_presence_response", description="Agent presence response type")
    document_id: str = Field(..., description="Document ID")
    agent_presence: List[AgentPresence] = Field(..., description="Agent presence information")

# Line Locking Messages
class AcquireLineLockMessage(Event):
    """Message to acquire a lock on a specific line."""
    
    message_type: str = Field("acquire_line_lock", description="Acquire line lock message type")
    document_id: str = Field(..., description="Document ID")
    line_number: int = Field(..., description="Line number to lock (1-based)")

class ReleaseLineLockMessage(Event):
    """Message to release a lock on a specific line."""
    
    message_type: str = Field("release_line_lock", description="Release line lock message type")
    document_id: str = Field(..., description="Document ID")
    line_number: int = Field(..., description="Line number to unlock (1-based)")

class LineLockResponse(Event):
    """Response message for line lock operations."""
    
    message_type: str = Field("line_lock_response", description="Line lock response type")
    document_id: str = Field(..., description="Document ID")
    line_number: int = Field(..., description="Line number")
    success: bool = Field(..., description="Whether the lock operation was successful")
    locked_by: Optional[str] = Field(None, description="Agent ID that holds the lock (if failed)")
    error_message: Optional[str] = Field(None, description="Error message if operation failed")
