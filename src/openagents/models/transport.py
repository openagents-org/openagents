"""Transport layer models for OpenAgents."""

from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field, ConfigDict
from enum import Enum
import time
import uuid

from .event import Event
from dataclasses import dataclass, field


class TransportType(Enum):
    """Supported transport types."""
    WEBSOCKET = "websocket"
    LIBP2P = "libp2p"
    GRPC = "grpc"
    WEBRTC = "webrtc"


class ConnectionState(Enum):
    """Connection states."""
    DISCONNECTED = "disconnected"
    CONNECTING = "connecting"
    CONNECTED = "connected"
    IDLE = "idle"
    ERROR = "error"
    RECONNECTING = "reconnecting"


class PeerMetadata(BaseModel):
    """Metadata about a peer."""
    model_config = ConfigDict(use_enum_values=True)
    
    peer_id: str = Field(..., description="Unique identifier for the peer")
    transport_type: TransportType = Field(..., description="Transport type used by this peer")
    capabilities: List[str] = Field(default_factory=list, description="List of capabilities supported by the peer")
    last_seen: float = Field(default_factory=time.time, description="Timestamp when peer was last seen")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Additional metadata about the peer")


class ConnectionInfo(BaseModel):
    """Information about a connection."""
    model_config = ConfigDict(use_enum_values=True)
    
    connection_id: str = Field(..., description="Unique identifier for the connection")
    peer_id: str = Field(..., description="ID of the connected peer")
    transport_type: TransportType = Field(..., description="Transport type for this connection")
    state: ConnectionState = Field(..., description="Current state of the connection")
    last_activity: float = Field(default_factory=time.time, description="Timestamp of last activity")
    retry_count: int = Field(default=0, description="Number of retry attempts")
    max_retries: int = Field(default=3, description="Maximum number of retry attempts")
    backoff_delay: float = Field(default=1.0, description="Current backoff delay in seconds")


class AgentInfo(BaseModel):
    """Information about an agent in the network."""
    model_config = ConfigDict(use_enum_values=True)
    
    agent_id: str = Field(..., description="Unique identifier for the agent")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Additional metadata about the agent")
    capabilities: List[str] = Field(default_factory=list, description="List of capabilities supported by the agent")
    last_seen: float = Field(default_factory=time.time, description="Timestamp when agent was last seen")
    transport_type: TransportType = Field(..., description="Transport type used by this agent")
    address: Optional[str] = Field(None, description="Network address of the agent")


@dataclass
class TransportMessage(Event):
    """Transport layer message extending Event for network transport."""
    
    # Transport-specific fields
    target_id: Optional[str] = field(default=None)  # Target peer ID (None for broadcast)
    
    def __init__(self, event_name: str = "network.transport.sent", source_id: str = "", **kwargs):
        """Initialize TransportMessage with backward compatibility."""
        # Handle case where source_id is in kwargs (from event data)
        if not source_id and 'source_id' in kwargs:
            source_id = kwargs.pop('source_id')
        
        # Handle case where event_name is in kwargs (from event data)
        if not event_name or event_name == "network.transport.sent":
            if 'event_name' in kwargs:
                event_name = kwargs.pop('event_name')
        
        # Handle message_type for backward compatibility
        if 'message_type' in kwargs:
            message_type = kwargs.pop('message_type')
            # Generate event name from message_type
            if message_type == "direct":
                event_name = "network.transport.direct_sent"
            elif message_type == "broadcast":
                event_name = "network.transport.broadcast_sent"
            elif message_type == "mod":
                event_name = "network.transport.mod_sent"
            else:
                event_name = f"network.transport.{message_type}_sent"
        
        # Extract target_id before calling parent
        target_id = kwargs.pop('target_id', None)
        
        # Call parent constructor
        super().__init__(event_name=event_name, source_id=source_id, **kwargs)
        
        # Set TransportMessage-specific fields
        self.target_id = target_id
        
        # Set target_agent_id from target_id for Event compatibility
        if self.target_id and not self.target_agent_id:
            self.target_agent_id = self.target_id
    
    def __post_init__(self):
        """Initialize transport message with proper Event fields."""
        # Set target_agent_id from target_id for Event compatibility
        if self.target_id and not self.target_agent_id:
            self.target_agent_id = self.target_id
        
        # Call parent post_init
        super().__post_init__()
    
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
    def message_type(self) -> str:
        """Backward compatibility: extract message_type from event_name."""
        if "direct" in self.event_name:
            return "direct_message"
        elif "broadcast" in self.event_name:
            return "broadcast_message"
        elif "mod" in self.event_name:
            return "mod_message"
        else:
            # Extract from event_name pattern like "network.transport.{type}_sent"
            parts = self.event_name.split('.')
            if len(parts) >= 3 and parts[-1] == "sent":
                return parts[-2].replace("_sent", "") + "_message"
            return "transport"
    

    
    @message_type.setter
    def message_type(self, value: str):
        """Backward compatibility: message_type maps to event_name."""
        self.event_name = value
    
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
            "target_id": self.target_id,
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
            "message_type": self.message_type
        }
    
    @property
    def timestamp_float(self) -> float:
        """Get timestamp as float for backward compatibility."""
        return float(self.timestamp) / 1000.0
    
    @classmethod
    def from_legacy_data(cls, **data) -> 'TransportMessage':
        """Create TransportMessage from legacy message data."""
        # Map old field names to Event field names
        event_data = {}
        
        if 'message_id' in data:
            event_data['event_id'] = data.pop('message_id')
        if 'sender_id' in data:
            event_data['source_agent_id'] = data.pop('sender_id')
        if 'message_type' in data:
            # Convert legacy message_type to proper event_name
            message_type = data.pop('message_type')
            if message_type == 'direct_message':
                event_data['event_name'] = 'network.transport.direct_sent'
            elif message_type == 'broadcast_message':
                event_data['event_name'] = 'network.transport.broadcast_sent'
            elif message_type == 'mod_message':
                event_data['event_name'] = 'network.transport.mod_sent'
            else:
                event_data['event_name'] = 'network.transport.sent'
        if 'content' in data:
            event_data['payload'] = data.pop('content')
        
        # Keep transport-specific fields
        if 'target_id' in data:
            event_data['target_id'] = data['target_id']
            if data['target_id']:
                event_data['target_agent_id'] = data['target_id']
        
        # Add remaining data
        event_data.update(data)
        
        # Ensure required Event fields are set
        if not event_data.get('event_id'):
            event_data['event_id'] = str(uuid.uuid4())
        if not event_data.get('event_name'):
            event_data['event_name'] = 'network.transport.sent'
        if not event_data.get('source_agent_id'):
            event_data['source_agent_id'] = 'transport'
        
        return cls(**event_data) 