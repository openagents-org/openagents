"""Detected network profile models for OpenAgents.

This module defines the data models for detected network profiles, which are
automatically populated from network health check data and represent the
runtime characteristics of discovered OpenAgents networks.
"""

from typing import List, Optional, Dict, Any, Set
from datetime import datetime
from pydantic import BaseModel, Field, computed_field
from openagents.models.transport import TransportType


class DetectedAgentInfo(BaseModel):
    """Information about a detected agent in the network."""

    agent_id: str = Field(..., description="Unique identifier of the agent")
    capabilities: List[str] = Field(
        default_factory=list, description="Agent capabilities"
    )
    last_seen: float = Field(..., description="Timestamp when agent was last seen")
    transport_type: TransportType = Field(
        ..., description="Transport type used by the agent"
    )
    address: Optional[str] = Field(None, description="Network address of the agent")

    @computed_field
    @property
    def is_online(self) -> bool:
        """Check if agent is considered online based on last_seen timestamp."""
        import time

        # Consider agent online if seen within last 5 minutes
        return (time.time() - self.last_seen) < 300


class DetectedModInfo(BaseModel):
    """Information about a detected mod in the network."""

    name: str = Field(..., description="Name of the mod")
    enabled: bool = Field(True, description="Whether the mod is enabled")
    config: Dict[str, Any] = Field(
        default_factory=dict, description="Mod configuration"
    )


class DetectedTransportInfo(BaseModel):
    """Information about a detected transport in the network."""

    type: TransportType = Field(..., description="Transport type")
    config: Dict[str, Any] = Field(
        default_factory=dict, description="Transport configuration"
    )


class DetectedNetworkProfile(BaseModel):
    """Profile information for a detected OpenAgents network.

    This model represents the runtime characteristics of an OpenAgents network
    as discovered through health check and network statistics. It provides
    comprehensive information about the network's current state, capabilities,
    and connected agents.
    """

    # Core network identification
    network_id: str = Field(..., description="Unique identifier of the network")
    network_name: str = Field(..., description="Human-readable name of the network")

    # Network status and runtime information
    is_running: bool = Field(
        ..., description="Whether the network is currently running"
    )
    uptime_seconds: float = Field(..., description="Network uptime in seconds")
    detection_timestamp: datetime = Field(
        default_factory=datetime.now,
        description="When this profile was detected/created",
    )

    # Network topology and configuration
    topology_mode: str = Field(
        ..., description="Network topology mode (centralized/decentralized)"
    )
    transports: List[DetectedTransportInfo] = Field(
        default_factory=list, description="Available transport configurations"
    )
    manifest_transport: Optional[str] = Field(
        None, description="Transport used for manifests"
    )
    recommended_transport: Optional[str] = Field(
        None, description="Recommended transport type"
    )
    max_connections: int = Field(
        100, description="Maximum number of connections allowed"
    )

    # Agent information
    agent_count: int = Field(0, description="Total number of registered agents")
    agents: Dict[str, DetectedAgentInfo] = Field(
        default_factory=dict, description="Information about registered agents"
    )

    # Mod information
    mods: List[DetectedModInfo] = Field(
        default_factory=list, description="Information about loaded mods"
    )

    # Additional metadata from the network
    metadata: Dict[str, Any] = Field(
        default_factory=dict, description="Additional network metadata"
    )

    @computed_field
    @property
    def online_agent_count(self) -> int:
        """Count of agents that are currently online."""
        return sum(1 for agent in self.agents.values() if agent.is_online)

    @computed_field
    @property
    def available_transport_types(self) -> Set[str]:
        """Set of available transport types."""
        return {transport.type.value for transport in self.transports}

    @computed_field
    @property
    def mod_names(self) -> List[str]:
        """List of loaded mod names."""
        return [mod.name for mod in self.mods]

    @computed_field
    @property
    def enabled_mod_count(self) -> int:
        """Count of enabled mods."""
        return sum(1 for mod in self.mods if mod.enabled)

    @computed_field
    @property
    def uptime_formatted(self) -> str:
        """Human-readable uptime string."""
        if self.uptime_seconds < 60:
            return f"{self.uptime_seconds:.1f} seconds"
        elif self.uptime_seconds < 3600:
            minutes = self.uptime_seconds / 60
            return f"{minutes:.1f} minutes"
        elif self.uptime_seconds < 86400:
            hours = self.uptime_seconds / 3600
            return f"{hours:.1f} hours"
        else:
            days = self.uptime_seconds / 86400
            return f"{days:.1f} days"

    @computed_field
    @property
    def capabilities(self) -> List[str]:
        """Aggregate capabilities from all agents and mods."""
        capabilities = set()

        # Add agent capabilities
        for agent in self.agents.values():
            capabilities.update(agent.capabilities)

        # Add mod names as capabilities
        capabilities.update(self.mod_names)

        return sorted(list(capabilities))

    @classmethod
    def from_network_stats(cls, stats: Dict[str, Any]) -> "DetectedNetworkProfile":
        """Create a DetectedNetworkProfile from network statistics data.

        Args:
            stats: Network statistics dictionary from get_network_stats()

        Returns:
            DetectedNetworkProfile: Populated profile instance
        """
        # Parse agents information
        agents = {}
        for agent_id, agent_data in stats.get("agents", {}).items():
            agents[agent_id] = DetectedAgentInfo(
                agent_id=agent_id,
                capabilities=agent_data.get("capabilities", []),
                last_seen=agent_data.get("last_seen", 0),
                transport_type=TransportType(agent_data.get("transport_type", "http")),
                address=agent_data.get("address"),
            )

        # Parse mods information
        mods = []
        for mod_data in stats.get("mods", []):
            if isinstance(mod_data, dict):
                mods.append(
                    DetectedModInfo(
                        name=mod_data.get("name", "unknown"),
                        enabled=mod_data.get("enabled", True),
                        config=mod_data.get("config", {}),
                    )
                )

        # Parse transports information
        transports = []
        for transport_data in stats.get("transports", []):
            if isinstance(transport_data, dict):
                transports.append(
                    DetectedTransportInfo(
                        type=TransportType(transport_data.get("type", "http")),
                        config=transport_data.get("config", {}),
                    )
                )

        # Parse topology mode
        topology_mode_str = stats.get("topology_mode", "centralized")
        if isinstance(topology_mode_str, str):
            topology_mode = topology_mode_str.lower()
        else:
            topology_mode = "centralized"

        return cls(
            network_id=stats.get("network_id", "unknown"),
            network_name=stats.get("network_name", "Unknown Network"),
            is_running=stats.get("is_running", False),
            uptime_seconds=stats.get("uptime_seconds", 0),
            topology_mode=topology_mode,
            transports=transports,
            manifest_transport=stats.get("manifest_transport"),
            recommended_transport=stats.get("recommended_transport"),
            max_connections=stats.get("max_connections", 100),
            agent_count=stats.get("agent_count", 0),
            agents=agents,
            mods=mods,
            metadata=stats.get("metadata", {}),
        )

    def to_summary(self) -> Dict[str, Any]:
        """Create a summary dictionary with key network information.

        Returns:
            Dict containing summary information suitable for display or logging
        """
        return {
            "network_id": self.network_id,
            "network_name": self.network_name,
            "status": "running" if self.is_running else "stopped",
            "uptime": self.uptime_formatted,
            "topology": self.topology_mode.value,
            "agents": {"total": self.agent_count, "online": self.online_agent_count},
            "mods": {"total": len(self.mods), "enabled": self.enabled_mod_count},
            "transports": list(self.available_transport_types),
            "detection_time": self.detection_timestamp.isoformat(),
        }
