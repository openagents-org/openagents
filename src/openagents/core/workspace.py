"""
Workspace implementation for OpenAgents.

This module provides workspace functionality that integrates with the thread messaging mod
to provide channel-based communication and collaboration features.
"""

import asyncio
import logging
import uuid
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
    
    async def wait_for_message(self, timeout: float = 30.0) -> Optional[Dict[str, Any]]:
        """Wait for a direct message from this agent.
        
        Args:
            timeout: Timeout in seconds
            
        Returns:
            Dict containing the message content, or None if timeout
        """
        # Ensure we're connected to the network
        if not await self.workspace._ensure_connected():
            logger.error("Could not establish network connection")
            return None
            
        try:
            def message_condition(msg):
                """Check if this is a direct message from our target agent."""
                try:
                    return msg.sender_id == self.agent_id
                except (AttributeError, KeyError):
                    return False
            
            # Wait for the direct message
            response = await self._client.wait_direct_message(
                condition=message_condition,
                timeout=timeout
            )
            
            if response:
                return response.content
            return None
            
        except Exception as e:
            logger.error(f"Error waiting for message from agent {self.agent_id}: {e}")
            return None
    
    async def wait_for_reply(self, timeout: float = 30.0) -> Optional[Dict[str, Any]]:
        """Wait for a reply from this agent (alias for wait_for_message).
        
        Args:
            timeout: Timeout in seconds
            
        Returns:
            Dict containing the message content, or None if timeout
        """
        return await self.wait_for_message(timeout)
    
    async def send_and_wait(self, content: Union[str, Dict[str, Any]], timeout: float = 30.0, **kwargs) -> Optional[Dict[str, Any]]:
        """Send a direct message and wait for a reply.
        
        Args:
            content: Message content to send
            timeout: Timeout in seconds to wait for reply
            **kwargs: Additional message parameters
            
        Returns:
            Dict containing the reply message content, or None if timeout or send failed
        """
        # Send the message first
        success = await self.send_direct_message(content, **kwargs)
        if not success:
            logger.error(f"Failed to send message to agent {self.agent_id}")
            return None
        
        # Wait for reply
        logger.info(f"Sent message to {self.agent_id}, waiting for reply...")
        return await self.wait_for_reply(timeout=timeout)
    
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
                    "message_type": "channel_message",
                    "sender_id": self._client.agent_id,
                    "channel": self.name,
                    "text": message_content.get("text", str(message_content)),
                    **kwargs
                }
            )
            
            # Send through client
            return await self._client.send_mod_message(mod_message)
            
        except Exception as e:
            logger.error(f"Failed to send message to channel {self.name}: {e}")
            return False
    
    async def get_messages(self, limit: int = 50, offset: int = 0, timeout: float = 10.0) -> List[Dict[str, Any]]:
        """Retrieve messages from this channel.
        
        Args:
            limit: Maximum number of messages to retrieve
            offset: Number of messages to skip
            timeout: Timeout for waiting for response (seconds)
            
        Returns:
            List of message dictionaries
        """
        # Ensure we're connected to the network
        if not await self.workspace._ensure_connected():
            logger.error("Could not establish network connection")
            return []
            
        try:
            # Generate unique request ID for correlation
            request_id = str(uuid.uuid4())
            
            # Create mod message to retrieve channel messages
            mod_message = ModMessage(
                sender_id=self._client.agent_id,
                mod=THREAD_MESSAGING_MOD_NAME,
                relevant_agent_id=self._client.agent_id,
                content={
                    "message_type": "message_retrieval",
                    "sender_id": self._client.agent_id,
                    "action": "retrieve_channel_messages",
                    "channel": self.name,
                    "limit": limit,
                    "offset": offset,
                    "request_id": request_id
                }
            )
            
            # Define condition to match the response
            def response_condition(msg):
                """Check if this is the response to our request."""
                try:
                    content = msg.content
                    return (
                        content.get("action") == "retrieve_channel_messages_response" and
                        content.get("request_id") == request_id and
                        content.get("channel") == self.name
                    )
                except (AttributeError, KeyError):
                    return False
            
            # Start waiting for response before sending request
            wait_task = asyncio.create_task(
                self._client.wait_mod_message(
                    condition=response_condition,
                    timeout=timeout
                )
            )
            
            # Give the wait task a moment to start
            await asyncio.sleep(0.01)
            
            # Send request
            success = await self._client.send_mod_message(mod_message)
            if not success:
                wait_task.cancel()
                logger.error(f"Failed to send get_messages request for channel {self.name}")
                return []
            
            # Wait for response
            response = await wait_task
            
            if response is None:
                logger.warning(f"Timeout waiting for messages from channel {self.name} (timeout: {timeout}s)")
                return []
            
            # Extract messages from response
            response_content = response.content
            messages = response_content.get("messages", [])
            
            logger.debug(f"Retrieved {len(messages)} messages from channel {self.name}")
            return messages
            
        except asyncio.CancelledError:
            logger.debug(f"get_messages request cancelled for channel {self.name}")
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
                    "message_type": "reply_message",
                    "sender_id": self._client.agent_id,
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
                    "message_type": "file_upload",
                    "sender_id": self._client.agent_id,
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
                    "message_type": "reaction",
                    "sender_id": self._client.agent_id,
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
    
    async def wait_for_reply(self, message_id: Optional[str] = None, timeout: float = 30.0) -> Optional[Dict[str, Any]]:
        """Wait for a reply to a specific message or any reply in this channel.
        
        Args:
            message_id: ID of the message to wait for replies to (if None, waits for any reply)
            timeout: Timeout in seconds
            
        Returns:
            Dict containing the reply message, or None if timeout
        """
        # Ensure we're connected to the network
        if not await self.workspace._ensure_connected():
            logger.error("Could not establish network connection")
            return None
            
        try:
            def reply_condition(msg):
                """Check if this is a reply message in our channel."""
                try:
                    content = msg.content
                    # Look for reply messages from thread messaging mod
                    if content.get("action") == "channel_message_notification":
                        msg_data = content.get("message", {})
                        # Check if it's in our channel
                        if msg_data.get("channel") != self.name:
                            return False
                        # Check if it's a reply (has reply_to_id)
                        if not msg_data.get("reply_to_id"):
                            return False
                        # If specific message_id provided, check if it matches
                        if message_id and msg_data.get("reply_to_id") != message_id:
                            return False
                        return True
                    return False
                except (AttributeError, KeyError):
                    return False
            
            # Wait for the reply
            response = await self._client.wait_mod_message(
                condition=reply_condition,
                timeout=timeout
            )
            
            if response:
                return response.content.get("message", {})
            return None
            
        except Exception as e:
            logger.error(f"Error waiting for reply in channel {self.name}: {e}")
            return None
    
    async def wait_for_post(self, from_agent: Optional[str] = None, timeout: float = 30.0) -> Optional[Dict[str, Any]]:
        """Wait for the next post (not reply) in this channel.
        
        Args:
            from_agent: Wait for post from specific agent (if None, waits for any agent)
            timeout: Timeout in seconds
            
        Returns:
            Dict containing the post message, or None if timeout
        """
        # Ensure we're connected to the network
        if not await self.workspace._ensure_connected():
            logger.error("Could not establish network connection")
            return None
            
        try:
            def post_condition(msg):
                """Check if this is a new post (not reply) in our channel."""
                try:
                    content = msg.content
                    # Look for channel messages from thread messaging mod
                    if content.get("action") == "channel_message_notification":
                        msg_data = content.get("message", {})
                        # Check if it's in our channel
                        if msg_data.get("channel") != self.name:
                            return False
                        # Check if it's NOT a reply (no reply_to_id)
                        if msg_data.get("reply_to_id"):
                            return False
                        # If specific agent provided, check sender
                        if from_agent and msg_data.get("sender_id") != from_agent:
                            return False
                        # Don't wait for our own messages
                        if msg_data.get("sender_id") == self._client.agent_id:
                            return False
                        return True
                    return False
                except (AttributeError, KeyError):
                    return False
            
            # Wait for the post
            response = await self._client.wait_mod_message(
                condition=post_condition,
                timeout=timeout
            )
            
            if response:
                return response.content.get("message", {})
            return None
            
        except Exception as e:
            logger.error(f"Error waiting for post in channel {self.name}: {e}")
            return None
    
    async def wait_for_reaction(self, message_id: str, timeout: float = 30.0) -> Optional[Dict[str, Any]]:
        """Wait for a reaction to a specific message.
        
        Args:
            message_id: ID of the message to wait for reactions to
            timeout: Timeout in seconds
            
        Returns:
            Dict containing the reaction info, or None if timeout
        """
        # Ensure we're connected to the network
        if not await self.workspace._ensure_connected():
            logger.error("Could not establish network connection")
            return None
            
        try:
            def reaction_condition(msg):
                """Check if this is a reaction to our message."""
                try:
                    content = msg.content
                    # Look for reaction notifications from thread messaging mod
                    if content.get("action") == "reaction_notification":
                        return content.get("target_message_id") == message_id
                    return False
                except (AttributeError, KeyError):
                    return False
            
            # Wait for the reaction
            response = await self._client.wait_mod_message(
                condition=reaction_condition,
                timeout=timeout
            )
            
            if response:
                return response.content
            return None
            
        except Exception as e:
            logger.error(f"Error waiting for reaction to message {message_id}: {e}")
            return None
    
    async def post_and_wait(self, content: Union[str, Dict[str, Any]], timeout: float = 30.0, **kwargs) -> Optional[Dict[str, Any]]:
        """Post a message and wait for any reply to it.
        
        Args:
            content: Message content to post
            timeout: Timeout in seconds to wait for reply
            **kwargs: Additional message parameters
            
        Returns:
            Dict containing the reply message, or None if timeout or post failed
        """
        # Post the message first
        success = await self.post(content, **kwargs)
        if not success:
            logger.error(f"Failed to post message to {self.name}")
            return None
        
        # For demo purposes, we'll wait for any reply since we don't have the actual message ID
        # In a real implementation, the post method would return the message ID
        logger.info(f"Posted message to {self.name}, waiting for replies...")
        return await self.wait_for_reply(timeout=timeout)
    
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
        
    async def channels(self, refresh: bool = False, timeout: float = 5.0) -> List[str]:
        """List all available channels.
        
        Args:
            refresh: Whether to refresh the channel list from the server
            timeout: Timeout for waiting for response (seconds)
            
        Returns:
            List of channel names
        """
        # Return cached channels if not refreshing and cache is recent
        if not refresh and self._last_channels_fetch and self._channels_cache:
            cache_age = (datetime.now() - self._last_channels_fetch).total_seconds()
            if cache_age < 30:  # Use cache if less than 30 seconds old
                return list(self._channels_cache.keys())
        
        # Ensure we're connected to the network
        if not await self._ensure_connected():
            logger.error("Could not establish network connection")
            # Return cached channels as fallback
            return list(self._channels_cache.keys()) if self._channels_cache else DEFAULT_CHANNELS
            
        try:
            # Generate unique request ID for correlation
            request_id = str(uuid.uuid4())
            
            # Create mod message to list channels
            mod_message = ModMessage(
                sender_id=self._client.agent_id,
                mod=THREAD_MESSAGING_MOD_NAME,
                relevant_agent_id=self._client.agent_id,
                content={
                    "message_type": "channel_info",
                    "sender_id": self._client.agent_id,
                    "action": "list_channels",
                    "request_id": request_id
                }
            )
            
            # Define condition to match the response
            def response_condition(msg):
                """Check if this is the response to our request."""
                try:
                    content = msg.content
                    return (
                        content.get("action") == "list_channels_response" and
                        content.get("request_id") == request_id
                    )
                except (AttributeError, KeyError):
                    return False
            
            # Start waiting for response before sending request
            wait_task = asyncio.create_task(
                self._client.wait_mod_message(
                    condition=response_condition,
                    timeout=timeout
                )
            )
            
            # Give the wait task a moment to start
            await asyncio.sleep(0.01)
            
            # Send request
            success = await self._client.send_mod_message(mod_message)
            if not success:
                wait_task.cancel()
                logger.error("Failed to send list_channels request")
                # Return cached or default channels as fallback
                return list(self._channels_cache.keys()) if self._channels_cache else DEFAULT_CHANNELS
            
            # Wait for response
            response = await wait_task
            
            if response is None:
                logger.warning(f"Timeout waiting for channel list (timeout: {timeout}s)")
                # Return cached or default channels as fallback
                return list(self._channels_cache.keys()) if self._channels_cache else DEFAULT_CHANNELS
            
            # Extract channels from response
            response_content = response.content
            channels = response_content.get("channels", DEFAULT_CHANNELS)
            
            # Update cache
            self._channels_cache.clear()  # Clear old cache
            for channel_name in channels:
                if channel_name not in self._channels_cache:
                    self._channels_cache[channel_name] = ChannelConnection(channel_name, self)
            
            self._last_channels_fetch = datetime.now()
            logger.debug(f"Retrieved {len(channels)} channels from server")
            return channels
            
        except asyncio.CancelledError:
            logger.debug("list_channels request cancelled")
            return list(self._channels_cache.keys()) if self._channels_cache else DEFAULT_CHANNELS
        except Exception as e:
            logger.error(f"Failed to list channels: {e}")
            # Return cached or default channels as fallback
            return list(self._channels_cache.keys()) if self._channels_cache else DEFAULT_CHANNELS
    
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
            # Note: Channel creation is not supported by the thread messaging mod
            # We'll just create the channel object locally
            logger.info(f"Creating local channel object for {channel_name}")
            
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
