"""
Event context models for OpenAgents.

This module provides context models for different types of events and messages
in the OpenAgents system. These models unify event handling and provide a clean
interface for agent event processing.
"""

import re
from typing import Dict, List, Optional, Any
from pydantic import BaseModel, Field, ConfigDict

from openagents.models.event_thread import EventThread
from openagents.models.event import Event


class EventContext(BaseModel):
    """Unified context for all event types containing incoming event, event threads, and thread ID."""

    incoming_event: Event = Field(..., description="The incoming event/message")
    event_threads: Dict[str, EventThread] = Field(
        ..., description="All available event threads"
    )
    incoming_thread_id: str = Field(
        ..., description="ID of the thread containing the incoming message"
    )

    model_config = ConfigDict(arbitrary_types_allowed=True)

    @property
    def text(self) -> str:
        """Extract text content from the incoming event."""
        if isinstance(self.incoming_event.payload, dict):
            # Handle nested content structure (payload.content.text)
            if "content" in self.incoming_event.payload and isinstance(
                self.incoming_event.payload["content"], dict
            ):
                return self.incoming_event.payload["content"].get("text", "")
            else:
                return ""
        return str(self.incoming_event.payload)

    @property
    def message_id(self) -> str:
        """Get the message ID from the incoming event."""
        return self.incoming_event.event_id

    @property
    def source_id(self) -> str:
        """Get the source ID from the incoming event."""
        return self.incoming_event.source_id

    @property
    def timestamp(self) -> int:
        """Get the timestamp from the incoming event."""
        return self.incoming_event.timestamp

    @property
    def payload(self) -> Dict[str, Any]:
        """Get the payload from the incoming event."""
        return self.incoming_event.payload

    @property
    def raw_message(self) -> Event:
        """Get the raw message (for backward compatibility)."""
        return self.incoming_event


class ChannelMessageContext(EventContext):
    """Context for channel messages."""

    channel: str = Field(..., description="Channel name")
    mentioned_agent_id: Optional[str] = Field(None, description="ID of mentioned agent")
    quoted_message_id: Optional[str] = Field(None, description="ID of quoted message")
    quoted_text: Optional[str] = Field(None, description="Text of quoted message")

    @property
    def mentions(self) -> List[str]:
        """Extract all mentioned agent IDs from the message text."""
        # Look for @agent_id patterns in the text
        mention_pattern = r"@([a-zA-Z0-9_-]+)"
        return re.findall(mention_pattern, self.text)


class ReplyMessageContext(EventContext):
    """Context for reply messages."""

    reply_to_id: str = Field(..., description="ID of the message being replied to")
    target_agent_id: Optional[str] = Field(None, description="Target agent ID")
    channel: Optional[str] = Field(None, description="Channel name")
    thread_level: int = Field(1, description="Thread nesting level")
    quoted_message_id: Optional[str] = Field(None, description="ID of quoted message")
    quoted_text: Optional[str] = Field(None, description="Text of quoted message")


class ReactionContext(BaseModel):
    """Context for reaction messages."""

    message_id: str = Field(..., description="ID of the reaction message")
    target_message_id: str = Field(
        ..., description="ID of the message being reacted to"
    )
    reactor_id: str = Field(..., description="ID of the agent adding the reaction")
    reaction_type: str = Field(..., description="Type/emoji of the reaction")
    action: str = Field(..., description="Action: 'add' or 'remove'")
    timestamp: int = Field(..., description="Timestamp of the reaction")
    raw_message: Event = Field(..., description="Raw event message")

    model_config = ConfigDict(arbitrary_types_allowed=True)


class FileContext(BaseModel):
    """Context for file messages."""

    message_id: str = Field(..., description="ID of the file message")
    source_id: str = Field(..., description="ID of the agent sending the file")
    filename: str = Field(..., description="Name of the file")
    file_content: str = Field(..., description="Base64 encoded file content")
    mime_type: str = Field(..., description="MIME type of the file")
    file_size: int = Field(..., description="Size of the file in bytes")
    timestamp: int = Field(..., description="Timestamp of the file message")
    raw_message: Event = Field(..., description="Raw event message")

    model_config = ConfigDict(arbitrary_types_allowed=True)

    @property
    def content_bytes(self) -> bytes:
        """Decode the base64 file content to bytes."""
        import base64

        return base64.b64decode(self.file_content)

    @property
    def payload_bytes(self) -> bytes:
        """Decode the base64 file content to bytes (modern API name)."""
        return self.content_bytes


# Project-related context classes (only available if project mod is enabled)
class ProjectEventContext(BaseModel):
    """Base context for project events."""

    project_id: str = Field(..., description="ID of the project")
    project_name: str = Field(..., description="Name of the project")
    event_type: str = Field(..., description="Type of the project event")
    timestamp: int = Field(..., description="Timestamp of the event")
    source_agent_id: str = Field(
        ..., description="ID of the agent that triggered the event"
    )
    data: Dict[str, Any] = Field(..., description="Event data")
    raw_event: Any = Field(..., description="Raw event object")

    model_config = ConfigDict(arbitrary_types_allowed=True)

    @property
    def project_channel(self) -> Optional[str]:
        """Get the project channel name if available."""
        return self.data.get("channel_name")


class ProjectCompletedContext(ProjectEventContext):
    """Context for project completion events."""

    results: Dict[str, Any] = Field(
        default_factory=dict, description="Project completion results"
    )
    completed_by: str = Field("", description="ID of agent that completed the project")
    completion_summary: str = Field("", description="Summary of project completion")

    def model_post_init(self, __context) -> None:
        # Extract completion-specific data
        if "results" in self.data:
            self.results = self.data["results"]
        if "completed_by" in self.data:
            self.completed_by = self.data["completed_by"]
        if "completion_summary" in self.data:
            self.completion_summary = self.data["completion_summary"]


class ProjectFailedContext(ProjectEventContext):
    """Context for project failure events."""

    error_message: str = Field("", description="Error message describing the failure")
    error_type: str = Field("", description="Type of error that occurred")
    failed_by: str = Field("", description="ID of agent that caused the failure")

    def model_post_init(self, __context) -> None:
        # Extract failure-specific data
        if "error_message" in self.data:
            self.error_message = self.data["error_message"]
        if "error_type" in self.data:
            self.error_type = self.data["error_type"]
        if "failed_by" in self.data:
            self.failed_by = self.data["failed_by"]


class ProjectMessageContext(ProjectEventContext):
    """Context for project channel messages."""

    channel: str = Field("", description="Channel name")
    message_text: str = Field("", description="Text content of the message")
    sender_id: str = Field("", description="ID of the message sender")
    message_id: str = Field("", description="ID of the message")

    def model_post_init(self, __context) -> None:
        # Extract message-specific data
        if "channel" in self.data:
            self.channel = self.data["channel"]
        if "message_text" in self.data:
            self.message_text = self.data["message_text"]
        if "message_id" in self.data:
            self.message_id = self.data["message_id"]


class ProjectInputContext(ProjectEventContext):
    """Context for project input requirements."""

    input_type: str = Field("", description="Type of input required")
    prompt: str = Field("", description="Prompt for the input")
    options: List[str] = Field(default_factory=list, description="Available options")
    timeout: Optional[int] = Field(None, description="Timeout for input in seconds")

    def model_post_init(self, __context) -> None:
        # Extract input-specific data
        if "input_type" in self.data:
            self.input_type = self.data["input_type"]
        if "prompt" in self.data:
            self.prompt = self.data["prompt"]
        if "options" in self.data:
            self.options = self.data["options"]
        if "timeout" in self.data:
            self.timeout = self.data["timeout"]


class ProjectNotificationContext(ProjectEventContext):
    """Context for project notifications."""

    notification_type: str = Field("", description="Type of notification")
    content: Dict[str, Any] = Field(
        default_factory=dict, description="Notification content"
    )
    target_agent_id: Optional[str] = Field(
        None, description="Target agent ID for the notification"
    )

    def model_post_init(self, __context) -> None:
        # Extract notification-specific data
        if "notification_type" in self.data:
            self.notification_type = self.data["notification_type"]
        if "content" in self.data:
            self.content = self.data["content"]
        if "target_agent_id" in self.data:
            self.target_agent_id = self.data["target_agent_id"]


class ProjectAgentContext(ProjectEventContext):
    """Context for project agent join/leave events."""

    agent_id: str = Field("", description="ID of the agent joining/leaving")
    action: str = Field("", description="Action: 'joined' or 'left'")

    def model_post_init(self, __context) -> None:
        # Extract agent-specific data
        if "agent_id" in self.data:
            self.agent_id = self.data["agent_id"]
        if "action" in self.data:
            self.action = self.data["action"]
