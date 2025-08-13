"""Manifest models for OpenAgents."""

from typing import Dict, List, Optional, Any
from pydantic import BaseModel, Field, validator


class ModManifest(BaseModel):
    """Manifest for a mod."""
    
    mod_name: Optional[str] = Field(None, description="Alternative name for the mod")
    version: str = Field("1.0.0", description="Version of the mod")
    description: str = Field("", description="Description of the mod")
    capabilities: List[str] = Field(default_factory=list, description="Capabilities provided by the mod")
    dependencies: List[str] = Field(default_factory=list, description="Dependencies of the mod")
    authors: List[str] = Field(default_factory=list, description="Authors of the mod")
    license: Optional[str] = Field(None, description="License of the mod")
    agent_adapter_class: Optional[str] = Field(None, description="Agent adapter class name")
    network_protocol_class: Optional[str] = Field(None, description="Network protocol class name")
    agent_mod_class: Optional[str] = Field(None, description="Agent mod class")
    network_mod_class: Optional[str] = Field(None, description="Network mod class")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Additional metadata for the mod")
    default_config: Dict[str, Any] = Field(default_factory=dict, description="Configuration for the mod")
    requires_adapter: bool = Field(True, description="Whether the mod requires an agent adapter")