"""
Network-level agent discovery protocol for OpenAgents.

This protocol allows agents to announce their capabilities to the network
and for other agents to discover agents with specific capabilities.
"""

from typing import Dict, Any, Optional, List, Set
import logging
import copy
from openagents.core.base_mod import BaseMod
from openagents.models.messages import ModMessage

logger = logging.getLogger(__name__)

# Protocol constants
PROTOCOL_NAME = "openagents.mods.discovery.agent_discovery"
ANNOUNCE_CAPABILITIES = "announce_capabilities"
DISCOVER_AGENTS = "discover_agents"


class AgentDiscoveryMod(BaseMod):
    """Network protocol for agent capability discovery.
    
    This protocol allows agents to announce their capabilities to the network
    and for other agents to discover agents with specific capabilities.
    """
    
    def __init__(self, network=None):
        """Initialize the agent discovery protocol.
        
        Args:
            network: The network to bind to
        """
        super().__init__(PROTOCOL_NAME)
        # Store agent capabilities: {agent_id: {"capabilities": {...}}}
        self._agent_capabilities = {}
        self._network = network
        logger.info("Initializing agent_discovery protocol")
    
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
    
    def register_agent(self, agent_id: str, capabilities: Dict[str, Any] = None) -> None:
        """Register an agent with the protocol.
        
        Args:
            agent_id: The agent ID
            capabilities: Optional initial capabilities
        """
        if capabilities:
            self._update_agent_capabilities(agent_id, capabilities)
            logger.info(f"Agent {agent_id} registered with capabilities: {capabilities}")
        else:
            logger.info(f"Agent {agent_id} registered without capabilities")
    
    def unregister_agent(self, agent_id: str) -> None:
        """Unregister an agent from the protocol.
        
        Args:
            agent_id: The agent ID
        """
        if agent_id in self._agent_capabilities:
            del self._agent_capabilities[agent_id]
            logger.info(f"Agent {agent_id} unregistered")
    
    def get_state(self) -> Dict[str, Any]:
        """Get the current state of the protocol.
        
        Returns:
            Dict[str, Any]: Current protocol state
        """
        logger.debug(f"Getting state, agent_capabilities: {self._agent_capabilities}")
        # Create a deep copy to avoid reference issues
        state_copy = copy.deepcopy(self._agent_capabilities)
        logger.debug(f"Returning deep copied state: {state_copy}")
        return {
            "agent_capabilities": state_copy
        }
    
    def handle_register_agent(self, agent_id: str, metadata: Dict[str, Any]) -> bool:
        """Handle agent registration with this network protocol.
        
        Args:
            agent_id: Unique identifier for the agent
            metadata: Agent metadata including capabilities
            
        Returns:
            bool: True if registration was successful
        """
        # Extract capabilities from metadata if available
        if "capabilities" in metadata:
            self._update_agent_capabilities(agent_id, metadata["capabilities"])
            logger.info(f"Agent {agent_id} registered with capabilities: {metadata['capabilities']}")
        else:
            logger.info(f"Agent {agent_id} registered without capabilities")
        return True
    
    def handle_unregister_agent(self, agent_id: str) -> bool:
        """Handle agent unregistration from this network protocol.
        
        Args:
            agent_id: Unique identifier for the agent
            
        Returns:
            bool: True if unregistration was successful
        """
        if agent_id in self._agent_capabilities:
            del self._agent_capabilities[agent_id]
            logger.info(f"Agent {agent_id} unregistered, capabilities removed")
        return True
    
    async def process_protocol_message(self, message: ModMessage) -> Optional[ModMessage]:
        """Process a protocol message.
        
        Args:
            message: The protocol message to process
            
        Returns:
            Optional response message
        """
        print(f"DIRECT DEBUG - process_protocol_message called with message: {message}")
        
        if not message or not message.content:
            logger.warning("Received empty protocol message")
            return
        
        action = message.content.get("action")
        sender_id = message.sender_id
        
        print(f"PROTOCOL MESSAGE RECEIVED - From {sender_id}: {message.content}")
        logger.debug(f"PROTOCOL MESSAGE - Processing protocol message from {sender_id}: {message.content}")
        logger.debug(f"PROTOCOL MESSAGE - Message ID: {message.message_id}, Protocol: {message.mod}, Sender: {sender_id}")
        
        if action == ANNOUNCE_CAPABILITIES:
            # Agent is announcing its capabilities
            capabilities = message.content.get("capabilities", {})
            logger.debug(f"PROTOCOL MESSAGE - Received capabilities announcement from {sender_id}: {capabilities}")
            logger.debug(f"PROTOCOL MESSAGE - Capabilities type: {type(capabilities)}")
            if 'language_models' in capabilities:
                logger.debug(f"PROTOCOL MESSAGE - Language models: {capabilities['language_models']}, type: {type(capabilities['language_models'])}")
                logger.debug(f"PROTOCOL MESSAGE - Language models content: {capabilities['language_models']}")
            
            # Get current capabilities
            current_capabilities = self._agent_capabilities.get(sender_id, {})
            logger.debug(f"PROTOCOL MESSAGE - Current capabilities for {sender_id}: {current_capabilities}")
            if current_capabilities and 'language_models' in current_capabilities:
                logger.debug(f"PROTOCOL MESSAGE - Current language models: {current_capabilities['language_models']}, type: {type(current_capabilities['language_models'])}")
            
            # Make a deep copy of capabilities to avoid reference issues
            capabilities_copy = copy.deepcopy(capabilities)
            logger.debug(f"PROTOCOL MESSAGE - Deep copied capabilities: {capabilities_copy}")
            
            # Print direct comparison of language_models field
            if 'language_models' in capabilities and current_capabilities and 'language_models' in current_capabilities:
                logger.debug(f"PROTOCOL MESSAGE - DIRECT COMPARISON - New language_models: {capabilities['language_models']}, Current language_models: {current_capabilities['language_models']}")
                logger.debug(f"PROTOCOL MESSAGE - Are they equal? {capabilities['language_models'] == current_capabilities['language_models']}")
                logger.debug(f"PROTOCOL MESSAGE - ID of new language_models: {id(capabilities['language_models'])}, ID of current language_models: {id(current_capabilities['language_models'])}")
            
            # Debug log before update
            logger.debug(f"PROTOCOL MESSAGE - BEFORE UPDATE - Agent capabilities dict: {self._agent_capabilities}")
            logger.debug(f"PROTOCOL MESSAGE - BEFORE UPDATE - Agent {sender_id} capabilities: {self._agent_capabilities.get(sender_id, {})}")
            
            # Store the original agent capabilities for comparison
            original_capabilities = copy.deepcopy(self._agent_capabilities)
            
            # Update the agent capabilities
            self._update_agent_capabilities(sender_id, capabilities_copy)
            
            # Compare the original and updated capabilities
            logger.debug(f"PROTOCOL MESSAGE - COMPARISON - Original agent capabilities: {original_capabilities}")
            logger.debug(f"PROTOCOL MESSAGE - COMPARISON - Updated agent capabilities: {self._agent_capabilities}")
            logger.debug(f"PROTOCOL MESSAGE - COMPARISON - Are they equal? {original_capabilities == self._agent_capabilities}")
            
            # Get updated capabilities
            updated_capabilities = self._agent_capabilities.get(sender_id, {})
            logger.debug(f"PROTOCOL MESSAGE - Updated capabilities for {sender_id}: {updated_capabilities}")
            if updated_capabilities and 'language_models' in updated_capabilities:
                logger.debug(f"PROTOCOL MESSAGE - Updated language models: {updated_capabilities['language_models']}, type: {type(updated_capabilities['language_models'])}")
                
            # Print direct comparison after update
            if 'language_models' in capabilities and updated_capabilities and 'language_models' in updated_capabilities:
                logger.debug(f"PROTOCOL MESSAGE - AFTER UPDATE - New language_models: {capabilities['language_models']}, Updated language_models: {updated_capabilities['language_models']}")
                logger.debug(f"PROTOCOL MESSAGE - Are they equal after update? {capabilities['language_models'] == updated_capabilities['language_models']}")
                logger.debug(f"PROTOCOL MESSAGE - ID of new language_models: {id(capabilities['language_models'])}, ID of updated language_models: {id(updated_capabilities['language_models'])}")
            
            # Debug log after update
            logger.debug(f"PROTOCOL MESSAGE - AFTER UPDATE - Agent capabilities dict: {self._agent_capabilities}")
            logger.debug(f"PROTOCOL MESSAGE - AFTER UPDATE - Agent {sender_id} capabilities: {self._agent_capabilities.get(sender_id, {})}")
            
            logger.info(f"PROTOCOL MESSAGE - Agent {sender_id} announced capabilities: {capabilities}")
            
        elif action == DISCOVER_AGENTS:
            # Agent is requesting to discover other agents with specific capabilities
            query = message.content.get("query", {})
            results = self._discover_agents(query)
            
            # Send response back to the requesting agent
            response = ModMessage(
                direction="outbound",
                sender_id=self.network.network_id,
                mod=self.mod_name,
                relevant_agent_id=sender_id,
                content={
                    "action": "discovery_results",
                    "query": query,
                    "results": results
                }
            )
            
            await self.network.send_mod_message(response)
            logger.info(f"Sent discovery results to agent {sender_id} for query: {query}")
    
    def _update_agent_capabilities(self, agent_id: str, capabilities: Dict[str, Any]) -> None:
        """Update the capabilities for an agent.
        
        Args:
            agent_id: The agent ID
            capabilities: The capabilities to update
        """
        logger.debug(f"Before update, agent {agent_id} capabilities: {self._agent_capabilities.get(agent_id, {})}")
        logger.debug(f"Updating with: {capabilities}")
        
        # If agent doesn't exist yet, create a new entry with a deep copy of capabilities
        if agent_id not in self._agent_capabilities:
            self._agent_capabilities[agent_id] = copy.deepcopy(capabilities)
        else:
            # For existing agents, completely replace the capabilities dictionary
            # This ensures all fields are updated, including lists and nested structures
            self._agent_capabilities[agent_id] = copy.deepcopy(capabilities)
                
        logger.debug(f"After update, agent {agent_id} capabilities: {self._agent_capabilities.get(agent_id, {})}")
    
    def _discover_agents(self, query: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Discover agents matching the capability query.
        
        Args:
            query: Query parameters for capability matching
            
        Returns:
            List[Dict[str, Any]]: List of matching agents with their capabilities
        """
        results = []
        
        for agent_id, agent_capabilities in self._agent_capabilities.items():
            # Check if the agent's capabilities match the query
            if self._match_capabilities(query, agent_capabilities):
                results.append({
                    "agent_id": agent_id,
                    "capabilities": copy.deepcopy(agent_capabilities)
                })
        
        return results
    
    def _match_capabilities(self, query: Dict[str, Any], capabilities: Dict[str, Any]) -> bool:
        """Match capabilities recursively.
        
        Args:
            query: Query parameters for capability matching
            capabilities: Agent capabilities to match against
            
        Returns:
            bool: True if capabilities match the query, False otherwise
        """
        # Check each key-value pair in the query
        for key, value in query.items():
            if key not in capabilities:
                return False
            
            # Handle different types of matching
            if isinstance(value, list):
                # For lists, check if any item in the query list is in the agent's list
                agent_value = capabilities[key]
                if not isinstance(agent_value, list):
                    return False
                
                found_match = False
                for item in value:
                    if item in agent_value:
                        found_match = True
                        break
                
                if not found_match:
                    return False
            elif isinstance(value, dict):
                # For dicts, recursively check if the nested structure matches
                agent_value = capabilities[key]
                if not isinstance(agent_value, dict):
                    return False
                
                # Recursively check nested dictionaries
                for sub_key, sub_value in value.items():
                    if sub_key not in agent_value:
                        return False
                    
                    if isinstance(sub_value, dict):
                        # Recursively match nested dictionaries
                        if not self._match_capabilities({sub_key: sub_value}, {sub_key: agent_value[sub_key]}):
                            return False
                    else:
                        # For simple values, check for equality
                        if agent_value[sub_key] != sub_value:
                            return False
            else:
                # For simple values, check for equality
                if capabilities[key] != value:
                    return False
        
        return True 