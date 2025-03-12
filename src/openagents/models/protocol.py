"""Protocol models for OpenAgents."""

from typing import Dict, List, Optional, Any, Set
from pydantic import BaseModel, Field, validator


class ProtocolManifest(BaseModel):
    """Manifest for a protocol."""
    
    name: str = Field(..., description="Name of the protocol")
    version: str = Field("1.0.0", description="Version of the protocol")
    description: str = Field("", description="Description of the protocol")
    capabilities: List[str] = Field(default_factory=list, description="Capabilities provided by the protocol")
    dependencies: List[str] = Field(default_factory=list, description="Dependencies of the protocol")
    agent_protocol_class: Optional[str] = Field(None, description="Agent protocol class")
    network_protocol_class: Optional[str] = Field(None, description="Network protocol class")
    
    @validator('name')
    def name_must_be_valid(cls, v):
        if not v or not isinstance(v, str):
            raise ValueError('Protocol name must be a non-empty string')
        return v 