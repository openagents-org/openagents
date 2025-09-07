"""
Agent network implementation for OpenAgents.

This module provides the network architecture using the transport and topology
abstractions for milestone 1.
"""

import asyncio
import json
import logging
import uuid
import time
import yaml
from typing import Dict, Any, List, Optional, Callable, Awaitable, Union, Set, TYPE_CHECKING

if TYPE_CHECKING:
    from openagents.core.workspace import Workspace
from pathlib import Path

from openagents.core.transport import Transport, TransportManager
from openagents.models.transport import TransportType
from openagents.core.topology import NetworkTopology, NetworkMode, AgentInfo, create_topology
from openagents.models.messages import Event, EventNames
from openagents.models.network_config import NetworkConfig, NetworkMode as ConfigNetworkMode
from openagents.core.agent_identity import AgentIdentityManager
from openagents.core.events import EventBus
from openagents.models.event import Event, EventNames, EventVisibility
from openagents.core.events.event_bridge import EventBridge
from openagents.core.message_processor import MessageProcessor
from openagents.config.globals import WORKSPACE_DEFAULT_MOD_NAME
from openagents.utils.protobuf_utils import safe_get, protobuf_to_dict

logger = logging.getLogger(__name__)


class AgentConnection:
    """Represents a connection to an agent."""
    
    def __init__(self, agent_id: str, connection: Any, metadata: Dict[str, Any], last_activity: float):
        self.agent_id = agent_id
        self.connection = connection
        self.metadata = metadata
        self.last_activity = last_activity


class AgentNetwork:
    """Agent network implementation using transport and topology abstractions."""
    
    def __init__(self, config: NetworkConfig):
        """Initialize the agent network.
        
        Args:
            config: Network configuration
        """
        self.config = config
        self.network_name = config.name
        self.network_id = config.node_id or f"network-{uuid.uuid4().hex[:8]}"
        
        # Convert config network mode to topology network mode
        # Handle both string and enum values due to Pydantic V2 use_enum_values=True
        config_mode = config.mode
        if isinstance(config_mode, str):
            topology_mode = NetworkMode.CENTRALIZED if config_mode == "centralized" else NetworkMode.DECENTRALIZED
        else:
            topology_mode = NetworkMode.CENTRALIZED if config_mode == ConfigNetworkMode.CENTRALIZED else NetworkMode.DECENTRALIZED
        
        # Create topology
        topology_config = self._create_topology_config()
        self.topology = create_topology(topology_mode, self.network_id, topology_config)
        
        # Network state
        self.is_running = False
        self.start_time: Optional[float] = None
        
        # Connection management
        self.connections: Dict[str, AgentConnection] = {}
        self.metadata: Dict[str, Any] = {}
        
        # Agent and mod tracking (for compatibility with system commands)
        self.agents: Dict[str, Dict[str, Any]] = {}  # agent_id -> metadata
        self.mods: Dict[str, Any] = {}
        self.mod_manifests: Dict[str, Any] = {}
        
        # Workspace tracking for direct response delivery
        self._registered_workspaces: Dict[str, Any] = {}  # agent_id -> workspace
        
        # Agent client tracking for direct message delivery
        self._registered_agent_clients: Dict[str, Any] = {}  # agent_id -> agent_client
        
        # Message queue for gRPC agents (workaround for bidirectional messaging limitation)
        self._agent_message_queues: Dict[str, List[Any]] = {}  # agent_id -> list of pending messages
        
        # Event handling (backward compatibility)
        self.message_handlers: Dict[str, List[Callable[[Event], Awaitable[None]]]] = {}
        self.agent_handlers: Dict[str, List[Callable[[AgentInfo], Awaitable[None]]]] = {}
        
        # Heartbeat and connection monitoring
        self.heartbeat_interval = config.heartbeat_interval if hasattr(config, 'heartbeat_interval') else 30  # seconds
        self.agent_timeout = config.agent_timeout if hasattr(config, 'agent_timeout') else 90  # seconds
        self.heartbeat_task: Optional[asyncio.Task] = None
        
        # Agent identity management
        self.identity_manager = AgentIdentityManager()
        
        # Ping response tracking
        self.pending_pings: Dict[str, asyncio.Event] = {}
        self.ping_responses: Dict[str, bool] = {}
        
        # Message processing tracking to prevent infinite loops
        self.processed_message_ids: Set[str] = set()
        
        # Unified event system
        self.event_bus = EventBus()
        self.event_bridge = EventBridge()
        
        # Message processing pipeline
        self.message_processor = MessageProcessor(self)
        
        # Register internal message handlers
        self._register_internal_handlers()
        
        # Set up event system integration
        self._setup_event_system()
    
    @property
    def events(self):
        """Get the events interface for this network.
        
        Returns:
            EventBus: The network's event bus for subscribing to events
            
        Example:
            # Subscribe to events at network level
            subscription = network.events.subscribe("agent1", ["project.*", "channel.message.*"])
            
            # Create event queue for polling
            queue = network.events.create_agent_event_queue("agent1")
        """
        return self.event_bus
    
    @staticmethod
    def load(config: Union[NetworkConfig, str, Path]) -> "AgentNetwork":
        """Load an AgentNetwork from a NetworkConfig object or YAML file path.
        
        Args:
            config: Either a NetworkConfig object, or a string/Path to a YAML config file
            
        Returns:
            AgentNetwork: Initialized network instance
            
        Raises:
            FileNotFoundError: If config file path doesn't exist
            ValueError: If config file is invalid or missing required fields
            
        Examples:
            # Load from NetworkConfig object
            network_config = NetworkConfig(name="MyNetwork", mode="centralized")
            network = AgentNetwork.load(network_config)
            
            # Load from YAML file path
            network = AgentNetwork.load("examples/centralized_network_config.yaml")
            network = AgentNetwork.load(Path("config/network.yaml"))
        """
        if isinstance(config, NetworkConfig) or (hasattr(config, '__class__') and config.__class__.__name__ == 'NetworkConfig'):
            # Direct NetworkConfig object
            return AgentNetwork(config)
        
        elif isinstance(config, (str, Path)):
            # Load from YAML file path
            config_path = Path(config)
            
            if not config_path.exists():
                raise FileNotFoundError(f"Network configuration file not found: {config_path}")
            
            try:
                with open(config_path, 'r') as f:
                    config_dict = yaml.safe_load(f)
                
                # Extract network configuration from YAML
                if 'network' not in config_dict:
                    raise ValueError(f"Configuration file {config_path} must contain a 'network' section")
                
                network_config = NetworkConfig(**config_dict['network'])
                logger.info(f"Loaded network configuration from {config_path}")
                
                # Create the network instance
                network = AgentNetwork(network_config)
                
                # Load metadata if specified in config
                if 'metadata' in config_dict:
                    network.metadata.update(config_dict['metadata'])
                    logger.debug(f"Loaded metadata: {config_dict['metadata']}")
                
                # Load network mods if specified in config
                if 'mods' in config_dict['network'] and config_dict['network']['mods']:
                    logger.info(f"Loading {len(config_dict['network']['mods'])} network mods...")
                    try:
                        from openagents.utils.mod_loaders import load_network_mods
                        mods = load_network_mods(config_dict['network']['mods'])
                        
                        for mod_name, mod_instance in mods.items():
                            mod_instance.bind_network(network)
                            network.mods[mod_name] = mod_instance
                            logger.info(f"Registered network mod: {mod_name}")
                            
                        logger.info(f"Successfully loaded {len(mods)} network mods")
                        
                        # Re-register event handlers for loaded mods
                        network._setup_event_system()
                        
                    except Exception as e:
                        logger.warning(f"Failed to load network mods: {e}")
                        # Continue without mods - this shouldn't be fatal
                
                return network
                
            except yaml.YAMLError as e:
                raise ValueError(f"Invalid YAML in configuration file {config_path}: {e}")
            except Exception as e:
                raise ValueError(f"Error loading network configuration from {config_path}: {e}")
        
        else:
            raise TypeError(f"config must be NetworkConfig, str, or Path, got {type(config)}")
    
    def _create_topology_config(self) -> Dict[str, Any]:
        """Create topology configuration from network config."""
        return {
            "transport": self.config.transport,
            "transport_config": self.config.transport_config,
            "host": self.config.host,
            "port": self.config.port,
            "server_mode": self.config.server_mode,
            "coordinator_url": self.config.coordinator_url,
            "bootstrap_nodes": self.config.bootstrap_nodes,
            "discovery_interval": self.config.discovery_interval,
            "max_connections": self.config.max_connections,
            "connection_timeout": self.config.connection_timeout,
            "retry_attempts": self.config.retry_attempts,
            "heartbeat_interval": self.config.heartbeat_interval,
            "encryption_enabled": self.config.encryption_enabled,
            "encryption_type": self.config.encryption_type
        }
    
    def _register_internal_handlers(self):
        """Register internal message handlers."""
        # Register transport message handler
        if hasattr(self.topology, 'transport_manager'):
            # Register handlers on ALL transports, not just the active one
            for transport in self.topology.transport_manager.transports.values():
                transport.register_message_handler(self._handle_transport_message)
                transport.register_system_message_handler(self._handle_system_message)
                # Register agent connection resolver for routing messages by agent_id
                if hasattr(transport, 'register_agent_connection_resolver'):
                    transport.register_agent_connection_resolver(self._resolve_agent_connection)
                
                # Set network instance reference for gRPC transport
                if hasattr(transport, 'set_network_instance'):
                    transport.set_network_instance(self)
        
        # Register network-level message handlers
        self.message_handlers["mod_message"] = [self._handle_mod_message]
    
    def _setup_event_system(self):
        """Set up the unified event system integration."""
        # Register global event handler for logging and metrics
        self.event_bus.register_global_handler(self._log_event)
        
        # Register mod event handlers for all loaded mods
        for mod_name, mod_instance in self.mods.items():
            if hasattr(mod_instance, 'process_event'):
                self.event_bus.register_mod_handler(mod_name, mod_instance.process_event)
            elif hasattr(mod_instance, 'process_system_message'):
                # Backward compatibility: wrap old process_system_message with event handler
                def create_mod_event_handler(mod_name, mod_instance):
                    async def mod_event_handler(event: Event):
                        if event.relevant_mod == mod_name:
                            # Convert event back to Event for backward compatibility
                            try:
                                mod_message = self.event_bridge.event_to_message(event)
                                if isinstance(mod_message, Event):
                                    await mod_instance.process_system_message(mod_message)
                            except Exception as e:
                                logger.error(f"Error processing event in mod {mod_name}: {e}")
                    return mod_event_handler
                
                handler = create_mod_event_handler(mod_name, mod_instance)
                self.event_bus.register_mod_handler(mod_name, handler)
        
        logger.info("Event system integration set up successfully")
    
    async def _log_event(self, event: Event):
        """Global event handler for logging."""
        logger.debug(f"Event: {event.event_name} from {event.source_id} to {event.target_agent_id or 'all'}")
    
    async def emit_event(self, event: Event) -> None:
        """
        Emit an event through the unified event system.
        
        Args:
            event: The event to emit
        """
        await self.event_bus.emit_event(event)
    
    async def initialize(self) -> bool:
        """Initialize the network.
            
        Returns:
            bool: True if initialization successful
        """
        try:
            # Initialize topology
            if not await self.topology.initialize():
                logger.error("Failed to initialize network topology")
                return False
        
            # Re-register message handlers after topology initialization
            self._register_internal_handlers()
            
            self.is_running = True
            self.start_time = time.time()
            
            # Start heartbeat monitoring
            self.heartbeat_task = asyncio.create_task(self._heartbeat_monitor())
            
            logger.info(f"Agent network '{self.network_name}' initialized successfully")
            return True
        except Exception as e:
            logger.error(f"Failed to initialize agent network: {e}")
            return False
        
    async def shutdown(self) -> bool:
        """Shutdown the network.
        
        Returns:
            bool: True if shutdown successful
        """
        try:
            self.is_running = False
            
            # Stop heartbeat monitoring
            if self.heartbeat_task:
                self.heartbeat_task.cancel()
                try:
                    await self.heartbeat_task
                except asyncio.CancelledError:
                    pass
            
            # Shutdown topology
            await self.topology.shutdown()
                
            # Clear handlers
            self.message_handlers.clear()
            self.agent_handlers.clear()
            
            logger.info(f"Agent network '{self.network_name}' shutdown successfully")
            return True
        except Exception as e:
            logger.error(f"Failed to shutdown agent network: {e}")
            return False
    
    async def register_agent(self, agent_id: str, metadata: Dict[str, Any]) -> bool:
        """Register an agent with the network.
        
        Args:
            agent_id: Unique identifier for the agent
            metadata: Agent metadata including capabilities
            
        Returns:
            bool: True if registration successful
        """
        try:
            # Store agent metadata for system commands
            self.agents[agent_id] = metadata
        
            # Create agent info
            agent_info = AgentInfo(
                agent_id=agent_id,
                metadata=metadata,
                capabilities=metadata.get("capabilities", []),
                last_seen=time.time(),
                transport_type=TransportType(self.config.transport),
                address=f"{self.config.host}:{self.config.port}"
            )
            
            # Register with topology
            success = await self.topology.register_agent(agent_info)
            
            if success:
                # Notify mods about agent registration
                for mod in self.mods.values():
                    try:
                        mod.handle_register_agent(agent_id, metadata)
                    except Exception as e:
                        logger.error(f"Error notifying mod {mod.mod_name} about agent registration: {e}")
                
                # Notify agent handlers
                await self._notify_agent_handlers(agent_info)
                logger.info(f"Registered agent {agent_id} with network")
            
            return success
        except Exception as e:
            logger.error(f"Failed to register agent {agent_id}: {e}")
            return False
    
    async def unregister_agent(self, agent_id: str) -> bool:
        """Unregister an agent from the network.
        
        Args:
            agent_id: ID of the agent to unregister
            
        Returns:
            bool: True if unregistration successful
        """
        try:
            success = await self.topology.unregister_agent(agent_id)
            
            if success:
                logger.info(f"Unregistered agent {agent_id} from network")
            
            return success
        except Exception as e:
            logger.error(f"Failed to unregister agent {agent_id}: {e}")
            return False
        
    async def send_message(self, message: Event) -> bool:
        """Send an event through the network using the structured message processing pipeline.
        
        Args:
            message: Event to send
            
        Returns:
            bool: True if event sent successfully
        """
        # TODO: Double check this function
        try:
            # Emit event through the unified event system for EventBus subscribers
            await self.emit_event(message)
            
            # Process through the ordered message processing pipeline
            return await self.message_processor.process_message(message)
            
        except Exception as e:
            logger.error(f"Failed to send message {message.event_id}: {e}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            return False
    
    
    async def discover_agents(self, capabilities: Optional[List[str]] = None) -> List[AgentInfo]:
        """Discover agents in the network.
        
        Args:
            capabilities: Optional list of required capabilities to filter by
            
        Returns:
            List[AgentInfo]: List of discovered agents
        """
        try:
            return await self.topology.discover_peers(capabilities)
        except Exception as e:
            logger.error(f"Failed to discover agents: {e}")
            return []
    
    def get_agents(self) -> Dict[str, AgentInfo]:
        """Get all agents in the network.
        
        Returns:
            Dict[str, AgentInfo]: Dictionary of agent ID to agent info
        """
        return self.topology.get_agents()
    
    def get_agent(self, agent_id: str) -> Optional[AgentInfo]:
        """Get information about a specific agent.
        
        Args:
            agent_id: ID of the agent
            
        Returns:
            Optional[AgentInfo]: Agent info if found, None otherwise
        """
        return self.topology.get_agent(agent_id)
    
    def register_message_handler(self, message_type: str, handler: Callable[[Event], Awaitable[None]]) -> None:
        """Register a message handler for a specific message type.
        
        Args:
            message_type: Type of message to handle
            handler: Handler function
        """
        if message_type not in self.message_handlers:
            self.message_handlers[message_type] = []
        self.message_handlers[message_type].append(handler)
    
    def register_agent_handler(self, handler: Callable[[AgentInfo], Awaitable[None]]) -> None:
        """Register a handler for agent registration events.
        
        Args:
            handler: Handler function for agent events
        """
        if "agent_registration" not in self.agent_handlers:
            self.agent_handlers["agent_registration"] = []
        self.agent_handlers["agent_registration"].append(handler)
    
    def get_network_stats(self) -> Dict[str, Any]:
        """Get network statistics.
        
        Returns:
            Dict[str, Any]: Network statistics
        """
        uptime = time.time() - self.start_time if self.start_time else 0
        agents = self.get_agents()
        
        return {
            "network_id": self.network_id,
            "network_name": self.network_name,
            "is_running": self.is_running,
            "uptime_seconds": uptime,
            "agent_count": len(agents),
            "agents": {agent_id: {
                "capabilities": info.capabilities,
                "last_seen": info.last_seen,
                "transport_type": info.transport_type,
                "address": info.address
            } for agent_id, info in agents.items()},
            "topology_mode": self.config.mode if isinstance(self.config.mode, str) else self.config.mode.value,
            "transport_type": self.config.transport,
            "host": self.config.host,
            "port": self.config.port
        }
    
    def _convert_to_transport_message(self, message: Event) -> Event:
        """Convert a base message to a transport message.
        
        Since we unified everything around Event, this method now simply returns 
        the message as-is (Event is the unified message format).
        
        Args:
            message: Base message to convert
            
        Returns:
            Message: Transport message (same Event object)
        """
        # With unified Event system, no conversion needed
        return message
    
    async def _handle_transport_message(self, message: Event, sender_id: str) -> None:
        """Handle incoming transport messages.
        
        Args:
            message: Transport message to handle
            sender_id: ID of the sender
        """
        try:
            message_id = getattr(message, 'message_id', None) or getattr(message, 'event_id', None)
            logger.info(f"🔧 NETWORK: _handle_transport_message called: id={message_id}, type={message.message_type}, sender={sender_id}")
            if hasattr(message, 'payload') and message.payload:
                logger.info(f"🔧 NETWORK: Message payload keys: {list(message.payload.keys())}")
                if 'mod' in message.payload:
                    logger.info(f"🔧 NETWORK: Message is for mod: {message.payload['mod']}")
            
            # Prevent infinite loops by tracking processed messages
            if message_id in self.processed_message_ids:
                logger.debug(f"Skipping already processed message {message_id}")
                return
            
            # Mark message as processed
            self.processed_message_ids.add(message_id)
            
            # Clean up old processed message IDs to prevent memory leak (keep last 1000)
            if len(self.processed_message_ids) > 1000:
                # Remove oldest half
                old_ids = list(self.processed_message_ids)[:500]
                for old_id in old_ids:
                    self.processed_message_ids.discard(old_id)
            
            # Emit the event directly (message is already an Event)
            await self.emit_event(message)
            
            # Check if this message needs to be routed to a specific target
            target = message.target_id or getattr(message, 'target_agent_id', None)
            sender_id = getattr(message, 'sender_id', None) or getattr(message, 'source_id', None)
            if target and target != sender_id:
                # Route to target agent (direct messages)
                logger.debug(f"Routing message {message_id} to target agent {target}")
                success = await self.topology.route_message(message)
                if not success:
                    logger.warning(f"Failed to route message {message_id} to {target}")
            else:
                # Handle broadcast messages or local messages
                # Determine message type with smart classification
                message_type = message.message_type
                if not message_type:
                    # Auto-classify based on message properties  
                    if message.target_agent_id:
                        message_type = "direct_message"
                    elif message.target_channel:
                        message_type = "channel_message"
                    elif message.relevant_mod and not message.target_agent_id and not message.target_channel:
                        if "broadcast" in message.event_name.lower():
                            message_type = "broadcast_message"
                        else:
                            message_type = "mod_message"
                    else:
                        message_type = "broadcast_message"
                        
                if message_type == "broadcast_message":
                    # Only route broadcast messages if they're not from the network itself
                    # This prevents infinite routing loops
                    if sender_id != self.network_id:
                        logger.debug(f"Routing broadcast message {message_id} to all agents")
                        success = await self.topology.route_message(message)
                        if not success:
                            logger.warning(f"Failed to route broadcast message {message_id}")
                    else:
                        logger.debug(f"Skipping re-routing of broadcast message {message_id} from network itself")
                elif message_type == "mod_message":
                    # Handle mod messages locally - do NOT route to other agents
                    logger.debug(f"Handling mod message {message_id} locally")
                    await self._handle_mod_message(message)
                elif message_type == "transport":
                    # Check if this transport message contains a mod message
                    payload = message.payload or {}
                    relevant_mod = payload.get('relevant_mod') if hasattr(payload, 'get') else getattr(payload, 'relevant_mod', None)
                    if relevant_mod:
                        logger.info(f"🔧 NETWORK: Transport message contains mod message for {relevant_mod}")
                        # Handle the event directly (message is already an Event)
                        if hasattr(message, 'relevant_mod'):
                            logger.info(f"🔧 NETWORK: Processing transport mod message directly")
                            await self._handle_mod_message(message)
                        else:
                            logger.warning(f"🔧 NETWORK: Failed to convert transport message to mod message")
                    else:
                        logger.debug(f"Transport message {message.message_id} has no relevant_mod, skipping direct processing")
                
                # Also notify local message handlers (for broadcast messages or local handling)
                if message_type in self.message_handlers:
                    logger.debug(f"Found {len(self.message_handlers[message_type])} handlers for {message_type}")
                    for handler in self.message_handlers[message_type]:
                        await handler(message)
                else:
                    logger.debug(f"No handlers found for message type {message_type}")
        except Exception as e:
            logger.error(f"Error handling transport message: {e}")
    
    
    async def _handle_mod_message(self, message: Event) -> None:
        """Handle mod messages by routing them to the appropriate network mods.
        
        Args:
            message: Transport message to route to network mods
        """
        try:
            logger.info(f"🔧 NETWORK: _handle_mod_message called with message: {message.message_id}, type: {message.message_type}")
            logger.info(f"🔧 NETWORK: Message attributes: content={hasattr(message, 'content')}, payload={hasattr(message, 'payload')}")
            
            # Extract the target mod name from the message
            target_mod_name = None
            if hasattr(message, 'relevant_mod') and message.relevant_mod:
                target_mod_name = message.relevant_mod
            elif hasattr(message, 'payload') and message.payload:
                # Fallback: check payload for backward compatibility
                if hasattr(message.payload, 'get'):
                    target_mod_name = message.payload.get('mod') or message.payload.get('relevant_mod')
                else:
                    target_mod_name = getattr(message.payload, 'mod', None) or getattr(message.payload, 'relevant_mod', None)
            
            if target_mod_name and target_mod_name in self.mods:
                network_mod = self.mods[target_mod_name]
                logger.debug(f"Routing mod message {message.message_id} to network mod {target_mod_name}")
                
                # Convert transport message back to Event
                from openagents.models.messages import Event, EventNames
                
                # Check if message already is a properly formatted Event (from transport conversion)
                if hasattr(message, 'content') and hasattr(message, 'relevant_mod'):
                    # This is already a converted Event from transport, use it directly
                    mod_message = message
                else:
                    # Extract content from payload (excluding mod-specific fields) 
                    content = {}
                    mod_specific_fields = {'mod', 'direction', 'relevant_agent_id'}  # Keep 'action' in content
                    payload_dict = message.payload if hasattr(message.payload, 'items') else {}
                    for key, value in payload_dict.items():
                        if key not in mod_specific_fields:
                            content[key] = value
                    
                    mod_message = Event(
                        source_id=message.sender_id,
                        relevant_mod=target_mod_name,
                        payload=content,
                        action=payload_dict.get('action'),
                        direction=payload_dict.get('direction'),
                        relevant_agent_id=payload_dict.get('relevant_agent_id'),
                        timestamp=message.timestamp,
                        metadata=message.metadata
                    )
                
                # Call mod's process_system_message directly instead of using event system
                logger.info(f"🔧 NETWORK: Handling Event {mod_message.message_id} locally, mod={target_mod_name}")
                logger.info(f"🔧 NETWORK: Event sender={mod_message.source_id}, relevant_agent={mod_message.relevant_agent_id}")
                
                # Call the mod's process_system_message method directly
                await network_mod.process_system_message(mod_message)
            else:
                logger.warning(f"No network mod found for {target_mod_name}, available mods: {list(self.mods.keys())}")
                    
        except Exception as e:
            logger.error(f"Error handling mod message: {e}")
            import traceback
            traceback.print_exc()
    
    async def _handle_system_message(self, peer_id: str, message: Dict[str, Any], connection: Any) -> None:
        """Handle incoming system messages.
        
        Args:
            peer_id: ID of the peer sending the message
            message: System message data
            connection: WebSocket connection
        """
        try:
            from openagents.core.system_commands import (
                handle_register_agent, handle_list_agents, handle_list_mods,
                handle_ping_agent, handle_claim_agent_id, handle_validate_certificate,
                handle_get_network_info, handle_poll_messages,
                REGISTER_AGENT, LIST_AGENTS, LIST_MODS, PING_AGENT, 
                CLAIM_AGENT_ID, VALIDATE_CERTIFICATE, GET_NETWORK_INFO, POLL_MESSAGES
            )
            
            command = message.get("command")
            message_type = message.get("type")
            
            # Handle system responses
            if message_type == "system_response":
                if command == PING_AGENT:
                    # Handle ping response
                    agent_id = message.get("agent_id")
                    success = message.get("success", False)
                    
                    if agent_id and agent_id in self.pending_pings:
                        self.ping_responses[agent_id] = success
                        self.pending_pings[agent_id].set()
                        logger.debug(f"Received ping response from {agent_id}: {success}")
                return
            
            # Handle system requests
            if command == REGISTER_AGENT:
                # Store peer_id context for registration
                self._current_registration_peer_id = peer_id
                await handle_register_agent(command, message.get("data", {}), connection, self)
                self._current_registration_peer_id = None
            elif command == LIST_AGENTS:
                await handle_list_agents(command, message.get("data", {}), connection, self)
            elif command == LIST_MODS:
                await handle_list_mods(command, message.get("data", {}), connection, self)
            elif command == GET_NETWORK_INFO:
                await handle_get_network_info(command, message.get("data", {}), connection, self)
            elif command == PING_AGENT:
                await handle_ping_agent(command, message.get("data", {}), connection, self)
            elif command == CLAIM_AGENT_ID:
                await handle_claim_agent_id(command, message.get("data", {}), connection, self)
            elif command == VALIDATE_CERTIFICATE:
                await handle_validate_certificate(command, message.get("data", {}), connection, self)
            elif command == POLL_MESSAGES:
                await handle_poll_messages(command, message.get("data", {}), connection, self)
            else:
                logger.warning(f"Unhandled system command: {command}")
        except Exception as e:
            logger.error(f"Error handling system message: {e}")
    
    def _resolve_agent_connection(self, agent_id: str) -> Any:
        """Resolve agent_id to connection.
        
        Args:
            agent_id: ID of the agent to find connection for
            
        Returns:
            Connection or None if not found
        """
        if agent_id in self.connections:
            connection = self.connections[agent_id].connection
            return connection
        return None
    
    async def _notify_agent_handlers(self, agent_info: AgentInfo) -> None:
        """Notify agent handlers of agent registration.
        
        Args:
            agent_info: Information about the registered agent
        """
        try:
            if "agent_registration" in self.agent_handlers:
                for handler in self.agent_handlers["agent_registration"]:
                    await handler(agent_info)
        except Exception as e:
            logger.error(f"Error notifying agent handlers: {e}")
    
    async def _heartbeat_monitor(self) -> None:
        """Monitor agent connections and clean up stale ones."""
        logger.info(f"Starting heartbeat monitor (interval: {self.heartbeat_interval}s, timeout: {self.agent_timeout}s)")
        
        while self.is_running:
            try:
                current_time = asyncio.get_event_loop().time()
                stale_agents = []
                
                # Check all connected agents for activity
                for agent_id, connection in self.connections.items():
                    time_since_activity = current_time - connection.last_activity
                    
                    if time_since_activity > self.agent_timeout:
                        # Try to ping the agent
                        if not await self._ping_agent(agent_id, connection):
                            stale_agents.append(agent_id)
                            logger.warning(f"Agent {agent_id} failed ping check (inactive for {time_since_activity:.1f}s)")
                        else:
                            # Agent responded, update activity time
                            connection.last_activity = current_time
                            logger.debug(f"Agent {agent_id} responded to ping")
                
                # Clean up stale agents
                for agent_id in stale_agents:
                    logger.info(f"Cleaning up stale agent {agent_id}")
                    await self.cleanup_agent(agent_id)
                
                # Wait for next heartbeat interval
                await asyncio.sleep(self.heartbeat_interval)
                
            except asyncio.CancelledError:
                logger.info("Heartbeat monitor cancelled")
                break
            except Exception as e:
                logger.error(f"Error in heartbeat monitor: {e}")
                await asyncio.sleep(self.heartbeat_interval)
    
    async def _ping_agent(self, agent_id: str, connection: 'AgentConnection') -> bool:
        """Ping an agent to check if it's still alive.
        
        Args:
            agent_id: ID of the agent to ping
            connection: Agent connection object
            
        Returns:
            bool: True if agent responded, False otherwise
        """
        try:
            # Create event to wait for response
            ping_event = asyncio.Event()
            self.pending_pings[agent_id] = ping_event
            self.ping_responses[agent_id] = False
            
            # Send ping command
            ping_message = {
                "type": "system_request",
                "command": "ping_agent",
                "timestamp": time.time(),
                "agent_id": agent_id  # Add agent_id for tracking
            }
            
            await connection.connection.send(json.dumps(ping_message))
            
            # Wait for pong response (with timeout)
            try:
                await asyncio.wait_for(ping_event.wait(), timeout=5.0)
                response = self.ping_responses.get(agent_id, False)
                logger.debug(f"Agent {agent_id} ping response: {response}")
                return response
                    
            except asyncio.TimeoutError:
                logger.debug(f"Ping timeout for agent {agent_id}")
                return False
                
        except Exception as e:
            logger.debug(f"Error pinging agent {agent_id}: {e}")
            return False
        finally:
            # Clean up tracking
            self.pending_pings.pop(agent_id, None)
            self.ping_responses.pop(agent_id, None)
        
        return False
    
    async def cleanup_agent(self, agent_id: str) -> bool:
        """Clean up an agent's registration and connections.
        
        Args:
            agent_id: ID of the agent to clean up
            
        Returns:
            bool: True if cleanup successful
        """
        try:
            # Remove from connections
            if agent_id in self.connections:
                connection = self.connections[agent_id]
                try:
                    # Try to close the WebSocket connection gracefully
                    await connection.connection.close()
                except:
                    pass  # Connection might already be closed
                del self.connections[agent_id]
                logger.debug(f"Removed connection for agent {agent_id}")
            
            # Remove from agents registry
            if agent_id in self.agents:
                del self.agents[agent_id]
                logger.debug(f"Removed registration for agent {agent_id}")
            
            # Unregister from topology
            await self.unregister_agent(agent_id)
            
            logger.info(f"Successfully cleaned up agent {agent_id}")
            return True
            
        except Exception as e:
            logger.error(f"Error cleaning up agent {agent_id}: {e}")
            return False

    def workspace(self, client_id: Optional[str] = None) -> 'Workspace':
        """Create a workspace instance for this network.
        
        This method creates a workspace that provides access to channels and collaboration
        features through the thread messaging mod. The workspace requires the
        openagents.mods.workspace.default mod to be enabled in the network.
        
        Args:
            client_id: Optional client ID for the workspace connection.
                      If not provided, a random ID will be generated.
                      
        Returns:
            Workspace: A workspace instance for channel communication
            
        Raises:
            RuntimeError: If the workspace.default mod is not enabled in the network
        """
        # Check if workspace.default mod is enabled
        if WORKSPACE_DEFAULT_MOD_NAME not in self.mods:
            available_mods = list(self.mods.keys())
            raise RuntimeError(
                f"Workspace functionality requires the '{WORKSPACE_DEFAULT_MOD_NAME}' mod to be enabled in the network. "
                f"Available mods: {available_mods}. "
                f"Please add '{WORKSPACE_DEFAULT_MOD_NAME}' to your network configuration."
            )
        
        # Import here to avoid circular imports
        from openagents.core.client import AgentClient
        from openagents.core.workspace import Workspace
        
        # Create a client for the workspace
        if client_id is None:
            import uuid
            client_id = f"workspace-client-{uuid.uuid4().hex[:8]}"
        
        client = AgentClient(client_id)
        
        # Create workspace with network reference
        workspace = Workspace(client, network=self)
        
        # Automatically connect the workspace client to the network
        try:
            # Use the same host and port as the network
            host = self.config.host if self.config.host != "0.0.0.0" else "localhost"
            port = self.config.port
            
            logger.info(f"Auto-connecting workspace client {client_id} to {host}:{port}")
            
            # Connect asynchronously - this needs to be awaited by the caller
            # We'll create a method that handles the connection
            workspace._auto_connect_config = {
                'host': host,
                'port': port
            }
            
        except Exception as e:
            logger.warning(f"Could not prepare auto-connection for workspace client: {e}")
        
        logger.info(f"Created workspace with client ID: {client_id}")
        return workspace
    
    def _register_workspace(self, agent_id: str, workspace) -> None:
        """Register a workspace for direct response delivery.
        
        Args:
            agent_id: ID of the workspace client
            workspace: Workspace instance
        """
        self._registered_workspaces[agent_id] = workspace
        logger.info(f"Registered workspace for agent {agent_id}")
    
    def _queue_message_for_agent(self, agent_id: str, message: Any) -> None:
        """Queue a message for a gRPC agent to be retrieved via polling.
        
        Args:
            agent_id: ID of the target agent
            message: Message to queue
        """
        if agent_id not in self._agent_message_queues:
            self._agent_message_queues[agent_id] = []
        
        self._agent_message_queues[agent_id].append(message)
        
        # Also notify HTTP adapter if it exists (for pending HTTP requests)
        if hasattr(self.topology, 'transport_manager'):
            transport_manager = self.topology.transport_manager
            transport = transport_manager.get_active_transport()
            if transport and hasattr(transport, 'http_adapter') and transport.http_adapter:
                # Convert message to dict format for HTTP adapter
                message_dict = message.to_dict() if hasattr(message, 'to_dict') else message.model_dump() if hasattr(message, 'model_dump') else {}
                transport.http_adapter.queue_message_for_agent(agent_id, message_dict)
        logger.info(f"🔧 NETWORK: Queued message for gRPC agent {agent_id}. Queue size: {len(self._agent_message_queues[agent_id])}")
    
    def _get_queued_messages(self, agent_id: str) -> List[Any]:
        """Get and clear all queued messages for an agent.
        
        Args:
            agent_id: ID of the agent
            
        Returns:
            List of queued messages
        """
        messages = self._agent_message_queues.get(agent_id, [])
        if messages:
            self._agent_message_queues[agent_id] = []
            logger.info(f"🔧 NETWORK: Retrieved {len(messages)} queued messages for agent {agent_id}")
        return messages
    
    def _register_agent_client(self, agent_id: str, agent_client) -> None:
        """Register an agent client for direct message delivery.
        
        Args:
            agent_id: ID of the agent
            agent_client: AgentClient instance
        """
        self._registered_agent_clients[agent_id] = agent_client
        logger.info(f"Registered agent client for agent {agent_id}")


def create_network(config: Union[NetworkConfig, str, Path]) -> AgentNetwork:
    """Create an agent network from configuration.
    
    Args:
        config: Network configuration (NetworkConfig object, file path string, or Path object)
        
    Returns:
        AgentNetwork: Configured network instance
        
    Examples:
        # From NetworkConfig object
        network = create_network(NetworkConfig(name="MyNetwork"))
        
        # From YAML file path
        network = create_network("examples/centralized_network_config.yaml")
        network = create_network(Path("config/network.yaml"))
    """
    return AgentNetwork.load(config)


# Backward compatibility aliases
AgentNetworkServer = AgentNetwork
EnhancedAgentNetwork = AgentNetwork  # For transition period
create_enhanced_network = create_network  # For transition period