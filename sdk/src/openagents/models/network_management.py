"""Models for network import/export/management operations."""

from enum import Enum
from typing import Dict, List, Optional, Any
from pydantic import BaseModel, Field


class ImportMode(str, Enum):
    """Mode for importing network configuration."""
    CREATE_NEW = "create_new"
    OVERWRITE = "overwrite"
    MERGE = "merge"


class ExportManifest(BaseModel):
    """Manifest metadata for exported network configuration."""
    export_version: str = Field(..., description="Export format version")
    network_name: str = Field(..., description="Network name")
    export_timestamp: str = Field(..., description="ISO timestamp of export")
    openagents_version: Optional[str] = Field(None, description="OpenAgents version")
    notes: Optional[str] = Field(None, description="User notes about this export")
    includes_password_hashes: bool = Field(False, description="Whether password hashes are included")
    includes_sensitive_config: bool = Field(False, description="Whether sensitive config is included")
    mods_count: int = Field(0, description="Number of mods exported")
    has_network_profile: bool = Field(False, description="Whether network profile is included")
    workspace_files_count: int = Field(0, description="Number of workspace files exported")


class ImportValidationResult(BaseModel):
    """Result of import validation."""
    valid: bool = Field(..., description="Whether the import is valid")
    errors: List[str] = Field(default_factory=list, description="Validation errors")
    warnings: List[str] = Field(default_factory=list, description="Validation warnings")
    manifest: Optional[ExportManifest] = Field(None, description="Export manifest if present")
    preview: Optional["ImportPreview"] = Field(None, description="Preview of import")


class ImportPreview(BaseModel):
    """Preview of what will be imported."""
    network_name: str = Field(..., description="Network name from import")
    mode: ImportMode = Field(..., description="Import mode")
    mods_to_add: List[str] = Field(default_factory=list, description="Mods to be added")
    mods_to_update: List[str] = Field(default_factory=list, description="Mods to be updated")
    has_network_profile: bool = Field(False, description="Whether network profile will be imported")
    config_changes: Dict[str, Any] = Field(default_factory=dict, description="Config changes summary")
    workspace_files_count: int = Field(0, description="Number of workspace files to be imported")


class ImportResult(BaseModel):
    """Result of import operation."""
    success: bool = Field(..., description="Whether import succeeded")
    message: str = Field(..., description="Result message")
    errors: List[str] = Field(default_factory=list, description="Errors encountered")
    warnings: List[str] = Field(default_factory=list, description="Warnings encountered")
    network_restarted: bool = Field(False, description="Whether network was restarted")
    applied_config: Optional[Dict[str, Any]] = Field(None, description="Applied configuration summary")

