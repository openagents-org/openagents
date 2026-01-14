"""
Network-level thread messaging mod for OpenAgents.

This standalone mod enables Reddit-like threading and direct messaging with:
- Direct messaging between agents
- Channel-based messaging with mentions
- 5-level nested threading (like Reddit)
- File upload/download with UUIDs
- Message quoting
"""

import logging
import os
import base64
import uuid
import time
import json
import gzip
from datetime import datetime
from typing import Dict, Any, List, Optional, Set
from pathlib import Path

from openagents.core.base_mod import BaseMod, mod_event_handler
from openagents.models.event import Event
from openagents.models.event_response import EventResponse
from .message_storage_helper import MessageStorageHelper, MessageStorageConfig
from .thread_messages import (
    ChannelMessage,
    ReplyMessage,
    FileUploadMessage,
    FileOperationMessage,
    ChannelInfoMessage,
    MessageRetrievalMessage,
    ReactionMessage,
    AnnouncementSetMessage,
    AnnouncementGetMessage,
)

logger = logging.getLogger(__name__)


class MessageThread:
    """Represents a conversation thread with Reddit-like nesting."""

    def __init__(self, root_message_id: str, root_message: Event):
        self.thread_id = str(uuid.uuid4())
        self.root_message_id = root_message_id
        self.root_message = root_message
        self.replies: Dict[str, List[Event]] = {}  # parent_id -> [replies]
        self.message_levels: Dict[str, int] = {
            root_message_id: 0
        }  # message_id -> level
        self.created_timestamp = root_message.timestamp

    def add_reply(self, reply: Event) -> bool:
        """Add a reply to the thread."""
        parent_id = ReplyMessage.get_reply_to_id(reply)

        # Check if parent exists and level is valid
        if parent_id not in self.message_levels:
            return False

        parent_level = self.message_levels[parent_id]
        if parent_level >= 4:  # Max 5 levels (0-4)
            return False

        # Add reply
        if parent_id not in self.replies:
            self.replies[parent_id] = []

        self.replies[parent_id].append(reply)
        self.message_levels[reply.event_id] = parent_level + 1

        # Set thread level in the event payload
        if not reply.payload:
            reply.payload = {}
        reply.payload["thread_level"] = parent_level + 1

        return True

    def get_thread_structure(self) -> Dict[str, Any]:
        """Get the complete thread structure."""

        def build_subtree(message_id: str) -> Dict[str, Any]:
            message = None
            if message_id == self.root_message_id:
                message = self.root_message
            else:
                # Find message in replies
                for replies in self.replies.values():
                    for reply in replies:
                        if reply.event_id == message_id:
                            message = reply
                            break

            subtree = {
                "message": message.model_dump() if message else None,
                "level": self.message_levels.get(message_id, 0),
                "replies": [],
            }

            if message_id in self.replies:
                for reply in self.replies[message_id]:
                    subtree["replies"].append(build_subtree(reply.event_id))

            return subtree

        return build_subtree(self.root_message_id)


class ThreadMessagingNetworkMod(BaseMod):
    """Network-level thread messaging mod implementation.

    This standalone mod enables:
    - Direct messaging between agents
    - Channel-based messaging with mentions
    - Reddit-like threading (5 levels max)
    - File upload/download with UUIDs
    - Message quoting
    """

    def __init__(self, mod_name: str = "messaging"):
        """Initialize the thread messaging mod for a network."""
        super().__init__(mod_name=mod_name)

        # Initialize storage helper with configuration
        storage_config = MessageStorageConfig(
            max_memory_messages=self.config.get("max_memory_messages", 1000),
            memory_cleanup_minutes=self.config.get("memory_cleanup_minutes", 30),
            dump_interval_minutes=self.config.get("dump_interval_minutes", 10),
            hot_storage_days=self.config.get("hot_storage_days", 7),
            archive_retention_days=self.config.get("archive_retention_days", 180),
        )
        self.storage_helper = MessageStorageHelper(
            self.get_storage_path, storage_config
        )

        # Storage configuration now handled by helper class

        # Initialize mod state
        self.active_agents: Set[str] = set()
        self.message_history: Dict[str, Event] = {}  # message_id -> message
        self.threads: Dict[str, MessageThread] = {}  # thread_id -> MessageThread
        self.message_to_thread: Dict[str, str] = {}  # message_id -> thread_id
        self.max_history_size = 1000  # Default limit for backward compatibility

        # Channel management - use EventGateway as single source of truth
        self.channels: Dict[str, Dict[str, Any]] = (
            {}
        )  # channel_name -> channel_info (metadata only)

        # File management
        self.files: Dict[str, Dict[str, Any]] = {}  # file_id -> file_info

        # Announcement management
        self.channel_announcements: Dict[str, str] = {}  # channel_name -> announcement_text

        # Initialize default channels (will be created after network binding)

        # File storage will be set up after workspace binding
        self.file_storage_path: Optional[Path] = None

        # Enhanced periodic persistence tracking
        self._message_count_since_save = 0
        self._save_interval = 50  # Save every 50 messages

        logger.info(f"Initializing Thread Messaging network mod")

    def _get_request_id(self, message) -> str:
        """Extract request_id from message, with fallback to message_id."""
        # Try to get request_id from message attribute (for MessageRetrievalMessage, ReactionMessage, etc.)
        if hasattr(message, "request_id") and message.request_id:
            return message.request_id

        # Try to get request_id from message content/payload
        if hasattr(message, "content") and isinstance(message.content, dict):
            request_id = message.content.get("request_id")
            if request_id:
                return request_id
        if hasattr(message, "payload") and isinstance(message.payload, dict):
            request_id = message.payload.get("request_id")
            if request_id:
                return request_id

        # Fallback to event_id if available
        if hasattr(message, "event_id") and message.event_id:
            return message.event_id

        # Final fallback to message_id if available
        if hasattr(message, "message_id") and message.message_id:
            return message.message_id

        # Last resort: generate a unique ID
        import uuid

        return str(uuid.uuid4())

    def _initialize_default_channels(self) -> None:
        """Initialize default channels from configuration."""
        # Get channels from config or use default
        config_channels = self.config.get(
            "default_channels",
            [
                {"name": "general", "description": "General discussion"},
                {"name": "development", "description": "Development discussions"},
                {"name": "support", "description": "Support and help"},
            ],
        )

        for channel_config in config_channels:
            if isinstance(channel_config, str):
                channel_name = channel_config
                description = f"Channel {channel_name}"
            else:
                channel_name = channel_config["name"]
                description = channel_config.get(
                    "description", f"Channel {channel_name}"
                )

            # Store channel metadata locally
            self.channels[channel_name] = {
                "name": channel_name,
                "description": description,
                "created_timestamp": int(time.time()),
                "message_count": 0,
                "thread_count": 0,
            }

            # Create channel in EventGateway (single source of truth for membership)
            self.network.event_gateway.create_channel(channel_name)
            logger.debug(
                f"Created channel {channel_name} in EventGateway during initialization"
            )

        logger.info(f"Initialized channels: {list(self.channels.keys())}")

    def _create_channel(self, channel_name: str, description: str = "") -> None:
        """Create a new channel.

        Args:
            channel_name: Name of the channel to create
            description: Optional description for the channel
        """
        if channel_name not in self.channels:
            # Store channel metadata locally
            self.channels[channel_name] = {
                "name": channel_name,
                "description": description,
                "created_timestamp": int(time.time()),
                "message_count": 0,
                "thread_count": 0,
            }

            # Create channel in EventGateway (single source of truth for membership)
            self.network.event_gateway.create_channel(channel_name)
            logger.info(f"Created channel: {channel_name}")

    def bind_network(self, network):
        """Bind the mod to a network and initialize channels."""
        super().bind_network(network)

        # Set up file storage - use workspace if available, otherwise temp directory
        self._setup_file_storage()

        # Now that network is available, initialize default channels
        self._initialize_default_channels()

    def _setup_file_storage(self):
        """Set up file storage using workspace or temporary directory."""
        # Use storage path (workspace or fallback)
        storage_path = self.get_storage_path()
        self.file_storage_path = storage_path / "files"
        self.file_storage_path.mkdir(exist_ok=True)

        logger.info(f"Using file storage at {self.file_storage_path}")

        self._load_file_metadata()
        self._load_message_history()

    def _load_file_metadata(self):
        """Load file metadata from storage."""
        try:
            storage_path = self.get_storage_path()
            metadata_file = storage_path / "files_metadata.json"

            if metadata_file.exists():
                import json

                with open(metadata_file, "r") as f:
                    self.files = json.load(f)
                logger.info(f"Loaded {len(self.files)} file records from storage")
            else:
                logger.debug("No existing file metadata found in storage")
        except Exception as e:
            logger.error(f"Failed to load file metadata: {e}")
            self.files = {}

    def _save_file_metadata(self):
        """Save file metadata to storage."""
        try:
            storage_path = self.get_storage_path()
            metadata_file = storage_path / "files_metadata.json"

            import json

            with open(metadata_file, "w") as f:
                json.dump(self.files, f, indent=2)
            logger.info(f"Saved {len(self.files)} file records to storage")
        except Exception as e:
            logger.error(f"Failed to save file metadata: {e}")

    def _load_message_history(self):
        """Load message history from storage using helper."""
        self.message_history = self.storage_helper.load_message_history()

    def _save_message_history(self):
        """Save message history to storage using helper."""
        self.storage_helper.save_message_history(self.message_history)

    @property
    def max_memory_messages(self) -> int:
        """Access max memory messages from storage helper config."""
        return self.storage_helper.config.max_memory_messages

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
        self.threads.clear()
        self.message_to_thread.clear()
        self.files.clear()

        # Remove all channels from EventGateway
        for channel_name in list(self.channels.keys()):
            self.network.event_gateway.remove_channel(channel_name)

        self.channels.clear()

        # Save data to storage
        self._save_file_metadata()
        self._save_message_history()

        return True

    async def handle_register_agent(
        self, agent_id: str, metadata: Dict[str, Any]
    ) -> Optional[EventResponse]:
        """Register an agent with the thread messaging protocol.

        Args:
            agent_id: Unique identifier for the agent
            metadata: Agent metadata including capabilities
        """
        logger.info(f"🎯 THREAD MESSAGING MOD: Registering agent {agent_id}")
        logger.info(f"🎯 THREAD MESSAGING MOD: Agent metadata: {metadata}")

        self.active_agents.add(agent_id)

        # Add agent to all existing channels by default
        # This ensures Studio UI and all agents receive channel messages
        channels_before = len(self.channels)
        for channel_name in self.channels.keys():
            # Check if agent is already in channel using EventGateway
            channel_members = self.network.event_gateway.get_channel_members(
                channel_name
            )
            was_in_channel = agent_id in channel_members

            if not was_in_channel:
                # Add agent to channel in EventGateway (single source of truth)
                self.network.event_gateway.add_channel_member(channel_name, agent_id)
                logger.info(
                    f"✅ AUTO-ADDED agent {agent_id} to channel '{channel_name}' (total agents: {len(self.network.event_gateway.get_channel_members(channel_name))})"
                )
            else:
                logger.info(f"ℹ️  Agent {agent_id} already in channel '{channel_name}'")

        # If no channels exist yet, create general channel and add agent
        if channels_before == 0:
            logger.info(
                f"🏗️  Creating default 'general' channel for first agent {agent_id}"
            )
            self._create_channel("general", "General discussion channel")
            self.network.event_gateway.add_channel_member("general", agent_id)

        # Create agent-specific file storage directory
        agent_storage_path = self.file_storage_path / agent_id
        os.makedirs(agent_storage_path, exist_ok=True)

        logger.info(
            f"🎉 THREAD MESSAGING MOD: Successfully registered agent {agent_id}"
        )
        logger.info(
            f"📊 Total active agents: {len(self.active_agents)} -> {self.active_agents}"
        )

        # Log detailed channel membership for debugging using EventGateway
        for ch_name in self.channels.keys():
            ch_members = self.network.event_gateway.get_channel_members(ch_name)
            logger.info(
                f"📺 Channel '{ch_name}': {len(ch_members)} agents -> {ch_members}"
            )

        # Get agent's channels from EventGateway
        agent_channels = [
            ch
            for ch in self.channels.keys()
            if agent_id in self.network.event_gateway.get_channel_members(ch)
        ]
        logger.info(f"🔗 Agent {agent_id} channels: {agent_channels}")

        return None  # Don't intercept the registration event

    async def handle_unregister_agent(self, agent_id: str) -> Optional[EventResponse]:
        """Unregister an agent from the thread messaging protocol.

        Args:
            agent_id: Unique identifier for the agent
        """
        if agent_id in self.active_agents:
            self.active_agents.remove(agent_id)

            # Remove from all channels in EventGateway
            for channel_name in self.channels.keys():
                channel_members = self.network.event_gateway.get_channel_members(
                    channel_name
                )
                if agent_id in channel_members:
                    self.network.event_gateway.remove_channel_member(
                        channel_name, agent_id
                    )

            logger.info(f"Unregistered agent {agent_id} from Thread Messaging protocol")

        return None  # Don't intercept the unregistration event

    @mod_event_handler("agent.message")
    async def _handle_agent_message(self, event: Event) -> Optional[EventResponse]:
        """Handle agent message events (both direct and broadcast).

        Args:
            event: The agent message event to process

        Returns:
            Optional[EventResponse]: None to allow the event to continue processing, or EventResponse if intercepted
        """
        logger.debug(
            f"Thread messaging mod processing agent message from {event.source_id} to {event.destination_id}"
        )

        # Add to history for potential retrieval
        self._add_to_history(event)

        # Check if this is a broadcast message (destination_id is "agent:broadcast")
        if event.destination_id == "agent:broadcast":
            # Handle broadcast message logic
            return await self._process_broadcast_event(event)
        else:
            # Handle direct message - thread messaging mod doesn't interfere with direct messages, let them continue
            return None

    def _create_event_response(
        self, success: bool, message: str, data: Dict[str, Any] = None
    ) -> EventResponse:
        """Create a standardized event response."""
        return EventResponse(success=success, message=message, data=data or {})

    async def _process_thread_event_common(
        self, event: Event, message_class, processor_func, success_message: str
    ):
        """Generic helper for processing thread events.

        Args:
            event: The event to process
            message_class: The message class to instantiate
            processor_func: The function to process the message
            success_message: Success message for the response
        """
        # Prevent infinite loops - don't process messages we generated
        if (
            self.network
            and event.source_id == self.network.network_id
            and event.relevant_mod == "openagents.mods.workspace.messaging"
        ):
            logger.debug(
                "Skipping thread messaging response message to prevent infinite loop"
            )
            return None

        try:
            # Validate the event using the message class validator
            validated_event = message_class.validate(event)
            logger.debug(
                f"Validated {message_class.__name__} with event_id: {validated_event.event_id}"
            )
            self._add_to_history(validated_event)

            # Call the processor function (handle both async and sync)
            import asyncio

            if asyncio.iscoroutinefunction(processor_func):
                result_data = await processor_func(validated_event)
            else:
                result_data = processor_func(validated_event)

            # Handle different return types
            if isinstance(result_data, dict):
                if "success" in result_data:
                    # This is a response dict with operation status
                    # Event processing succeeds, but the operation might have failed
                    return self._create_event_response(
                        success=True,  # Event was processed successfully
                        message=(
                            success_message
                            if result_data["success"]
                            else result_data.get("error", "Unknown error")
                        ),
                        data=result_data,
                    )
                else:
                    # This is just data, assume success
                    return self._create_event_response(
                        success=True, message=success_message, data=result_data
                    )
            else:
                # No return data, assume success
                return self._create_event_response(
                    success=True,
                    message=success_message,
                    data={"event_name": event.event_name, "event_id": event.event_id},
                )
        except Exception as e:
            logger.error(f"Error processing {event.event_name}: {e}")
            return self._create_event_response(
                success=False,
                message=f"Error processing {event.event_name}: {str(e)}",
                data={"error": str(e)},
            )

    def _validate_reaction_target(
        self, target_message_id: str, message: Event
    ) -> Dict[str, Any]:
        """Validate that a reaction target message exists.

        Returns:
            Dict with error response if validation fails, empty dict if valid
        """
        if target_message_id not in self.message_history:
            logger.warning(
                f"Cannot react: target message {target_message_id} not found"
            )
            return {
                "success": False,
                "error": f"Target message {target_message_id} not found",
                "target_message_id": target_message_id,
                "reaction_type": ReactionMessage.get_reaction_type(message),
                "request_id": self._get_request_id(message),
            }
        return {}

    def _get_reactions_for_message(
        self, target_message_id: str
    ) -> Dict[str, List[str]]:
        """Get reactions directly from the message payload - O(1) lookup.

        Returns:
            Dict mapping reaction_type to list of agent_ids
        """
        target_message = self.message_history.get(target_message_id)
        if not target_message or not target_message.payload:
            return {}
        return target_message.payload.get("reactions", {})

    def _get_notification_targets(self, target_message: Event) -> Set[str]:
        """Determine which agents should be notified about reactions to this message."""
        notify_agents = set()

        if isinstance(target_message, Event):
            # Always notify the message author
            notify_agents.add(target_message.source_id)

            # If it has a destination_id, notify that agent too (for direct messages)
            if target_message.destination_id:
                notify_agents.add(target_message.destination_id)

        # Check if this is a channel message
        if (
            target_message.payload
            and target_message.payload.get("message_type") == "channel_message"
        ):
            channel = target_message.payload.get("channel")
            if channel:
                channel_members = self.network.event_gateway.get_channel_members(
                    channel
                )
                notify_agents.update(channel_members)
        elif (
            target_message.payload
            and target_message.payload.get("message_type") == "reply"
        ):
            # For replies, notify based on whether it's a channel or direct reply
            channel = target_message.payload.get("channel")
            if channel:
                channel_members = self.network.event_gateway.get_channel_members(
                    channel
                )
                notify_agents.update(channel_members)
            elif target_message.payload.get("target_agent_id"):
                notify_agents.add(target_message.payload.get("target_agent_id"))

        return notify_agents

    async def _send_reaction_notification(
        self,
        target_message_id: str,
        reaction_type: str,
        reacting_agent: str,
        action: str,
    ):
        """Send reaction notifications to relevant agents."""
        target_message = self.message_history.get(target_message_id)
        if not target_message:
            return

        # Determine who to notify based on message type
        notify_agents = self._get_notification_targets(target_message)
        notify_agents.discard(reacting_agent)  # Don't notify the reacting agent

        if not notify_agents:
            return

        # Get current reaction count
        current_reactions = self._get_reactions_for_message(target_message_id)
        total_reactions = len(current_reactions.get(reaction_type, []))

        for agent_id in notify_agents:
            notification = Event(
                event_name="thread.reaction.notification",  # Standard reaction notification event
                source_id=reacting_agent,
                destination_id=agent_id,
                payload={
                    "target_message_id": target_message_id,
                    "reaction_type": reaction_type,
                    "reacting_agent": reacting_agent,
                    "action": action,
                    "total_reactions": total_reactions,
                },
            )
            try:
                await self.network.process_event(notification)
                logger.debug(
                    f"Sent reaction notification to {agent_id}: {action} {reaction_type}"
                )
            except Exception as e:
                logger.error(f"Failed to send reaction notification to {agent_id}: {e}")

    def _create_reaction_response(
        self,
        target_message_id: str,
        reaction_type: str,
        action_taken: str,
        success: bool,
        message: Event,
    ) -> Dict[str, Any]:
        """Create a standardized reaction response."""
        # Count current reactions of this type
        current_reactions = self._get_reactions_for_message(target_message_id)
        total_reactions = len(current_reactions.get(reaction_type, []))

        return {
            "success": success,
            "target_message_id": target_message_id,
            "reaction_type": reaction_type,
            "action_taken": action_taken,
            "total_reactions": total_reactions,
            "request_id": self._get_request_id(message),
        }

    @mod_event_handler("thread.reply.sent")
    async def _handle_thread_reply_sent(self, event: Event) -> Optional[EventResponse]:
        """Handle thread reply sent events."""
        logger.info(
            f"🔍 MOD_DEBUG: _handle_thread_reply_sent called with event {event.event_id} from {event.source_id}"
        )
        result = await self._handle_thread_reply_common(event)
        return result

    @mod_event_handler("thread.reply.post")
    async def _handle_thread_reply_post(self, event: Event) -> Optional[EventResponse]:
        """Handle thread reply post events."""
        return await self._handle_thread_reply_common(event)

    async def _handle_thread_reply_common(
        self, event: Event
    ) -> Optional[EventResponse]:
        """Handle thread reply events.

        Args:
            event: The thread reply event to process

        Returns:
            Optional[EventResponse]: The response to the event
        """
        # Prevent infinite loops - don't process messages we generated
        if (
            self.network
            and event.source_id == self.network.network_id
            and event.relevant_mod == "openagents.mods.workspace.messaging"
        ):
            logger.debug(
                "Skipping thread messaging response message to prevent infinite loop"
            )
            return None

        try:
            logger.info(f"🔍 DEBUG: Starting reply processing for {event.event_id}")
            # Populate quoted_text if quoted_message_id is provided in payload
            if (
                event.payload
                and "quoted_message_id" in event.payload
                and event.payload["quoted_message_id"]
            ):
                # Update the event payload with quoted text
                if "quoted_text" not in event.payload:
                    event.payload["quoted_text"] = self._get_quoted_text(
                        event.payload["quoted_message_id"]
                    )

            logger.info(
                f"🔍 DEBUG: About to validate ReplyMessage for {event.event_id}"
            )
            logger.info(f"🔍 DEBUG: Event payload: {event.payload}")
            # Validate the reply message payload
            validated_event = ReplyMessage.validate(event)
            logger.debug(
                f"Validated ReplyMessage with event_id: {validated_event.event_id}"
            )
            logger.info(
                f"🔍 DEBUG: About to add reply to history: {validated_event.event_id} from {validated_event.source_id}"
            )
            self._add_to_history(validated_event)
            logger.info(
                f"🔍 DEBUG: Added reply to history, total messages: {len(self.message_history)}"
            )
            await self._process_reply_message(validated_event)
            logger.info(f"🔍 DEBUG: Completed reply processing for {event.event_id}")

            return EventResponse(
                success=True,
                message=f"Thread reply event {event.event_name} processed successfully",
                data={"event_name": event.event_name, "event_id": event.event_id},
            )
        except Exception as e:
            logger.error(
                f"🔍 DEBUG: Error processing thread reply event {event.event_id}: {e}"
            )
            import traceback

            logger.error(f"🔍 DEBUG: Traceback: {traceback.format_exc()}")
            return None

    @mod_event_handler("thread.file.upload")
    async def _handle_thread_file_upload(self, event: Event) -> Optional[EventResponse]:
        """Handle thread file upload events."""
        return await self._process_thread_event_common(
            event,
            FileUploadMessage,
            self._process_file_upload,
            "File uploaded successfully",
        )

    @mod_event_handler("thread.file.upload_requested")
    async def _handle_thread_file_upload_requested(
        self, event: Event
    ) -> Optional[EventResponse]:
        """Handle thread file upload requested events."""
        return await self._process_thread_event_common(
            event,
            FileUploadMessage,
            self._process_file_upload,
            "File upload requested successfully",
        )

    @mod_event_handler("thread.file.download")
    async def _handle_thread_file_download(
        self, event: Event
    ) -> Optional[EventResponse]:
        """Handle thread file download events."""
        return await self._process_thread_event_common(
            event,
            FileOperationMessage,
            self._process_file_operation,
            "File download completed successfully",
        )

    @mod_event_handler("thread.file.operation")
    async def _handle_thread_file_operation(
        self, event: Event
    ) -> Optional[EventResponse]:
        """Handle thread file operation events."""
        return await self._process_thread_event_common(
            event,
            FileOperationMessage,
            self._process_file_operation,
            "File operation completed successfully",
        )

    @mod_event_handler("thread.channels.info")
    async def _handle_thread_channels_info(
        self, event: Event
    ) -> Optional[EventResponse]:
        """Handle thread channels info events."""
        return await self._process_thread_event_common(
            event,
            ChannelInfoMessage,
            self._process_channel_info_request,
            "Channel info retrieved successfully",
        )

    @mod_event_handler("thread.channels.list")
    async def _handle_thread_channels_list(
        self, event: Event
    ) -> Optional[EventResponse]:
        """Handle thread channels list events."""
        return await self._process_thread_event_common(
            event,
            ChannelInfoMessage,
            self._process_channel_info_request,
            "Channel list retrieved successfully",
        )

    @mod_event_handler("thread.messages.retrieve")
    async def _handle_thread_messages_retrieve(
        self, event: Event
    ) -> Optional[EventResponse]:
        """Handle thread messages retrieve events."""
        return await self._process_thread_event_common(
            event,
            MessageRetrievalMessage,
            lambda msg: self._handle_channel_messages_retrieval(msg),
            "Message retrieval completed successfully",
        )

    @mod_event_handler("thread.channel_messages.retrieve")
    async def _handle_thread_channel_messages_retrieve(
        self, event: Event
    ) -> Optional[EventResponse]:
        """Handle thread channel messages retrieve events."""
        return await self._process_thread_event_common(
            event,
            MessageRetrievalMessage,
            lambda msg: self._handle_channel_messages_retrieval(msg),
            "Channel message retrieval completed successfully",
        )

    @mod_event_handler("thread.direct_messages.retrieve")
    async def _handle_thread_direct_messages_retrieve(
        self, event: Event
    ) -> Optional[EventResponse]:
        """Handle thread direct messages retrieve events."""
        return await self._process_thread_event_common(
            event,
            MessageRetrievalMessage,
            lambda msg: self._handle_direct_messages_retrieval(msg),
            "Direct message retrieval completed successfully",
        )

    @mod_event_handler("thread.reaction.add")
    async def _handle_thread_reaction_add(
        self, event: Event
    ) -> Optional[EventResponse]:
        """Handle thread reaction add events."""
        return await self._process_thread_event_common(
            event,
            ReactionMessage,
            self._process_add_reaction,
            "Reaction added successfully",
        )

    @mod_event_handler("thread.reaction.remove")
    async def _handle_thread_reaction_remove(
        self, event: Event
    ) -> Optional[EventResponse]:
        """Handle thread reaction remove events."""
        return await self._process_thread_event_common(
            event,
            ReactionMessage,
            self._process_remove_reaction,
            "Reaction removed successfully",
        )

    @mod_event_handler("thread.reaction.toggle")
    async def _handle_thread_reaction_toggle(
        self, event: Event
    ) -> Optional[EventResponse]:
        """Handle thread reaction toggle events."""
        return await self._process_thread_event_common(
            event,
            ReactionMessage,
            self._process_toggle_reaction,
            "Reaction toggled successfully",
        )

    @mod_event_handler("thread.direct_message.send")
    async def _handle_thread_direct_message(
        self, event: Event
    ) -> Optional[EventResponse]:
        """Handle thread direct message events.

        Args:
            event: The thread direct message event to process

        Returns:
            Optional[EventResponse]: The response to the event
        """
        # Prevent infinite loops - don't process messages we generated
        if (
            self.network
            and event.source_id == self.network.network_id
            and event.relevant_mod == "openagents.mods.workspace.messaging"
        ):
            logger.debug(
                "Skipping thread messaging response message to prevent infinite loop"
            )
            return None

        try:
            # Use event.model_dump() to preserve all event information including payload
            event_data = event.model_dump()

            # Preprocess event_data to extract direct message specific fields from payload
            if "payload" in event_data and isinstance(event_data["payload"], dict):
                payload = event_data["payload"]

                # Extract direct message info from payload to top level
                if "target_agent_id" in payload:
                    event_data["target_agent_id"] = payload["target_agent_id"]
                if "quoted_message_id" in payload:
                    event_data["quoted_message_id"] = payload["quoted_message_id"]
                if "quoted_text" in payload:
                    event_data["quoted_text"] = payload["quoted_text"]

            # Populate quoted_text if quoted_message_id is provided
            if "quoted_message_id" in event_data and event_data["quoted_message_id"]:
                event_data["quoted_text"] = self._get_quoted_text(
                    event_data["quoted_message_id"]
                )

            # Create ThreadMessageEvent with preserved original event information
            from .thread_messages import ThreadMessageEvent

            inner_message = ThreadMessageEvent.model_validate(event_data)
            logger.debug(
                f"Created direct message ThreadMessageEvent with preserved event_id: {inner_message.event_id}"
            )

            self._add_to_history(inner_message)
            await self._process_direct_message(inner_message)

            return EventResponse(
                success=True,
                message=f"Thread direct message event {event.event_name} processed successfully",
                data={"event_name": event.event_name, "event_id": event.event_id},
            )
        except Exception as e:
            logger.error(f"Error processing thread direct message event: {e}")
            return None

    @mod_event_handler("thread.channel_message.post")
    async def _handle_thread_channel_message(
        self, event: Event
    ) -> Optional[EventResponse]:
        """Handle thread channel message events.

        Args:
            event: The thread channel message event to process

        Returns:
            Optional[EventResponse]: The response to the event
        """
        # Prevent infinite loops - don't process messages we generated
        if (
            self.network
            and event.source_id == self.network.network_id
            and event.relevant_mod == "openagents.mods.workspace.messaging"
        ):
            logger.debug(
                "Skipping thread messaging response message to prevent infinite loop"
            )
            return None

        try:
            # Populate quoted_text if quoted_message_id is provided in payload
            if (
                event.payload
                and "quoted_message_id" in event.payload
                and event.payload["quoted_message_id"]
            ):
                # Update the event payload with quoted text
                if "quoted_text" not in event.payload:
                    event.payload["quoted_text"] = self._get_quoted_text(
                        event.payload["quoted_message_id"]
                    )

            # Validate the channel message payload
            validated_event = ChannelMessage.validate(event)
            logger.debug(
                f"Validated ChannelMessage with event_id: {validated_event.event_id}"
            )
            self._add_to_history(validated_event)
            await self._process_channel_message(validated_event)

            return EventResponse(
                success=True,
                message=f"Thread channel message event {event.event_name} processed successfully",
                data={"event_name": event.event_name, "event_id": event.event_id},
            )
        except Exception as e:
            logger.error(f"Error processing thread channel message event: {e}")
            return None

    async def _process_broadcast_event(self, event: Event) -> Optional[EventResponse]:
        """Process a broadcast message event.

        Args:
            event: The broadcast message event to process

        Returns:
            Optional[EventResponse]: The response to the event, or None if the event is not processed
        """
        logger.debug(
            f"Thread messaging mod processing broadcast message from {event.source_id}"
        )

        # Add to history for thread messaging
        self._add_to_history(event)

        # Check if this is a channel message that should be handled by thread messaging
        # For channel messages, the destination_id should be in format "channel:channelname"
        channel_name = None
        if event.destination_id and event.destination_id.startswith("channel:"):
            channel_name = event.destination_id.split(":", 1)[1]
        elif (
            hasattr(event, "payload") and event.payload and event.payload.get("channel")
        ):
            channel_name = event.payload.get("channel")

        if channel_name:
            # This is a channel broadcast - thread messaging should handle it
            logger.debug(
                f"Thread messaging capturing channel broadcast to {channel_name}"
            )

            # Validate as channel message and process it
            # Ensure the payload has the channel field
            if not event.payload:
                event.payload = {}
            if "channel" not in event.payload:
                event.payload["channel"] = channel_name

            validated_event = ChannelMessage.validate(event)
            await self._process_channel_message(validated_event)

            # Return response to stop further processing - thread messaging handled this
            return EventResponse(
                success=True,
                message=f"Channel message processed and distributed to channel {channel_name}",
                data={"channel": channel_name, "message_id": event.event_id},
            )

        # Check if this is a channel message based on payload
        if hasattr(event, "payload") and event.payload:
            channel_name = event.payload.get("channel")
            if channel_name:
                logger.debug(f"Processing channel message for channel: {channel_name}")

                # Ensure channel exists
                if channel_name not in self.channels:
                    self._create_channel(channel_name)

                # Add message to channel history
                if channel_name not in self.channels:
                    self.channels[channel_name] = {"messages": []}
                if "messages" not in self.channels[channel_name]:
                    self.channels[channel_name]["messages"] = []

                self.channels[channel_name]["messages"].append(event)

                # Limit channel history size
                if len(self.channels[channel_name]["messages"]) > self.max_history_size:
                    self.channels[channel_name]["messages"] = self.channels[
                        channel_name
                    ]["messages"][-self.max_history_size :]

                # Send notifications to channel members
                await self._send_channel_message_notifications(event, channel_name)

                # Intercept the message since we've handled channel distribution
                return EventResponse(
                    success=True,
                    message=f"Channel message processed and distributed to channel {channel_name}",
                    data={"channel": channel_name, "message_id": event.event_id},
                )

        # Not a channel message, let other mods process it
        return None

    async def _process_channel_message(self, message: Event) -> None:
        """Process a channel message.

        Args:
            message: The channel message to process
        """
        self._add_to_history(message)

        # Track message in channel
        channel = ChannelMessage.get_channel(message)
        if channel in self.channels:
            self.channels[channel]["message_count"] += 1
        else:
            # Auto-create channel and add all active agents to it
            logger.info(f"Auto-creating channel {channel} and adding all active agents")
            self._create_channel(channel, f"Auto-created channel {channel}")

            # Add all active agents to the new channel in EventGateway
            for agent_id in self.active_agents:
                self.network.event_gateway.add_channel_member(channel, agent_id)
                logger.info(f"Added agent {agent_id} to auto-created channel {channel}")

        logger.debug(
            f"Processing channel message from {message.source_id} in {channel}"
        )

        # Broadcast the message to all other agents in the channel
        await self._broadcast_channel_message(message)

    async def _broadcast_channel_message(self, message: Event) -> None:
        """Broadcast a channel message to all other agents in the channel.

        Args:
            message: The channel message to broadcast
        """
        channel = ChannelMessage.get_channel(message)

        # Get all agents in the channel from EventGateway
        channel_members = self.network.event_gateway.get_channel_members(channel)
        channel_agents = set(channel_members)

        # Remove the sender from the notification list (they already know about their message)
        notify_agents = channel_agents - {message.source_id}

        logger.info(f"Channel {channel} has agents: {channel_agents}")
        logger.info(f"Message sender: {message.source_id}")
        logger.info(f"Agents to notify: {notify_agents}")

        if not notify_agents:
            logger.warning(
                f"No other agents to notify in channel {channel} - only sender {message.source_id} present"
            )
            return

        logger.info(
            f"Broadcasting channel message to {len(notify_agents)} agents in {channel}: {notify_agents}"
        )

        # Create a mod message to notify other agents about the new channel message
        for agent_id in notify_agents:
            logger.info(
                f"🔧 THREAD MESSAGING: Creating notification for agent: {agent_id}"
            )

            # Extract payload from original message and add notification metadata
            original_payload = message.payload or {}
            notification_payload = original_payload.copy()
            notification_payload["channel"] = channel
            notification_payload["original_event_id"] = message.event_id  # Store original for reference

            # Note: Don't reuse event_id from original message - each notification needs
            # a unique event_id to avoid being deduplicated by event gateway
            notification = Event(
                event_name="thread.channel_message.notification",
                source_id=message.source_id,  # Keep original sender
                timestamp=message.timestamp,  # Keep original timestamp
                payload=notification_payload,
                direction="inbound",
                destination_id=agent_id,
            )
            logger.info(
                f"🔧 THREAD MESSAGING: Notification target_id will be: {notification.destination_id}"
            )
            logger.info(
                f"🔧 THREAD MESSAGING: Notification content: {notification.content}"
            )

            try:
                await self.network.process_event(notification)
                logger.info(
                    f"✅ THREAD MESSAGING: Sent channel message notification to agent {agent_id}"
                )
            except Exception as e:
                logger.error(
                    f"❌ THREAD MESSAGING: Failed to send channel message notification to {agent_id}: {e}"
                )
                import traceback

                traceback.print_exc()

    async def _process_direct_message(self, message: Event) -> None:
        """Process a direct message.

        Args:
            message: The direct message to process
        """
        # Get target agent ID from the message
        target_agent_id = None
        if message.destination_id:
            target_agent_id = message.destination_id
        else:
            # Try to extract from nested content
            if hasattr(message, "payload") and message.payload:
                if isinstance(message.payload, dict):
                    target_agent_id = message.payload.get("target_agent_id")

        if not target_agent_id:
            logger.warning(f"Direct message missing target_agent_id: {message}")
            return

        # Send notification to target agent
        logger.info(
            f"🔧 THREAD MESSAGING: Processing direct message from {message.source_id} to {target_agent_id}"
        )

        try:
            from openagents.models.event import Event as EventModel

            # Create direct message notification with flat payload structure
            original_payload = message.payload or {}
            notification_payload = original_payload.copy()
            notification_payload["sender_id"] = message.source_id

            notification = EventModel(
                event_name="thread.direct_message.notification",
                source_id=message.source_id,  # Keep original sender
                payload=notification_payload,
                destination_id=target_agent_id,
            )

            await self.network.process_event(notification)
            logger.info(
                f"✅ THREAD MESSAGING: Sent direct message notification to agent {target_agent_id}"
            )

        except Exception as e:
            logger.error(
                f"❌ THREAD MESSAGING: Failed to send direct message notification to {target_agent_id}: {e}"
            )
            import traceback

            traceback.print_exc()

    async def _send_reply_notifications(
        self, reply_message: Event, original_message: Event
    ) -> None:
        """Send notifications about a reply to interested parties.

        Args:
            reply_message: The reply message event
            original_message: The original message being replied to
        """
        try:
            # Determine who should be notified about this reply
            notify_agents = set()

            # Always notify the original message author (unless they're the one replying)
            if original_message.source_id != reply_message.source_id:
                notify_agents.add(original_message.source_id)

            # If this is a channel reply, notify channel members
            if reply_message.payload and "channel" in reply_message.payload:
                channel = reply_message.payload["channel"]
                if channel in self.channels:
                    # Get channel members from EventGateway (single source of truth)
                    channel_members = self.network.event_gateway.get_channel_members(
                        channel
                    )
                    notify_agents.update(channel_members)

                    # Remove the reply sender (they already know they sent it)
                    notify_agents.discard(reply_message.source_id)

            # If this is a direct message reply, notify the target agent
            if (
                original_message.payload
                and "target_agent_id" in original_message.payload
            ):
                target_agent = original_message.payload["target_agent_id"]
                if target_agent != reply_message.source_id:
                    notify_agents.add(target_agent)

            logger.info(
                f"🔧 THREAD MESSAGING: Sending reply notifications to {len(notify_agents)} agents: {notify_agents}"
            )

            # Send notifications to each interested agent
            for agent_id in notify_agents:
                logger.info(
                    f"🔧 THREAD MESSAGING: Creating reply notification for agent: {agent_id}"
                )

                # Create notification with flat payload structure
                original_payload = reply_message.payload or {}
                notification_payload = original_payload.copy()
                notification_payload["original_message_id"] = original_message.event_id
                notification_payload["original_sender"] = original_message.source_id
                notification_payload["reply_event_id"] = reply_message.event_id  # Store original for reference

                # Note: Don't reuse event_id from reply message - each notification needs
                # a unique event_id to avoid being deduplicated by event gateway
                notification = Event(
                    event_name="thread.reply.notification",
                    source_id=reply_message.source_id,  # Keep original reply sender
                    timestamp=reply_message.timestamp,  # Keep original timestamp
                    payload=notification_payload,
                    direction="inbound",
                    destination_id=agent_id,
                )

                try:
                    await self.network.process_event(notification)
                    logger.info(
                        f"✅ THREAD MESSAGING: Sent reply notification to agent {agent_id}"
                    )
                except Exception as e:
                    logger.error(
                        f"❌ THREAD MESSAGING: Failed to send reply notification to {agent_id}: {e}"
                    )
                    import traceback

                    traceback.print_exc()

        except Exception as e:
            logger.error(
                f"❌ THREAD MESSAGING: Error in _send_reply_notifications: {e}"
            )
            import traceback

            traceback.print_exc()

    async def _process_reply_message(self, message: Event) -> None:
        """Process a reply message and manage thread creation/updates.

        Args:
            message: The reply message event to process
        """
        reply_to_id = ReplyMessage.get_reply_to_id(message)

        # Check if the original message exists
        if reply_to_id not in self.message_history:
            logger.warning(
                f"Cannot create reply thread: original message {reply_to_id} not found. "
                f"Reply will still be broadcast to channel members."
            )
            # Even if we can't create the thread structure, we should still
            # broadcast the reply to channel members so they receive it in real-time
            if message.payload and "channel" in message.payload:
                await self._broadcast_channel_message(message)
            return

        original_message = self.message_history[reply_to_id]

        # Check if the original message is already part of a thread
        if reply_to_id in self.message_to_thread:
            # Add to existing thread
            thread_id = self.message_to_thread[reply_to_id]
            thread = self.threads[thread_id]
            if thread.add_reply(message):
                self.message_to_thread[message.event_id] = thread_id
                logger.debug(f"Added reply to existing thread {thread_id}")
            else:
                logger.warning(f"Could not add reply - max nesting level reached")
        else:
            # Create new thread with original message as root
            thread = MessageThread(reply_to_id, original_message)
            if thread.add_reply(message):
                self.threads[thread.thread_id] = thread
                self.message_to_thread[reply_to_id] = thread.thread_id
                self.message_to_thread[message.event_id] = thread.thread_id

                # Track thread in channel if applicable
                if original_message.payload and "channel" in original_message.payload:
                    channel = original_message.payload["channel"]
                    if channel in self.channels:
                        self.channels[channel]["thread_count"] += 1

                logger.debug(
                    f"Created new thread {thread.thread_id} for message {reply_to_id}"
                )
            else:
                logger.warning(f"Could not create thread - max nesting level reached")

        # Send reply notifications to interested parties
        await self._send_reply_notifications(message, original_message)

    async def _process_file_upload(self, message: Event) -> Dict[str, Any]:
        """Process a file upload request.

        Args:
            message: The file upload message

        Returns:
            Dict[str, Any]: File upload response data
        """
        file_id = str(uuid.uuid4())

        # Save file to storage
        file_path = self.file_storage_path / file_id

        try:
            # Decode and save file
            file_content = base64.b64decode(FileUploadMessage.get_file_content(message))
            with open(file_path, "wb") as f:
                f.write(file_content)

            # Store file metadata
            self.files[file_id] = {
                "file_id": file_id,
                "filename": FileUploadMessage.get_filename(message),
                "mime_type": FileUploadMessage.get_mime_type(message),
                "size": FileUploadMessage.get_file_size(message),
                "uploaded_by": message.source_id,
                "upload_timestamp": message.timestamp,
                "path": str(file_path),
            }

            # Persist file metadata to storage
            self._save_file_metadata()

            logger.info(
                f"File uploaded: {FileUploadMessage.get_filename(message)} -> {file_id}"
            )

            # Return response data instead of sending event
            return {
                "success": True,
                "file_id": file_id,
                "filename": FileUploadMessage.get_filename(message),
                "request_id": self._get_request_id(message),
            }

        except Exception as e:
            logger.error(f"File upload failed: {e}")
            # Return error response data instead of sending event
            return {
                "success": False,
                "error": str(e),
                "request_id": self._get_request_id(message),
            }

    async def _process_file_operation(self, message: Event) -> Dict[str, Any]:
        """Process file operations like download.

        Args:
            message: The file operation message

        Returns:
            Dict[str, Any]: File operation response data
        """
        # File operations are now handled based on specific event patterns
        # This method assumes download operation since thread.file.download events route here
        return await self._handle_file_download(
            message.source_id, FileOperationMessage.get_file_id(message), message
        )

    async def _handle_file_download(
        self, agent_id: str, file_id: str, request_message: Event
    ) -> Dict[str, Any]:
        """Handle a file download request.

        Args:
            agent_id: ID of the requesting agent
            file_id: UUID of the file to download
            request_message: The original request message

        Returns:
            Dict[str, Any]: File download response data
        """
        if file_id not in self.files:
            # File not found
            return {
                "success": False,
                "error": "File not found",
                "request_id": request_message.event_id,
            }

        file_info = self.files[file_id]
        file_path = Path(file_info["path"])

        if not file_path.exists():
            # File deleted from storage
            return {
                "success": False,
                "error": "File no longer available",
                "request_id": request_message.event_id,
            }

        try:
            # Read and encode file
            with open(file_path, "rb") as f:
                file_content = f.read()

            encoded_content = base64.b64encode(file_content).decode("utf-8")

            logger.debug(f"Sent file {file_id} to agent {agent_id}")

            # Return file content data
            return {
                "success": True,
                "file_id": file_id,
                "filename": file_info["filename"],
                "mime_type": file_info["mime_type"],
                "content": encoded_content,
                "request_id": request_message.event_id,
            }

        except Exception as e:
            logger.error(f"File download failed: {e}")
            # Return error response data
            return {
                "success": False,
                "error": str(e),
                "request_id": request_message.event_id,
            }

    def _process_channel_info_request(self, message: Event) -> Dict[str, Any]:
        """Process a channel info request and return the data.

        Args:
            message: The channel info request message

        Returns:
            Dict[str, Any]: The channel info response data
        """
        # Channel info operations are now handled based on specific event patterns
        # Both thread.channels.info and thread.channels.list events route here
        channels_data = []
        for channel_name, channel_info in self.channels.items():
            agents_in_channel = self.network.event_gateway.get_channel_members(
                channel_name
            )
            channels_data.append(
                {
                    "name": channel_name,
                    "description": channel_info["description"],
                    "message_count": channel_info["message_count"],
                    "thread_count": channel_info["thread_count"],
                    "agents": agents_in_channel,
                    "agent_count": len(agents_in_channel),
                }
            )

        return {
            "success": True,
            "channels": channels_data,
            "request_id": self._get_request_id(message),
        }

    def _process_message_retrieval_request(self, message: Event) -> Dict[str, Any]:
        """Process a message retrieval request and return the data.

        Args:
            message: The message retrieval request

        Returns:
            Dict[str, Any]: The message retrieval response data
        """
        # Message retrieval operations are now handled based on specific event patterns
        # Route to appropriate handler based on event name
        if hasattr(message, "event_name"):
            if "direct_messages" in message.event_name:
                return self._handle_direct_messages_retrieval(message)
            else:
                # Default to channel messages for thread.messages.retrieve and thread.channel_messages.retrieve
                return self._handle_channel_messages_retrieval(message)
        else:
            # Fallback for legacy calls without event_name
            return self._handle_channel_messages_retrieval(message)

    def _handle_channel_messages_retrieval(self, message: Event) -> Dict[str, Any]:
        """Handle channel messages retrieval request and return the data.

        Args:
            message: The retrieval request message

        Returns:
            Dict[str, Any]: The channel messages retrieval response data
        """
        channel = MessageRetrievalMessage.get_channel(message)
        limit = MessageRetrievalMessage.get_limit(message)
        offset = MessageRetrievalMessage.get_offset(message)
        include_threads = MessageRetrievalMessage.get_include_threads(message)

        if not channel:
            return {
                "success": False,
                "error": "Channel name is required",
                "request_id": self._get_request_id(message),
            }

        if channel not in self.channels:
            return {
                "success": False,
                "error": f"Channel '{channel}' not found",
                "request_id": self._get_request_id(message),
            }

        # Find channel messages
        channel_messages = []
        for msg_id, msg in self.message_history.items():
            # Check if this is a channel message for the requested channel
            # Handle both Event objects and ChannelMessage objects for backward compatibility
            is_channel_message = False
            msg_channel = None

            if isinstance(msg, Event):
                # For Event objects, check the payload for channel information
                if msg.payload and "channel" in msg.payload:
                    msg_channel = msg.payload["channel"]
                    # Also check if it's a channel message type
                    message_type = msg.payload.get("message_type", "")
                    is_channel_message = msg_channel == channel and (
                        "channel" in message_type
                        or message_type == "channel_message"
                        or message_type == "reply"
                        or message_type == "reply_message"
                    )
                elif msg.event_name and "channel" in msg.event_name:
                    # Check for channel-related events
                    is_channel_message = True
                    # Try to extract channel from destination_id if available
                    if msg.destination_id and msg.destination_id.startswith("channel:"):
                        msg_channel = msg.destination_id.split(":", 1)[1]
                    else:
                        msg_channel = channel  # Assume it's the requested channel

            else:
                # For backward compatibility with ChannelMessage objects
                from .thread_messages import ChannelMessage

                if isinstance(msg, ChannelMessage) and msg.channel == channel:
                    is_channel_message = True
                    msg_channel = msg.channel

            if is_channel_message and msg_channel == channel:
                # Extract message data based on the type of object
                if isinstance(msg, Event):
                    # For Event objects, convert to the expected message format
                    # Extract content (text and files) from payload
                    content_data = self._extract_content_from_event(msg)

                    msg_data = {
                        "message_id": msg.event_id,
                        "sender_id": msg.source_id,
                        "timestamp": msg.timestamp,
                        "content": content_data,
                        "channel": msg_channel,
                        "message_type": (
                            msg.payload.get("message_type", "channel_message")
                            if msg.payload
                            else "channel_message"
                        ),
                        "reply_to_id": (
                            msg.payload.get("reply_to_id") if msg.payload else None
                        ),
                        "thread_level": (
                            msg.payload.get("thread_level", 1) if msg.payload else 1
                        ),
                        "quoted_message_id": (
                            msg.payload.get("quoted_message_id")
                            if msg.payload
                            else None
                        ),
                        "quoted_text": (
                            msg.payload.get("quoted_text") if msg.payload else None
                        ),
                    }
                else:
                    # For ChannelMessage objects, use the existing model_dump
                    msg_data = msg.model_dump()

                msg_data["thread_info"] = None

                # Add thread information if this message is part of a thread
                if include_threads and msg_id in self.message_to_thread:
                    thread_id = self.message_to_thread[msg_id]
                    thread = self.threads[thread_id]
                    msg_data["thread_info"] = {
                        "thread_id": thread_id,
                        "is_root": (msg_id == thread.root_message_id),
                        "thread_structure": (
                            thread.get_thread_structure() if include_threads else None
                        ),
                    }

                # Add reactions to the message
                msg_reactions = msg.payload.get("reactions", {}) if msg.payload else {}
                msg_data["reactions"] = {
                    reaction_type: len(agents)
                    for reaction_type, agents in msg_reactions.items()
                    if agents  # Only include reactions with at least one agent
                }

                channel_messages.append(msg_data)

            # Also include replies if they're in this channel
            elif (
                include_threads
                and isinstance(msg, ReplyMessage)
                and msg.channel == channel
            ):
                msg_data = msg.model_dump()
                msg_data["thread_info"] = None

                if msg_id in self.message_to_thread:
                    thread_id = self.message_to_thread[msg_id]
                    msg_data["thread_info"] = {
                        "thread_id": thread_id,
                        "is_root": False,
                        "thread_level": msg.thread_level,
                    }

                # Add reactions to the reply message
                msg_reactions = msg.payload.get("reactions", {}) if msg.payload else {}
                msg_data["reactions"] = {
                    reaction_type: len(agents)
                    for reaction_type, agents in msg_reactions.items()
                    if agents  # Only include reactions with at least one agent
                }

                channel_messages.append(msg_data)

        # Sort by timestamp (newest first - reverse chronological order)
        channel_messages.sort(key=lambda x: x.get("timestamp", 0), reverse=True)

        # Apply pagination
        total_count = len(channel_messages)
        paginated_messages = channel_messages[offset : offset + limit]

        logger.debug(
            f"Retrieved {len(paginated_messages)} channel messages for {channel}"
        )

        return {
            "success": True,
            "channel": channel,
            "messages": paginated_messages,
            "total_count": total_count,
            "offset": offset,
            "limit": limit,
            "has_more": (offset + limit) < total_count,
            "request_id": self._get_request_id(message),
        }

    def _handle_direct_messages_retrieval(self, message: Event) -> Dict[str, Any]:
        """Handle direct messages retrieval request and return the data.

        Args:
            message: The retrieval request message

        Returns:
            Dict[str, Any]: The direct messages retrieval response data
        """
        target_agent_id = MessageRetrievalMessage.get_target_agent_id(message)
        agent_id = message.source_id
        limit = MessageRetrievalMessage.get_limit(message)
        offset = MessageRetrievalMessage.get_offset(message)
        include_threads = MessageRetrievalMessage.get_include_threads(message)

        if not target_agent_id:
            return {
                "success": False,
                "error": "Target agent ID is required",
                "request_id": self._get_request_id(message),
            }

        # Find direct messages between the two agents
        direct_messages = []
        logger.debug(
            f"Direct message retrieval: Looking for messages between {agent_id} and {target_agent_id}"
        )
        logger.debug(f"Total messages in history: {len(self.message_history)}")

        for msg_id, msg in self.message_history.items():
            # Check if this is a direct message between the agents
            # Direct messages have target_agent_id in payload and destination_id like "agent:X"
            is_direct_message = (
                msg.payload
                and "target_agent_id" in msg.payload
                and msg.destination_id
                and msg.destination_id.startswith("agent:")
            )

            if is_direct_message:
                payload_target = msg.payload["target_agent_id"]
                # Check if this message is between the requesting agents
                is_direct_msg_between_agents = (
                    msg.source_id == agent_id and payload_target == target_agent_id
                ) or (msg.source_id == target_agent_id and payload_target == agent_id)
                if is_direct_msg_between_agents:
                    logger.debug(
                        f"Found direct message: {msg_id} from {msg.source_id} to {payload_target}"
                    )
            else:
                is_direct_msg_between_agents = False

            if is_direct_msg_between_agents:
                msg_data = msg.model_dump()
                msg_data["thread_info"] = None

                # Add thread information if this message is part of a thread
                if include_threads and msg_id in self.message_to_thread:
                    thread_id = self.message_to_thread[msg_id]
                    thread = self.threads[thread_id]
                    msg_data["thread_info"] = {
                        "thread_id": thread_id,
                        "is_root": (msg_id == thread.root_message_id),
                        "thread_structure": (
                            thread.get_thread_structure() if include_threads else None
                        ),
                    }

                # Add reactions to the direct message
                msg_reactions = msg.payload.get("reactions", {}) if msg.payload else {}
                msg_data["reactions"] = {
                    reaction_type: len(agents)
                    for reaction_type, agents in msg_reactions.items()
                    if agents  # Only include reactions with at least one agent
                }

                direct_messages.append(msg_data)

            # Also include replies if they're between these agents
            elif (
                include_threads and isinstance(msg, ReplyMessage) and msg.destination_id
            ):
                is_reply_between_agents = (
                    msg.source_id == agent_id and msg.destination_id == target_agent_id
                ) or (
                    msg.source_id == target_agent_id and msg.destination_id == agent_id
                )

                if is_reply_between_agents:
                    msg_data = msg.model_dump()
                    msg_data["thread_info"] = None

                    if msg_id in self.message_to_thread:
                        thread_id = self.message_to_thread[msg_id]
                        msg_data["thread_info"] = {
                            "thread_id": thread_id,
                            "is_root": False,
                            "thread_level": msg.thread_level,
                        }

                    # Add reactions to the reply message
                    msg_reactions = (
                        msg.payload.get("reactions", {}) if msg.payload else {}
                    )
                    msg_data["reactions"] = {
                        reaction_type: len(agents)
                        for reaction_type, agents in msg_reactions.items()
                        if agents  # Only include reactions with at least one agent
                    }

                    direct_messages.append(msg_data)

        # Sort by timestamp (oldest first - chronological order)
        direct_messages.sort(key=lambda x: x.get("timestamp", 0), reverse=False)

        # Apply pagination
        total_count = len(direct_messages)
        paginated_messages = direct_messages[offset : offset + limit]

        logger.debug(
            f"Retrieved {len(paginated_messages)} direct messages with {target_agent_id}"
        )

        return {
            "success": True,
            "target_agent_id": target_agent_id,
            "messages": paginated_messages,
            "total_count": total_count,
            "offset": offset,
            "limit": limit,
            "has_more": (offset + limit) < total_count,
            "request_id": self._get_request_id(message),
        }

    async def _process_add_reaction(self, message: Event) -> Dict[str, Any]:
        """Process adding a reaction to a message."""
        target_message_id = ReactionMessage.get_target_message_id(message)
        reaction_type = ReactionMessage.get_reaction_type(message)
        agent_id = message.source_id

        # Validate target message exists
        validation_error = self._validate_reaction_target(target_message_id, message)
        if validation_error:
            return validation_error

        # Get the target message and modify its payload directly
        target_message = self.message_history[target_message_id]

        # Initialize payload and reactions if they don't exist
        if not target_message.payload:
            target_message.payload = {}
        if "reactions" not in target_message.payload:
            target_message.payload["reactions"] = {}
        if reaction_type not in target_message.payload["reactions"]:
            target_message.payload["reactions"][reaction_type] = []

        success = False
        if agent_id not in target_message.payload["reactions"][reaction_type]:
            # Add reaction directly to the target message payload
            target_message.payload["reactions"][reaction_type].append(agent_id)
            success = True
            logger.debug(
                f"{agent_id} added {reaction_type} reaction to message {target_message_id}"
            )

            # Send notification to relevant agents
            await self._send_reaction_notification(
                target_message_id, reaction_type, agent_id, "added"
            )
        else:
            logger.debug(
                f"{agent_id} already has {reaction_type} reaction on message {target_message_id}"
            )

        return self._create_reaction_response(
            target_message_id, reaction_type, "add", success, message
        )

    async def _process_remove_reaction(self, message: Event) -> Dict[str, Any]:
        """Process removing a reaction from a message."""
        target_message_id = ReactionMessage.get_target_message_id(message)
        reaction_type = ReactionMessage.get_reaction_type(message)
        agent_id = message.source_id

        # Validate target message exists
        validation_error = self._validate_reaction_target(target_message_id, message)
        if validation_error:
            return validation_error

        # Get the target message and modify its payload directly
        target_message = self.message_history[target_message_id]

        success = False
        if (
            target_message.payload
            and "reactions" in target_message.payload
            and reaction_type in target_message.payload["reactions"]
            and agent_id in target_message.payload["reactions"][reaction_type]
        ):

            # Remove reaction directly from the target message payload
            target_message.payload["reactions"][reaction_type].remove(agent_id)
            success = True
            logger.debug(
                f"{agent_id} removed {reaction_type} reaction from message {target_message_id}"
            )

            # Clean up empty reaction lists
            if not target_message.payload["reactions"][reaction_type]:
                del target_message.payload["reactions"][reaction_type]

            # Clean up empty reactions dict
            if not target_message.payload["reactions"]:
                del target_message.payload["reactions"]

            # Send notification to relevant agents
            await self._send_reaction_notification(
                target_message_id, reaction_type, agent_id, "removed"
            )
        else:
            logger.debug(
                f"{agent_id} doesn't have {reaction_type} reaction on message {target_message_id}"
            )

        return self._create_reaction_response(
            target_message_id, reaction_type, "remove", success, message
        )

    async def _process_toggle_reaction(self, message: Event) -> Dict[str, Any]:
        """Process toggling a reaction on a message."""
        target_message_id = ReactionMessage.get_target_message_id(message)
        reaction_type = ReactionMessage.get_reaction_type(message)
        agent_id = message.source_id

        # Validate target message exists
        validation_error = self._validate_reaction_target(target_message_id, message)
        if validation_error:
            return validation_error

        # Get the target message and modify its payload directly
        target_message = self.message_history[target_message_id]

        # Initialize payload and reactions if they don't exist
        if not target_message.payload:
            target_message.payload = {}
        if "reactions" not in target_message.payload:
            target_message.payload["reactions"] = {}
        if reaction_type not in target_message.payload["reactions"]:
            target_message.payload["reactions"][reaction_type] = []

        # Check current state to determine toggle action
        if agent_id in target_message.payload["reactions"][reaction_type]:
            # Remove reaction
            target_message.payload["reactions"][reaction_type].remove(agent_id)
            action_taken = "remove"
            logger.debug(
                f"{agent_id} toggled (removed) {reaction_type} reaction from message {target_message_id}"
            )

            # Clean up empty reaction lists
            if not target_message.payload["reactions"][reaction_type]:
                del target_message.payload["reactions"][reaction_type]

            # Clean up empty reactions dict
            if not target_message.payload["reactions"]:
                del target_message.payload["reactions"]

            # Send notification to relevant agents
            await self._send_reaction_notification(
                target_message_id, reaction_type, agent_id, "removed"
            )
        else:
            # Add reaction
            target_message.payload["reactions"][reaction_type].append(agent_id)
            action_taken = "add"
            logger.debug(
                f"{agent_id} toggled (added) {reaction_type} reaction to message {target_message_id}"
            )

            # Send notification to relevant agents
            await self._send_reaction_notification(
                target_message_id, reaction_type, agent_id, "added"
            )

        return self._create_reaction_response(
            target_message_id, reaction_type, action_taken, True, message
        )

    def get_state(self) -> Dict[str, Any]:
        """Get the current state of the Thread Messaging protocol.

        Returns:
            Dict[str, Any]: Current protocol state
        """
        # Count files in storage
        file_count = len(self.files)

        return {
            "active_agents": len(self.active_agents),
            "message_history_size": len(self.message_history),
            "thread_count": len(self.threads),
            "channel_count": len(self.channels),
            "channels": list(self.channels.keys()),
            "stored_files": file_count,
            "file_storage_path": str(self.file_storage_path),
        }

    def _add_to_history(self, message: Event) -> None:
        """Add a message to the history with enhanced memory management.

        Args:
            message: The message to add
        """
        self.message_history[message.event_id] = message

        # Check if we need periodic dump using helper
        if self.storage_helper.should_perform_dump():
            self.storage_helper.periodic_dump(self.message_history)

        # Check if we need memory cleanup using helper
        if self.storage_helper.should_perform_memory_cleanup():
            removed_ids = self.storage_helper.cleanup_old_memory(
                self.message_history, self.message_to_thread, self.threads
            )
            logger.debug(f"Cleaned up {len(removed_ids)} messages from memory")

        # Check if we need archive cleanup using helper
        if self.storage_helper.should_perform_archive_cleanup():
            self.storage_helper.cleanup_expired_archives()

        # Immediate cleanup if memory is full using helper
        removed_ids = self.storage_helper.cleanup_excess_messages(self.message_history)
        # Clean up thread references for removed messages (if any were removed)
        for msg_id in removed_ids:
            if msg_id in self.message_to_thread:
                del self.message_to_thread[msg_id]

        # Periodic persistence to storage (keep existing logic for compatibility)
        self._message_count_since_save += 1
        if self._message_count_since_save >= self._save_interval:
            self._save_message_history()
            self._message_count_since_save = 0

    def _periodic_dump(self):
        """Dump current in-memory data periodically to prevent data loss. [DEPRECATED - use storage helper]"""
        self.storage_helper.periodic_dump(self.message_history)

    def _cleanup_old_dumps(self):
        """Remove dump files older than 24 hours. [DEPRECATED - use storage helper]"""
        self.storage_helper.cleanup_old_dumps()

    def _cleanup_old_memory(self):
        """Clean up old messages from memory based on time and count. [DEPRECATED - use storage helper]"""
        removed_ids = self.storage_helper.cleanup_old_memory(
            self.message_history, self.message_to_thread, self.threads
        )
        return removed_ids

    def _cleanup_excess_messages(self):
        """Emergency cleanup when memory limit is exceeded. [DEPRECATED - use storage helper]"""
        removed_ids = self.storage_helper.cleanup_excess_messages(self.message_history)
        return removed_ids

    def _archive_messages_by_date(self, message_ids: List[str]):
        """Archive specific messages to daily files before removing from memory. [DEPRECATED - use storage helper]"""
        self.storage_helper.archive_messages_by_date(message_ids, self.message_history)

    def _cleanup_expired_archives(self):
        """Remove archived files older than retention policy. [DEPRECATED - use storage helper]"""
        self.storage_helper.cleanup_expired_archives()

    def _extract_text_from_event(self, event: Event) -> str:
        """Extract text content from an Event object's payload.

        This handles the nested content structure: payload.content.text

        Args:
            event: The Event object to extract text from

        Returns:
            The extracted text content, or empty string if not found
        """
        if not event or not event.payload:
            return ""

        # Handle nested content structure (payload.content.text)
        if "content" in event.payload and isinstance(event.payload["content"], dict):
            return event.payload["content"].get("text", "")
        else:
            return ""

    def _extract_content_from_event(self, event: Event) -> Dict[str, Any]:
        """Extract full content (text and files) from an Event object's payload.

        This handles the nested content structure: payload.content

        Args:
            event: The Event object to extract content from

        Returns:
            Dict with text and optionally files
        """
        if not event or not event.payload:
            return {"text": ""}

        # Handle nested content structure (payload.content)
        if "content" in event.payload and isinstance(event.payload["content"], dict):
            content = event.payload["content"]
            result = {"text": content.get("text", "")}

            # Include files if present
            if "files" in content and content["files"]:
                result["files"] = content["files"]

            return result
        else:
            return {"text": ""}

    def _get_quoted_text(self, quoted_message_id: str) -> str:
        """Get the text content of a quoted message with author information.

        Args:
            quoted_message_id: The ID of the message being quoted

        Returns:
            The text content of the quoted message with author, or a fallback string if not found
        """
        if quoted_message_id in self.message_history:
            quoted_message = self.message_history[quoted_message_id]

            # Extract text content based on message type (Event object vs direct content)
            if isinstance(quoted_message, Event):
                # For Event objects, use the helper function
                text = self._extract_text_from_event(quoted_message)
                author = getattr(quoted_message, "source_id", "Unknown")
            elif hasattr(quoted_message, "content") and isinstance(
                quoted_message.content, dict
            ):
                # Legacy: Direct content access
                text = quoted_message.content.get("text", "")
                author = getattr(quoted_message, "sender_id", "Unknown")
            else:
                text = ""
                author = getattr(
                    quoted_message,
                    "sender_id",
                    getattr(quoted_message, "source_id", "Unknown"),
                )

            # Truncate long quotes
            if len(text) > 100:
                text = f"{text[:100]}..."

            # Format: "Author: quoted text"
            return f"{author}: {text}"
        else:
            return f"[Quoted message {quoted_message_id} not found]"

    @mod_event_handler("thread.announcement.set")
    async def _handle_announcement_set(self, event: Event) -> Optional[EventResponse]:
        """Handle setting a channel announcement.
        
        Only agents in the admin agent group can execute this.
        
        Args:
            event: The announcement set event
            
        Returns:
            EventResponse: success=False with "forbidden" if not admin,
                         success=True with "ok" if successful
        """
        agent_id = event.source_id
        
        # Check if agent is in admin group
        agent_group = self.network.topology.agent_group_membership.get(agent_id)
        if agent_group != "admin":
            logger.warning(f"Agent {agent_id} (group: {agent_group}) attempted to set announcement but is not admin")
            return EventResponse(
                success=False,
                message="forbidden",
                data={"error": "Only admin agents can set announcements"}
            )
        
        # Extract channel and text from payload
        channel = event.payload.get("channel", "") if event.payload else ""
        text = event.payload.get("text", "") if event.payload else ""
        
        if not channel:
            return EventResponse(
                success=False,
                message="Channel name is required",
                data={"error": "Channel name is required"}
            )
        
        # Save announcement
        self.channel_announcements[channel] = text
        logger.info(f"Admin {agent_id} set announcement for channel {channel}: {text[:50]}...")
        
        return EventResponse(
            success=True,
            message="ok",
            data={"channel": channel, "text": text}
        )
    
    @mod_event_handler("thread.announcement.get")
    async def _handle_announcement_get(self, event: Event) -> Optional[EventResponse]:
        """Handle getting a channel announcement.
        
        Any agent can retrieve announcements.
        
        Args:
            event: The announcement get event
            
        Returns:
            EventResponse: success=True with "ok" and text field containing
                         the announcement (or empty string if not set)
        """
        # Extract channel from payload
        channel = event.payload.get("channel", "") if event.payload else ""
        
        if not channel:
            return EventResponse(
                success=False,
                message="Channel name is required",
                data={"error": "Channel name is required", "text": ""}
            )
        
        # Retrieve announcement (empty string if not set)
        text = self.channel_announcements.get(channel, "")
        
        logger.debug(f"Agent {event.source_id} retrieved announcement for channel {channel}")
        
        return EventResponse(
            success=True,
            message="ok",
            data={"channel": channel, "text": text}
        )
