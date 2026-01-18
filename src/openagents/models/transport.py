"""Transport layer models for OpenAgents."""

from typing import Dict, Any, List, Optional, Literal
from pydantic import BaseModel, Field, ConfigDict, field_validator
from enum import Enum
import time
import uuid
from pathlib import Path

from .event import Event
from .a2a import AgentCard
from dataclasses import dataclass, field


class TransportType(str, Enum):
    """Supported transport types."""

    WEBSOCKET = "websocket"
    LIBP2P = "libp2p"
    GRPC = "grpc"
    WEBRTC = "webrtc"
    HTTP = "http"
    MCP = "mcp"
    A2A = "a2a"


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
    transport_type: TransportType = Field(
        ..., description="Transport type used by this peer"
    )
    capabilities: List[str] = Field(
        default_factory=list, description="List of capabilities supported by the peer"
    )
    last_seen: float = Field(
        default_factory=time.time, description="Timestamp when peer was last seen"
    )
    metadata: Dict[str, Any] = Field(
        default_factory=dict, description="Additional metadata about the peer"
    )


class ConnectionInfo(BaseModel):
    """Information about a connection."""

    model_config = ConfigDict(use_enum_values=True)

    connection_id: str = Field(..., description="Unique identifier for the connection")
    peer_id: str = Field(..., description="ID of the connected peer")
    transport_type: TransportType = Field(
        ..., description="Transport type for this connection"
    )
    state: ConnectionState = Field(..., description="Current state of the connection")
    last_activity: float = Field(
        default_factory=time.time, description="Timestamp of last activity"
    )
    retry_count: int = Field(default=0, description="Number of retry attempts")
    max_retries: int = Field(default=3, description="Maximum number of retry attempts")
    backoff_delay: float = Field(
        default=1.0, description="Current backoff delay in seconds"
    )


class RemoteAgentStatus(str, Enum):
    """Status of a remote A2A agent."""

    ACTIVE = "active"          # Reachable, card is fresh
    STALE = "stale"            # Failed health check, may be temporarily down
    REFRESHING = "refreshing"  # Card refresh in progress


class AgentConnection(BaseModel):
    """Information about an agent in the network.

    All agents are treated uniformly regardless of transport type.
    A2A-specific fields (agent_card, remote_status, etc.) are optional
    and only populated for agents using the A2A transport.
    """

    model_config = ConfigDict(use_enum_values=True)

    agent_id: str = Field(..., description="Unique identifier for the agent")
    metadata: Dict[str, Any] = Field(
        default_factory=dict, description="Additional metadata about the agent"
    )
    capabilities: List[str] = Field(
        default_factory=list, description="List of capabilities supported by the agent"
    )
    last_seen: float = Field(
        default_factory=time.time, description="Timestamp when agent was last seen"
    )
    transport_type: TransportType = Field(
        ..., description="Transport type used by this agent"
    )
    address: Optional[str] = Field(None, description="Network address of the agent")
    role: Optional[str] = Field(None, description="Role of the agent in the network")

    # A2A transport-specific fields (optional, only for A2A agents)
    agent_card: Optional[AgentCard] = Field(
        None, description="Agent Card for A2A agents"
    )
    remote_status: Optional[RemoteAgentStatus] = Field(
        None, description="Status of A2A agent (active, stale, refreshing)"
    )
    announced_at: Optional[float] = Field(
        None, description="Timestamp when A2A agent was announced"
    )
    last_health_check: Optional[float] = Field(
        None, description="Timestamp of last health check for A2A agents"
    )
    failure_count: int = Field(
        default=0, description="Number of consecutive failures for A2A agent"
    )

    def is_a2a(self) -> bool:
        """Check if this agent uses the A2A transport."""
        return self.transport_type == TransportType.A2A

    def is_healthy(self) -> bool:
        """Check if agent is healthy.

        For A2A agents, checks the remote_status.
        For other transports, always returns True (health is managed by heartbeats).
        """
        if not self.is_a2a():
            return True
        return self.remote_status == RemoteAgentStatus.ACTIVE


class TLSConfig(BaseModel):
    """TLS configuration for secure transports."""

    enabled: bool = Field(default=False, description="Whether TLS is enabled")
    cert_file: Optional[str] = Field(None, description="Path to server certificate file")
    key_file: Optional[str] = Field(None, description="Path to server private key file")
    ca_file: Optional[str] = Field(None, description="Path to CA certificate file for client verification")
    require_client_cert: bool = Field(default=False, description="Whether to require client certificates (mTLS)")
    min_version: Literal["TLS1.2", "TLS1.3"] = Field(default="TLS1.2", description="Minimum TLS version")

    @field_validator('cert_file', 'key_file', 'ca_file')
    @classmethod
    def validate_file_exists(cls, v: Optional[str]) -> Optional[str]:
        """Validate that certificate files exist if specified."""
        if v is not None:
            path = Path(v)
            if not path.exists():
                raise ValueError(f"Certificate file not found: {v}")
        return v

    @field_validator('key_file')
    @classmethod
    def require_key_with_cert(cls, v: Optional[str], info) -> Optional[str]:
        """Ensure key_file is provided when cert_file is specified."""
        values = info.data
        if values.get('enabled') and values.get('cert_file') and not v:
            raise ValueError("key_file required when cert_file is provided and TLS is enabled")
        return v


class SSLConfig(BaseModel):
    """SSL configuration for client connections."""

    verify: bool = Field(default=True, description="Whether to verify server certificate")
    ca_cert: Optional[str] = Field(None, description="Path to CA certificate for server verification")
    client_cert: Optional[str] = Field(None, description="Path to client certificate for mTLS")
    client_key: Optional[str] = Field(None, description="Path to client private key for mTLS")

    @field_validator('ca_cert', 'client_cert', 'client_key')
    @classmethod
    def validate_file_exists(cls, v: Optional[str]) -> Optional[str]:
        """Validate that certificate files exist if specified."""
        if v is not None:
            path = Path(v)
            if not path.exists():
                raise ValueError(f"Certificate file not found: {v}")
        return v
