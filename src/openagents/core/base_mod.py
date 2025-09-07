from typing import Dict, Any, Optional, List, Set, TYPE_CHECKING
from abc import ABC, abstractmethod
import logging

# Use TYPE_CHECKING to avoid circular imports
if TYPE_CHECKING:
    from openagents.core.network import AgentNetworkServer
from openagents.models.messages import Event, EventNames

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

    async def process_system_message(self, message: Event) -> Optional[Event]:
        """Process a system message in the ordered mod pipeline.
        
        System messages are processed through all mods in order. This is called for:
        - Inbound system messages (agent → system): processed by all mods, then network core
        - Internal system messages (mod → network): processed by all mods, then network core
        
        If this mod handles the message and wants to stop further processing,
        return None. Otherwise, return the original or modified message to continue
        processing through the next mod in the pipeline.
        
        Args:
            message: The system message to handle (event_name not starting with "agent.direct_message." or "agent.broadcast_message.")
        
        Returns:
            Optional[Event]: Processed message to continue processing, or None to stop propagation
        """
        return message

    async def process_direct_message(self, message: Event) -> Optional[Event]:
        """Process a direct message in the ordered mod pipeline.
        
        Direct messages are processed through all mods in order before being delivered
        to the target agent. This is called for messages with event_name starting with
        "agent.direct_message."
        
        If this mod handles the message and wants to stop delivery to the target agent,
        return None. Otherwise, return the original or modified message to continue
        processing through the next mod in the pipeline.
        
        Args:
            message: The direct message to handle (event_name starts with "agent.direct_message.")
        
        Returns:
            Optional[Event]: Processed message to continue processing, or None to stop propagation
        """
        return message
    
    async def process_broadcast_message(self, message: Event) -> Optional[Event]:
        """Process a broadcast message in the ordered mod pipeline.
        
        Broadcast messages are processed through all mods in order before being delivered
        to all agents in the network. This is called for messages with event_name starting
        with "agent.broadcast_message."
        
        If this mod handles the message and wants to stop delivery to all agents,
        return None. Otherwise, return the original or modified message to continue
        processing through the next mod in the pipeline.
        
        Args:
            message: The broadcast message to handle (event_name starts with "agent.broadcast_message.")
        
        Returns:
            Optional[Event]: Processed message to continue processing, or None to stop propagation
        """
        return message
    
    