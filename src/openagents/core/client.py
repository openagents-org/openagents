import asyncio
from typing import Dict, Any, List, Optional, Set, Type, Callable, Awaitable
import uuid
import logging

from openagents.utils.network_discovey import retrieve_network_details
from openagents.core.connector import NetworkConnector
from openagents.core.grpc_connector import GRPCNetworkConnector
from openagents.models.event import Event
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
        
        # Message waiting infrastructure
        self._message_waiters: Dict[str, List[Dict[str, Any]]] = {
            "direct_message": [],
            "broadcast_message": [],
            "mod_message": []
        }

        # Register mod adapters if provided
        if mod_adapters:
            for mod_adapter in mod_adapters:
                self.register_mod_adapter(mod_adapter)
    
    async def _detect_transport_type(self, host: str, port: int) -> tuple[str, int]:
        """Detect the transport type of the network server.
        
        Args:
            host: Server host address
            port: Server port
            
        Returns:
            tuple: (transport_type, actual_port) where transport_type is 'grpc', 'grpc_http', or 'websocket'
        """
        # Try gRPC first
        try:
            import grpc
            from grpc import aio
            from openagents.proto import agent_service_pb2_grpc, agent_service_pb2
            
            # Create a temporary gRPC channel
            channel = aio.insecure_channel(f"{host}:{port}")
            stub = agent_service_pb2_grpc.AgentServiceStub(channel)
            
            # Try to ping the gRPC server
            from google.protobuf.timestamp_pb2 import Timestamp
            timestamp = Timestamp()
            timestamp.GetCurrentTime()
            
            ping_request = agent_service_pb2.PingRequest(
                agent_id="transport-detection",
                timestamp=timestamp
            )
            
            try:
                await asyncio.wait_for(stub.Ping(ping_request), timeout=2.0)
                await channel.close()
                logger.info(f"Detected gRPC transport at {host}:{port}")
                
                # Check if WebSocket is available on agent port (port + 1)
                agent_port = port + 1
                try:
                    import websockets
                    from websockets.asyncio.client import connect
                    
                    # Try to connect to WebSocket on agent port
                    try:
                        ws = await asyncio.wait_for(connect(f"ws://{host}:{agent_port}"), timeout=1.0)
                        await ws.close()
                        logger.info(f"Detected WebSocket for agents at {host}:{agent_port}")
                        return ("websocket", agent_port)
                    except Exception:
                        logger.debug(f"WebSocket not available at {host}:{agent_port}")
                except ImportError:
                    logger.debug("websockets library not available")
                
                # Check if HTTP adapter is available on port + 1000
                http_port = port + 1000
                try:
                    import aiohttp
                    async with aiohttp.ClientSession() as session:
                        async with session.get(f"http://{host}:{http_port}/api/poll/test", timeout=aiohttp.ClientTimeout(total=1.0)) as response:
                            if response.status in [200, 404]:  # 404 is expected for non-existent agent
                                logger.info(f"Detected gRPC HTTP adapter at {host}:{http_port}")
                                return ("grpc_http", http_port)
                except Exception:
                    logger.debug(f"gRPC HTTP adapter not available at {host}:{http_port}")
                
                return ("grpc", port)
            except Exception:
                await channel.close()
                
        except ImportError:
            logger.debug("gRPC libraries not available, skipping gRPC detection")
        except Exception as e:
            logger.debug(f"gRPC detection failed: {e}")
        
        # Default to WebSocket
        logger.info(f"Defaulting to WebSocket transport at {host}:{port}")
        return ("websocket", port)

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
        
        # Detect transport type and create appropriate connector
        transport_type, actual_port = await self._detect_transport_type(host, port)
        
        if transport_type == "grpc" or transport_type == "grpc_http":
            logger.info(f"Creating gRPC connector for agent {self.agent_id}")
            # Use the main gRPC port, not the HTTP adapter port
            main_port = port if transport_type == "grpc" else actual_port - 1000  # HTTP adapter is typically +1000 from main port
            self.connector = GRPCNetworkConnector(host, main_port, self.agent_id, metadata, max_message_size)
        else:
            logger.info(f"Creating WebSocket connector for agent {self.agent_id}")
            # TODO: change the network connector name to WebSocketNetworkConnector
            self.connector = NetworkConnector(host, actual_port, self.agent_id, metadata, max_message_size)

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
            self.connector.register_system_handler("poll_messages", self._handle_poll_messages_response)
            
            # Start message polling for gRPC connectors (workaround for bidirectional messaging limitation)
            if hasattr(self.connector, 'poll_messages'):
                logger.info(f"🔧 Starting message polling for gRPC agent {self.agent_id}")
                asyncio.create_task(self._start_message_polling())
            
            # Register this client with the network for direct message delivery (if network is accessible)
            # This is a workaround for gRPC transport not supporting bidirectional messaging
            try:
                # Try to get network instance through connector
                if hasattr(self.connector, 'network_instance') or hasattr(self.connector, '_network_instance'):
                    network = getattr(self.connector, 'network_instance', None) or getattr(self.connector, '_network_instance', None)
                    if network and hasattr(network, '_register_agent_client'):
                        network._register_agent_client(self.agent_id, self)
                        logger.info(f"🔧 Registered agent client {self.agent_id} for direct message delivery")
            except Exception as e:
                logger.debug(f"Could not register agent client for direct delivery: {e}")
        
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
    
    async def send_direct_message(self, message: DirectMessage) -> bool:
        """Send a direct message to another agent.
        
        Args:
            message: The message to send
            
        Returns:
            bool: True if message was sent successfully
        """
        verbose_print(f"🔄 AgentClient.send_direct_message called for message to {message.target_agent_id}")
        verbose_print(f"   Available mod adapters: {list(self.mod_adapters.keys())}")
        
        try:
            processed_message = message
            for mod_name, mod_adapter in self.mod_adapters.items():
                verbose_print(f"   Processing through {mod_name} adapter...")
                processed_message = await mod_adapter.process_outgoing_direct_message(message)
                verbose_print(f"   Result from {mod_name}: {'✅ message' if processed_message else '❌ None'}")
                if processed_message is None:
                    return False
            
            if processed_message is not None:
                verbose_print(f"🚀 Sending message via connector...")
                await self.connector.send_message(processed_message)
                verbose_print(f"✅ Message sent via connector successfully")
                return True
            else:
                verbose_print(f"❌ Message was filtered out by mod adapters - not sending")
                return False
        except Exception as e:
            print(f"❌ Connector failed to send message: {e}")
            print(f"Exception type: {type(e).__name__}")
            import traceback
            traceback.print_exc()
            return False
    
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
    
    async def send_mod_message(self, message: ModMessage) -> bool:
        """Send a mod message to another agent.
        
        Args:
            message: The message to send
            
        Returns:
            bool: True if message was sent successfully
        """
        try:
            processed_message = message
            for mod_adapter in self.mod_adapters.values():
                processed_message = await mod_adapter.process_outgoing_mod_message(message)
                if processed_message is None:
                    return False
            if processed_message is not None:
                await self.connector.send_message(processed_message)
                return True
            return False
        except Exception:
            return False
    
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
                await callback(mods)
            except Exception as e:
                logger.error(f"Error in mod list callback: {e}")
    
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
        # Notify any waiting functions first
        await self._notify_message_waiters("direct_message", message)
        
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
        # Notify any waiting functions first
        await self._notify_message_waiters("broadcast_message", message)
        
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
        logger.info(f"🔧 CLIENT: Handling ModMessage from {message.sender_id}, mod={message.mod}, action={message.content.get('action')}")
        logger.info(f"🔧 CLIENT: ModMessage content keys: {list(message.content.keys()) if message.content else 'None'}")
        logger.info(f"🔧 CLIENT: Agent ID: {self.agent_id}, Message relevant_agent_id: {message.relevant_agent_id}")
        
        # Notify any waiting functions first
        await self._notify_message_waiters("mod_message", message)
        
        # Process through mod adapters first
        processed_by_adapter = False
        
        for mod_name, mod_adapter in self.mod_adapters.items():
            try:
                processed_message = await mod_adapter.process_incoming_mod_message(message)
                if processed_message is None:
                    processed_by_adapter = True
                    logger.debug(f"Mod adapter {mod_name} processed the message")
                    break
            except Exception as e:
                logger.error(f"Error handling message in protocol {mod_adapter.__class__.__name__}: {e}")
        
        # If no mod adapter processed the message, add it to message threads for agent processing
        if not processed_by_adapter:
            logger.debug(f"ModMessage not processed by adapters, adding to message threads for agent processing")
            
            # Create a thread ID for the ModMessage
            thread_id = f"mod_{message.mod}_{message.message_id[:8]}"
            
            # Try to add the message to any available mod adapter's message threads
            added_to_thread = False
            for mod_name, mod_adapter in self.mod_adapters.items():
                if hasattr(mod_adapter, 'message_threads') and mod_adapter.message_threads is not None:
                    if thread_id not in mod_adapter.message_threads:
                        from openagents.models.message_thread import MessageThread
                        mod_adapter.message_threads[thread_id] = MessageThread(thread_id=thread_id)
                    
                    # Add the ModMessage to the thread
                    mod_adapter.message_threads[thread_id].add_message(message)
                    logger.debug(f"Added ModMessage to thread {thread_id} in {mod_name} adapter for agent processing")
                    added_to_thread = True
                    break
            
            if not added_to_thread:
                logger.warning("No mod adapter message_threads available to add ModMessage")
    
    async def wait_direct_message(self, 
                                condition: Optional[Callable[[DirectMessage], bool]] = None,
                                timeout: float = 30.0) -> Optional[DirectMessage]:
        """Wait for a direct message that matches the given condition.
        
        Args:
            condition: Optional function to filter messages. If None, returns first message.
            timeout: Maximum time to wait in seconds
            
        Returns:
            DirectMessage if found within timeout, None otherwise
        """
        return await self._wait_for_message("direct_message", condition, timeout)
    
    async def wait_broadcast_message(self, 
                                   condition: Optional[Callable[[BroadcastMessage], bool]] = None,
                                   timeout: float = 30.0) -> Optional[BroadcastMessage]:
        """Wait for a broadcast message that matches the given condition.
        
        Args:
            condition: Optional function to filter messages. If None, returns first message.
            timeout: Maximum time to wait in seconds
            
        Returns:
            BroadcastMessage if found within timeout, None otherwise
        """
        return await self._wait_for_message("broadcast_message", condition, timeout)
    
    async def wait_mod_message(self, 
                             condition: Optional[Callable[[ModMessage], bool]] = None,
                             timeout: float = 30.0) -> Optional[ModMessage]:
        """Wait for a mod message that matches the given condition.
        
        Args:
            condition: Optional function to filter messages. If None, returns first message.
            timeout: Maximum time to wait in seconds
            
        Returns:
            ModMessage if found within timeout, None otherwise
        """
        return await self._wait_for_message("mod_message", condition, timeout)
    
    async def _wait_for_message(self, message_type: str, condition: Optional[Callable] = None, timeout: float = 30.0) -> Optional[Event]:
        """Internal method to wait for a message of a specific type.
        
        Args:
            message_type: Type of message to wait for ("direct_message", "broadcast_message", "mod_message")
            condition: Optional function to filter messages
            timeout: Maximum time to wait in seconds
            
        Returns:
            Message if found within timeout, None otherwise
        """
        if self.connector is None:
            logger.warning(f"Agent {self.agent_id} is not connected to a network")
            return None
        
        # Create event and waiter entry
        message_event = asyncio.Event()
        result_message = {"message": None}
        
        waiter_entry = {
            "event": message_event,
            "condition": condition,
            "result": result_message
        }
        
        # Add to waiters list
        self._message_waiters[message_type].append(waiter_entry)
        
        try:
            # Wait for the message with timeout
            await asyncio.wait_for(message_event.wait(), timeout=timeout)
            return result_message["message"]
        except asyncio.TimeoutError:
            logger.debug(f"Timeout waiting for {message_type} (timeout: {timeout}s)")
            return None
        finally:
            # Clean up - remove waiter from list
            if waiter_entry in self._message_waiters[message_type]:
                self._message_waiters[message_type].remove(waiter_entry)
    
    async def _notify_message_waiters(self, message_type: str, message: Event) -> None:
        """Notify all waiters for a specific message type.
        
        Args:
            message_type: Type of message received
            message: The received message
        """
        if message_type not in self._message_waiters:
            return
        
        # Create a copy of the waiters list to avoid modification during iteration
        waiters_to_notify = []
        
        for waiter in self._message_waiters[message_type][:]:  # Create a copy
            condition = waiter["condition"]
            
            # Check if message matches condition
            if condition is None or condition(message):
                waiter["result"]["message"] = message
                waiters_to_notify.append(waiter)
                # Remove from waiters list since it's been satisfied
                self._message_waiters[message_type].remove(waiter)
        
        # Notify all matching waiters
        for waiter in waiters_to_notify:
            waiter["event"].set()
    
    async def _start_message_polling(self):
        """Start periodic polling for messages (gRPC workaround)."""
        logger.info(f"🔧 CLIENT: Starting message polling for agent {self.agent_id}")
        
        while True:
            try:
                await asyncio.sleep(2.0)  # Poll every 2 seconds
                
                if hasattr(self.connector, 'poll_messages') and self.connector.is_connected:
                    await self.connector.poll_messages()
                else:
                    break  # Stop polling if connector doesn't support it or is disconnected
                    
            except Exception as e:
                logger.error(f"Error in message polling: {e}")
                await asyncio.sleep(5.0)  # Wait longer on error
    
    async def _handle_poll_messages_response(self, data: Dict[str, Any]) -> None:
        """Handle poll_messages system command response."""
        logger.info(f"🔧 CLIENT: Received poll_messages response for agent {self.agent_id}")
        
        if data.get("success"):
            messages = data.get("messages", [])
            logger.info(f"🔧 CLIENT: Processing {len(messages)} polled messages")
            
            for message_data in messages:
                try:
                    # Reconstruct the message object
                    if message_data.get("message_type") == "mod_message":
                        # Reconstruct ModMessage
                        mod_message = ModMessage(
                            sender_id=message_data.get("sender_id", ""),
                            mod=message_data.get("mod", ""),
                            relevant_agent_id=message_data.get("relevant_agent_id", ""),
                            action=message_data.get("action", ""),
                            content=message_data.get("content", {}),
                            message_id=message_data.get("message_id", ""),
                            timestamp=message_data.get("timestamp", 0)
                        )
                        
                        logger.info(f"🔧 CLIENT: Processing polled ModMessage: {mod_message.mod}, action: {mod_message.action}")
                        await self._handle_mod_message(mod_message)
                    else:
                        logger.debug(f"🔧 CLIENT: Skipping non-ModMessage: {message_data.get('message_type')}")
                        
                except Exception as e:
                    logger.error(f"Error processing polled message: {e}")
        else:
            error = data.get("error", "Unknown error")
            logger.error(f"Poll messages failed: {error}")
    