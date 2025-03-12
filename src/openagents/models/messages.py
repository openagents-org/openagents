"""Message models for OpenAgents protocols."""

from typing import Dict, List, Optional, Any, Union
from pydantic import BaseModel, Field, validator
import uuid
import time


class BaseMessage(BaseModel):
    """Base class for all protocol messages."""
    
    message_id: str = Field(default_factory=lambda: str(uuid.uuid4()), description="Unique message identifier")
    timestamp: int = Field(default_factory=lambda: int(time.time() * 1000), description="Message timestamp (ms)")
    protocol: str = Field(..., description="Protocol this message belongs to")
    
    class Config:
        extra = "allow"  # Allow extra fields


class DirectMessage(BaseMessage):
    """A direct message from one agent to another."""
    
    from_agent: str = Field(..., description="Sender agent ID")
    to_agent: str = Field(..., description="Recipient agent ID")
    content: Dict[str, Any] = Field(default_factory=dict, description="Message content")


class TopicMessage(BaseMessage):
    """A message published to a topic."""
    
    from_agent: str = Field(..., description="Publisher agent ID")
    topic: str = Field(..., description="Topic name")
    content: Dict[str, Any] = Field(default_factory=dict, description="Message content")


class RequestMessage(DirectMessage):
    """A request message expecting a response."""
    
    request_id: str = Field(default_factory=lambda: str(uuid.uuid4()), description="Request identifier")
    timeout: float = Field(30.0, description="Request timeout in seconds")


class ResponseMessage(DirectMessage):
    """A response to a request message."""
    
    request_id: str = Field(..., description="Request identifier this is responding to")
    status: str = Field("success", description="Response status")
    error: Optional[str] = Field(None, description="Error message if status is error")


# Discovery Protocol Messages
class DiscoveryMessage(BaseMessage):
    """Base class for discovery protocol messages."""
    
    protocol: str = Field("discovery", const=True)
    action: str = Field(..., description="Discovery action to perform")


class DiscoverAgentsMessage(DiscoveryMessage):
    """Message to discover agents."""
    
    action: str = Field("discover_agents", const=True)
    filter_criteria: Dict[str, Any] = Field(
        default_factory=dict, 
        description="Criteria to filter agents by"
    )


class DiscoverServicesMessage(DiscoveryMessage):
    """Message to discover services."""
    
    action: str = Field("discover_services", const=True)
    service_type: Optional[str] = Field(None, description="Type of service to discover")


class GetAgentInfoMessage(DiscoveryMessage):
    """Message to get information about an agent."""
    
    action: str = Field("get_agent_info", const=True)
    agent_id: str = Field(..., description="ID of the agent to get info for")


# Communication Protocol Messages
class CommunicationMessage(BaseMessage):
    """Base class for communication protocol messages."""
    
    protocol: str = Field("communication", const=True)
    action: str = Field(..., description="Communication action to perform")


class SendMessageAction(CommunicationMessage):
    """Message to send a direct message."""
    
    action: str = Field("send_message", const=True)
    from_agent: str = Field(..., description="Sender agent ID")
    to_agent: str = Field(..., description="Recipient agent ID")
    content: Dict[str, Any] = Field(default_factory=dict, description="Message content")


class PublishMessageAction(CommunicationMessage):
    """Message to publish to a topic."""
    
    action: str = Field("publish", const=True)
    from_agent: str = Field(..., description="Publisher agent ID")
    topic: str = Field(..., description="Topic to publish to")
    content: Dict[str, Any] = Field(default_factory=dict, description="Message content")


class SubscribeAction(CommunicationMessage):
    """Message to subscribe to a topic."""
    
    action: str = Field("subscribe", const=True)
    agent_id: str = Field(..., description="Subscriber agent ID")
    topic: str = Field(..., description="Topic to subscribe to")


class UnsubscribeAction(CommunicationMessage):
    """Message to unsubscribe from a topic."""
    
    action: str = Field("unsubscribe", const=True)
    agent_id: str = Field(..., description="Subscriber agent ID")
    topic: str = Field(..., description="Topic to unsubscribe from")


class NetworkMessage(BaseMessage):
    """Message model for network communication between agents.
    
    This model represents the message data structure used in the Network.send_message method.
    """
    
    protocol: str = Field("network", const=True, description="Protocol this message belongs to")
    type: str = Field("message", const=True, description="Message type, always 'message' for direct messages")
    source_agent_id: str = Field(..., description="ID of the sending agent")
    target_agent_id: str = Field(..., description="ID of the target agent")
    content: Dict[str, Any] = Field(default_factory=dict, description="Message content")
    
    @validator('source_agent_id', 'target_agent_id')
    def validate_agent_id(cls, v):
        if not v or not isinstance(v, str):
            raise ValueError('Agent ID must be a non-empty string')
        return v


class RegistrationMessage(BaseMessage):
    """Message model for agent registration with a network.
    
    This model represents the registration message sent by an agent to join a network.
    """
    
    protocol: str = Field("network", const=True, description="Protocol this message belongs to")
    type: str = Field("register", const=True, description="Message type, always 'register' for registration")
    agent_id: str = Field(..., description="ID of the agent registering")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Agent metadata including capabilities")
    
    @validator('agent_id')
    def validate_agent_id(cls, v):
        if not v or not isinstance(v, str):
            raise ValueError('Agent ID must be a non-empty string')
        return v


class RegistrationResponseMessage(BaseMessage):
    """Message model for network response to agent registration.
    
    This model represents the response sent by the network after an agent attempts to register.
    """
    
    protocol: str = Field("network", const=True, description="Protocol this message belongs to")
    type: str = Field("register_response", const=True, description="Message type, always 'register_response'")
    success: bool = Field(..., description="Whether registration was successful")
    network_name: str = Field(..., description="Name of the network")
    error: Optional[str] = Field(None, description="Error message if registration failed")


class BroadcastMessage(BaseMessage):
    """Message model for broadcasting to all agents in a network.
    
    This model represents a broadcast message sent to all agents in the network.
    """
    
    protocol: str = Field("network", const=True, description="Protocol this message belongs to")
    type: str = Field("broadcast", const=True, description="Message type, always 'broadcast'")
    source_agent_id: str = Field(..., description="ID of the broadcasting agent")
    message_type: str = Field(..., description="Type of the broadcast message")
    content: Dict[str, Any] = Field(default_factory=dict, description="Message content")
    
    @validator('source_agent_id')
    def validate_agent_id(cls, v):
        if not v or not isinstance(v, str):
            raise ValueError('Agent ID must be a non-empty string')
        return v


class SimpleMessage(BaseMessage):
    """A simple message that can be sent between agents.
    
    This is a utility class for sending simple messages that don't need a specific protocol.
    """
    
    protocol: str = Field("simple", const=True, description="Protocol this message belongs to")
    message_type: str = Field(..., description="Type of the message")
    content: Dict[str, Any] = Field(default_factory=dict, description="Message content") 