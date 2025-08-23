"""Shared document specific message models for OpenAgents."""

import uuid
from typing import Dict, List, Optional, Any, Union
from datetime import datetime
from pydantic import BaseModel, Field, field_validator
from openagents.models.messages import BaseMessage

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

class CreateDocumentMessage(BaseMessage):
    """Message for creating a new shared document."""
    
    message_type: str = Field("create_document", description="Create document message type")
    document_name: str = Field(..., description="Name of the document")
    initial_content: Optional[str] = Field("", description="Initial document content")
    access_permissions: Dict[str, str] = Field(default_factory=dict, description="Agent access permissions")
    
    @field_validator('document_name')
    @classmethod
    def validate_document_name(cls, v):
        """Validate document name."""
        if len(v.strip()) == 0:
            raise ValueError('Document name cannot be empty')
        if len(v) > 255:
            raise ValueError('Document name cannot exceed 255 characters')
        return v.strip()

class OpenDocumentMessage(BaseMessage):
    """Message for opening an existing document."""
    
    message_type: str = Field("open_document", description="Open document message type")
    document_id: str = Field(..., description="Document ID to open")

class CloseDocumentMessage(BaseMessage):
    """Message for closing a document."""
    
    message_type: str = Field("close_document", description="Close document message type")
    document_id: str = Field(..., description="Document ID to close")

class InsertLinesMessage(BaseMessage):
    """Message for inserting lines into a document."""
    
    message_type: str = Field("insert_lines", description="Insert lines message type")
    document_id: str = Field(..., description="Document ID")
    line_number: int = Field(..., description="Line number to insert at (1-based)")
    content: List[str] = Field(..., description="Lines to insert")
    
    @field_validator('line_number')
    @classmethod
    def validate_line_number(cls, v):
        """Validate line number is positive."""
        if v < 1:
            raise ValueError('Line number must be 1 or greater')
        return v
    
    @field_validator('content')
    @classmethod
    def validate_content(cls, v):
        """Validate content lines."""
        if len(v) == 0:
            raise ValueError('Content cannot be empty')
        for line in v:
            if len(line) > 10000:
                raise ValueError('Line length cannot exceed 10000 characters')
        return v

class RemoveLinesMessage(BaseMessage):
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

class ReplaceLinesMessage(BaseMessage):
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

class AddCommentMessage(BaseMessage):
    """Message for adding a comment to a document line."""
    
    message_type: str = Field("add_comment", description="Add comment message type")
    document_id: str = Field(..., description="Document ID")
    line_number: int = Field(..., description="Line number to comment on (1-based)")
    comment_text: str = Field(..., description="Comment content")
    
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
        """Validate comment text."""
        if len(v.strip()) == 0:
            raise ValueError('Comment text cannot be empty')
        if len(v) > 2000:
            raise ValueError('Comment text cannot exceed 2000 characters')
        return v.strip()

class RemoveCommentMessage(BaseMessage):
    """Message for removing a comment from a document."""
    
    message_type: str = Field("remove_comment", description="Remove comment message type")
    document_id: str = Field(..., description="Document ID")
    comment_id: str = Field(..., description="Comment ID to remove")

class UpdateCursorPositionMessage(BaseMessage):
    """Message for updating an agent's cursor position."""
    
    message_type: str = Field("update_cursor_position", description="Update cursor position message type")
    document_id: str = Field(..., description="Document ID")
    cursor_position: CursorPosition = Field(..., description="New cursor position")

class GetDocumentContentMessage(BaseMessage):
    """Message for requesting document content."""
    
    message_type: str = Field("get_document_content", description="Get document content message type")
    document_id: str = Field(..., description="Document ID")
    include_comments: bool = Field(True, description="Whether to include comments")
    include_presence: bool = Field(True, description="Whether to include agent presence")

class GetDocumentHistoryMessage(BaseMessage):
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

class ListDocumentsMessage(BaseMessage):
    """Message for listing available documents."""
    
    message_type: str = Field("list_documents", description="List documents message type")
    include_closed: bool = Field(False, description="Whether to include closed documents")

class GetAgentPresenceMessage(BaseMessage):
    """Message for getting agent presence information."""
    
    message_type: str = Field("get_agent_presence", description="Get agent presence message type")
    document_id: str = Field(..., description="Document ID")

# Response message types

class DocumentOperationResponse(BaseMessage):
    """Response message for document operations."""
    
    message_type: str = Field("document_operation_response", description="Document operation response type")
    operation_id: str = Field(..., description="Original operation ID")
    success: bool = Field(..., description="Whether operation was successful")
    error_message: Optional[str] = Field(None, description="Error message if operation failed")
    conflict_detected: bool = Field(False, description="Whether a conflict was detected")
    conflict_details: Optional[Dict[str, Any]] = Field(None, description="Conflict resolution details")

class DocumentContentResponse(BaseMessage):
    """Response message containing document content."""
    
    message_type: str = Field("document_content_response", description="Document content response type")
    document_id: str = Field(..., description="Document ID")
    content: List[str] = Field(..., description="Document lines")
    comments: List[DocumentComment] = Field(default_factory=list, description="Document comments")
    agent_presence: List[AgentPresence] = Field(default_factory=list, description="Agent presence information")
    version: int = Field(..., description="Document version number")

class DocumentListResponse(BaseMessage):
    """Response message containing list of documents."""
    
    message_type: str = Field("document_list_response", description="Document list response type")
    documents: List[Dict[str, Any]] = Field(..., description="List of document metadata")

class DocumentHistoryResponse(BaseMessage):
    """Response message containing document operation history."""
    
    message_type: str = Field("document_history_response", description="Document history response type")
    document_id: str = Field(..., description="Document ID")
    operations: List[Dict[str, Any]] = Field(..., description="Operation history")
    total_operations: int = Field(..., description="Total number of operations")

class AgentPresenceResponse(BaseMessage):
    """Response message containing agent presence information."""
    
    message_type: str = Field("agent_presence_response", description="Agent presence response type")
    document_id: str = Field(..., description="Document ID")
    agent_presence: List[AgentPresence] = Field(..., description="Agent presence information")
