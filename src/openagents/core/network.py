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

from openagents.core.transport import Transport, TransportManager, Message
from openagents.models.transport import TransportType
from openagents.core.topology import NetworkTopology, NetworkMode, AgentInfo, create_topology
from openagents.models.messages import DirectMessage, BroadcastMessage, ModMessage
from openagents.models.network_config import NetworkConfig, NetworkMode as ConfigNetworkMode
from openagents.core.agent_identity import AgentIdentityManager
from openagents.core.events import EventBus
from openagents.models.event import Event, EventNames, EventVisibility
from openagents.core.events.event_bridge import EventBridge
from openagents.config.globals import WORKSPACE_DEFAULT_MOD_NAME

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
        
        # Message handling
        self.message_handlers: Dict[str, List[Callable[[Message], Awaitable[None]]]] = {}
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
        self.message_handlers["project_notification"] = [self._handle_project_notification]
    
    def _setup_event_system(self):
        """Set up the unified event system integration."""
        # Register global event handler for logging and metrics
        self.event_bus.register_global_handler(self._log_event)
        
        # Register mod event handlers for all loaded mods
        for mod_name, mod_instance in self.mods.items():
            if hasattr(mod_instance, 'process_event'):
                self.event_bus.register_mod_handler(mod_name, mod_instance.process_event)
            elif hasattr(mod_instance, 'process_mod_message'):
                # Backward compatibility: wrap old process_mod_message with event handler
                def create_mod_event_handler(mod_name, mod_instance):
                    async def mod_event_handler(event: Event):
                        if event.relevant_mod == mod_name:
                            # Convert event back to ModMessage for backward compatibility
                            try:
                                mod_message = self.event_bridge.event_to_message(event)
                                if isinstance(mod_message, ModMessage):
                                    await mod_instance.process_mod_message(mod_message)
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
    
    async def emit_event_from_message(self, message: Event) -> None:
        """
        Convert a message to an event and emit it.
        
        This provides backward compatibility during the migration period.
        
        Args:
            message: The message to convert and emit as an event
        """
        try:
            event = self.event_bridge.message_to_event(message)
            await self.emit_event(event)
        except Exception as e:
            logger.error(f"Error converting message to event: {e}")
            raise
    
    async def _emit_transport_message_as_event(self, message: Message) -> None:
        """
        Convert a transport message to an event and emit it.
        
        Args:
            message: Transport message to convert and emit
        """
        try:
            logger.info(f"🔧 NETWORK: _emit_transport_message_as_event called for sender: {message.sender_id}")
            logger.info(f"🔧 NETWORK: About to call _transport_message_to_base_message")
            # Convert transport message to Event directly
            event = self._transport_message_to_base_message(message)
            if event:
                logger.info(f"🔧 NETWORK: Emitting event of type {type(event).__name__} from transport message")
                await self.emit_event(event)
                logger.info(f"🔧 NETWORK: Successfully emitted event {event.event_id}")
            else:
                logger.warning(f"🔧 NETWORK: Failed to convert transport message to event")
        except Exception as e:
            logger.error(f"🔧 NETWORK: Could not convert transport message to event: {e}")
            logger.error(f"🔧 NETWORK: Error type: {type(e).__name__}")
            logger.error(f"🔧 NETWORK: Message type was: {message.message_type}")
            logger.error(f"🔧 NETWORK: Message payload type was: {type(message.payload)}")
            import traceback
            logger.error(f"🔧 NETWORK: Traceback: {traceback.format_exc()}")
            # This is not critical, so we don't raise the exception
    
    def _safe_get(self, obj, key, default=None):
        """Safely get a value from an object that might be dict or protobuf."""
        if obj is None:
            return default
        if hasattr(obj, 'get'):
            return obj.get(key, default)
        else:
            return getattr(obj, key, default)
    
    def _protobuf_to_dict(self, obj):
        """Convert a protobuf object to a dictionary recursively."""
        if obj is None:
            return {}
        
        # If it's already a dict, return as-is
        if hasattr(obj, 'get'):
            return obj
        
        # Handle protobuf struct_value with fields
        if hasattr(obj, 'fields'):
            result = {}
            try:
                for key, value in obj.fields.items():
                    # Check for struct_value first (nested objects)
                    if hasattr(value, 'struct_value') and value.struct_value:
                        # Recursively convert nested struct_value
                        result[key] = self._protobuf_to_dict(value.struct_value)
                    elif hasattr(value, 'string_value'):
                        result[key] = value.string_value  # Allow empty strings
                    elif hasattr(value, 'number_value'):
                        result[key] = value.number_value
                    elif hasattr(value, 'bool_value'):
                        result[key] = value.bool_value
                    elif hasattr(value, 'null_value'):
                        result[key] = None
                    else:
                        # Fallback for unknown types
                        result[key] = str(value)
                        logger.debug(f"🔧 NETWORK: Unknown protobuf value type for key '{key}': {type(value)} = {value}")
                return result
            except Exception as e:
                logger.warning(f"🔧 NETWORK: Error converting protobuf fields to dict: {e}")
                return {}
        
        # If it's a simple value, try to extract common fields
        try:
            result = {}
            for field in ['text', 'message_type', 'sender_id', 'channel', 'timestamp', 'event_id', 'payload', 'content']:
                if hasattr(obj, field):
                    value = getattr(obj, field)
                    if hasattr(value, 'fields'):
                        result[field] = self._protobuf_to_dict(value)
                    else:
                        result[field] = value
            return result if result else {}
        except Exception as e:
            logger.warning(f"🔧 NETWORK: Error extracting protobuf fields: {e}")
            return {}

    def _transport_message_to_base_message(self, message: Message) -> Optional[Event]:
        """
        Convert a transport Message to an Event.
        
        Args:
            message: Transport message to convert
            
        Returns:
            Optional[Event]: Converted event or None if conversion fails
        """
        try:
            logger.info(f"🔧 NETWORK: _transport_message_to_base_message called for message type: {message.message_type}")
            logger.info(f"🔧 NETWORK: Message payload type: {type(message.payload)}")
            logger.info(f"🔧 NETWORK: Message payload has 'get' method: {hasattr(message.payload, 'get') if message.payload else False}")
            if message.message_type == "direct_message":
                return DirectMessage(
                    source_id=message.sender_id,
                    target_agent_id=message.target_id,
                    payload=message.payload or {},
                    metadata=message.metadata or {}
                )
            elif message.message_type == "broadcast_message":
                return BroadcastMessage(
                    source_id=message.sender_id,
                    payload=message.payload or {},
                    metadata=message.metadata or {}
                )
            elif message.message_type == "mod_message":
                payload = message.payload or {}
                return ModMessage(
                    source_id=message.sender_id,
                    relevant_mod=payload.get('mod', '') if hasattr(payload, 'get') else getattr(payload, 'mod', ''),
                    relevant_agent_id=payload.get('relevant_agent_id', message.sender_id) if hasattr(payload, 'get') else getattr(payload, 'relevant_agent_id', message.sender_id),
                    direction=payload.get('direction', 'inbound') if hasattr(payload, 'get') else getattr(payload, 'direction', 'inbound'),
                    payload=payload,
                    metadata=message.metadata or {}
                )
            elif message.message_type == "transport":
                # Check if transport message is actually a mod message by looking for relevant_mod
                raw_payload = message.payload or {}
                
                # Convert payload to dictionary format for consistent access
                payload = {}
                if hasattr(raw_payload, 'get'):
                    # Already a dictionary
                    payload = raw_payload
                else:
                    # Convert protobuf-like object to dictionary
                    try:
                        # Try to extract common fields from protobuf object
                        for field in ['relevant_mod', 'target_channel', 'target_agent_id', 'payload', 'mod', 'direction', 'source_id']:
                            if hasattr(raw_payload, field):
                                payload[field] = getattr(raw_payload, field)
                        logger.info(f"🔧 NETWORK: Converted protobuf payload to dict: {list(payload.keys())}")
                    except Exception as e:
                        logger.warning(f"🔧 NETWORK: Could not convert payload to dict: {e}")
                        payload = {}
                
                logger.debug(f"🔧 NETWORK: Transport message payload keys: {list(payload.keys()) if hasattr(payload, 'keys') else 'N/A'}")
                relevant_mod = self._safe_get(payload, 'relevant_mod')
                logger.debug(f"🔧 NETWORK: relevant_mod value: {relevant_mod}")
                
                if relevant_mod:
                    # This is a mod message wrapped as a transport message
                    logger.info(f"🔧 NETWORK: Converting transport message to ModMessage for mod: {relevant_mod}")
                    
                    # Extract the actual mod message content from nested payload
                    raw_mod_content = self._safe_get(payload, 'payload', {})
                    logger.info(f"🔧 NETWORK: Raw mod content: {raw_mod_content}")
                    
                    # Convert protobuf nested payload to dictionary
                    mod_content = self._protobuf_to_dict(raw_mod_content)
                    logger.info(f"🔧 NETWORK: Converted mod content: {mod_content}")
                    logger.debug(f"🔧 NETWORK: Mod message content keys: {list(mod_content.keys()) if mod_content else 'None'}")
                    
                    # Extract text from nested payload structure 
                    message_text = ""
                    logger.info(f"🔧 NETWORK: mod_content type: {type(mod_content)}")
                    
                    if isinstance(mod_content, dict):
                        logger.info(f"🔧 NETWORK: mod_content keys: {list(mod_content.keys())}")
                        
                        # Try direct text field
                        if 'text' in mod_content and mod_content['text']:
                            message_text = mod_content['text']
                            logger.info(f"🔧 NETWORK: Extracted text from 'text' field: '{message_text[:100]}...'")
                        
                        # Try nested payload -> text
                        elif 'payload' in mod_content and isinstance(mod_content['payload'], dict) and 'text' in mod_content['payload']:
                            message_text = mod_content['payload']['text']
                            logger.info(f"🔧 NETWORK: Extracted text from payload->text: '{message_text[:100]}...'")
                            
                        # Try nested content -> text    
                        elif 'content' in mod_content and isinstance(mod_content['content'], dict) and 'text' in mod_content['content']:
                            message_text = mod_content['content']['text']
                            logger.info(f"🔧 NETWORK: Extracted text from content->text: '{message_text[:100]}...'")
                            
                        # Log nested structure for debugging
                        if 'payload' in mod_content:
                            logger.info(f"🔧 NETWORK: payload structure: {type(mod_content['payload'])} - {mod_content['payload']}")
                        if 'content' in mod_content:
                            logger.info(f"🔧 NETWORK: content structure: {type(mod_content['content'])} - {mod_content['content']}")
                    
                    if not message_text:
                        # Fallback: try to extract from the original raw content
                        message_text = str(raw_mod_content)[:200] if raw_mod_content else ""
                        logger.info(f"🔧 NETWORK: Using fallback text extraction: '{message_text[:100]}...'")
                        logger.warning(f"🔧 NETWORK: No text extracted from structured data!")
                    
                    # Create properly structured content for ChannelMessage constructor  
                    # Try both 'channel' and 'target_channel' fields for channel name
                    channel_name = (self._safe_get(payload, 'channel') or 
                                  self._safe_get(payload, 'target_channel') or 
                                  self._safe_get(mod_content, 'channel') or 
                                  'general')
                    
                    content = {
                        "message_type": "channel_message",
                        "sender_id": message.sender_id,
                        "channel": channel_name,
                        "payload": {"text": message_text},  # Event expects text in payload
                        "text_representation": message_text,  # For compatibility
                        "target_channel": channel_name,
                        "event_name": "thread.channel_message.posted",
                        "source_id": message.sender_id,
                        "visibility": "channel"
                    }
                        
                    logger.info(f"🔧 NETWORK: Final content for mod: {content}")
                    
                    try:
                        return ModMessage(
                            source_id=message.sender_id,
                            relevant_mod=relevant_mod,
                            relevant_agent_id=self._safe_get(payload, 'target_agent_id', message.sender_id),
                            direction='inbound',
                            content=content,  # Thread messaging mod expects 'content' field
                            metadata=message.metadata or {}
                        )
                    except Exception as mod_error:
                        logger.error(f"🔧 NETWORK: Error creating ModMessage: {mod_error}")
                        logger.error(f"🔧 NETWORK: Message sender_id: {message.sender_id}")
                        logger.error(f"🔧 NETWORK: Payload relevant_mod: {relevant_mod}")
                        logger.error(f"🔧 NETWORK: Payload target_agent_id: {self._safe_get(payload, 'target_agent_id')}")
                        logger.error(f"🔧 NETWORK: Mod content type: {type(mod_content)}")
                        logger.error(f"🔧 NETWORK: Message metadata type: {type(message.metadata)}")
                        raise mod_error
                else:
                    # Transport messages are typically capability announcements or system messages
                    # Convert them to broadcast messages so they can be processed by mods
                    logger.debug(f"🔧 NETWORK: Converting transport message to BroadcastMessage")
                    return BroadcastMessage(
                        source_id=message.sender_id,
                        payload=payload,
                        metadata=message.metadata or {}
                    )
            else:
                logger.debug(f"Unknown message type for conversion: {message.message_type}")
                return None
        except Exception as e:
            logger.error(f"Error converting transport message to base message: {e}")
            return None
    
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
        """Send an event through the network.
        
        Args:
            message: Event to send (now extends Event)
            
        Returns:
            bool: True if event sent successfully
        """
        try:
            # Emit event through the unified event system
            await self.emit_event(message)
            
            # For backward compatibility, still handle some direct routing
            # This will be removed once all components use events
            if isinstance(message, ModMessage):
                logger.info(f"🔧 NETWORK: Handling ModMessage {message.event_id} locally, mod={message.mod}")
                logger.info(f"🔧 NETWORK: ModMessage sender={message.source_id}, relevant_agent={message.relevant_agent_id}")
                
                # Check if this is a mod message response that needs to be delivered to an agent
                if hasattr(message, 'relevant_agent_id') and message.relevant_agent_id:
                    target_agent_id = message.relevant_agent_id
                    logger.info(f"🔧 NETWORK: Delivering ModMessage response to agent {target_agent_id}")
                    
                    # First try to deliver directly to registered workspaces
                    if target_agent_id in self._registered_workspaces:
                        logger.info(f"🔧 NETWORK: Found registered workspace {target_agent_id}, delivering response directly")
                        workspace = self._registered_workspaces[target_agent_id]
                        await workspace._handle_project_responses(message)
                        logger.info(f"🔧 NETWORK: Successfully delivered response to workspace {target_agent_id}")
                        return True
                    
                    # Try to deliver directly to registered agent clients
                    elif target_agent_id in self._registered_agent_clients:
                        logger.info(f"🔧 NETWORK: Found registered agent client {target_agent_id}, delivering ModMessage directly")
                        agent_client = self._registered_agent_clients[target_agent_id]
                        await agent_client._handle_mod_message(message)
                        logger.info(f"🔧 NETWORK: Successfully delivered ModMessage to agent client {target_agent_id}")
                        return True
                    
                    # Fallback: try to deliver to connected agents through transport
                    elif target_agent_id in self.agents:
                        logger.info(f"🔧 NETWORK: Found connected agent {target_agent_id}, delivering ModMessage through transport")
                        logger.info(f"🔧 NETWORK: All registered agents: {list(self.agents.keys())}")
                        
                        # Check if this is a gRPC agent - if so, queue the message instead of routing
                        # because gRPC transport doesn't support direct agent-to-agent delivery
                        is_grpc_transport = False
                        if hasattr(self.topology, 'transport_manager') and self.topology.transport_manager:
                            for transport in self.topology.transport_manager.transports.values():
                                if hasattr(transport, 'transport_type') and transport.transport_type.value == 'grpc':
                                    is_grpc_transport = True
                                    break
                        
                        if is_grpc_transport:
                            logger.info(f"🔧 NETWORK: Detected gRPC transport, queuing ModMessage for agent {target_agent_id}")
                            self._queue_message_for_agent(target_agent_id, message)
                            return True
                        
                        # For non-gRPC transports, try normal routing
                        # Convert ModMessage to transport Message and route it
                        transport_message = self._convert_to_transport_message(message)
                        transport_message.target_id = target_agent_id
                        logger.info(f"🔧 NETWORK: Transport message: type={transport_message.message_type}, target={transport_message.target_id}")
                        logger.info(f"🔧 NETWORK: Transport payload keys: {list(transport_message.payload.keys()) if transport_message.payload else 'None'}")
                        logger.info(f"🔧 NETWORK: Attempting to route message through topology...")
                        success = await self.topology.route_message(transport_message)
                        logger.info(f"🔧 NETWORK: Topology route_message returned: {success}")
                        if success:
                            logger.info(f"🔧 NETWORK: Successfully delivered ModMessage to {target_agent_id}")
                            return True
                        else:
                            logger.error(f"🔧 NETWORK: Failed to route ModMessage to {target_agent_id}")
                            logger.info(f"🔧 NETWORK: Falling back to message queue for gRPC agent")
                            # Fallback: Queue the message for gRPC agents
                            self._queue_message_for_agent(target_agent_id, message)
                            return True
                    else:
                        logger.warning(f"🔧 NETWORK: Agent {target_agent_id} not found in registered agents: {list(self.agents.keys())}")
                    
                    # Fallback: Deliver ModMessage through the active transport (gRPC HTTP adapter)
                    logger.info(f"🔧 NETWORK: Attempting HTTP adapter fallback for {target_agent_id}")
                    logger.info(f"🔧 NETWORK: Has topology: {hasattr(self, 'topology')}")
                    logger.info(f"🔧 NETWORK: Has transport_manager: {hasattr(self.topology, 'transport_manager') if hasattr(self, 'topology') else 'No topology'}")
                    if hasattr(self.topology, 'transport_manager'):
                        transport_manager = self.topology.transport_manager
                        logger.info(f"🔧 NETWORK: Got transport_manager: {transport_manager}")
                        transport = transport_manager.get_active_transport()
                        logger.info(f"🔧 NETWORK: Got active transport: {transport}")
                        logger.info(f"🔧 NETWORK: Transport has http_adapter: {hasattr(transport, 'http_adapter') if transport else 'No transport'}")
                        logger.info(f"🔧 NETWORK: HTTP adapter exists: {transport.http_adapter if transport and hasattr(transport, 'http_adapter') else 'None'}")
                        if transport and hasattr(transport, 'http_adapter') and transport.http_adapter:
                            logger.info(f"🔧 NETWORK: Entering HTTP adapter fallback block")
                            try:
                                # Queue the message for HTTP polling
                                logger.info(f"🔧 NETWORK: Extracting command from ModMessage")
                                command = self._extract_command_from_mod_message(message)
                                logger.info(f"🔧 NETWORK: Extracted command: {command}")
                                
                                response_message = {
                                    'message_type': 'system_response',
                                    'command': command,
                                    'data': message.content,
                                    'timestamp': message.timestamp
                                }
                                
                                logger.info(f"🔧 NETWORK: Queuing mod response for HTTP polling: command={command}")
                                logger.info(f"🔧 NETWORK: Response data keys: {list(message.content.keys()) if hasattr(message.content, 'keys') else 'Not a dict'}")
                                
                                if target_agent_id not in transport.http_adapter.message_queues:
                                    transport.http_adapter.message_queues[target_agent_id] = []
                                transport.http_adapter.message_queues[target_agent_id].append(response_message)
                                
                                logger.info(f"🔧 NETWORK: Successfully queued mod response for HTTP agent {target_agent_id}")
                                logger.info(f"🔧 NETWORK: Queue size for {target_agent_id}: {len(transport.http_adapter.message_queues[target_agent_id])}")
                                
                                # Also notify the HTTP adapter's response handler
                                if hasattr(transport.http_adapter, '_handle_mod_response'):
                                    logger.info(f"🔧 NETWORK: Calling HTTP adapter _handle_mod_response")
                                    transport.http_adapter._handle_mod_response(message.content)
                                
                                return True
                            except Exception as e:
                                logger.error(f"🔧 NETWORK: Error in HTTP adapter fallback: {e}")
                                import traceback
                                logger.error(f"🔧 NETWORK: Traceback: {traceback.format_exc()}")
                                return False
                
                # Handle ModMessage locally by the network's mod system
                transport_message = self._convert_to_transport_message(message)
                await self._handle_mod_message(transport_message)
                return True
            
            # Handle DirectMessage for gRPC agents (queue for HTTP polling)
            if isinstance(message, DirectMessage):
                target_agent_id = message.target_agent_id
                
                # Check if target agent is using gRPC HTTP polling
                if hasattr(self.topology, 'transport_manager'):
                    transport_manager = self.topology.transport_manager
                    transport = transport_manager.get_active_transport()
                    if transport and hasattr(transport, 'http_adapter') and transport.http_adapter:
                        # Queue DirectMessage for HTTP polling
                        response_message = {
                            'message_type': 'direct_message',
                            'data': {
                                'message_id': message.message_id,  # Use backward compatibility property
                                'sender_id': message.sender_id,   # Use backward compatibility property
                                'target_agent_id': message.target_agent_id,
                                'content': message.content,       # Use backward compatibility property
                                'timestamp': message.timestamp,
                                'metadata': message.metadata,
                                'requires_response': message.requires_response
                            },
                            'timestamp': message.timestamp
                        }
                        
                        logger.debug(f"Queuing DirectMessage for HTTP polling to agent {target_agent_id}")
                        
                        if target_agent_id not in transport.http_adapter.message_queues:
                            transport.http_adapter.message_queues[target_agent_id] = []
                        transport.http_adapter.message_queues[target_agent_id].append(response_message)
                        
                        logger.debug(f"Queued DirectMessage for HTTP agent {target_agent_id}")
                        return True
            
            # Convert to transport message for other message types
            transport_message = self._convert_to_transport_message(message)
            
            # Route through topology
            return await self.topology.route_message(transport_message)
        except Exception as e:
            logger.error(f"Failed to send message: {e}")
            return False
    
    def _extract_command_from_mod_message(self, message: ModMessage) -> str:
        """Extract the appropriate command name from a mod message for HTTP responses."""
        try:
            content = message.content
            action = content.get('action', '')
            message_type = content.get('message_type', '')
            
            # Map mod actions to HTTP command responses
            if action == 'retrieve_channel_messages_response':
                return 'get_channel_messages'
            elif action == 'list_channels_response':
                return 'list_channels'
            elif action == 'retrieve_direct_messages_response':
                return 'get_direct_messages'
            elif action == 'reaction_response':
                return 'react_to_message'
            # Shared document response mappings
            elif action == 'document_created':
                return 'create_document'
            elif action == 'document_opened':
                return 'open_document'
            elif action == 'document_closed':
                return 'close_document'
            elif action == 'document_list_response':
                return 'list_documents'
            elif action == 'document_content_response':
                return 'get_document_content'
            elif action == 'document_history_response':
                return 'get_document_history'
            elif action == 'agent_presence_response':
                return 'get_agent_presence'
            elif action == 'lines_inserted':
                return 'insert_lines'
            elif action == 'lines_removed':
                return 'remove_lines'
            elif action == 'lines_replaced':
                return 'replace_lines'
            elif action == 'comment_added':
                return 'add_comment'
            elif action == 'comment_removed':
                return 'remove_comment'
            elif action == 'cursor_updated':
                return 'update_cursor_position'
            # Shared document message_type mappings (these use message_type instead of action)
            elif message_type == 'document_operation_response':
                # For operation responses, we need to determine the original command
                # This is a generic response, so we'll return a default
                return 'document_operation'
            elif message_type == 'document_list_response':
                return 'list_documents'
            elif message_type == 'document_content_response':
                return 'get_document_content'
            elif message_type == 'document_history_response':
                return 'get_document_history'
            elif message_type == 'agent_presence_response':
                return 'get_agent_presence'
            else:
                # Default to the action name
                return action.replace('_response', '') if action.endswith('_response') else action
        except Exception:
            return 'unknown'
    
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
    
    def register_message_handler(self, message_type: str, handler: Callable[[Message], Awaitable[None]]) -> None:
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
    
    def _convert_to_transport_message(self, message: Event) -> Message:
        """Convert a base message to a transport message.
        
        Args:
            message: Base message to convert
            
        Returns:
            Message: Transport message
        """
        from openagents.models.transport import TransportMessage
        
        # Determine target ID based on message type
        target_id = None
        if isinstance(message, DirectMessage) or (hasattr(message, '__class__') and message.__class__.__name__ == 'DirectMessage'):
            target_id = message.target_agent_id
        elif isinstance(message, ModMessage) or (hasattr(message, '__class__') and message.__class__.__name__ == 'ModMessage'):
            target_id = message.relevant_agent_id
        # BroadcastMessage has target_id = None (broadcast)
        
        # Create transport message from Event
        # Since messages are now Events, we can create TransportMessage directly
        transport_message = TransportMessage(
            source_id=message.source_id,
            target_agent_id=message.target_agent_id,
            target_id=target_id,
            payload=message.payload,
            metadata=message.metadata,
            timestamp=message.timestamp,
            visibility=message.visibility,
            requires_response=message.requires_response,
            relevant_mod=getattr(message, 'relevant_mod', None)
        )
        
        return transport_message
    
    async def _handle_transport_message(self, message: Message) -> None:
        """Handle incoming transport messages.
        
        Args:
            message: Transport message to handle
        """
        try:
            logger.info(f"🔧 NETWORK: _handle_transport_message called: id={message.message_id}, type={message.message_type}, sender={message.sender_id}")
            if hasattr(message, 'payload') and message.payload:
                logger.info(f"🔧 NETWORK: Message payload keys: {list(message.payload.keys())}")
                if 'mod' in message.payload:
                    logger.info(f"🔧 NETWORK: Message is for mod: {message.payload['mod']}")
            
            # Prevent infinite loops by tracking processed messages
            if message.message_id in self.processed_message_ids:
                logger.debug(f"Skipping already processed message {message.message_id}")
                return
            
            # Mark message as processed
            self.processed_message_ids.add(message.message_id)
            
            # Clean up old processed message IDs to prevent memory leak (keep last 1000)
            if len(self.processed_message_ids) > 1000:
                # Remove oldest half
                old_ids = list(self.processed_message_ids)[:500]
                for old_id in old_ids:
                    self.processed_message_ids.discard(old_id)
            
            # Convert transport message to Event and emit
            await self._emit_transport_message_as_event(message)
            
            # Check if this message needs to be routed to a specific target
            target = message.target_id or getattr(message, 'target_agent_id', None)
            if target and target != message.sender_id:
                # Route to target agent (direct messages)
                logger.debug(f"Routing message {message.message_id} to target agent {target}")
                success = await self.topology.route_message(message)
                if not success:
                    logger.warning(f"Failed to route message {message.message_id} to {target}")
            else:
                # Handle broadcast messages or local messages
                if message.message_type == "broadcast_message":
                    # Only route broadcast messages if they're not from the network itself
                    # This prevents infinite routing loops
                    if message.sender_id != self.network_id:
                        logger.debug(f"Routing broadcast message {message.message_id} to all agents")
                        success = await self.topology.route_message(message)
                        if not success:
                            logger.warning(f"Failed to route broadcast message {message.message_id}")
                    else:
                        logger.debug(f"Skipping re-routing of broadcast message {message.message_id} from network itself")
                elif message.message_type == "mod_message":
                    # Handle mod messages locally - do NOT route to other agents
                    logger.debug(f"Handling mod message {message.message_id} locally")
                    await self._handle_mod_message(message)
                elif message.message_type == "transport":
                    # Check if this transport message contains a mod message
                    payload = message.payload or {}
                    relevant_mod = payload.get('relevant_mod') if hasattr(payload, 'get') else getattr(payload, 'relevant_mod', None)
                    if relevant_mod:
                        logger.info(f"🔧 NETWORK: Transport message contains mod message for {relevant_mod}")
                        # Convert to ModMessage and handle directly
                        mod_message_event = self._transport_message_to_base_message(message)
                        if mod_message_event and hasattr(mod_message_event, 'relevant_mod'):
                            logger.info(f"🔧 NETWORK: Processing transport mod message directly")
                            await self._handle_mod_message(mod_message_event)
                        else:
                            logger.warning(f"🔧 NETWORK: Failed to convert transport message to mod message")
                    else:
                        logger.debug(f"Transport message {message.message_id} has no relevant_mod, skipping direct processing")
                
                # Also notify local message handlers (for broadcast messages or local handling)
                if message.message_type in self.message_handlers:
                    logger.debug(f"Found {len(self.message_handlers[message.message_type])} handlers for {message.message_type}")
                    for handler in self.message_handlers[message.message_type]:
                        await handler(message)
                else:
                    logger.debug(f"No handlers found for message type {message.message_type}")
        except Exception as e:
            logger.error(f"Error handling transport message: {e}")
    
    async def _handle_project_notification(self, message: Message) -> None:
        """Handle project notification messages by routing them to the project mod.
        
        Args:
            message: Transport message containing project notification
        """
        try:
            logger.info(f"🔧 NETWORK: Handling project_notification message {message.message_id}")
            
            # Find the project mod
            project_mod = None
            for mod_name, mod_instance in self.mods.items():
                if "project" in mod_name.lower():
                    project_mod = mod_instance
                    break
            
            if not project_mod:
                logger.warning("No project mod found to handle project notification")
                return
            
            # Convert transport message to ProjectNotificationMessage
            from openagents.workspace.project_messages import ProjectNotificationMessage
            
            # Extract data from message payload
            payload = message.payload or {}
            logger.info(f"🔧 NETWORK: Message payload: {payload}")
            
            # Create ProjectNotificationMessage from the transport message
            project_notification = ProjectNotificationMessage(
                source_id=message.sender_id,
                project_id=payload.get("project_id", ""),
                notification_type=payload.get("notification_type", ""),
                payload=payload.get("content", {}),
                timestamp=message.timestamp
            )
            
            logger.info(f"🔧 NETWORK: Created notification - project_id: {project_notification.project_id}, type: {project_notification.notification_type}")
            
            logger.info(f"🔧 NETWORK: Routing project notification to project mod: {project_notification.notification_type}")
            
            # Call the project mod's notification handler
            await project_mod._process_project_notification(project_notification)
            
        except Exception as e:
            logger.error(f"Error handling project notification: {e}")
    
    async def _handle_mod_message(self, message: Message) -> None:
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
                
                # Convert transport message back to ModMessage
                from openagents.models.messages import ModMessage
                
                # Check if message already is a properly formatted ModMessage (from transport conversion)
                if hasattr(message, 'content') and hasattr(message, 'relevant_mod'):
                    # This is already a converted ModMessage from transport, use it directly
                    mod_message = message
                else:
                    # Extract content from payload (excluding mod-specific fields) 
                    content = {}
                    mod_specific_fields = {'mod', 'direction', 'relevant_agent_id'}  # Keep 'action' in content
                    payload_dict = message.payload if hasattr(message.payload, 'items') else {}
                    for key, value in payload_dict.items():
                        if key not in mod_specific_fields:
                            content[key] = value
                    
                    mod_message = ModMessage(
                        source_id=message.sender_id,
                        relevant_mod=target_mod_name,
                        payload=content,
                        action=payload_dict.get('action'),
                        direction=payload_dict.get('direction'),
                        relevant_agent_id=payload_dict.get('relevant_agent_id'),
                        timestamp=message.timestamp,
                        metadata=message.metadata
                    )
                
                # Call mod's process_mod_message directly instead of using event system
                logger.info(f"🔧 NETWORK: Handling ModMessage {mod_message.message_id} locally, mod={target_mod_name}")
                logger.info(f"🔧 NETWORK: ModMessage sender={mod_message.source_id}, relevant_agent={mod_message.relevant_agent_id}")
                
                # Call the mod's process_mod_message method directly
                await network_mod.process_mod_message(mod_message)
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
                await handle_register_agent(command, message.get("data", {}), connection, self)
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