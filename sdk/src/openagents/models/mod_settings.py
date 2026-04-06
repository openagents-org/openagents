"""Models for mod settings and configuration schemas."""

from typing import Dict, List, Optional, Any, Literal, Union
from pydantic import BaseModel, Field


class SelectOption(BaseModel):
    """Option for select/multiselect fields."""
    value: str = Field(..., description="Option value")
    label: str = Field(..., description="Display label for the option")


class ConfigField(BaseModel):
    """Configuration field definition in a mod's config schema."""
    
    key: str = Field(..., description="Configuration key name")
    type: Literal[
        "string", "number", "boolean", "select", "multiselect", 
        "list", "object", "text", "password"
    ] = Field(..., description="Field type")
    label: str = Field(..., description="Display label for the field")
    description: Optional[str] = Field(None, description="Help text for the field")
    default: Optional[Any] = Field(None, description="Default value")
    required: Optional[bool] = Field(False, description="Whether the field is required")
    
    # Type-specific properties
    min: Optional[float] = Field(None, description="Minimum value for number type")
    max: Optional[float] = Field(None, description="Maximum value for number type")
    step: Optional[float] = Field(None, description="Step value for number type")
    placeholder: Optional[str] = Field(None, description="Placeholder text for string type")
    maxLength: Optional[int] = Field(None, description="Maximum length for string/text type")
    pattern: Optional[str] = Field(None, description="Regex pattern for string type")
    options: Optional[List[SelectOption]] = Field(None, description="Options for select/multiselect type")
    item_type: Optional[str] = Field(None, description="Element type for list type")
    item_schema: Optional[Dict[str, Any]] = Field(None, description="Schema for list items")
    fields: Optional[List['ConfigField']] = Field(None, description="Nested fields for object type")
    rows: Optional[int] = Field(None, description="Number of rows for text type")


class ConfigSection(BaseModel):
    """Section grouping in a mod's config schema."""
    
    id: str = Field(..., description="Section identifier")
    title: str = Field(..., description="Section title")
    description: Optional[str] = Field(None, description="Section description")
    fields: List[ConfigField] = Field(default_factory=list, description="Fields in this section")


class ConfigSchema(BaseModel):
    """Configuration schema for a mod."""
    
    sections: List[ConfigSection] = Field(default_factory=list, description="Configuration sections")


class ModInfo(BaseModel):
    """Information about a mod."""
    
    id: str = Field(..., description="Mod identifier")
    name: str = Field(..., description="Mod name")
    displayName: str = Field(..., description="Display name for the mod")
    description: str = Field(..., description="Mod description")
    enabled: bool = Field(..., description="Whether the mod is enabled")
    hasConfig: bool = Field(..., description="Whether the mod has configuration")
    configSchema: Optional[ConfigSchema] = Field(None, description="Configuration schema if available")
    version: Optional[str] = Field(None, description="Mod version")
    currentConfig: Optional[Dict[str, Any]] = Field(None, description="Current configuration values")


class ModConfigUpdateRequest(BaseModel):
    """Request to update a mod's configuration."""
    
    config: Dict[str, Any] = Field(..., description="Configuration values to update")


class SaveConfigResponse(BaseModel):
    """Response after saving a mod's configuration."""
    
    success: bool = Field(..., description="Whether the save was successful")
    requiresRestart: bool = Field(True, description="Whether a network restart is required")
    message: Optional[str] = Field(None, description="Success or error message")
    errors: Optional[Dict[str, str]] = Field(None, description="Validation errors by field key")


class NetworkRestartResponse(BaseModel):
    """Response after requesting a network restart."""
    
    success: bool = Field(..., description="Whether the restart request was successful")
    message: Optional[str] = Field(None, description="Status message")


# Enable forward references for recursive models
ConfigField.model_rebuild()
