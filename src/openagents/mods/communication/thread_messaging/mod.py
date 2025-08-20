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
import tempfile
import time
from typing import Dict, Any, List, Optional, Set
from pathlib import Path

from openagents.core.base_mod import BaseMod
from openagents.models.messages import BaseMessage, ModMessage
from .thread_messages import (
    DirectMessage,
    ChannelMessage, 
    ReplyMessage,
    FileUploadMessage,
    FileOperationMessage,
    ChannelInfoMessage,
    MessageRetrievalMessage,
    ReactionMessage
)

logger = logging.getLogger(__name__)

class MessageThread:
    """Represents a conversation thread with Reddit-like nesting."""
    
    def __init__(self, root_message_id: str, root_message: BaseMessage):
        self.thread_id = str(uuid.uuid4())
        self.root_message_id = root_message_id
        self.root_message = root_message
        self.replies: Dict[str, List[BaseMessage]] = {}  # parent_id -> [replies]
        self.message_levels: Dict[str, int] = {root_message_id: 0}  # message_id -> level
        self.created_timestamp = root_message.timestamp
        
    def add_reply(self, reply: ReplyMessage) -> bool:
        """Add a reply to the thread."""
        parent_id = reply.reply_to_id
        
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
        self.message_levels[reply.message_id] = parent_level + 1
        reply.thread_level = parent_level + 1
        
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
                        if reply.message_id == message_id:
                            message = reply
                            break
            
            subtree = {
                "message": message.model_dump() if message else None,
                "level": self.message_levels.get(message_id, 0),
                "replies": []
            }
            
            if message_id in self.replies:
                for reply in self.replies[message_id]:
                    subtree["replies"].append(build_subtree(reply.message_id))
            
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
    
    def __init__(self, mod_name: str = "thread_messaging"):
        """Initialize the thread messaging mod for a network."""
        super().__init__(mod_name=mod_name)
        
        # Initialize mod state
        self.active_agents: Set[str] = set()
        self.message_history: Dict[str, BaseMessage] = {}  # message_id -> message
        self.threads: Dict[str, MessageThread] = {}  # thread_id -> MessageThread
        self.message_to_thread: Dict[str, str] = {}  # message_id -> thread_id
        self.reactions: Dict[str, Dict[str, Set[str]]] = {}  # message_id -> {reaction_type -> set of agent_ids}
        self.max_history_size = 2000  # Number of messages to keep in history
        
        # Channel management
        self.channels: Dict[str, Dict[str, Any]] = {}  # channel_name -> channel_info
        self.channel_agents: Dict[str, Set[str]] = {}  # channel_name -> {agent_ids}
        self.agent_channels: Dict[str, Set[str]] = {}  # agent_id -> {channel_names}
        
        # File management
        self.files: Dict[str, Dict[str, Any]] = {}  # file_id -> file_info
        
        # Initialize default channels
        self._initialize_default_channels()
        
        # Create a temporary directory for file storage
        self.temp_dir = tempfile.TemporaryDirectory(prefix="openagents_threads_")
        self.file_storage_path = Path(self.temp_dir.name)
        
        logger.info(f"Initializing Thread Messaging network mod with file storage at {self.file_storage_path}")
    
    def _initialize_default_channels(self) -> None:
        """Initialize default channels from configuration."""
        # Get channels from config or use default
        config_channels = self.config.get('default_channels', [
            {"name": "general", "description": "General discussion"},
            {"name": "development", "description": "Development discussions"},  
            {"name": "support", "description": "Support and help"}
        ])
        
        for channel_config in config_channels:
            if isinstance(channel_config, str):
                channel_name = channel_config
                description = f"Channel {channel_name}"
            else:
                channel_name = channel_config["name"]
                description = channel_config.get("description", f"Channel {channel_name}")
            
            self.channels[channel_name] = {
                'name': channel_name,
                'description': description,
                'created_timestamp': int(time.time() * 1000),
                'message_count': 0,
                'thread_count': 0
            }
            self.channel_agents[channel_name] = set()
        
        logger.info(f"Initialized channels: {list(self.channels.keys())}")
    
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
        self.reactions.clear()
        self.channels.clear()
        self.channel_agents.clear()
        self.agent_channels.clear()
        self.files.clear()
        
        # Clean up the temporary directory
        try:
            self.temp_dir.cleanup()
            logger.info("Cleaned up temporary file storage directory")
        except Exception as e:
            logger.error(f"Error cleaning up temporary directory: {e}")
        
        return True
    
    def handle_register_agent(self, agent_id: str, metadata: Dict[str, Any]) -> None:
        """Register an agent with the thread messaging protocol.
        
        Args:
            agent_id: Unique identifier for the agent
            metadata: Agent metadata including capabilities
        """
        self.active_agents.add(agent_id)
        
        # Add agent to all channels by default
        self.agent_channels[agent_id] = set()
        for channel_name in self.channels.keys():
            self.channel_agents[channel_name].add(agent_id)
            self.agent_channels[agent_id].add(channel_name)
        
        # Create agent-specific file storage directory
        agent_storage_path = self.file_storage_path / agent_id
        os.makedirs(agent_storage_path, exist_ok=True)
        
        logger.info(f"Registered agent {agent_id} with Thread Messaging protocol")
    
    def handle_unregister_agent(self, agent_id: str) -> None:
        """Unregister an agent from the thread messaging protocol.
        
        Args:
            agent_id: Unique identifier for the agent
        """
        if agent_id in self.active_agents:
            self.active_agents.remove(agent_id)
            
            # Remove from channels
            if agent_id in self.agent_channels:
                for channel_name in self.agent_channels[agent_id]:
                    if channel_name in self.channel_agents:
                        self.channel_agents[channel_name].discard(agent_id)
                del self.agent_channels[agent_id]
            
            logger.info(f"Unregistered agent {agent_id} from Thread Messaging protocol")
    
    async def process_direct_message(self, message: DirectMessage) -> Optional[DirectMessage]:
        """Process a direct message.
        
        Args:
            message: The direct message to process
            
        Returns:
            Optional[DirectMessage]: The processed message, or None if the message was handled
        """
        self._add_to_history(message)
        logger.debug(f"Processing direct message from {message.sender_id} to {message.target_agent_id}")
        return message
    
    async def process_broadcast_message(self, message) -> Optional[BaseMessage]:
        """Process broadcast messages (channel messages in our case).
        
        Args:
            message: The broadcast message to process
            
        Returns:
            Optional[BaseMessage]: The processed message, or None if the message was handled
        """
        if isinstance(message, ChannelMessage):
            await self._process_channel_message(message)
        
        return message
    
    async def process_mod_message(self, message: ModMessage) -> None:
        """Process a mod message.
        
        Args:
            message: The mod message to process
        """
        self._add_to_history(message)
        
        # Extract the inner message from the ModMessage content
        try:
            content = message.content
            message_type = content.get("message_type")
            
            if message_type == "reply_message":
                # Populate quoted_text if quoted_message_id is provided
                if 'quoted_message_id' in content and content['quoted_message_id']:
                    content['quoted_text'] = self._get_quoted_text(content['quoted_message_id'])
                inner_message = ReplyMessage(**content)
                await self._process_reply_message(inner_message)
            elif message_type == "file_upload":
                inner_message = FileUploadMessage(**content)
                await self._process_file_upload(inner_message)
            elif message_type == "file_operation":
                inner_message = FileOperationMessage(**content)
                await self._process_file_operation(inner_message)
            elif message_type == "channel_info" or message_type == "channel_info_message":
                inner_message = ChannelInfoMessage(**content)
                await self._process_channel_info_request(inner_message)
            elif message_type == "message_retrieval":
                inner_message = MessageRetrievalMessage(**content)
                await self._process_message_retrieval_request(inner_message)
            elif message_type == "reaction":
                inner_message = ReactionMessage(**content)
                await self._process_reaction_message(inner_message)
            elif message_type == "direct_message":
                # Populate quoted_text if quoted_message_id is provided
                if 'quoted_message_id' in content and content['quoted_message_id']:
                    content['quoted_text'] = self._get_quoted_text(content['quoted_message_id'])
                inner_message = DirectMessage(**content)
                await self._process_direct_message(inner_message)
            elif message_type == "channel_message":
                # Populate quoted_text if quoted_message_id is provided
                if 'quoted_message_id' in content and content['quoted_message_id']:
                    content['quoted_text'] = self._get_quoted_text(content['quoted_message_id'])
                inner_message = ChannelMessage(**content)
                await self._process_channel_message(inner_message)
            else:
                logger.warning(f"Unknown message type in mod message: {message_type}")
        except Exception as e:
            logger.error(f"Error processing mod message content: {e}")
            import traceback
            traceback.print_exc()
    
    async def _process_channel_message(self, message: ChannelMessage) -> None:
        """Process a channel message.
        
        Args:
            message: The channel message to process
        """
        self._add_to_history(message)
        
        # Track message in channel
        channel = message.channel
        if channel in self.channels:
            self.channels[channel]['message_count'] += 1
        else:
            logger.warning(f"Message sent to unknown channel: {channel}")
        
        logger.debug(f"Processing channel message from {message.sender_id} in {channel}")
    
    async def _process_direct_message(self, message: DirectMessage) -> None:
        """Process a direct message.
        
        Args:
            message: The direct message to process
        """
        self._add_to_history(message)
        logger.debug(f"Processing direct message from {message.sender_id} to {message.target_agent_id}")
    
    async def _process_reply_message(self, message: ReplyMessage) -> None:
        """Process a reply message and manage thread creation/updates.
        
        Args:
            message: The reply message to process
        """
        self._add_to_history(message)
        
        reply_to_id = message.reply_to_id
        
        # Check if the original message exists
        if reply_to_id not in self.message_history:
            logger.warning(f"Cannot create reply: original message {reply_to_id} not found")
            return
        
        original_message = self.message_history[reply_to_id]
        
        # Check if the original message is already part of a thread
        if reply_to_id in self.message_to_thread:
            # Add to existing thread
            thread_id = self.message_to_thread[reply_to_id]
            thread = self.threads[thread_id]
            if thread.add_reply(message):
                self.message_to_thread[message.message_id] = thread_id
                logger.debug(f"Added reply to existing thread {thread_id}")
            else:
                logger.warning(f"Could not add reply - max nesting level reached")
        else:
            # Create new thread with original message as root
            thread = MessageThread(reply_to_id, original_message)
            if thread.add_reply(message):
                self.threads[thread.thread_id] = thread
                self.message_to_thread[reply_to_id] = thread.thread_id
                self.message_to_thread[message.message_id] = thread.thread_id
                
                # Track thread in channel if applicable
                if hasattr(original_message, 'channel') and original_message.channel in self.channels:
                    self.channels[original_message.channel]['thread_count'] += 1
                
                logger.debug(f"Created new thread {thread.thread_id} for message {reply_to_id}")
            else:
                logger.warning(f"Could not create thread - max nesting level reached")
    
    async def _process_file_upload(self, message: FileUploadMessage) -> None:
        """Process a file upload request.
        
        Args:
            message: The file upload message
        """
        file_id = str(uuid.uuid4())
        
        # Save file to storage
        file_path = self.file_storage_path / file_id
        
        try:
            # Decode and save file
            file_content = base64.b64decode(message.file_content)
            with open(file_path, "wb") as f:
                f.write(file_content)
            
            # Store file metadata
            self.files[file_id] = {
                "file_id": file_id,
                "filename": message.filename,
                "mime_type": message.mime_type,
                "size": message.file_size,
                "uploaded_by": message.sender_id,
                "upload_timestamp": message.timestamp,
                "path": str(file_path)
            }
            
            # Send response with file UUID
            response = ModMessage(
                sender_id=self.network.network_id,
                mod="openagents.mods.communication.thread_messaging",
                content={
                    "action": "file_upload_response",
                    "success": True,
                    "file_id": file_id,
                    "filename": message.filename,
                    "request_id": message.message_id
                },
                direction="outbound",
                relevant_agent_id=message.sender_id
            )
            await self.network.send_message(response)
            
            logger.info(f"File uploaded: {message.filename} -> {file_id}")
        
        except Exception as e:
            # Send error response
            response = ModMessage(
                sender_id=self.network.network_id,
                mod="openagents.mods.communication.thread_messaging",
                content={
                    "action": "file_upload_response",
                    "success": False,
                    "error": str(e),
                    "request_id": message.message_id
                },
                direction="outbound",
                relevant_agent_id=message.sender_id
            )
            await self.network.send_message(response)
            logger.error(f"File upload failed: {e}")
    
    async def _process_file_operation(self, message: FileOperationMessage) -> None:
        """Process file operations like download.
        
        Args:
            message: The file operation message
        """
        action = message.action
        
        if action == "download":
            await self._handle_file_download(message.sender_id, message.file_id, message)
    
    async def _handle_file_download(self, agent_id: str, file_id: str, request_message: BaseMessage) -> None:
        """Handle a file download request.
        
        Args:
            agent_id: ID of the requesting agent
            file_id: UUID of the file to download
            request_message: The original request message
        """
        if file_id not in self.files:
            # File not found
            response = ModMessage(
                sender_id=self.network.network_id,
                mod="openagents.mods.communication.thread_messaging",
                content={
                    "action": "file_download_response",
                    "success": False,
                    "error": "File not found",
                    "request_id": request_message.message_id
                },
                direction="outbound",
                relevant_agent_id=agent_id
            )
            await self.network.send_message(response)
            return
        
        file_info = self.files[file_id]
        file_path = Path(file_info["path"])
        
        if not file_path.exists():
            # File deleted from storage
            response = ModMessage(
                sender_id=self.network.network_id,
                mod="openagents.mods.communication.thread_messaging",
                content={
                    "action": "file_download_response",
                    "success": False,
                    "error": "File no longer available",
                    "request_id": request_message.message_id
                },
                direction="outbound",
                relevant_agent_id=agent_id
            )
            await self.network.send_message(response)
            return
        
        try:
            # Read and encode file
            with open(file_path, "rb") as f:
                file_content = f.read()
            
            encoded_content = base64.b64encode(file_content).decode("utf-8")
            
            # Send file content
            response = ModMessage(
                sender_id=self.network.network_id,
                mod="openagents.mods.communication.thread_messaging",
                content={
                    "action": "file_download_response",
                    "success": True,
                    "file_id": file_id,
                    "filename": file_info["filename"],
                    "mime_type": file_info["mime_type"],
                    "content": encoded_content,
                    "request_id": request_message.message_id
                },
                direction="outbound",
                relevant_agent_id=agent_id
            )
            await self.network.send_message(response)
            
            logger.debug(f"Sent file {file_id} to agent {agent_id}")
        
        except Exception as e:
            # Send error response
            response = ModMessage(
                sender_id=self.network.network_id,
                mod="openagents.mods.communication.thread_messaging",
                content={
                    "action": "file_download_response",
                    "success": False,
                    "error": str(e),
                    "request_id": request_message.message_id
                },
                direction="outbound",
                relevant_agent_id=agent_id
            )
            await self.network.send_message(response)
            logger.error(f"File download failed: {e}")
    
    async def _process_channel_info_request(self, message: ChannelInfoMessage) -> None:
        """Process a channel info request.
        
        Args:
            message: The channel info request message
        """
        if message.action == "list_channels":
            channels_data = []
            for channel_name, channel_info in self.channels.items():
                agents_in_channel = list(self.channel_agents.get(channel_name, set()))
                channels_data.append({
                    'name': channel_name,
                    'description': channel_info['description'],
                    'message_count': channel_info['message_count'],
                    'thread_count': channel_info['thread_count'],
                    'agents': agents_in_channel,
                    'agent_count': len(agents_in_channel)
                })
            
            response = ModMessage(
                sender_id=self.network.network_id,
                mod="openagents.mods.communication.thread_messaging",
                content={
                    "action": "list_channels_response",
                    "success": True,
                    "channels": channels_data,
                    "request_id": message.message_id
                },
                direction="outbound",
                relevant_agent_id=message.sender_id
            )
            await self.network.send_message(response)
    
    async def _process_message_retrieval_request(self, message: MessageRetrievalMessage) -> None:
        """Process a message retrieval request.
        
        Args:
            message: The message retrieval request
        """
        action = message.action
        agent_id = message.sender_id
        
        if action == "retrieve_channel_messages":
            await self._handle_channel_messages_retrieval(message)
        elif action == "retrieve_direct_messages":
            await self._handle_direct_messages_retrieval(message)
    
    async def _handle_channel_messages_retrieval(self, message: MessageRetrievalMessage) -> None:
        """Handle channel messages retrieval request.
        
        Args:
            message: The retrieval request message
        """
        channel = message.channel
        agent_id = message.sender_id
        limit = message.limit
        offset = message.offset
        include_threads = message.include_threads
        
        if not channel:
            # Send error response
            response = ModMessage(
                sender_id=self.network.network_id,
                mod="openagents.mods.communication.thread_messaging",
                content={
                    "action": "retrieve_channel_messages_response",
                    "success": False,
                    "error": "Channel name is required",
                    "request_id": message.message_id
                },
                direction="outbound",
                relevant_agent_id=agent_id
            )
            await self.network.send_message(response)
            return
        
        if channel not in self.channels:
            # Send error response
            response = ModMessage(
                sender_id=self.network.network_id,
                mod="openagents.mods.communication.thread_messaging",
                content={
                    "action": "retrieve_channel_messages_response",
                    "success": False,
                    "error": f"Channel '{channel}' not found",
                    "request_id": message.message_id
                },
                direction="outbound",
                relevant_agent_id=agent_id
            )
            await self.network.send_message(response)
            return
        
        # Find channel messages
        channel_messages = []
        for msg_id, msg in self.message_history.items():
            # Check if this is a channel message for the requested channel
            if isinstance(msg, ChannelMessage) and msg.channel == channel:
                msg_data = msg.model_dump()
                msg_data['thread_info'] = None
                
                # Add thread information if this message is part of a thread
                if include_threads and msg_id in self.message_to_thread:
                    thread_id = self.message_to_thread[msg_id]
                    thread = self.threads[thread_id]
                    msg_data['thread_info'] = {
                        'thread_id': thread_id,
                        'is_root': (msg_id == thread.root_message_id),
                        'thread_structure': thread.get_thread_structure() if include_threads else None
                    }
                
                # Add reactions to the message
                if msg_id in self.reactions:
                    msg_data['reactions'] = {}
                    for reaction_type, agents in self.reactions[msg_id].items():
                        if agents:  # Only include reactions with at least one agent
                            msg_data['reactions'][reaction_type] = len(agents)
                else:
                    msg_data['reactions'] = {}
                
                channel_messages.append(msg_data)
            
            # Also include replies if they're in this channel
            elif include_threads and isinstance(msg, ReplyMessage) and msg.channel == channel:
                msg_data = msg.model_dump()
                msg_data['thread_info'] = None
                
                if msg_id in self.message_to_thread:
                    thread_id = self.message_to_thread[msg_id]
                    msg_data['thread_info'] = {
                        'thread_id': thread_id,
                        'is_root': False,
                        'thread_level': msg.thread_level
                    }
                
                # Add reactions to the reply message
                if msg_id in self.reactions:
                    msg_data['reactions'] = {}
                    for reaction_type, agents in self.reactions[msg_id].items():
                        if agents:  # Only include reactions with at least one agent
                            msg_data['reactions'][reaction_type] = len(agents)
                else:
                    msg_data['reactions'] = {}
                
                channel_messages.append(msg_data)
        
        # Sort by timestamp (newest first)
        channel_messages.sort(key=lambda x: x.get('timestamp', 0), reverse=True)
        
        # Apply pagination
        total_count = len(channel_messages)
        paginated_messages = channel_messages[offset:offset + limit]
        
        # Send response
        response = ModMessage(
            sender_id=self.network.network_id,
            mod="thread_messaging",
            content={
                "action": "retrieve_channel_messages_response",
                "success": True,
                "channel": channel,
                "messages": paginated_messages,
                "total_count": total_count,
                "offset": offset,
                "limit": limit,
                "has_more": (offset + limit) < total_count,
                "request_id": message.message_id
            },
            direction="outbound",
            relevant_agent_id=agent_id
        )
        await self.network.send_message(response)
        logger.debug(f"Sent {len(paginated_messages)} channel messages for {channel} to {agent_id}")
    
    async def _handle_direct_messages_retrieval(self, message: MessageRetrievalMessage) -> None:
        """Handle direct messages retrieval request.
        
        Args:
            message: The retrieval request message
        """
        target_agent_id = message.target_agent_id
        agent_id = message.sender_id
        limit = message.limit
        offset = message.offset
        include_threads = message.include_threads
        
        if not target_agent_id:
            # Send error response
            response = ModMessage(
                sender_id=self.network.network_id,
                mod="openagents.mods.communication.thread_messaging",
                content={
                    "action": "retrieve_direct_messages_response",
                    "success": False,
                    "error": "Target agent ID is required",
                    "request_id": message.message_id
                },
                direction="outbound",
                relevant_agent_id=agent_id
            )
            await self.network.send_message(response)
            return
        
        # Find direct messages between the two agents
        direct_messages = []
        for msg_id, msg in self.message_history.items():
            # Check if this is a direct message between the agents
            is_direct_msg_between_agents = (
                isinstance(msg, DirectMessage) and 
                ((msg.sender_id == agent_id and msg.target_agent_id == target_agent_id) or
                 (msg.sender_id == target_agent_id and msg.target_agent_id == agent_id))
            )
            
            if is_direct_msg_between_agents:
                msg_data = msg.model_dump()
                msg_data['thread_info'] = None
                
                # Add thread information if this message is part of a thread
                if include_threads and msg_id in self.message_to_thread:
                    thread_id = self.message_to_thread[msg_id]
                    thread = self.threads[thread_id]
                    msg_data['thread_info'] = {
                        'thread_id': thread_id,
                        'is_root': (msg_id == thread.root_message_id),
                        'thread_structure': thread.get_thread_structure() if include_threads else None
                    }
                
                # Add reactions to the direct message
                if msg_id in self.reactions:
                    msg_data['reactions'] = {}
                    for reaction_type, agents in self.reactions[msg_id].items():
                        if agents:  # Only include reactions with at least one agent
                            msg_data['reactions'][reaction_type] = len(agents)
                else:
                    msg_data['reactions'] = {}
                
                direct_messages.append(msg_data)
            
            # Also include replies if they're between these agents
            elif include_threads and isinstance(msg, ReplyMessage) and msg.target_agent_id:
                is_reply_between_agents = (
                    (msg.sender_id == agent_id and msg.target_agent_id == target_agent_id) or
                    (msg.sender_id == target_agent_id and msg.target_agent_id == agent_id)
                )
                
                if is_reply_between_agents:
                    msg_data = msg.model_dump()
                    msg_data['thread_info'] = None
                    
                    if msg_id in self.message_to_thread:
                        thread_id = self.message_to_thread[msg_id]
                        msg_data['thread_info'] = {
                            'thread_id': thread_id,
                            'is_root': False,
                            'thread_level': msg.thread_level
                        }
                    
                    # Add reactions to the reply message
                    if msg_id in self.reactions:
                        msg_data['reactions'] = {}
                        for reaction_type, agents in self.reactions[msg_id].items():
                            if agents:  # Only include reactions with at least one agent
                                msg_data['reactions'][reaction_type] = len(agents)
                    else:
                        msg_data['reactions'] = {}
                    
                    direct_messages.append(msg_data)
        
        # Sort by timestamp (newest first)
        direct_messages.sort(key=lambda x: x.get('timestamp', 0), reverse=True)
        
        # Apply pagination
        total_count = len(direct_messages)
        paginated_messages = direct_messages[offset:offset + limit]
        
        # Send response
        response = ModMessage(
            sender_id=self.network.network_id,
            mod="thread_messaging",
            content={
                "action": "retrieve_direct_messages_response",
                "success": True,
                "target_agent_id": target_agent_id,
                "messages": paginated_messages,
                "total_count": total_count,
                "offset": offset,
                "limit": limit,
                "has_more": (offset + limit) < total_count,
                "request_id": message.message_id
            },
            direction="outbound",
            relevant_agent_id=agent_id
        )
        await self.network.send_message(response)
        logger.debug(f"Sent {len(paginated_messages)} direct messages with {target_agent_id} to {agent_id}")
    
    async def _process_reaction_message(self, message: ReactionMessage) -> None:
        """Process a reaction message.
        
        Args:
            message: The reaction message
        """
        target_message_id = message.target_message_id
        reaction_type = message.reaction_type
        agent_id = message.sender_id
        action = message.action
        
        # Check if the target message exists
        if target_message_id not in self.message_history:
            logger.warning(f"Cannot react: target message {target_message_id} not found")
            
            # Send error response
            response = ModMessage(
                sender_id=self.network.network_id,
                mod="openagents.mods.communication.thread_messaging",
                content={
                    "action": "reaction_response",
                    "success": False,
                    "error": f"Target message {target_message_id} not found",
                    "target_message_id": target_message_id,
                    "reaction_type": reaction_type,
                    "request_id": message.message_id
                },
                direction="outbound",
                relevant_agent_id=agent_id
            )
            await self.network.send_message(response)
            return
        
        # Initialize reactions for the message if not exists
        if target_message_id not in self.reactions:
            self.reactions[target_message_id] = {}
        
        # Initialize reaction type if not exists
        if reaction_type not in self.reactions[target_message_id]:
            self.reactions[target_message_id][reaction_type] = set()
        
        success = False
        
        if action == "add":
            # Add reaction
            if agent_id not in self.reactions[target_message_id][reaction_type]:
                self.reactions[target_message_id][reaction_type].add(agent_id)
                success = True
                logger.debug(f"{agent_id} added {reaction_type} reaction to message {target_message_id}")
            else:
                logger.debug(f"{agent_id} already has {reaction_type} reaction on message {target_message_id}")
        
        elif action == "remove":
            # Remove reaction
            if agent_id in self.reactions[target_message_id][reaction_type]:
                self.reactions[target_message_id][reaction_type].discard(agent_id)
                success = True
                logger.debug(f"{agent_id} removed {reaction_type} reaction from message {target_message_id}")
                
                # Clean up empty reaction sets
                if not self.reactions[target_message_id][reaction_type]:
                    del self.reactions[target_message_id][reaction_type]
                
                # Clean up empty message reactions
                if not self.reactions[target_message_id]:
                    del self.reactions[target_message_id]
            else:
                logger.debug(f"{agent_id} doesn't have {reaction_type} reaction on message {target_message_id}")
        
        # Send response
        response = ModMessage(
            sender_id=self.network.network_id,
            mod="thread_messaging",
            content={
                "action": "reaction_response",
                "success": success,
                "target_message_id": target_message_id,
                "reaction_type": reaction_type,
                "action_taken": action,
                "total_reactions": len(self.reactions.get(target_message_id, {}).get(reaction_type, set())),
                "request_id": message.message_id
            },
            direction="outbound",
            relevant_agent_id=agent_id
        )
        await self.network.send_message(response)
        
        # Notify other agents about the reaction (broadcast to interested parties)
        target_message = self.message_history[target_message_id]
        
        # Determine who should be notified based on the message type
        notify_agents = set()
        
        if isinstance(target_message, DirectMessage):
            # Notify both participants in the direct conversation
            notify_agents.add(target_message.sender_id)
            notify_agents.add(target_message.target_agent_id)
        elif isinstance(target_message, ChannelMessage):
            # Notify agents in the channel
            notify_agents.update(self.channel_agents.get(target_message.channel, set()))
        elif isinstance(target_message, ReplyMessage):
            # Notify based on whether it's a channel or direct reply
            if target_message.channel:
                notify_agents.update(self.channel_agents.get(target_message.channel, set()))
            elif target_message.target_agent_id:
                notify_agents.add(target_message.sender_id)
                notify_agents.add(target_message.target_agent_id)
        
        # Remove the reacting agent from notifications (they already know)
        notify_agents.discard(agent_id)
        
        # Send notification to relevant agents
        for notify_agent in notify_agents:
            notification = ModMessage(
                sender_id=self.network.network_id,
                mod="openagents.mods.communication.thread_messaging",
                content={
                    "action": "reaction_notification",
                    "target_message_id": target_message_id,
                    "reaction_type": reaction_type,
                    "reacting_agent": agent_id,
                    "action_taken": action,
                    "total_reactions": len(self.reactions.get(target_message_id, {}).get(reaction_type, set()))
                },
                direction="outbound",
                relevant_agent_id=notify_agent
            )
            await self.network.send_message(notification)
    
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
            "file_storage_path": str(self.file_storage_path)
        }
    
    def _add_to_history(self, message: BaseMessage) -> None:
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
                key=lambda k: self.message_history[k].timestamp
            )[:200]
            for old_id in oldest_ids:
                del self.message_history[old_id]
    
    def _get_quoted_text(self, quoted_message_id: str) -> str:
        """Get the text content of a quoted message with author information.
        
        Args:
            quoted_message_id: The ID of the message being quoted
            
        Returns:
            The text content of the quoted message with author, or a fallback string if not found
        """
        if quoted_message_id in self.message_history:
            quoted_message = self.message_history[quoted_message_id]
            if hasattr(quoted_message, 'content') and isinstance(quoted_message.content, dict):
                text = quoted_message.content.get('text', '')
                author = getattr(quoted_message, 'sender_id', 'Unknown')
                
                # Truncate long quotes
                if len(text) > 100:
                    text = f"{text[:100]}..."
                
                # Format: "Author: quoted text"
                return f"{author}: {text}"
            else:
                return "[Quoted message content unavailable]"
        else:
            return f"[Quoted message {quoted_message_id} not found]"