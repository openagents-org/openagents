"""Thread messaging specific message models for OpenAgents."""

from typing import Dict, List, Optional, Any, Union
from pydantic import BaseModel, Field, field_validator
from openagents.models.event import Event
from dataclasses import dataclass, field

@dataclass
class DirectMessage(Event):
    """A direct message between two agents."""
    
    # Thread messaging specific fields
    quoted_message_id: Optional[str] = field(default=None)
    quoted_text: Optional[str] = field(default=None)
    
    def __init__(self, event_name: str = "thread.direct_message.sent", source_id: str = "", **kwargs):
        """Initialize DirectMessage with proper event name."""
        # Handle backward compatibility for sender_id
        if 'sender_id' in kwargs:
            source_id = kwargs.pop('sender_id')
        
        # Extract direct message specific fields
        target_agent_id = kwargs.pop('target_agent_id', '')
        quoted_message_id = kwargs.pop('quoted_message_id', None)
        quoted_text = kwargs.pop('quoted_text', None)
        
        # Set target_agent_id in kwargs for Event
        kwargs['target_agent_id'] = target_agent_id
        
        # Call parent constructor
        super().__init__(event_name=event_name, source_id=source_id, **kwargs)
        
        # Set direct message specific fields
        self.quoted_message_id = quoted_message_id
        self.quoted_text = quoted_text
    
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
        return "direct_message"
    
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
            # Thread messaging specific fields
            "quoted_message_id": self.quoted_message_id,
            "quoted_text": self.quoted_text,
            # Backward compatibility fields
            "message_id": self.event_id,
            "sender_id": self.source_id,
            "message_type": self.message_type,
            "content": self.payload  # Backward compatibility: content maps to payload
        }

@dataclass
class ChannelMessage(Event):
    """A message sent to a channel."""
    
    # Thread messaging specific fields
    channel: str = field(default="")
    mentioned_agent_id: Optional[str] = field(default=None)
    quoted_message_id: Optional[str] = field(default=None)
    quoted_text: Optional[str] = field(default=None)
    
    def __init__(self, event_name: str = "thread.channel_message.posted", source_id: str = "", **kwargs):
        """Initialize ChannelMessage with proper event name."""
        # Handle backward compatibility for sender_id
        if 'sender_id' in kwargs:
            source_id = kwargs.pop('sender_id')
        
        # Extract channel message specific fields
        channel = kwargs.pop('channel', '')
        mentioned_agent_id = kwargs.pop('mentioned_agent_id', None)
        quoted_message_id = kwargs.pop('quoted_message_id', None)
        quoted_text = kwargs.pop('quoted_text', None)
        
        # Set target_channel in kwargs for Event
        kwargs['target_channel'] = channel
        
        # Call parent constructor
        super().__init__(event_name=event_name, source_id=source_id, **kwargs)
        
        # Set channel message specific fields
        self.channel = channel
        self.mentioned_agent_id = mentioned_agent_id
        self.quoted_message_id = quoted_message_id
        self.quoted_text = quoted_text
    
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
        return "channel_message"
    
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
            # Thread messaging specific fields
            "channel": self.channel,
            "mentioned_agent_id": self.mentioned_agent_id,
            "quoted_message_id": self.quoted_message_id,
            "quoted_text": self.quoted_text,
            # Backward compatibility fields
            "message_id": self.event_id,
            "sender_id": self.source_id,
            "message_type": self.message_type,
            "content": self.payload  # Backward compatibility: content maps to payload
        }

@dataclass
class ReplyMessage(Event):
    """A reply message that creates or continues a thread."""
    
    # Thread messaging specific fields
    reply_to_id: str = field(default="")
    channel: Optional[str] = field(default=None)
    thread_level: int = field(default=1)
    quoted_message_id: Optional[str] = field(default=None)
    quoted_text: Optional[str] = field(default=None)
    
    def __init__(self, event_name: str = "thread.reply.posted", source_id: str = "", **kwargs):
        """Initialize ReplyMessage with proper event name."""
        # Handle backward compatibility for sender_id
        if 'sender_id' in kwargs:
            source_id = kwargs.pop('sender_id')
        
        # Extract reply message specific fields
        reply_to_id = kwargs.pop('reply_to_id', '')
        target_agent_id = kwargs.pop('target_agent_id', None)
        channel = kwargs.pop('channel', None)
        thread_level = kwargs.pop('thread_level', 1)
        quoted_message_id = kwargs.pop('quoted_message_id', None)
        quoted_text = kwargs.pop('quoted_text', None)
        
        # Validate thread level
        if not 1 <= thread_level <= 5:
            raise ValueError('thread_level must be between 1 and 5')
        
        # Set target fields in kwargs for Event
        if target_agent_id:
            kwargs['target_agent_id'] = target_agent_id
        if channel:
            kwargs['target_channel'] = channel
        
        # Call parent constructor
        super().__init__(event_name=event_name, source_id=source_id, **kwargs)
        
        # Set reply message specific fields
        self.reply_to_id = reply_to_id
        self.channel = channel
        self.thread_level = thread_level
        self.quoted_message_id = quoted_message_id
        self.quoted_text = quoted_text
    
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
        return "reply_message"
    
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
            # Thread messaging specific fields
            "reply_to_id": self.reply_to_id,
            "channel": self.channel,
            "thread_level": self.thread_level,
            "quoted_message_id": self.quoted_message_id,
            "quoted_text": self.quoted_text,
            # Backward compatibility fields
            "message_id": self.event_id,
            "sender_id": self.source_id,
            "message_type": self.message_type,
            "content": self.payload  # Backward compatibility: content maps to payload
        }
    
    @field_validator('thread_level')
    @classmethod
    def validate_thread_level(cls, v):
        """Validate thread nesting level."""
        if not 1 <= v <= 5:
            raise ValueError('thread_level must be between 1 and 5')
        return v

@dataclass
class FileUploadMessage(Event):
    """Message for file upload operations."""
    
    # File upload specific fields
    file_content: str = field(default="")
    filename: str = field(default="")
    mime_type: str = field(default="application/octet-stream")
    file_size: int = field(default=0)

    def __init__(self, event_name: str = "thread.file.uploaded", source_id: str = "", **kwargs):
        """Initialize FileUploadMessage with proper event name."""
        # Handle backward compatibility for sender_id
        if 'sender_id' in kwargs:
            source_id = kwargs.pop('sender_id')
        
        # Extract file upload specific fields
        file_content = kwargs.pop('file_content', '')
        filename = kwargs.pop('filename', '')
        mime_type = kwargs.pop('mime_type', 'application/octet-stream')
        file_size = kwargs.pop('file_size', 0)
        
        # Call parent constructor
        super().__init__(event_name=event_name, source_id=source_id, **kwargs)
        
        # Set file upload specific fields
        self.file_content = file_content
        self.filename = filename
        self.mime_type = mime_type
        self.file_size = file_size
    
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
        return "file_upload"
    
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
            # File upload specific fields
            "file_content": self.file_content,
            "filename": self.filename,
            "mime_type": self.mime_type,
            "file_size": self.file_size,
            # Backward compatibility fields
            "message_id": self.event_id,
            "sender_id": self.source_id,
            "message_type": self.message_type,
            "content": self.payload  # Backward compatibility: content maps to payload
        }

@dataclass
class FileOperationMessage(Event):
    """Message for file operations like download."""
    
    # File operation specific fields
    action: str = field(default="")
    file_id: Optional[str] = field(default=None)
    
    def __init__(self, event_name: str = "", source_id: str = "", **kwargs):
        """Initialize FileOperationMessage with dynamic event name based on action."""
        # Handle backward compatibility for sender_id
        if 'sender_id' in kwargs:
            source_id = kwargs.pop('sender_id')
        
        # Extract file operation specific fields
        action = kwargs.pop('action', '')
        file_id = kwargs.pop('file_id', None)
        
        # Generate event name based on action if not provided
        if not event_name:
            if action == 'upload':
                event_name = "thread.file.upload_requested"
            elif action == 'download':
                event_name = "thread.file.download_requested"
            elif action == 'list_channels':
                event_name = "thread.channels.list_requested"
            else:
                event_name = "thread.file.operation_requested"
        
        # Call parent constructor
        super().__init__(event_name=event_name, source_id=source_id, **kwargs)
        
        # Set file operation specific fields
        self.action = action
        self.file_id = file_id
    
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
        return "file_operation"
    
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
            # File operation specific fields
            "action": self.action,
            "file_id": self.file_id,
            # Backward compatibility fields
            "message_id": self.event_id,
            "sender_id": self.source_id,
            "message_type": self.message_type,
            "content": self.payload  # Backward compatibility: content maps to payload
        }
    
    @field_validator('action')
    @classmethod
    def validate_action(cls, v):
        """Validate file operation action."""
        valid_actions = ["upload", "download", "list_channels"]
        if v not in valid_actions:
            raise ValueError(f'action must be one of: {", ".join(valid_actions)}')
        return v

@dataclass
class ChannelInfoMessage(Event):
    """Message for channel information requests."""
    
    # Channel info specific fields
    action: str = field(default="list_channels")
    
    def __init__(self, event_name: str = "thread.channels.info_requested", source_id: str = "", **kwargs):
        """Initialize ChannelInfoMessage with proper event name."""
        # Handle backward compatibility for sender_id
        if 'sender_id' in kwargs:
            source_id = kwargs.pop('sender_id')
        
        # Extract channel info specific fields
        action = kwargs.pop('action', 'list_channels')
        request_id = kwargs.pop('request_id', None)  # Preserve request_id for HTTP correlation
        
        # Call parent constructor
        super().__init__(event_name=event_name, source_id=source_id, **kwargs)
        
        # Set channel info specific fields
        self.action = action
        self.request_id = request_id  # Store request_id for HTTP correlation
    
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
        return "channel_info"
    
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
            # Channel info specific fields
            "action": self.action,
            # Backward compatibility fields
            "message_id": self.event_id,
            "sender_id": self.source_id,
            "message_type": self.message_type,
            "content": self.payload  # Backward compatibility: content maps to payload
        }
    
    @field_validator('action')
    @classmethod
    def validate_action(cls, v):
        """Validate channel info action."""
        valid_actions = ["list_channels"]
        if v not in valid_actions:
            raise ValueError(f'action must be one of: {", ".join(valid_actions)}')
        return v

@dataclass
class MessageRetrievalMessage(Event):
    """Message for retrieving channel or direct messages."""
    
    # Message retrieval specific fields
    action: str = field(default="")
    channel: Optional[str] = field(default=None)
    limit: int = field(default=50)
    offset: int = field(default=0)
    include_threads: bool = field(default=True)
    
    def __init__(self, event_name: str = "", source_id: str = "", **kwargs):
        """Initialize MessageRetrievalMessage with dynamic event name based on action."""
        # Handle backward compatibility for sender_id
        if 'sender_id' in kwargs:
            source_id = kwargs.pop('sender_id')
        
        # Extract message retrieval specific fields
        action = kwargs.pop('action', '')
        channel = kwargs.pop('channel', None)
        target_agent_id = kwargs.pop('target_agent_id', None)
        limit = kwargs.pop('limit', 50)
        offset = kwargs.pop('offset', 0)
        include_threads = kwargs.pop('include_threads', True)
        request_id = kwargs.pop('request_id', None)  # Preserve request_id for HTTP correlation
        
        # Validate action
        valid_actions = ["retrieve_channel_messages", "retrieve_direct_messages"]
        if action and action not in valid_actions:
            raise ValueError(f'action must be one of: {", ".join(valid_actions)}')
        
        # Validate limit
        if limit < 1 or limit > 500:
            raise ValueError('limit must be between 1 and 500')
        
        # Validate offset
        if offset < 0:
            raise ValueError('offset must be >= 0')
        
        # Generate event name based on action if not provided
        if not event_name:
            if action == 'retrieve_channel_messages':
                event_name = "thread.channel_messages.retrieval_requested"
            elif action == 'retrieve_direct_messages':
                event_name = "thread.direct_messages.retrieval_requested"
            else:
                event_name = "thread.messages.retrieval_requested"
        
        # Set target fields in kwargs for Event
        if target_agent_id:
            kwargs['target_agent_id'] = target_agent_id
        if channel:
            kwargs['target_channel'] = channel
        
        # Call parent constructor
        super().__init__(event_name=event_name, source_id=source_id, **kwargs)
        
        # Set message retrieval specific fields
        self.action = action
        self.channel = channel
        self.limit = limit
        self.offset = offset
        self.include_threads = include_threads
        self.request_id = request_id  # Store request_id for HTTP correlation
    
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
        return "message_retrieval"
    
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
            # Message retrieval specific fields
            "action": self.action,
            "channel": self.channel,
            "limit": self.limit,
            "offset": self.offset,
            "include_threads": self.include_threads,
            # Backward compatibility fields
            "message_id": self.event_id,
            "sender_id": self.source_id,
            "message_type": self.message_type,
            "content": self.payload  # Backward compatibility: content maps to payload
        }
    
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

class ReactionMessage(Event):
    """Message for adding reactions to other messages."""
    
    target_message_id: str = Field(..., description="ID of the message being reacted to")
    reaction_type: str = Field(..., description="Type of reaction emoji")
    action: str = Field("add", description="Action: 'add' or 'remove'")
    
    def __init__(self, event_name: str = "", source_id: str = "", **kwargs):
        """Initialize ReactionMessage with dynamic event name based on action."""
        # Handle backward compatibility for sender_id
        if 'sender_id' in kwargs:
            source_id = kwargs.pop('sender_id')
        
        # Extract reaction specific fields
        target_message_id = kwargs.pop('target_message_id', '')
        reaction_type = kwargs.pop('reaction_type', '')
        action = kwargs.pop('action', 'add')
        request_id = kwargs.pop('request_id', None)  # Preserve request_id for HTTP correlation
        
        # Generate event name based on action if not provided
        if not event_name:
            if action == 'add':
                event_name = "thread.reaction.added"
            elif action == 'remove':
                event_name = "thread.reaction.removed"
            else:
                event_name = "thread.reaction.updated"
        
        # Call parent constructor
        super().__init__(event_name=event_name, source_id=source_id, **kwargs)
        
        # Set reaction specific fields
        self.target_message_id = target_message_id
        self.reaction_type = reaction_type
        self.action = action
        self.request_id = request_id  # Store request_id for HTTP correlation
    
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
