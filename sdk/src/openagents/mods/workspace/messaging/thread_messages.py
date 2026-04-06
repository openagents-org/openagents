"""Thread messaging specific message models for OpenAgents."""

from typing import Dict, List, Optional, Any, Union
from pydantic import BaseModel
from openagents.models.event import Event
from dataclasses import dataclass, field


def _extract_text_from_event_payload(event: Event) -> str:
    """Extract text content from an Event object's payload.

    This handles the nested content structure: payload.content.text

    Args:
        event: The Event object to extract text from

    Returns:
        The extracted text content, or empty string if not found
    """
    if not event or not event.payload:
        return ""

    # Handle nested content structure (payload.content.text)
    if "content" in event.payload and isinstance(event.payload["content"], dict):
        return event.payload["content"].get("text", "")
    else:
        return ""


@dataclass
class ThreadMessageEvent(Event):
    """A thread message event with additional threading fields."""

    # Thread messaging specific fields
    quoted_message_id: Optional[str] = field(default=None)
    quoted_text: Optional[str] = field(default=None)

    def __init__(
        self,
        event_name: str = "thread.direct_message.send",
        source_id: str = "",
        **kwargs,
    ):
        """Initialize ThreadMessageEvent with proper event name."""
        # Map old field names to modern API
        if "sender_id" in kwargs:
            source_id = kwargs.pop("sender_id")
        if "content" in kwargs:
            kwargs["payload"] = kwargs.pop("content")

        # Remove mod field if present (not needed by Event)
        kwargs.pop("mod", None)

        # Extract thread-specific fields
        target_agent_id = kwargs.pop("target_agent_id", "")
        quoted_message_id = kwargs.pop("quoted_message_id", None)
        quoted_text = kwargs.pop("quoted_text", None)

        # Set target_agent_id in kwargs for Event
        kwargs["target_agent_id"] = target_agent_id

        # Call parent constructor
        super().__init__(event_name=event_name, source_id=source_id, **kwargs)

        # Set thread-specific fields
        self.quoted_message_id = quoted_message_id
        self.quoted_text = quoted_text


class ChannelMessage:
    """Validator and helper for channel message events."""

    @classmethod
    def validate(cls, event: Event) -> Event:
        """Validate that event.payload has required channel message fields.

        Args:
            event: Event to validate

        Returns:
            Event: The validated event

        Raises:
            ValueError: If validation fails
        """
        payload = event.payload or {}

        # Validate required fields
        if "channel" not in payload:
            raise ValueError("Channel message must have 'channel' in payload")

        # Validate field types
        if not isinstance(payload["channel"], str):
            raise ValueError("Channel must be a string")

        if payload["channel"] == "":
            raise ValueError("Channel cannot be empty string")

        # Validate optional fields if present
        if (
            "mentioned_agent_id" in payload
            and payload["mentioned_agent_id"] is not None
        ):
            if not isinstance(payload["mentioned_agent_id"], str):
                raise ValueError("mentioned_agent_id must be a string")

        if "reply_to_id" in payload and payload["reply_to_id"] is not None:
            if not isinstance(payload["reply_to_id"], str):
                raise ValueError("reply_to_id must be a string")

        return event

    @classmethod
    def create(
        cls,
        channel: str,
        text: str,
        source_id: str,
        mentioned_agent_id: Optional[str] = None,
        reply_to_id: Optional[str] = None,
        quoted_message_id: Optional[str] = None,
        quoted_text: Optional[str] = None,
        attachments: Optional[List[Dict[str, Any]]] = None,
        **kwargs,
    ) -> Event:
        """Helper to create a properly formatted channel message Event.

        Args:
            channel: Channel name
            text: Message text
            source_id: ID of the sending agent
            mentioned_agent_id: Optional agent to mention
            reply_to_id: Optional message ID this is replying to
            quoted_message_id: Optional message ID being quoted
            quoted_text: Optional text of quoted message
            attachments: Optional file attachments
            **kwargs: Additional fields for the Event

        Returns:
            Event: Properly formatted channel message event
        """
        payload = {
            "channel": channel,
            "content": {"text": text},
            "message_type": "channel_message",
        }

        # Add optional fields if provided
        if mentioned_agent_id:
            payload["mentioned_agent_id"] = mentioned_agent_id
        if reply_to_id:
            payload["reply_to_id"] = reply_to_id
        if quoted_message_id:
            payload["quoted_message_id"] = quoted_message_id
        if quoted_text:
            payload["quoted_text"] = quoted_text
        if attachments:
            payload["attachments"] = attachments

        return Event(
            event_name="thread.channel_message.post",
            source_id=source_id,
            destination_id=f"channel:{channel}",
            payload=payload,
            **kwargs,
        )

    @staticmethod
    def get_channel(event: Event) -> str:
        """Extract channel name from event payload."""
        return event.payload.get("channel", "") if event.payload else ""

    @staticmethod
    def get_text(event: Event) -> str:
        """Extract message text from event payload."""
        return _extract_text_from_event_payload(event)

    @staticmethod
    def get_mentioned_agent(event: Event) -> Optional[str]:
        """Extract mentioned agent ID from event payload."""
        return event.payload.get("mentioned_agent_id") if event.payload else None


class ReplyMessage:
    """Validator and helper for reply message events."""

    @classmethod
    def validate(cls, event: Event) -> Event:
        """Validate that event.payload has required reply message fields.

        Args:
            event: Event to validate

        Returns:
            Event: The validated event

        Raises:
            ValueError: If validation fails
        """
        payload = event.payload or {}

        # Validate required fields
        if "reply_to_id" not in payload:
            raise ValueError("Reply message must have 'reply_to_id' in payload")

        # Validate field types
        if not isinstance(payload["reply_to_id"], str):
            raise ValueError("reply_to_id must be a string")

        if payload["reply_to_id"] == "":
            raise ValueError("reply_to_id cannot be empty string")

        # Validate thread level if present
        if "thread_level" in payload:
            thread_level = payload["thread_level"]
            # Handle both int and float (from protobuf conversion)
            if isinstance(thread_level, float) and thread_level.is_integer():
                payload["thread_level"] = int(thread_level)
                thread_level = int(thread_level)
            if not isinstance(thread_level, int) or not 1 <= thread_level <= 5:
                raise ValueError("thread_level must be an integer between 1 and 5")

        # Validate optional fields if present
        if "channel" in payload and payload["channel"] is not None:
            if not isinstance(payload["channel"], str):
                raise ValueError("channel must be a string")

        if "target_agent_id" in payload and payload["target_agent_id"] is not None:
            if not isinstance(payload["target_agent_id"], str):
                raise ValueError("target_agent_id must be a string")

        return event

    @classmethod
    def create(
        cls,
        reply_to_id: str,
        text: str,
        source_id: str,
        channel: Optional[str] = None,
        target_agent_id: Optional[str] = None,
        thread_level: int = 1,
        quoted_message_id: Optional[str] = None,
        quoted_text: Optional[str] = None,
        **kwargs,
    ) -> Event:
        """Helper to create a properly formatted reply message Event.

        Args:
            reply_to_id: ID of message being replied to
            text: Reply text
            source_id: ID of the sending agent
            channel: Optional channel for channel replies
            target_agent_id: Optional target agent for direct replies
            thread_level: Thread nesting level (1-5)
            quoted_message_id: Optional message ID being quoted
            quoted_text: Optional text of quoted message
            **kwargs: Additional fields for the Event

        Returns:
            Event: Properly formatted reply message event
        """
        if not 1 <= thread_level <= 5:
            raise ValueError("thread_level must be between 1 and 5")

        payload = {
            "reply_to_id": reply_to_id,
            "content": {"text": text},
            "message_type": "reply_message",
            "sender_id": source_id,
        }

        # Add optional fields if provided
        if channel:
            payload["channel"] = channel
        if target_agent_id:
            payload["target_agent_id"] = target_agent_id
        if quoted_message_id:
            payload["quoted_message_id"] = quoted_message_id
        if quoted_text:
            payload["quoted_text"] = quoted_text

        # Set destination based on reply type
        destination_id = None
        if channel:
            destination_id = f"channel:{channel}"
        elif target_agent_id:
            destination_id = target_agent_id

        return Event(
            event_name="thread.reply.post",
            source_id=source_id,
            destination_id=destination_id,
            payload=payload,
            **kwargs,
        )

    @staticmethod
    def get_reply_to_id(event: Event) -> str:
        """Extract reply_to_id from event payload."""
        return event.payload.get("reply_to_id", "") if event.payload else ""

    @staticmethod
    def get_text(event: Event) -> str:
        """Extract message text from event payload."""
        return _extract_text_from_event_payload(event)

    @staticmethod
    def get_thread_level(event: Event) -> int:
        """Extract thread level from event payload."""
        return event.payload.get("thread_level", 1) if event.payload else 1

    @staticmethod
    def get_channel(event: Event) -> Optional[str]:
        """Extract channel from event payload."""
        return event.payload.get("channel") if event.payload else None


class FileUploadMessage:
    """Validator and helper for file upload events."""

    @classmethod
    def validate(cls, event: Event) -> Event:
        """Validate that event.payload has required file upload fields.

        Args:
            event: Event to validate

        Returns:
            Event: The validated event

        Raises:
            ValueError: If validation fails
        """
        payload = event.payload or {}

        # Validate required fields
        required_fields = ["filename", "file_content", "mime_type", "file_size"]
        for field in required_fields:
            if field not in payload:
                raise ValueError(f"File upload message must have '{field}' in payload")

        # Validate field types
        if not isinstance(payload["filename"], str):
            raise ValueError("filename must be a string")

        if not isinstance(payload["file_content"], str):
            raise ValueError("file_content must be a string (base64 encoded)")

        if not isinstance(payload["mime_type"], str):
            raise ValueError("mime_type must be a string")

        # Handle file_size - accept int or float and convert to int
        if not isinstance(payload["file_size"], (int, float)):
            raise ValueError("file_size must be a number")

        # Convert float to int if needed (gRPC can convert integers to floats)
        if isinstance(payload["file_size"], float):
            payload["file_size"] = int(payload["file_size"])

        if payload["filename"] == "":
            raise ValueError("filename cannot be empty")

        if payload["file_size"] < 0:
            raise ValueError("file_size cannot be negative")

        return event

    @classmethod
    def create(
        cls,
        filename: str,
        file_content: str,
        source_id: str,
        mime_type: str = "application/octet-stream",
        file_size: Optional[int] = None,
        **kwargs,
    ) -> Event:
        """Helper to create a properly formatted file upload Event.

        Args:
            filename: Name of the file
            file_content: Base64 encoded file content
            source_id: ID of the uploading agent
            mime_type: MIME type of the file
            file_size: Size of the file in bytes (calculated if not provided)
            **kwargs: Additional fields for the Event

        Returns:
            Event: Properly formatted file upload event
        """
        # Calculate file size if not provided
        if file_size is None:
            try:
                import base64

                decoded = base64.b64decode(file_content)
                file_size = len(decoded)
            except Exception:
                file_size = len(file_content)  # Fallback to string length

        payload = {
            "filename": filename,
            "file_content": file_content,
            "mime_type": mime_type,
            "file_size": file_size,
            "message_type": "file_upload",
        }

        return Event(
            event_name="thread.file.upload",
            source_id=source_id,
            payload=payload,
            **kwargs,
        )

    @staticmethod
    def get_filename(event: Event) -> str:
        """Extract filename from event payload."""
        return event.payload.get("filename", "") if event.payload else ""

    @staticmethod
    def get_file_content(event: Event) -> str:
        """Extract file content from event payload."""
        return event.payload.get("file_content", "") if event.payload else ""

    @staticmethod
    def get_mime_type(event: Event) -> str:
        """Extract MIME type from event payload."""
        return (
            event.payload.get("mime_type", "application/octet-stream")
            if event.payload
            else "application/octet-stream"
        )

    @staticmethod
    def get_file_size(event: Event) -> int:
        """Extract file size from event payload."""
        return event.payload.get("file_size", 0) if event.payload else 0


class FileOperationMessage:
    """Validator for file operation messages."""

    @classmethod
    def validate(cls, event: Event) -> Event:
        """Validate file operation message payload."""
        # Infer action from event name instead of requiring it in payload
        action = cls._infer_action_from_event_name(event.event_name)

        if not action:
            raise ValueError(
                f"Could not infer action from event name: {event.event_name}"
            )

        return event

    @staticmethod
    def _infer_action_from_event_name(event_name: str) -> str:
        """Infer action from event name."""
        if "download" in event_name:
            return "download"
        elif "upload" in event_name:
            return "upload"
        elif "list" in event_name or "channels" in event_name:
            return "list_channels"
        return ""

    @classmethod
    def create(
        cls, action: str, source_id: str, file_id: Optional[str] = None, **kwargs
    ) -> Event:
        """Create a file operation event."""
        valid_actions = ["upload", "download", "list_channels"]
        if action not in valid_actions:
            raise ValueError(f"action must be one of: {', '.join(valid_actions)}")

        event_name_map = {
            "upload": "thread.file.upload_requested",
            "download": "thread.file.download_requested",
            "list_channels": "thread.channels.list_requested",
        }

        payload = {"action": action, "message_type": "file_operation"}

        if file_id:
            payload["file_id"] = file_id

        event_name = kwargs.pop(
            "event_name", event_name_map.get(action, "thread.file.operation_requested")
        )

        return Event(
            event_name=event_name, source_id=source_id, payload=payload, **kwargs
        )

    @staticmethod
    def get_file_id(event: Event) -> Optional[str]:
        """Extract file_id from event payload."""
        return event.payload.get("file_id") if event.payload else None


class ChannelInfoMessage:
    """Validator for channel information messages."""

    @classmethod
    def validate(cls, event: Event) -> Event:
        """Validate channel info message payload."""
        payload = event.payload or {}
        action = payload.get("action", "")

        if not action:
            raise ValueError("Channel info message must have 'action' in payload")

        valid_actions = ["list_channels"]
        if action not in valid_actions:
            raise ValueError(f"action must be one of: {', '.join(valid_actions)}")

        return event

    @classmethod
    def create(
        cls,
        source_id: str,
        action: str = "list_channels",
        request_id: Optional[str] = None,
        **kwargs,
    ) -> Event:
        """Create a channel info event."""
        valid_actions = ["list_channels"]
        if action not in valid_actions:
            raise ValueError(f"action must be one of: {', '.join(valid_actions)}")

        payload = {"action": action, "message_type": "channel_info"}

        if request_id:
            payload["request_id"] = request_id

        event_name = kwargs.pop("event_name", "thread.channels.info_requested")

        return Event(
            event_name=event_name, source_id=source_id, payload=payload, **kwargs
        )

    @staticmethod
    def get_request_id(event: Event) -> Optional[str]:
        """Extract request_id from event payload."""
        return event.payload.get("request_id") if event.payload else None


class MessageRetrievalMessage:
    """Validator for message retrieval messages."""

    @classmethod
    def validate(cls, event: Event) -> Event:
        """Validate message retrieval payload."""
        # Infer action from event name instead of requiring it in payload
        action = cls._infer_action_from_event_name(event.event_name)

        if not action:
            raise ValueError(
                f"Could not infer action from event name: {event.event_name}"
            )

        payload = event.payload or {}
        limit = payload.get("limit", 50)
        # Handle gRPC float conversion like in FileUploadMessage
        if isinstance(limit, float):
            limit = int(limit)
            payload["limit"] = limit  # Update payload in place
        if not isinstance(limit, int) or not 1 <= limit <= 500:
            raise ValueError("limit must be between 1 and 500")

        offset = payload.get("offset", 0)
        # Handle gRPC float conversion
        if isinstance(offset, float):
            offset = int(offset)
            payload["offset"] = offset  # Update payload in place
        if not isinstance(offset, int) or offset < 0:
            raise ValueError("offset must be >= 0")

        return event

    @staticmethod
    def _infer_action_from_event_name(event_name: str) -> str:
        """Infer action from event name."""
        if "direct_messages" in event_name:
            return "retrieve_direct_messages"
        elif "channel_messages" in event_name or "messages" in event_name:
            return "retrieve_channel_messages"
        return ""

    @classmethod
    def create(
        cls,
        action: str,
        source_id: str,
        channel: Optional[str] = None,
        target_agent_id: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
        include_threads: bool = True,
        request_id: Optional[str] = None,
        **kwargs,
    ) -> Event:
        """Create a message retrieval event."""
        valid_actions = ["retrieve_channel_messages", "retrieve_direct_messages"]
        if action not in valid_actions:
            raise ValueError(f"action must be one of: {', '.join(valid_actions)}")

        if not 1 <= limit <= 500:
            raise ValueError("limit must be between 1 and 500")

        if offset < 0:
            raise ValueError("offset must be >= 0")

        event_name_map = {
            "retrieve_channel_messages": "thread.channel_messages.retrieval_requested",
            "retrieve_direct_messages": "thread.direct_messages.retrieval_requested",
        }

        payload = {
            "action": action,
            "limit": limit,
            "offset": offset,
            "include_threads": include_threads,
            "message_type": "message_retrieval",
        }

        if channel:
            payload["channel"] = channel
        if target_agent_id:
            payload["target_agent_id"] = target_agent_id
        if request_id:
            payload["request_id"] = request_id

        event_name = kwargs.pop(
            "event_name",
            event_name_map.get(action, "thread.messages.retrieval_requested"),
        )

        # Set destination based on channel vs direct message
        if channel:
            kwargs["destination_id"] = f"channel:{channel}"
        elif target_agent_id:
            kwargs["destination_id"] = target_agent_id

        return Event(
            event_name=event_name, source_id=source_id, payload=payload, **kwargs
        )

    @staticmethod
    def get_channel(event: Event) -> Optional[str]:
        """Extract channel from event payload."""
        return event.payload.get("channel") if event.payload else None

    @staticmethod
    def get_limit(event: Event) -> int:
        """Extract limit from event payload."""
        return event.payload.get("limit", 200) if event.payload else 200

    @staticmethod
    def get_offset(event: Event) -> int:
        """Extract offset from event payload."""
        return event.payload.get("offset", 0) if event.payload else 0

    @staticmethod
    def get_include_threads(event: Event) -> bool:
        """Extract include_threads from event payload."""
        return event.payload.get("include_threads", True) if event.payload else True

    @staticmethod
    def get_target_agent_id(event: Event) -> Optional[str]:
        """Extract target_agent_id from event payload."""
        return event.payload.get("target_agent_id") if event.payload else None

    @staticmethod
    def get_request_id(event: Event) -> Optional[str]:
        """Extract request_id from event payload."""
        return event.payload.get("request_id") if event.payload else None


class ReactionMessage:
    """Validator for reaction messages."""

    @classmethod
    def validate(cls, event: Event) -> Event:
        """Validate reaction message payload."""
        payload = event.payload or {}

        target_message_id = payload.get("target_message_id", "")
        if not target_message_id:
            raise ValueError(
                "Reaction message must have 'target_message_id' in payload"
            )

        reaction_type = payload.get("reaction_type", "")
        if not reaction_type:
            raise ValueError("Reaction message must have 'reaction_type' in payload")

        # Validate reaction type
        valid_reactions = [
            "+1",
            "-1",
            "like",
            "heart",
            "laugh",
            "wow",
            "sad",
            "angry",
            "thumbs_up",
            "thumbs_down",
            "smile",
            "ok",
            "done",
            "fire",
            "party",
            "clap",
            "check",
            "cross",
            "eyes",
            "thinking",
        ]
        if reaction_type not in valid_reactions:
            raise ValueError(
                f"reaction_type must be one of: {', '.join(valid_reactions)}"
            )

        action = payload.get("action", "add")
        valid_actions = ["add", "remove"]
        if action not in valid_actions:
            raise ValueError(f"action must be one of: {', '.join(valid_actions)}")

        return event

    @classmethod
    def create(
        cls,
        target_message_id: str,
        reaction_type: str,
        source_id: str,
        action: str = "add",
        request_id: Optional[str] = None,
        **kwargs,
    ) -> Event:
        """Create a reaction event."""
        if not target_message_id:
            raise ValueError("target_message_id is required")

        if not reaction_type:
            raise ValueError("reaction_type is required")

        # Validate reaction type
        valid_reactions = [
            "+1",
            "-1",
            "like",
            "heart",
            "laugh",
            "wow",
            "sad",
            "angry",
            "thumbs_up",
            "thumbs_down",
            "smile",
            "ok",
            "done",
            "fire",
            "party",
            "clap",
            "check",
            "cross",
            "eyes",
            "thinking",
        ]
        if reaction_type not in valid_reactions:
            raise ValueError(
                f"reaction_type must be one of: {', '.join(valid_reactions)}"
            )

        valid_actions = ["add", "remove"]
        if action not in valid_actions:
            raise ValueError(f"action must be one of: {', '.join(valid_actions)}")

        event_name_map = {
            "add": "thread.reaction.added",
            "remove": "thread.reaction.removed",
        }

        payload = {
            "target_message_id": target_message_id,
            "reaction_type": reaction_type,
            "action": action,
            "message_type": "reaction",
        }

        if request_id:
            payload["request_id"] = request_id

        event_name = kwargs.pop(
            "event_name", event_name_map.get(action, "thread.reaction.updated")
        )

        return Event(
            event_name=event_name, source_id=source_id, payload=payload, **kwargs
        )

    @staticmethod
    def get_target_message_id(event: Event) -> str:
        """Extract target_message_id from event payload."""
        return event.payload.get("target_message_id", "") if event.payload else ""

    @staticmethod
    def get_reaction_type(event: Event) -> str:
        """Extract reaction_type from event payload."""
        return event.payload.get("reaction_type", "") if event.payload else ""

    @staticmethod
    def get_request_id(event: Event) -> Optional[str]:
        """Extract request_id from event payload."""
        return event.payload.get("request_id") if event.payload else None

@dataclass
class AnnouncementSetMessage(Event):
    """Message for setting a channel announcement."""
    
    channel: str = field(default="")
    text: str = field(default="")
    
    def __init__(self, event_name: str = "thread.announcement.set", source_id: str = "", **kwargs):
        """Initialize AnnouncementSetMessage with proper event name."""
        # Map old field names to modern API
        if 'sender_id' in kwargs:
            source_id = kwargs.pop('sender_id')
        if 'content' in kwargs:
            kwargs['payload'] = kwargs.pop('content')
        
        # Remove mod field if present (not needed by Event)
        kwargs.pop('mod', None)
        
        # Extract announcement specific fields
        channel = kwargs.pop('channel', '')
        text = kwargs.pop('text', '')
        
        # Call parent constructor
        super().__init__(event_name=event_name, source_id=source_id, **kwargs)
        
        # Set announcement specific fields
        self.channel = channel
        self.text = text
    
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
        return "announcement_set"
    
    def model_dump(self) -> Dict[str, Any]:
        """Pydantic-style model dump for backward compatibility."""
        return {
            "event_id": self.event_id,
            "event_name": self.event_name,
            "timestamp": self.timestamp,
            "source_id": self.source_id,
            "source_type": self.source_type,
            "target_agent_id": self.destination_id,
            "relevant_mod": self.relevant_mod,
            "requires_response": self.requires_response,
            "response_to": self.response_to,
            "payload": self.payload,
            "metadata": self.metadata,
            "text_representation": self.text_representation,
            "visibility": self.visibility.value if hasattr(self.visibility, 'value') else self.visibility,
            "allowed_agents": list(self.allowed_agents) if self.allowed_agents else None,
            # Announcement specific fields
            "channel": self.channel,
            "text": self.text,
            # Backward compatibility fields
            "message_id": self.event_id,
            "sender_id": self.source_id,
            "message_type": self.message_type,
            "content": self.payload
        }

@dataclass
class AnnouncementGetMessage(Event):
    """Message for getting a channel announcement."""
    
    channel: str = field(default="")
    
    def __init__(self, event_name: str = "thread.announcement.get", source_id: str = "", **kwargs):
        """Initialize AnnouncementGetMessage with proper event name."""
        # Map old field names to modern API
        if 'sender_id' in kwargs:
            source_id = kwargs.pop('sender_id')
        if 'content' in kwargs:
            kwargs['payload'] = kwargs.pop('content')
        
        # Remove mod field if present (not needed by Event)
        kwargs.pop('mod', None)
        
        # Extract announcement specific fields
        channel = kwargs.pop('channel', '')
        
        # Call parent constructor
        super().__init__(event_name=event_name, source_id=source_id, **kwargs)
        
        # Set announcement specific fields
        self.channel = channel
    
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
        return "announcement_get"
    
    def model_dump(self) -> Dict[str, Any]:
        """Pydantic-style model dump for backward compatibility."""
        return {
            "event_id": self.event_id,
            "event_name": self.event_name,
            "timestamp": self.timestamp,
            "source_id": self.source_id,
            "source_type": self.source_type,
            "target_agent_id": self.destination_id,
            "relevant_mod": self.relevant_mod,
            "requires_response": self.requires_response,
            "response_to": self.response_to,
            "payload": self.payload,
            "metadata": self.metadata,
            "text_representation": self.text_representation,
            "visibility": self.visibility.value if hasattr(self.visibility, 'value') else self.visibility,
            "allowed_agents": list(self.allowed_agents) if self.allowed_agents else None,
            # Announcement specific fields
            "channel": self.channel,
            # Backward compatibility fields
            "message_id": self.event_id,
            "sender_id": self.source_id,
            "message_type": self.message_type,
            "content": self.payload
        }