"""
Network Context - Shared context for network components.

This module provides the NetworkContext class which encapsulates all network
information needed by various components (transports, tool collectors, etc.)
without requiring direct access to the AgentNetwork instance.
"""

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, Optional, OrderedDict, TYPE_CHECKING

if TYPE_CHECKING:
    from openagents.core.base_mod import BaseMod
    from openagents.core.workspace_manager import WorkspaceManager
    from openagents.models.network_config import NetworkConfig, NetworkProfile
    from openagents.models.external_access import ExternalAccessConfig
    from openagents.models.event import Event

logger = logging.getLogger(__name__)


@dataclass
class NetworkContext:
    """
    Context object providing shared network information to components.

    This class consolidates all network-related data and callbacks that various
    components need, eliminating the need to pass the full AgentNetwork instance.

    Attributes:
        network_name: Name of the network
        workspace_path: Path to the workspace directory (for tools, events, etc.)
        workspace_manager: Optional workspace manager instance for components that need full access
        config: The network configuration object
        mods: Dictionary of loaded network mods (name -> mod instance)
        emit_event: Async callback for emitting events through the event gateway
    """

    network_name: str = "OpenAgents"
    workspace_path: Optional[str] = None
    workspace_manager: Optional["WorkspaceManager"] = None
    config: Optional["NetworkConfig"] = None
    mods: OrderedDict[str, "BaseMod"] = field(default_factory=OrderedDict)
    emit_event: Optional[Callable[["Event", bool], Awaitable[Any]]] = None

    @property
    def external_access(self) -> Optional["ExternalAccessConfig"]:
        """Get the external_access configuration from network config."""
        if self.config:
            return getattr(self.config, "external_access", None)
        return None

    @property
    def network_profile(self) -> Optional["NetworkProfile"]:
        """Get the network_profile from network config."""
        if self.config:
            return getattr(self.config, "network_profile", None)
        return None

    def get_readme(self) -> Optional[str]:
        """Get network README content.

        Resolution priority:
        1. network_profile.readme (from network profile configuration)
        2. README.md file in workspace directory

        Returns:
            Optional[str]: README content in Markdown format, or None if not available
        """
        # Priority 1: network_profile.readme
        network_profile = self.network_profile
        if network_profile:
            # Handle both dict (from YAML) and NetworkProfile model
            if isinstance(network_profile, dict):
                readme = network_profile.get("readme")
            else:
                readme = getattr(network_profile, "readme", None)
            if readme:
                return readme

        # Priority 2: README.md file in workspace
        if self.workspace_path:
            readme_file = Path(self.workspace_path) / "README.md"
            if readme_file.exists():
                try:
                    return readme_file.read_text(encoding="utf-8")
                except Exception as e:
                    logger.warning(f"Failed to read README.md file: {e}")
                    return None

        # No README available
        return None
