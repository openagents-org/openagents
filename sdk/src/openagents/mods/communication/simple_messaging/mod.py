"""
Network-level simple messaging mod for OpenAgents.

This mod enables direct and broadcast messaging between agents with support for text and file attachments.
"""

import logging
import os
import base64
import uuid
import tempfile
from typing import Dict, Any, List, Optional, Set, BinaryIO
from pathlib import Path

from openagents.core.base_mod import BaseMod
from openagents.models.messages import Event, Event, Event
from openagents.models.event import Event
from openagents.models.event_response import EventResponse

logger = logging.getLogger(__name__)


class SimpleMessagingNetworkMod(BaseMod):
    """Network-level simple messaging mod implementation.

    This mod enables:
    - Direct messaging between agents with text and file attachments
    - Broadcast messaging to all agents with text and file attachments
    - File transfer between agents
    """

    def __init__(self, mod_name: str = "simple_messaging"):
        """Initialize the simple messaging mod for a network."""
        super().__init__(mod_name=mod_name)

        # Register event handlers using the elegant pattern
        self.register_event_handler(
            self._handle_direct_message, "agent.direct_message.*"
        )
        self.register_event_handler(
            self._handle_broadcast_message, "agent.broadcast_message.*"
        )
        self.register_event_handler(
            self._handle_simple_messaging_event, "simple_messaging.*"
        )

        # Initialize mod state
        self.active_agents: Set[str] = set()
        self.message_history: Dict[str, Event] = {}  # message_id -> message
        self.max_history_size = 1000  # Number of messages to keep in history

        # Create a temporary directory for file storage
        self.temp_dir = tempfile.TemporaryDirectory(prefix="openagents_files_")
        self.file_storage_path = Path(self.temp_dir.name)

        logger.info(
            f"Initializing Simple Messaging network mod with file storage at {self.file_storage_path}"
        )

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
        # Clear all state
        self.active_agents.clear()
        self.message_history.clear()

        # Clean up the temporary directory
        try:
            self.temp_dir.cleanup()
            logger.info("Cleaned up temporary file storage directory")
        except Exception as e:
            logger.error(f"Error cleaning up temporary directory: {e}")

        return True

    async def handle_register_agent(
        self, agent_id: str, metadata: Dict[str, Any]
    ) -> Optional[EventResponse]:
        """Register an agent with the simple messaging protocol.

        Args:
            agent_id: Unique identifier for the agent
            metadata: Agent metadata including capabilities

        Returns:
            Optional[EventResponse]: None to allow the event to continue processing
        """
        self.active_agents.add(agent_id)

        # Create agent-specific file storage directory
        agent_storage_path = self.file_storage_path / agent_id
        os.makedirs(agent_storage_path, exist_ok=True)

        logger.info(f"Registered agent {agent_id} with Simple Messaging protocol")
        return None  # Don't intercept the registration event

    async def handle_unregister_agent(self, agent_id: str) -> Optional[EventResponse]:
        """Unregister an agent from the simple messaging protocol.

        Args:
            agent_id: Unique identifier for the agent

        Returns:
            Optional[EventResponse]: None to allow the event to continue processing
        """
        if agent_id in self.active_agents:
            self.active_agents.remove(agent_id)
            logger.info(f"Unregistered agent {agent_id} from Simple Messaging protocol")
        return None  # Don't intercept the unregistration event

    async def _handle_direct_message(self, event: Event) -> Optional[EventResponse]:
        """Handle direct message events.

        Args:
            event: The direct message event to process

        Returns:
            Optional[EventResponse]: None to allow the event to continue processing
        """
        logger.debug(
            f"Simple messaging mod processing direct message from {event.source_id} to {event.destination_id}"
        )

        # Add the message to history
        self._add_to_history(event)

        # Check if the message contains file attachments
        content = event.payload
        if hasattr(content, "get") and "files" in content and content["files"]:
            # Process file attachments
            await self._process_file_attachments(event)

        # Simple messaging doesn't interfere with direct messages, let them continue
        return None

    async def _handle_broadcast_message(self, event: Event) -> Optional[EventResponse]:
        """Handle broadcast message events.

        Args:
            event: The broadcast message event to process

        Returns:
            Optional[EventResponse]: The response to the event, or None if the event is not processed
        """
        return await self._process_broadcast_event(event)

    async def _handle_simple_messaging_event(
        self, event: Event
    ) -> Optional[EventResponse]:
        """Handle simple messaging specific events.

        Args:
            event: The simple messaging event to process

        Returns:
            Optional[EventResponse]: The response to the event, or None if the event is not processed
        """
        return await self._process_simple_messaging_event(event)

    async def _process_broadcast_event(self, event: Event) -> Optional[EventResponse]:
        """Process a broadcast message event.

        Args:
            event: The broadcast message event to process

        Returns:
            Optional[EventResponse]: The response to the event, or None if the event is not processed
        """
        logger.debug(
            f"Simple messaging mod processing broadcast message from {event.source_id}"
        )

        # Add the message to history
        self._add_to_history(event)

        # Check if the message contains file attachments
        content = event.payload
        if hasattr(content, "get") and "files" in content and content["files"]:
            # Process file attachments
            await self._process_file_attachments(event)

        # Simple messaging doesn't interfere with broadcast messages, let them continue
        return None

    async def _process_simple_messaging_event(
        self, event: Event
    ) -> Optional[EventResponse]:
        """Process a simple messaging specific event.

        Args:
            event: The simple messaging event to process

        Returns:
            Optional[EventResponse]: The response to the event, or None if the event is not processed
        """
        # Prevent infinite loops - don't process messages we generated
        if (
            self.network
            and event.source_id == self.network.network_id
            and event.relevant_mod == "simple_messaging"
        ):
            logger.debug(
                "Skipping simple messaging response message to prevent infinite loop"
            )
            return None

        logger.debug(
            f"Simple messaging processing system message: {event.event_name} from {event.source_id}"
        )

        # Check if this is a simple messaging specific event or file operation
        event_name = event.event_name
        content = event.payload

        # Handle simple messaging file operations
        if hasattr(content, "get"):
            action = content.get("action", "")

            if action == "get_file":
                # Handle file download request
                logger.debug("Simple messaging handling file download request")
                file_id = content.get("file_id")
                if file_id:
                    await self._handle_file_download(event.source_id, file_id, event)
                    return EventResponse(
                        success=True,
                        message=f"File download request processed for file {file_id}",
                        data={"file_id": file_id, "action": "get_file"},
                    )

            elif action == "delete_file":
                # Handle file deletion request
                logger.debug("Simple messaging handling file deletion request")
                file_id = content.get("file_id")
                if file_id:
                    await self._handle_file_deletion(event.source_id, file_id, event)
                    return EventResponse(
                        success=True,
                        message=f"File deletion request processed for file {file_id}",
                        data={"file_id": file_id, "action": "delete_file"},
                    )

        # Not a simple messaging event, let other mods process it
        return None

    async def _process_file_attachments(self, message: Event) -> None:
        """Process file attachments in a message.

        Args:
            message: The message containing file attachments
        """
        files = message.payload.get("files", [])
        processed_files = []

        for file_data in files:
            if "content" in file_data and "filename" in file_data:
                # Generate a unique file ID
                file_id = str(uuid.uuid4())

                # Save the file to storage
                file_path = self.file_storage_path / file_id

                try:
                    # Decode base64 content
                    file_content = base64.b64decode(file_data["content"])

                    # Write to file
                    with open(file_path, "wb") as f:
                        f.write(file_content)

                    # Replace file content with file ID in the message
                    processed_file = {
                        "file_id": file_id,
                        "filename": file_data["filename"],
                        "size": len(file_content),
                        "mime_type": file_data.get(
                            "mime_type", "application/octet-stream"
                        ),
                    }
                    processed_files.append(processed_file)

                    logger.debug(
                        f"Saved file attachment {file_data['filename']} with ID {file_id}"
                    )
                except Exception as e:
                    logger.error(f"Error saving file attachment: {e}")

        # Update the message with processed files
        if processed_files:
            message.payload["files"] = processed_files

    async def _handle_file_download(
        self, agent_id: str, file_id: str, request_message: Event
    ) -> None:
        """Handle a file download request.

        Args:
            agent_id: ID of the requesting agent
            file_id: ID of the file to download
            request_message: The original request message
        """
        file_path = self.file_storage_path / file_id

        if not file_path.exists():
            # File not found
            response = Event(
                event_name="simple_messaging.file_download_response",
                source_id=(
                    self.network.network_id if self.network else "simple_messaging"
                ),
                destination_id=agent_id,
                payload={
                    "action": "file_download_response",
                    "success": False,
                    "error": "File not found",
                    "request_id": request_message.message_id,
                },
            )
            # Return response instead of trying to send it directly
            return EventResponse(
                success=response.payload["success"],
                message=response.payload.get("error", "File operation completed"),
                data=response.payload,
            )
            return

        try:
            # Read the file
            with open(file_path, "rb") as f:
                file_content = f.read()

            # Encode as base64
            encoded_content = base64.b64encode(file_content).decode("utf-8")

            # Send response
            response = Event(
                event_name="simple_messaging.file_download_response",
                source_id=(
                    self.network.network_id if self.network else "simple_messaging"
                ),
                destination_id=agent_id,
                payload={
                    "action": "file_download_response",
                    "success": True,
                    "file_id": file_id,
                    "content": encoded_content,
                    "request_id": request_message.message_id,
                },
            )
            # Return response instead of trying to send it directly
            return EventResponse(
                success=response.payload["success"],
                message=response.payload.get("error", "File operation completed"),
                data=response.payload,
            )

            logger.debug(f"Sent file {file_id} to agent {agent_id}")
        except Exception as e:
            # Error reading file
            response = Event(
                event_name="simple_messaging.file_download_response",
                source_id=(
                    self.network.network_id if self.network else "simple_messaging"
                ),
                destination_id=agent_id,
                payload={
                    "action": "file_download_response",
                    "success": False,
                    "error": f"Error reading file: {str(e)}",
                    "request_id": request_message.message_id,
                },
            )
            # Return response instead of trying to send it directly
            return EventResponse(
                success=response.payload["success"],
                message=response.payload.get("error", "File operation completed"),
                data=response.payload,
            )
            logger.error(f"Error sending file {file_id} to agent {agent_id}: {e}")

    async def _handle_file_deletion(
        self, agent_id: str, file_id: str, request_message: Event
    ) -> None:
        """Handle a file deletion request.

        Args:
            agent_id: ID of the requesting agent
            file_id: ID of the file to delete
            request_message: The original request message
        """
        file_path = self.file_storage_path / file_id

        if not file_path.exists():
            # File not found
            response = Event(
                event_name="simple_messaging.file_deletion_response",
                source_id=(
                    self.network.network_id if self.network else "simple_messaging"
                ),
                destination_id=agent_id,
                payload={
                    "action": "file_deletion_response",
                    "success": False,
                    "error": "File not found",
                    "request_id": request_message.message_id,
                },
            )
            # Return response instead of trying to send it directly
            return EventResponse(
                success=response.payload["success"],
                message=response.payload.get("error", "File operation completed"),
                data=response.payload,
            )
            return

        try:
            # Delete the file
            os.remove(file_path)

            # Send response
            response = Event(
                event_name="simple_messaging.file_deletion_response",
                source_id=(
                    self.network.network_id if self.network else "simple_messaging"
                ),
                destination_id=agent_id,
                payload={
                    "action": "file_deletion_response",
                    "success": True,
                    "file_id": file_id,
                    "request_id": request_message.message_id,
                },
            )
            # Return response instead of trying to send it directly
            return EventResponse(
                success=response.payload["success"],
                message=response.payload.get("error", "File operation completed"),
                data=response.payload,
            )

            logger.debug(f"Deleted file {file_id} for agent {agent_id}")
        except Exception as e:
            # Error deleting file
            response = Event(
                event_name="simple_messaging.file_deletion_response",
                source_id=(
                    self.network.network_id if self.network else "simple_messaging"
                ),
                destination_id=agent_id,
                payload={
                    "action": "file_deletion_response",
                    "success": False,
                    "error": f"Error deleting file: {str(e)}",
                    "request_id": request_message.message_id,
                },
            )
            # Return response instead of trying to send it directly
            return EventResponse(
                success=response.payload["success"],
                message=response.payload.get("error", "File operation completed"),
                data=response.payload,
            )
            logger.error(f"Error deleting file {file_id} for agent {agent_id}: {e}")

    def get_state(self) -> Dict[str, Any]:
        """Get the current state of the Simple Messaging protocol.

        Returns:
            Dict[str, Any]: Current protocol state
        """
        # Count files in storage
        file_count = sum(1 for _ in self.file_storage_path.glob("*") if _.is_file())

        return {
            "active_agents": len(self.active_agents),
            "message_history_size": len(self.message_history),
            "stored_files": file_count,
            "file_storage_path": str(self.file_storage_path),
        }

    def _add_to_history(self, message: Event) -> None:
        """Add a message to the history.

        Args:
            message: The message to add
        """
        self.message_history[message.message_id] = message

        # Trim history if it exceeds the maximum size
        if len(self.message_history) > self.max_history_size:
            # Remove oldest messages
            oldest_ids = sorted(
                self.message_history.keys(),
                key=lambda k: self.message_history[k].timestamp,
            )[:100]
            for old_id in oldest_ids:
                del self.message_history[old_id]
