"""Thread messaging specific message models for OpenAgents."""

from typing import Dict, List, Optional, Any, Union
from pydantic import BaseModel, Field, field_validator
from openagents.models.messages import BaseMessage

class DirectMessage(BaseMessage):
    """A direct message between two agents."""
    
    message_type: str = Field("direct_message", description="Direct message type")
    target_agent_id: str = Field(..., description="Recipient agent ID")
    quoted_message_id: Optional[str] = Field(None, description="ID of a message being quoted")
    quoted_text: Optional[str] = Field(None, description="Excerpt of quoted message text")

class ChannelMessage(BaseMessage):
    """A message sent to a channel."""
    
    message_type: str = Field("channel_message", description="Channel message type")
    channel: str = Field(..., description="Channel name")
    mentioned_agent_id: Optional[str] = Field(None, description="Agent being mentioned/tagged in the channel")
    quoted_message_id: Optional[str] = Field(None, description="ID of a message being quoted")
    quoted_text: Optional[str] = Field(None, description="Excerpt of quoted message text")

class ReplyMessage(BaseMessage):
    """A reply message that creates or continues a thread."""
    
    message_type: str = Field("reply_message", description="Reply message type")
    reply_to_id: str = Field(..., description="ID of the message being replied to")
    target_agent_id: Optional[str] = Field(None, description="Target agent for direct message replies")
    channel: Optional[str] = Field(None, description="Channel name for channel replies")
    thread_level: int = Field(1, description="Nesting level of the reply (1-5)")
    quoted_message_id: Optional[str] = Field(None, description="ID of a message being quoted")
    quoted_text: Optional[str] = Field(None, description="Excerpt of quoted message text")
    
    @field_validator('thread_level')
    @classmethod
    def validate_thread_level(cls, v):
        """Validate thread nesting level."""
        if not 1 <= v <= 5:
            raise ValueError('thread_level must be between 1 and 5')
        return v

class FileUploadMessage(BaseMessage):
    """Message for file upload operations."""
    
    message_type: str = Field("file_upload", description="File upload message type")
    file_content: str = Field(..., description="Base64 encoded file content")
    filename: str = Field(..., description="Original filename")
    mime_type: str = Field("application/octet-stream", description="MIME type of the file")
    file_size: int = Field(..., description="Size of the file in bytes")

class FileOperationMessage(BaseMessage):
    """Message for file operations like download."""
    
    message_type: str = Field("file_operation", description="File operation message type")
    action: str = Field(..., description="File operation action")
    file_id: Optional[str] = Field(None, description="File UUID for operations")
    
    @field_validator('action')
    @classmethod
    def validate_action(cls, v):
        """Validate file operation action."""
        valid_actions = ["upload", "download", "list_channels"]
        if v not in valid_actions:
            raise ValueError(f'action must be one of: {", ".join(valid_actions)}')
        return v

class ChannelInfoMessage(BaseMessage):
    """Message for channel information requests."""
    
    message_type: str = Field("channel_info", description="Channel info message type")
    action: str = Field("list_channels", description="Channel info action")
    
    @field_validator('action')
    @classmethod
    def validate_action(cls, v):
        """Validate channel info action."""
        valid_actions = ["list_channels"]
        if v not in valid_actions:
            raise ValueError(f'action must be one of: {", ".join(valid_actions)}')
        return v

class MessageRetrievalMessage(BaseMessage):
    """Message for retrieving channel or direct messages."""
    
    message_type: str = Field("message_retrieval", description="Message retrieval message type")
    action: str = Field(..., description="Retrieval action (retrieve_channel_messages or retrieve_direct_messages)")
    channel: Optional[str] = Field(None, description="Channel name for channel message retrieval")
    target_agent_id: Optional[str] = Field(None, description="Target agent ID for direct message retrieval")
    limit: int = Field(50, description="Maximum number of messages to retrieve")
    offset: int = Field(0, description="Number of messages to skip (for pagination)")
    include_threads: bool = Field(True, description="Whether to include threaded messages")
    
    @field_validator('action')
    @classmethod
    def validate_action(cls, v):
        """Validate retrieval action."""
        valid_actions = ["retrieve_channel_messages", "retrieve_direct_messages"]
        if v not in valid_actions:
            raise ValueError(f'action must be one of: {", ".join(valid_actions)}')
        return v
    
    @field_validator('limit')
    @classmethod
    def validate_limit(cls, v):
        """Validate limit parameter."""
        if not 1 <= v <= 500:
            raise ValueError('limit must be between 1 and 500')
        return v

class ReactionMessage(BaseMessage):
    """Message for adding reactions to other messages."""
    
    message_type: str = Field("reaction", description="Reaction message type")
    target_message_id: str = Field(..., description="ID of the message being reacted to")
    reaction_type: str = Field(..., description="Type of reaction emoji")
    action: str = Field("add", description="Action: 'add' or 'remove'")
    
    @field_validator('reaction_type')
    @classmethod
    def validate_reaction_type(cls, v):
        """Validate reaction type."""
        # Common emoji reactions
        valid_reactions = [
            "+1", "-1", "like", "heart", "laugh", "wow", "sad", "angry",
            "thumbs_up", "thumbs_down", "smile", "ok", "done", "fire",
            "party", "clap", "check", "cross", "eyes", "thinking"
        ]
        if v not in valid_reactions:
            raise ValueError(f'reaction_type must be one of: {", ".join(valid_reactions)}')
        return v
    
    @field_validator('action')
    @classmethod
    def validate_action(cls, v):
        """Validate reaction action."""
        valid_actions = ["add", "remove"]
        if v not in valid_actions:
            raise ValueError(f'action must be one of: {", ".join(valid_actions)}')
        return v
