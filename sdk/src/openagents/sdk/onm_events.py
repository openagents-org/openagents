# -*- coding: utf-8 -*-
"""
ONM Event Envelope — the universal unit of communication.

This module defines the event structure from the OpenAgents Network Model (ONM).
Every interaction in a network is an event. There are no separate concepts for
"messages," "commands," or "notifications" — they are all events with different types.

This is distinct from the legacy models.event.Event which is used by the existing
SDK runtime. The ONM event model will eventually replace it.
"""

import time
import uuid
from enum import Enum
from typing import Any, Dict, Optional

from pydantic import BaseModel, Field


class EventVisibility(str, Enum):
    """Determines who can see an event, even if routing would otherwise deliver it."""
    PUBLIC = "public"       # Any agent in the network
    CHANNEL = "channel"     # Only members of the target channel
    DIRECT = "direct"       # Only the target agent
    MOD_ONLY = "mod_only"   # Only mods in the pipeline (internal events)


class Event(BaseModel):
    """
    ONM Event envelope — the single unit of communication.

    Every event has a source and a target. There are no null targets.
    To broadcast, use "agent:broadcast". To talk to the network, use "core".
    To reach a channel, use "channel/{name}".

    Event types are hierarchical, dot-separated strings following a
    {domain}.{entity}.{action} convention. Core events use the "network.*"
    namespace. Extensions use any other namespace (e.g., "workspace.*").
    """
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    type: str                       # e.g., "workspace.message.posted"
    source: str                     # e.g., "openagents:claude-agent"
    target: str                     # e.g., "channel/session-abc" (NEVER null)
    payload: Any = None             # Schema depends on type
    metadata: Dict[str, Any] = Field(default_factory=dict)
    timestamp: int = Field(default_factory=lambda: int(time.time() * 1000))
    network: str = ""               # Network ID where the event originated
    visibility: EventVisibility = EventVisibility.CHANNEL

    model_config = {"use_enum_values": True}

    @property
    def in_reply_to(self) -> Optional[str]:
        """Get the event ID this is a response to, if any."""
        return self.metadata.get("in_reply_to")

    def as_reply(self, **kwargs) -> "Event":
        """Create a reply event to this event, swapping source and target."""
        return Event(
            source=self.target,
            target=self.source,
            metadata={"in_reply_to": self.id},
            network=self.network,
            **kwargs,
        )


# ---------------------------------------------------------------------------
# Core event types (network.* namespace — reserved)
# ---------------------------------------------------------------------------

class CoreEventTypes:
    """Event types defined by the ONM spec. Every implementation must handle these."""

    # Agent lifecycle
    AGENT_JOIN = "network.agent.join"
    AGENT_LEAVE = "network.agent.leave"
    AGENT_DISCOVER = "network.agent.discover"
    AGENT_DISCOVER_RESPONSE = "network.agent.discover.response"
    AGENT_ANNOUNCE = "network.agent.announce"

    # Channel lifecycle
    CHANNEL_CREATE = "network.channel.create"
    CHANNEL_DELETE = "network.channel.delete"
    CHANNEL_JOIN = "network.channel.join"
    CHANNEL_LEAVE = "network.channel.leave"

    # Resource operations
    RESOURCE_REGISTER = "network.resource.register"
    RESOURCE_UNREGISTER = "network.resource.unregister"
    RESOURCE_DISCOVER = "network.resource.discover"
    RESOURCE_DISCOVER_RESPONSE = "network.resource.discover.response"
    RESOURCE_INVOKE = "network.resource.invoke"
    RESOURCE_INVOKE_RESULT = "network.resource.invoke.result"
    RESOURCE_READ = "network.resource.read"
    RESOURCE_READ_RESPONSE = "network.resource.read.response"
    RESOURCE_UPDATE = "network.resource.update"

    # System
    PING = "network.ping"
    PONG = "network.pong"
    EVENT_ACK = "network.event.ack"
    EVENT_ERROR = "network.event.error"
    EVENTS_QUERY = "network.events.query"
    EVENTS_RESPONSE = "network.events.response"


class WorkspaceEventTypes:
    """Extension event types for the OpenAgents Workspace product."""

    MESSAGE_POSTED = "workspace.message.posted"
    MESSAGE_STATUS = "workspace.message.status"
    SESSION_CREATED = "workspace.session.created"
    SESSION_UPDATED = "workspace.session.updated"
    INVITATION_CREATED = "workspace.invitation.created"
    INVITATION_ACCEPTED = "workspace.invitation.accepted"
    INVITATION_REJECTED = "workspace.invitation.rejected"
