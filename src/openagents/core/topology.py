"""
Network topology abstraction layer for OpenAgents.

This module provides the NetworkTopology abstraction and implementations
for both centralized and decentralized network topologies.
"""

from abc import ABC, abstractmethod
from typing import Dict, Any, List, Optional, Set
from enum import Enum
import asyncio
import logging
import time
import json
import uuid

from .transport import Transport, TransportManager, Message
from openagents.models.transport import TransportType, PeerMetadata, AgentInfo

logger = logging.getLogger(__name__)


class NetworkMode(Enum):
    """Network operation modes."""
    CENTRALIZED = "centralized"
    DECENTRALIZED = "decentralized"


# AgentInfo is now imported from openagents.models.transport


class NetworkTopology(ABC):
    """Abstract base class for network topology implementations."""
    
    def __init__(self, node_id: str, config: Dict[str, Any]):
        self.node_id = node_id
        self.config = config
        self.transport_manager = TransportManager()
        self.agents: Dict[str, AgentInfo] = {}
        self.is_running = False
    
    @abstractmethod
    async def initialize(self) -> bool:
        """Initialize the network topology.
        
        Returns:
            bool: True if initialization successful
        """
        pass
    
    @abstractmethod
    async def shutdown(self) -> bool:
        """Shutdown the network topology.
        
        Returns:
            bool: True if shutdown successful
        """
        pass
    
    @abstractmethod
    async def register_agent(self, agent_info: AgentInfo) -> bool:
        """Register an agent with the network.
        
        Args:
            agent_info: Information about the agent to register
            
        Returns:
            bool: True if registration successful
        """
        pass
    
    @abstractmethod
    async def unregister_agent(self, agent_id: str) -> bool:
        """Unregister an agent from the network.
        
        Args:
            agent_id: ID of the agent to unregister
            
        Returns:
            bool: True if unregistration successful
        """
        pass
    
    @abstractmethod
    async def discover_peers(self, capabilities: Optional[List[str]] = None) -> List[AgentInfo]:
        """Discover peers in the network.
        
        Args:
            capabilities: Optional list of required capabilities to filter by
            
        Returns:
            List[AgentInfo]: List of discovered agents
        """
        pass
    
    @abstractmethod
    async def route_message(self, message: Message) -> bool:
        """Route a message through the network.
        
        Args:
            message: Message to route
            
        Returns:
            bool: True if routing successful
        """
        pass
    
    def get_agents(self) -> Dict[str, AgentInfo]:
        """Get all registered agents.
        
        Returns:
            Dict[str, AgentInfo]: Dictionary of agent ID to agent info
        """
        return self.agents.copy()
    
    def get_agent(self, agent_id: str) -> Optional[AgentInfo]:
        """Get information about a specific agent.
        
        Args:
            agent_id: ID of the agent
            
        Returns:
            Optional[AgentInfo]: Agent info if found, None otherwise
        """
        return self.agents.get(agent_id)


class CentralizedTopology(NetworkTopology):
    """Centralized network topology using a coordinator/registry server."""
    
    def __init__(self, node_id: str, config: Dict[str, Any]):
        super().__init__(node_id, config)
        self.coordinator_url = config.get("coordinator_url", "http://localhost:8080")
        self.server_mode = config.get("server_mode", False)  # True if this node is the coordinator
        self.registry: Dict[str, AgentInfo] = {}  # Local registry for server mode
        self.discovery_interval = config.get("discovery_interval", 30)  # seconds
        self.discovery_task: Optional[asyncio.Task] = None
    
    async def initialize(self) -> bool:
        """Initialize the centralized topology."""
        try:
            # Initialize transport (default to WebSocket for centralized)
            transport_type = TransportType(self.config.get("transport", "websocket"))
            
            if transport_type == TransportType.WEBSOCKET:
                from .transport import WebSocketTransport
                transport = WebSocketTransport(self.config.get("transport_config", {}))
            else:
                logger.error(f"Unsupported transport for centralized topology: {transport_type}")
                return False
            
            self.transport_manager.register_transport(transport)
            if not await self.transport_manager.initialize_transport(transport_type):
                return False
            
            if self.server_mode:
                # Start server mode (coordinator)
                host = self.config.get("host", "0.0.0.0")  
                port = self.config.get("port", 8080)
                transport = self.transport_manager.get_active_transport()
                if transport and not await transport.listen(f"{host}:{port}"):
                    return False
                logger.info(f"Centralized coordinator started on {host}:{port}")
            else:
                # Client mode - connect to coordinator
                # This would be handled when agents register
                pass
            
            self.is_running = True
            
            # Start periodic discovery if not in server mode
            if not self.server_mode:
                self.discovery_task = asyncio.create_task(self._periodic_discovery())
            
            return True
        except Exception as e:
            logger.error(f"Failed to initialize centralized topology: {e}")
            return False
    
    async def shutdown(self) -> bool:
        """Shutdown the centralized topology."""
        self.is_running = False
        
        if self.discovery_task:
            self.discovery_task.cancel()
            try:
                await self.discovery_task
            except asyncio.CancelledError:
                pass
        
        await self.transport_manager.shutdown_all()
        logger.info("Centralized topology shutdown")
        return True
    
    async def register_agent(self, agent_info: AgentInfo) -> bool:
        """Register an agent with the centralized registry."""
        try:
            if self.server_mode:
                # Server mode - add to local registry
                self.registry[agent_info.agent_id] = agent_info
                logger.info(f"Registered agent {agent_info.agent_id} in centralized registry")
            else:
                # Client mode - send registration to coordinator
                # TODO: Implement HTTP/WebSocket registration with coordinator
                logger.info(f"Registering agent {agent_info.agent_id} with coordinator at {self.coordinator_url}")
            
            self.agents[agent_info.agent_id] = agent_info
            return True
        except Exception as e:
            logger.error(f"Failed to register agent {agent_info.agent_id}: {e}")
            return False
    
    async def unregister_agent(self, agent_id: str) -> bool:
        """Unregister an agent from the centralized registry."""
        try:
            if self.server_mode:
                if agent_id in self.registry:
                    del self.registry[agent_id]
                    logger.info(f"Unregistered agent {agent_id} from centralized registry")
            else:
                # TODO: Implement HTTP/WebSocket unregistration with coordinator
                logger.info(f"Unregistering agent {agent_id} from coordinator")
            
            if agent_id in self.agents:
                del self.agents[agent_id]
            return True
        except Exception as e:
            logger.error(f"Failed to unregister agent {agent_id}: {e}")
            return False
    
    async def discover_peers(self, capabilities: Optional[List[str]] = None) -> List[AgentInfo]:
        """Discover peers through the centralized registry."""
        try:
            if self.server_mode:
                # Return agents from local registry
                agents = list(self.registry.values())
            else:
                # TODO: Query coordinator for agent list
                # For now, return local cache
                agents = list(self.agents.values())
            
            if capabilities:
                # Filter by capabilities (agent must have ALL required capabilities)
                filtered_agents = []
                for agent in agents:
                    if all(cap in agent.capabilities for cap in capabilities):
                        filtered_agents.append(agent)
                return filtered_agents
            
            return agents
        except Exception as e:
            logger.error(f"Failed to discover peers: {e}")
            return []
    
    async def route_message(self, message: Message) -> bool:
        """Route message through centralized topology."""
        try:
            transport = self.transport_manager.get_active_transport()
            if not transport:
                logger.error("No active transport for message routing")
                return False
            
            return await transport.send(message)
        except Exception as e:
            logger.error(f"Failed to route message: {e}")
            return False
    
    async def _periodic_discovery(self):
        """Periodically discover peers from coordinator."""
        while self.is_running:
            try:
                # TODO: Implement periodic discovery from coordinator
                await asyncio.sleep(self.discovery_interval)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in periodic discovery: {e}")
                await asyncio.sleep(self.discovery_interval)


class DecentralizedTopology(NetworkTopology):
    """Decentralized network topology using P2P protocols."""
    
    def __init__(self, node_id: str, config: Dict[str, Any]):
        super().__init__(node_id, config)
        self.bootstrap_nodes = config.get("bootstrap_nodes", [])
        self.discovery_interval = config.get("discovery_interval", 10)  # seconds
        self.dht_table: Dict[str, AgentInfo] = {}  # Distributed hash table
        self.discovery_task: Optional[asyncio.Task] = None
        self.heartbeat_task: Optional[asyncio.Task] = None
        self.connected_peers: Set[str] = set()
    
    async def initialize(self) -> bool:
        """Initialize the decentralized topology."""
        try:
            # Initialize transport (prefer libp2p, fallback to WebSocket)
            transport_type = TransportType(self.config.get("transport", "libp2p"))
            
            # For now, use WebSocket as libp2p is not implemented
            if transport_type == TransportType.LIBP2P:
                logger.warning("libp2p not implemented, falling back to WebSocket for P2P simulation")
                transport_type = TransportType.WEBSOCKET
            
            if transport_type == TransportType.WEBSOCKET:
                from .transport import WebSocketTransport
                transport = WebSocketTransport(self.config.get("transport_config", {}))
            else:
                logger.error(f"Unsupported transport for decentralized topology: {transport_type}")
                return False
            
            self.transport_manager.register_transport(transport)
            if not await self.transport_manager.initialize_transport(transport_type):
                return False
            
            # Start listening for connections
            host = self.config.get("host", "0.0.0.0")
            port = self.config.get("port", 0)  # Use random port if not specified
            transport = self.transport_manager.get_active_transport()
            if transport and not await transport.listen(f"{host}:{port}"):
                return False
            
            self.is_running = True
            
            # Connect to bootstrap nodes
            await self._connect_to_bootstrap_nodes()
            
            # Start periodic tasks
            self.discovery_task = asyncio.create_task(self._periodic_discovery())
            self.heartbeat_task = asyncio.create_task(self._periodic_heartbeat())
            
            logger.info(f"Decentralized topology initialized on {host}:{port}")
            return True
        except Exception as e:
            logger.error(f"Failed to initialize decentralized topology: {e}")
            return False
    
    async def shutdown(self) -> bool:
        """Shutdown the decentralized topology."""
        self.is_running = False
        
        if self.discovery_task:
            self.discovery_task.cancel()
        if self.heartbeat_task:
            self.heartbeat_task.cancel()
        
        try:
            if self.discovery_task:
                await self.discovery_task
        except asyncio.CancelledError:
            pass
        
        try:
            if self.heartbeat_task:
                await self.heartbeat_task
        except asyncio.CancelledError:
            pass
        
        await self.transport_manager.shutdown_all()
        logger.info("Decentralized topology shutdown")
        return True
    
    async def register_agent(self, agent_info: AgentInfo) -> bool:
        """Register an agent in the decentralized network."""
        try:
            # Add to local DHT
            self.dht_table[agent_info.agent_id] = agent_info
            self.agents[agent_info.agent_id] = agent_info
            
            # Announce to connected peers
            await self._announce_agent(agent_info)
            
            logger.info(f"Registered agent {agent_info.agent_id} in decentralized network")
            return True
        except Exception as e:
            logger.error(f"Failed to register agent {agent_info.agent_id}: {e}")
            return False
    
    async def unregister_agent(self, agent_id: str) -> bool:
        """Unregister an agent from the decentralized network."""
        try:
            if agent_id in self.dht_table:
                del self.dht_table[agent_id]
            if agent_id in self.agents:
                del self.agents[agent_id]
            
            # Announce removal to connected peers
            await self._announce_agent_removal(agent_id)
            
            logger.info(f"Unregistered agent {agent_id} from decentralized network")
            return True
        except Exception as e:
            logger.error(f"Failed to unregister agent {agent_id}: {e}")
            return False
    
    async def discover_peers(self, capabilities: Optional[List[str]] = None) -> List[AgentInfo]:
        """Discover peers in the decentralized network."""
        try:
            # Query local DHT and connected peers
            agents = list(self.dht_table.values())
            
            if capabilities:
                # Filter by capabilities (agent must have ALL required capabilities)
                filtered_agents = []
                for agent in agents:
                    if all(cap in agent.capabilities for cap in capabilities):
                        filtered_agents.append(agent)
                return filtered_agents
            
            return agents
        except Exception as e:
            logger.error(f"Failed to discover peers: {e}")
            return []
    
    async def route_message(self, message: Message) -> bool:
        """Route message through decentralized topology."""
        try:
            transport = self.transport_manager.get_active_transport()
            if not transport:
                logger.error("No active transport for message routing")
                return False
            
            if message.target_id:
                # Direct message - find route to target
                if message.target_id in self.connected_peers:
                    return await transport.send(message)
                else:
                    # TODO: Implement DHT routing
                    logger.warning(f"Target {message.target_id} not directly connected, DHT routing not implemented")
                    return False
            else:
                # Broadcast message - send to all connected peers
                return await transport.send(message)
        except Exception as e:
            logger.error(f"Failed to route message: {e}")
            return False
    
    async def _connect_to_bootstrap_nodes(self):
        """Connect to bootstrap nodes to join the network."""
        transport = self.transport_manager.get_active_transport()
        if not transport:
            return
        
        for node_address in self.bootstrap_nodes:
            try:
                # Extract peer ID from address (simplified)
                peer_id = f"bootstrap-{uuid.uuid4().hex[:8]}"
                if await transport.connect(peer_id, node_address):
                    self.connected_peers.add(peer_id)
                    logger.info(f"Connected to bootstrap node {node_address}")
            except Exception as e:
                logger.error(f"Failed to connect to bootstrap node {node_address}: {e}")
    
    async def _announce_agent(self, agent_info: AgentInfo):
        """Announce an agent to connected peers."""
        transport = self.transport_manager.get_active_transport()
        if not transport:
            return
        
        announcement = Message(
            sender_id=self.node_id,
            target_id=None,  # Broadcast
            message_type="agent_announcement",
            payload={
                "agent_id": agent_info.agent_id,
                "metadata": agent_info.metadata,
                "capabilities": agent_info.capabilities,
                "address": agent_info.address
            },
            timestamp=int(time.time() * 1000)
        )
        
        await transport.send(announcement)
    
    async def _announce_agent_removal(self, agent_id: str):
        """Announce agent removal to connected peers."""
        transport = self.transport_manager.get_active_transport()
        if not transport:
            return
        
        announcement = Message(
            sender_id=self.node_id,
            target_id=None,  # Broadcast
            message_type="agent_removal",
            payload={"agent_id": agent_id},
            timestamp=int(time.time() * 1000)
        )
        
        await transport.send(announcement)
    
    async def _periodic_discovery(self):
        """Periodically discover new peers."""
        while self.is_running:
            try:
                # TODO: Implement peer discovery using mDNS or DHT
                await asyncio.sleep(self.discovery_interval)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in periodic discovery: {e}")
                await asyncio.sleep(self.discovery_interval)
    
    async def _periodic_heartbeat(self):
        """Send periodic heartbeats to maintain connections."""
        while self.is_running:
            try:
                transport = self.transport_manager.get_active_transport()
                if transport:
                    heartbeat = Message(
                        sender_id=self.node_id,
                        target_id=None,  # Broadcast
                        message_type="heartbeat",
                        payload={"timestamp": int(time.time() * 1000)},
                        timestamp=int(time.time() * 1000)
                    )
                    await transport.send(heartbeat)
                
                await asyncio.sleep(30)  # Heartbeat every 30 seconds
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in periodic heartbeat: {e}")
                await asyncio.sleep(30)


def create_topology(mode: NetworkMode, node_id: str, config: Dict[str, Any]) -> NetworkTopology:
    """Factory function to create network topology based on mode.
    
    Args:
        mode: Network operation mode
        node_id: ID of this network node
        config: Configuration for the topology
        
    Returns:
        NetworkTopology: Appropriate topology implementation
    """
    if mode == NetworkMode.CENTRALIZED:
        return CentralizedTopology(node_id, config)
    elif mode == NetworkMode.DECENTRALIZED:
        return DecentralizedTopology(node_id, config)
    else:
        raise ValueError(f"Unsupported network mode: {mode}") 