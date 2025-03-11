"""Agent models for OpenAgents."""

from typing import Dict, List, Optional, Any, Set
from pydantic import BaseModel, Field
import uuid


class AgentMetadata(BaseModel):
    """Metadata for an agent."""
    
    name: str = Field(..., description="Name of the agent")
    agent_id: str = Field(..., description="Unique identifier for the agent")
    capabilities: List[str] = Field(default_factory=list, description="Capabilities provided by the agent")
    services: List[str] = Field(default_factory=list, description="Services provided by the agent")
    protocols: List[str] = Field(default_factory=list, description="Protocols implemented by the agent")
    is_running: bool = Field(False, description="Whether the agent is running")


class AgentState(BaseModel):
    """State of an agent."""
    
    agent_id: str = Field(..., description="Unique identifier for the agent")
    name: str = Field(..., description="Name of the agent")
    is_running: bool = Field(False, description="Whether the agent is running")
    protocols: Dict[str, Dict[str, Any]] = Field(default_factory=dict, description="Protocol states")
    capabilities: List[str] = Field(default_factory=list, description="Capabilities provided by the agent")
    network_id: Optional[str] = Field(None, description="ID of the network the agent is connected to") 