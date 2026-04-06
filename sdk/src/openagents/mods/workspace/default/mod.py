"""
Network-level default workspace mod for OpenAgents.

This mod provides basic workspace functionality at the network level
and coordinates with thread messaging for communication capabilities.
"""

import logging
import json
from typing import Dict, Any, List, Optional, Set
from datetime import datetime
from pathlib import Path

from openagents.core.base_mod import BaseMod
from openagents.models.messages import Event, EventNames
from openagents.models.event import Event

logger = logging.getLogger(__name__)


class DefaultWorkspaceNetworkMod(BaseMod):
    """
    Network-level mod for default workspace functionality.

    This mod manages workspace state at the network level and integrates
    with thread messaging for agent communication within workspaces.
    """

    def __init__(self, mod_name: str = "openagents.mods.workspace.default"):
        """Initialize the default workspace network mod."""
        super().__init__(mod_name)
        self.workspaces: Dict[str, Dict[str, Any]] = {}
        self.agent_workspaces: Dict[str, str] = {}  # agent_id -> workspace_id

    def get_supported_message_types(self) -> List[str]:
        """
        Get list of supported message types.

        Returns:
            List of supported message types (empty for now)
        """
        # No specific message types for now
        return []

    def bind_network(self, network):
        """Bind the mod to a network and load persistent data."""
        super().bind_network(network)

        # Load persistent data if using workspace
        if self.workspace_manager:
            self._load_workspace_data()

    def _load_workspace_data(self):
        """Load workspace data from persistent storage."""
        if not self.workspace_manager:
            return

        try:
            storage_path = self.get_storage_path()

            # Load workspaces data
            workspaces_file = storage_path / "workspaces.json"
            if workspaces_file.exists():
                with open(workspaces_file, "r") as f:
                    self.workspaces = json.load(f)
                logger.info(f"Loaded {len(self.workspaces)} workspaces from storage")

            # Load agent workspace mappings
            agent_mappings_file = storage_path / "agent_workspaces.json"
            if agent_mappings_file.exists():
                with open(agent_mappings_file, "r") as f:
                    self.agent_workspaces = json.load(f)
                logger.info(
                    f"Loaded {len(self.agent_workspaces)} agent workspace mappings from storage"
                )

        except Exception as e:
            logger.error(f"Failed to load workspace data: {e}")
            self.workspaces = {}
            self.agent_workspaces = {}

    def _save_workspace_data(self):
        """Save workspace data to persistent storage."""
        if not self.workspace_manager:
            return

        try:
            storage_path = self.get_storage_path()

            # Save workspaces data
            workspaces_file = storage_path / "workspaces.json"
            with open(workspaces_file, "w") as f:
                json.dump(self.workspaces, f, indent=2, default=str)

            # Save agent workspace mappings
            agent_mappings_file = storage_path / "agent_workspaces.json"
            with open(agent_mappings_file, "w") as f:
                json.dump(self.agent_workspaces, f, indent=2)

            logger.info(
                f"Saved workspace data: {len(self.workspaces)} workspaces, {len(self.agent_workspaces)} agent mappings"
            )

        except Exception as e:
            logger.error(f"Failed to save workspace data: {e}")

    def create_workspace(
        self, workspace_id: str, workspace_data: Dict[str, Any]
    ) -> bool:
        """Create a new workspace with persistent storage.

        Args:
            workspace_id: Unique identifier for the workspace
            workspace_data: Workspace configuration and metadata

        Returns:
            bool: True if workspace created successfully
        """
        if workspace_id in self.workspaces:
            logger.warning(f"Workspace {workspace_id} already exists")
            return False

        # Add creation timestamp
        workspace_data["created_at"] = datetime.now().isoformat()
        workspace_data["updated_at"] = workspace_data["created_at"]

        self.workspaces[workspace_id] = workspace_data

        # Persist to storage
        if self.workspace_manager:
            self._save_workspace_data()

        logger.info(f"Created workspace: {workspace_id}")
        return True

    def update_workspace(self, workspace_id: str, updates: Dict[str, Any]) -> bool:
        """Update an existing workspace.

        Args:
            workspace_id: Workspace identifier
            updates: Updates to apply to the workspace

        Returns:
            bool: True if workspace updated successfully
        """
        if workspace_id not in self.workspaces:
            logger.warning(f"Workspace {workspace_id} not found")
            return False

        # Apply updates
        self.workspaces[workspace_id].update(updates)
        self.workspaces[workspace_id]["updated_at"] = datetime.now().isoformat()

        # Persist to storage
        if self.workspace_manager:
            self._save_workspace_data()

        logger.info(f"Updated workspace: {workspace_id}")
        return True

    def assign_agent_to_workspace(self, agent_id: str, workspace_id: str) -> bool:
        """Assign an agent to a workspace.

        Args:
            agent_id: Agent identifier
            workspace_id: Workspace identifier

        Returns:
            bool: True if assignment successful
        """
        if workspace_id not in self.workspaces:
            logger.warning(
                f"Cannot assign agent {agent_id} to non-existent workspace {workspace_id}"
            )
            return False

        self.agent_workspaces[agent_id] = workspace_id

        # Update workspace member count
        if "members" not in self.workspaces[workspace_id]:
            self.workspaces[workspace_id]["members"] = []

        if agent_id not in self.workspaces[workspace_id]["members"]:
            self.workspaces[workspace_id]["members"].append(agent_id)
            self.workspaces[workspace_id]["updated_at"] = datetime.now().isoformat()

        # Persist to storage
        if self.workspace_manager:
            self._save_workspace_data()

        logger.info(f"Assigned agent {agent_id} to workspace {workspace_id}")
        return True

    def get_agent_workspace(self, agent_id: str) -> Optional[str]:
        """Get the workspace assigned to an agent.

        Args:
            agent_id: Agent identifier

        Returns:
            Optional[str]: Workspace ID or None if not assigned
        """
        return self.agent_workspaces.get(agent_id)

    def get_workspace_info(self, workspace_id: str) -> Optional[Dict[str, Any]]:
        """Get information about a workspace.

        Args:
            workspace_id: Workspace identifier

        Returns:
            Optional[Dict]: Workspace information or None if not found
        """
        return self.workspaces.get(workspace_id)

    def list_workspaces(self) -> Dict[str, Dict[str, Any]]:
        """List all workspaces.

        Returns:
            Dict: All workspaces data
        """
        return self.workspaces.copy()

    def cleanup(self):
        """Clean up network mod resources."""
        logger.info("Cleaning up default workspace network mod")

        # Save data before cleanup
        if self.workspace_manager:
            self._save_workspace_data()

        self.workspaces.clear()
        self.agent_workspaces.clear()
        super().cleanup()
