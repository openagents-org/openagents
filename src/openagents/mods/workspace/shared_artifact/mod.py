"""
Network-level shared artifact mod for OpenAgents.

This mod provides a shared artifact storage system with agent group-based access control.
Artifacts are stored as files in the workspace, supporting both text and binary content.
"""

import logging
import json
import uuid
import time
import base64
from typing import Dict, Any, List, Optional
from pathlib import Path

from openagents.core.base_mod import BaseMod, mod_event_handler
from openagents.models.event import Event
from openagents.models.event_response import EventResponse

logger = logging.getLogger(__name__)


class ArtifactEntry:
    """Represents a single artifact entry with metadata."""

    def __init__(
        self,
        artifact_id: str,
        name: Optional[str],
        file_path: str,
        mime_type: str,
        file_size: int,
        allowed_agent_groups: List[str],
        created_by: str,
        created_at: int,
        updated_at: int,
    ):
        self.artifact_id = artifact_id
        self.name = name
        self.file_path = file_path
        self.mime_type = mime_type
        self.file_size = file_size
        self.allowed_agent_groups = allowed_agent_groups or []
        self.created_by = created_by
        self.created_at = created_at
        self.updated_at = updated_at

    def to_dict(self) -> Dict[str, Any]:
        """Convert artifact entry to dictionary."""
        result = {
            "artifact_id": self.artifact_id,
            "file_path": self.file_path,
            "mime_type": self.mime_type,
            "file_size": self.file_size,
            "allowed_agent_groups": self.allowed_agent_groups,
            "created_by": self.created_by,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }
        if self.name:
            result["name"] = self.name
        return result

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ArtifactEntry":
        """Create artifact entry from dictionary."""
        return cls(
            artifact_id=data["artifact_id"],
            name=data.get("name"),
            file_path=data["file_path"],
            mime_type=data.get("mime_type", "text/plain"),
            file_size=data.get("file_size", 0),
            allowed_agent_groups=data.get("allowed_agent_groups", []),
            created_by=data["created_by"],
            created_at=data["created_at"],
            updated_at=data["updated_at"],
        )


class SharedArtifactMod(BaseMod):
    """Network-level shared artifact mod implementation.

    This mod enables agents to create, read, update, and delete shared artifacts
    with optional agent group-based access control. Artifacts are stored as files
    in the workspace.
    """

    def __init__(self, mod_name: str = "shared_artifact"):
        """Initialize the shared artifact mod."""
        super().__init__(mod_name=mod_name)

        # Artifact metadata storage
        self.artifact_entries: Dict[str, ArtifactEntry] = {}
        self.storage_path: Optional[Path] = None
        self.artifacts_dir: Optional[Path] = None

        logger.info("Initializing Shared Artifact mod")

    def bind_network(self, network):
        """Bind the mod to a network and initialize storage."""
        super().bind_network(network)

        # Set up artifact storage
        self._setup_artifact_storage()

    def _setup_artifact_storage(self):
        """Set up artifact storage using workspace."""
        # Use storage path (workspace or fallback)
        storage_path = self.get_storage_path()
        self.storage_path = storage_path / "shared_artifact"
        self.storage_path.mkdir(exist_ok=True)

        # Create artifacts directory
        self.artifacts_dir = self.storage_path / "artifacts"
        self.artifacts_dir.mkdir(exist_ok=True)

        logger.info(f"Using artifact storage at {self.artifacts_dir}")

        self._load_artifact_entries()

    def _load_artifact_entries(self):
        """Load artifact metadata from storage."""
        try:
            metadata_file = self.artifacts_dir / ".metadata.json"

            if metadata_file.exists():
                with open(metadata_file, "r") as f:
                    data = json.load(f)
                    for artifact_id, entry_data in data.items():
                        self.artifact_entries[artifact_id] = ArtifactEntry.from_dict(entry_data)
                logger.info(f"Loaded {len(self.artifact_entries)} artifact entries from storage")
            else:
                logger.debug("No existing artifact metadata found in storage")
        except Exception as e:
            logger.error(f"Failed to load artifact entries: {e}")
            self.artifact_entries = {}

    def _save_artifact_entries(self):
        """Save artifact metadata to storage."""
        try:
            metadata_file = self.artifacts_dir / ".metadata.json"

            data = {
                artifact_id: entry.to_dict()
                for artifact_id, entry in self.artifact_entries.items()
            }

            with open(metadata_file, "w") as f:
                json.dump(data, f, indent=2)
            logger.info(f"Saved {len(self.artifact_entries)} artifact entries to storage")
        except Exception as e:
            logger.error(f"Failed to save artifact entries: {e}")

    def _read_artifact_file(self, file_path: Path, mime_type: str) -> str:
        """Read artifact file content.

        Args:
            file_path: Path to the artifact file
            mime_type: MIME type of the file

        Returns:
            str: File content (base64 encoded for binary files)
        """
        try:
            # Determine if file is binary based on MIME type
            is_binary = not mime_type.startswith("text/") and mime_type not in [
                "application/json",
                "application/xml",
                "application/javascript",
            ]

            if is_binary:
                # Read binary file and encode as base64
                with open(file_path, "rb") as f:
                    content = base64.b64encode(f.read()).decode("utf-8")
            else:
                # Read text file
                with open(file_path, "r", encoding="utf-8") as f:
                    content = f.read()

            return content
        except Exception as e:
            logger.error(f"Failed to read artifact file {file_path}: {e}")
            raise

    def _write_artifact_file(self, file_path: Path, content: str, mime_type: str):
        """Write artifact file content.

        Args:
            file_path: Path to the artifact file
            content: Content to write (base64 encoded for binary files)
            mime_type: MIME type of the file
        """
        try:
            # Determine if file is binary based on MIME type
            is_binary = not mime_type.startswith("text/") and mime_type not in [
                "application/json",
                "application/xml",
                "application/javascript",
            ]

            if is_binary:
                # Decode base64 and write binary file
                with open(file_path, "wb") as f:
                    f.write(base64.b64decode(content))
            else:
                # Write text file
                with open(file_path, "w", encoding="utf-8") as f:
                    f.write(content)

        except Exception as e:
            logger.error(f"Failed to write artifact file {file_path}: {e}")
            raise

    def initialize(self) -> bool:
        """Initialize the mod.

        Returns:
            bool: True if initialization was successful, False otherwise
        """
        return True

    def shutdown(self) -> bool:
        """Shutdown the mod gracefully.

        Returns:
            bool: True if shutdown was successful, False otherwise
        """
        # Save artifact metadata to storage
        self._save_artifact_entries()

        # Clear all state
        self.artifact_entries.clear()

        return True

    def _check_agent_access(self, agent_id: str, allowed_groups: List[str]) -> bool:
        """Check if an agent has access to an artifact.

        Args:
            agent_id: ID of the agent
            allowed_groups: List of allowed agent groups (empty = all agents)

        Returns:
            bool: True if agent has access, False otherwise
        """
        # Empty allowed_groups means everyone has access
        if not allowed_groups:
            return True

        # Check if agent is in any of the allowed groups
        agent_group = self.network.topology.agent_group_membership.get(agent_id)
        if agent_group in allowed_groups:
            return True

        return False

    async def _send_notification(
        self, event_name: str, artifact_entry: ArtifactEntry, exclude_agent: Optional[str] = None
    ):
        """Send notification to agents with access to the artifact.

        Args:
            event_name: Name of the notification event
            artifact_entry: The artifact entry that was modified
            exclude_agent: Optional agent ID to exclude from notifications
        """
        # Determine which agents should be notified
        notify_agents = set()

        if artifact_entry.allowed_agent_groups:
            # Notify only agents in allowed groups
            for agent_id, group in self.network.topology.agent_group_membership.items():
                if group in artifact_entry.allowed_agent_groups:
                    notify_agents.add(agent_id)
        else:
            # Notify all registered agents
            notify_agents = set(self.network.topology.agent_registry.keys())

        # Exclude the agent who triggered the notification
        if exclude_agent:
            notify_agents.discard(exclude_agent)

        # Send notifications
        for agent_id in notify_agents:
            notification = Event(
                event_name=event_name,
                source_id=self.network.network_id,
                destination_id=agent_id,
                payload={
                    "artifact_id": artifact_entry.artifact_id,
                    "name": artifact_entry.name,
                    "mime_type": artifact_entry.mime_type,
                    "created_by": artifact_entry.created_by,
                    "allowed_agent_groups": artifact_entry.allowed_agent_groups,
                },
            )
            try:
                await self.network.process_event(notification)
                logger.debug(f"Sent {event_name} notification to {agent_id}")
            except Exception as e:
                logger.error(f"Failed to send notification to {agent_id}: {e}")

    @mod_event_handler("shared_artifact.create")
    async def _handle_artifact_create(self, event: Event) -> Optional[EventResponse]:
        """Handle artifact creation request.

        Args:
            event: The artifact creation event

        Returns:
            EventResponse: Response with artifact_id if successful
        """
        try:
            payload = event.payload or {}

            # Validate required fields
            content = payload.get("content")
            if content is None:
                response_data = {"success": False, "error": "content is required"}
            else:
                # Extract optional fields
                name = payload.get("name")
                mime_type = payload.get("mime_type", "text/plain")
                allowed_agent_groups = payload.get("allowed_agent_groups", [])

                # Ensure content is a string
                if not isinstance(content, str):
                    content = str(content)

                # Create artifact entry
                artifact_id = str(uuid.uuid4())
                current_time = int(time.time())

                # Write artifact file
                file_path = self.artifacts_dir / artifact_id
                self._write_artifact_file(file_path, content, mime_type)

                # Get file size
                file_size = file_path.stat().st_size

                artifact_entry = ArtifactEntry(
                    artifact_id=artifact_id,
                    name=name,
                    file_path=str(file_path),
                    mime_type=mime_type,
                    file_size=file_size,
                    allowed_agent_groups=allowed_agent_groups,
                    created_by=event.source_id,
                    created_at=current_time,
                    updated_at=current_time,
                )

                self.artifact_entries[artifact_id] = artifact_entry
                self._save_artifact_entries()

                logger.info(
                    f"Created artifact {artifact_id} by {event.source_id} "
                    f"(groups: {allowed_agent_groups}, name: {name})"
                )

                # Send notification
                await self._send_notification(
                    "shared_artifact.notification.created", artifact_entry, exclude_agent=event.source_id
                )

                response_data = {"success": True, "artifact_id": artifact_id}

            return EventResponse(
                success=response_data.get("success", False),
                message="Artifact created successfully" if response_data.get("success") else response_data.get("error", "Failed"),
                data=response_data,
            )

        except Exception as e:
            logger.error(f"Error creating artifact: {e}")
            return EventResponse(
                success=False,
                message=f"Error creating artifact: {str(e)}",
                data={"error": str(e)},
            )

    @mod_event_handler("shared_artifact.get")
    async def _handle_artifact_get(self, event: Event) -> Optional[EventResponse]:
        """Handle artifact retrieval request.

        Args:
            event: The artifact get event

        Returns:
            EventResponse: Response with artifact entry if successful
        """
        try:
            payload = event.payload or {}

            # Validate required fields
            artifact_id = payload.get("artifact_id")
            if not artifact_id:
                response_data = {"success": False, "error": "artifact_id is required"}
            elif artifact_id not in self.artifact_entries:
                response_data = {"success": False, "error": "Artifact not found"}
            else:
                artifact_entry = self.artifact_entries[artifact_id]

                # Check access permissions
                if not self._check_agent_access(event.source_id, artifact_entry.allowed_agent_groups):
                    logger.warning(
                        f"Agent {event.source_id} denied access to artifact {artifact_id}"
                    )
                    response_data = {
                        "success": False,
                        "error": "Agent does not have permission to access this artifact",
                    }
                else:
                    # Read artifact file content
                    file_path = Path(artifact_entry.file_path)
                    content = self._read_artifact_file(file_path, artifact_entry.mime_type)

                    logger.debug(f"Retrieved artifact {artifact_id} for {event.source_id}")
                    response_data = artifact_entry.to_dict()
                    response_data["content"] = content
                    response_data["success"] = True

            return EventResponse(
                success=response_data.get("success", False),
                message="Artifact retrieved" if response_data.get("success") else response_data.get("error", "Failed"),
                data=response_data,
            )

        except Exception as e:
            logger.error(f"Error retrieving artifact: {e}")
            return EventResponse(
                success=False,
                message=f"Error retrieving artifact: {str(e)}",
                data={"error": str(e)},
            )

    @mod_event_handler("shared_artifact.update")
    async def _handle_artifact_update(self, event: Event) -> Optional[EventResponse]:
        """Handle artifact update request.

        Args:
            event: The artifact update event

        Returns:
            EventResponse: Response indicating success or failure
        """
        try:
            payload = event.payload or {}

            # Validate required fields
            artifact_id = payload.get("artifact_id")
            content = payload.get("content")

            if not artifact_id:
                response_data = {"success": False, "error": "artifact_id is required"}
            elif content is None:
                response_data = {"success": False, "error": "content is required"}
            elif artifact_id not in self.artifact_entries:
                response_data = {"success": False, "error": "Artifact not found"}
            else:
                artifact_entry = self.artifact_entries[artifact_id]

                # Check access permissions
                if not self._check_agent_access(event.source_id, artifact_entry.allowed_agent_groups):
                    logger.warning(
                        f"Agent {event.source_id} denied access to update artifact {artifact_id}"
                    )
                    response_data = {
                        "success": False,
                        "error": "Agent does not have permission to update this artifact",
                    }
                else:
                    # Update artifact file
                    if not isinstance(content, str):
                        content = str(content)

                    file_path = Path(artifact_entry.file_path)
                    self._write_artifact_file(file_path, content, artifact_entry.mime_type)

                    # Update metadata
                    artifact_entry.file_size = file_path.stat().st_size
                    artifact_entry.updated_at = int(time.time())

                    self._save_artifact_entries()

                    logger.info(f"Updated artifact {artifact_id} by {event.source_id}")

                    # Send notification
                    await self._send_notification(
                        "shared_artifact.notification.updated", artifact_entry, exclude_agent=event.source_id
                    )

                    response_data = {"success": True, "artifact_id": artifact_id}

            return EventResponse(
                success=response_data.get("success", False),
                message="Artifact updated successfully" if response_data.get("success") else response_data.get("error", "Failed"),
                data=response_data,
            )

        except Exception as e:
            logger.error(f"Error updating artifact: {e}")
            return EventResponse(
                success=False,
                message=f"Error updating artifact: {str(e)}",
                data={"error": str(e)},
            )

    @mod_event_handler("shared_artifact.delete")
    async def _handle_artifact_delete(self, event: Event) -> Optional[EventResponse]:
        """Handle artifact deletion request.

        Args:
            event: The artifact delete event

        Returns:
            EventResponse: Response indicating success or failure
        """
        try:
            payload = event.payload or {}

            # Validate required fields
            artifact_id = payload.get("artifact_id")

            if not artifact_id:
                response_data = {"success": False, "error": "artifact_id is required"}
            elif artifact_id not in self.artifact_entries:
                response_data = {"success": False, "error": "Artifact not found"}
            else:
                artifact_entry = self.artifact_entries[artifact_id]

                # Check access permissions
                if not self._check_agent_access(event.source_id, artifact_entry.allowed_agent_groups):
                    logger.warning(
                        f"Agent {event.source_id} denied access to delete artifact {artifact_id}"
                    )
                    response_data = {
                        "success": False,
                        "error": "Agent does not have permission to delete this artifact",
                    }
                else:
                    # Delete artifact file
                    file_path = Path(artifact_entry.file_path)
                    if file_path.exists():
                        file_path.unlink()

                    # Delete metadata entry
                    del self.artifact_entries[artifact_id]
                    self._save_artifact_entries()

                    logger.info(f"Deleted artifact {artifact_id} by {event.source_id}")

                    # Send notification
                    await self._send_notification(
                        "shared_artifact.notification.deleted", artifact_entry, exclude_agent=event.source_id
                    )

                    response_data = {"success": True, "artifact_id": artifact_id}

            return EventResponse(
                success=response_data.get("success", False),
                message="Artifact deleted successfully" if response_data.get("success") else response_data.get("error", "Failed"),
                data=response_data,
            )

        except Exception as e:
            logger.error(f"Error deleting artifact: {e}")
            return EventResponse(
                success=False,
                message=f"Error deleting artifact: {str(e)}",
                data={"error": str(e)},
            )

    @mod_event_handler("shared_artifact.list")
    async def _handle_artifact_list(self, event: Event) -> Optional[EventResponse]:
        """Handle artifact list request.

        Args:
            event: The artifact list event

        Returns:
            EventResponse: Response with list of artifacts if successful
        """
        try:
            payload = event.payload or {}

            # Optional filter
            mime_type_filter = payload.get("mime_type")

            # Build list of accessible artifacts
            artifacts = []
            for artifact_id, artifact_entry in self.artifact_entries.items():
                # Check access permissions
                if not self._check_agent_access(event.source_id, artifact_entry.allowed_agent_groups):
                    continue

                # Apply MIME type filter if specified
                if mime_type_filter and artifact_entry.mime_type != mime_type_filter:
                    continue

                # Add artifact to list (without content)
                artifact_dict = artifact_entry.to_dict()
                artifacts.append(artifact_dict)

            logger.debug(f"Listed {len(artifacts)} artifacts for {event.source_id}")

            response_data = {
                "success": True,
                "artifacts": artifacts,
            }

            return EventResponse(
                success=True,
                message=f"Found {len(artifacts)} artifacts",
                data=response_data,
            )

        except Exception as e:
            logger.error(f"Error listing artifacts: {e}")
            return EventResponse(
                success=False,
                message=f"Error listing artifacts: {str(e)}",
                data={"error": str(e)},
            )

    def get_state(self) -> Dict[str, Any]:
        """Get the current state of the shared artifact mod.

        Returns:
            Dict[str, Any]: Current mod state
        """
        return {
            "artifact_count": len(self.artifact_entries),
            "storage_path": str(self.storage_path) if self.storage_path else None,
            "artifacts_dir": str(self.artifacts_dir) if self.artifacts_dir else None,
        }
