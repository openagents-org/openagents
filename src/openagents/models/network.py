"""Network models for OpenAgents."""

from typing import Dict, List, Optional, Any, Set
from pydantic import BaseModel, Field
import uuid


class NetworkMetadata(BaseModel):
    """Metadata for a network."""
    
    name: str = Field(..., description="Name of the network")
    network_id: str = Field(..., description="Unique identifier for the network")
    protocols: List[str] = Field(default_factory=list, description="Protocols implemented by the network")
    is_running: bool = Field(False, description="Whether the network is running")


class NetworkState(BaseModel):
    """State of a network."""
    
    network_id: str = Field(..., description="Unique identifier for the network")
    name: str = Field(..., description="Name of the network")
    is_running: bool = Field(False, description="Whether the network is running")
    protocols: Dict[str, Dict[str, Any]] = Field(default_factory=dict, description="Protocol states")
    agent_count: int = Field(0, description="Number of agents in the network")
    agents: Dict[str, Dict[str, Any]] = Field(default_factory=dict, description="Agent metadata by ID") 