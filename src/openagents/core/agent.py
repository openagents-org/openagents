from typing import Dict, Any, List, Optional, Set, Type
import uuid
import logging
from .agent_protocol_base import AgentProtocolBase

logger = logging.getLogger(__name__)


class Agent:
    """Core agent implementation for OpenAgents.
    
    An agent is an entity that can participate in a network by implementing
    one or more protocols.
    """
    
    def __init__(self, agent_id: Optional[str] = None, name: Optional[str] = None):
        """Initialize an agent with optional ID and name.
        
        Args:
            agent_id: Optional unique identifier for the agent. If not provided,
                     a UUID will be generated.
            name: Optional human-readable name for the agent.
        """
        self.agent_id = agent_id or str(uuid.uuid4())
        self.name = name or f"Agent-{self.agent_id[:8]}"
        self.protocols: Dict[str, AgentProtocolBase] = {}
        self.network = None
        self.is_running = False
        self.metadata: Dict[str, Any] = {
            "name": self.name,
            "capabilities": set()
        }
    
    def register_protocol(self, protocol_instance: AgentProtocolBase) -> bool:
        """Register a protocol with this agent.
        
        Args:
            protocol_instance: An instance of an agent protocol
            
        Returns:
            bool: True if registration was successful, False otherwise
        """
        protocol_name = protocol_instance.__class__.__name__
        if protocol_name in self.protocols:
            logger.warning(f"Protocol {protocol_name} already registered with agent {self.agent_id}")
            return False
        
        self.protocols[protocol_name] = protocol_instance
        self.metadata["capabilities"].update(protocol_instance.capabilities)
        logger.info(f"Registered protocol {protocol_name} with agent {self.agent_id}")
        return True
    
    def unregister_protocol(self, protocol_name: str) -> bool:
        """Unregister a protocol from this agent.
        
        Args:
            protocol_name: Name of the protocol to unregister
            
        Returns:
            bool: True if unregistration was successful, False otherwise
        """
        if protocol_name not in self.protocols:
            logger.warning(f"Protocol {protocol_name} not registered with agent {self.agent_id}")
            return False
        
        protocol = self.protocols.pop(protocol_name)
        self.metadata["capabilities"] -= set(protocol.capabilities)
        logger.info(f"Unregistered protocol {protocol_name} from agent {self.agent_id}")
        return True
    
    def join_network(self, network):
        """Join a network.
        
        Args:
            network: Network to join
        """
        if not self.is_running:
            logger.error(f"Agent {self.agent_id} must be started before joining a network")
            return False
        
        # Set the network reference for all protocols
        for protocol in self.protocols.values():
            protocol.network = network
        
        # Register with the network
        success = network.register_agent(self.agent_id, self.get_metadata())
        if success:
            self.network = network
            network.connected_agents.append(self)  # Add to connected agents
            logger.info(f"Agent {self.agent_id} joined network {network.network_id}")
        else:
            logger.error(f"Failed to register agent {self.agent_id} with network {network.network_id}")
        
        return success
    
    def leave_network(self) -> bool:
        """Leave the current network.
        
        Returns:
            bool: True if the agent successfully left the network, False otherwise
        """
        if not self.network:
            logger.warning(f"Agent {self.agent_id} not connected to a network")
            return True
        
        # Unregister from all network protocols
        success = True
        for protocol_name, protocol in list(self.protocols.items()):
            try:
                if hasattr(protocol, 'unregister') and callable(protocol.unregister):
                    protocol.unregister()
            except Exception as e:
                logger.error(f"Failed to unregister agent {self.agent_id} from protocol {protocol_name}: {e}")
                success = False
        
        # Remove from network's connected agents list
        if self in self.network.connected_agents:
            self.network.connected_agents.remove(self)
        
        # Clear network reference
        self.network = None
        
        return success
    
    def start(self) -> bool:
        """Start the agent and initialize all protocols.
        
        Returns:
            bool: True if startup was successful, False otherwise
        """
        if self.is_running:
            logger.warning(f"Agent {self.agent_id} already running")
            return False
        
        for protocol_name, protocol in self.protocols.items():
            if not protocol.initialize():
                logger.error(f"Failed to initialize protocol {protocol_name}")
                return False
        
        self.is_running = True
        logger.info(f"Agent {self.agent_id} started successfully")
        return True
    
    def stop(self) -> bool:
        """Stop the agent and shutdown all protocols.
        
        Returns:
            bool: True if shutdown was successful, False otherwise
        """
        if not self.is_running:
            logger.warning(f"Agent {self.agent_id} not running")
            return False
        
        if self.network:
            self.leave_network()
        
        for protocol_name, protocol in self.protocols.items():
            if not protocol.shutdown():
                logger.error(f"Failed to shutdown protocol {protocol_name}")
                return False
        
        self.is_running = False
        logger.info(f"Agent {self.agent_id} stopped successfully")
        return True
    
    def handle_message(self, message: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Handle an incoming message by routing it to the appropriate protocol.
        
        Args:
            message: The message to handle
            
        Returns:
            Optional[Dict[str, Any]]: Optional response message
        """
        if not self.is_running:
            logger.warning(f"Agent {self.agent_id} not running, cannot handle message")
            return None
        
        protocol_name = message.get("protocol")
        if not protocol_name:
            logger.error(f"Message missing protocol field: {message}")
            return None
        
        if protocol_name not in self.protocols:
            logger.error(f"Protocol {protocol_name} not registered with agent {self.agent_id}")
            return None
        
        return self.protocols[protocol_name].handle_message(message)
    
    def get_capabilities(self) -> Set[str]:
        """Get all capabilities of this agent across all protocols.
        
        Returns:
            Set[str]: Set of capability identifiers
        """
        return self.metadata["capabilities"]
    
    def get_state(self) -> Dict[str, Any]:
        """Get the current state of this agent across all protocols.
        
        Returns:
            Dict[str, Any]: Current agent state
        """
        state = {
            "agent_id": self.agent_id,
            "name": self.name,
            "is_running": self.is_running,
            "capabilities": list(self.get_capabilities()),
            "protocols": {}
        }
        
        for protocol_name, protocol in self.protocols.items():
            state["protocols"][protocol_name] = protocol.get_agent_state()
        
        return state
    
    def get_metadata(self) -> Dict[str, Any]:
        """Get metadata about this agent.
        
        Returns:
            Dict[str, Any]: Agent metadata including capabilities and services
        """
        metadata = {
            "name": self.name,
            "agent_id": self.agent_id,
            "capabilities": list(self.get_capabilities()),
            "protocols": list(self.protocols.keys()),
            "is_running": self.is_running
        }
        
        # Add services if using DiscoveryAgentProtocol
        if "DiscoveryAgentProtocol" in self.protocols:
            discovery_protocol = self.protocols["DiscoveryAgentProtocol"]
            if hasattr(discovery_protocol, "services"):
                metadata["services"] = list(discovery_protocol.services.keys())
        
        return metadata 