import asyncio
from typing import Dict, Any, List, Optional, Set, Type, Callable, Awaitable
import uuid
import logging

from openagents.utils.network_discovey import retrieve_network_details
from .connector import NetworkConnector
from openagents.models.messages import BaseMessage
from openagents.core.base_mod_adapter import BaseModAdapter
from openagents.models.messages import DirectMessage, BroadcastMessage, ModMessage
from openagents.core.system_commands import LIST_AGENTS, LIST_MODS, GET_MOD_MANIFEST
from openagents.models.tool import AgentAdapterTool
from openagents.models.message_thread import MessageThread
from openagents.utils.verbose import verbose_print
logger = logging.getLogger(__name__)


class AgentClient:
    """Core client implementation for OpenAgents.
    
    A client that can connect to a network server and communicate with other agents.
    """
    
    def __init__(self, agent_id: Optional[str] = None, mod_adapters: Optional[List[BaseModAdapter]] = None):
        """Initialize an agent.
        
        Args:
            name: Optional human-readable name for the agent
            mod_adapters: Optional list of mod instances to register with the agent
        """
        self.agent_id = agent_id or "Agent-" + str(uuid.uuid4())[:8]
        self.mod_adapters: Dict[str, BaseModAdapter] = {}
        self.connector: Optional[NetworkConnector] = None
        self._agent_list_callbacks: List[Callable[[List[Dict[str, Any]]], Awaitable[None]]] = []
        self._mod_list_callbacks: List[Callable[[List[Dict[str, Any]]], Awaitable[None]]] = []
        self._mod_manifest_callbacks: List[Callable[[Dict[str, Any]], Awaitable[None]]] = []

        # Register mod adapters if provided
        if mod_adapters:
            for mod_adapter in mod_adapters:
                self.register_mod_adapter(mod_adapter)
    
    async def connect_to_server(self, host: Optional[str] = None, port: Optional[int] = None, network_id: Optional[str] = None, metadata: Optional[Dict[str, Any]] = None, max_message_size: int = 104857600) -> bool:
        """Connect to a network server.
        
        Args:
            host: Server host address
            port: Server port
            network_id: ID of the network to connect to
            metadata: Metadata to send to the server
            max_message_size: Maximum WebSocket message size in bytes (default 10MB)
            
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
        
        self.connector = NetworkConnector(host, port, self.agent_id, metadata, max_message_size)

        # Connect using the connector
        success = await self.connector.connect_to_server()
        
        if success:
            # Call on_connect for each mod adapter
            for mod_adapter in self.mod_adapters.values():
                mod_adapter.bind_connector(self.connector)
                mod_adapter.on_connect()
            
            # Register message handlers
            self.connector.register_message_handler("direct_message", self._handle_direct_message)
            self.connector.register_message_handler("broadcast_message", self._handle_broadcast_message)
            self.connector.register_message_handler("mod_message", self._handle_mod_message)
            
            # Register system command handlers
            self.connector.register_system_handler(LIST_AGENTS, self._handle_list_agents_response)
            self.connector.register_system_handler(LIST_MODS, self._handle_list_mods_response)
            self.connector.register_system_handler(GET_MOD_MANIFEST, self._handle_mod_manifest_response)
        
        return success

    async def connect(self, host: Optional[str] = None, port: Optional[int] = None, network_id: Optional[str] = None, metadata: Optional[Dict[str, Any]] = None, max_message_size: int = 104857600) -> bool:
        """Connect to a network server (alias for connect_to_server).
        
        This is a cleaner alias for the connect_to_server method.
        
        Args:
            host: Server host address
            port: Server port  
            network_id: ID of the network to connect to
            metadata: Metadata to send to the server
            max_message_size: Maximum WebSocket message size in bytes (default 10MB)
            
        Returns:
            bool: True if connection successful
        """
        return await self.connect_to_server(host, port, network_id, metadata, max_message_size)
    
    async def disconnect(self) -> bool:
        """Disconnect from the network server."""
        for mod_adapter in self.mod_adapters.values():
            mod_adapter.on_disconnect()
        return await self.connector.disconnect()
    
    
    def register_mod_adapter(self, mod_adapter: BaseModAdapter) -> bool:
        """Register a mod with this agent.
        
        Args:
            mod_adapter: An instance of an agent mod adapter
            
        Returns:
            bool: True if registration was successful, False otherwise
        """
        mod_name = mod_adapter.__class__.__name__
        if mod_name in self.mod_adapters:
            logger.warning(f"Protocol {mod_name} already registered with agent {self.agent_id}")
            return False
        
        # Bind the agent to the mod
        mod_adapter.bind_agent(self.agent_id)
        
        self.mod_adapters[mod_name] = mod_adapter
        mod_adapter.initialize()
        if self.connector is not None:
            mod_adapter.bind_connector(self.connector)
            mod_adapter.on_connect()
        logger.info(f"Registered mod adapter {mod_name} with agent {self.agent_id}")
        return True
    
    def unregister_mod_adapter(self, mod_name: str) -> bool:
        """Unregister a mod adapter from this agent.
        
        Args:
            mod_name: Name of the mod to unregister
            
        Returns:
            bool: True if unregistration was successful, False otherwise
        """
        if mod_name not in self.mod_adapters:
            logger.warning(f"Protocol adapter {mod_name} not registered with agent {self.agent_id}")
            return False
        
        mod_adapter = self.mod_adapters.pop(mod_name)
        mod_adapter.shutdown()
        logger.info(f"Unregistered mod adapter {mod_name} from agent {self.agent_id}")
        return True
    
    async def send_direct_message(self, message: DirectMessage) -> None:
        """Send a direct message to another agent.
        
        Args:
            message: The message to send
        """
        verbose_print(f"🔄 AgentClient.send_direct_message called for message to {message.target_agent_id}")
        verbose_print(f"   Available mod adapters: {list(self.mod_adapters.keys())}")
        
        processed_message = message
        for mod_name, mod_adapter in self.mod_adapters.items():
            verbose_print(f"   Processing through {mod_name} adapter...")
            processed_message = await mod_adapter.process_outgoing_direct_message(message)
            verbose_print(f"   Result from {mod_name}: {'✅ message' if processed_message else '❌ None'}")
            if processed_message is None:
                break
        
        if processed_message is not None:
            verbose_print(f"🚀 Sending message via connector...")
            try:
                await self.connector.send_message(processed_message)
                verbose_print(f"✅ Message sent via connector successfully")
            except Exception as e:
                print(f"❌ Connector failed to send message: {e}")
                print(f"Exception type: {type(e).__name__}")
                import traceback
                traceback.print_exc()
                raise
        else:
            verbose_print(f"❌ Message was filtered out by mod adapters - not sending")
    
    async def send_broadcast_message(self, message: BroadcastMessage) -> None:
        """Send a broadcast message to all agents.
        
        Args:
            message: The message to send
        """
        processed_message = message
        for mod_adapter in self.mod_adapters.values():
            processed_message = await mod_adapter.process_outgoing_broadcast_message(message)
            if processed_message is None:
                break
        if processed_message is not None:
            await self.connector.send_message(processed_message)
    
    async def send_mod_message(self, message: ModMessage) -> None:
        """Send a mod message to another agent.
        
        Args:
            message: The message to send
        """
        processed_message = message
        for mod_adapter in self.mod_adapters.values():
            processed_message = await mod_adapter.process_outgoing_mod_message(message)
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
    
    async def request_list_mods(self) -> bool:
        """Request a list of mods from the network server.
        
        Returns:
            bool: True if request was sent successfully
        """
        return await self.send_system_request(LIST_MODS)
    
    async def request_get_mod_manifest(self, mod_name: str) -> bool:
        """Request a mod manifest from the network server.
        
        Args:
            mod_name: Name of the mod to get the manifest for
            
        Returns:
            bool: True if request was sent successfully
        """
        return await self.send_system_request(GET_MOD_MANIFEST, mod_name=mod_name)
    
    async def list_mods(self) -> List[Dict[str, Any]]:
        """Get a list of available mods from the network server.
        
        This method sends a request to the server to list all available mods
        and returns the mod information.
        
        Returns:
            List[Dict[str, Any]]: List of mod information dictionaries
        """
        if self.connector is None:
            logger.warning(f"Agent {self.agent_id} is not connected to a network")
            return []
        
        # Create an event to signal when we have a response
        response_event = asyncio.Event()
        response_data = []
        
        # Define a handler for the LIST_MODS response
        async def handle_list_mods_response(data: Dict[str, Any]) -> None:
            if data.get("success"):
                mods = data.get("mods", [])
                response_data.clear()
                response_data.extend(mods)
            else:
                error = data.get("error", "Unknown error")
                logger.error(f"Failed to list mods: {error}")
            response_event.set()
        
        # Save the original handler if it exists
        original_handler = None
        if LIST_MODS in self.connector.system_handlers:
            original_handler = self.connector.system_handlers[LIST_MODS]
        
        # Register the handler
        self.connector.register_system_handler(LIST_MODS, handle_list_mods_response)
        
        try:
            # Send the request
            success = await self.request_list_mods()
            if not success:
                logger.error("Failed to send list_mods request")
                return []
            
            # Wait for the response with a timeout
            try:
                await asyncio.wait_for(response_event.wait(), timeout=10.0)
                return response_data
            except asyncio.TimeoutError:
                logger.error("Timeout waiting for list_mods response")
                return []
        finally:
            # Restore the original handler if there was one
            if original_handler:
                self.connector.register_system_handler(LIST_MODS, original_handler)
    
    
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
    
    
    async def get_mod_manifest(self, mod_name: str) -> Optional[Dict[str, Any]]:
        """Get the manifest for a specific mod from the network server.
        
        Args:
            mod_name: Name of the mod to get the manifest for
            
        Returns:
            Optional[Dict[str, Any]]: Protocol manifest or None if not found
        """
        if self.connector is None:
            logger.warning(f"Agent {self.agent_id} is not connected to a network")
            return None
        
        # Create an event to signal when we have a response
        response_event = asyncio.Event()
        response_data = {}
        
        # Define a handler for the GET_MOD_MANIFEST response
        async def handle_mod_manifest_response(data: Dict[str, Any]) -> None:
            if data.get("success"):
                manifest = data.get("manifest", {})
                response_data.clear()
                response_data.update(manifest)
            else:
                error = data.get("error", "Unknown error")
                logger.error(f"Failed to get mod manifest: {error}")
            response_event.set()
        
        # Save the original handler if it exists
        original_handler = None
        if GET_MOD_MANIFEST in self.connector.system_handlers:
            original_handler = self.connector.system_handlers[GET_MOD_MANIFEST]
        
        # Register the handler
        self.connector.register_system_handler(GET_MOD_MANIFEST, handle_mod_manifest_response)
        
        try:
            # Send the request
            success = await self.send_system_request(GET_MOD_MANIFEST, mod_name=mod_name)
            if not success:
                logger.error(f"Failed to send get_mod_manifest request for {mod_name}")
                return None
            
            # Wait for the response with a timeout
            try:
                await asyncio.wait_for(response_event.wait(), timeout=10.0)
                return response_data if response_data else None
            except asyncio.TimeoutError:
                logger.error(f"Timeout waiting for get_mod_manifest response for {mod_name}")
                return None
        finally:
            # Restore the original handler if there was one
            if original_handler:
                self.connector.register_system_handler(GET_MOD_MANIFEST, original_handler)

    def get_tools(self) -> List[AgentAdapterTool]:
        """Get all tools from registered mod adapters.
        
        Returns:
            List[AgentAdapterTool]: Combined list of tools from all mod adapters
        """
        tools = []
        
        # Collect tools from all registered mod adapters
        for mod_name, adapter in self.mod_adapters.items():
            try:
                adapter_tools = adapter.get_tools()
                if adapter_tools:
                    tools.extend(adapter_tools)
                    logger.debug(f"Added {len(adapter_tools)} tools from {mod_name}")
            except Exception as e:
                logger.error(f"Error getting tools from mod adapter {mod_name}: {e}")
        
        return tools
    
    def get_messsage_threads(self) -> Dict[str, MessageThread]:
        """Get all message threads from registered mod adapters.
        
        Returns:
            Dict[str, ConversationThread]: Dictionary of conversation threads
        """
        threads = {}
        
        # Collect conversation threads from all registered mod adapters
        for mod_name, adapter in self.mod_adapters.items():
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
                    logger.debug(f"Added {len(adapter_threads)} conversation threads from {mod_name}")
            except Exception as e:
                logger.error(f"Error getting message threads from mod adapter {mod_name}: {e}")
        
        return threads
    
    def register_agent_list_callback(self, callback: Callable[[List[Dict[str, Any]]], Awaitable[None]]) -> None:
        """Register a callback for agent list responses.
        
        Args:
            callback: Async function to call when an agent list is received
        """
        self._agent_list_callbacks.append(callback)
    
    def register_mod_list_callback(self, callback: Callable[[List[Dict[str, Any]]], Awaitable[None]]) -> None:
        """Register a callback for mod list responses.
        
        Args:
            callback: Async function to call when a mod list is received
        """
        self._mod_list_callbacks.append(callback)
    
    def register_mod_manifest_callback(self, callback: Callable[[Dict[str, Any]], Awaitable[None]]) -> None:
        """Register a callback for mod manifest responses.
        
        Args:
            callback: Async function to call when a mod manifest is received
        """
        self._mod_manifest_callbacks.append(callback)
    
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
    
    async def _handle_list_mods_response(self, data: Dict[str, Any]) -> None:
        """Handle a list_mods response from the network server.
        
        Args:
            data: Response data
        """
        mods = data.get("mods", [])
        logger.debug(f"Received list of mods")
        
        # Call registered callbacks
        for callback in self._mod_list_callbacks:
            try:
                await callback(protocols)
            except Exception as e:
                logger.error(f"Error in protocol list callback: {e}")
    
    async def _handle_mod_manifest_response(self, data: Dict[str, Any]) -> None:
        """Handle a get_mod_manifest response from the network server.
        
        Args:
            data: Response data
        """
        success = data.get("success", False)
        mod_name = data.get("mod_name", "unknown")
        
        if success:
            manifest = data.get("manifest", {})
            logger.debug(f"Received manifest for protocol {mod_name}")
        else:
            error = data.get("error", "Unknown error")
            logger.warning(f"Failed to get manifest for protocol {mod_name}: {error}")
            manifest = {}
        
        # Call registered callbacks
        for callback in self._mod_manifest_callbacks:
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
        for mod_name, mod_adapter in self.mod_adapters.items():
            try:
                processed_message = await mod_adapter.process_incoming_direct_message(message)
                if processed_message is None:
                    break
            except Exception as e:
                logger.error(f"Error handling message in protocol {mod_adapter.__class__.__name__}: {e}")
                import traceback
                traceback.print_exc()
    
    async def _handle_broadcast_message(self, message: BroadcastMessage) -> None:
        """Handle a broadcast message from another agent.
        
        Args:
            message: The message to handle
        """
        for mod_adapter in self.mod_adapters.values():
            try:
                processed_message = await mod_adapter.process_incoming_broadcast_message(message)
                if processed_message is None:
                    break
            except Exception as e:
                logger.error(f"Error handling message in protocol {mod_adapter.__class__.__name__}: {e}")
    
    async def _handle_mod_message(self, message: ModMessage) -> None:
        """Handle a protocol message from another agent.
        
        Args:
            message: The message to handle
        """
        for mod_adapter in self.mod_adapters.values():
            try:
                processed_message = await mod_adapter.process_incoming_mod_message(message)
                if processed_message is None:
                    break
            except Exception as e:
                logger.error(f"Error handling message in protocol {mod_adapter.__class__.__name__}: {e}")
    
