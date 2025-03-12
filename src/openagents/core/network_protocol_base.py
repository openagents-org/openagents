from typing import Dict, Any, Optional, List, Set
from openagents.core.protocol_base import ProtocolBase
from abc import ABC, abstractmethod
import logging
import json

logger = logging.getLogger(__name__)


class NetworkProtocolBase(ProtocolBase):
    """Base class for network-level protocols in OpenAgents.
    
    Network protocols manage global state and coordinate interactions
    between agents across the network.
    """
    
    def __init__(self, name: str = None, config: Optional[Dict[str, Any]] = None):
        """Initialize the network protocol.
        
        Args:
            name: Optional name for the protocol (defaults to class name)
            config: Optional configuration dictionary
        """
        super().__init__(config)
        self.name = name or self.__class__.__name__
        self.network = None  # Will be set when registered with a network
        self.active_agents: Set[str] = set()
        
        logger.info(f"Initializing network protocol {self.name}")
    
    @property
    def protocol_type(self) -> str:
        """Get the type of this protocol.
        
        Returns:
            str: 'network' indicating this is a network-level protocol
        """
        return "network"
    
    def register_with_network(self, network) -> bool:
        """Register this protocol with a network.
        
        Args:
            network: The network to register with
            
        Returns:
            bool: True if registration was successful, False otherwise
        """
        self.network = network
        logger.info(f"Protocol {self.name} registered with network {network.network_id}")
        return True
    
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

    def handle_message(self, message: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Handle a message sent to this protocol.
        
        Args:
            message: The message to handle
            
        Returns:
            Optional[Dict[str, Any]]: Optional response message
        """
        logger.debug(f"Protocol {self.name} handling message: {message}")
        return None 

    async def handle_remote_message(self, message_data):
        """Handle a message received from a remote agent.
        
        Args:
            message_data (dict): The message data
            
        Returns:
            Any: Result of handling the message
        """
        # Default implementation does nothing
        pass
    
    async def send_remote_message(self, target_agent_id, message_type, content):
        """Send a message to a remote agent.
        
        Args:
            target_agent_id (str): ID of the target agent
            message_type (str): Type of message
            content (Any): Message content
            
        Returns:
            bool: True if message sent successfully, False otherwise
        """
        if not hasattr(self.network, 'server_connection'):
            return False
            
        try:
            await self.network.server_connection.send(json.dumps({
                "type": "message",
                "message_type": message_type,
                "source_agent_id": self.agent.id if hasattr(self, 'agent') else None,
                "target_agent_id": target_agent_id,
                "content": content
            }))
            return True
        except Exception as e:
            print(f"Error sending remote message: {e}")
            return False 