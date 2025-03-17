import asyncio
from typing import Dict, Any, List, Optional, Set, Type, Callable, Awaitable
import uuid
import logging

from openagents.utils.network_discovey import retrieve_network_details
from .connector import NetworkConnector
from openagents.models.messages import BaseMessage
from openagents.core.base_protocol_adapter import BaseProtocolAdapter
from openagents.models.messages import DirectMessage, BroadcastMessage, ProtocolMessage
from openagents.core.system_commands import LIST_AGENTS, LIST_PROTOCOLS, GET_PROTOCOL_MANIFEST
from openagents.models.tool import AgentAdapterTool
from openagents.models.message_thread import MessageThread
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
    
    async def connect_to_server(self, host: Optional[str] = None, port: Optional[int] = None, network_id: Optional[str] = None, metadata: Optional[Dict[str, Any]] = None) -> bool:
        """Connect to a network server.
        
        Args:
            host: Server host address
            port: Server port
            network_id: ID of the network to connect to
            metadata: Metadata to send to the server
            
        Returns:
            bool: True if connection successful
        """
        # Validate connection parameters
        if network_id is None and (host is None or port is None):
            logger.error("Either network_id or both host and port must be provided to connect to a server")
            return False
        
        # If network_id is provided, retrieve network details to find out host and port
        if network_id and (not host or not port):
            network_details = retrieve_network_details(network_id)
            if not network_details:
                logger.error(f"Failed to retrieve network details for network_id: {network_id}")
                return False
            network_profile = network_details.get("network_profile", {})
            host = network_profile.get("host", host)
            port = network_profile.get("port", port)
            logger.info(f"Retrieved network details for network_id: {network_id}, host: {host}, port: {port}")

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
        if self.connector is not None:
            protocol_adapter.bind_connector(self.connector)
            protocol_adapter.on_connect()
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
    
    async def request_list_agents(self) -> bool:
        """Request a list of agents from the network server.
        
        Returns:
            bool: True if request was sent successfully
        """
        return await self.send_system_request(LIST_AGENTS)
    
    async def request_list_protocols(self) -> bool:
        """Request a list of protocols from the network server.
        
        Returns:
            bool: True if request was sent successfully
        """
        return await self.send_system_request(LIST_PROTOCOLS)
    
    async def request_get_protocol_manifest(self, protocol_name: str) -> bool:
        """Request a protocol manifest from the network server.
        
        Args:
            protocol_name: Name of the protocol to get the manifest for
            
        Returns:
            bool: True if request was sent successfully
        """
        return await self.send_system_request(GET_PROTOCOL_MANIFEST, protocol_name=protocol_name)
    
    async def list_protocols(self) -> List[Dict[str, Any]]:
        """Get a list of available protocols from the network server.
        
        This method sends a request to the server to list all available protocols
        and returns the protocol information.
        
        Returns:
            List[Dict[str, Any]]: List of protocol information dictionaries
        """
        if self.connector is None:
            logger.warning(f"Agent {self.agent_id} is not connected to a network")
            return []
        
        # Create an event to signal when we have a response
        response_event = asyncio.Event()
        response_data = []
        
        # Define a handler for the LIST_PROTOCOLS response
        async def handle_list_protocols_response(data: Dict[str, Any]) -> None:
            if data.get("success"):
                protocols = data.get("protocols", [])
                response_data.clear()
                response_data.extend(protocols)
            else:
                error = data.get("error", "Unknown error")
                logger.error(f"Failed to list protocols: {error}")
            response_event.set()
        
        # Save the original handler if it exists
        original_handler = None
        if LIST_PROTOCOLS in self.connector.system_handlers:
            original_handler = self.connector.system_handlers[LIST_PROTOCOLS]
        
        # Register the handler
        self.connector.register_system_handler(LIST_PROTOCOLS, handle_list_protocols_response)
        
        try:
            # Send the request
            success = await self.request_list_protocols()
            if not success:
                logger.error("Failed to send list_protocols request")
                return []
            
            # Wait for the response with a timeout
            try:
                await asyncio.wait_for(response_event.wait(), timeout=10.0)
                return response_data
            except asyncio.TimeoutError:
                logger.error("Timeout waiting for list_protocols response")
                return []
        finally:
            # Restore the original handler if there was one
            if original_handler:
                self.connector.register_system_handler(LIST_PROTOCOLS, original_handler)
    
    
    async def list_agents(self) -> List[Dict[str, Any]]:
        """Get a list of agents connected to the network.
        
        Returns:
            List[Dict[str, Any]]: List of agent information dictionaries
        """
        if self.connector is None:
            logger.warning(f"Agent {self.agent_id} is not connected to a network")
            return []
        
        # Create an event to signal when we have a response
        response_event = asyncio.Event()
        response_data = []
        
        # Define a handler for the LIST_AGENTS response
        async def handle_list_agents_response(data: Dict[str, Any]) -> None:
            if data.get("success"):
                agents = data.get("agents", [])
                response_data.clear()
                response_data.extend(agents)
            else:
                error = data.get("error", "Unknown error")
                logger.error(f"Failed to list agents: {error}")
            response_event.set()
        
        # Save the original handler if it exists
        original_handler = None
        if LIST_AGENTS in self.connector.system_handlers:
            original_handler = self.connector.system_handlers[LIST_AGENTS]
        
        # Register the handler
        self.connector.register_system_handler(LIST_AGENTS, handle_list_agents_response)
        
        try:
            # Send the request
            success = await self.send_system_request(LIST_AGENTS)
            if not success:
                logger.error("Failed to send list_agents request")
                return []
            
            # Wait for the response with a timeout
            try:
                await asyncio.wait_for(response_event.wait(), timeout=10.0)
                return response_data
            except asyncio.TimeoutError:
                logger.error("Timeout waiting for list_agents response")
                return []
        finally:
            # Restore the original handler if there was one
            if original_handler:
                self.connector.register_system_handler(LIST_AGENTS, original_handler)
    
    
    async def get_protocol_manifest(self, protocol_name: str) -> Optional[Dict[str, Any]]:
        """Get the manifest for a specific protocol from the network server.
        
        Args:
            protocol_name: Name of the protocol to get the manifest for
            
        Returns:
            Optional[Dict[str, Any]]: Protocol manifest or None if not found
        """
        if self.connector is None:
            logger.warning(f"Agent {self.agent_id} is not connected to a network")
            return None
        
        # Create an event to signal when we have a response
        response_event = asyncio.Event()
        response_data = {}
        
        # Define a handler for the GET_PROTOCOL_MANIFEST response
        async def handle_protocol_manifest_response(data: Dict[str, Any]) -> None:
            if data.get("success"):
                manifest = data.get("manifest", {})
                response_data.clear()
                response_data.update(manifest)
            else:
                error = data.get("error", "Unknown error")
                logger.error(f"Failed to get protocol manifest: {error}")
            response_event.set()
        
        # Save the original handler if it exists
        original_handler = None
        if GET_PROTOCOL_MANIFEST in self.connector.system_handlers:
            original_handler = self.connector.system_handlers[GET_PROTOCOL_MANIFEST]
        
        # Register the handler
        self.connector.register_system_handler(GET_PROTOCOL_MANIFEST, handle_protocol_manifest_response)
        
        try:
            # Send the request
            success = await self.send_system_request(GET_PROTOCOL_MANIFEST, protocol_name=protocol_name)
            if not success:
                logger.error(f"Failed to send get_protocol_manifest request for {protocol_name}")
                return None
            
            # Wait for the response with a timeout
            try:
                await asyncio.wait_for(response_event.wait(), timeout=10.0)
                return response_data if response_data else None
            except asyncio.TimeoutError:
                logger.error(f"Timeout waiting for get_protocol_manifest response for {protocol_name}")
                return None
        finally:
            # Restore the original handler if there was one
            if original_handler:
                self.connector.register_system_handler(GET_PROTOCOL_MANIFEST, original_handler)

    def get_tools(self) -> List[AgentAdapterTool]:
        """Get all tools from registered protocol adapters.
        
        Returns:
            List[AgentAdapterTool]: Combined list of tools from all protocol adapters
        """
        tools = []
        
        # Collect tools from all registered protocol adapters
        for protocol_name, adapter in self.protocol_adapters.items():
            try:
                adapter_tools = adapter.get_tools()
                if adapter_tools:
                    tools.extend(adapter_tools)
                    logger.debug(f"Added {len(adapter_tools)} tools from {protocol_name}")
            except Exception as e:
                logger.error(f"Error getting tools from protocol adapter {protocol_name}: {e}")
        
        return tools
    
    def get_messsage_threads(self) -> Dict[str, MessageThread]:
        """Get all message threads from registered protocol adapters.
        
        Returns:
            Dict[str, ConversationThread]: Dictionary of conversation threads
        """
        threads = {}
        
        # Collect conversation threads from all registered protocol adapters
        for protocol_name, adapter in self.protocol_adapters.items():
            try:
                adapter_threads = adapter.message_threads
                if adapter_threads:
                    # Merge the adapter's threads into our collection
                    for thread_id, thread in adapter_threads.items():
                        if thread_id in threads:
                            # If thread already exists, merge messages and sort by timestamp
                            existing_messages = threads[thread_id].messages
                            new_messages = thread.messages
                            # Combine messages from both threads
                            combined_messages = existing_messages + new_messages
                            # Create a new thread with the combined messages
                            merged_thread = MessageThread()
                            # Sort all messages by timestamp before adding them
                            sorted_messages = list(sorted(combined_messages, key=lambda msg: msg.timestamp))
                            merged_thread.messages = sorted_messages
                            threads[thread_id] = merged_thread
                        else:
                            threads[thread_id] = thread
                    logger.debug(f"Added {len(adapter_threads)} conversation threads from {protocol_name}")
            except Exception as e:
                logger.error(f"Error getting message threads from protocol adapter {protocol_name}: {e}")
        
        return threads
    
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
    
