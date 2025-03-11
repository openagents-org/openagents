from typing import Dict, Any, Optional, List, Set
from openagents.core.protocol_base import ProtocolBase
from abc import ABC, abstractmethod


class NetworkProtocolBase(ProtocolBase):
    """Base class for network-level protocols in OpenAgents.
    
    Network protocols manage global state and coordinate interactions
    between agents across the network.
    """
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """Initialize the network protocol with optional configuration.
        
        Args:
            config: Optional configuration dictionary for the protocol
        """
        super().__init__(config)
        self.active_agents: Set[str] = set()
    
    @property
    def protocol_type(self) -> str:
        """Get the type of this protocol.
        
        Returns:
            str: 'network' indicating this is a network-level protocol
        """
        return "network"
    
    @abstractmethod
    def register_agent(self, agent_id: str, metadata: Dict[str, Any]) -> bool:
        """Register an agent with this network protocol.
        
        Args:
            agent_id: Unique identifier for the agent
            metadata: Agent metadata including capabilities
            
        Returns:
            bool: True if registration was successful, False otherwise
        """
        pass
    
    @abstractmethod
    def unregister_agent(self, agent_id: str) -> bool:
        """Unregister an agent from this network protocol.
        
        Args:
            agent_id: Unique identifier for the agent
            
        Returns:
            bool: True if unregistration was successful, False otherwise
        """
        pass
    
    @abstractmethod
    def get_network_state(self) -> Dict[str, Any]:
        """Get the current state of the network for this protocol.
        
        Returns:
            Dict[str, Any]: Current network state
        """
        pass

    @abstractmethod
    def some_method(self):
        pass 