"""
Streaming response models for OpenAgents.

This module provides data models for streaming responses via Server-Sent Events (SSE).
"""

from enum import Enum
from typing import Any, Optional, Dict
from pydantic import BaseModel, Field


class StreamEventType(str, Enum):
    """Types of streaming events."""

    # Connection lifecycle events
    CONNECTED = "connected"
    DISCONNECTED = "disconnected"
    HEARTBEAT = "heartbeat"

    # Response events
    CHUNK = "chunk"              # Incremental content chunk
    PROGRESS = "progress"        # Progress update
    COMPLETE = "complete"        # Final response
    ERROR = "error"              # Error occurred

    # Agent-specific events
    AGENT_THINKING = "agent_thinking"    # Agent is processing
    AGENT_RESPONSE = "agent_response"    # Agent response chunk
    TOOL_CALL = "tool_call"              # Tool invocation
    TOOL_RESULT = "tool_result"          # Tool result


class StreamChunk(BaseModel):
    """A single chunk in a streaming response."""

    event_type: StreamEventType = Field(..., description="Type of stream event")
    data: Optional[Any] = Field(None, description="Event data payload")
    chunk_index: Optional[int] = Field(None, description="Index of this chunk in the stream")
    is_final: bool = Field(False, description="Whether this is the final chunk")
    event_id: Optional[str] = Field(None, description="Associated event ID")
    source_id: Optional[str] = Field(None, description="Source agent ID")
    timestamp: Optional[int] = Field(None, description="Unix timestamp")
    metadata: Optional[Dict[str, Any]] = Field(None, description="Additional metadata")

    def to_sse_format(self) -> str:
        """Convert to SSE format string."""
        import json
        data_str = json.dumps(self.model_dump(exclude_none=True))
        return f"event: {self.event_type.value}\ndata: {data_str}\n\n"


class StreamRequest(BaseModel):
    """Request to initiate a streaming connection."""

    event_name: str = Field(..., description="Event name to stream")
    source_id: str = Field(..., description="Source agent ID")
    target_agent_id: Optional[str] = Field(None, description="Target agent ID")
    payload: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Event payload")
    event_id: Optional[str] = Field(None, description="Custom event ID")
    metadata: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Event metadata")
    visibility: str = Field("network", description="Event visibility")
    secret: Optional[str] = Field(None, description="Secret for authentication")


class StreamSession(BaseModel):
    """Represents an active streaming session."""

    session_id: str = Field(..., description="Unique session identifier")
    source_id: str = Field(..., description="Client source ID")
    created_at: int = Field(..., description="Session creation timestamp")
    is_active: bool = Field(True, description="Whether session is active")
    chunk_count: int = Field(0, description="Number of chunks sent")
    last_activity: int = Field(..., description="Last activity timestamp")
    event_filters: Optional[list] = Field(None, description="Event name filters")
