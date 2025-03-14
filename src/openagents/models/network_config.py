"""Configuration models for OpenAgents."""

from typing import Dict, List, Optional, Any, Union
from pydantic import BaseModel, Field, validator
from openagents.models.network_profile import NetworkProfile

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
    
    @validator('name')
    def name_must_be_valid(cls, v):
        if not v or not isinstance(v, str):
            raise ValueError('Agent name must be a non-empty string')
        return v


class NetworkConfig(BaseModel):
    """Configuration for a network."""
    
    name: str = Field(..., description="Name of the network")
    protocols: List[ProtocolConfig] = Field(
        default_factory=list,
        description="Protocols to register with the network"
    )
    
    @validator('name')
    def name_must_be_valid(cls, v):
        if not v or not isinstance(v, str):
            raise ValueError('Network name must be a non-empty string')
        return v


class OpenAgentsConfig(BaseModel):
    """Root configuration for OpenAgents."""
    
    network: NetworkConfig = Field(..., description="Network configuration")
    service_agents: List[AgentConfig] = Field(default_factory=list, description="Service agent configurations") 
    network_profile: Optional[NetworkProfile] = Field(None, description="Network profile")