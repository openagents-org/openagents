"""
Core event models for the unified OpenAgents event system.

This module defines the fundamental event structures that replace all
message types (Direct, Broadcast, Mod) with a single unified Event type.
"""

from ast import Tuple
import time
import uuid
from enum import Enum
from typing import Dict, Any, Optional, Set, List
import logging
from aiohttp.hdrs import DESTINATION
from pydantic import BaseModel, Field, field_validator, model_validator

from openagents.models.network_role import NetworkRole

logger = logging.getLogger(__name__)


class EventVisibility(str, Enum):
    """Defines who can see and receive events."""

    PUBLIC = "public"  # All agents can see (for public announcements)
    NETWORK = "network"  # All connected agents can see (default)
    CHANNEL = "channel"  # Only agents in specific channel
    DIRECT = "direct"  # Only source and target agents
    RESTRICTED = "restricted"  # Only specific allowed agents
    MOD_ONLY = "mod_only"  # Only specific mod can process


class EventDestination(BaseModel):
    """Defines the destination for an event."""

    role: NetworkRole
    desitnation_id: str


class EventSource(BaseModel):
    """Defines the source for an event."""

    role: NetworkRole
    source_id: str


class Event(BaseModel):
    """
    Unified event structure for all network interactions.

    with a single, flexible event type that supports all use cases.

    Each event shoulld have at least a source_id and an event_name, and in most cases, a destination_id.

    Event Names:
    Event name should be a hierarchical name defined by OpenAgents core and the mods. Following are
    some example event names:
    - agent.message
    - project.run.completed
    - channel.message.posted
    - mod.generic.message_received
    - system.register_agent

    Source ID:
    Source ID is the ID of the agent or mod that generated this event. Examples:
    - agent:charlie_123
    - mod:openagents.mods.communication.simple_messaging
    - system:system

    If the source id is provided without a role such as "charlie_123", it will be assumed to be an agent.

    Source Agent Group:
    For agent sources, the network automatically populates the source_agent_group field with the
    agent's group name from the topology. For mod and system sources, this field remains None.
    This allows event processors to filter events and apply group-specific processing rules.

    Destination ID:
    Destination ID is the ID of the agent, mod, channel, or system component that this event is intended for.
    The format can be either:
    - Prefixed format: "role:id" (e.g., "agent:charlie_123", "mod:simple_messaging", "channel:general", "system:core")
    - Simple format: "id" (defaults to agent role)

    Examples:
    - agent:charlie_123 (specific agent)
    - mod:openagents.mods.communication.simple_messaging (specific mod)
    - system:system (system component)
    - channel:general (channel broadcast)
    - charlie_123 (defaults to agent:charlie_123)
    - agent:broadcast (broadcast to all agents)

    The destination is parsed using parse_destination_id() which returns an EventDestination object
    containing the role (NetworkRole) and target_id.
    """

    # Core identification - REQUIRED FIELDS FIRST
    event_name: str  # e.g., "agent.message", "project.run.completed" - REQUIRED
    source_id: Optional[str] = Field(default=None)  # The agent or mod that generated this event

    # Core identification - OPTIONAL FIELDS WITH DEFAULTS
    event_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: int = Field(default_factory=lambda: int(time.time()))
    source_type: str = Field(
        default="agent"
    )  # "agent" or "mod" - indicates what generated this event

    # Source and targeting
    destination_id: Optional[str] = None  # Destination of this events

    # Mod system integration
    relevant_mod: Optional[str] = (
        None  # Restrict processing to specific mod; Deprecated
    )
    requires_response: bool = False  # Whether this event expects a response
    response_to: Optional[str] = None  # If this is a response, the original event_id

    # Event thread
    thread_name: Optional[str] = (
        None  # The name of the thread for the event, used for organizing events into threads in the client
    )

    # Event data
    payload: Dict[str, Any] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    text_representation: Optional[str] = None  # Human-readable text for the event

    # Visibility and access control
    visibility: EventVisibility = EventVisibility.NETWORK
    allowed_agents: Optional[Set[str]] = (
        None  # Specific agents allowed (if visibility=RESTRICTED)
    )
    
    # Authentication
    secret: Optional[str] = None  # Authentication secret for the source agent

    # Source context
    source_agent_group: Optional[str] = None  # The agent group the source belongs to

    model_config = {"use_enum_values": True, "arbitrary_types_allowed": True}

    @property
    def id(self) -> str:
        return self.event_id

    @field_validator("event_name")
    @classmethod
    def validate_event_name(cls, v):
        """Validate that event name is meaningful and follows conventions."""
        # Check for empty or whitespace-only names
        if not v or not v.strip():
            raise ValueError("event_name cannot be empty or whitespace-only")

        # Check minimum length (meaningful names should be at least 3 characters)
        if len(v.strip()) < 3:
            raise ValueError("event_name must be at least 3 characters long")

        # List of forbidden placeholder/generic names
        forbidden_names = {
            "event",
            "message",
            "test",
            "temp",
            "tmp",
            "placeholder",
            "unknown",
            "default",
            "generic",
            "sample",
            "example",
            "transport.message",
            "base.event",
            "system.event",
        }

        if v.lower() in forbidden_names:
            raise ValueError(
                f"event_name '{v}' is not allowed. Use a meaningful name like 'project.run.completed'"
            )

        # Check for meaningful structure (should contain at least one dot for hierarchy)
        if "." not in v:
            raise ValueError(
                f"event_name '{v}' should follow hierarchical format like 'domain.entity.action'"
            )

        # Validate format: should be lowercase with dots and underscores only
        import re

        if not re.match(r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$", v):
            raise ValueError(
                f"event_name '{v}' must follow format 'domain.entity.action' with lowercase letters, numbers, underscores, and dots only"
            )

        # Check for minimum meaningful parts (at least 2 parts: domain.action)
        parts = v.split(".")
        if len(parts) < 2:
            raise ValueError(
                f"event_name '{v}' must have at least 2 parts: 'domain.action'"
            )

        # Each part should be meaningful (not single letters or numbers)
        for part in parts:
            if len(part) < 2:
                raise ValueError(
                    f"event_name '{v}' contains part '{part}' that is too short. Each part must be at least 2 characters"
                )

        return v

    def parse_source(self) -> EventSource:
        """Parse the source_id into a EventSource object."""
        if self.source_id:
            # Special cases
            if self.source_id == "system" or self.source_id == "mod":
                role = NetworkRole.SYSTEM
                source_id = "system"
            # General case
            elif ":" in self.source_id:
                role, source_id = self.source_id.split(":", 1)
            else:
                role = NetworkRole.AGENT
                source_id = self.source_id
        else:
            role = NetworkRole.UNKNOWN
            source_id = None

        return EventSource(role=NetworkRole(role), source_id=source_id)

    def parse_destination(self) -> EventDestination:
        """Parse the destination_id into a EventDestination object."""
        if self.destination_id:
            # Special cases
            if self.destination_id == "broadcast" or self.destination_id == "all":
                role = NetworkRole.AGENT
                target_id = "broadcast"
            elif self.destination_id == "channel" or self.destination_id == "agent":
                role = NetworkRole.UNKNOWN
                target_id = None
            elif self.destination_id == "system" or self.destination_id == "mod":
                role = NetworkRole.SYSTEM
                target_id = "system"
            # General case
            elif ":" in self.destination_id:
                role_str, target_id = self.destination_id.split(":", 1)
                try:
                    role = NetworkRole(role_str)
                except ValueError:
                    # Unknown role, default to AGENT for backward compatibility
                    role = NetworkRole.AGENT
                    target_id = self.destination_id
            else:
                role = NetworkRole.AGENT
                target_id = self.destination_id
        else:
            role = NetworkRole.SYSTEM
            target_id = "system"

        return EventDestination(role=role, desitnation_id=target_id)

    @model_validator(mode="after")
    def auto_set_visibility(self):
        """Auto-set visibility based on targeting if not explicitly provided."""
        # Only auto-set if using default visibility
        # TODO: to be implemented
        return self

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

    def is_visible_to_agent(
        self, agent_id: str, agent_channels: Optional[Set[str]] = None
    ) -> bool:
        """Check if this event should be visible to the given agent."""

        # Source agent always sees their own events
        if agent_id == self.source_id:
            return True

        # Check visibility rules
        if (
            self.visibility == EventVisibility.PUBLIC
            or self.visibility == EventVisibility.NETWORK
        ):
            return True

        elif self.visibility == EventVisibility.DIRECT:
            return agent_id == self.destination_id

        elif self.visibility == EventVisibility.CHANNEL:
            if not self.channel or not agent_channels:
                return False
            return self.channel in agent_channels

        elif self.visibility == EventVisibility.RESTRICTED:
            if not self.allowed_agents:
                return False
            return agent_id in self.allowed_agents

        elif self.visibility == EventVisibility.MOD_ONLY:
            return False

        return False

    # Essential properties required by core classes (network.py, connector.py)
    @property
    def message_id(self) -> str:
        return self.event_id

    @property
    def message_type(self) -> Optional[str]:
        if isinstance(self.payload, dict):
            return self.payload.get("message_type")
        return None

    @property
    def sender_id(self) -> str:
        return self.source_id

    @property
    def content(self) -> Dict[str, Any]:
        return self.payload

    @property
    def target_id(self) -> Optional[str]:
        return self.destination_id

    @property
    def relevant_agent_id(self) -> Optional[str]:
        return self.destination_id

    def to_dict(self) -> Dict[str, Any]:
        """Convert event to dictionary for serialization."""
        return self.model_dump()

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Event":
        """Create event from dictionary."""
        return cls(**data)

    @property
    def timestamp_float(self) -> float:
        """Get timestamp as float."""
        return float(self.timestamp) / 1000.0

    def is_direct_message(self) -> bool:
        """Check if this event is a direct message."""
        destination = self.parse_destination()
        return (
            destination.role == NetworkRole.AGENT
            and destination.desitnation_id != "broadcast"
        )

    def is_broadcast_message(self) -> bool:
        """Check if this event is a broadcast message."""
        destination = self.parse_destination()
        return (
            destination.role == NetworkRole.AGENT
            and destination.desitnation_id == "broadcast"
        )

    def is_system_message(self) -> bool:
        """Check if this event is a system message."""
        destination = self.parse_destination()
        return destination.role == NetworkRole.SYSTEM

    def is_channel_message(self) -> bool:
        """Check if this event is a channel message."""
        destination = self.parse_destination()
        return destination.role == NetworkRole.CHANNEL

    # Backward compatibility properties for legacy code
    @property
    def source_agent_id(self) -> str:
        """Backward compatibility alias for source_id."""
        return self.source_id

    @property
    def mod(self) -> Optional[str]:
        """Backward compatibility alias for relevant_mod."""
        return self.relevant_mod


class EventSubscription(BaseModel):
    """
    Represents an agent's subscription to specific events.

    Supports pattern matching and filtering to give agents fine-grained
    control over which events they receive.
    """

    subscription_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    agent_id: str
    event_patterns: List[str]  # e.g., ["project.*", "channel.message.*"]
    channels: Set[str] = Field(
        default_factory=set
    )  # Limit the subscription to only specific channels; If empty, the subscription is not limited to any channel
    created_timestamp: int = Field(default_factory=lambda: int(time.time()))
    is_active: bool = True

    @field_validator("agent_id")
    @classmethod
    def validate_agent_id(cls, v):
        """Validate agent_id is provided."""
        if not v:
            raise ValueError("agent_id is required")
        return v

    @field_validator("event_patterns")
    @classmethod
    def validate_event_patterns(cls, v):
        """Validate event patterns are provided."""
        if not v:
            raise ValueError("at least one event pattern is required")
        return v

    def matches_event(
        self, event: Event, agent_channels: Optional[Set[str]] = None
    ) -> bool:
        """Check if this subscription matches the given event."""

        # Check if event is visible to the subscribing agent
        if not event.is_visible_to_agent(self.agent_id, agent_channels):
            return False

        # Check event pattern matching
        pattern_match = any(
            event.matches_pattern(pattern) for pattern in self.event_patterns
        )
        if not pattern_match:
            return False

        return True

    def to_dict(self) -> Dict[str, Any]:
        """Convert subscription to dictionary for serialization."""
        return self.model_dump()

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "EventSubscription":
        """Create subscription from dictionary."""
        return cls(**data)


# Predefined event name constants for common events
class EventNames:
    """Common event names to ensure consistency across the system."""

    # TODO: merge the constants in the globals into this class

    # Agent events
    AGENT_CONNECTED = "agent.connected"
    AGENT_DISCONNECTED = "agent.disconnected"
    AGENT_MESSAGE = "agent.message"

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
