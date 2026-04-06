"""
Agent-level shared cache adapter for OpenAgents.

This adapter provides tools for agents to interact with the shared cache system.
Supports both string values and binary file storage.
"""

import logging
import base64
from typing import Dict, Any, List, Optional
from pathlib import Path

from openagents.core.base_mod_adapter import BaseModAdapter
from openagents.models.event import Event, EventVisibility
from openagents.models.tool import AgentTool

logger = logging.getLogger(__name__)

# Maximum file size (50 MB)
MAX_FILE_SIZE = 50 * 1024 * 1024


class SharedCacheAdapter(BaseModAdapter):
    """Agent-level shared cache adapter implementation.

    This adapter provides tools for agents to create, read, update, and delete
    shared cache entries.
    """

    def __init__(self):
        """Initialize the shared cache adapter for an agent."""
        super().__init__(mod_name="shared_cache")

        # Track pending requests
        self.pending_requests: Dict[str, Dict[str, Any]] = {}
        self.completed_requests: Dict[str, Dict[str, Any]] = {}

        logger.info(f"Initializing Shared Cache adapter for agent")

    def initialize(self) -> bool:
        """Initialize the adapter.

        Returns:
            bool: True if initialization was successful, False otherwise
        """
        logger.info(f"Shared Cache adapter initialized for agent {self.agent_id}")
        return True

    def shutdown(self) -> bool:
        """Shutdown the adapter.

        Returns:
            bool: True if shutdown was successful, False otherwise
        """
        # Clear all state
        self.pending_requests.clear()
        self.completed_requests.clear()

        return True

    async def process_incoming_mod_message(self, message: Event) -> None:
        """Process an incoming mod message.

        Args:
            message: The mod message to process
        """
        logger.debug(f"Received mod message from {message.source_id}")

        # Handle different event types based on event name
        event_name = message.event_name

        if event_name == "shared_cache.create.response":
            await self._handle_cache_create_response(message)
        elif event_name == "shared_cache.get.response":
            await self._handle_cache_get_response(message)
        elif event_name == "shared_cache.update.response":
            await self._handle_cache_update_response(message)
        elif event_name == "shared_cache.delete.response":
            await self._handle_cache_delete_response(message)
        elif event_name == "shared_cache.file.upload.response":
            await self._handle_file_upload_response(message)
        elif event_name == "shared_cache.file.download.response":
            await self._handle_file_download_response(message)
        elif event_name == "shared_cache.notification.created":
            await self._handle_cache_created_notification(message)
        elif event_name == "shared_cache.notification.updated":
            await self._handle_cache_updated_notification(message)
        elif event_name == "shared_cache.notification.deleted":
            await self._handle_cache_deleted_notification(message)
        else:
            logger.debug(f"Unhandled shared cache event: {event_name}")

    async def create_cache(
        self,
        value: str,
        mime_type: str = "text/plain",
        allowed_agent_groups: Optional[List[str]] = None,
    ) -> Optional[str]:
        """Create a new cache entry.

        Args:
            value: The value to cache
            mime_type: MIME type of the value (default: "text/plain")
            allowed_agent_groups: List of agent groups that can access this cache (empty = all)

        Returns:
            Optional[str]: Cache ID if successful, None otherwise
        """
        if self.connector is None:
            logger.error(
                f"Cannot create cache: connector is None for agent {self.agent_id}"
            )
            return None

        try:
            # Create cache creation event
            message = Event(
                event_name="shared_cache.create",
                source_id=self.agent_id,
                relevant_mod="openagents.mods.core.shared_cache",
                visibility=EventVisibility.MOD_ONLY,
                payload={
                    "value": value,
                    "mime_type": mime_type,
                    "allowed_agent_groups": allowed_agent_groups or [],
                },
            )

            # Store pending request
            self.pending_requests[message.event_id] = {
                "action": "create",
                "timestamp": message.timestamp,
            }

            # Send event
            await self.connector.send_event(message)
            logger.debug(f"Sent cache creation request")

            # Wait for response
            import asyncio

            for _ in range(50):  # 50 * 0.2 = 10 seconds
                if message.event_id in self.completed_requests:
                    result = self.completed_requests.pop(message.event_id)
                    if result.get("success"):
                        cache_id = result.get("cache_id")
                        logger.info(f"Cache entry created: {cache_id}")
                        return cache_id
                    else:
                        logger.error(
                            f"Cache creation failed: {result.get('error', 'Unknown error')}"
                        )
                        return None

                await asyncio.sleep(0.2)

            # Timeout
            logger.warning("Cache creation timed out")
            if message.event_id in self.pending_requests:
                del self.pending_requests[message.event_id]
            return None

        except Exception as e:
            logger.error(f"Error creating cache: {e}")
            return None

    async def get_cache(self, cache_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve a cache entry.

        Args:
            cache_id: ID of the cache entry to retrieve

        Returns:
            Optional[Dict[str, Any]]: Cache entry if successful, None otherwise
        """
        if self.connector is None:
            logger.error(f"Cannot get cache: connector is None for agent {self.agent_id}")
            return None

        try:
            # Create cache get event
            message = Event(
                event_name="shared_cache.get",
                source_id=self.agent_id,
                relevant_mod="openagents.mods.core.shared_cache",
                visibility=EventVisibility.MOD_ONLY,
                payload={"cache_id": cache_id},
            )

            # Store pending request
            self.pending_requests[message.event_id] = {
                "action": "get",
                "cache_id": cache_id,
                "timestamp": message.timestamp,
            }

            # Send event
            await self.connector.send_event(message)
            logger.debug(f"Sent cache get request for {cache_id}")

            # Wait for response
            import asyncio

            for _ in range(50):  # 50 * 0.2 = 10 seconds
                if message.event_id in self.completed_requests:
                    result = self.completed_requests.pop(message.event_id)
                    if result.get("success"):
                        logger.info(f"Cache entry retrieved: {cache_id}")
                        return result
                    else:
                        logger.error(
                            f"Cache retrieval failed: {result.get('error', 'Unknown error')}"
                        )
                        return None

                await asyncio.sleep(0.2)

            # Timeout
            logger.warning(f"Cache retrieval timed out for {cache_id}")
            if message.event_id in self.pending_requests:
                del self.pending_requests[message.event_id]
            return None

        except Exception as e:
            logger.error(f"Error retrieving cache: {e}")
            return None

    async def update_cache(self, cache_id: str, value: str) -> bool:
        """Update a cache entry.

        Args:
            cache_id: ID of the cache entry to update
            value: New value for the cache entry

        Returns:
            bool: True if successful, False otherwise
        """
        if self.connector is None:
            logger.error(
                f"Cannot update cache: connector is None for agent {self.agent_id}"
            )
            return False

        try:
            # Create cache update event
            message = Event(
                event_name="shared_cache.update",
                source_id=self.agent_id,
                relevant_mod="openagents.mods.core.shared_cache",
                visibility=EventVisibility.MOD_ONLY,
                payload={"cache_id": cache_id, "value": value},
            )

            # Store pending request
            self.pending_requests[message.event_id] = {
                "action": "update",
                "cache_id": cache_id,
                "timestamp": message.timestamp,
            }

            # Send event
            await self.connector.send_event(message)
            logger.debug(f"Sent cache update request for {cache_id}")

            # Wait for response
            import asyncio

            for _ in range(50):  # 50 * 0.2 = 10 seconds
                if message.event_id in self.completed_requests:
                    result = self.completed_requests.pop(message.event_id)
                    if result.get("success"):
                        logger.info(f"Cache entry updated: {cache_id}")
                        return True
                    else:
                        logger.error(
                            f"Cache update failed: {result.get('error', 'Unknown error')}"
                        )
                        return False

                await asyncio.sleep(0.2)

            # Timeout
            logger.warning(f"Cache update timed out for {cache_id}")
            if message.event_id in self.pending_requests:
                del self.pending_requests[message.event_id]
            return False

        except Exception as e:
            logger.error(f"Error updating cache: {e}")
            return False

    async def delete_cache(self, cache_id: str) -> bool:
        """Delete a cache entry.

        Args:
            cache_id: ID of the cache entry to delete

        Returns:
            bool: True if successful, False otherwise
        """
        if self.connector is None:
            logger.error(
                f"Cannot delete cache: connector is None for agent {self.agent_id}"
            )
            return False

        try:
            # Create cache delete event
            message = Event(
                event_name="shared_cache.delete",
                source_id=self.agent_id,
                relevant_mod="openagents.mods.core.shared_cache",
                visibility=EventVisibility.MOD_ONLY,
                payload={"cache_id": cache_id},
            )

            # Store pending request
            self.pending_requests[message.event_id] = {
                "action": "delete",
                "cache_id": cache_id,
                "timestamp": message.timestamp,
            }

            # Send event
            await self.connector.send_event(message)
            logger.debug(f"Sent cache delete request for {cache_id}")

            # Wait for response
            import asyncio

            for _ in range(50):  # 50 * 0.2 = 10 seconds
                if message.event_id in self.completed_requests:
                    result = self.completed_requests.pop(message.event_id)
                    if result.get("success"):
                        logger.info(f"Cache entry deleted: {cache_id}")
                        return True
                    else:
                        logger.error(
                            f"Cache deletion failed: {result.get('error', 'Unknown error')}"
                        )
                        return False

                await asyncio.sleep(0.2)

            # Timeout
            logger.warning(f"Cache deletion timed out for {cache_id}")
            if message.event_id in self.pending_requests:
                del self.pending_requests[message.event_id]
            return False

        except Exception as e:
            logger.error(f"Error deleting cache: {e}")
            return False

    async def _handle_cache_create_response(self, message: Event) -> None:
        """Handle cache create response.

        Args:
            message: The response message
        """
        request_id = message.response_to
        if request_id and request_id in self.pending_requests:
            self.completed_requests[request_id] = message.payload or {}
            del self.pending_requests[request_id]

    async def _handle_cache_get_response(self, message: Event) -> None:
        """Handle cache get response.

        Args:
            message: The response message
        """
        request_id = message.response_to
        if request_id and request_id in self.pending_requests:
            self.completed_requests[request_id] = message.payload or {}
            del self.pending_requests[request_id]

    async def _handle_cache_update_response(self, message: Event) -> None:
        """Handle cache update response.

        Args:
            message: The response message
        """
        request_id = message.response_to
        if request_id and request_id in self.pending_requests:
            self.completed_requests[request_id] = message.payload or {}
            del self.pending_requests[request_id]

    async def _handle_cache_delete_response(self, message: Event) -> None:
        """Handle cache delete response.

        Args:
            message: The response message
        """
        request_id = message.response_to
        if request_id and request_id in self.pending_requests:
            self.completed_requests[request_id] = message.payload or {}
            del self.pending_requests[request_id]

    async def _handle_cache_created_notification(self, message: Event) -> None:
        """Handle cache created notification.

        Args:
            message: The notification message
        """
        payload = message.payload or {}
        cache_id = payload.get("cache_id")
        logger.info(f"Received cache created notification for {cache_id}")

        # Notify any registered handlers if needed
        # This could be extended to support custom callbacks

    async def _handle_cache_updated_notification(self, message: Event) -> None:
        """Handle cache updated notification.

        Args:
            message: The notification message
        """
        payload = message.payload or {}
        cache_id = payload.get("cache_id")
        logger.info(f"Received cache updated notification for {cache_id}")

        # Notify any registered handlers if needed

    async def _handle_cache_deleted_notification(self, message: Event) -> None:
        """Handle cache deleted notification.

        Args:
            message: The notification message
        """
        payload = message.payload or {}
        cache_id = payload.get("cache_id")
        logger.info(f"Received cache deleted notification for {cache_id}")

        # Notify any registered handlers if needed

    async def _handle_file_upload_response(self, message: Event) -> None:
        """Handle file upload response.

        Args:
            message: The response message
        """
        request_id = message.response_to
        if request_id and request_id in self.pending_requests:
            self.completed_requests[request_id] = message.payload or {}
            del self.pending_requests[request_id]

    async def _handle_file_download_response(self, message: Event) -> None:
        """Handle file download response.

        Args:
            message: The response message
        """
        request_id = message.response_to
        if request_id and request_id in self.pending_requests:
            self.completed_requests[request_id] = message.payload or {}
            del self.pending_requests[request_id]

    async def upload_file(
        self,
        file_path: str,
        mime_type: Optional[str] = None,
        allowed_agent_groups: Optional[List[str]] = None,
    ) -> Optional[Dict[str, Any]]:
        """Upload a file to the shared cache.

        Args:
            file_path: Path to the file to upload
            mime_type: MIME type of the file (auto-detected if not provided)
            allowed_agent_groups: List of agent groups that can access this file (empty = all)

        Returns:
            Optional[Dict[str, Any]]: Upload result with cache_id if successful, None otherwise
        """
        if self.connector is None:
            logger.error(
                f"Cannot upload file: connector is None for agent {self.agent_id}"
            )
            return None

        try:
            # Read file
            path = Path(file_path)
            if not path.exists():
                logger.error(f"File not found: {file_path}")
                return None

            file_size = path.stat().st_size
            if file_size > MAX_FILE_SIZE:
                logger.error(f"File size exceeds maximum allowed ({MAX_FILE_SIZE} bytes)")
                return None

            with open(path, "rb") as f:
                file_bytes = f.read()

            # Encode to base64
            file_data = base64.b64encode(file_bytes).decode("utf-8")
            filename = path.name

            # Auto-detect MIME type if not provided
            if mime_type is None:
                import mimetypes
                mime_type, _ = mimetypes.guess_type(file_path)
                if mime_type is None:
                    mime_type = "application/octet-stream"

            # Create file upload event
            message = Event(
                event_name="shared_cache.file.upload",
                source_id=self.agent_id,
                relevant_mod="openagents.mods.core.shared_cache",
                visibility=EventVisibility.MOD_ONLY,
                payload={
                    "file_data": file_data,
                    "filename": filename,
                    "mime_type": mime_type,
                    "allowed_agent_groups": allowed_agent_groups or [],
                },
            )

            # Store pending request
            self.pending_requests[message.event_id] = {
                "action": "upload",
                "filename": filename,
                "timestamp": message.timestamp,
            }

            # Send event
            await self.connector.send_event(message)
            logger.debug(f"Sent file upload request for {filename}")

            # Wait for response
            import asyncio

            for _ in range(100):  # 100 * 0.2 = 20 seconds (longer for file uploads)
                if message.event_id in self.completed_requests:
                    result = self.completed_requests.pop(message.event_id)
                    if result.get("success"):
                        cache_id = result.get("cache_id")
                        logger.info(f"File uploaded successfully: {cache_id}")
                        return result
                    else:
                        logger.error(
                            f"File upload failed: {result.get('error', 'Unknown error')}"
                        )
                        return None

                await asyncio.sleep(0.2)

            # Timeout
            logger.warning(f"File upload timed out for {filename}")
            if message.event_id in self.pending_requests:
                del self.pending_requests[message.event_id]
            return None

        except Exception as e:
            logger.error(f"Error uploading file: {e}")
            return None

    async def download_file(
        self,
        cache_id: str,
        save_path: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Download a file from the shared cache.

        Args:
            cache_id: ID of the cache entry to download
            save_path: Optional path to save the file (if not provided, returns file data)

        Returns:
            Optional[Dict[str, Any]]: Download result with file_data if successful, None otherwise
        """
        if self.connector is None:
            logger.error(
                f"Cannot download file: connector is None for agent {self.agent_id}"
            )
            return None

        try:
            # Create file download event
            message = Event(
                event_name="shared_cache.file.download",
                source_id=self.agent_id,
                relevant_mod="openagents.mods.core.shared_cache",
                visibility=EventVisibility.MOD_ONLY,
                payload={"cache_id": cache_id},
            )

            # Store pending request
            self.pending_requests[message.event_id] = {
                "action": "download",
                "cache_id": cache_id,
                "timestamp": message.timestamp,
            }

            # Send event
            await self.connector.send_event(message)
            logger.debug(f"Sent file download request for {cache_id}")

            # Wait for response
            import asyncio

            for _ in range(100):  # 100 * 0.2 = 20 seconds (longer for file downloads)
                if message.event_id in self.completed_requests:
                    result = self.completed_requests.pop(message.event_id)
                    if result.get("success"):
                        logger.info(f"File downloaded successfully: {cache_id}")

                        # Save to file if path provided
                        if save_path and result.get("file_data"):
                            file_bytes = base64.b64decode(result["file_data"])
                            with open(save_path, "wb") as f:
                                f.write(file_bytes)
                            logger.info(f"File saved to: {save_path}")
                            # Remove file_data from result to save memory
                            result["saved_to"] = save_path
                            del result["file_data"]

                        return result
                    else:
                        logger.error(
                            f"File download failed: {result.get('error', 'Unknown error')}"
                        )
                        return None

                await asyncio.sleep(0.2)

            # Timeout
            logger.warning(f"File download timed out for {cache_id}")
            if message.event_id in self.pending_requests:
                del self.pending_requests[message.event_id]
            return None

        except Exception as e:
            logger.error(f"Error downloading file: {e}")
            return None

    async def upload_file_data(
        self,
        file_data: bytes,
        filename: str,
        mime_type: str = "application/octet-stream",
        allowed_agent_groups: Optional[List[str]] = None,
    ) -> Optional[Dict[str, Any]]:
        """Upload file data directly to the shared cache.

        Args:
            file_data: Raw file bytes to upload
            filename: Name of the file
            mime_type: MIME type of the file
            allowed_agent_groups: List of agent groups that can access this file (empty = all)

        Returns:
            Optional[Dict[str, Any]]: Upload result with cache_id if successful, None otherwise
        """
        if self.connector is None:
            logger.error(
                f"Cannot upload file: connector is None for agent {self.agent_id}"
            )
            return None

        try:
            # Check file size
            if len(file_data) > MAX_FILE_SIZE:
                logger.error(f"File size exceeds maximum allowed ({MAX_FILE_SIZE} bytes)")
                return None

            # Encode to base64
            file_data_b64 = base64.b64encode(file_data).decode("utf-8")

            # Create file upload event
            message = Event(
                event_name="shared_cache.file.upload",
                source_id=self.agent_id,
                relevant_mod="openagents.mods.core.shared_cache",
                visibility=EventVisibility.MOD_ONLY,
                payload={
                    "file_data": file_data_b64,
                    "filename": filename,
                    "mime_type": mime_type,
                    "allowed_agent_groups": allowed_agent_groups or [],
                },
            )

            # Store pending request
            self.pending_requests[message.event_id] = {
                "action": "upload",
                "filename": filename,
                "timestamp": message.timestamp,
            }

            # Send event
            await self.connector.send_event(message)
            logger.debug(f"Sent file upload request for {filename}")

            # Wait for response
            import asyncio

            for _ in range(100):  # 100 * 0.2 = 20 seconds
                if message.event_id in self.completed_requests:
                    result = self.completed_requests.pop(message.event_id)
                    if result.get("success"):
                        cache_id = result.get("cache_id")
                        logger.info(f"File uploaded successfully: {cache_id}")
                        return result
                    else:
                        logger.error(
                            f"File upload failed: {result.get('error', 'Unknown error')}"
                        )
                        return None

                await asyncio.sleep(0.2)

            # Timeout
            logger.warning(f"File upload timed out for {filename}")
            if message.event_id in self.pending_requests:
                del self.pending_requests[message.event_id]
            return None

        except Exception as e:
            logger.error(f"Error uploading file: {e}")
            return None

    def get_tools(self) -> List[AgentTool]:
        """Get the tools for the mod adapter.

        Returns:
            List[AgentTool]: The tools for the mod adapter
        """
        tools = []

        # Tool 1: Create cache
        create_cache_tool = AgentTool(
            name="create_cache",
            description="Create a new shared cache entry with optional agent group access control",
            input_schema={
                "type": "object",
                "properties": {
                    "value": {
                        "type": "string",
                        "description": "The value to cache",
                    },
                    "mime_type": {
                        "type": "string",
                        "description": "MIME type of the value (default: text/plain)",
                        "default": "text/plain",
                    },
                    "allowed_agent_groups": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of agent groups that can access this cache (empty = all agents)",
                        "default": [],
                    },
                },
                "required": ["value"],
            },
            func=self.create_cache,
        )
        tools.append(create_cache_tool)

        # Tool 2: Get cache
        get_cache_tool = AgentTool(
            name="get_cache",
            description="Retrieve a shared cache entry by ID",
            input_schema={
                "type": "object",
                "properties": {
                    "cache_id": {
                        "type": "string",
                        "description": "ID of the cache entry to retrieve",
                    }
                },
                "required": ["cache_id"],
            },
            func=self.get_cache,
        )
        tools.append(get_cache_tool)

        # Tool 3: Update cache
        update_cache_tool = AgentTool(
            name="update_cache",
            description="Update an existing shared cache entry",
            input_schema={
                "type": "object",
                "properties": {
                    "cache_id": {
                        "type": "string",
                        "description": "ID of the cache entry to update",
                    },
                    "value": {
                        "type": "string",
                        "description": "New value for the cache entry",
                    },
                },
                "required": ["cache_id", "value"],
            },
            func=self.update_cache,
        )
        tools.append(update_cache_tool)

        # Tool 4: Delete cache
        delete_cache_tool = AgentTool(
            name="delete_cache",
            description="Delete a shared cache entry",
            input_schema={
                "type": "object",
                "properties": {
                    "cache_id": {
                        "type": "string",
                        "description": "ID of the cache entry to delete",
                    }
                },
                "required": ["cache_id"],
            },
            func=self.delete_cache,
        )
        tools.append(delete_cache_tool)

        # Tool 5: Upload file
        upload_file_tool = AgentTool(
            name="upload_file",
            description="Upload a file to the shared cache for sharing with other agents",
            input_schema={
                "type": "object",
                "properties": {
                    "file_path": {
                        "type": "string",
                        "description": "Path to the file to upload",
                    },
                    "mime_type": {
                        "type": "string",
                        "description": "MIME type of the file (auto-detected if not provided)",
                    },
                    "allowed_agent_groups": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of agent groups that can access this file (empty = all agents)",
                        "default": [],
                    },
                },
                "required": ["file_path"],
            },
            func=self.upload_file,
        )
        tools.append(upload_file_tool)

        # Tool 6: Download file
        download_file_tool = AgentTool(
            name="download_file",
            description="Download a file from the shared cache",
            input_schema={
                "type": "object",
                "properties": {
                    "cache_id": {
                        "type": "string",
                        "description": "ID of the cache entry (file) to download",
                    },
                    "save_path": {
                        "type": "string",
                        "description": "Path to save the downloaded file (optional)",
                    },
                },
                "required": ["cache_id"],
            },
            func=self.download_file,
        )
        tools.append(download_file_tool)

        return tools
