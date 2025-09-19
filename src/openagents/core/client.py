import asyncio
from typing import TYPE_CHECKING, Dict, Any, List, Optional, Set, Type, Callable, Awaitable
import uuid
import logging
from warnings import deprecated

from pydantic import BaseModel, Field

from openagents.models.detected_network_profile import DetectedNetworkProfile, DetectedTransportInfo
from openagents.models.event_response import EventResponse
from openagents.models.transport import TransportType
from openagents.utils.network_discovey import retrieve_network_details
from openagents.core.connectors.grpc_connector import GRPCNetworkConnector
from openagents.models.event import Event
from openagents.core.base_mod_adapter import BaseModAdapter
from openagents.models.messages import Event, EventNames
from openagents.config.globals import (
    AGENT_EVENT_MESSAGE, SYSTEM_EVENT_LIST_AGENTS, SYSTEM_EVENT_LIST_MODS, SYSTEM_EVENT_GET_MOD_MANIFEST, SYSTEM_EVENT_SUBSCRIBE_EVENTS, SYSTEM_EVENT_UNSUBSCRIBE_EVENTS
)
from openagents.models.tool import AgentAdapterTool
from openagents.models.message_thread import MessageThread
from openagents.utils.verbose import verbose_print
import aiohttp

logger = logging.getLogger(__name__)

class EventHandlerEntry(BaseModel):
    model_config = {"arbitrary_types_allowed": True}
    
    handler: Callable[[Event], Awaitable[None]]
    patterns: List[str] = Field(default_factory=list)

class EventWaitingEntry(BaseModel):
    model_config = {"arbitrary_types_allowed": True}
    
    event: asyncio.Event
    condition: Optional[Callable[[Event], bool]] = None
    result: Dict[str, Any] = Field(default_factory=dict)


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
        self.connector: Optional[GRPCNetworkConnector] = None
        
        # Event waiting infrastructure
        self._event_waiters: List[EventWaitingEntry] = []
        
        # Event handlers in the client level
        self._event_handlers: List[EventHandlerEntry] = []

        # General message threads
        self._general_message_threads: Dict[str, MessageThread] = {}

        # Register mod adapters if provided
        if mod_adapters:
            for mod_adapter in mod_adapters:
                self.register_mod_adapter(mod_adapter)
    
    def workspace(self):
        """Get the workspace for this agent."""
        from openagents.core.workspace import Workspace
        return Workspace(self)
    
    async def _detect_network_profile(self, host: str, port: int) -> Optional[DetectedNetworkProfile]:
        """Detect the network profile and recommended transport type by calling the health check endpoint.
        
        Args:
            host: Server host address
            port: Server port (could be gRPC port, we'll try HTTP port first)
            
        Returns:
            DetectedNetworkProfile: Network profile with detected information, or None if detection failed
        """
        async with aiohttp.ClientSession() as session:
            health_url = f"http://{host}:{port}/api/health"
            logger.debug(f"Attempting HTTP health check on {health_url}")
            
            try:
                async with session.get(health_url, timeout=aiohttp.ClientTimeout(total=5.0)) as response:
                    if response.status == 200:
                        health_data = await response.json()
                        logger.info(f"✅ Successfully retrieved health check from {health_url}")
                        if "data" in health_data:
                            health_data = health_data["data"]
                        
                        # Create DetectedNetworkProfile from health check data
                        profile = DetectedNetworkProfile.from_network_stats(health_data)
                        
                        return profile
                    else:
                        logger.debug(f"HTTP health check returned status {response.status} on {health_url}")
            except asyncio.TimeoutError:
                logger.debug(f"HTTP health check timeout on {health_url}")
            except Exception as http_e:
                logger.debug(f"HTTP health check failed on {health_url}: {http_e}")
            
            logger.error(f"Failed to detect network at {host}:{port}")
            return None

    async def connect_to_server(
        self,
        host: Optional[str] = None,
        port: Optional[int] = None,
        network_id: Optional[str] = None,
        enforce_transport_type: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        max_message_size: int = 104857600
    ) -> bool:
        """Connect to a network server.
        
        Args:
            host: Server host address
            port: Server port
            network_id: ID of the network to connect to
            enforce_transport_type: Enforce a specific transport type (grpc, http, websocket)
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
        detected_profile = await self._detect_network_profile(host, port)
        
        if detected_profile is None:
            logger.error(f"Failed to detect network at {host}:{port}")
            return False
        
        assert isinstance(detected_profile, DetectedNetworkProfile)
        transport_type = None
        optimal_transport = None

        if enforce_transport_type:
            for transport in detected_profile.transports:
                if transport.type.value == enforce_transport_type:
                    transport_type = enforce_transport_type
                    break
            if transport_type is None:
                raise ValueError(f"The network does not support enforced transport type: {enforce_transport_type}")
        else:
            transport_type = detected_profile.recommended_transport
            if transport_type is None and len(detected_profile.transports) > 0:
                # Use the first transport type that is supported
                transport_type = detected_profile.transports[0].type.value
            if transport_type is None:
                raise ValueError("No supported transport types found in the network")

        for transport in detected_profile.transports:
            if transport.type.value == transport_type:
                optimal_transport = transport
                break
        if optimal_transport is None:
            logger.error(f"Failed to find optimal transport for {transport_type}")
            return False
        
        # Extract host and port from transport config
        optimal_transport_host = optimal_transport.config.get("host", host)
        optimal_transport_port = optimal_transport.config.get("port", port)
        
        logger.info(f"Detected network: {detected_profile.network_name} ({detected_profile.network_id})")
        logger.info(f"Transport: {transport_type}, Host: {optimal_transport_host}, Port: {optimal_transport_port}")
        
        if transport_type == "grpc":
            logger.info(f"Creating gRPC connector for agent {self.agent_id}")
            # Use the main gRPC port, not the HTTP adapter port
            self.connector = GRPCNetworkConnector(optimal_transport_host, optimal_transport_port, self.agent_id, metadata, max_message_size)
        elif transport_type == "http":
            logger.info(f"Creating HTTP connector for agent {self.agent_id}")
            from openagents.core.connectors.http_connector import HTTPNetworkConnector
            self.connector = HTTPNetworkConnector(optimal_transport_host, optimal_transport_port, self.agent_id, metadata)
        elif transport_type == "websocket":
            raise NotImplementedError("WebSocket transport is not supported yet")
        else:
            logger.error(f"Unsupported transport type: {transport_type}")
            return False

        # Connect using the connector
        success = await self.connector.connect_to_server()
        
        if success:
            # Call on_connect for each mod adapter
            for mod_adapter in self.mod_adapters.values():
                mod_adapter.bind_connector(self.connector)
                mod_adapter.on_connect()
            
            # Register unified event handler for all message types
            self.connector.register_event_handler(self._handle_event)
            
            # Start message polling for gRPC connectors (workaround for bidirectional messaging limitation)
            assert hasattr(self.connector, 'is_polling'), "Connector must have is_polling attribute"
            if self.connector.is_polling:
                if hasattr(self.connector, 'poll_messages'):
                    logger.info(f"🔧 Starting message polling for  agent {self.agent_id}")
                    asyncio.create_task(self._start_message_polling())
                else:
                    raise SystemError("Connector must have poll_messages method")
            else:
                # TODO: Implement proper bidirectional messaging later
                # TODO: Create a task for periodic heartbeat
                raise NotImplementedError("Bidirectional messaging is not supported yet")
            
        
        return success

    async def connect(
        self, 
        host: Optional[str] = None, 
        port: Optional[int] = None, 
        network_id: Optional[str] = None,
        enforce_transport_type: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None, 
        max_message_size: int = 104857600
    ) -> bool:
        """Connect to a network server (alias for connect_to_server).
        
        This is a cleaner alias for the connect_to_server method.
        
        Args:
            host: Server host address
            port: Server port  
            network_id: ID of the network to connect to
            enforce_transport_type: Enforce a specific transport type (grpc, http, websocket)
            metadata: Metadata to send to the server
            max_message_size: Maximum WebSocket message size in bytes (default 10MB)
            
        Returns:
            bool: True if connection successful
        """
        return await self.connect_to_server(host, port, network_id, enforce_transport_type, metadata, max_message_size)
    
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
        class_name = mod_adapter.__class__.__name__
        module_name = getattr(mod_adapter, '_mod_name', None)
        
        if class_name in self.mod_adapters:
            logger.warning(f"Protocol {class_name} already registered with agent {self.agent_id}")
            return False
        
        # Bind the agent to the mod
        mod_adapter.bind_agent(self.agent_id)
        
        # Store adapter under class name (primary key)
        self.mod_adapters[class_name] = mod_adapter
        
        # Also store under module name for backward compatibility if available
        if module_name and module_name != class_name:
            self.mod_adapters[module_name] = mod_adapter
            
        # Also store under full module path if the adapter module is available
        module_path = getattr(mod_adapter.__class__, '__module__', None)
        if module_path and module_path not in self.mod_adapters:
            self.mod_adapters[module_path] = mod_adapter
            
            # Also store under parent module (e.g., "openagents.mods.workspace.messaging" 
            # for "openagents.mods.workspace.messaging.adapter")
            if '.' in module_path:
                parent_module = '.'.join(module_path.split('.')[:-1])
                if parent_module and parent_module not in self.mod_adapters:
                    self.mod_adapters[parent_module] = mod_adapter
        
        mod_adapter.initialize()
        if self.connector is not None:
            mod_adapter.bind_connector(self.connector)
            mod_adapter.on_connect()
        logger.info(f"Registered mod adapter {class_name} with agent {self.agent_id}")
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
    
    async def send_event(self, event: Event) -> Optional[EventResponse]:
        """Send an event to the network.
        
        This unified method handles all types of events (direct messages, broadcast messages, 
        mod messages, etc.) through the same processing pipeline.
        
        Args:
            event: The event to send
            
        Returns:
            bool: True if event was sent successfully
        """
        print(f"🔄 AgentClient.send_event called for agent {self.agent_id}")
        print(f"   Event: {event.event_name} to {event.destination_id}")
        print(f"   Available mod adapters: {list(self.mod_adapters.keys())}")
        print(f"   Connector: {self.connector}")
        print(f"   Connector is_connected: {getattr(self.connector, 'is_connected', 'N/A')}")
        verbose_print(f"🔄 AgentClient.send_event called for event {event.event_name} to {event.destination_id}")
        verbose_print(f"   Available mod adapters: {list(self.mod_adapters.keys())}")
        
        try:
            processed_event = event
            for mod_name, mod_adapter in self.mod_adapters.items():
                print(f"   Processing through {mod_name} adapter...")
                processed_event = await mod_adapter.process_outgoing_event(processed_event)
                print(f"   Result from {mod_name}: {'✅ event' if processed_event else '❌ None'}")
                verbose_print(f"   Processing through {mod_name} adapter...")
                verbose_print(f"   Result from {mod_name}: {'✅ event' if processed_event else '❌ None'}")
                if processed_event is None:
                    return None
            
            if processed_event is not None:
                print(f"🚀 Sending event via connector...")
                print(f"   Final processed event name: {processed_event.event_name}")
                print(f"   Final processed event target: {processed_event.destination_id}")
                verbose_print(f"🚀 Sending event via connector...")
                result = await self.connector.send_event(processed_event)
                print(f"✅ Event sent via connector - result: {result}")
                verbose_print(f"✅ Event sent via connector successfully")
                return result
            else:
                print(f"❌ Event was filtered out by mod adapters - not sending")
                verbose_print(f"❌ Event was filtered out by mod adapters - not sending")
                return None
        except Exception as e:
            print(f"❌ Connector failed to send event: {e}")
            print(f"Exception type: {type(e).__name__}")
            import traceback
            traceback.print_exc()
            return None
    
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
        
        # Create system event for listing mods
        system_event = Event(
            event_name=SYSTEM_EVENT_LIST_MODS,
            source_id=self.agent_id,
            destination_id="system:system",
            payload={"agent_id": self.agent_id}
        )
        
        try:
            # Send the event and get response
            response = await self.send_event(system_event)
            if response and response.success:
                return response.data.get("mods", []) if response.data else []
            else:
                error = response.message if response else "No response"
                logger.error(f"Failed to list mods: {error}")
                return []
        except Exception as e:
            logger.error(f"Error listing mods: {e}")
            return []
    
    
    async def list_agents(self) -> List[Dict[str, Any]]:
        """Get a list of agents connected to the network.
        
        Returns:
            List[Dict[str, Any]]: List of agent information dictionaries
        """
        if self.connector is None:
            logger.warning(f"Agent {self.agent_id} is not connected to a network")
            return []
        
        # Create system event for listing agents
        system_event = Event(
            event_name=SYSTEM_EVENT_LIST_AGENTS,
            source_id=self.agent_id,
            destination_id="system:system",
            payload={"agent_id": self.agent_id}
        )
        
        try:
            # Send the event and get response
            response = await self.send_event(system_event)
            if response and response.success:
                return response.data.get("agents", []) if response.data else []
            else:
                error = response.message if response else "No response"
                logger.error(f"Failed to list agents: {error}")
                return []
        except Exception as e:
            logger.error(f"Error listing agents: {e}")
            return []
    
    
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
        
        # Create system event for getting mod manifest
        system_event = Event(
            event_name=SYSTEM_EVENT_GET_MOD_MANIFEST,
            source_id=self.agent_id,
            destination_id="system:system",
            payload={
                "agent_id": self.agent_id,
                "mod_name": mod_name
            }
        )
        
        try:
            # Send the event and get response
            response = await self.send_event(system_event)
            if response and response.success:
                return response.data.get("manifest", {}) if response.data else {}
            else:
                error = response.message if response else "No response"
                logger.error(f"Failed to get mod manifest for {mod_name}: {error}")
                return None
        except Exception as e:
            logger.error(f"Error getting mod manifest for {mod_name}: {e}")
            return None

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
        logger.debug(f"🔧 CLIENT: get_messsage_threads called, found {len(self.mod_adapters)} adapters")
        for mod_name, adapter in self.mod_adapters.items():
            try:
                adapter_threads = adapter.message_threads
                logger.debug(f"🔧 CLIENT: Adapter {mod_name} has {len(adapter_threads) if adapter_threads else 0} threads")
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
        
        for thread_id, thread in self._general_message_threads.items():
            if thread_id not in threads:
                threads[thread_id] = thread
            else:
                logger.warning(f"Thread {thread_id} already exists in general message threads")
        
        return threads
    
    
    async def _handle_event(self, event: Event) -> None:
        """Handle an incoming event from the network.
        
        This unified method handles all types of events (direct messages, broadcast messages,
        mod messages, etc.) through the same processing pipeline.
        
        Args:
            event: The event to handle
        """
        print(f"🔧 CLIENT: Handling Event from {event.source_id}, event={event.event_name}")
        print(f"🔧 CLIENT: Event payload keys: {list(event.payload.keys()) if event.payload else 'None'}")
        print(f"🔧 CLIENT: Agent ID: {self.agent_id}, Event target: {event.destination_id}")
        logger.info(f"🔧 CLIENT: Handling Event from {event.source_id}, event={event.event_name}")
        logger.info(f"🔧 CLIENT: Event payload keys: {list(event.payload.keys()) if event.payload else 'None'}")
        logger.info(f"🔧 CLIENT: Agent ID: {self.agent_id}, Event target: {event.destination_id}")
        
        # Notify any waiting functions
        await self._notify_event_waiters(event)
        
        # Call registered event handlers
        await self._call_event_handlers(event)
        
        # Notify mod adapters
        processed_by_adapter = False
        
        for mod_name, mod_adapter in self.mod_adapters.items():
            try:
                processed_event = await mod_adapter.process_incoming_event(event)
                if processed_event is None:
                    processed_by_adapter = True
                    logger.debug(f"Mod adapter {mod_name} processed the event")
                    break
            except Exception as e:
                logger.error(f"Error handling event in mod adapter {mod_adapter.__class__.__name__}: {e}")
                import traceback
                traceback.print_exc()
        
        # If no mod adapter processed the event, add it to message threads for agent processing
        if not processed_by_adapter:
            logger.debug(f"Event not processed by adapters, adding to message threads for agent processing")
            
            # Create a thread ID for the Event
            if "." in event.event_name:
                thread_id = "client_thread:" + event.event_name.rsplit(".", 1)[0]
            else:
                thread_id = "client_thread:" + event.event_name
            
            # Try to add the event to any available mod adapter's message threads
            if thread_id not in self._general_message_threads:
                self._general_message_threads[thread_id] = MessageThread()
            
            # Add the Event to the thread
            self._general_message_threads[thread_id].add_message(event)
    
    async def wait_event(self, 
                       condition: Optional[Callable[[Event], bool]] = None,
                       timeout: float = 30.0) -> Optional[Event]:
        """Wait for an event that matches the given condition.
        
        This unified method can wait for any type of event (direct messages, broadcast messages,
        mod messages, etc.) through the same interface.
        
        Args:
            condition: Optional function to filter events. If None, returns first matching event.
            timeout: Maximum time to wait in seconds
            
        Returns:
            Event if found within timeout, None otherwise
        """
        # Wait for any event that matches the condition
        return await self._wait_for_message(condition, timeout)
    
    async def _wait_for_message(self, condition: Optional[Callable] = None, timeout: float = 30.0) -> Optional[Event]:
        """Internal method to wait for any event that matches the condition.
        
        Args:
            condition: Optional function to filter events
            timeout: Maximum time to wait in seconds
            
        Returns:
            Event if found within timeout, None otherwise
        """
        if self.connector is None:
            logger.warning(f"Agent {self.agent_id} is not connected to a network")
            return None
        
        # Create event and waiter entry
        event_waiter = asyncio.Event()
        result_event = {"event": None}
        
        waiter_entry = EventWaitingEntry(
            event=event_waiter,
            condition=condition,
            result=result_event
        )
        
        # Add to event waiters list
        self._event_waiters.append(waiter_entry)
        
        try:
            # Wait for any event with timeout
            await asyncio.wait_for(event_waiter.wait(), timeout=timeout)
            return result_event["event"]
        except asyncio.TimeoutError:
            logger.debug(f"Timeout waiting for event (timeout: {timeout}s)")
            return None
        finally:
            # Clean up - remove waiter from list
            if waiter_entry in self._event_waiters:
                self._event_waiters.remove(waiter_entry)
    
    async def _notify_event_waiters(self, event: Event) -> None:
        """Notify all waiters that match the given event.
        
        Args:
            event: The received event
        """
        # Create a copy of the waiters list to avoid modification during iteration
        waiters_to_notify = []
        
        for waiter in self._event_waiters[:]:  # Create a copy
            condition = waiter.condition
            
            # Check if event matches condition
            if condition is None or condition(event):
                waiter.result["event"] = event
                waiters_to_notify.append(waiter)
                # Remove from waiters list since it's been satisfied
                self._event_waiters.remove(waiter)
        
        # Notify all matching waiters
        for waiter in waiters_to_notify:
            waiter.event.set()
    
    async def _start_message_polling(self):
        """Start periodic polling for messages (gRPC workaround)."""
        logger.info(f"🔧 CLIENT: Starting message polling for agent {self.agent_id}")
        
        poll_count = 0
        while True:
            try:
                await asyncio.sleep(1.0)  # Poll every 1 second for faster message delivery
                poll_count += 1
                logger.debug(f"🔧 CLIENT: Polling attempt #{poll_count} for agent {self.agent_id}")
                
                if hasattr(self.connector, 'poll_messages') and self.connector.is_connected:
                    await self.connector.poll_messages()
                else:
                    logger.info(f"🔧 CLIENT: Stopping polling for agent {self.agent_id} - connector not available or disconnected")
                    break  # Stop polling if connector doesn't support it or is disconnected
                    
            except Exception as e:
                logger.error(f"🔧 CLIENT: Error in message polling for agent {self.agent_id}: {e}")
                await asyncio.sleep(5.0)  # Wait longer on error
    
    async def subscribe_events(self, event_patterns: List[str], channels: Optional[List[str]] = None) -> Optional[EventResponse]:
        """Subscribe to events matching the given patterns."""
        if self.connector is None:
            logger.warning(f"Agent {self.agent_id} is not connected to a network")
            return

        request = Event(
            event_name=SYSTEM_EVENT_SUBSCRIBE_EVENTS,
            source_id=self.agent_id,
            destination_id=None,
            payload={
                "event_patterns": event_patterns,
                "channels": channels
            }
        )
        return await self.send_event(request)
    
    async def unsubscribe_events(self, subscription_id: str) -> Optional[EventResponse]:
        """Unsubscribe from events matching the given patterns."""
        if self.connector is None:
            logger.warning(f"Agent {self.agent_id} is not connected to a network")
            return
        
        request = Event(
            event_name=SYSTEM_EVENT_UNSUBSCRIBE_EVENTS,
            source_id=self.agent_id,
            destination_id=None,
            payload={
                "subscription_id": subscription_id
            }
        )
        return await self.send_event(request)
    
    def register_event_handler(
        self,
        handler: Callable[[Event], Awaitable[None]], 
        event_patterns: Optional[List[str]] = None,
    ) -> None:
        """Register an event handler for the agent.
        
        Args:
            handler: The handler function to register
            event_patterns: Optional list of patterns to filter event names. Supports wildcards (*) and exact matches.
                           If None, handler will receive all events.
        """
        # Create handler entry
        handler_entry = EventHandlerEntry(
            handler=handler,
            patterns=event_patterns or []
        )
        
        # Add to handlers list
        self._event_handlers.append(handler_entry)
        patterns_str = ", ".join(event_patterns) if event_patterns else "all events"
        logger.debug(f"Registered event handler with patterns: {patterns_str}")
    
    def register_agent_message_handler(self, handler: Callable[[Event], Awaitable[None]]) -> None:
        """Register an event handler for the agent.
        
        Args:
            handler: The handler function to register
        """
        self.register_event_handler(handler, ["agent.*"])
    
    async def send_agent_message(self, destination_id: str, payload: Dict[str, Any]) -> Optional[EventResponse]:
        """Send a simple message to an agent. 
        This is a
        
        Args:
            destination_id: The ID of the agent to send the message to
            payload: The payload of the message
        """
        message = Event(
            event_name=AGENT_EVENT_MESSAGE,
            source_id=self.agent_id,
            destination_id=destination_id,
            payload=payload
        )
        return await self.send_event(message)
    
    def unregister_event_handler(self, handler: Callable[[Event], Awaitable[None]]) -> bool:
        """Unregister an event handler from the agent.
        
        Args:
            handler: The handler function to unregister
            
        Returns:
            bool: True if handler was found and removed, False otherwise
        """
        for i, handler_entry in enumerate(self._event_handlers):
            if handler_entry.handler == handler:
                del self._event_handlers[i]
                patterns_str = ", ".join(handler_entry.patterns) if handler_entry.patterns else "all events"
                logger.debug(f"Unregistered event handler with patterns: {patterns_str}")
                return True
        
        logger.warning("Event handler not found for unregistration")
        return False
    
    async def _call_event_handlers(self, event: Event) -> None:
        """Call all registered event handlers that match the event.
        
        Args:
            event: The event to process
        """
        for handler_entry in self._event_handlers:
            try:
                # Check if any pattern matches
                pattern_matches = True
                if handler_entry.patterns:
                    # If patterns are specified, at least one must match
                    pattern_matches = any(
                        event.matches_pattern(pattern)
                        for pattern in handler_entry.patterns
                    )
                
                if pattern_matches:
                    patterns_str = ", ".join(handler_entry.patterns) if handler_entry.patterns else "all events"
                    logger.debug(f"Calling event handler for patterns: {patterns_str}")
                    await handler_entry.handler(event)
                    
            except Exception as e:
                patterns_str = ", ".join(handler_entry.patterns) if handler_entry.patterns else "all events"
                logger.error(f"Error in event handler for patterns '{patterns_str}': {e}")
                import traceback
                traceback.print_exc()