"""Message models for OpenAgents protocols."""

from typing import Dict, List, Optional, Any, Union
from pydantic import BaseModel, Field, field_validator, ConfigDict
import uuid
import time

class BaseMessage(BaseModel):
    """Base class for all protocol messages."""
    
    message_id: str = Field(default_factory=lambda: str(uuid.uuid4()), description="Unique message identifier")
    timestamp: int = Field(default_factory=lambda: int(time.time() * 1000), description="Message timestamp (ms)")
    protocol: Optional[str] = Field(None, description="Protocol this message belongs to")
    message_type: str = Field("base", description="Type of message for protocol routing and handling")
    sender_id: str = Field(..., description="ID of the agent sending the message")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Metadata for the message")
    content: Dict[str, Any] = Field(default_factory=dict, description="Message content")
    text_representation: Optional[str] = Field(None, description="Human-readable text representation of the message")
    requires_response: bool = Field(False, description="Whether this message requires a response")
    
    @field_validator('sender_id')
    @classmethod
    def validate_agent_id(cls, v):
        if not v or not isinstance(v, str):
            raise ValueError('Agent ID must be a non-empty string')
        return v

    model_config = ConfigDict(extra="allow")  # Allow extra fields

class DirectMessage(BaseMessage):
    """A direct message from one agent to another."""
    
    message_type: str = Field("direct_message", description="Direct message type")
    target_agent_id: str = Field(..., description="Recipient agent ID")


class BroadcastMessage(BaseMessage):
    """Message model for broadcasting to all agents in a network.
    
    This model represents a broadcast message sent to all agents in the network.
    """
    
    message_type: str = Field("broadcast_message", description="Broadcast message type")
    exclude_agent_ids: List[str] = Field(default_factory=list, description="List of agent IDs to exclude from broadcast")


class ProtocolMessage(BaseMessage):
    """A message for network protocols to consume.
    
    This model represents a message that is sent to a specific protocol handler.
    """

    message_type: str = Field("protocol_message", description="Protocol message type")
    protocol: str = Field(..., description="Protocol this message belongs to")
    direction: str = Field("inbound", description="Direction of the message")
    relevant_agent_id: str = Field(..., description="Agent ID this message is relevant to")

    @field_validator('protocol')
    @classmethod
    def validate_protocol(cls, v):
        if not v or not isinstance(v, str):
            raise ValueError('Protocol must be a non-empty string')
        return v
