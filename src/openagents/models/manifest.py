"""Manifest models for OpenAgents."""

from typing import Dict, List, Optional, Any
from pydantic import BaseModel, Field, validator


class ProtocolManifest(BaseModel):
    """Manifest for a protocol."""
    
    name: str = Field(..., description="Name of the protocol")
    protocol_name: Optional[str] = Field(None, description="Alternative name for the protocol")
    version: str = Field("1.0.0", description="Version of the protocol")
    description: str = Field("", description="Description of the protocol")
    capabilities: List[str] = Field(default_factory=list, description="Capabilities provided by the protocol")
    dependencies: List[str] = Field(default_factory=list, description="Dependencies of the protocol")
    authors: List[str] = Field(default_factory=list, description="Authors of the protocol")
    license: Optional[str] = Field(None, description="License of the protocol")
    agent_adapter: Optional[str] = Field(None, description="Agent adapter class name")
    network_protocol: Optional[str] = Field(None, description="Network protocol class name")
    agent_protocol_class: Optional[str] = Field(None, description="Agent protocol class")
    network_protocol_class: Optional[str] = Field(None, description="Network protocol class")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Additional metadata for the protocol")
    
    @validator('name')
    def name_must_be_valid(cls, v):
        if not v or not isinstance(v, str):
            raise ValueError('Protocol name must be a non-empty string')
        return v
        
    def get_protocol_name(self) -> str:
        """Get the protocol name, preferring protocol_name if available."""
        return self.protocol_name or self.name 