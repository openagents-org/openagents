"""
Agent network implementation for OpenAgents.

This module provides the network architecture using the transport and topology
abstractions for milestone 1.
"""

import asyncio
import logging
import uuid
import time
from typing import Dict, Any, List, Optional, Callable, Awaitable

from .transport import Transport, TransportManager, Message
from openagents.models.transport import TransportType
from .topology import NetworkTopology, NetworkMode, AgentInfo, create_topology
from ..models.messages import BaseMessage, DirectMessage, BroadcastMessage, ProtocolMessage
from ..models.network_config import NetworkConfig, NetworkMode as ConfigNetworkMode

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
        
        # Agent and protocol tracking (for compatibility with system commands)
        self.agents: Dict[str, Dict[str, Any]] = {}  # agent_id -> metadata
        self.protocols: Dict[str, Any] = {}
        self.protocol_manifests: Dict[str, Any] = {}
        
        # Message handling
        self.message_handlers: Dict[str, List[Callable[[Message], Awaitable[None]]]] = {}
        self.agent_handlers: Dict[str, List[Callable[[AgentInfo], Awaitable[None]]]] = {}
        
        # Register internal message handlers
        self._register_internal_handlers()
    
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
            transport = self.topology.transport_manager.get_active_transport()
            if transport:
                transport.register_message_handler(self._handle_transport_message)
                transport.register_system_message_handler(self._handle_system_message)
    
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
    
    async def send_message(self, message: BaseMessage) -> bool:
        """Send a message through the network.
        
        Args:
            message: Message to send
            
        Returns:
            bool: True if message sent successfully
        """
        try:
            # Convert to transport message
            transport_message = self._convert_to_transport_message(message)
            
            # Route through topology
            return await self.topology.route_message(transport_message)
        except Exception as e:
            logger.error(f"Failed to send message: {e}")
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
    
    def _convert_to_transport_message(self, message: BaseMessage) -> Message:
        """Convert a base message to a transport message.
        
        Args:
            message: Base message to convert
            
        Returns:
            Message: Transport message
        """
        from openagents.models.transport import TransportMessage
        
        # Determine target ID based on message type
        target_id = None
        if isinstance(message, DirectMessage):
            target_id = message.target_agent_id
        elif isinstance(message, ProtocolMessage):
            target_id = message.relevant_agent_id
        # BroadcastMessage has target_id = None (broadcast)
        
        # Create transport message
        transport_message = TransportMessage(
            message_id=message.message_id,
            sender_id=message.sender_id,
            target_id=target_id,
            message_type=message.message_type,
            payload={
                "content": message.content,
                "metadata": message.metadata,
                "text_representation": message.text_representation,
                "requires_response": message.requires_response,
                "protocol": getattr(message, 'protocol', None),
                "direction": getattr(message, 'direction', None),
                "exclude_agent_ids": getattr(message, 'exclude_agent_ids', [])
            },
            timestamp=message.timestamp
        )
        
        return transport_message
    
    async def _handle_transport_message(self, message: Message) -> None:
        """Handle incoming transport messages.
        
        Args:
            message: Transport message to handle
        """
        try:
            # Notify message handlers
            if message.message_type in self.message_handlers:
                for handler in self.message_handlers[message.message_type]:
                    await handler(message)
        except Exception as e:
            logger.error(f"Error handling transport message: {e}")
    
    async def _handle_system_message(self, peer_id: str, message: Dict[str, Any], connection: Any) -> None:
        """Handle incoming system messages.
        
        Args:
            peer_id: ID of the peer sending the message
            message: System message data
            connection: WebSocket connection
        """
        try:
            from .system_commands import (
                handle_register_agent, handle_list_agents, handle_list_protocols,
                REGISTER_AGENT, LIST_AGENTS, LIST_PROTOCOLS
            )
            
            command = message.get("command")
            
            if command == REGISTER_AGENT:
                await handle_register_agent(command, message, connection, self)
            elif command == LIST_AGENTS:
                await handle_list_agents(command, message, connection, self)
            elif command == LIST_PROTOCOLS:
                await handle_list_protocols(command, message, connection, self)
            else:
                logger.warning(f"Unhandled system command: {command}")
        except Exception as e:
            logger.error(f"Error handling system message: {e}")
    
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


def create_network(config: NetworkConfig) -> AgentNetwork:
    """Create an agent network from configuration.
    
    Args:
        config: Network configuration
        
    Returns:
        AgentNetwork: Configured network instance
    """
    return AgentNetwork(config)


# Backward compatibility aliases
AgentNetworkServer = AgentNetwork
EnhancedAgentNetwork = AgentNetwork  # For transition period
create_enhanced_network = create_network  # For transition period