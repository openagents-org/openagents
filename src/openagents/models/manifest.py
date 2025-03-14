"""Manifest models for OpenAgents."""

from typing import Dict, List, Optional, Any
from pydantic import BaseModel, Field, validator


class ProtocolManifest(BaseModel):
    """Manifest for a protocol."""
    
    protocol_name: Optional[str] = Field(None, description="Alternative name for the protocol")
    version: str = Field("1.0.0", description="Version of the protocol")
    description: str = Field("", description="Description of the protocol")
    capabilities: List[str] = Field(default_factory=list, description="Capabilities provided by the protocol")
    dependencies: List[str] = Field(default_factory=list, description="Dependencies of the protocol")
    authors: List[str] = Field(default_factory=list, description="Authors of the protocol")
    license: Optional[str] = Field(None, description="License of the protocol")
    agent_adapter_class: Optional[str] = Field(None, description="Agent adapter class name")
    network_protocol_class: Optional[str] = Field(None, description="Network protocol class name")
    agent_protocol_class: Optional[str] = Field(None, description="Agent protocol class")
    network_protocol_class: Optional[str] = Field(None, description="Network protocol class")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Additional metadata for the protocol")
    default_config: Dict[str, Any] = Field(default_factory=dict, description="Configuration for the protocol")
    requires_adapter: bool = Field(True, description="Whether the protocol requires an agent adapter")