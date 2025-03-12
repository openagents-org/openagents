from typing import Dict, Any, List, Optional, Set, Type
import uuid
import logging
from .connector import NetworkConnector
from openagents.models.messages import BaseMessage
from openagents.core.base_protocol_adapter import BaseProtocolAdapter
from openagents.models.messages import DirectMessage, BroadcastMessage, ProtocolMessage
logger = logging.getLogger(__name__)


class AgentAdapter:
    """Core agent implementation for OpenAgents.
    
    An agent that can connect to a network server and communicate with other agents.
    """
    
    def __init__(self, agent_id: Optional[str] = None, protocol_adapters: Optional[List[BaseProtocolAdapter]] = None):
        """Initialize an agent.
        
        Args:
            name: Optional human-readable name for the agent
            protocols: Optional list of protocol instances to register with the agent
        """
        self.agent_id = agent_id or "Agent-" + str(uuid.uuid4())[:8]
        self.protocol_adapters: Dict[str, BaseProtocolAdapter] = {}
        self.connector: Optional[NetworkConnector] = None

        # Register protocols if provided
        if protocol_adapters:
            for protocol in protocol_adapters:
                self.register_protocol_adapter(protocol)
    
    async def connect_to_server(self, host: str, port: int, metadata: Optional[Dict[str, Any]] = None) -> bool:
        """Connect to a network server.
        
        Args:
            host: Server host address
            port: Server port
            
        Returns:
            bool: True if connection successful
        """
        if self.connector is not None:
            logger.info(f"Disconnecting from existing network connection for agent {self.agent_id}")
            await self.disconnect()
            self.connector = None
        
        self.connector = NetworkConnector(host, port, self.agent_id, metadata)

        # Connect using the connector
        success = await self.connector.connect_to_server()
        
        if success:
            # Call on_connect for each protocol adapter
            for protocol in self.protocol_adapters.values():
                protocol.bind_connector(self.connector)
                protocol.on_connect()
            
            # Register message handlers
            self.connector.register_message_handler("direct_message", self._handle_direct_message)
            self.connector.register_message_handler("broadcast_message", self._handle_broadcast_message)
            self.connector.register_message_handler("protocol_message", self._handle_protocol_message)
        
        return success
    
    async def disconnect(self) -> bool:
        """Disconnect from the network server."""
        for protocol_adapter in self.protocol_adapters.values():
            protocol_adapter.on_disconnect()
        return await self.connector.disconnect()
    
    
    def register_protocol_adapter(self, protocol_adapter: BaseProtocolAdapter) -> bool:
        """Register a protocol with this agent.
        
        Args:
            protocol_adapter: An instance of an agent protocol adapter
            
        Returns:
            bool: True if registration was successful, False otherwise
        """
        protocol_name = protocol_adapter.__class__.__name__
        if protocol_name in self.protocol_adapters:
            logger.warning(f"Protocol {protocol_name} already registered with agent {self.agent_id}")
            return False
        
        # Bind the agent to the protocol
        protocol_adapter.bind_agent(self.agent_id)
        
        self.protocol_adapters[protocol_name] = protocol_adapter
        protocol_adapter.initialize()
        logger.info(f"Registered protocol adapter {protocol_name} with agent {self.agent_id}")
        return True
    
    def unregister_protocol_adapter(self, protocol_name: str) -> bool:
        """Unregister a protocol adapter from this agent.
        
        Args:
            protocol_name: Name of the protocol to unregister
            
        Returns:
            bool: True if unregistration was successful, False otherwise
        """
        if protocol_name not in self.protocol_adapters:
            logger.warning(f"Protocol adapter {protocol_name} not registered with agent {self.agent_id}")
            return False
        
        protocol_adapter = self.protocol_adapters.pop(protocol_name)
        protocol_adapter.shutdown()
        logger.info(f"Unregistered protocol adapter {protocol_name} from agent {self.agent_id}")
        return True
    
    async def send_direct_message(self, message: DirectMessage) -> None:
        """Send a direct message to another agent.
        
        Args:
            message: The message to send
        """
        processed_message = message
        for protocol_adapter in self.protocol_adapters.values():
            processed_message = await protocol_adapter.process_outgoing_direct_message(message)
            if processed_message is None:
                break
        if processed_message is not None:
            await self.connector.send_message(processed_message)
    
    async def send_broadcast_message(self, message: BroadcastMessage) -> None:
        """Send a broadcast message to all agents.
        
        Args:
            message: The message to send
        """
        processed_message = message
        for protocol_adapter in self.protocol_adapters.values():
            processed_message = await protocol_adapter.process_outgoing_broadcast_message(message)
            if processed_message is None:
                break
        if processed_message is not None:
            await self.connector.send_message(processed_message)
    
    async def send_protocol_message(self, message: ProtocolMessage) -> None:
        """Send a protocol message to another agent.
        
        Args:
            message: The message to send
        """
        processed_message = message
        for protocol_adapter in self.protocol_adapters.values():
            processed_message = await protocol_adapter.process_outgoing_protocol_message(message)
            if processed_message is None:
                break
        if processed_message is not None:
            await self.connector.send_message(processed_message)
    
    async def _handle_direct_message(self, message: DirectMessage) -> None:
        """Handle a direct message from another agent.
        
        Args:
            message: The message to handle
        """
        # Route message to appropriate protocol if available
        for protocol_adapter in self.protocol_adapters.values():
            try:
                processed_message = await protocol_adapter.process_incoming_direct_message(message)
                if processed_message is None:
                    break
            except Exception as e:
                logger.error(f"Error handling message in protocol {protocol_adapter.__class__.__name__}: {e}")
    
    async def _handle_broadcast_message(self, message: BroadcastMessage) -> None:
        """Handle a broadcast message from another agent.
        
        Args:
            message: The message to handle
        """
        for protocol_adapter in self.protocol_adapters.values():
            try:
                processed_message = await protocol_adapter.process_incoming_broadcast_message(message)
                if processed_message is None:
                    break
            except Exception as e:
                logger.error(f"Error handling message in protocol {protocol_adapter.__class__.__name__}: {e}")
    
    async def _handle_protocol_message(self, message: ProtocolMessage) -> None:
        """Handle a protocol message from another agent.
        
        Args:
            message: The message to handle
        """
        for protocol_adapter in self.protocol_adapters.values():
            try:
                processed_message = await protocol_adapter.process_incoming_protocol_message(message)
                if processed_message is None:
                    break
            except Exception as e:
                logger.error(f"Error handling message in protocol {protocol_adapter.__class__.__name__}: {e}")
    
