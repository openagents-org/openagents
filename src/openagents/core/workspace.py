"""
Workspace implementation for OpenAgents.

This module provides workspace functionality that integrates with the thread messaging mod
to provide channel-based communication and collaboration features.
"""

import asyncio
import logging
from typing import Dict, Any, List, Optional, Union
from datetime import datetime

from openagents.core.client import AgentClient
from openagents.models.messages import ModMessage
from openagents.config.globals import THREAD_MESSAGING_MOD_NAME, DEFAULT_CHANNELS

logger = logging.getLogger(__name__)


class AgentConnection:
    """
    Represents a connection to a specific agent in the workspace.
    
    Provides methods to communicate directly with an agent.
    """
    
    def __init__(self, agent_id: str, workspace: 'Workspace'):
        """Initialize an agent connection.
        
        Args:
            agent_id: ID of the target agent
            workspace: Parent workspace instance
        """
        self.agent_id = agent_id
        self.workspace = workspace
        self._client = workspace._client
        
    async def send_direct_message(self, content: Union[str, Dict[str, Any]], **kwargs) -> bool:
        """Send a direct message to this agent.
        
        Args:
            content: Message content (string or dict)
            **kwargs: Additional message parameters
            
        Returns:
            bool: True if message sent successfully
        """
        # Ensure we're connected to the network
        if not await self.workspace._ensure_connected():
            logger.error("Could not establish network connection")
            return False
            
        try:
            # Import here to avoid circular imports
            from openagents.models.messages import DirectMessage
            
            # Prepare message content
            if isinstance(content, str):
                message_content = {"text": content}
            else:
                message_content = content.copy()
            
            # Create direct message
            direct_message = DirectMessage(
                sender_id=self._client.agent_id,
                target_agent_id=self.agent_id,
                content=message_content,
                **kwargs
            )
            
            # Send through client
            return await self._client.send_direct_message(direct_message)
            
        except Exception as e:
            logger.error(f"Failed to send direct message to agent {self.agent_id}: {e}")
            return False
    
    async def get_agent_info(self) -> Optional[Dict[str, Any]]:
        """Get information about this agent.
        
        Returns:
            Dict with agent information or None if not available
        """
        # Ensure we're connected to the network
        if not await self.workspace._ensure_connected():
            logger.error("Could not establish network connection")
            return None
            
        try:
            # Get agent info from the workspace's network connection
            # This would need to be implemented with proper agent discovery
            # For now, return basic info
            return {
                "agent_id": self.agent_id,
                "status": "online",  # Placeholder
                "capabilities": []   # Placeholder
            }
            
        except Exception as e:
            logger.error(f"Failed to get info for agent {self.agent_id}: {e}")
            return None
    
    def __str__(self) -> str:
        return f"AgentConnection({self.agent_id})"
    
    def __repr__(self) -> str:
        return f"AgentConnection(agent_id='{self.agent_id}', workspace='{self.workspace._client.agent_id if self.workspace._client else 'None'}')"


class ChannelConnection:
    """
    Represents a communication channel in a workspace.
    
    Provides methods to interact with channels through the thread messaging mod.
    """
    
    def __init__(self, channel_name: str, workspace: 'Workspace'):
        """Initialize a channel.
        
        Args:
            channel_name: Name of the channel (with or without # prefix)
            workspace: Parent workspace instance
        """
        # Normalize channel name (ensure it starts with #)
        if not channel_name.startswith('#'):
            channel_name = f"#{channel_name}"
        
        self.name = channel_name
        self.workspace = workspace
        self._client = workspace._client
        
    async def post(self, content: Union[str, Dict[str, Any]], **kwargs) -> bool:
        """Send a message to this channel.
        
        Args:
            content: Message content (string or dict)
            **kwargs: Additional message parameters
            
        Returns:
            bool: True if message sent successfully
        """
        # Ensure we're connected to the network
        if not await self.workspace._ensure_connected():
            logger.error("Could not establish network connection")
            return False
            
        try:
            # Prepare message content
            if isinstance(content, str):
                message_content = {"text": content}
            else:
                message_content = content.copy()
            
            # Create mod message for thread messaging
            mod_message = ModMessage(
                sender_id=self._client.agent_id,
                mod=THREAD_MESSAGING_MOD_NAME,
                relevant_agent_id=self._client.agent_id,
                content={
                    "action": "send_channel_message",
                    "channel": self.name,
                    "content": message_content,
                    **kwargs
                }
            )
            
            # Send through client
            return await self._client.send_mod_message(mod_message)
            
        except Exception as e:
            logger.error(f"Failed to send message to channel {self.name}: {e}")
            return False
    
    async def get_messages(self, limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
        """Retrieve messages from this channel.
        
        Args:
            limit: Maximum number of messages to retrieve
            offset: Number of messages to skip
            
        Returns:
            List of message dictionaries
        """
        # Ensure we're connected to the network
        if not await self.workspace._ensure_connected():
            logger.error("Could not establish network connection")
            return []
            
        try:
            # Create mod message to retrieve channel messages
            mod_message = ModMessage(
                sender_id=self._client.agent_id,
                mod=THREAD_MESSAGING_MOD_NAME,
                relevant_agent_id=self._client.agent_id,
                content={
                    "action": "retrieve_channel_messages",
                    "channel": self.name,
                    "limit": limit,
                    "offset": offset
                }
            )
            
            # Send request and wait for response
            # Note: This would need to be implemented with proper async response handling
            await self._client.send_mod_message(mod_message)
            
            # For now, return empty list - proper implementation would wait for response
            # TODO: Implement proper request-response pattern
            return []
            
        except Exception as e:
            logger.error(f"Failed to retrieve messages from channel {self.name}: {e}")
            return []
    
    async def reply_to_message(self, message_id: str, content: Union[str, Dict[str, Any]], **kwargs) -> bool:
        """Reply to a specific message in this channel.
        
        Args:
            message_id: ID of the message to reply to
            content: Reply content
            **kwargs: Additional reply parameters
            
        Returns:
            bool: True if reply sent successfully
        """
        # Ensure we're connected to the network
        if not await self.workspace._ensure_connected():
            logger.error("Could not establish network connection")
            return False
            
        try:
            # Prepare reply content
            if isinstance(content, str):
                reply_content = {"text": content}
            else:
                reply_content = content.copy()
            
            # Create mod message for thread messaging
            mod_message = ModMessage(
                sender_id=self._client.agent_id,
                mod=THREAD_MESSAGING_MOD_NAME,
                relevant_agent_id=self._client.agent_id,
                content={
                    "action": "reply_channel_message",
                    "channel": self.name,
                    "reply_to_id": message_id,
                    "text": reply_content.get("text", str(reply_content)),
                    **kwargs
                }
            )
            
            # Send through client
            return await self._client.send_mod_message(mod_message)
            
        except Exception as e:
            logger.error(f"Failed to reply to message {message_id} in channel {self.name}: {e}")
            return False
    
    async def upload_file(self, file_path: str) -> Optional[str]:
        """Upload a file to this channel.
        
        Args:
            file_path: Path to the file to upload
            
        Returns:
            File UUID if successful, None otherwise
        """
        # Ensure we're connected to the network
        if not await self.workspace._ensure_connected():
            logger.error("Could not establish network connection")
            return None
            
        try:
            # Create mod message for file upload
            mod_message = ModMessage(
                sender_id=self._client.agent_id,
                mod=THREAD_MESSAGING_MOD_NAME,
                relevant_agent_id=self._client.agent_id,
                content={
                    "action": "upload_file",
                    "file_path": file_path,
                    "channel": self.name
                }
            )
            
            # Send through client
            success = await self._client.send_mod_message(mod_message)
            if success:
                # In a real implementation, this would return the actual file UUID
                # For now, return a placeholder
                return f"file-{file_path.split('/')[-1]}-uuid"
            return None
            
        except Exception as e:
            logger.error(f"Failed to upload file {file_path} to channel {self.name}: {e}")
            return None
    
    async def react_to_message(self, message_id: str, reaction: str, action: str = "add") -> bool:
        """Add or remove a reaction to a message.
        
        Args:
            message_id: ID of the message to react to
            reaction: Reaction emoji (e.g., "+1", "heart", "laugh")
            action: "add" or "remove" the reaction
            
        Returns:
            bool: True if reaction was successful
        """
        # Ensure we're connected to the network
        if not await self.workspace._ensure_connected():
            logger.error("Could not establish network connection")
            return False
            
        try:
            # Create mod message for reaction
            mod_message = ModMessage(
                sender_id=self._client.agent_id,
                mod=THREAD_MESSAGING_MOD_NAME,
                relevant_agent_id=self._client.agent_id,
                content={
                    "action": "react_to_message",
                    "target_message_id": message_id,
                    "reaction_type": reaction,
                    "action": action
                }
            )
            
            # Send through client
            return await self._client.send_mod_message(mod_message)
            
        except Exception as e:
            logger.error(f"Failed to react to message {message_id} in channel {self.name}: {e}")
            return False
    
    def __str__(self) -> str:
        return f"ChannelConnection({self.name})"
    
    def __repr__(self) -> str:
        return f"ChannelConnection(name='{self.name}', workspace='{self.workspace._client.agent_id if self.workspace._client else 'None'}')"


class Workspace:
    """
    Represents a workspace that provides access to channels and collaboration features.
    
    The workspace integrates with the thread messaging mod to provide channel-based
    communication and other collaborative features.
    """
    
    def __init__(self, client: AgentClient):
        """Initialize a workspace.
        
        Args:
            client: AgentClient instance for network communication
        """
        self._client = client
        self._channels_cache: Dict[str, ChannelConnection] = {}
        self._agents_cache: Dict[str, AgentConnection] = {}
        self._last_channels_fetch: Optional[datetime] = None
        self._last_agents_fetch: Optional[datetime] = None
        self._auto_connect_config: Optional[Dict[str, Any]] = None
        self._is_connected: bool = False
    
    async def _ensure_connected(self) -> bool:
        """Ensure the workspace client is connected to the network.
        
        Returns:
            bool: True if connected successfully, False otherwise
        """
        if self._is_connected and self._client and self._client.connector:
            return True
        
        if not self._client:
            logger.error("No client available for workspace connection")
            return False
        
        if self._auto_connect_config:
            try:
                host = self._auto_connect_config['host']
                port = self._auto_connect_config['port']
                
                logger.info(f"Auto-connecting workspace client {self._client.agent_id} to {host}:{port}")
                success = await self._client.connect(host, port)
                
                if success:
                    self._is_connected = True
                    logger.info(f"Workspace client {self._client.agent_id} connected successfully")
                else:
                    logger.error(f"Failed to connect workspace client {self._client.agent_id}")
                
                return success
                
            except Exception as e:
                logger.error(f"Error during auto-connection: {e}")
                return False
        else:
            logger.warning("No auto-connect configuration available")
            return False
        
    async def channels(self, refresh: bool = False) -> List[str]:
        """List all available channels.
        
        Args:
            refresh: Whether to refresh the channel list from the server
            
        Returns:
            List of channel names
        """
        # Ensure we're connected to the network
        if not await self._ensure_connected():
            logger.error("Could not establish network connection")
            return []
            
        try:
            # Create mod message to list channels
            mod_message = ModMessage(
                sender_id=self._client.agent_id,
                mod=THREAD_MESSAGING_MOD_NAME,
                relevant_agent_id=self._client.agent_id,
                content={
                    "action": "list_channels"
                }
            )
            
            # Send request
            await self._client.send_mod_message(mod_message)
            
            # For now, return default channels - proper implementation would wait for response
            # TODO: Implement proper request-response pattern
            default_channels = DEFAULT_CHANNELS
            
            # Update cache
            for channel_name in default_channels:
                if channel_name not in self._channels_cache:
                    self._channels_cache[channel_name] = ChannelConnection(channel_name, self)
            
            self._last_channels_fetch = datetime.now()
            return default_channels
            
        except Exception as e:
            logger.error(f"Failed to list channels: {e}")
            return []
    
    def channel(self, channel_name: str) -> ChannelConnection:
        """Get a specific channel by name.
        
        Args:
            channel_name: Name of the channel (with or without # prefix)
            
        Returns:
            ChannelConnection instance
        """
        # Normalize channel name
        if not channel_name.startswith('#'):
            channel_name = f"#{channel_name}"
        
        # Return cached channel or create new one
        if channel_name not in self._channels_cache:
            self._channels_cache[channel_name] = ChannelConnection(channel_name, self)
        
        return self._channels_cache[channel_name]
    
    async def agents(self, refresh: bool = False) -> List[str]:
        """List all online agents in the network.
        
        Args:
            refresh: Whether to refresh the agent list from the server
            
        Returns:
            List of agent IDs
        """
        # Ensure we're connected to the network
        if not await self._ensure_connected():
            logger.error("Could not establish network connection")
            return []
            
        try:
            # Get agents from the network
            # This would ideally use the network's agent discovery functionality
            # For now, we'll use the client's list_agents method if available
            if hasattr(self._client, 'list_agents'):
                agents_info = await self._client.list_agents()
                if agents_info:
                    agent_ids = [agent.get('agent_id', agent.get('id', '')) for agent in agents_info if agent.get('agent_id') or agent.get('id')]
                    
                    # Update cache
                    for agent_id in agent_ids:
                        if agent_id and agent_id not in self._agents_cache:
                            self._agents_cache[agent_id] = AgentConnection(agent_id, self)
                    
                    self._last_agents_fetch = datetime.now()
                    return agent_ids
            
            # Fallback: return cached agent IDs or empty list
            return list(self._agents_cache.keys())
            
        except Exception as e:
            logger.error(f"Failed to list agents: {e}")
            return list(self._agents_cache.keys())  # Return cached agents as fallback
    
    def agent(self, agent_id: str) -> AgentConnection:
        """Get a connection to a specific agent by ID.
        
        Args:
            agent_id: ID of the agent to connect to
            
        Returns:
            AgentConnection instance
        """
        # Return cached agent connection or create new one
        if agent_id not in self._agents_cache:
            self._agents_cache[agent_id] = AgentConnection(agent_id, self)
        
        return self._agents_cache[agent_id]
    
    async def create_channel(self, channel_name: str, description: str = "") -> ChannelConnection:
        """Create a new channel.
        
        Args:
            channel_name: Name for the new channel
            description: Optional description for the channel
            
        Returns:
            ChannelConnection instance for the created channel
        """
        # Normalize channel name
        if not channel_name.startswith('#'):
            channel_name = f"#{channel_name}"
        
        # Ensure we're connected to the network
        if not await self._ensure_connected():
            logger.error("Could not establish network connection")
            return self.channel(channel_name)  # Return channel object anyway
            
        try:
            # Create mod message to create channel (if supported by thread messaging mod)
            mod_message = ModMessage(
                sender_id=self._client.agent_id,
                mod=THREAD_MESSAGING_MOD_NAME,
                relevant_agent_id=self._client.agent_id,
                content={
                    "action": "create_channel",
                    "channel": channel_name,
                    "description": description
                }
            )
            
            # Send request
            await self._client.send_mod_message(mod_message)
            
            # Create and cache channel
            channel = ChannelConnection(channel_name, self)
            self._channels_cache[channel_name] = channel
            
            return channel
            
        except Exception as e:
            logger.error(f"Failed to create channel {channel_name}: {e}")
            # Return channel object anyway - it might exist or be created later
            return self.channel(channel_name)
    
    def get_client(self) -> Optional[AgentClient]:
        """Get the underlying client instance.
        
        Returns:
            AgentClient instance or None if not available
        """
        return self._client
    
    def __str__(self) -> str:
        client_id = self._client.agent_id if self._client else "None"
        return f"Workspace(client={client_id})"
    
    def __repr__(self) -> str:
        client_id = self._client.agent_id if self._client else "None"
        return f"Workspace(client_id='{client_id}', channels_cached={len(self._channels_cache)})"
