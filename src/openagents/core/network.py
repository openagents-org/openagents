from typing import Dict, Any, List, Optional, Set, Type, Callable, Awaitable, Union
import uuid
import logging
from .base_protocol import BaseProtocol
import json
import asyncio
import os
import importlib
import websockets
from websockets.asyncio.server import serve, ServerConnection
from websockets.exceptions import ConnectionClosed
from openagents.models.messages import (
    BaseMessage, 
    DirectMessage,
    BroadcastMessage,
    ProtocolMessage
)
from openagents.models.manifest import ProtocolManifest
from openagents.utils.message_util import parse_message_dict
from pydantic import BaseModel, ConfigDict
from .system_commands import (
    SystemCommandRegistry, 
    handle_register_agent,
    handle_list_agents,
    handle_list_protocols,
    handle_get_protocol_manifest,
    REGISTER_AGENT,
    LIST_AGENTS,
    LIST_PROTOCOLS,
    GET_PROTOCOL_MANIFEST
)

logger = logging.getLogger(__name__)

class AgentConnection(BaseModel):
    """Model representing an agent connection to the network."""
    agent_id: str
    connection: Union[ServerConnection, Any]
    metadata: Dict[str, Any]
    last_activity: float = 0.0
    
    model_config = ConfigDict(arbitrary_types_allowed=True)


class AgentNetworkServer:
    """Core network server implementation for OpenAgents.
    
    A network server that agents can connect to using WebSocket connections.
    """
    
    def __init__(self, network_name: str, network_id: Optional[str] = None, host: str = "127.0.0.1", port: int = 8765, metadata: Optional[Dict[str, Any]] = None) -> None:
        """Initialize a network server.
        
        Args:
            network_name: Human-readable name for the network
            network_id: Optional unique identifier for the network
            host: Host address to bind to
            port: Port to listen on
            metadata: Optional metadata for the network
        """
        self.network_id = network_id or str(uuid.uuid4())
        self.network_name = network_name
        self.host = host
        self.port = port
        self.metadata = metadata or {}
        self.protocols: Dict[str, BaseProtocol] = {}
        self.protocol_manifests: Dict[str, ProtocolManifest] = {}
        self.connections: Dict[str, AgentConnection] = {}  # agent_id -> connection
        self.agents: Dict[str, Dict[str, Any]] = {}  # agent_id -> metadata
        self.is_running = False
        self.server = None
        
        # Initialize system command registry
        self.system_command_registry = SystemCommandRegistry()
        self._register_system_command_handlers()
    
    def _register_system_command_handlers(self) -> None:
        """Register handlers for system commands."""
        # Wrap handlers to include network instance
        async def wrapped_register_agent(command: str, data: Dict[str, Any], connection: ServerConnection) -> None:
            await handle_register_agent(command, data, connection, self)
            
        async def wrapped_list_agents(command: str, data: Dict[str, Any], connection: ServerConnection) -> None:
            await handle_list_agents(command, data, connection, self)
            
        async def wrapped_list_protocols(command: str, data: Dict[str, Any], connection: ServerConnection) -> None:
            await handle_list_protocols(command, data, connection, self)
        
        async def wrapped_get_protocol_manifest(command: str, data: Dict[str, Any], connection: ServerConnection) -> None:
            await handle_get_protocol_manifest(command, data, connection, self)
        
        # Register handlers
        self.system_command_registry.register_handler(REGISTER_AGENT, wrapped_register_agent)
        self.system_command_registry.register_handler(LIST_AGENTS, wrapped_list_agents)
        self.system_command_registry.register_handler(LIST_PROTOCOLS, wrapped_list_protocols)
        self.system_command_registry.register_handler(GET_PROTOCOL_MANIFEST, wrapped_get_protocol_manifest)
    
    def load_protocol_manifest(self, protocol_name: str) -> Optional[ProtocolManifest]:
        """Load a protocol manifest based on the protocol name.
        
        Args:
            protocol_name: Name of the protocol to load
            
        Returns:
            Optional[ProtocolManifest]: Protocol manifest if found, None otherwise
        """
        # protocol_name will be something like openagents.protocols.communication.simple_messaging
        logger.debug(f"Looking for manifest for protocol {protocol_name}")

        # Try to find the module path
        if protocol_name.startswith('openagents.'):
            module_path = protocol_name
        else:
            module_path = f"openagents.protocols.{protocol_name}"
        
        # Try to import the module to get its file path
        loaded_manifest = None
        try:
            module = importlib.import_module(module_path)
            module_dir = os.path.dirname(os.path.abspath(module.__file__))
            logger.debug(f"Found module directory for {protocol_name}: {module_dir}")
            
            # Look for protocol_manifest.json in the module directory
            manifest_path = os.path.join(module_dir, "protocol_manifest.json")
            logger.debug(f"Looking for manifest at {manifest_path}")
            if os.path.exists(manifest_path):
                logger.debug(f"Found manifest file at {manifest_path}")
                try:
                    with open(manifest_path, 'r') as f:
                        manifest = ProtocolManifest.model_validate_json(f.read())
                        logger.info(f"Loaded manifest for protocol {protocol_name}")
                        loaded_manifest = manifest
                except json.JSONDecodeError as e:
                    logger.error(f"Invalid JSON in manifest for {protocol_name}: {e}")
                except IOError as e:
                    logger.error(f"IO error reading manifest for {protocol_name}: {e}")
                except ValueError as e:
                    logger.error(f"Value error parsing manifest for {protocol_name}: {e}")
            else:
                logger.debug(f"No manifest file found at {manifest_path}")
        except ImportError as e:
            logger.debug(f"Could not import module {module_path}: {e}")
        except AttributeError as e:
            logger.debug(f"Module {module_path} has no __file__ attribute: {e}")
        
        return loaded_manifest
        
    def register_protocol(self, protocol_name: str, config: Optional[Dict[str, Any]] = None) -> bool:
        """Register a protocol with this network by name.
        
        Args:
            protocol_name: Name of the protocol to register (can be in dot notation, e.g., 'communication.simple_messaging')
            
        Returns:
            bool: True if registration was successful
        """
        if protocol_name in self.protocols:
            logger.warning(f"Protocol {protocol_name} already registered")
            return False

        manifest = self.load_protocol_manifest(protocol_name)
        if manifest is None:
            logger.error(f"Failed to load manifest for protocol {protocol_name}")
            return False
        
        protocol_class_name = manifest.network_protocol_class
        if protocol_class_name is None:
            logger.error(f"No protocol class found in manifest for protocol {protocol_name}")
            return False
        
        # Import the protocol class
        try:
            # Extract the module path from the protocol name
            module_path = f"{protocol_name}.protocol"
            logger.debug(f"Attempting to import protocol class from {module_path}")
            
            # Import the module
            module = importlib.import_module(module_path)
            
            # Get the protocol class from the module
            class_name = protocol_class_name.split('.')[-1]
            protocol_class = getattr(module, class_name)
            logger.debug(f"Successfully imported protocol class: {class_name} from {module_path}")
        except ImportError as e:
            logger.error(f"Failed to import protocol module {module_path}: {e}")
            return False
        except AttributeError as e:
            logger.error(f"Protocol class {class_name} not found in module {module_path}: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error importing protocol class: {e}")
            return False
        
        # Instantiate the protocol
        try:
            protocol_instance = protocol_class()
            logger.debug(f"Successfully instantiated protocol: {protocol_name}")
        except Exception as e:
            logger.error(f"Error instantiating protocol class: {e}")
            raise
        
        # Bind the protocol to this network
        try:
            protocol_instance.bind_network(self)
            logger.debug(f"Successfully bound protocol to network: {protocol_name}")
        except Exception as e:
            logger.error(f"Error binding protocol to network: {e}")
            raise
        
        # Update the protocol config with the default config
        try:
            protocol_instance.update_config(manifest.default_config)
        except Exception as e:
            logger.error(f"Error updating default protocol config: {e}")
            raise
        
        if config is not None:
            try:
                protocol_instance.update_config(config)
            except Exception as e:
                logger.error(f"Error updating protocol config: {e}")
                raise
            
        self.protocols[protocol_name] = protocol_instance
        self.protocol_manifests[protocol_name] = manifest
        logger.info(f"Registered protocol {protocol_name}")
        return True
      
    
    async def handle_connection(self, websocket: ServerConnection) -> None:
        """Handle a new WebSocket connection.
        
        Args:
            websocket: The WebSocket connection
            path: The connection path
        """
        agent_id = None
        
        try:
            # Wait for registration message
            message = await websocket.recv()
            data = json.loads(message)
            
            # Handle initial system request for registration
            if data.get("type") == "system_request" and data.get("command") == REGISTER_AGENT:
                # Extract agent ID for later use
                agent_id = data.get("agent_id")
                
                # Handle registration using the system command registry
                await self.system_command_registry.handle_command(REGISTER_AGENT, data, websocket)
                
                # Handle messages from this connection
                try:
                    async for message in websocket:
                        # Update last activity time
                        if agent_id in self.connections:
                            self.connections[agent_id].last_activity = asyncio.get_event_loop().time()
                        
                        data = json.loads(message)
                        
                        if data.get("type") == "message":
                            # Parse message data
                            message_data = data.get("data", {})
                            message_obj = parse_message_dict(message_data)
                            
                            # Ensure sender_id is set to the connected agent's ID
                            message_obj.sender_id = agent_id
                            
                            # Process the message based on its type
                            if isinstance(message_obj, DirectMessage):
                                await self._handle_direct_message(message_obj)
                            elif isinstance(message_obj, BroadcastMessage):
                                await self._handle_broadcast_message(message_obj)
                            elif isinstance(message_obj, ProtocolMessage):
                                await self._handle_protocol_message(message_obj)
                            else:
                                logger.warning(f"Received unknown message type from {agent_id}: {message_obj.message_type}")
                        
                        elif data.get("type") == "system_request":
                            # Add agent_id to the data for handlers
                            data["agent_id"] = agent_id
                            
                            # Handle system requests using the registry
                            command = data.get("command")
                            if not await self.system_command_registry.handle_command(command, data, websocket):
                                logger.warning(f"Received unknown system command from {agent_id}: {command}")
                                await websocket.send(json.dumps({
                                    "type": "system_response",
                                    "command": command,
                                    "success": False,
                                    "error": f"Unknown command: {command}"
                                }))
                        
                except ConnectionClosed:
                    logger.info(f"Connection closed for agent {agent_id}")
                
            else:
                logger.error(f"Received non-registration message as first message")
                await websocket.close(1008, "Expected registration message")
            
        except Exception as e:
            logger.error(f"Error handling connection: {e}")
            try:
                await websocket.close(1011, f"Internal error: {str(e)}")
            except:
                pass
            
        finally:
            # Clean up connection
            if agent_id and agent_id in self.connections:
                del self.connections[agent_id]
                logger.info(f"Removed connection for agent {agent_id}")
                
                # Unregister agent
                self.unregister_agent(agent_id)
    
    async def _handle_direct_message(self, message: DirectMessage) -> None:
        """Handle a direct message from an agent.
        
        Args:
            message: The direct message
        """
        sender_id = message.sender_id
        target_id = message.target_agent_id
        
        logger.debug(f"Handling direct message from {sender_id} to {target_id}: {message.message_id}")

        await self.send_direct_message(message)

    async def _handle_broadcast_message(self, message: BroadcastMessage) -> None:
        """Handle a broadcast message from an agent.
        
        Args:
            message: The broadcast message
        """
        sender_id = message.sender_id
        
        logger.debug(f"Handling broadcast message from {sender_id}: {message.message_id}")
        
        await self.send_broadcast_message(message)

    async def _handle_protocol_message(self, message: ProtocolMessage) -> None:
        """Handle a protocol message from an agent.
        
        Args:
            message: The protocol message
        """
        sender_id = message.sender_id
        protocol_name = message.protocol
        
        logger.debug(f"Handling protocol message from {sender_id} for protocol {protocol_name}: {message.message_id}")
        
        await self.send_protocol_message(message)
    
    def start(self) -> None:
        """Start the network server in the background."""
        if self.is_running:
            logger.warning("Network server already running")
            return
            
        # Start the server in a background task
        asyncio.create_task(self._run_server())
        self.is_running = True
        logger.info(f"Network server starting on {self.host}:{self.port}")
    
    async def _run_server(self) -> None:
        """Run the WebSocket server."""
        self.server = await serve(self.handle_connection, self.host, self.port)
        logger.info(f"Network server running on {self.host}:{self.port}")

        # Initialize all protocols
        for protocol in self.protocols.values():
            protocol.initialize()
        
        # Start inactive agent cleanup task
        # This functionality is disabled for now as it's not needed
        # asyncio.create_task(self._cleanup_inactive_agents())
        
        try:
            await self.server.wait_closed()
        except asyncio.CancelledError:
            self.server.close()
            await self.server.wait_closed()
            logger.info("Network server stopped")
    
    async def _cleanup_inactive_agents(self) -> None:
        """Periodically clean up inactive agents."""
        CLEANUP_INTERVAL = 60  # seconds
        MAX_INACTIVE_TIME = 300  # seconds
        
        while self.is_running:
            try:
                current_time = asyncio.get_event_loop().time()
                inactive_agents = []
                
                # # Find inactive agents
                # for agent_id, connection in self.connections.items():
                #     if current_time - connection.last_activity > MAX_INACTIVE_TIME:
                #         inactive_agents.append(agent_id)
                
                # # Remove inactive agents
                # for agent_id in inactive_agents:
                #     logger.info(f"Removing inactive agent {agent_id}")
                #     if agent_id in self.connections:
                #         try:
                #             await self.connections[agent_id].connection.close()
                #         except:
                #             pass
                #         del self.connections[agent_id]
                #         self.unregister_agent(agent_id)
                
                await asyncio.sleep(CLEANUP_INTERVAL)
            except Exception as e:
                logger.error(f"Error in cleanup task: {e}")
                await asyncio.sleep(CLEANUP_INTERVAL)
    
    def stop(self) -> None:
        """Stop the network server."""
        if not self.is_running:
            logger.warning("Network server not running")
            return
            
        self.is_running = False

        # Shutdown all protocols
        for protocol in self.protocols.values():
            protocol.shutdown()
        
        # Close all connections
        for connection_info in self.connections.values():
            asyncio.create_task(connection_info.connection.close())
        
        # Close the server
        if self.server:
            self.server.close()
        
        self.connections.clear()
        logger.info("Network server stopped")
    
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
                if hasattr(protocol, "handle_register_agent"):
                    protocol.handle_register_agent(agent_id, metadata)
                    logger.info(f"Registered agent {agent_name} ({agent_id}) with protocol {protocol_name}")
            except Exception as e:
                logger.error(f"Failed to register agent {agent_name} ({agent_id}) with protocol {protocol_name}: {e}")
                # Continue with other protocols even if one fails
        
        # Log detailed agent information
        
        logger.info(f"Agent {agent_name} ({agent_id}) joined network {self.network_name} ({self.network_id})")
        
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
                if hasattr(protocol, "handle_unregister_agent"):
                    protocol.handle_unregister_agent(agent_id)
                    logger.info(f"Unregistered agent {agent_name} ({agent_id}) from protocol {protocol_name}")
            except Exception as e:
                logger.error(f"Failed to unregister agent {agent_name} ({agent_id}) from protocol {protocol_name}: {e}")
                # Continue with other protocols even if one fails
        
        self.agents.pop(agent_id)
        logger.info(f"Agent {agent_name} ({agent_id}) left network {self.network_name} ({self.network_id})")
        
        return True
    
    async def send_direct_message(self, message: DirectMessage, bypass_protocols: bool = False) -> bool:
        """Send a message to an agent.
        
        Args:
            message: Message to send (must be a BaseMessage instance)
            
        Returns:
            bool: True if message was sent successfully
        """
        if not self.is_running:
            logger.warning(f"Network {self.network_id} not running")
            return False

        # Process the message
        processed_message = message
        if not bypass_protocols:
            for protocol in self.protocols.values():
                try:
                    processed_message = await protocol.process_direct_message(message)
                    if processed_message is None:
                        break
                except Exception as e:
                    logger.error(f"Error in protocol {protocol.__class__.__name__} handling direct message: {e}")
        
        if processed_message is None:
            # Message was fully handled by a protocol
            return True

        target_id = message.target_agent_id
        if target_id not in self.connections:
            logger.error(f"Target agent {target_id} not connected")
            return False

        try:
            # Send the message
            await self.connections[target_id].connection.send(json.dumps({
                "type": "message",
                "data": processed_message.model_dump()
            }))
            
            logger.debug(f"Message sent to {target_id}: {processed_message.message_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to send message to {target_id}: {e}")
            return False
    
    async def send_broadcast_message(self, message: BroadcastMessage, bypass_protocols: bool = False) -> bool:
        """Send a broadcast message to all connected agents.
        
        Args:
            message: Broadcast message to send
            bypass_protocols: If True, skip protocol processing
            
        Returns:
            bool: True if message was broadcast successfully
        """
        if not self.is_running:
            logger.warning(f"Network {self.network_id} not running")
            return False

        # Process the message through protocols
        processed_message = message
        if not bypass_protocols:
            for protocol in self.protocols.values():
                try:
                    processed_message = await protocol.process_broadcast_message(message)
                    if processed_message is None:
                        break
                except Exception as e:
                    logger.error(f"Error in protocol {protocol.__class__.__name__} handling broadcast message: {e}")
                    
        if processed_message is None:
            # Message was fully handled by a protocol
            return True

        # Determine which agents to exclude
        exclude_ids = set([message.sender_id])
        if hasattr(message, "exclude_agent_ids") and message.exclude_agent_ids:
            exclude_ids.update(message.exclude_agent_ids)
            
        # Send to all connected agents except excluded ones
        success = True
        for agent_id, connection_info in self.connections.items():
            if agent_id not in exclude_ids:
                try:
                    await connection_info.connection.send(json.dumps({
                        "type": "message",
                        "data": processed_message.model_dump()
                    }))
                    logger.debug(f"Broadcast message {processed_message.message_id} sent to {agent_id}")
                except Exception as e:
                    logger.error(f"Failed to send broadcast message to {agent_id}: {e}")
                    success = False
                    
        return success
    
    async def send_protocol_message(self, message: ProtocolMessage) -> bool:
        """Send a protocol message to the appropriate protocol handler.
        
        Args:
            message: Protocol message to send
            
        Returns:
            bool: True if message was sent successfully
        """
        if not self.is_running:
            logger.warning(f"Network {self.network_id} not running")
            return False
        
        
        # Process the message through protocols
        if message.direction == "inbound":
            protocol_name = message.protocol
            if protocol_name in self.protocols:
                try:
                    await self.protocols[protocol_name].process_protocol_message(message)
                except Exception as e:
                    logger.error(f"Error in protocol {protocol_name} handling protocol message: {e}")
            else:
                logger.warning(f"Protocol {protocol_name} not found in network")
                return False
        
        # If the message is outbound, send it to the target agent
        if message.direction == "outbound":
            target_id = message.relevant_agent_id
            
            if target_id in self.connections:
                try:
                    await self.connections[target_id].connection.send(json.dumps({
                        "type": "message",
                        "data": message.model_dump()
                    }))
                    logger.debug(f"Protocol message {message.message_id} sent to {target_id}")
                    return True
                except Exception as e:
                    logger.error(f"Failed to send protocol message to {target_id}: {e}")
                    return False
            else:
                logger.warning(f"Target agent {target_id} not connected")
                return False
            
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
            "network_name": self.network_name,
            "is_running": self.is_running,
            "agent_count": len(self.agents),
            "connected_count": len(self.connections),
            "protocols": {},
            "protocol_manifests": {}
        }
        
        # Add protocol states
        for protocol_name, protocol in self.protocols.items():
            protocol_state = {}
            if hasattr(protocol, "get_network_state"):
                protocol_state = protocol.get_network_state()
            
            # Add implementation information
            protocol_state.update({
                "implementation": protocol.__class__.__module__ + "." + protocol.__class__.__name__,
                "description": getattr(protocol, "description", "No description available"),
                "version": getattr(protocol, "version", "1.0.0")
            })
            
            state["protocols"][protocol_name] = protocol_state
        
        # Add protocol manifest information
        for protocol_name, manifest in self.protocol_manifests.items():
            state["protocol_manifests"][protocol_name] = {
                "name": manifest.name,
                "version": manifest.version,
                "description": manifest.description,
                "capabilities": manifest.capabilities,
                "authors": manifest.authors,
                "license": manifest.license,
                "network_protocol_class": manifest.network_protocol_class,
                "requires_adapter": manifest.requires_adapter
            }
        
        return state