from typing import Dict, Any, List, Optional, Set, Type, Callable, Awaitable, Union
import uuid
import logging
from .base_protocol import BaseProtocol
import json
import asyncio
import websockets
from websockets.server import WebSocketServerProtocol
from websockets.exceptions import ConnectionClosed
from openagents.models.messages import (
    BaseMessage, 
    DirectMessage,
    BroadcastMessage,
    ProtocolMessage
)
from openagents.utils.message_util import parse_message_dict
from pydantic import BaseModel, ConfigDict

logger = logging.getLogger(__name__)

class AgentConnection(BaseModel):
    """Model representing an agent connection to the network."""
    agent_id: str
    connection: Union[WebSocketServerProtocol, Any]
    metadata: Dict[str, Any]
    last_activity: float = 0.0
    
    model_config = ConfigDict(arbitrary_types_allowed=True)


class Network:
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
        self.connections: Dict[str, AgentConnection] = {}  # agent_id -> connection
        self.agents: Dict[str, Dict[str, Any]] = {}  # agent_id -> metadata
        self.is_running = False
        self.server = None
    
    def register_protocol(self, protocol: BaseProtocol) -> bool:
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
        
        protocol.bind_network(self)
        self.protocols[protocol_name] = protocol
        logger.info(f"Registered protocol {protocol_name}")
        return True
    
    async def handle_connection(self, websocket: WebSocketServerProtocol) -> None:
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
            
            if data.get("type") == "openagents_register":
                # Extract agent information
                agent_id = data.get("agent_id")
                metadata = data.get("metadata", {})
                
                if not agent_id:
                    logger.error("Registration message missing agent_id")
                    await websocket.close(1008, "Missing agent_id")
                    return
                
                # Check if agent is already registered
                if agent_id in self.connections:
                    logger.warning(f"Agent {agent_id} is already connected to the network")
                    await websocket.send(json.dumps({
                        "type": "openagents_register_response",
                        "success": False,
                        "error": "Agent with this ID is already connected to the network"
                    }))
                    await websocket.close(1008, "Duplicate agent ID")
                    return
                
                logger.info(f"Received registration from agent {agent_id}")
                
                # Store connection
                self.connections[agent_id] = AgentConnection(
                    agent_id=agent_id,
                    connection=websocket,
                    metadata=metadata,
                    last_activity=asyncio.get_event_loop().time()
                )
                
                # Register agent metadata
                self.register_agent(agent_id, metadata)
                
                # Send registration response
                await websocket.send(json.dumps({
                    "type": "openagents_register_response",
                    "success": True,
                    "network_name": self.network_name,
                    "network_id": self.network_id,
                    "metadata": self.metadata
                }))
                
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
                        elif data.get("type") == "heartbeat":
                            # Handle heartbeat message
                            await websocket.send(json.dumps({
                                "type": "heartbeat_response",
                                "timestamp": asyncio.get_event_loop().time()
                            }))
                            logger.debug(f"Received heartbeat from {agent_id}")
                        
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
        self.server = await websockets.serve(self.handle_connection, self.host, self.port)
        logger.info(f"Network server running on {self.host}:{self.port}")
        
        # Start inactive agent cleanup task
        asyncio.create_task(self._cleanup_inactive_agents())
        
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
                
                # Find inactive agents
                for agent_id, connection in self.connections.items():
                    if current_time - connection.last_activity > MAX_INACTIVE_TIME:
                        inactive_agents.append(agent_id)
                
                # Remove inactive agents
                for agent_id in inactive_agents:
                    logger.info(f"Removing inactive agent {agent_id}")
                    if agent_id in self.connections:
                        try:
                            await self.connections[agent_id].connection.close()
                        except:
                            pass
                        del self.connections[agent_id]
                        self.unregister_agent(agent_id)
                
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
        protocols = metadata.get("protocols", [])
        capabilities = metadata.get("capabilities", [])
        services = metadata.get("services", [])
        
        logger.info(f"Agent {agent_name} ({agent_id}) joined network {self.network_name} ({self.network_id})")
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
            "protocols": {}
        }
        
        for protocol_name, protocol in self.protocols.items():
            if hasattr(protocol, "get_network_state"):
                state["protocols"][protocol_name] = protocol.get_network_state()
        
        return state