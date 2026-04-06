"""Message definitions for the documents mod.

This module defines all message types used in the documents mod for
document management.
"""

import uuid
from typing import Dict, List, Optional, Any
from datetime import datetime
from pydantic import BaseModel, Field, field_validator
from openagents.models.event import Event
from dataclasses import dataclass, field


class DocumentOperation(BaseModel):
    """Base class for document operations."""

    operation_id: str = Field(
        default_factory=lambda: str(uuid.uuid4()), description="Unique operation ID"
    )
    document_id: str = Field(..., description="Document ID")
    agent_id: str = Field(..., description="Agent performing the operation")
    timestamp: datetime = Field(
        default_factory=datetime.now, description="Operation timestamp"
    )
    operation_type: str = Field(..., description="Type of operation (create, save, rename)")


# Document Operation Message Types


@dataclass
class CreateDocumentMessage(Event):
    """Message for creating a new document."""

    # Document creation specific fields
    document_name: str = field(default="")
    initial_content: Optional[str] = field(default="")
    access_permissions: Dict[str, str] = field(default_factory=dict)

    def __init__(
        self,
        event_name: str = "document.create",
        source_id: str = "",
        **kwargs,
    ):
        """Initialize CreateDocumentMessage with proper event name."""
        # Handle backward compatibility for sender_id
        if "sender_id" in kwargs:
            source_id = kwargs.pop("sender_id")

        # Extract document creation specific fields
        document_name = kwargs.pop("document_name", "")
        initial_content = kwargs.pop("initial_content", "")
        access_permissions = kwargs.pop("access_permissions", {})

        # Call parent constructor with required positional arguments
        super().__init__(event_name, source_id, **kwargs)

        # Set document creation specific fields
        self.document_name = document_name
        self.initial_content = initial_content
        self.access_permissions = access_permissions


@dataclass
class SaveDocumentMessage(Event):
    """Message for saving document content."""

    document_id: str = field(default="")
    document_content: str = field(default="")

    def __init__(
        self,
        event_name: str = "document.save",
        source_id: str = "",
        **kwargs,
    ):
        """Initialize SaveDocumentMessage with proper event name."""
        if "sender_id" in kwargs:
            source_id = kwargs.pop("sender_id")

        document_id = kwargs.pop("document_id", "")
        content = kwargs.pop("content", "")

        super().__init__(event_name, source_id, **kwargs)

        self.document_id = document_id
        self.document_content = content

    @property
    def content(self) -> str:
        """Backward compatibility: content maps to document_content."""
        return self.document_content

    @content.setter
    def content(self, value: str):
        """Backward compatibility: content maps to document_content."""
        object.__setattr__(self, "document_content", value)


@dataclass
class RenameDocumentMessage(Event):
    """Message for renaming a document."""

    document_id: str = field(default="")
    new_name: str = field(default="")

    def __init__(
        self,
        event_name: str = "document.rename",
        source_id: str = "",
        **kwargs,
    ):
        """Initialize RenameDocumentMessage with proper event name."""
        if "sender_id" in kwargs:
            source_id = kwargs.pop("sender_id")

        document_id = kwargs.pop("document_id", "")
        new_name = kwargs.pop("new_name", "")

        super().__init__(event_name, source_id, **kwargs)

        self.document_id = document_id
        self.new_name = new_name


class GetDocumentMessage(Event):
    """Message for requesting document content."""

    document_id: str = Field(..., description="Document ID")

    def __init__(
        self, event_name: str = "document.get", source_id: str = "", **kwargs
    ):
        """Initialize GetDocumentMessage with proper event name."""
        if "sender_id" in kwargs:
            source_id = kwargs.pop("sender_id")

        document_id = kwargs.pop("document_id", "")

        if "payload" not in kwargs:
            kwargs["payload"] = {}
        kwargs["payload"]["message_type"] = "get_document"

        super().__init__(event_name, source_id, **kwargs)

        self.document_id = document_id


class GetDocumentHistoryMessage(Event):
    """Message for requesting document operation history."""

    document_id: str = Field(..., description="Document ID")
    limit: int = Field(50, description="Maximum number of operations to retrieve")
    offset: int = Field(0, description="Number of operations to skip")

    def __init__(
        self, event_name: str = "document.get_history", source_id: str = "", **kwargs
    ):
        """Initialize GetDocumentHistoryMessage with proper event name."""
        if "sender_id" in kwargs:
            source_id = kwargs.pop("sender_id")

        document_id = kwargs.pop("document_id", "")
        limit = kwargs.pop("limit", 50)
        offset = kwargs.pop("offset", 0)

        if "payload" not in kwargs:
            kwargs["payload"] = {}
        kwargs["payload"]["message_type"] = "get_document_history"

        super().__init__(event_name, source_id, **kwargs)

        self.document_id = document_id
        self.limit = limit
        self.offset = offset

    @field_validator("limit")
    @classmethod
    def validate_limit(cls, v):
        """Validate limit parameter."""
        if not 1 <= v <= 500:
            raise ValueError("limit must be between 1 and 500")
        return v


class ListDocumentsMessage(Event):
    """Message for listing available documents."""

    def __init__(
        self, event_name: str = "document.list", source_id: str = "", **kwargs
    ):
        """Initialize ListDocumentsMessage with proper event name."""
        if "sender_id" in kwargs:
            source_id = kwargs.pop("sender_id")

        if "payload" not in kwargs:
            kwargs["payload"] = {}
        kwargs["payload"]["message_type"] = "list_documents"

        super().__init__(event_name, source_id, **kwargs)


# Response message types


class DocumentOperationResponse(Event):
    """Response message for document operations."""

    success: bool = Field(..., description="Whether operation was successful")
    message: Optional[str] = Field(None, description="Response message")
    error: Optional[str] = Field(None, description="Error message if operation failed")

    def __init__(
        self,
        event_name: str = "document.operation.response",
        source_id: str = "",
        **kwargs,
    ):
        """Initialize DocumentOperationResponse with proper event name."""
        if "sender_id" in kwargs:
            source_id = kwargs.pop("sender_id")

        success = kwargs.pop("success", False)
        message = kwargs.pop("message", None)
        error = kwargs.pop("error", None)

        if "payload" not in kwargs:
            kwargs["payload"] = {}
        kwargs["payload"]["message_type"] = "document_operation_response"

        super().__init__(event_name, source_id, **kwargs)

        self.success = success
        self.message = message
        self.error = error


class DocumentGetResponse(Event):
    """Response message containing document content."""

    document_id: str = Field(..., description="Document ID")
    document_name: str = Field(..., description="Document name")
    document_content: str = Field(..., description="Document content")
    version: int = Field(..., description="Document version number")
    creator_agent_id: str = Field(..., description="Creator agent ID")
    created_timestamp: datetime = Field(..., description="Creation timestamp")
    last_modified: datetime = Field(..., description="Last modification timestamp")

    def __init__(
        self,
        event_name: str = "document.get.response",
        source_id: str = "",
        **kwargs,
    ):
        """Initialize DocumentGetResponse with proper event name."""
        if "sender_id" in kwargs:
            source_id = kwargs.pop("sender_id")

        document_id = kwargs.pop("document_id", "")
        document_name = kwargs.pop("document_name", "")
        content = kwargs.pop("content", "")
        version = kwargs.pop("version", 1)
        creator_agent_id = kwargs.pop("creator_agent_id", "")
        created_timestamp = kwargs.pop("created_timestamp", datetime.now())
        last_modified = kwargs.pop("last_modified", datetime.now())

        if "payload" not in kwargs:
            kwargs["payload"] = {}
        kwargs["payload"]["message_type"] = "document_get_response"

        super().__init__(event_name, source_id, **kwargs)

        self.document_id = document_id
        self.document_name = document_name
        self.document_content = content
        self.version = version
        self.creator_agent_id = creator_agent_id
        self.created_timestamp = created_timestamp
        self.last_modified = last_modified

    @property
    def content(self) -> str:
        """Backward compatibility: content maps to document_content."""
        return self.document_content

    @content.setter
    def content(self, value: str):
        """Backward compatibility: content maps to document_content."""
        self.document_content = value


class DocumentListResponse(Event):
    """Response message containing list of documents."""

    documents: List[Dict[str, Any]] = Field(
        ..., description="List of document metadata"
    )

    def __init__(
        self, event_name: str = "document.list.response", source_id: str = "", **kwargs
    ):
        """Initialize DocumentListResponse with proper event name."""
        if "sender_id" in kwargs:
            source_id = kwargs.pop("sender_id")

        documents = kwargs.pop("documents", [])

        if "payload" not in kwargs:
            kwargs["payload"] = {}
        kwargs["payload"]["message_type"] = "document_list_response"

        super().__init__(event_name, source_id, **kwargs)

        self.documents = documents


class DocumentHistoryResponse(Event):
    """Response message containing document operation history."""

    document_id: str = Field(..., description="Document ID")
    operations: List[Dict[str, Any]] = Field(..., description="Operation history")
    total_operations: int = Field(..., description="Total number of operations")

    def __init__(
        self,
        event_name: str = "document.history.response",
        source_id: str = "",
        **kwargs,
    ):
        """Initialize DocumentHistoryResponse with proper event name."""
        if "sender_id" in kwargs:
            source_id = kwargs.pop("sender_id")

        document_id = kwargs.pop("document_id", "")
        operations = kwargs.pop("operations", [])
        total_operations = kwargs.pop("total_operations", 0)

        if "payload" not in kwargs:
            kwargs["payload"] = {}
        kwargs["payload"]["message_type"] = "document_history_response"

        super().__init__(event_name, source_id, **kwargs)

        self.document_id = document_id
        self.operations = operations
        self.total_operations = total_operations
