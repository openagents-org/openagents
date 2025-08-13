"""
Network-level OpenConvert discovery protocol for OpenAgents.

This protocol allows agents to announce their MIME file format conversion capabilities 
to the network and for other agents to discover agents that can perform specific 
MIME format conversions.
"""

from typing import Dict, Any, Optional, List, Set, Tuple
import logging
import copy
from openagents.core.base_mod import BaseMod
from openagents.models.messages import ModMessage

logger = logging.getLogger(__name__)

# Protocol constants
PROTOCOL_NAME = "openagents.mods.discovery.openconvert_discovery"
ANNOUNCE_CONVERSION_CAPABILITIES = "announce_conversion_capabilities"
DISCOVER_CONVERSION_AGENTS = "discover_conversion_agents"


class OpenConvertDiscoveryMod(BaseMod):
    """Network protocol for OpenConvert agent capability discovery.
    
    This protocol allows agents to announce their MIME file format conversion 
    capabilities and for other agents to discover agents that can perform 
    specific conversions.
    """
    
    def __init__(self, network=None):
        """Initialize the OpenConvert discovery protocol.
        
        Args:
            network: The network to bind to
        """
        super().__init__(PROTOCOL_NAME)
        # Store agent conversion capabilities: {agent_id: {"conversion_pairs": [...], "description": "..."}}
        self._agent_conversion_capabilities = {}
        self._network = network
        logger.info("Initializing openconvert_discovery protocol")
    
    def initialize(self) -> bool:
        """Initialize the protocol.
        
        Returns:
            bool: True if initialization was successful
        """
        logger.info(f"Initializing {self.mod_name} protocol")
        return True
    
    def shutdown(self) -> bool:
        """Shutdown the protocol gracefully.
        
        Returns:
            bool: True if shutdown was successful
        """
        logger.info(f"Shutting down {self.mod_name} protocol")
        return True
    
    def register_agent(self, agent_id: str, capabilities: Optional[Dict[str, Any]] = None) -> None:
        """Register an agent with the protocol.
        
        Args:
            agent_id: The agent ID
            capabilities: Optional initial conversion capabilities
        """
        if capabilities:
            self._update_agent_conversion_capabilities(agent_id, capabilities)
            logger.info(f"Agent {agent_id} registered with conversion capabilities: {capabilities}")
        else:
            logger.info(f"Agent {agent_id} registered without conversion capabilities")
    
    def unregister_agent(self, agent_id: str) -> None:
        """Unregister an agent from the protocol.
        
        Args:
            agent_id: The agent ID
        """
        if agent_id in self._agent_conversion_capabilities:
            del self._agent_conversion_capabilities[agent_id]
            logger.info(f"Agent {agent_id} unregistered")
    
    def get_state(self) -> Dict[str, Any]:
        """Get the current state of the protocol.
        
        Returns:
            Dict[str, Any]: Current protocol state
        """
        logger.debug(f"Getting state, agent_conversion_capabilities: {self._agent_conversion_capabilities}")
        # Create a deep copy to avoid reference issues
        state_copy = copy.deepcopy(self._agent_conversion_capabilities)
        logger.debug(f"Returning deep copied state: {state_copy}")
        return {
            "agent_conversion_capabilities": state_copy
        }
    
    def handle_register_agent(self, agent_id: str, metadata: Dict[str, Any]) -> bool:
        """Handle agent registration with this network protocol.
        
        Args:
            agent_id: Unique identifier for the agent
            metadata: Agent metadata including conversion capabilities
            
        Returns:
            bool: True if registration was successful
        """
        # Extract conversion capabilities from metadata if available
        if "conversion_capabilities" in metadata:
            self._update_agent_conversion_capabilities(agent_id, metadata["conversion_capabilities"])
            logger.info(f"Agent {agent_id} registered with conversion capabilities: {metadata['conversion_capabilities']}")
        else:
            logger.info(f"Agent {agent_id} registered without conversion capabilities")
        return True
    
    def handle_unregister_agent(self, agent_id: str) -> bool:
        """Handle agent unregistration from this network protocol.
        
        Args:
            agent_id: Unique identifier for the agent
            
        Returns:
            bool: True if unregistration was successful
        """
        if agent_id in self._agent_conversion_capabilities:
            del self._agent_conversion_capabilities[agent_id]
            logger.info(f"Agent {agent_id} unregistered, conversion capabilities removed")
        return True
    
    async def process_protocol_message(self, message: ModMessage) -> Optional[ModMessage]:
        """Process a protocol message.
        
        Args:
            message: The protocol message to process
            
        Returns:
            Optional response message
        """
        logger.debug(f"process_protocol_message called with message: {message}")
        
        if not message or not message.content:
            logger.warning("Received empty protocol message")
            return
        
        action = message.content.get("action")
        sender_id = message.sender_id
        
        logger.debug(f"Processing protocol message from {sender_id}: {message.content}")
        logger.debug(f"Message ID: {message.message_id}, Protocol: {message.mod}, Sender: {sender_id}")
        
        if action == ANNOUNCE_CONVERSION_CAPABILITIES:
            # Agent is announcing its conversion capabilities
            conversion_capabilities = message.content.get("conversion_capabilities", {})
            logger.debug(f"Received conversion capabilities announcement from {sender_id}: {conversion_capabilities}")
            
            # Make a deep copy of capabilities to avoid reference issues
            capabilities_copy = copy.deepcopy(conversion_capabilities)
            logger.debug(f"Deep copied conversion capabilities: {capabilities_copy}")
            
            # Debug log before update
            logger.debug(f"BEFORE UPDATE - Agent conversion capabilities dict: {self._agent_conversion_capabilities}")
            logger.debug(f"BEFORE UPDATE - Agent {sender_id} capabilities: {self._agent_conversion_capabilities.get(sender_id, {})}")
            
            # Update the agent capabilities
            self._update_agent_conversion_capabilities(sender_id, capabilities_copy)
            
            # Debug log after update
            logger.debug(f"AFTER UPDATE - Agent conversion capabilities dict: {self._agent_conversion_capabilities}")
            logger.debug(f"AFTER UPDATE - Agent {sender_id} capabilities: {self._agent_conversion_capabilities.get(sender_id, {})}")
            
            logger.info(f"Agent {sender_id} announced conversion capabilities: {conversion_capabilities}")
            
        elif action == DISCOVER_CONVERSION_AGENTS:
            # Agent is requesting to discover other agents with specific conversion capabilities
            query = message.content.get("query", {})
            results = self._discover_conversion_agents(query)
            
            # Send response back to the requesting agent
            if self.network:
                response = ModMessage(
                    message_type="mod_message",
                    direction="outbound",
                    sender_id=self.network.network_id,
                    mod=self.mod_name,
                    relevant_agent_id=sender_id,
                    text_representation=None,
                    requires_response=False,
                    content={
                        "action": "conversion_discovery_results",
                        "query": query,
                        "results": results
                    }
                )
                
                await self.network.send_message(response)
                logger.info(f"Sent conversion discovery results to agent {sender_id} for query: {query}")
            else:
                logger.warning("Cannot send response: network not available")
    
    def _update_agent_conversion_capabilities(self, agent_id: str, capabilities: Dict[str, Any]) -> None:
        """Update the conversion capabilities for an agent.
        
        Args:
            agent_id: The agent ID
            capabilities: The conversion capabilities to update
        """
        logger.debug(f"Before update, agent {agent_id} conversion capabilities: {self._agent_conversion_capabilities.get(agent_id, {})}")
        logger.debug(f"Updating with: {capabilities}")
        
        # Validate the capabilities structure
        if not isinstance(capabilities, dict):
            logger.warning(f"Invalid capabilities structure for agent {agent_id}: {capabilities}")
            return
            
        # Ensure conversion_pairs is a list if provided
        if "conversion_pairs" in capabilities:
            if not isinstance(capabilities["conversion_pairs"], list):
                logger.warning(f"conversion_pairs should be a list for agent {agent_id}")
                return
                
        # For existing agents, completely replace the capabilities dictionary
        # This ensures all fields are updated, including lists and nested structures
        self._agent_conversion_capabilities[agent_id] = copy.deepcopy(capabilities)
                
        logger.debug(f"After update, agent {agent_id} conversion capabilities: {self._agent_conversion_capabilities.get(agent_id, {})}")
    
    def _discover_conversion_agents(self, query: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Discover agents matching the conversion capability query.
        
        Args:
            query: Query parameters for conversion capability matching
            
        Returns:
            List[Dict[str, Any]]: List of matching agents with their conversion capabilities
        """
        results = []
        
        for agent_id, agent_capabilities in self._agent_conversion_capabilities.items():
            # Check if the agent's conversion capabilities match the query
            if self._match_conversion_capabilities(query, agent_capabilities):
                results.append({
                    "agent_id": agent_id,
                    "conversion_capabilities": copy.deepcopy(agent_capabilities)
                })
        
        return results
    
    def _match_conversion_capabilities(self, query: Dict[str, Any], capabilities: Dict[str, Any]) -> bool:
        """Match conversion capabilities against a query.
        
        Args:
            query: Query parameters for conversion capability matching
            capabilities: Agent conversion capabilities to match against
            
        Returns:
            bool: True if capabilities match the query, False otherwise
        """
        # Handle conversion pair matching
        if "from_mime" in query and "to_mime" in query:
            from_mime = query["from_mime"]
            to_mime = query["to_mime"]
            
            # Check if agent has conversion_pairs
            if "conversion_pairs" not in capabilities:
                return False
                
            conversion_pairs = capabilities["conversion_pairs"]
            if not isinstance(conversion_pairs, list):
                return False
                
            # Look for a matching conversion pair
            for pair in conversion_pairs:
                if isinstance(pair, dict):
                    if pair.get("from") == from_mime and pair.get("to") == to_mime:
                        return True
                elif isinstance(pair, (list, tuple)) and len(pair) >= 2:
                    if pair[0] == from_mime and pair[1] == to_mime:
                        return True
        
        # Handle text description matching (optional)
        if "description_contains" in query:
            search_text = query["description_contains"].lower()
            agent_description = capabilities.get("description", "").lower()
            if search_text not in agent_description:
                return False
        
        # Handle exact field matching for other fields
        for key, value in query.items():
            if key not in ["from_mime", "to_mime", "description_contains"]:
                if key not in capabilities:
                    return False
                if capabilities[key] != value:
                    return False
        
        return True 