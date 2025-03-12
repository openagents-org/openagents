from typing import Dict, Any, List, Optional, Set, Type
import uuid
import logging
from .agent_protocol_base import AgentProtocolBase
import json
import asyncio
import websockets
from openagents.models.messages import SimpleMessage, BaseMessage

logger = logging.getLogger(__name__)


class AgentAdapter:
    """Core agent implementation for OpenAgents.
    
    An agent that can connect to a network server and communicate with other agents.
    """
    
    def __init__(self, name: Optional[str] = None, protocols: Optional[List[AgentProtocolBase]] = None):
        """Initialize an agent.
        
        Args:
            name: Optional human-readable name for the agent
            protocols: Optional list of protocol instances to register with the agent
        """
        self.agent_id = str(uuid.uuid4())
        self.name = name or f"Agent-{self.agent_id[:8]}"
        self.protocols = {}
        self.connection = None
        self.is_connected = False
        
        # Register protocols if provided
        if protocols:
            for protocol in protocols:
                self.register_protocol(protocol)
    
    async def connect_to_server(self, host: str, port: int) -> bool:
        """Connect to a network server.
        
        Args:
            host: Server host address
            port: Server port
            
        Returns:
            bool: True if connection successful
        """
        try:
            self.connection = await websockets.connect(f"ws://{host}:{port}")
            
            # Get agent metadata including protocols and capabilities
            metadata = self.get_metadata()
            
            # Register with server
            await self.connection.send(json.dumps({
                "type": "register",
                "agent_id": self.agent_id,
                "metadata": metadata
            }))
            
            # Wait for registration response
            response = await self.connection.recv()
            data = json.loads(response)
            
            if data.get("type") == "register_response" and data.get("success"):
                self.is_connected = True
                logger.info(f"Connected to network: {data.get('network_name')}")
                
                # Start message listener
                asyncio.create_task(self._listen_for_messages())
                return True
            
            await self.connection.close()
            return False
            
        except Exception as e:
            logger.error(f"Connection error: {e}")
            return False
    
    async def disconnect(self):
        """Disconnect from the network server."""
        if self.connection:
            try:
                await self.connection.close()
                self.connection = None
                self.is_connected = False
                logger.info(f"Agent {self.name} ({self.agent_id}) disconnected from network")
                return True
            except Exception as e:
                logger.error(f"Error disconnecting: {e}")
                return False
        return False
    
    async def _listen_for_messages(self):
        """Listen for messages from the server."""
        try:
            while self.is_connected:
                message = await self.connection.recv()
                data = json.loads(message)
                message_type = data.get("type")
                
                if message_type == "message":
                    # Extract the original message from the content
                    content = data.get("content", {})
                    original_protocol = content.get("original_protocol")
                    payload = content.get("payload", {})
                    
                    logger.debug(f"Received message from {data.get('source_agent_id')} with ID {content.get('original_message_id')}")
                    
                    # Route message to appropriate protocol based on the original protocol
                    for protocol in self.protocols.values():
                        if hasattr(protocol, "handle_message") and (
                            not original_protocol or  # If no protocol specified, send to all
                            protocol.protocol == original_protocol  # Send to matching protocol
                        ):
                            await protocol.handle_message(payload)
                
                elif message_type == "broadcast":
                    # Extract the original message from the content
                    content = data.get("content", {})
                    original_protocol = content.get("original_protocol")
                    payload = content.get("payload", {})
                    
                    logger.debug(f"Received broadcast from {data.get('source_agent_id')} with ID {content.get('original_message_id')}")
                    
                    # Route broadcast to appropriate protocol based on the original protocol
                    for protocol in self.protocols.values():
                        if hasattr(protocol, "handle_broadcast") and (
                            not original_protocol or  # If no protocol specified, send to all
                            protocol.protocol == original_protocol  # Send to matching protocol
                        ):
                            await protocol.handle_broadcast(payload)
                        
        except websockets.exceptions.ConnectionClosed:
            self.is_connected = False
            logger.info("Disconnected from server")
    
    def register_protocol(self, protocol_instance: AgentProtocolBase) -> bool:
        """Register a protocol with this agent.
        
        Args:
            protocol_instance: An instance of an agent protocol
            
        Returns:
            bool: True if registration was successful, False otherwise
        """
        protocol_name = protocol_instance.__class__.__name__
        if protocol_name in self.protocols:
            logger.warning(f"Protocol {protocol_name} already registered with agent {self.agent_id}")
            return False
        
        self.protocols[protocol_name] = protocol_instance
        logger.info(f"Registered protocol {protocol_name} with agent {self.agent_id}")
        return True
    
    def unregister_protocol(self, protocol_name: str) -> bool:
        """Unregister a protocol from this agent.
        
        Args:
            protocol_name: Name of the protocol to unregister
            
        Returns:
            bool: True if unregistration was successful, False otherwise
        """
        if protocol_name not in self.protocols:
            logger.warning(f"Protocol {protocol_name} not registered with agent {self.agent_id}")
            return False
        
        protocol = self.protocols.pop(protocol_name)
        logger.info(f"Unregistered protocol {protocol_name} from agent {self.agent_id}")
        return True
    
    def get_capabilities(self) -> Set[str]:
        """Get all capabilities of this agent across all protocols.
        
        Returns:
            Set[str]: Set of capability identifiers
        """
        return set(protocol.capabilities for protocol in self.protocols.values())
    
    def get_state(self) -> Dict[str, Any]:
        """Get the current state of this agent across all protocols.
        
        Returns:
            Dict[str, Any]: Current agent state
        """
        state = {
            "agent_id": self.agent_id,
            "name": self.name,
            "is_connected": self.is_connected,
            "capabilities": list(self.get_capabilities()),
            "protocols": {}
        }
        
        for protocol_name, protocol in self.protocols.items():
            state["protocols"][protocol_name] = protocol.get_agent_state()
        
        return state
    
    def get_metadata(self) -> Dict[str, Any]:
        """Get metadata about this agent.
        
        Returns:
            Dict[str, Any]: Agent metadata including capabilities and services
        """
        metadata = {
            "name": self.name,
            "agent_id": self.agent_id,
            "capabilities": list(self.get_capabilities()),
            "protocols": list(self.protocols.keys()),
            "is_connected": self.is_connected
        }
        
        # Add services if using DiscoveryAgentProtocol
        if "DiscoveryAgentProtocol" in self.protocols:
            discovery_protocol = self.protocols["DiscoveryAgentProtocol"]
            if hasattr(discovery_protocol, "services"):
                metadata["services"] = list(discovery_protocol.services.keys())
        
        return metadata
    
    async def send_message(self, target_agent_id: str, message: BaseMessage) -> bool:
        """Send a message to another agent.
        
        Args:
            target_agent_id: ID of the target agent
            message: Message to send (must be a BaseMessage instance)
            
        Returns:
            bool: True if message sent successfully, False otherwise
        """
        if not self.is_connected:
            logger.warning(f"Agent {self.agent_id} is not connected to a network")
            return False
            
        try:
            # Send the message
            await self.connection.send(json.dumps({
                "type": "message",
                "source_agent_id": self.agent_id,
                "target_agent_id": target_agent_id,
                "content": {
                    "original_message_id": message.message_id,
                    "original_protocol": message.protocol,
                    "payload": message.dict()
                }
            }))
            
            logger.debug(f"Message sent to {target_agent_id}: {message.message_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to send message: {e}")
            return False
    
    async def broadcast_message(self, message: BaseMessage) -> bool:
        """Broadcast a message to all agents in the network.
        
        Args:
            message: Message to broadcast (must be a BaseMessage instance)
            
        Returns:
            bool: True if broadcast was successful, False otherwise
        """
        if not self.is_connected:
            logger.warning(f"Agent {self.agent_id} is not connected to a network")
            return False
            
        try:
            # Send the broadcast message
            await self.connection.send(json.dumps({
                "type": "broadcast",
                "source_agent_id": self.agent_id,
                "message_type": message.protocol,
                "content": {
                    "original_message_id": message.message_id,
                    "original_protocol": message.protocol,
                    "payload": message.dict()
                }
            }))
            
            logger.debug(f"Broadcast message sent: {message.message_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to broadcast message: {e}")
            return False
    
    async def send_simple_message(self, target_agent_id: str, message_type: str, content: Dict[str, Any]) -> bool:
        """Send a simple message to another agent.
        
        This is a convenience method that creates a SimpleMessage and sends it.
        
        Args:
            target_agent_id: ID of the target agent
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
        return await self.send_message(target_agent_id, message)
    
    async def broadcast_simple_message(self, message_type: str, content: Dict[str, Any]) -> bool:
        """Broadcast a simple message to all agents in the network.
        
        This is a convenience method that creates a SimpleMessage and broadcasts it.
        
        Args:
            message_type: Type of the message
            content: Message content
            
        Returns:
            bool: True if broadcast was successful, False otherwise
        """
        # Create a simple message
        message = SimpleMessage(
            message_type=message_type,
            content=content
        )
        
        # Broadcast the message
        return await self.broadcast_message(message) 