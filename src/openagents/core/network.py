from typing import Dict, Any, List, Optional, Set, Type, Callable, Awaitable
import uuid
import logging
from .agent import Agent
from .network_protocol_base import NetworkProtocolBase
import json
import asyncio
import websockets
from websockets.server import WebSocketServerProtocol
from websockets.exceptions import ConnectionClosed
from openagents.models.messages import (
    BaseMessage, 
    NetworkMessage, 
    RegistrationMessage, 
    RegistrationResponseMessage, 
    BroadcastMessage,
    SimpleMessage
)

logger = logging.getLogger(__name__)


class Network:
    """Core network server implementation for OpenAgents.
    
    A network server that agents can connect to using WebSocket connections.
    """
    
    def __init__(self, name: Optional[str] = None, host: str = "127.0.0.1", port: int = 8765) -> None:
        """Initialize a network server.
        
        Args:
            name: Optional human-readable name for the network
            host: Host address to bind to
            port: Port to listen on
        """
        self.network_id = str(uuid.uuid4())
        self.name = name or f"Network-{self.network_id[:8]}"
        self.host = host
        self.port = port
        self.protocols: Dict[str, NetworkProtocolBase] = {}
        self.connections: Dict[str, WebSocketServerProtocol] = {}  # agent_id -> connection
        self.agents: Dict[str, Dict[str, Any]] = {}  # agent_id -> metadata
        self.is_running = False
    
    def register_protocol(self, protocol: NetworkProtocolBase) -> bool:
        """Register a protocol with this network.
        
        Args:
            protocol: Protocol to register
            
        Returns:
            bool: True if registration was successful
        """
        protocol_name = protocol.__class__.__name__
        
        if protocol_name in self.protocols:
            logger.warning(f"Protocol {protocol_name} already registered")
            return False
        
        protocol.network = self
        self.protocols[protocol_name] = protocol
        logger.info(f"Registered protocol {protocol_name}")
        return True
    
    async def handle_connection(self, websocket: WebSocketServerProtocol, path: str) -> None:
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
            
            try:
                # Parse and validate the registration message
                reg_message = RegistrationMessage(**data)
                agent_id = reg_message.agent_id
                
                logger.info(f"Received registration message {reg_message.message_id} from agent {agent_id}")
                
                # Store connection
                self.connections[agent_id] = websocket
                
                # Register agent metadata if provided
                if reg_message.metadata:
                    self.register_agent(agent_id, reg_message.metadata)
                
                # Send registration response
                response = RegistrationResponseMessage(
                    success=True,
                    network_name=self.name
                )
                await websocket.send(response.json())
                logger.info(f"Sent registration response {response.message_id} to agent {agent_id}")
                
                # Handle messages from this connection
                try:
                    async for message in websocket:
                        data = json.loads(message)
                        message_type = data.get("type")
                        
                        if message_type == "message":
                            # Parse as NetworkMessage
                            network_message = NetworkMessage(**data)
                            logger.debug(f"Received message {network_message.message_id} from {agent_id}")
                            
                            # Route message to appropriate protocol
                            for protocol in self.protocols.values():
                                if hasattr(protocol, "handle_message"):
                                    await protocol.handle_message(network_message.dict())
                        elif message_type == "broadcast":
                            # Parse as BroadcastMessage
                            broadcast_message = BroadcastMessage(**data)
                            logger.debug(f"Received broadcast {broadcast_message.message_id} from {agent_id}")
                            
                            # Handle broadcast message by forwarding it to all other agents
                            await self.broadcast_message(broadcast_message, broadcast_message.source_agent_id, broadcast_message.source_agent_id)
                except ConnectionClosed:
                    pass
                
            except Exception as e:
                # Send error response for invalid registration
                error_response = RegistrationResponseMessage(
                    success=False,
                    network_name=self.name,
                    error=str(e)
                )
                await websocket.send(error_response.json())
                await websocket.close()
                logger.error(f"Invalid registration message: {e}")
            
        finally:
            # Clean up connection
            if agent_id and agent_id in self.connections:
                del self.connections[agent_id]
    
    def run(self) -> None:
        """Run the network server."""
        async def serve() -> None:
            async with websockets.serve(self.handle_connection, self.host, self.port):
                self.is_running = True
                logger.info(f"Network server running on {self.host}:{self.port}")
                await asyncio.Future()  # run forever
        
        asyncio.run(serve())
    
    def stop(self) -> None:
        """Stop the network server."""
        self.is_running = False
        # Close all connections
        for connection in self.connections.values():
            asyncio.run(connection.close())
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
                protocol.register_agent(agent_id, metadata)
                logger.info(f"Registered agent {agent_name} ({agent_id}) with protocol {protocol_name}")
            except Exception as e:
                logger.error(f"Failed to register agent {agent_name} ({agent_id}) with protocol {protocol_name}: {e}")
                # Continue with other protocols even if one fails
        
        # Log detailed agent information
        protocols = metadata.get("protocols", [])
        capabilities = metadata.get("capabilities", [])
        services = metadata.get("services", [])
        
        logger.info(f"Agent {agent_name} ({agent_id}) joined network {self.name} ({self.network_id})")
        logger.info(f"  - Protocols: {', '.join(protocols) if protocols else 'None'}")
        logger.info(f"  - Capabilities: {', '.join(capabilities) if capabilities else 'None'}")
        logger.info(f"  - Services: {', '.join(services) if services else 'None'}")
        
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
                protocol.unregister_agent(agent_id)
                logger.info(f"Unregistered agent {agent_name} ({agent_id}) from protocol {protocol_name}")
            except Exception as e:
                logger.error(f"Failed to unregister agent {agent_name} ({agent_id}) from protocol {protocol_name}: {e}")
                return False
        
        self.agents.pop(agent_id)
        logger.info(f"Agent {agent_name} ({agent_id}) left network {self.name} ({self.network_id})")
        
        return True
    
    async def broadcast_message(self, message: BaseMessage, sender_id: str, exclude_agent_id: Optional[str] = None) -> bool:
        """Broadcast a message to all agents in the network.
        
        Args:
            message: Message to broadcast (must be a BaseMessage instance)
            sender_id: ID of the sending agent
            exclude_agent_id: Agent ID to exclude from broadcast
            
        Returns:
            bool: True if broadcast was successful, False otherwise
        """
        # Create a broadcast message that wraps the original message
        broadcast_message = BroadcastMessage(
            source_agent_id=sender_id,
            message_type=message.protocol,
            content={
                "original_message_id": message.message_id,
                "original_protocol": message.protocol,
                "payload": message.dict()
            }
        )
        
        logger.debug(f"Broadcasting message {broadcast_message.message_id} from {sender_id} of type {message.protocol} (original: {message.message_id})")
        
        # Server-side broadcast
        for agent_id, connection in self.connections.items():
            if exclude_agent_id and agent_id == exclude_agent_id:
                continue
            
            try:
                # Create a network message for each recipient
                network_message = NetworkMessage(
                    source_agent_id=sender_id,
                    target_agent_id=agent_id,
                    content={
                        "broadcast_id": broadcast_message.message_id,
                        "original_message_id": message.message_id,
                        "original_protocol": message.protocol,
                        "payload": message.dict()
                    }
                )
                
                await connection.send(network_message.json())
            except Exception as e:
                logger.error(f"Error broadcasting to agent {agent_id}: {e}")
        
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
            "name": self.name,
            "is_running": self.is_running,
            "agent_count": len(self.agents),
            "protocols": {}
        }
        
        for protocol_name, protocol in self.protocols.items():
            state["protocols"][protocol_name] = protocol.get_network_state()
        
        return state
    
    async def send_message(self, sender_id: str, target_id: str, message: BaseMessage) -> bool:
        """Send a message to an agent.
        
        Args:
            sender_id: ID of the sending agent
            target_id: ID of the target agent
            message: Message to send (must be a BaseMessage instance)
            
        Returns:
            bool: True if message was sent successfully
        """
        if not self.is_running:
            logger.warning(f"Network {self.network_id} not running")
            return False
            
        if target_id not in self.connections:
            logger.error(f"Target agent {target_id} not connected")
            return False
            
        try:
            # Create a network message that wraps the original message
            network_message = NetworkMessage(
                source_agent_id=sender_id,
                target_agent_id=target_id,
                content={
                    "original_message_id": message.message_id,
                    "original_protocol": message.protocol,
                    "payload": message.dict()
                }
            )
            
            # Send the validated message
            await self.connections[target_id].send(network_message.json())
            
            # Log the message
            logger.debug(f"Message sent from {sender_id} to {target_id}: {network_message.message_id} (original: {message.message_id})")
            
            return True
        except Exception as e:
            logger.error(f"Failed to send message: {e}")
            return False
    
    async def send_simple_message(self, sender_id: str, target_id: str, message_type: str, content: Dict[str, Any]) -> bool:
        """Send a simple message to an agent.
        
        This is a convenience method that creates a SimpleMessage and sends it.
        
        Args:
            sender_id: ID of the sending agent
            target_id: ID of the target agent
            message_type: Type of the message
            content: Message content
            
        Returns:
            bool: True if message sent successfully, False otherwise
        """
        # Create a simple message
        message = SimpleMessage(
            message_type=message_type,
            content=content
        )
        
        # Send the message
        return await self.send_message(sender_id, target_id, message)
    
    async def broadcast_simple_message(self, sender_id: str, message_type: str, content: Dict[str, Any], exclude_agent_id: Optional[str] = None) -> bool:
        """Broadcast a simple message to all agents in the network.
        
        This is a convenience method that creates a SimpleMessage and broadcasts it.
        
        Args:
            sender_id: ID of the sending agent
            message_type: Type of the message
            content: Message content
            exclude_agent_id: Agent ID to exclude from broadcast
            
        Returns:
            bool: True if broadcast was successful, False otherwise
        """
        # Create a simple message
        message = SimpleMessage(
            message_type=message_type,
            content=content
        )
        
        # Broadcast the message
        return await self.broadcast_message(message, sender_id, exclude_agent_id)