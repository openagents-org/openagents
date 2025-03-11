"""
Agent-level registration protocol for OpenAgents.

This protocol enables agents to register with a network.
"""

import logging
import time
from typing import Dict, Any, List, Optional, Set

from openagents.core.agent_protocol_base import AgentProtocolBase

logger = logging.getLogger(__name__)


class AgentRegistrationAgentProtocol(AgentProtocolBase):
    """Agent-level registration protocol implementation.
    
    This protocol enables agents to:
    - Register with a network
    - Maintain registration status
    - Unregister from a network
    """
    
    def __init__(self, agent_id: str, config: Optional[Dict[str, Any]] = None):
        """Initialize the agent registration protocol for an agent.
        
        Args:
            agent_id: Unique identifier for the agent
            config: Optional configuration dictionary
        """
        super().__init__(agent_id, config)
        
        # Default configuration
        self.default_config = {
            "heartbeat_interval": 60.0  # seconds
        }
        
        # Apply configuration
        self.config = {**self.default_config, **(config or {})}
        
        # Initialize protocol state
        self.registered = False
        self.last_heartbeat = 0.0
        
        # Set capabilities
        self._capabilities = [
            "agent-registration"
        ]
        
        logger.info(f"Initializing AgentRegistration agent protocol for agent {agent_id}")
    
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
        # Unregister from the network
        if self.registered and self.network:
            self.unregister()
        
        return True
    
    def handle_message(self, message: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Handle an incoming message.
        
        Args:
            message: The message to handle
            
        Returns:
            Optional[Dict[str, Any]]: Optional response message
        """
        action = message.get("action")
        
        if action == "heartbeat_request":
            return self._handle_heartbeat_request(message)
        else:
            logger.warning(f"Unknown action: {action}")
            return None
    
    def _handle_heartbeat_request(self, message: Dict[str, Any]) -> Dict[str, Any]:
        """Handle a heartbeat request message.
        
        Args:
            message: The heartbeat request message
            
        Returns:
            Dict[str, Any]: Heartbeat response message
        """
        from_agent = message.get("from_agent")
        
        # Send heartbeat response
        return {
            "protocol": "AgentRegistrationAgentProtocol",
            "action": "heartbeat_response",
            "from_agent": self.agent_id,
            "to_agent": from_agent,
            "timestamp": self._get_timestamp()
        }
    
    def register(self) -> bool:
        """Register this agent with the network.
        
        Returns:
            bool: True if registration was successful, False otherwise
        """
        if not self.network:
            logger.error("Agent not connected to a network")
            return False
        
        if "AgentRegistrationNetworkProtocol" in self.network.protocols:
            registration_protocol = self.network.protocols["AgentRegistrationNetworkProtocol"]
            
            # Create a simple metadata dictionary
            metadata = {
                "agent_id": self.agent_id,
                "protocols": ["AgentRegistrationAgentProtocol"]
            }
            
            # Register with the network
            success = registration_protocol.register_agent(self.agent_id, metadata)
            
            if success:
                self.registered = True
                self.last_heartbeat = time.time()
                logger.info(f"Agent {self.agent_id} registered with network")
                return True
            else:
                logger.error(f"Failed to register agent {self.agent_id} with network")
                return False
        else:
            logger.error("Network does not support agent registration")
            return False
    
    def unregister(self) -> bool:
        """Unregister this agent from the network.
        
        Returns:
            bool: True if unregistration was successful, False otherwise
        """
        if not self.network:
            logger.error("Agent not connected to a network")
            return False
        
        if not self.registered:
            logger.warning(f"Agent {self.agent_id} not registered with network")
            return True
        
        if "AgentRegistrationNetworkProtocol" in self.network.protocols:
            registration_protocol = self.network.protocols["AgentRegistrationNetworkProtocol"]
            
            # Unregister from the network
            success = registration_protocol.unregister_agent(self.agent_id)
            
            if success:
                self.registered = False
                logger.info(f"Agent {self.agent_id} unregistered from network")
                return True
            else:
                logger.error(f"Failed to unregister agent {self.agent_id} from network")
                return False
        else:
            logger.error("Network does not support agent registration")
            return False
    
    def send_heartbeat(self) -> bool:
        """Send a heartbeat to the network to maintain registration.
        
        Returns:
            bool: True if heartbeat was successful, False otherwise
        """
        if not self.network:
            logger.error("Agent not connected to a network")
            return False
        
        if not self.registered:
            logger.warning(f"Agent {self.agent_id} not registered with network")
            return False
        
        if "AgentRegistrationNetworkProtocol" in self.network.protocols:
            registration_protocol = self.network.protocols["AgentRegistrationNetworkProtocol"]
            
            # Update agent activity - use the correct method name
            success = registration_protocol.update_agent_activity(self.agent_id)
            
            if success:
                self.last_heartbeat = time.time()
                logger.debug(f"Agent {self.agent_id} sent heartbeat to network")
                return True
            else:
                logger.error(f"Failed to send heartbeat for agent {self.agent_id}")
                return False
        else:
            logger.error("Network does not support agent registration")
            return False
    
    def is_registered(self) -> bool:
        """Check if this agent is registered with the network.
        
        Returns:
            bool: True if registered, False otherwise
        """
        if not self.network:
            logger.error("Agent not connected to a network")
            return False
        
        if "AgentRegistrationNetworkProtocol" in self.network.protocols:
            registration_protocol = self.network.protocols["AgentRegistrationNetworkProtocol"]
            return registration_protocol.is_agent_registered(self.agent_id)
        else:
            logger.error("Network does not support agent registration")
            return False
    
    def get_agent_state(self) -> Dict[str, Any]:
        """Get the current state of the agent registration protocol for this agent.
        
        Returns:
            Dict[str, Any]: Current protocol state
        """
        return {
            "registered": self.registered,
            "last_heartbeat": self.last_heartbeat
        }
    
    def _get_timestamp(self) -> float:
        """Get the current timestamp.
        
        Returns:
            float: Current timestamp
        """
        return time.time()
    
    def some_method(self):
        """Implementation of the abstract method from the base class."""
        logger.debug("AgentRegistrationAgentProtocol.some_method called")
        return True

    def get_all_agents(self) -> Dict[str, Dict[str, Any]]:
        """Get all registered agents.

        Returns:
            Dict[str, Dict[str, Any]]: Dictionary of agent IDs to agent metadata
        """
        if not self.network:
            logger.error("Agent not connected to a network")
            return {}

        if "AgentRegistrationNetworkProtocol" in self.network.protocols:
            registration_protocol = self.network.protocols["AgentRegistrationNetworkProtocol"]
            return registration_protocol.get_all_agents()
        else:
            logger.error("Network does not support agent registration")
            return {} 