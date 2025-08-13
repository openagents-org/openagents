from typing import Dict, Any, Optional, List, Set, TYPE_CHECKING
from abc import ABC, abstractmethod
import logging

# Use TYPE_CHECKING to avoid circular imports
if TYPE_CHECKING:
    from openagents.core.network import AgentNetworkServer
from openagents.models.messages import BaseMessage, ModMessage, DirectMessage, BroadcastMessage

logger = logging.getLogger(__name__)


class BaseMod(ABC):
    """Base class for network-level mods in OpenAgents.
    
    Network mods manage global state and coordinate interactions
    between agents across the network.
    """
    
    def __init__(self, mod_name: str):
        """Initialize the network mod.
        
        Args:
            name: Name for the mod
        """
        self._mod_name = mod_name
        self._network = None  # Will be set when registered with a network
        self._config = {}

        logger.info(f"Initializing network mod {self.mod_name}")
    
    def initialize(self) -> bool:
        """Initialize the mod.
        
        Returns:
            bool: True if initialization was successful, False otherwise
        """
        return True
    
    def shutdown(self) -> bool:
        """Shutdown the mod gracefully.
        
        Returns:
            bool: True if shutdown was successful, False otherwise
        """
        return True
    
    @property
    def mod_name(self) -> str:
        """Get the name of the mod.
        
        Returns:
            str: The name of the mod
        """
        return self._mod_name

    @property
    def config(self) -> Dict[str, Any]:
        """Get the configuration for the mod.
        
        Returns:
            Dict[str, Any]: The configuration for the mod
        """
        return self._config

    @property
    def network(self) -> Optional["Network"]:
        """Get the network this mod is registered with.
        
        Returns:
            Optional[Network]: The network this mod is registered with
        """
        return self._network
        
    def bind_network(self, network) -> bool:
        """Register this mod with a network.
        
        Args:
            network: The network to register with
            
        Returns:
            bool: True if registration was successful, False otherwise
        """
        self._network = network
        logger.info(f"Mod {self.mod_name} bound to network {network.network_id}")
        return True
    
    def handle_register_agent(self, agent_id: str, metadata: Dict[str, Any]) -> bool:
        """Handle agent registration with this network mod.
        
        Args:
            agent_id: Unique identifier for the agent
            metadata: Agent metadata including capabilities
            
        Returns:
            bool: True if registration was successful, False otherwise
        """
        return True
    
    def handle_unregister_agent(self, agent_id: str) -> bool:
        """Handle agent unregistration from this network mod.
        
        Args:
            agent_id: Unique identifier for the agent
            
        Returns:
            bool: True if unregistration was successful, False otherwise
        """
        return True

    def get_state(self) -> Dict[str, Any]:
        """Get the current state of the mod.
        
        Returns:
            Dict[str, Any]: Current network state
        """
        return {}
    
    def update_config(self, config: Dict[str, Any]) -> None:
        """Update the configuration for the mod.
        
        Args:
            config: The configuration to update
        """
        self._config.update(config)

    async def process_mod_message(self, message: ModMessage) -> None:
        """Process a message sent to this mod.
        
        Args:
            message: The message to handle
        
        Returns:
            None
        """

    async def process_direct_message(self, message: DirectMessage) -> Optional[DirectMessage]:
        """Process a message received from an agent directed to another agent.
        
        Args:
            message: The message to handle
        
        Returns:
            Optional[DirectMessage]: Processed message to continue processing, or None if the message is handled and no further processing is needed    
        """
        return message
    
    async def process_broadcast_message(self, message: BroadcastMessage) -> Optional[BroadcastMessage]:
        """Process a broadcast message received from an agent.
        
        Args:
            message: The broadcast message to handle
        
        Returns:
            Optional[BroadcastMessage]: Processed message to continue processing, or None if the message is handled and no further processing is needed
        """
        return message
    
    