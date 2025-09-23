"""Configuration models for OpenAgents."""

from typing import Dict, List, Optional, Any, Union
from pydantic import BaseModel, Field, field_validator, ConfigDict
from enum import Enum
from openagents.models.network_profile import NetworkProfile
from openagents.models.transport import TransportType
from openagents.models.network_role import NetworkRole

class NetworkMode(str, Enum):
    """Network operation modes."""
    CENTRALIZED = "centralized"
    DECENTRALIZED = "decentralized"


class ProtocolConfig(BaseModel):
    """Base configuration for a protocol."""
    
    name: str = Field(..., description="Protocol name")
    enabled: bool = Field(True, description="Whether the protocol is enabled")
    config: Dict[str, Any] = Field(default_factory=dict, description="Protocol-specific configuration")


class ModConfig(BaseModel):
    """Configuration for a network mod."""
    
    name: str = Field(..., description="Name of the mod")
    enabled: bool = Field(True, description="Whether the mod is enabled")
    config: Dict[str, Any] = Field(default_factory=dict, description="Mod-specific configuration")


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

class TransportConfigItem(BaseModel):
    """Configuration for a transport."""
    
    type: TransportType = Field(..., description="Transport type")
    config: Dict[str, Any] = Field(default_factory=dict, description="Transport-specific configuration")


class NetworkConfig(BaseModel):
    """Configuration for a network."""
    
    model_config = ConfigDict(use_enum_values=True)
    
    name: str = Field(..., description="Name of the network")
    mode: NetworkMode = Field(NetworkMode.CENTRALIZED, description="Network operation mode")
    node_id: Optional[str] = Field(None, description="Unique identifier for this network node")
    
    # Network topology configuration
    bootstrap_nodes: List[str] = Field(default_factory=list, description="Bootstrap nodes for decentralized mode")
    
    # Transport configuration
    transports: List[TransportConfigItem] = Field(
        default_factory=lambda: [
            TransportConfigItem(type=TransportType.HTTP, config={})
        ],
        description="List of transport configurations"
    )
    manifest_transport: Optional[str] = Field("http", description="Transport used for manifests")
    recommended_transport: Optional[str] = Field("grpc", description="Recommended transport type")
    
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
    
    # Mods configuration
    mods: List[ModConfig] = Field(
        default_factory=list,
        description="Network mods to load"
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
            "openagents.mods.communication.simple_messaging",
            "openagents.mods.discovery.agent_discovery"
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
            "openagents.mods.communication.simple_messaging",
            "openagents.mods.discovery.agent_discovery"
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
            "openagents.mods.communication.simple_messaging",
            "openagents.mods.discovery.agent_discovery"
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