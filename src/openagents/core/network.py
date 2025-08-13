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
from typing import Dict, Any, List, Optional, Callable, Awaitable

from .transport import Transport, TransportManager, Message
from openagents.models.transport import TransportType
from .topology import NetworkTopology, NetworkMode, AgentInfo, create_topology
from ..models.messages import BaseMessage, DirectMessage, BroadcastMessage, ModMessage
from ..models.network_config import NetworkConfig, NetworkMode as ConfigNetworkMode
from .agent_identity import AgentIdentityManager

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
                # Register agent connection resolver for routing messages by agent_id
                if hasattr(transport, 'register_agent_connection_resolver'):
                    transport.register_agent_connection_resolver(self._resolve_agent_connection)
        
        # Register network-level message handlers
        self.message_handlers["mod_message"] = [self._handle_mod_message]
    
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
        elif isinstance(message, ModMessage):
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
                "mod": getattr(message, 'mod', None),
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
            logger.debug(f"_handle_transport_message called: id={message.message_id}, type={message.message_type}, available_handlers={list(self.message_handlers.keys())}")
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
                    # Route broadcast message to all connected agents
                    logger.debug(f"Routing broadcast message {message.message_id} to all agents")
                    success = await self.topology.route_message(message)
                    if not success:
                        logger.warning(f"Failed to route broadcast message {message.message_id}")
                
                # Also notify local message handlers (for broadcast messages or local handling)
                if message.message_type in self.message_handlers:
                    logger.debug(f"Found {len(self.message_handlers[message.message_type])} handlers for {message.message_type}")
                    for handler in self.message_handlers[message.message_type]:
                        await handler(message)
                else:
                    logger.debug(f"No handlers found for message type {message.message_type}")
        except Exception as e:
            logger.error(f"Error handling transport message: {e}")
    
    async def _handle_mod_message(self, message: Message) -> None:
        """Handle mod messages by routing them to the appropriate network mods.
        
        Args:
            message: Transport message to route to network mods
        """
        try:
            logger.debug(f"_handle_mod_message called with message: {message.message_id}, type: {message.message_type}")
            logger.debug(f"Message attributes: content={hasattr(message, 'content')}, payload={hasattr(message, 'payload')}")
            
            # The TransportMessage is already a ModMessage - we just need to extract the target mod name
            target_mod_name = message.mod
            logger.debug(f"Target mod name: {target_mod_name}")
            
            if target_mod_name and target_mod_name in self.mods:
                network_mod = self.mods[target_mod_name]
                logger.debug(f"Routing mod message {message.message_id} to network mod {target_mod_name}")
                await network_mod.process_mod_message(message)
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
            from .system_commands import (
                handle_register_agent, handle_list_agents, handle_list_mods,
                handle_ping_agent, handle_claim_agent_id, handle_validate_certificate,
                REGISTER_AGENT, LIST_AGENTS, LIST_MODS, PING_AGENT, 
                CLAIM_AGENT_ID, VALIDATE_CERTIFICATE
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
                await handle_register_agent(command, message, connection, self)
            elif command == LIST_AGENTS:
                await handle_list_agents(command, message, connection, self)
            elif command == LIST_MODS:
                await handle_list_mods(command, message, connection, self)
            elif command == PING_AGENT:
                await handle_ping_agent(command, message, connection, self)
            elif command == CLAIM_AGENT_ID:
                await handle_claim_agent_id(command, message, connection, self)
            elif command == VALIDATE_CERTIFICATE:
                await handle_validate_certificate(command, message, connection, self)
            else:
                logger.warning(f"Unhandled system command: {command}")
        except Exception as e:
            logger.error(f"Error handling system message: {e}")
    
    def _resolve_agent_connection(self, agent_id: str) -> Any:
        """Resolve agent_id to WebSocket connection.
        
        Args:
            agent_id: ID of the agent to find connection for
            
        Returns:
            WebSocket connection or None if not found
        """
        print(f"🔍 Resolving connection for agent_id: {agent_id}")
        print(f"   Available connections: {list(self.connections.keys())}")
        if agent_id in self.connections:
            connection = self.connections[agent_id].connection
            print(f"   ✅ Found connection for {agent_id}: {type(connection).__name__}")
            return connection
        print(f"   ❌ No connection found for {agent_id}")
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