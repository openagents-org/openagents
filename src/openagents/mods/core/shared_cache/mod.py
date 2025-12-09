"""
Network-level shared cache mod for OpenAgents.

This mod provides a shared caching system with agent group-based access control.
Supports both string values and binary file storage.
"""

import logging
import json
import uuid
import time
import base64
import os
from typing import Dict, Any, List, Optional, Set
from pathlib import Path

from openagents.core.base_mod import BaseMod, mod_event_handler
from openagents.models.event import Event
from openagents.models.event_response import EventResponse

logger = logging.getLogger(__name__)

# Maximum file size (50 MB)
MAX_FILE_SIZE = 50 * 1024 * 1024


class CacheEntry:
    """Represents a single cache entry (string value or file reference)."""

    def __init__(
        self,
        cache_id: str,
        value: str,
        mime_type: str,
        allowed_agent_groups: List[str],
        created_by: str,
        created_at: int,
        updated_at: int,
        is_file: bool = False,
        filename: Optional[str] = None,
        file_size: Optional[int] = None,
    ):
        self.cache_id = cache_id
        self.value = value  # For files, this is the relative path to the file
        self.mime_type = mime_type
        self.allowed_agent_groups = allowed_agent_groups or []
        self.created_by = created_by
        self.created_at = created_at
        self.updated_at = updated_at
        self.is_file = is_file
        self.filename = filename  # Original filename for file entries
        self.file_size = file_size  # File size in bytes

    def to_dict(self) -> Dict[str, Any]:
        """Convert cache entry to dictionary."""
        data = {
            "cache_id": self.cache_id,
            "value": self.value,
            "mime_type": self.mime_type,
            "allowed_agent_groups": self.allowed_agent_groups,
            "created_by": self.created_by,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "is_file": self.is_file,
        }
        if self.is_file:
            data["filename"] = self.filename
            data["file_size"] = self.file_size
        return data

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "CacheEntry":
        """Create cache entry from dictionary."""
        return cls(
            cache_id=data["cache_id"],
            value=data["value"],
            mime_type=data.get("mime_type", "text/plain"),
            allowed_agent_groups=data.get("allowed_agent_groups", []),
            created_by=data["created_by"],
            created_at=data["created_at"],
            updated_at=data["updated_at"],
            is_file=data.get("is_file", False),
            filename=data.get("filename"),
            file_size=data.get("file_size"),
        )


class SharedCacheMod(BaseMod):
    """Network-level shared cache mod implementation.

    This mod enables agents to create, read, update, and delete shared cache entries
    with optional agent group-based access control.
    """

    def __init__(self, mod_name: str = "shared_cache"):
        """Initialize the shared cache mod."""
        super().__init__(mod_name=mod_name)

        # Cache storage
        self.cache_entries: Dict[str, CacheEntry] = {}
        self.storage_path: Optional[Path] = None
        self.files_path: Optional[Path] = None

        logger.info("Initializing Shared Cache mod")

    def bind_network(self, network):
        """Bind the mod to a network and initialize storage."""
        super().bind_network(network)

        # Set up cache storage
        self._setup_cache_storage()

    def _setup_cache_storage(self):
        """Set up cache storage using workspace."""
        # Use storage path (workspace or fallback)
        storage_path = self.get_storage_path()
        self.storage_path = storage_path / "shared_cache"
        self.storage_path.mkdir(exist_ok=True)

        # Create files directory for binary storage
        self.files_path = self.storage_path / "files"
        self.files_path.mkdir(exist_ok=True)

        logger.info(f"Using cache storage at {self.storage_path}")
        logger.info(f"Using files storage at {self.files_path}")

        self._load_cache_entries()

    def _load_cache_entries(self):
        """Load cache entries from storage."""
        try:
            cache_file = self.storage_path / "cache_data.json"

            if cache_file.exists():
                with open(cache_file, "r") as f:
                    data = json.load(f)
                    for cache_id, entry_data in data.items():
                        self.cache_entries[cache_id] = CacheEntry.from_dict(entry_data)
                logger.info(f"Loaded {len(self.cache_entries)} cache entries from storage")
            else:
                logger.debug("No existing cache data found in storage")
        except Exception as e:
            logger.error(f"Failed to load cache entries: {e}")
            self.cache_entries = {}

    def _save_cache_entries(self):
        """Save cache entries to storage."""
        try:
            cache_file = self.storage_path / "cache_data.json"

            data = {
                cache_id: entry.to_dict()
                for cache_id, entry in self.cache_entries.items()
            }

            with open(cache_file, "w") as f:
                json.dump(data, f, indent=2)
            logger.info(f"Saved {len(self.cache_entries)} cache entries to storage")
        except Exception as e:
            logger.error(f"Failed to save cache entries: {e}")

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
        # Save cache entries to storage
        self._save_cache_entries()

        # Clear all state
        self.cache_entries.clear()

        return True

    def _check_agent_access(self, agent_id: str, allowed_groups: List[str]) -> bool:
        """Check if an agent has access to a cache entry.

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
        self, event_name: str, cache_entry: CacheEntry, exclude_agent: Optional[str] = None
    ):
        """Send notification to agents with access to the cache entry.

        Args:
            event_name: Name of the notification event
            cache_entry: The cache entry that was modified
            exclude_agent: Optional agent ID to exclude from notifications
        """
        # Determine which agents should be notified
        notify_agents = set()

        if cache_entry.allowed_agent_groups:
            # Notify only agents in allowed groups
            for agent_id, group in self.network.topology.agent_group_membership.items():
                if group in cache_entry.allowed_agent_groups:
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
                    "cache_id": cache_entry.cache_id,
                    "mime_type": cache_entry.mime_type,
                    "created_by": cache_entry.created_by,
                    "allowed_agent_groups": cache_entry.allowed_agent_groups,
                },
            )
            try:
                await self.network.process_event(notification)
                logger.debug(f"Sent {event_name} notification to {agent_id}")
            except Exception as e:
                logger.error(f"Failed to send notification to {agent_id}: {e}")

    @mod_event_handler("shared_cache.create")
    async def _handle_cache_create(self, event: Event) -> Optional[EventResponse]:
        """Handle cache creation request.

        Args:
            event: The cache creation event

        Returns:
            EventResponse: Response with cache_id if successful
        """
        try:
            payload = event.payload or {}

            # Validate required fields
            value = payload.get("value")
            if value is None:
                response_data = {"success": False, "error": "value is required"}
            else:
                # Extract optional fields
                mime_type = payload.get("mime_type", "text/plain")
                allowed_agent_groups = payload.get("allowed_agent_groups", [])

                # Ensure value is a string
                if not isinstance(value, str):
                    value = str(value)

                # Create cache entry
                cache_id = str(uuid.uuid4())
                current_time = int(time.time())

                cache_entry = CacheEntry(
                    cache_id=cache_id,
                    value=value,
                    mime_type=mime_type,
                    allowed_agent_groups=allowed_agent_groups,
                    created_by=event.source_id,
                    created_at=current_time,
                    updated_at=current_time,
                )

                self.cache_entries[cache_id] = cache_entry
                self._save_cache_entries()

                logger.info(
                    f"Created cache entry {cache_id} by {event.source_id} "
                    f"(groups: {allowed_agent_groups})"
                )

                # Send notification
                await self._send_notification(
                    "shared_cache.notification.created", cache_entry, exclude_agent=event.source_id
                )

                response_data = {"success": True, "cache_id": cache_id}

            return EventResponse(
                success=response_data.get("success", False),
                message="Cache entry created successfully" if response_data.get("success") else response_data.get("error", "Failed"),
                data=response_data,
            )

        except Exception as e:
            logger.error(f"Error creating cache entry: {e}")
            return EventResponse(
                success=False,
                message=f"Error creating cache entry: {str(e)}",
                data={"error": str(e)},
            )

    @mod_event_handler("shared_cache.get")
    async def _handle_cache_get(self, event: Event) -> Optional[EventResponse]:
        """Handle cache retrieval request.

        Args:
            event: The cache get event

        Returns:
            EventResponse: Response with cache entry if successful
        """
        try:
            payload = event.payload or {}

            # Validate required fields
            cache_id = payload.get("cache_id")
            if not cache_id:
                response_data = {"success": False, "error": "cache_id is required"}
            elif cache_id not in self.cache_entries:
                response_data = {"success": False, "error": "Cache entry not found"}
            else:
                cache_entry = self.cache_entries[cache_id]

                # Check access permissions
                if not self._check_agent_access(event.source_id, cache_entry.allowed_agent_groups):
                    logger.warning(
                        f"Agent {event.source_id} denied access to cache entry {cache_id}"
                    )
                    response_data = {
                        "success": False,
                        "error": "Agent does not have permission to access this cache entry",
                    }
                else:
                    logger.debug(f"Retrieved cache entry {cache_id} for {event.source_id}")
                    response_data = cache_entry.to_dict()
                    response_data["success"] = True

            return EventResponse(
                success=response_data.get("success", False),
                message="Cache entry retrieved" if response_data.get("success") else response_data.get("error", "Failed"),
                data=response_data,
            )

        except Exception as e:
            logger.error(f"Error retrieving cache entry: {e}")
            return EventResponse(
                success=False,
                message=f"Error retrieving cache entry: {str(e)}",
                data={"error": str(e)},
            )

    @mod_event_handler("shared_cache.update")
    async def _handle_cache_update(self, event: Event) -> Optional[EventResponse]:
        """Handle cache update request.

        Args:
            event: The cache update event

        Returns:
            EventResponse: Response indicating success or failure
        """
        try:
            payload = event.payload or {}

            # Validate required fields
            cache_id = payload.get("cache_id")
            value = payload.get("value")

            if not cache_id:
                response_data = {"success": False, "error": "cache_id is required"}
            elif value is None:
                response_data = {"success": False, "error": "value is required"}
            elif cache_id not in self.cache_entries:
                response_data = {"success": False, "error": "Cache entry not found"}
            else:
                cache_entry = self.cache_entries[cache_id]

                # Check access permissions
                if not self._check_agent_access(event.source_id, cache_entry.allowed_agent_groups):
                    logger.warning(
                        f"Agent {event.source_id} denied access to update cache entry {cache_id}"
                    )
                    response_data = {
                        "success": False,
                        "error": "Agent does not have permission to update this cache entry",
                    }
                else:
                    # Update cache entry
                    if not isinstance(value, str):
                        value = str(value)

                    cache_entry.value = value
                    cache_entry.updated_at = int(time.time())

                    self._save_cache_entries()

                    logger.info(f"Updated cache entry {cache_id} by {event.source_id}")

                    # Send notification
                    await self._send_notification(
                        "shared_cache.notification.updated", cache_entry, exclude_agent=event.source_id
                    )

                    response_data = {"success": True, "cache_id": cache_id}

            return EventResponse(
                success=response_data.get("success", False),
                message="Cache entry updated successfully" if response_data.get("success") else response_data.get("error", "Failed"),
                data=response_data,
            )

        except Exception as e:
            logger.error(f"Error updating cache entry: {e}")
            return EventResponse(
                success=False,
                message=f"Error updating cache entry: {str(e)}",
                data={"error": str(e)},
            )

    @mod_event_handler("shared_cache.delete")
    async def _handle_cache_delete(self, event: Event) -> Optional[EventResponse]:
        """Handle cache deletion request.

        Args:
            event: The cache delete event

        Returns:
            EventResponse: Response indicating success or failure
        """
        try:
            payload = event.payload or {}

            # Validate required fields
            cache_id = payload.get("cache_id")

            if not cache_id:
                response_data = {"success": False, "error": "cache_id is required"}
            elif cache_id not in self.cache_entries:
                response_data = {"success": False, "error": "Cache entry not found"}
            else:
                cache_entry = self.cache_entries[cache_id]

                # Check access permissions
                if not self._check_agent_access(event.source_id, cache_entry.allowed_agent_groups):
                    logger.warning(
                        f"Agent {event.source_id} denied access to delete cache entry {cache_id}"
                    )
                    response_data = {
                        "success": False,
                        "error": "Agent does not have permission to delete this cache entry",
                    }
                else:
                    # Delete cache entry
                    del self.cache_entries[cache_id]
                    self._save_cache_entries()

                    logger.info(f"Deleted cache entry {cache_id} by {event.source_id}")

                    # Send notification
                    await self._send_notification(
                        "shared_cache.notification.deleted", cache_entry, exclude_agent=event.source_id
                    )

                    response_data = {"success": True, "cache_id": cache_id}

            return EventResponse(
                success=response_data.get("success", False),
                message="Cache entry deleted successfully" if response_data.get("success") else response_data.get("error", "Failed"),
                data=response_data,
            )

        except Exception as e:
            logger.error(f"Error deleting cache entry: {e}")
            return EventResponse(
                success=False,
                message=f"Error deleting cache entry: {str(e)}",
                data={"error": str(e)},
            )

    @mod_event_handler("shared_cache.file.upload")
    async def _handle_file_upload(self, event: Event) -> Optional[EventResponse]:
        """Handle file upload request.

        Args:
            event: The file upload event containing base64-encoded file data

        Returns:
            EventResponse: Response with cache_id if successful
        """
        try:
            payload = event.payload or {}

            # Validate required fields
            file_data = payload.get("file_data")  # Base64-encoded file content
            filename = payload.get("filename")
            mime_type = payload.get("mime_type", "application/octet-stream")
            allowed_agent_groups = payload.get("allowed_agent_groups", [])

            if not file_data:
                return EventResponse(
                    success=False,
                    message="file_data is required",
                    data={"success": False, "error": "file_data is required"},
                )

            if not filename:
                return EventResponse(
                    success=False,
                    message="filename is required",
                    data={"success": False, "error": "filename is required"},
                )

            # Decode base64 data with strict validation
            try:
                file_bytes = base64.b64decode(file_data, validate=True)
            except Exception as decode_error:
                logger.error(f"Failed to decode base64 file data: {decode_error}")
                return EventResponse(
                    success=False,
                    message="Invalid base64 file data",
                    data={"success": False, "error": "Invalid base64 file data"},
                )

            # Check file size
            file_size = len(file_bytes)
            if file_size > MAX_FILE_SIZE:
                return EventResponse(
                    success=False,
                    message=f"File size exceeds maximum allowed ({MAX_FILE_SIZE} bytes)",
                    data={"success": False, "error": f"File size exceeds maximum allowed ({MAX_FILE_SIZE} bytes)"},
                )

            # Generate cache ID and file path
            cache_id = str(uuid.uuid4())
            # Sanitize filename to prevent path traversal
            safe_filename = os.path.basename(filename)
            file_path = self.files_path / f"{cache_id}_{safe_filename}"

            # Write file to storage
            with open(file_path, "wb") as f:
                f.write(file_bytes)

            # Create cache entry
            current_time = int(time.time())
            cache_entry = CacheEntry(
                cache_id=cache_id,
                value=str(file_path.relative_to(self.storage_path)),  # Store relative path
                mime_type=mime_type,
                allowed_agent_groups=allowed_agent_groups,
                created_by=event.source_id,
                created_at=current_time,
                updated_at=current_time,
                is_file=True,
                filename=safe_filename,
                file_size=file_size,
            )

            self.cache_entries[cache_id] = cache_entry
            self._save_cache_entries()

            logger.info(
                f"Uploaded file {safe_filename} ({file_size} bytes) as cache {cache_id} "
                f"by {event.source_id} (groups: {allowed_agent_groups})"
            )

            # Send notification
            await self._send_notification(
                "shared_cache.notification.created", cache_entry, exclude_agent=event.source_id
            )

            return EventResponse(
                success=True,
                message="File uploaded successfully",
                data={
                    "success": True,
                    "cache_id": cache_id,
                    "filename": safe_filename,
                    "file_size": file_size,
                    "mime_type": mime_type,
                },
            )

        except Exception as e:
            logger.error(f"Error uploading file: {e}")
            return EventResponse(
                success=False,
                message=f"Error uploading file: {str(e)}",
                data={"success": False, "error": str(e)},
            )

    @mod_event_handler("shared_cache.file.download")
    async def _handle_file_download(self, event: Event) -> Optional[EventResponse]:
        """Handle file download request.

        Args:
            event: The file download event

        Returns:
            EventResponse: Response with base64-encoded file data if successful
        """
        try:
            payload = event.payload or {}

            # Validate required fields
            cache_id = payload.get("cache_id")

            if not cache_id:
                return EventResponse(
                    success=False,
                    message="cache_id is required",
                    data={"success": False, "error": "cache_id is required"},
                )

            if cache_id not in self.cache_entries:
                return EventResponse(
                    success=False,
                    message="Cache entry not found",
                    data={"success": False, "error": "Cache entry not found"},
                )

            cache_entry = self.cache_entries[cache_id]

            # Check if it's a file entry
            if not cache_entry.is_file:
                return EventResponse(
                    success=False,
                    message="Cache entry is not a file",
                    data={"success": False, "error": "Cache entry is not a file"},
                )

            # Check access permissions
            if not self._check_agent_access(event.source_id, cache_entry.allowed_agent_groups):
                logger.warning(
                    f"Agent {event.source_id} denied access to download file {cache_id}"
                )
                return EventResponse(
                    success=False,
                    message="Agent does not have permission to access this file",
                    data={"success": False, "error": "Agent does not have permission to access this file"},
                )

            # Read file
            file_path = self.storage_path / cache_entry.value
            if not file_path.exists():
                logger.error(f"File not found at {file_path}")
                return EventResponse(
                    success=False,
                    message="File not found on disk",
                    data={"success": False, "error": "File not found on disk"},
                )

            with open(file_path, "rb") as f:
                file_bytes = f.read()

            # Encode to base64
            file_data = base64.b64encode(file_bytes).decode("utf-8")

            logger.debug(f"Downloaded file {cache_id} for {event.source_id}")

            return EventResponse(
                success=True,
                message="File downloaded successfully",
                data={
                    "success": True,
                    "cache_id": cache_id,
                    "filename": cache_entry.filename,
                    "file_size": cache_entry.file_size,
                    "mime_type": cache_entry.mime_type,
                    "file_data": file_data,
                },
            )

        except Exception as e:
            logger.error(f"Error downloading file: {e}")
            return EventResponse(
                success=False,
                message=f"Error downloading file: {str(e)}",
                data={"success": False, "error": str(e)},
            )

    def get_file_path(self, cache_id: str) -> Optional[Path]:
        """Get the file path for a cache entry (for HTTP direct download).

        Args:
            cache_id: ID of the cache entry

        Returns:
            Optional[Path]: File path if exists and is a file entry, None otherwise
        """
        if cache_id not in self.cache_entries:
            return None

        cache_entry = self.cache_entries[cache_id]
        if not cache_entry.is_file:
            return None

        file_path = self.storage_path / cache_entry.value
        if not file_path.exists():
            return None

        return file_path

    def get_cache_entry(self, cache_id: str) -> Optional[CacheEntry]:
        """Get a cache entry by ID.

        Args:
            cache_id: ID of the cache entry

        Returns:
            Optional[CacheEntry]: Cache entry if found, None otherwise
        """
        return self.cache_entries.get(cache_id)

    def get_state(self) -> Dict[str, Any]:
        """Get the current state of the shared cache mod.

        Returns:
            Dict[str, Any]: Current mod state
        """
        return {
            "cache_count": len(self.cache_entries),
            "storage_path": str(self.storage_path) if self.storage_path else None,
        }
