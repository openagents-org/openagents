"""Publishing configuration models for OpenAgents.

This module defines the data models for network publishing configuration,
including publishing settings, statistics, and status information.
"""

from typing import Optional, Dict, Any
from datetime import datetime
from pydantic import BaseModel, Field
import os


class PublishingConfig(BaseModel):
    """Configuration for network publishing to discovery registry."""

    api_key: Optional[str] = Field(
        default=None,
        description="API key for publishing (can use 'env:' prefix for environment variables)",
    )

    auto_heartbeat: bool = Field(
        default=True,
        description="Whether to automatically send heartbeats to keep network online",
    )

    heartbeat_interval_minutes: int = Field(
        default=5,
        ge=1,
        le=60,
        description="Interval in minutes between automatic heartbeats",
    )

    discovery_server: str = Field(
        default="https://endpoint.openagents.org/v1",
        description="URL of the discovery server",
    )

    def get_api_key(self) -> Optional[str]:
        """Get the API key, resolving environment variables if needed.
        
        Returns:
            The resolved API key or None if not set or environment variable not found.
        """
        if not self.api_key:
            return None
            
        if self.api_key.startswith("env:"):
            env_var = self.api_key[4:]  # Remove 'env:' prefix
            return os.environ.get(env_var)
        
        return self.api_key


class NetworkStats(BaseModel):
    """Statistics for a published network."""

    views: int = Field(default=0, description="Total number of views")
    likes: int = Field(default=0, description="Total number of likes")
    online_agents: int = Field(default=0, description="Number of currently online agents")
    last_heartbeat: Optional[datetime] = Field(
        default=None, description="Timestamp of last heartbeat"
    )


class PublishingStatus(BaseModel):
    """Status of network publishing."""

    is_published: bool = Field(default=False, description="Whether network is published")
    network_id: Optional[str] = Field(default=None, description="Network ID in registry")
    status: str = Field(default="offline", description="Network status (online/offline)")
    last_heartbeat: Optional[datetime] = Field(
        default=None, description="Last heartbeat timestamp"
    )
    next_heartbeat: Optional[datetime] = Field(
        default=None, description="Next scheduled heartbeat"
    )
    stats: Optional[NetworkStats] = Field(default=None, description="Network statistics")
    discovery_url: Optional[str] = Field(
        default=None, description="Full discovery URL for the network"
    )
    api_key_configured: bool = Field(
        default=False, description="Whether API key is configured"
    )
    auto_heartbeat_enabled: bool = Field(
        default=False, description="Whether auto-heartbeat is enabled"
    )


class PublishingError(Exception):
    """Exception raised when publishing operations fail."""

    pass
