"""Transport layer models for OpenAgents."""

from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field, ConfigDict
from enum import Enum
import time
import uuid

from .messages import BaseMessage


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


class TransportMessage(BaseMessage):
    """Transport layer message extending BaseMessage for network transport."""
    
    message_type: str = Field("transport_message", description="Transport message type")
    target_id: Optional[str] = Field(None, description="Target peer ID (None for broadcast)")
    payload: Dict[str, Any] = Field(default_factory=dict, description="Transport-specific payload")
    
    def __init__(self, **data):
        # Ensure message_id is set if not provided
        if not data.get('message_id'):
            data['message_id'] = str(uuid.uuid4())
        # Convert timestamp to float for transport compatibility if needed
        if 'timestamp' not in data:
            data['timestamp'] = int(time.time() * 1000)
        super().__init__(**data)
    
    @property
    def timestamp_float(self) -> float:
        """Get timestamp as float for backward compatibility."""
        return float(self.timestamp) / 1000.0 