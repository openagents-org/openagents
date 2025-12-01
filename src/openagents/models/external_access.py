"""External access configuration for controlling access by external agents."""

from typing import List, Optional

from pydantic import BaseModel, Field


class ExternalAccessConfig(BaseModel):
    """Configuration for external agent access control.

    This configuration controls what external agents (connecting via MCP)
    can see and access from the network.
    """

    default_agent_group: str = Field(
        default="guest",
        description="Agent group assigned to MCP clients. Defaults to 'guest'.",
    )

    auth_token: Optional[str] = Field(
        default=None,
        description="Bearer token required for MCP access. If set, authentication is required.",
    )

    auth_token_env: Optional[str] = Field(
        default=None,
        description="Environment variable name containing the auth token. Alternative to auth_token.",
    )

    instruction: Optional[str] = Field(
        default=None,
        description="Instructions for external agents. Can be inline text or path to .md/.txt file relative to workspace. Takes priority over network_profile.readme.",
    )

    exposed_tools: Optional[List[str]] = Field(
        default=None,
        description="Whitelist of tool names to expose. If set, only these tools are available to external agents.",
    )

    excluded_tools: Optional[List[str]] = Field(
        default=None,
        description="Blacklist of tool names to exclude. These tools are removed from the exposed set.",
    )
