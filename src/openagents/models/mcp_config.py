"""Configuration models for Model Context Protocol (MCP) servers."""

from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field, field_validator


class MCPServerConfig(BaseModel):
    """Configuration for a Model Context Protocol (MCP) server."""

    name: str = Field(..., description="Unique name for this MCP server")
    type: str = Field(..., description="MCP server type (stdio, sse, etc.)")
    command: Optional[List[str]] = Field(
        default=None, description="Command to start MCP server (for stdio type)"
    )
    url: Optional[str] = Field(
        default=None, description="URL for MCP server (for sse type)"
    )
    env: Optional[Dict[str, str]] = Field(
        default=None, description="Environment variables for MCP server"
    )
    api_key_env: Optional[str] = Field(
        default=None, description="Environment variable name for API key"
    )
    config: Optional[Dict[str, Any]] = Field(
        default=None, description="Additional configuration for the MCP server"
    )
    timeout: Optional[int] = Field(
        default=30, description="Connection timeout in seconds"
    )
    retry_attempts: Optional[int] = Field(
        default=3, description="Number of retry attempts on connection failure"
    )

    @field_validator("type")
    @classmethod
    def validate_type(cls, v):
        """Validate MCP server type."""
        allowed_types = ["stdio", "sse", "streamable_http"]
        if v not in allowed_types:
            raise ValueError(f"MCP server type must be one of {allowed_types}, got: {v}")
        return v

    @field_validator("command")
    @classmethod
    def validate_command(cls, v, info):
        """Validate command is required for stdio type."""
        if info.data.get("type") == "stdio" and not v:
            raise ValueError("command is required for stdio MCP servers")
        return v

    @field_validator("url")
    @classmethod
    def validate_url(cls, v, info):
        """Validate URL is required for sse and streamable_http types."""
        server_type = info.data.get("type")
        if server_type in ["sse", "streamable_http"] and not v:
            raise ValueError(f"url is required for {server_type} MCP servers")
        return v