"""
Agent-level OpenConvert discovery protocol for OpenAgents.

This protocol allows agents to announce their MIME file format conversion capabilities 
to the network and for other agents to discover agents that can perform specific 
MIME format conversions.
"""

from typing import Dict, Any, Optional, List
import logging
from openagents.core.base_mod_adapter import BaseModAdapter
from openagents.models.messages import ModMessage, BroadcastMessage
from openagents.models.tool import AgentAdapterTool
from openagents.utils.message_util import get_mod_message_thread_id
import copy

logger = logging.getLogger(__name__)

# Protocol constants
PROTOCOL_NAME = "openagents.mods.discovery.openconvert_discovery"
ANNOUNCE_CONVERSION_CAPABILITIES = "announce_conversion_capabilities"
DISCOVER_CONVERSION_AGENTS = "discover_conversion_agents"


class OpenConvertDiscoveryAdapter(BaseModAdapter):
    """Agent adapter for the OpenConvert discovery protocol.
    
    This adapter allows agents to announce their MIME file format conversion 
    capabilities and discover other agents that can perform specific conversions.
    """
    
    def __init__(self):
        """Initialize the OpenConvert discovery adapter."""
        super().__init__(PROTOCOL_NAME)
        self._conversion_capabilities = {}
        self._pending_discovery_results: List[Dict[str, Any]] = []
    
    def initialize(self) -> bool:
        """Initialize the mod adapter.
        
        Returns:
            bool: True if initialization was successful
        """
        logger.info(f"Initializing {self.mod_name} adapter for agent {self.agent_id}")
        return True
    
    def shutdown(self) -> bool:
        """Shutdown the mod adapter gracefully.
        
        Returns:
            bool: True if shutdown was successful
        """
        logger.info(f"Shutting down {self.mod_name} adapter for agent {self.agent_id}")
        return True
    
    def on_connect(self) -> None:
        """Called when the mod adapter is connected to the network.
        
        Announces the agent's conversion capabilities when connecting to the network.
        """
        if self._conversion_capabilities:
            # Schedule the async announcement to run in the background
            import asyncio
            asyncio.create_task(self._announce_conversion_capabilities())
            logger.info(f"Agent {self.agent_id} connected and will announce conversion capabilities")
    
    async def set_conversion_capabilities(self, conversion_capabilities: Dict[str, Any]) -> None:
        """Set the conversion capabilities for this agent.
        
        Args:
            conversion_capabilities: The conversion capabilities to set.
                Expected format: {
                    "conversion_pairs": [
                        {"from": "application/pdf", "to": "text/plain"},
                        {"from": "image/jpeg", "to": "image/png"},
                        ...
                    ],
                    "description": "Optional text description of the agent's capabilities"
                }
        """
        self._conversion_capabilities = conversion_capabilities
        logger.info(f"Agent {self.agent_id} set conversion capabilities: {conversion_capabilities}")
        
        # If already connected, announce the updated capabilities
        if self.connector and self.connector.is_connected:
            await self._announce_conversion_capabilities()
    
    async def update_conversion_capabilities(self, conversion_capabilities: Dict[str, Any]) -> None:
        """Update the conversion capabilities for this agent.
        
        Args:
            conversion_capabilities: The conversion capabilities to update
        """
        # Update capabilities with deep merge for nested structures
        # Make a deep copy of the capabilities to avoid reference issues
        capabilities_copy = copy.deepcopy(conversion_capabilities)
        
        # Update the capabilities dictionary
        for key, value in capabilities_copy.items():
            self._conversion_capabilities[key] = value
            
        logger.info(f"Agent {self.agent_id} updated conversion capabilities: {self._conversion_capabilities}")
        
        # If already connected, announce the updated capabilities
        if self.connector and self.connector.is_connected:
            await self._announce_conversion_capabilities()
    
    async def add_conversion_pair(self, from_mime: str, to_mime: str) -> None:
        """Add a single conversion pair to the agent's capabilities.
        
        Args:
            from_mime: Source MIME type (e.g., "application/pdf")
            to_mime: Target MIME type (e.g., "text/plain")
        """
        if "conversion_pairs" not in self._conversion_capabilities:
            self._conversion_capabilities["conversion_pairs"] = []
            
        # Check if this conversion pair already exists
        new_pair = {"from": from_mime, "to": to_mime}
        if new_pair not in self._conversion_capabilities["conversion_pairs"]:
            self._conversion_capabilities["conversion_pairs"].append(new_pair)
            logger.info(f"Agent {self.agent_id} added conversion pair: {from_mime} -> {to_mime}")
            
            # If already connected, announce the updated capabilities
            if self.connector and self.connector.is_connected:
                await self._announce_conversion_capabilities()
        else:
            logger.debug(f"Conversion pair {from_mime} -> {to_mime} already exists for agent {self.agent_id}")
    
    async def discover_conversion_agents(self, from_mime: str, to_mime: str, **additional_filters) -> List[Dict[str, Any]]:
        """Discover agents that can perform a specific MIME conversion.
        
        Args:
            from_mime: Source MIME type (e.g., "application/pdf")
            to_mime: Target MIME type (e.g., "text/plain")
            **additional_filters: Additional query filters (e.g., description_contains="OCR")
            
        Returns:
            List[Dict[str, Any]]: List of matching agents with their conversion capabilities
        """
        if not self.connector or not self.connector.is_connected:
            logger.warning(f"Agent {self.agent_id} cannot discover conversion agents: not connected to network")
            return []
        
        # Create the query
        query = {
            "from_mime": from_mime,
            "to_mime": to_mime
        }
        query.update(additional_filters)
        
        logger.info(f"Agent {self.agent_id} discovering conversion agents for {from_mime} -> {to_mime} with filters: {additional_filters}")
        
        if not self.agent_id:
            logger.warning("Cannot discover conversion agents: no agent ID")
            return []
        
        # Create discovery request as broadcast message to reach all agents
        from openagents.models.messages import BroadcastMessage
        message = BroadcastMessage(
            sender_id=self.agent_id,
            mod=self.mod_name,
            message_type="broadcast_message",
            content={
                "action": DISCOVER_CONVERSION_AGENTS,
                "query": query
            },
            text_representation=None,
            requires_response=False
        )
        
        # Clear any previous results
        self._pending_discovery_results.clear()
        
        # Send the message and wait for responses
        await self.connector.send_broadcast_message(message)
        
        # Wait for discovery results to arrive via broadcast messages
        import asyncio
        await asyncio.sleep(2)  # Give time for responses to arrive
        
        # Return collected results
        results = self._pending_discovery_results.copy()
        logger.info(f"Agent {self.agent_id} received {len(results)} conversion discovery results")
        return results
    
    async def process_incoming_mod_message(self, message: ModMessage) -> Optional[ModMessage]:
        """Process an incoming protocol message.
        
        Args:
            message: The message to handle
        
        Returns:
            Optional[ModMessage]: The processed message, or None for stopping the message from being processed further by other adapters
        """
        if message.mod != self.mod_name:
            return message
        
        # Handle conversion discovery requests
        if message.content.get("action") == DISCOVER_CONVERSION_AGENTS:
            logger.info(f"Agent {self.agent_id} received conversion discovery request from {message.sender_id}")
            await self._handle_discovery_request(message)
            return None
        
        # Handle conversion discovery results
        if message.content.get("action") == "conversion_discovery_results":
            logger.info(f"Agent {self.agent_id} received conversion discovery results: {len(message.content.get('results', []))} agents")
            # The results will be handled by the discover_conversion_agents method
            return None
        
        return message
    
    async def process_incoming_broadcast_message(self, message: BroadcastMessage) -> Optional[BroadcastMessage]:
        """Process an incoming broadcast message.
        
        Args:
            message: The message to handle
        
        Returns:
            Optional[BroadcastMessage]: The processed message, or None for stopping the message from being processed further by other adapters
        """
        if message.mod != self.mod_name:
            return message
        
        # Handle conversion discovery requests
        if message.content.get("action") == DISCOVER_CONVERSION_AGENTS:
            logger.info(f"Agent {self.agent_id} received broadcast conversion discovery request from {message.sender_id}")
            await self._handle_discovery_request(message)
            return None
        
        # Handle conversion discovery results
        if message.content.get("action") == "conversion_discovery_results":
            # Only process if this response is meant for us
            responding_to = message.content.get("responding_to")
            if responding_to == self.agent_id:
                logger.info(f"Agent {self.agent_id} received discovery results broadcast from {message.sender_id}")
                # Store the results for the waiting discovery method
                results = message.content.get("results", [])
                self._pending_discovery_results.extend(results)
            return None
        
        return message
    
    async def _announce_conversion_capabilities(self) -> None:
        """Announce this agent's conversion capabilities to the network."""
        if not self.connector or not self.agent_id:
            logger.warning("Cannot announce conversion capabilities: not connected or no agent ID")
            return
        
        logger.info(f"Agent {self.agent_id} announcing conversion capabilities: {self._conversion_capabilities}")
        logger.debug(f"Conversion capabilities type: {type(self._conversion_capabilities)}")
        if 'conversion_pairs' in self._conversion_capabilities:
            logger.debug(f"Conversion pairs: {self._conversion_capabilities['conversion_pairs']}, type: {type(self._conversion_capabilities['conversion_pairs'])}")
        
        # Make a deep copy of capabilities to avoid reference issues
        capabilities_copy = copy.deepcopy(self._conversion_capabilities)
        
        if not self.agent_id:
            logger.warning("Cannot announce conversion capabilities: no agent ID")
            return
            
        # Create announcement message with explicit direction=inbound
        message = ModMessage(
            direction="inbound",
            sender_id=self.agent_id,
            mod=self.mod_name,
            message_type="mod_message",
            relevant_agent_id=self.agent_id,
            content={
                "action": ANNOUNCE_CONVERSION_CAPABILITIES,
                "conversion_capabilities": capabilities_copy
            },
            text_representation=None,
            requires_response=False
        )
        
        logger.debug(f"Sending conversion capabilities message: {message.content}")
        
        # Send the message
        await self.connector.send_mod_message(message)
    
    async def _handle_discovery_request(self, message) -> None:
        """Handle a discovery request from another agent.
        
        Args:
            message: The discovery request message
        """
        # Don't respond to our own discovery requests
        if message.sender_id == self.agent_id:
            logger.debug(f"Agent {self.agent_id} ignoring its own discovery request")
            return
            
        if not self._conversion_capabilities or not self.connector or not self.agent_id:
            logger.debug(f"Agent {self.agent_id} cannot respond to discovery request: no capabilities or not connected")
            return
        
        query = message.content.get("query", {})
        from_mime = query.get("from_mime")
        to_mime = query.get("to_mime")
        
        if not from_mime or not to_mime:
            logger.warning(f"Agent {self.agent_id} received invalid discovery request: missing from_mime or to_mime")
            return
            
        # Check description filter if provided
        description_contains = query.get("description_contains")
        if description_contains:
            agent_description = self._conversion_capabilities.get("description", "")
            if description_contains.lower() not in agent_description.lower():
                logger.debug(f"Agent {self.agent_id} description '{agent_description}' does not contain '{description_contains}', skipping response")
                return
        
        # Check if this agent can handle the requested conversion
        conversion_pairs = self._conversion_capabilities.get("conversion_pairs", [])
        matching_pairs = []
        
        for pair in conversion_pairs:
            if pair.get("from") == from_mime and pair.get("to") == to_mime:
                matching_pairs.append(pair)
        
        if matching_pairs:
            # Create response with agent details
            agent_info = {
                "agent_id": self.agent_id,
                "conversion_capabilities": self._conversion_capabilities,
                "matching_pairs": matching_pairs
            }
            
            logger.info(f"Agent {self.agent_id} responding to discovery request: found {len(matching_pairs)} matching conversions")
            
            # Send response as broadcast so it reaches all agents including the requester
            response_message = BroadcastMessage(
                sender_id=self.agent_id,
                mod=self.mod_name,
                message_type="broadcast_message",
                content={
                    "action": "conversion_discovery_results",
                    "results": [agent_info],
                    "responding_to": message.sender_id  # Track which agent this responds to
                },
                text_representation=None,
                requires_response=False
            )
            
            await self.connector.send_broadcast_message(response_message)
        else:
            logger.debug(f"Agent {self.agent_id} has no matching conversion capabilities for {from_mime} -> {to_mime}")
    
    async def get_tools(self) -> List[AgentAdapterTool]:
        """Get the tools for the mod adapter.
        
        Returns:
            List[AgentAdapterTool]: The tools for the mod adapter
        """
        tools = []
        
        # Tool for discovering agents with specific conversion capabilities
        discover_conversion_agents_tool = AgentAdapterTool(
            name="discover_conversion_agents",
            description="Discover agents that can perform a specific MIME format conversion",
            input_schema={
                "type": "object",
                "properties": {
                    "from_mime": {
                        "type": "string",
                        "description": "Source MIME type (e.g., 'application/pdf')"
                    },
                    "to_mime": {
                        "type": "string", 
                        "description": "Target MIME type (e.g., 'text/plain')"
                    },
                    "description_contains": {
                        "type": "string",
                        "description": "Optional text to search for in agent descriptions"
                    }
                },
                "required": ["from_mime", "to_mime"]
            },
            func=self.discover_conversion_agents
        )
        tools.append(discover_conversion_agents_tool)
        
        # Tool for setting this agent's conversion capabilities
        announce_conversion_capabilities_tool = AgentAdapterTool(
            name="announce_conversion_capabilities",
            description="Announce this agent's MIME conversion capabilities to the network",
            input_schema={
                "type": "object",
                "properties": {
                    "conversion_capabilities": {
                        "type": "object",
                        "description": "Conversion capabilities with conversion_pairs and optional description",
                        "properties": {
                            "conversion_pairs": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "from": {"type": "string"},
                                        "to": {"type": "string"}
                                    },
                                    "required": ["from", "to"]
                                }
                            },
                            "description": {
                                "type": "string",
                                "description": "Optional text description of the agent's capabilities"
                            }
                        },
                        "required": ["conversion_pairs"]
                    }
                },
                "required": ["conversion_capabilities"]
            },
            func=self.set_conversion_capabilities
        )
        tools.append(announce_conversion_capabilities_tool)
        
        # Tool for adding a single conversion pair
        add_conversion_pair_tool = AgentAdapterTool(
            name="add_conversion_pair",
            description="Add a single MIME conversion pair to this agent's capabilities",
            input_schema={
                "type": "object",
                "properties": {
                    "from_mime": {
                        "type": "string",
                        "description": "Source MIME type (e.g., 'application/pdf')"
                    },
                    "to_mime": {
                        "type": "string",
                        "description": "Target MIME type (e.g., 'text/plain')"
                    }
                },
                "required": ["from_mime", "to_mime"]
            },
            func=self.add_conversion_pair
        )
        tools.append(add_conversion_pair_tool)
        
        return tools 