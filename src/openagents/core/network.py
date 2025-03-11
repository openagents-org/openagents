from typing import Dict, Any, List, Optional, Set, Type
import uuid
import logging
from .agent import Agent
from .network_protocol_base import NetworkProtocolBase

logger = logging.getLogger(__name__)


class Network:
    """Core network implementation for OpenAgents.
    
    A network is a collection of agents that can communicate with each other
    using a set of protocols.
    """
    
    def __init__(self, network_id: Optional[str] = None, name: Optional[str] = None):
        """Initialize a network with optional ID and name.
        
        Args:
            network_id: Optional unique identifier for the network. If not provided,
                       a UUID will be generated.
            name: Optional human-readable name for the network.
        """
        self.network_id = network_id or str(uuid.uuid4())
        self.name = name or f"Network-{self.network_id[:8]}"
        self.protocols: Dict[str, NetworkProtocolBase] = {}
        self.agents: Dict[str, Dict[str, Any]] = {}  # agent_id -> metadata
        self.connected_agents = []  # List of actual agent objects
        self.is_running = False
    
    def register_protocol(self, protocol) -> bool:
        """Register a protocol with this network.
        
        Args:
            protocol: Protocol to register
            
        Returns:
            bool: True if registration was successful, False otherwise
        """
        protocol_name = protocol.__class__.__name__
        
        if protocol_name in self.protocols:
            logger.warning(f"Protocol {protocol_name} already registered with network {self.network_id}")
            return False
        
        # Set the network reference in the protocol
        if hasattr(protocol, 'register_with_network'):
            protocol.register_with_network(self)
        else:
            protocol.network = self
        
        self.protocols[protocol_name] = protocol
        logger.info(f"Registered protocol {protocol_name} with network {self.network_id}")
        return True
    
    def unregister_protocol(self, protocol_name: str) -> bool:
        """Unregister a protocol from this network.
        
        Args:
            protocol_name: Name of the protocol to unregister
            
        Returns:
            bool: True if unregistration was successful, False otherwise
        """
        if protocol_name not in self.protocols:
            logger.warning(f"Protocol {protocol_name} not registered with network {self.network_id}")
            return False
        
        self.protocols.pop(protocol_name)
        logger.info(f"Unregistered protocol {protocol_name} from network {self.network_id}")
        return True
    
    def register_agent(self, agent_id: str, metadata: Dict[str, Any]) -> bool:
        """Register an agent with this network.
        
        Args:
            agent_id: Unique identifier for the agent
            metadata: Agent metadata including capabilities
            
        Returns:
            bool: True if registration was successful, False otherwise
        """
        if agent_id in self.agents:
            logger.warning(f"Agent {agent_id} already registered with network {self.network_id}")
            return False
        
        agent_name = metadata.get("name", agent_id)
        self.agents[agent_id] = metadata
        
        # Register agent with all protocols
        for protocol_name, protocol in self.protocols.items():
            try:
                protocol.register_agent(agent_id, metadata)
                logger.info(f"Registered agent {agent_name} ({agent_id}) with protocol {protocol_name}")
            except Exception as e:
                logger.error(f"Failed to register agent {agent_name} ({agent_id}) with protocol {protocol_name}: {e}")
                # Continue with other protocols even if one fails
        
        # Log detailed agent information
        protocols = metadata.get("protocols", [])
        capabilities = metadata.get("capabilities", [])
        services = metadata.get("services", [])
        
        logger.info(f"Agent {agent_name} ({agent_id}) joined network {self.name} ({self.network_id})")
        logger.info(f"  - Protocols: {', '.join(protocols) if protocols else 'None'}")
        logger.info(f"  - Capabilities: {', '.join(capabilities) if capabilities else 'None'}")
        logger.info(f"  - Services: {', '.join(services) if services else 'None'}")
        
        return True
    
    def unregister_agent(self, agent_id: str) -> bool:
        """Unregister an agent from this network.
        
        Args:
            agent_id: ID of the agent to unregister
            
        Returns:
            bool: True if unregistration was successful, False otherwise
        """
        if agent_id not in self.agents:
            logger.warning(f"Agent {agent_id} not registered with network {self.network_id}")
            return False
        
        agent_metadata = self.agents.get(agent_id, {})
        agent_name = agent_metadata.get("name", agent_id)
        
        # Unregister agent from all network protocols
        for protocol_name, protocol in self.protocols.items():
            try:
                protocol.unregister_agent(agent_id)
                logger.info(f"Unregistered agent {agent_name} ({agent_id}) from protocol {protocol_name}")
            except Exception as e:
                logger.error(f"Failed to unregister agent {agent_name} ({agent_id}) from protocol {protocol_name}: {e}")
                return False
        
        self.agents.pop(agent_id)
        logger.info(f"Agent {agent_name} ({agent_id}) left network {self.name} ({self.network_id})")
        
        return True
    
    def start(self) -> bool:
        """Start the network and initialize all protocols.
        
        Returns:
            bool: True if startup was successful, False otherwise
        """
        if self.is_running:
            logger.warning(f"Network {self.network_id} already running")
            return False
        
        for protocol_name, protocol in self.protocols.items():
            if not protocol.initialize():
                logger.error(f"Failed to initialize protocol {protocol_name}")
                return False
        
        self.is_running = True
        logger.info(f"Network {self.network_id} started successfully")
        return True
    
    def stop(self) -> bool:
        """Stop the network and shutdown all protocols.
        
        Returns:
            bool: True if shutdown was successful, False otherwise
        """
        if not self.is_running:
            logger.warning(f"Network {self.network_id} not running")
            return False
        
        for protocol_name, protocol in self.protocols.items():
            if not protocol.shutdown():
                logger.error(f"Failed to shutdown protocol {protocol_name}")
                return False
        
        self.is_running = False
        logger.info(f"Network {self.network_id} stopped successfully")
        return True
    
    def route_message(self, sender_id: str, recipient_id: str, message: Dict[str, Any]) -> bool:
        """Route a message from one agent to another.
        
        Args:
            sender_id: ID of the sending agent
            recipient_id: ID of the recipient agent
            message: Message to route
            
        Returns:
            bool: True if message was routed successfully, False otherwise
        """
        if not self.is_running:
            logger.warning(f"Network {self.network_id} not running, cannot route message")
            return False
        
        if sender_id != "network" and sender_id not in self.agents:
            logger.error(f"Sending agent {sender_id} not registered with network {self.network_id}")
            return False
        
        if recipient_id not in self.agents:
            logger.error(f"Recipient agent {recipient_id} not registered with network {self.network_id}")
            return False
        
        # Get the protocol name from the message
        protocol_name = message.get("protocol")
        
        if not protocol_name:
            logger.error(f"Message missing protocol field: {message}")
            return False
        
        # Find the agent that should receive this message
        for agent in self.connected_agents:
            if agent.agent_id == recipient_id:
                # Find the protocol in the agent
                if protocol_name in agent.protocols:
                    protocol = agent.protocols[protocol_name]
                    protocol.handle_message(message)
                    return True
                else:
                    logger.error(f"Agent {recipient_id} does not have protocol {protocol_name}")
                    return False
        
        logger.error(f"Could not find agent {recipient_id} in connected agents")
        return False
    
    def broadcast_message(self, from_agent_id: str, message: Dict[str, Any]) -> bool:
        """Broadcast a message from one agent to all other agents.
        
        Args:
            from_agent_id: ID of the sending agent
            message: The message to broadcast
            
        Returns:
            bool: True if broadcasting was successful, False otherwise
        """
        if not self.is_running:
            logger.warning(f"Network {self.network_id} not running, cannot broadcast message")
            return False
        
        if from_agent_id not in self.agents:
            logger.error(f"Sending agent {from_agent_id} not registered with network {self.network_id}")
            return False
        
        protocol_name = message.get("protocol")
        if not protocol_name:
            logger.error(f"Message missing protocol field: {message}")
            return False
        
        if protocol_name not in self.protocols:
            logger.error(f"Protocol {protocol_name} not registered with network {self.network_id}")
            return False
        
        # Let the protocol handle the message broadcasting
        # This is a simplified implementation - in a real system, this would involve
        # actual message delivery to all agents
        logger.info(f"Broadcasting message from {from_agent_id} using protocol {protocol_name}")
        return True
    
    def get_agents(self) -> Dict[str, Dict[str, Any]]:
        """Get all agents registered with this network.
        
        Returns:
            Dict[str, Dict[str, Any]]: Dictionary of agent IDs to metadata
        """
        return self.agents
    
    def get_state(self) -> Dict[str, Any]:
        """Get the current state of this network across all protocols.
        
        Returns:
            Dict[str, Any]: Current network state
        """
        state = {
            "network_id": self.network_id,
            "name": self.name,
            "is_running": self.is_running,
            "agent_count": len(self.agents),
            "protocols": {}
        }
        
        for protocol_name, protocol in self.protocols.items():
            state["protocols"][protocol_name] = protocol.get_network_state()
        
        return state
    
    def send_message_to_agent(self, agent_id: str, message: Dict[str, Any]) -> bool:
        """Send a message to an agent.
        
        Args:
            agent_id: ID of the recipient agent
            message: Message to send
            
        Returns:
            bool: True if message was sent successfully, False otherwise
        """
        if not self.is_running:
            logger.warning(f"Network {self.network_id} not running, cannot send message")
            return False
        
        if agent_id not in self.agents:
            logger.error(f"Agent {agent_id} not registered with network {self.network_id}")
            return False
        
        # Use the route_message method to send the message
        # For now, we'll use a placeholder sender_id
        sender_id = message.get("sender_id", "network")
        return self.route_message(sender_id, agent_id, message) 