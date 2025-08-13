"""Configuration models for OpenAgents."""

from typing import Dict, List, Optional, Any, Union
from pydantic import BaseModel, Field, field_validator, ConfigDict
from enum import Enum
from openagents.models.network_profile import NetworkProfile
from openagents.models.transport import TransportType


class NetworkMode(Enum):
    """Network operation modes."""
    CENTRALIZED = "centralized"
    DECENTRALIZED = "decentralized"


class ProtocolConfig(BaseModel):
    """Base configuration for a protocol."""
    
    name: str = Field(..., description="Protocol name")
    enabled: bool = Field(True, description="Whether the protocol is enabled")
    config: Dict[str, Any] = Field(default_factory=dict, description="Protocol-specific configuration")


class AgentConfig(BaseModel):
    """Configuration for an agent."""
    
    name: str = Field(..., description="Name of the agent")
    protocols: List[ProtocolConfig] = Field(
        default_factory=list, 
        description="Protocols to register with the agent"
    )
    services: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="Services provided by the agent"
    )
    subscriptions: List[str] = Field(
        default_factory=list,
        description="Topics the agent subscribes to"
    )
    
    @field_validator('name')
    @classmethod
    def name_must_be_valid(cls, v):
        if not v or not isinstance(v, str):
            raise ValueError('Agent name must be a non-empty string')
        return v


class NetworkConfig(BaseModel):
    """Configuration for a network."""
    
    model_config = ConfigDict(use_enum_values=True)
    
    name: str = Field(..., description="Name of the network")
    mode: NetworkMode = Field(NetworkMode.CENTRALIZED, description="Network operation mode")
    node_id: Optional[str] = Field(None, description="Unique identifier for this network node")
    
    # Network topology configuration
    host: str = Field("127.0.0.1", description="Host address to bind to")
    port: int = Field(8570, description="Port to listen on")
    server_mode: bool = Field(False, description="Whether this node acts as a server/coordinator")
    coordinator_url: Optional[str] = Field(None, description="URL of the coordinator (for centralized mode)")
    bootstrap_nodes: List[str] = Field(default_factory=list, description="Bootstrap nodes for decentralized mode")
    
    # Transport configuration
    transport: Union[TransportType, str] = Field(TransportType.WEBSOCKET, description="Transport type to use")
    transport_config: Dict[str, Any] = Field(default_factory=dict, description="Transport-specific configuration")
    
    # Security configuration
    encryption_enabled: bool = Field(True, description="Whether encryption is enabled")
    encryption_type: str = Field("noise", description="Type of encryption to use")
    
    # Discovery configuration
    discovery_interval: int = Field(5, description="Discovery interval in seconds")
    discovery_enabled: bool = Field(True, description="Whether discovery is enabled")
    
    # Connection management
    max_connections: int = Field(100, description="Maximum number of connections")
    connection_timeout: float = Field(30.0, description="Connection timeout in seconds")
    retry_attempts: int = Field(3, description="Number of retry attempts")
    heartbeat_interval: int = Field(30, description="Heartbeat interval in seconds")
    
    # Protocols
    protocols: List[ProtocolConfig] = Field(
        default_factory=list,
        description="Protocols to register with the network"
    )
    
    # Messaging configuration
    message_queue_size: int = Field(1000, description="Maximum message queue size")
    message_timeout: float = Field(30.0, description="Message timeout in seconds")
    
    @field_validator('name')
    @classmethod
    def name_must_be_valid(cls, v):
        if not v or not isinstance(v, str):
            raise ValueError('Network name must be a non-empty string')
        return v
    
    @field_validator('transport', mode='before')
    @classmethod
    def validate_transport(cls, v):
        if isinstance(v, str):
            # Convert string to enum for validation but allow string values for YAML compatibility
            try:
                TransportType(v)  # Just validate the string is valid
                return v  # Return string value for backward compatibility
            except ValueError:
                raise ValueError(f"Invalid transport type: {v}. Must be one of: {[t.value for t in TransportType]}")
        elif isinstance(v, TransportType):
            return v.value  # Convert enum to string for consistency
        return v
    
    @field_validator('coordinator_url')
    @classmethod
    def coordinator_url_required_for_centralized_client(cls, v, info):
        if info.data.get('mode') == NetworkMode.CENTRALIZED and not info.data.get('server_mode', False):
            if not v:
                raise ValueError('coordinator_url is required for centralized client mode')
        return v


class OpenAgentsConfig(BaseModel):
    """Root configuration for OpenAgents."""
    
    # Core network configuration
    network: NetworkConfig = Field(..., description="Network configuration")
    
    # Agent configurations
    service_agents: List[AgentConfig] = Field(default_factory=list, description="Service agent configurations") 
    
    # Network profile for discovery
    network_profile: Optional[NetworkProfile] = Field(None, description="Network profile")
    
    # Global settings
    log_level: str = Field("INFO", description="Logging level")
    data_dir: Optional[str] = Field(None, description="Directory for persistent data")
    
    # Runtime configuration
    runtime_limit: Optional[int] = Field(None, description="Runtime limit in seconds (None for unlimited)")
    shutdown_timeout: int = Field(30, description="Shutdown timeout in seconds")


# Configuration templates for common use cases
def create_centralized_server_config(
    network_name: str = "OpenAgentsNetwork",
    host: str = "0.0.0.0",
    port: int = 8570,
    protocols: Optional[List[str]] = None
) -> OpenAgentsConfig:
    """Create a configuration for a centralized server."""
    if protocols is None:
        protocols = [
            "openagents.protocols.communication.simple_messaging",
            "openagents.protocols.discovery.agent_discovery"
        ]
    
    return OpenAgentsConfig(
        network=NetworkConfig(
            name=network_name,
            mode=NetworkMode.CENTRALIZED,
            host=host,
            port=port,
            server_mode=True,
            protocols=[ProtocolConfig(name=p, enabled=True) for p in protocols]
        )
    )


def create_centralized_client_config(
    network_name: str = "OpenAgentsNetwork",
    coordinator_url: str = "ws://localhost:8570",
    protocols: Optional[List[str]] = None
) -> OpenAgentsConfig:
    """Create a configuration for a centralized client."""
    if protocols is None:
        protocols = [
            "openagents.protocols.communication.simple_messaging",
            "openagents.protocols.discovery.agent_discovery"
        ]
    
    return OpenAgentsConfig(
        network=NetworkConfig(
            name=network_name,
            mode=NetworkMode.CENTRALIZED,
            server_mode=False,
            coordinator_url=coordinator_url,
            protocols=[ProtocolConfig(name=p, enabled=True) for p in protocols]
        )
    )


def create_decentralized_config(
    network_name: str = "OpenAgentsP2P",
    host: str = "0.0.0.0",
    port: int = 0,  # Random port
    bootstrap_nodes: Optional[List[str]] = None,
    transport: Union[TransportType, str] = TransportType.LIBP2P,
    protocols: Optional[List[str]] = None
) -> OpenAgentsConfig:
    """Create a configuration for a decentralized network."""
    if protocols is None:
        protocols = [
            "openagents.protocols.communication.simple_messaging",
            "openagents.protocols.discovery.agent_discovery"
        ]
    
    if bootstrap_nodes is None:
        bootstrap_nodes = []
    
    return OpenAgentsConfig(
        network=NetworkConfig(
            name=network_name,
            mode=NetworkMode.DECENTRALIZED,
            host=host,
            port=port,
            bootstrap_nodes=bootstrap_nodes,
            transport=transport,
            protocols=[ProtocolConfig(name=p, enabled=True) for p in protocols]
        )
    )