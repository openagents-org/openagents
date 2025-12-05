"""
Agent-level agent avatar adapter for OpenAgents.

This adapter provides tools for agents to interact with the avatar system.
"""

import logging
import base64
from typing import Dict, Any, List, Optional

from openagents.core.base_mod_adapter import BaseModAdapter
from openagents.models.event import Event, EventVisibility
from openagents.models.tool import AgentTool

logger = logging.getLogger(__name__)


class AgentAvatarAdapter(BaseModAdapter):
    """Agent-level agent avatar adapter implementation.
    
    This adapter provides tools for agents to set, get, clear,
    and batch retrieve avatars.
    """
    
    def __init__(self):
        """Initialize the agent avatar adapter for an agent."""
        super().__init__(mod_name="agent_avatar")
        
        # Track pending requests
        self.pending_requests: Dict[str, Dict[str, Any]] = {}
        self.completed_requests: Dict[str, Dict[str, Any]] = {}
        
        logger.info("Initializing Agent Avatar adapter")
    
    def initialize(self) -> bool:
        """Initialize the adapter."""
        logger.info(f"Agent Avatar adapter initialized for agent {self.agent_id}")
        return True
    
    def shutdown(self) -> bool:
        """Shutdown the adapter."""
        self.pending_requests.clear()
        self.completed_requests.clear()
        return True
    
    async def process_incoming_mod_message(self, message: Event) -> None:
        """Process an incoming mod message.
        
        Args:
            message: The mod message to process
        """
        logger.debug(f"Received mod message: {message.event_name}")
        
        event_name = message.event_name
        
        if event_name == "avatar.set.response":
            await self._handle_set_avatar_response(message)
        elif event_name == "avatar.clear.response":
            await self._handle_clear_avatar_response(message)
        elif event_name == "avatar.get.response":
            await self._handle_get_avatar_response(message)
        elif event_name == "avatar.get_batch.response":
            await self._handle_get_batch_response(message)
        else:
            logger.debug(f"Unhandled avatar event: {event_name}")
    
    async def set_avatar(
        self,
        image_data: str,
        mime_type: str = "image/png",
        original_filename: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """Set the agent's avatar.
        
        Args:
            image_data: Base64-encoded image data
            mime_type: MIME type of the image (default: "image/png")
            original_filename: Optional original filename
            
        Returns:
            Optional[Dict[str, Any]]: Response data if successful, None otherwise
        """
        if self.connector is None:
            logger.error(f"Cannot set avatar: connector is None for agent {self.agent_id}")
            return None
        
        try:
            message = Event(
                event_name="avatar.set",
                source_id=self.agent_id,
                relevant_mod="openagents.mods.misc.agent_avatar",
                visibility=EventVisibility.MOD_ONLY,
                payload={
                    "image_data": image_data,
                    "mime_type": mime_type,
                    "original_filename": original_filename or "avatar"
                }
            )
            
            # Store pending request
            self.pending_requests[message.event_id] = {
                "action": "set",
                "timestamp": message.timestamp
            }
            
            # Send event
            await self.connector.send_event(message)
            logger.debug("Sent avatar set request")
            
            # Wait for response
            import asyncio
            
            for _ in range(50):  # 50 * 0.2 = 10 seconds
                if message.event_id in self.completed_requests:
                    result = self.completed_requests.pop(message.event_id)
                    if result.get("success"):
                        logger.info("Avatar set successfully")
                        return result
                    else:
                        logger.error(f"Avatar set failed: {result.get('message', 'Unknown error')}")
                        return None
                
                await asyncio.sleep(0.2)
            
            # Timeout
            logger.warning("Avatar set timed out")
            if message.event_id in self.pending_requests:
                del self.pending_requests[message.event_id]
            return None
            
        except Exception as e:
            logger.error(f"Error setting avatar: {e}")
            return None
    
    async def clear_avatar(self) -> bool:
        """Clear the agent's avatar.
        
        Returns:
            bool: True if successful, False otherwise
        """
        if self.connector is None:
            logger.error(f"Cannot clear avatar: connector is None for agent {self.agent_id}")
            return False
        
        try:
            message = Event(
                event_name="avatar.clear",
                source_id=self.agent_id,
                relevant_mod="openagents.mods.misc.agent_avatar",
                visibility=EventVisibility.MOD_ONLY,
                payload={}
            )
            
            # Store pending request
            self.pending_requests[message.event_id] = {
                "action": "clear",
                "timestamp": message.timestamp
            }
            
            # Send event
            await self.connector.send_event(message)
            logger.debug("Sent avatar clear request")
            
            # Wait for response
            import asyncio
            
            for _ in range(50):  # 50 * 0.2 = 10 seconds
                if message.event_id in self.completed_requests:
                    result = self.completed_requests.pop(message.event_id)
                    if result.get("success"):
                        logger.info("Avatar cleared successfully")
                        return True
                    else:
                        logger.error(f"Avatar clear failed: {result.get('message', 'Unknown error')}")
                        return False
                
                await asyncio.sleep(0.2)
            
            # Timeout
            logger.warning("Avatar clear timed out")
            if message.event_id in self.pending_requests:
                del self.pending_requests[message.event_id]
            return False
            
        except Exception as e:
            logger.error(f"Error clearing avatar: {e}")
            return False
    
    async def get_avatar(
        self,
        agent_id: Optional[str] = None,
        include_data: bool = False
    ) -> Optional[Dict[str, Any]]:
        """Get an agent's avatar.
        
        Args:
            agent_id: ID of the agent (default: own avatar)
            include_data: Whether to include base64 image data
            
        Returns:
            Optional[Dict[str, Any]]: Avatar info if successful, None otherwise
        """
        if self.connector is None:
            logger.error(f"Cannot get avatar: connector is None for agent {self.agent_id}")
            return None
        
        try:
            target_agent_id = agent_id or self.agent_id
            
            message = Event(
                event_name="avatar.get",
                source_id=self.agent_id,
                relevant_mod="openagents.mods.misc.agent_avatar",
                visibility=EventVisibility.MOD_ONLY,
                payload={
                    "agent_id": target_agent_id,
                    "include_data": include_data
                }
            )
            
            # Store pending request
            self.pending_requests[message.event_id] = {
                "action": "get",
                "agent_id": target_agent_id,
                "timestamp": message.timestamp
            }
            
            # Send event
            await self.connector.send_event(message)
            logger.debug(f"Sent avatar get request for {target_agent_id}")
            
            # Wait for response
            import asyncio
            
            for _ in range(50):  # 50 * 0.2 = 10 seconds
                if message.event_id in self.completed_requests:
                    result = self.completed_requests.pop(message.event_id)
                    if result.get("success"):
                        logger.info(f"Avatar retrieved for {target_agent_id}")
                        return result
                    else:
                        logger.error(f"Avatar get failed: {result.get('message', 'Unknown error')}")
                        return None
                
                await asyncio.sleep(0.2)
            
            # Timeout
            logger.warning(f"Avatar get timed out for {target_agent_id}")
            if message.event_id in self.pending_requests:
                del self.pending_requests[message.event_id]
            return None
            
        except Exception as e:
            logger.error(f"Error getting avatar: {e}")
            return None
    
    async def get_batch(self, agent_ids: List[str]) -> Optional[Dict[str, Dict[str, Any]]]:
        """Get avatars for multiple agents.
        
        Args:
            agent_ids: List of agent IDs
            
        Returns:
            Optional[Dict[str, Dict[str, Any]]]: Dictionary mapping agent IDs to avatar info
        """
        if self.connector is None:
            logger.error(f"Cannot get batch avatars: connector is None for agent {self.agent_id}")
            return None
        
        try:
            message = Event(
                event_name="avatar.get_batch",
                source_id=self.agent_id,
                relevant_mod="openagents.mods.misc.agent_avatar",
                visibility=EventVisibility.MOD_ONLY,
                payload={
                    "agent_ids": agent_ids
                }
            )
            
            # Store pending request
            self.pending_requests[message.event_id] = {
                "action": "get_batch",
                "agent_ids": agent_ids,
                "timestamp": message.timestamp
            }
            
            # Send event
            await self.connector.send_event(message)
            logger.debug(f"Sent batch avatar get request for {len(agent_ids)} agents")
            
            # Wait for response
            import asyncio
            
            for _ in range(50):  # 50 * 0.2 = 10 seconds
                if message.event_id in self.completed_requests:
                    result = self.completed_requests.pop(message.event_id)
                    if result.get("success"):
                        avatars = result.get("avatars", {})
                        logger.info(f"Retrieved avatars for {len(avatars)} agents")
                        return avatars
                    else:
                        logger.error(f"Batch avatar get failed: {result.get('message', 'Unknown error')}")
                        return None
                
                await asyncio.sleep(0.2)
            
            # Timeout
            logger.warning("Batch avatar get timed out")
            if message.event_id in self.pending_requests:
                del self.pending_requests[message.event_id]
            return None
            
        except Exception as e:
            logger.error(f"Error getting batch avatars: {e}")
            return None
    
    async def _handle_set_avatar_response(self, message: Event) -> None:
        """Handle avatar set response."""
        request_id = message.response_to
        if request_id and request_id in self.pending_requests:
            self.completed_requests[request_id] = message.payload or {}
            del self.pending_requests[request_id]
    
    async def _handle_clear_avatar_response(self, message: Event) -> None:
        """Handle avatar clear response."""
        request_id = message.response_to
        if request_id and request_id in self.pending_requests:
            self.completed_requests[request_id] = message.payload or {}
            del self.pending_requests[request_id]
    
    async def _handle_get_avatar_response(self, message: Event) -> None:
        """Handle avatar get response."""
        request_id = message.response_to
        if request_id and request_id in self.pending_requests:
            self.completed_requests[request_id] = message.payload or {}
            del self.pending_requests[request_id]
    
    async def _handle_get_batch_response(self, message: Event) -> None:
        """Handle batch avatar get response."""
        request_id = message.response_to
        if request_id and request_id in self.pending_requests:
            self.completed_requests[request_id] = message.payload or {}
            del self.pending_requests[request_id]
    
    def get_tools(self) -> List[AgentTool]:
        """Get the tools for the mod adapter.
        
        Returns:
            List[AgentTool]: The tools for the mod adapter
        """
        tools = []
        
        # Tool 1: Set avatar
        set_avatar_tool = AgentTool(
            name="set_avatar",
            description="Set your avatar image. Supports PNG, JPG, GIF, WebP formats. Image will be resized to 256x256 pixels. Max file size: 512KB.",
            input_schema={
                "type": "object",
                "properties": {
                    "image_data": {
                        "type": "string",
                        "description": "Base64-encoded image data"
                    },
                    "mime_type": {
                        "type": "string",
                        "description": "MIME type of the image (e.g., 'image/png', 'image/jpeg', 'image/gif', 'image/webp')",
                        "default": "image/png"
                    },
                    "original_filename": {
                        "type": "string",
                        "description": "Optional original filename"
                    }
                },
                "required": ["image_data"]
            },
            func=self.set_avatar,
        )
        tools.append(set_avatar_tool)
        
        # Tool 2: Clear avatar
        clear_avatar_tool = AgentTool(
            name="clear_avatar",
            description="Remove your avatar image",
            input_schema={
                "type": "object",
                "properties": {}
            },
            func=self.clear_avatar,
        )
        tools.append(clear_avatar_tool)
        
        # Tool 3: Get avatar
        get_avatar_tool = AgentTool(
            name="get_avatar",
            description="Get an agent's avatar. Returns avatar URL and metadata. Can get your own avatar or another agent's avatar.",
            input_schema={
                "type": "object",
                "properties": {
                    "agent_id": {
                        "type": "string",
                        "description": "ID of the agent (default: your own avatar)"
                    },
                    "include_data": {
                        "type": "boolean",
                        "description": "Whether to include base64 image data in response",
                        "default": False
                    }
                }
            },
            func=self.get_avatar,
        )
        tools.append(get_avatar_tool)
        
        # Tool 4: Get batch avatars
        get_batch_tool = AgentTool(
            name="get_batch_avatars",
            description="Get avatars for multiple agents at once. Useful for loading all participant avatars in a chatroom.",
            input_schema={
                "type": "object",
                "properties": {
                    "agent_ids": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of agent IDs to get avatars for"
                    }
                },
                "required": ["agent_ids"]
            },
            func=self.get_batch,
        )
        tools.append(get_batch_tool)
        
        return tools

