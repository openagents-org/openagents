from typing import Dict, Any, List, Optional, Set, Type, Callable, Awaitable
import uuid
import logging
from .connector import NetworkConnector
from openagents.models.messages import BaseMessage
from openagents.core.base_protocol_adapter import BaseProtocolAdapter
from openagents.models.messages import DirectMessage, BroadcastMessage, ProtocolMessage
from openagents.core.system_commands import LIST_AGENTS, LIST_PROTOCOLS, GET_PROTOCOL_MANIFEST

logger = logging.getLogger(__name__)


class AgentClient:
    """Core client implementation for OpenAgents.
    
    A client that can connect to a network server and communicate with other agents.
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
        self._agent_list_callbacks: List[Callable[[List[Dict[str, Any]]], Awaitable[None]]] = []
        self._protocol_list_callbacks: List[Callable[[List[Dict[str, Any]]], Awaitable[None]]] = []
        self._protocol_manifest_callbacks: List[Callable[[Dict[str, Any]], Awaitable[None]]] = []

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
            
            # Register system command handlers
            self.connector.register_system_handler(LIST_AGENTS, self._handle_list_agents_response)
            self.connector.register_system_handler(LIST_PROTOCOLS, self._handle_list_protocols_response)
            self.connector.register_system_handler(GET_PROTOCOL_MANIFEST, self._handle_protocol_manifest_response)
        
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
    
    async def send_system_request(self, command: str, **kwargs) -> bool:
        """Send a system request to the network server.
        
        Args:
            command: The system command to send
            **kwargs: Additional parameters for the command
            
        Returns:
            bool: True if request was sent successfully
        """
        if self.connector is None:
            logger.warning(f"Agent {self.agent_id} is not connected to a network")
            return False
        
        return await self.connector.send_system_request(command, **kwargs)
    
    async def list_agents(self) -> bool:
        """Request a list of agents from the network server.
        
        Returns:
            bool: True if request was sent successfully
        """
        return await self.send_system_request(LIST_AGENTS)
    
    async def list_protocols(self) -> bool:
        """Request a list of protocols from the network server.
        
        Returns:
            bool: True if request was sent successfully
        """
        return await self.send_system_request(LIST_PROTOCOLS)
    
    async def get_protocol_manifest(self, protocol_name: str) -> bool:
        """Request a protocol manifest from the network server.
        
        Args:
            protocol_name: Name of the protocol to get the manifest for
            
        Returns:
            bool: True if request was sent successfully
        """
        return await self.send_system_request(GET_PROTOCOL_MANIFEST, protocol_name=protocol_name)
    
    def register_agent_list_callback(self, callback: Callable[[List[Dict[str, Any]]], Awaitable[None]]) -> None:
        """Register a callback for agent list responses.
        
        Args:
            callback: Async function to call when an agent list is received
        """
        self._agent_list_callbacks.append(callback)
    
    def register_protocol_list_callback(self, callback: Callable[[List[Dict[str, Any]]], Awaitable[None]]) -> None:
        """Register a callback for protocol list responses.
        
        Args:
            callback: Async function to call when a protocol list is received
        """
        self._protocol_list_callbacks.append(callback)
    
    def register_protocol_manifest_callback(self, callback: Callable[[Dict[str, Any]], Awaitable[None]]) -> None:
        """Register a callback for protocol manifest responses.
        
        Args:
            callback: Async function to call when a protocol manifest is received
        """
        self._protocol_manifest_callbacks.append(callback)
    
    async def _handle_list_agents_response(self, data: Dict[str, Any]) -> None:
        """Handle a list_agents response from the network server.
        
        Args:
            data: Response data
        """
        agents = data.get("agents", [])
        logger.debug(f"Received list of {len(agents)} agents")
        
        # Call registered callbacks
        for callback in self._agent_list_callbacks:
            try:
                await callback(agents)
            except Exception as e:
                logger.error(f"Error in agent list callback: {e}")
    
    async def _handle_list_protocols_response(self, data: Dict[str, Any]) -> None:
        """Handle a list_protocols response from the network server.
        
        Args:
            data: Response data
        """
        protocols = data.get("protocols", [])
        logger.debug(f"Received list of {len(protocols)} protocols")
        
        # Call registered callbacks
        for callback in self._protocol_list_callbacks:
            try:
                await callback(protocols)
            except Exception as e:
                logger.error(f"Error in protocol list callback: {e}")
    
    async def _handle_protocol_manifest_response(self, data: Dict[str, Any]) -> None:
        """Handle a get_protocol_manifest response from the network server.
        
        Args:
            data: Response data
        """
        success = data.get("success", False)
        protocol_name = data.get("protocol_name", "unknown")
        
        if success:
            manifest = data.get("manifest", {})
            logger.debug(f"Received manifest for protocol {protocol_name}")
        else:
            error = data.get("error", "Unknown error")
            logger.warning(f"Failed to get manifest for protocol {protocol_name}: {error}")
            manifest = {}
        
        # Call registered callbacks
        for callback in self._protocol_manifest_callbacks:
            try:
                await callback(data)
            except Exception as e:
                logger.error(f"Error in protocol manifest callback: {e}")
    
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
    
