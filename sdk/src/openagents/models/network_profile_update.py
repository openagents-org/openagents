"""Network profile validation models for system.update_network_profile event."""

import re
from typing import List, Optional, Any, Dict

from packaging import version as pkg_version
from pydantic import BaseModel, Field, field_validator, HttpUrl

from openagents.models.network_profile import NetworkAuthentication


def normalize_string_list(items: List[str]) -> List[str]:
    """Normalize string list: trim, check uniqueness (case-insensitive), preserve original case."""
    if not items:
        return []
    
    # Trim whitespace
    trimmed = [item.strip() for item in items]
    
    # Check uniqueness (case-insensitive)
    seen = set()
    result = []
    for item in trimmed:
        lower = item.lower()
        if lower not in seen:
            seen.add(lower)
            result.append(item)
    
    return result


def validate_string_list_value(value: Optional[Any]) -> Optional[List[str]]:
    if value is None:
        return value
    if not isinstance(value, (list, tuple)):
        raise TypeError("Value must be a list of strings")
    
    values = list(value)
    for item in values:
        if not isinstance(item, str):
            raise ValueError("All items must be strings")
        item_stripped = item.strip()
        if len(item_stripped) < 1 or len(item_stripped) > 64:
            raise ValueError("Each item must be 1-64 characters (after trim)")
    
    normalized = normalize_string_list(values)
    if len(normalized) != len(values):
        raise ValueError("Items must be unique (case-insensitive)")
    return normalized


class NetworkProfilePatch(BaseModel):
    """Partial network profile update (forbids unknown fields)."""
    
    model_config = {"extra": "forbid"}
    
    discoverable: Optional[bool] = None
    name: Optional[str] = Field(None, min_length=1, max_length=128)
    description: Optional[str] = Field(None, max_length=2048)
    readme: Optional[str] = Field(None, description="Detailed README/instructions for the network. Supports markdown. Used as MCP instructions if external_access.instruction is not set.")
    icon: Optional[HttpUrl] = None
    website: Optional[HttpUrl] = None
    tags: Optional[List[str]] = Field(None, max_length=32)
    categories: Optional[List[str]] = Field(None, max_length=32)
    country: Optional[str] = Field(None, max_length=64)
    required_openagents_version: Optional[str] = None
    capacity: Optional[int] = Field(None, ge=1, le=100000)
    host: Optional[str] = None
    port: Optional[int] = Field(None, ge=1, le=65535)
    
    @field_validator("tags", "categories", mode="before")
    @classmethod
    def validate_string_list(cls, v: Optional[Any]) -> Optional[List[str]]:
        return validate_string_list_value(v)
    
    @field_validator("required_openagents_version")
    @classmethod
    def validate_version(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        try:
            pkg_version.parse(v)
            return v
        except pkg_version.InvalidVersion:
            raise ValueError(f"Invalid semantic version format: {v}")
    
    @field_validator("host")
    @classmethod
    def validate_host(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        
        if not v or not v.strip():
            raise ValueError("Host cannot be empty")
        
        v = v.strip()
        
        # IPv4/IPv6/hostname patterns
        ipv4_pattern = r"^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$"
        ipv6_pattern = r"^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$"
        hostname_pattern = r"^(?:(?:[a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)*(?:[a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9])$"
        
        if not (re.match(ipv4_pattern, v) or re.match(ipv6_pattern, v) or 
                re.match(hostname_pattern, v) or v in ("localhost", "0.0.0.0", "::")):
            raise ValueError(f"Invalid host address: {v}")
        
        return v
class NetworkProfileComplete(BaseModel):
    """Complete network profile for final validation after merge."""
    
    model_config = {"extra": "forbid"}
    
    discoverable: bool
    network_discovery_server: Optional[HttpUrl] = None
    network_id: str = Field(min_length=1, max_length=128)
    management_code: Optional[str] = None
    management_token: Optional[str] = None
    authentication: NetworkAuthentication = Field(
        default_factory=NetworkAuthentication
    )
    name: str = Field(min_length=1, max_length=128)
    description: str = Field(max_length=2048)
    readme: Optional[str] = Field(None, description="Detailed README/instructions for the network. Supports markdown. Used as MCP instructions if external_access.instruction is not set.")
    icon: Optional[HttpUrl] = None
    website: Optional[HttpUrl] = None
    tags: List[str] = Field(default_factory=list, max_length=32)
    categories: List[str] = Field(default_factory=list, max_length=32)
    country: str = Field(max_length=64)
    required_openagents_version: str
    capacity: Optional[int] = Field(None, ge=1, le=100000)
    host: str
    port: int = Field(ge=1, le=65535, default=8700)
    
    @field_validator("tags", "categories", mode="before")
    @classmethod
    def validate_string_list(cls, v: Optional[Any]) -> Optional[List[str]]:
        return validate_string_list_value(v)
    
    @field_validator("required_openagents_version")
    @classmethod
    def validate_version(cls, v: Optional[str]):
        return NetworkProfilePatch.validate_version(v)
    
    @field_validator("host")
    @classmethod
    def validate_host(cls, v: Optional[str]):
        return NetworkProfilePatch.validate_host(v)

