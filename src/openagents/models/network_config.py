"""Configuration models for OpenAgents."""

from typing import Dict, List, Optional, Any, Union
from pydantic import BaseModel, Field, field_validator, model_validator, ConfigDict
from enum import Enum
from openagents.config.globals import DEFAULT_AGENT_GROUP
from openagents.models.network_profile import NetworkProfile
from openagents.models.transport import TransportType
from openagents.models.network_role import NetworkRole
from openagents.models.external_access import ExternalAccessConfig


class NetworkMode(str, Enum):
    """Network operation modes."""

    CENTRALIZED = "centralized"
    DECENTRALIZED = "decentralized"


class ProtocolConfig(BaseModel):
    """Base configuration for a protocol."""

    name: str = Field(..., description="Protocol name")
    enabled: bool = Field(True, description="Whether the protocol is enabled")
    config: Dict[str, Any] = Field(
        default_factory=dict, description="Protocol-specific configuration"
    )


class ModConfig(BaseModel):
    """Configuration for a network mod."""

    name: str = Field(..., description="Name of the mod")
    enabled: bool = Field(True, description="Whether the mod is enabled")
    config: Dict[str, Any] = Field(
        default_factory=dict, description="Mod-specific configuration"
    )


class AgentGroupConfig(BaseModel):
    """Configuration for an agent group.

    Uses password-based authentication where agents provide plain password
    as 'password_hash' parameter during registration (not in metadata -
    passed directly in the registration event payload).
    """

    password_hash: Optional[str] = Field(
        None,
        description="Bcrypt password hash for group authentication. "
                    "Agents send plain password directly in registration payload, server verifies against this hash."
    )
    description: str = Field(
        default="", description="Human-readable description of this group"
    )
    metadata: Dict[str, Any] = Field(
        default_factory=dict, description="Additional group metadata (e.g., permissions)"
    )


class AgentConfig(BaseModel):
    """Configuration for an agent."""

    name: str = Field(..., description="Name of the agent")
    protocols: List[ProtocolConfig] = Field(
        default_factory=list, description="Protocols to register with the agent"
    )
    services: List[Dict[str, Any]] = Field(
        default_factory=list, description="Services provided by the agent"
    )
    subscriptions: List[str] = Field(
        default_factory=list, description="Topics the agent subscribes to"
    )

    @field_validator("name")
    @classmethod
    def name_must_be_valid(cls, v):
        if not v or not isinstance(v, str):
            raise ValueError("Agent name must be a non-empty string")
        return v


class TransportConfigItem(BaseModel):
    """Configuration for a transport."""

    type: TransportType = Field(..., description="Transport type")
    config: Dict[str, Any] = Field(
        default_factory=dict, description="Transport-specific configuration"
    )


class NetworkConfig(BaseModel):
    """Configuration for a network."""

    model_config = ConfigDict(use_enum_values=True, extra='allow')

    name: str = Field(..., description="Name of the network")
    mode: NetworkMode = Field(
        NetworkMode.CENTRALIZED, description="Network operation mode"
    )
    node_id: Optional[str] = Field(
        None, description="Unique identifier for this network node"
    )

    # Network topology configuration
    bootstrap_nodes: List[str] = Field(
        default_factory=list, description="Bootstrap nodes for decentralized mode"
    )

    # Transport configuration
    transports: List[TransportConfigItem] = Field(
        default_factory=lambda: [
            TransportConfigItem(type=TransportType.HTTP, config={})
        ],
        description="List of transport configurations",
    )
    manifest_transport: Optional[str] = Field(
        "http", description="Transport used for manifests"
    )
    recommended_transport: Optional[str] = Field(
        None, description="Recommended transport type (will be auto-set from transports if not specified)"
    )

    # Security configuration
    encryption_enabled: bool = Field(True, description="Whether encryption is enabled")
    encryption_type: str = Field("noise", description="Type of encryption to use")
    disable_agent_secret_verification: bool = Field(
        False, description="Disable agent secret verification (for testing only)"
    )

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
        default_factory=list, description="Network mods to load"
    )

    # Messaging configuration
    message_queue_size: int = Field(1000, description="Maximum message queue size")
    message_timeout: float = Field(30.0, description="Message timeout in seconds")

    # Agent groups configuration
    agent_groups: Dict[str, AgentGroupConfig] = Field(
        default_factory=dict,
        description="Agent groups with registration tokens for group-based organization and permissions",
    )
    default_agent_group: str = Field(
        default=DEFAULT_AGENT_GROUP,
        description="Name of the default group for agents without valid credentials",
    )
    requires_password: bool = Field(
        default=False,
        description="When True, password authentication is mandatory for all agents (including default group). "
                    "When False, agents without password_hash are assigned to default_agent_group.",
    )

    # Network initialization state
    initialized: bool = Field(
        default=False,
        description="Whether the network has been initialized. When False, initialization APIs are available.",
    )

    # Version tracking
    created_by_version: Optional[str] = Field(
        default=None,
        description="OpenAgents version that created this network configuration.",
    )

    @field_validator("name")
    @classmethod
    def name_must_be_valid(cls, v):
        if not v or not isinstance(v, str):
            raise ValueError("Network name must be a non-empty string")
        return v

    @field_validator("agent_groups")
    @classmethod
    def validate_agent_groups(cls, v):
        """Validate agent groups configuration."""
        if not v:
            return v

        # Check that each group has password_hash defined
        for group_name, group_config in v.items():
            if not group_config.password_hash:
                raise ValueError(
                    f"Group '{group_name}' must have 'password_hash' defined"
                )

        return v

    @model_validator(mode='after')
    def validate_default_group_password_requirement(self):
        """Validate that default_agent_group doesn't require password when requires_password is False."""
        # If requires_password is False, agents without passwords should be able to join
        # So the default_agent_group must not require a password
        if not self.requires_password and self.agent_groups:
            default_group = self.default_agent_group
            if default_group in self.agent_groups:
                group_config = self.agent_groups[default_group]
                if group_config.password_hash:
                    raise ValueError(
                        f"Invalid configuration: 'requires_password' is False but "
                        f"default_agent_group '{default_group}' requires a password. "
                        f"Either set 'requires_password: true' or choose a default group "
                        f"that doesn't require a password."
                    )
        return self

    def model_post_init(self, __context):
        """Handle legacy transport fields and set defaults after model initialization."""
        # Handle legacy 'transport' (singular) field
        if hasattr(self, 'transport') and self.transport:
            legacy_transport = getattr(self, 'transport')
            legacy_config = getattr(self, 'transport_config', {}).copy()

            # Copy network-level host and port into transport config if not already present
            if hasattr(self, 'host') and 'host' not in legacy_config:
                legacy_config['host'] = getattr(self, 'host')
            if hasattr(self, 'port') and 'port' not in legacy_config:
                legacy_config['port'] = getattr(self, 'port')

            # If transports list is still the default (HTTP only), replace it with the legacy transport
            # For WebSocket, we still use HTTP (since WebSocket config actually sets up HTTP transport in the old design)
            if len(self.transports) == 1 and self.transports[0].type == TransportType.HTTP and not self.transports[0].config:
                transport_type = TransportType(legacy_transport) if isinstance(legacy_transport, str) else legacy_transport

                # For backward compatibility: "websocket" in legacy config actually means HTTP transport
                # (the old openagents used HTTP as the base transport layer)
                # So we keep HTTP as the transport type but update the recommended transport
                if transport_type == TransportType.WEBSOCKET:
                    # Use HTTP transport with the legacy config
                    self.transports = [TransportConfigItem(type=TransportType.HTTP, config=legacy_config)]
                else:
                    # For other transports, use the specified transport
                    self.transports = [TransportConfigItem(type=transport_type, config=legacy_config)]

        # Set recommended_transport to match the first available transport if not explicitly set
        if not self.recommended_transport and self.transports:
            self.recommended_transport = self.transports[0].type.value if hasattr(self.transports[0].type, 'value') else str(self.transports[0].type)

        # Set manifest_transport to HTTP by default (used for health checks)
        if not self.manifest_transport:
            self.manifest_transport = "http"


class OpenAgentsConfig(BaseModel):
    """Root configuration for OpenAgents."""

    # Core network configuration
    network: NetworkConfig = Field(..., description="Network configuration")

    # Agent configurations
    service_agents: List[AgentConfig] = Field(
        default_factory=list, description="Service agent configurations"
    )

    # Network profile for discovery
    network_profile: Optional[NetworkProfile] = Field(
        None, description="Network profile"
    )

    # External access configuration for MCP and other external agents
    external_access: Optional[ExternalAccessConfig] = Field(
        None, description="Configuration for external agent access control (instructions, tool filtering)"
    )

    # Global settings
    log_level: str = Field("INFO", description="Logging level")
    data_dir: Optional[str] = Field(None, description="Directory for persistent data")

    # Runtime configuration
    runtime_limit: Optional[int] = Field(
        None, description="Runtime limit in seconds (None for unlimited)"
    )
    shutdown_timeout: int = Field(30, description="Shutdown timeout in seconds")


# Configuration templates for common use cases
def create_centralized_server_config(
    network_name: str = "OpenAgentsNetwork",
    host: str = "0.0.0.0",
    port: int = 8570,
    protocols: Optional[List[str]] = None,
) -> OpenAgentsConfig:
    """Create a configuration for a centralized server."""
    if protocols is None:
        protocols = [
            "openagents.mods.communication.simple_messaging",
            "openagents.mods.discovery.agent_discovery",
        ]

    return OpenAgentsConfig(
        network=NetworkConfig(
            name=network_name,
            mode=NetworkMode.CENTRALIZED,
            host=host,
            port=port,
            server_mode=True,
            protocols=[ProtocolConfig(name=p, enabled=True) for p in protocols],
        )
    )


def create_centralized_client_config(
    network_name: str = "OpenAgentsNetwork",
    coordinator_url: str = "ws://localhost:8570",
    protocols: Optional[List[str]] = None,
) -> OpenAgentsConfig:
    """Create a configuration for a centralized client."""
    if protocols is None:
        protocols = [
            "openagents.mods.communication.simple_messaging",
            "openagents.mods.discovery.agent_discovery",
        ]

    return OpenAgentsConfig(
        network=NetworkConfig(
            name=network_name,
            mode=NetworkMode.CENTRALIZED,
            server_mode=False,
            coordinator_url=coordinator_url,
            protocols=[ProtocolConfig(name=p, enabled=True) for p in protocols],
        )
    )


def create_decentralized_config(
    network_name: str = "OpenAgentsP2P",
    host: str = "0.0.0.0",
    port: int = 0,  # Random port
    bootstrap_nodes: Optional[List[str]] = None,
    transport: Union[TransportType, str] = TransportType.LIBP2P,
    protocols: Optional[List[str]] = None,
) -> OpenAgentsConfig:
    """Create a configuration for a decentralized network."""
    if protocols is None:
        protocols = [
            "openagents.mods.communication.simple_messaging",
            "openagents.mods.discovery.agent_discovery",
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
            protocols=[ProtocolConfig(name=p, enabled=True) for p in protocols],
        )
    )
