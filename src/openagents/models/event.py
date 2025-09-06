"""
Core event models for the unified OpenAgents event system.

This module defines the fundamental event structures that replace all
message types (Direct, Broadcast, Mod) with a single unified Event type.
"""

import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, Any, Optional, Set, List
import logging

logger = logging.getLogger(__name__)


class EventVisibility(str, Enum):
    """Defines who can see and receive events."""
    
    PUBLIC = "public"        # All agents can see (for public announcements)
    NETWORK = "network"      # All connected agents can see (default)
    CHANNEL = "channel"      # Only agents in specific channel
    DIRECT = "direct"        # Only source and target agents
    RESTRICTED = "restricted" # Only specific allowed agents
    MOD_ONLY = "mod_only"    # Only specific mod can process


@dataclass
class Event:
    """
    Unified event structure for all network interactions.
    
    This replaces Event, Event, Event, and workspace events
    with a single, flexible event type that supports all use cases.
    """
    
    # Core identification - REQUIRED FIELDS FIRST
    event_name: str  # e.g., "agent.direct_message.sent", "project.run.completed" - REQUIRED
    source_id: str  # The agent or mod that generated this event - REQUIRED
    
    # Core identification - OPTIONAL FIELDS WITH DEFAULTS
    event_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: int = field(default_factory=lambda: int(time.time()))
    source_type: str = field(default="agent")  # "agent" or "mod" - indicates what generated this event
    
    # Source and targeting
    target_agent_id: Optional[str] = None  # For direct events
    target_channel: Optional[str] = None   # For channel events
    
    # Mod system integration
    relevant_mod: Optional[str] = None  # Restrict processing to specific mod
    requires_response: bool = False     # Whether this event expects a response
    response_to: Optional[str] = None   # If this is a response, the original event_id
    
    # Event data
    payload: Dict[str, Any] = field(default_factory=dict)
    metadata: Dict[str, Any] = field(default_factory=dict)
    text_representation: Optional[str] = None  # Human-readable text for the event
    
    # Visibility and access control
    visibility: EventVisibility = EventVisibility.NETWORK
    allowed_agents: Optional[Set[str]] = None  # Specific agents allowed (if visibility=RESTRICTED)
    
    def __init__(self, event_name: str, source_id: str = "", **kwargs):
        """Initialize Event with backward compatibility for old field names."""
        # Handle backward compatibility for common old field names
        if 'message_id' in kwargs:
            kwargs['event_id'] = kwargs.pop('message_id')
        if 'sender_id' in kwargs:
            source_id = kwargs.pop('sender_id')
        if 'source_agent_id' in kwargs:
            source_id = kwargs.pop('source_agent_id')
        if 'content' in kwargs:
            kwargs['payload'] = kwargs.pop('content')
        
        # Ensure source_id is provided
        if not source_id:
            raise ValueError("Event must have a source_id (or sender_id/source_agent_id for backward compatibility)")
        
        # Remove fields that don't belong to Event but might be passed by tests
        ignored_fields = ['message_type', 'mod', 'direction', 'protocol', 'document_id', 'line_number', 'filename', 'file_content']
        for field in ignored_fields:
            kwargs.pop(field, None)
        
        # Set the required fields
        self.event_name = event_name
        self.source_id = source_id
        
        # Set optional fields with defaults
        self.event_id = kwargs.pop('event_id', str(uuid.uuid4()))
        self.timestamp = kwargs.pop('timestamp', int(time.time()))
        self.source_type = kwargs.pop('source_type', "agent")
        self.target_agent_id = kwargs.pop('target_agent_id', None)
        self.target_channel = kwargs.pop('target_channel', None)
        self.relevant_mod = kwargs.pop('relevant_mod', None)
        self.requires_response = kwargs.pop('requires_response', False)
        self.response_to = kwargs.pop('response_to', None)
        self.payload = kwargs.pop('payload', {})
        self.metadata = kwargs.pop('metadata', {})
        self.text_representation = kwargs.pop('text_representation', None)
        self.visibility = kwargs.pop('visibility', EventVisibility.NETWORK)
        self.allowed_agents = kwargs.pop('allowed_agents', None)
        
        # Warn about any remaining unknown fields
        if kwargs:
            logger.warning(f"Unknown fields passed to Event constructor: {list(kwargs.keys())}")
        
        # Call post-init validation
        self.__post_init__()
    
    def __post_init__(self):
        """Validate event after creation."""
        # Validate event name is meaningful (not placeholder or generic)
        self._validate_event_name(self.event_name)
        
        # source_id is now required as a dataclass field, so no need to check for empty
        
        # Auto-set visibility based on targeting
        if self.visibility == EventVisibility.NETWORK:  # Only auto-set if default
            if self.target_agent_id:
                self.visibility = EventVisibility.DIRECT
            elif self.target_channel:
                self.visibility = EventVisibility.CHANNEL
            elif self.relevant_mod:
                self.visibility = EventVisibility.MOD_ONLY
    
    def _validate_event_name(self, event_name: str) -> None:
        """Validate that event name is meaningful and follows conventions."""
        # Check for empty or whitespace-only names
        if not event_name or not event_name.strip():
            raise ValueError("event_name cannot be empty or whitespace-only")
        
        # Check minimum length (meaningful names should be at least 3 characters)
        if len(event_name.strip()) < 3:
            raise ValueError("event_name must be at least 3 characters long")
        
        # List of forbidden placeholder/generic names
        forbidden_names = {
            "event", "message", "test", "temp", "tmp", "placeholder", 
            "unknown", "default", "generic", "sample", "example",
            "transport.message", "base.event", "system.event"
        }
        
        if event_name.lower() in forbidden_names:
            raise ValueError(f"event_name '{event_name}' is not allowed. Use a meaningful name like 'project.run.completed'")
        
        # Check for meaningful structure (should contain at least one dot for hierarchy)
        if "." not in event_name:
            raise ValueError(f"event_name '{event_name}' should follow hierarchical format like 'domain.entity.action'")
        
        # Validate format: should be lowercase with dots and underscores only
        import re
        if not re.match(r'^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$', event_name):
            raise ValueError(f"event_name '{event_name}' must follow format 'domain.entity.action' with lowercase letters, numbers, underscores, and dots only")
        
        # Check for minimum meaningful parts (at least 2 parts: domain.action)
        parts = event_name.split(".")
        if len(parts) < 2:
            raise ValueError(f"event_name '{event_name}' must have at least 2 parts: 'domain.action'")
        
        # Each part should be meaningful (not single letters or numbers)
        for part in parts:
            if len(part) < 2:
                raise ValueError(f"event_name '{event_name}' contains part '{part}' that is too short. Each part must be at least 2 characters")

    def matches_pattern(self, pattern: str) -> bool:
        """Check if this event matches a subscription pattern."""
        if pattern == "*":
            return True
        
        # Support wildcard patterns like "project.*", "channel.message.*"
        if pattern.endswith("*"):
            prefix = pattern[:-1]
            return self.event_name.startswith(prefix)
        
        # Exact match
        return self.event_name == pattern
    
    def is_visible_to_agent(self, agent_id: str, agent_channels: Optional[Set[str]] = None) -> bool:
        """Check if this event should be visible to the given agent."""
        
        # Source agent always sees their own events
        if agent_id == self.source_id:
            return True
        
        # Check visibility rules
        if self.visibility == EventVisibility.PUBLIC or self.visibility == EventVisibility.NETWORK:
            return True
        
        elif self.visibility == EventVisibility.DIRECT:
            return agent_id == self.target_agent_id
        
        elif self.visibility == EventVisibility.CHANNEL:
            if not self.target_channel or not agent_channels:
                return False
            return self.target_channel in agent_channels
        
        elif self.visibility == EventVisibility.RESTRICTED:
            if not self.allowed_agents:
                return False
            return agent_id in self.allowed_agents
        
        elif self.visibility == EventVisibility.MOD_ONLY:
            # MOD_ONLY events are handled by the event bus, not delivered to agents directly
            return False
        
        return False
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert event to dictionary for serialization."""
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
            "visibility": self.visibility.value,
            "allowed_agents": list(self.allowed_agents) if self.allowed_agents else None
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Event":
        """Create event from dictionary."""
        # Convert allowed_agents back to set
        allowed_agents = None
        if data.get("allowed_agents"):
            allowed_agents = set(data["allowed_agents"])
        
        return cls(
            event_id=data["event_id"],
            event_name=data["event_name"],
            timestamp=data["timestamp"],
            source_id=data["source_id"],
            target_agent_id=data.get("target_agent_id"),
            target_channel=data.get("target_channel"),
            relevant_mod=data.get("relevant_mod"),
            requires_response=data.get("requires_response", False),
            response_to=data.get("response_to"),
            payload=data.get("payload", {}),
            metadata=data.get("metadata", {}),
            visibility=EventVisibility(data.get("visibility", EventVisibility.NETWORK.value)),
            allowed_agents=allowed_agents
        )
    
    # Backward compatibility properties for TransportMessage
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
    def target_id(self) -> Optional[str]:
        """Backward compatibility: target_id maps to target_agent_id."""
        return self.target_agent_id
    
    @target_id.setter
    def target_id(self, value: Optional[str]):
        """Backward compatibility: target_id maps to target_agent_id."""
        self.target_agent_id = value
    
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
        """Backward compatibility: extract message_type from event_name."""
        if self.event_name.startswith("agent.direct_message."):
            return "direct_message"
        elif self.event_name.startswith("agent.broadcast_message."):
            return "broadcast_message"
        elif self.event_name.startswith("mod."):
            return "mod_message"
        else:
            return "event"
    
    @message_type.setter
    def message_type(self, value: str):
        """Backward compatibility: message_type influences event_name."""
        # Keep the existing event_name but add a warning
        logger.warning(f"Setting message_type '{value}' on Event is deprecated. Use event_name instead.")
    
    @property
    def timestamp_float(self) -> float:
        """Get timestamp as float for backward compatibility."""
        return float(self.timestamp) / 1000.0
    
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
            # Backward compatibility fields
            "message_id": self.event_id,
            "sender_id": self.source_id,
            "target_id": self.target_agent_id,
            "message_type": self.message_type
        }
    
    @classmethod
    def from_legacy_data(cls, **data) -> 'Event':
        """Create Event from legacy message data."""
        # Map old field names to Event field names
        event_data = {}
        
        if 'message_id' in data:
            event_data['event_id'] = data.pop('message_id')
        if 'sender_id' in data:
            event_data['source_id'] = data.pop('sender_id')
        if 'target_id' in data:
            event_data['target_agent_id'] = data.pop('target_id')
        if 'message_type' in data:
            # Convert legacy message_type to proper event_name
            message_type = data.pop('message_type')
            if message_type == 'direct_message':
                event_data['event_name'] = 'agent.direct_message.sent'
            elif message_type == 'broadcast_message':
                event_data['event_name'] = 'agent.broadcast_message.sent'
            elif message_type == 'mod_message':
                event_data['event_name'] = 'mod.generic.message_received'
            else:
                event_data['event_name'] = 'network.transport.sent'
        if 'content' in data:
            event_data['payload'] = data.pop('content')
        
        # Add remaining data
        event_data.update(data)
        
        # Ensure required Event fields are set
        if not event_data.get('event_id'):
            event_data['event_id'] = str(uuid.uuid4())
        if not event_data.get('event_name'):
            event_data['event_name'] = 'network.transport.sent'
        if not event_data.get('source_id'):
            event_data['source_id'] = 'transport'
        
        return cls(**event_data)


@dataclass
class EventSubscription:
    """
    Represents an agent's subscription to specific events.
    
    Supports pattern matching and filtering to give agents fine-grained
    control over which events they receive.
    """
    
    subscription_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    agent_id: str = field(default="")
    event_patterns: List[str] = field(default_factory=list)  # e.g., ["project.*", "channel.message.*"]
    
    # Optional filters
    mod_filter: Optional[str] = None        # Only events from specific mod
    channel_filter: Optional[str] = None    # Only events from specific channel
    agent_filter: Optional[Set[str]] = None # Only events from specific agents
    
    # Subscription metadata
    created_timestamp: int = field(default_factory=lambda: int(time.time()))
    is_active: bool = True
    
    def __post_init__(self):
        """Validate subscription after creation."""
        if not self.agent_id:
            raise ValueError("agent_id is required")
        if not self.event_patterns:
            raise ValueError("at least one event pattern is required")
    
    def matches_event(self, event: Event, agent_channels: Optional[Set[str]] = None) -> bool:
        """Check if this subscription matches the given event."""
        
        # Check if event is visible to the subscribing agent
        if not event.is_visible_to_agent(self.agent_id, agent_channels):
            return False
        
        # Check event pattern matching
        pattern_match = any(event.matches_pattern(pattern) for pattern in self.event_patterns)
        if not pattern_match:
            return False
        
        # Apply optional filters
        if self.mod_filter and event.relevant_mod != self.mod_filter:
            return False
        
        if self.channel_filter and event.target_channel != self.channel_filter:
            return False
        
        if self.agent_filter and event.source_id not in self.agent_filter:
            return False
        
        return True
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert subscription to dictionary for serialization."""
        return {
            "subscription_id": self.subscription_id,
            "agent_id": self.agent_id,
            "event_patterns": self.event_patterns,
            "mod_filter": self.mod_filter,
            "channel_filter": self.channel_filter,
            "agent_filter": list(self.agent_filter) if self.agent_filter else None,
            "created_timestamp": self.created_timestamp,
            "is_active": self.is_active
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "EventSubscription":
        """Create subscription from dictionary."""
        agent_filter = None
        if data.get("agent_filter"):
            agent_filter = set(data["agent_filter"])
        
        return cls(
            subscription_id=data["subscription_id"],
            agent_id=data["agent_id"],
            event_patterns=data["event_patterns"],
            mod_filter=data.get("mod_filter"),
            channel_filter=data.get("channel_filter"),
            agent_filter=agent_filter,
            created_timestamp=data.get("created_timestamp", int(time.time())),
            is_active=data.get("is_active", True)
        )


# Predefined event name constants for common events
class EventNames:
    """Common event names to ensure consistency across the system."""
    
    # Agent events
    AGENT_CONNECTED = "agent.connected"
    AGENT_DISCONNECTED = "agent.disconnected"
    AGENT_DIRECT_MESSAGE_SENT = "agent.direct_message.sent"
    AGENT_DIRECT_MESSAGE_RECEIVED = "agent.direct_message.received"
    
    # Network events
    NETWORK_BROADCAST_SENT = "network.broadcast.sent"
    NETWORK_STATUS_CHANGED = "network.status.changed"
    
    # Channel events
    CHANNEL_MESSAGE_POSTED = "channel.message.posted"
    CHANNEL_MESSAGE_REPLIED = "channel.message.replied"
    CHANNEL_MESSAGE_MENTIONED = "channel.message.mentioned"
    CHANNEL_JOINED = "channel.joined"
    CHANNEL_LEFT = "channel.left"
    
    # Project events
    PROJECT_CREATION_REQUESTED = "project.creation.requested"
    PROJECT_CREATED = "project.created"
    PROJECT_STARTED = "project.started"
    PROJECT_RUN_COMPLETED = "project.run.completed"
    PROJECT_RUN_FAILED = "project.run.failed"
    PROJECT_RUN_REQUIRES_INPUT = "project.run.requires_input"
    PROJECT_STOPPED = "project.stopped"
    PROJECT_AGENT_JOINED = "project.agent.joined"
    PROJECT_AGENT_LEFT = "project.agent.left"
    PROJECT_STATUS_CHANGED = "project.status.changed"
    
    # File events
    FILE_UPLOAD_COMPLETED = "file.upload.completed"
    FILE_DOWNLOAD_COMPLETED = "file.download.completed"
    FILE_SHARED = "file.shared"
    
    # Reaction events
    REACTION_ADDED = "reaction.added"
    REACTION_REMOVED = "reaction.removed"
    
    # Mod events
    MOD_LOADED = "mod.loaded"
    MOD_UNLOADED = "mod.unloaded"
