"""
Network-level agent registration protocol for OpenAgents.

This protocol enables agent registration within a network.
"""

import logging
import time
from typing import Dict, Any, List, Optional, Set

from openagents.core.network_protocol_base import NetworkProtocolBase

logger = logging.getLogger(__name__)


class AgentRegistrationNetworkProtocol(NetworkProtocolBase):
    """Network-level agent registration protocol implementation.
    
    This protocol enables:
    - Agent registration with the network
    - Agent activity tracking
    - Agent unregistration
    """
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """Initialize the agent registration protocol for a network.
        
        Args:
            config: Optional configuration dictionary
        """
        super().__init__(config)
        
        # Default configuration
        self.default_config = {
            "cleanup_interval": 300.0,  # seconds
            "max_inactive_time": 600.0  # seconds
        }
        
        # Apply configuration
        self.config = {**self.default_config, **(config or {})}
        
        # Initialize protocol state
        self.agents: Dict[str, Dict[str, Any]] = {}  # agent_id -> metadata
        self.last_active: Dict[str, float] = {}  # agent_id -> timestamp
        
        # Set capabilities
        self._capabilities = [
            "agent-registration"
        ]
        
        logger.info("Initializing AgentRegistration network protocol")
    
    @property
    def capabilities(self) -> List[str]:
        """Get the capabilities of this protocol.
        
        Returns:
            List[str]: List of capabilities
        """
        return self._capabilities
    
    def initialize(self) -> bool:
        """Initialize the protocol.
        
        Returns:
            bool: True if initialization was successful, False otherwise
        """
        return True
    
    def shutdown(self) -> bool:
        """Shutdown the protocol.
        
        Returns:
            bool: True if shutdown was successful, False otherwise
        """
        # Clear all state
        self.agents.clear()
        self.last_active.clear()
        
        return True
    
    def register_agent(self, agent_id: str, metadata: Dict[str, Any]) -> bool:
        """Register an agent with this protocol.
        
        Args:
            agent_id: Unique identifier for the agent
            metadata: Agent metadata
            
        Returns:
            bool: True if registration was successful, False otherwise
        """
        self.agents[agent_id] = metadata
        self.last_active[agent_id] = time.time()
        
        logger.info(f"Registered agent {agent_id} with AgentRegistration protocol")
        return True
    
    def unregister_agent(self, agent_id: str) -> bool:
        """Unregister an agent from this protocol.
        
        Args:
            agent_id: ID of the agent to unregister
            
        Returns:
            bool: True if unregistration was successful, False otherwise
        """
        if agent_id not in self.agents:
            logger.warning(f"Agent {agent_id} not registered with AgentRegistration protocol")
            return False
        
        # Remove agent from registry
        self.agents.pop(agent_id)
        self.last_active.pop(agent_id, None)
        
        # Notify other protocols about agent unregistration
        if self.network:
            # Notify discoverability protocol
            if "DiscoverabilityNetworkProtocol" in self.network.protocols:
                discoverability_protocol = self.network.protocols["DiscoverabilityNetworkProtocol"]
                discoverability_protocol.unregister_agent(agent_id)
        
        logger.info(f"Unregistered agent {agent_id} from AgentRegistration protocol")
        return True
    
    def update_agent_activity(self, agent_id: str) -> bool:
        """Update the last active timestamp for an agent.
        
        Args:
            agent_id: ID of the agent
            
        Returns:
            bool: True if update was successful, False otherwise
        """
        if agent_id not in self.agents:
            logger.warning(f"Agent {agent_id} not registered with AgentRegistration protocol")
            return False
        
        self.last_active[agent_id] = time.time()
        return True
    
    def is_agent_registered(self, agent_id: str) -> bool:
        """Check if an agent is registered.
        
        Args:
            agent_id: ID of the agent
            
        Returns:
            bool: True if registered, False otherwise
        """
        return agent_id in self.agents
    
    def get_agent_metadata(self, agent_id: str) -> Optional[Dict[str, Any]]:
        """Get metadata for an agent.
        
        Args:
            agent_id: ID of the agent
            
        Returns:
            Optional[Dict[str, Any]]: Agent metadata if available, None otherwise
        """
        return self.agents.get(agent_id)
    
    def get_all_agents(self) -> Dict[str, Dict[str, Any]]:
        """Get all registered agents.
        
        Returns:
            Dict[str, Dict[str, Any]]: Dictionary of agent IDs to agent metadata
        """
        # Clean up inactive agents
        self._clean_inactive_agents()
        
        return self.agents.copy()
    
    def get_network_state(self) -> Dict[str, Any]:
        """Get the current state of the agent registration protocol.
        
        Returns:
            Dict[str, Any]: Current protocol state
        """
        return {
            "registered_agents": len(self.agents)
        }
    
    def _clean_inactive_agents(self) -> None:
        """Clean up inactive agents."""
        current_time = time.time()
        inactive_agents = []
        
        for agent_id, last_active in self.last_active.items():
            if current_time - last_active > self.config["max_inactive_time"]:
                inactive_agents.append(agent_id)
        
        for agent_id in inactive_agents:
            logger.info(f"Removing inactive agent {agent_id}")
            self.unregister_agent(agent_id)
    
    def some_method(self):
        """Implementation of the abstract method from the base class."""
        logger.debug("AgentRegistrationNetworkProtocol.some_method called")
        return True 