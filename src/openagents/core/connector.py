from typing import Dict, Any, Optional, Callable, Awaitable
import logging
import json
import asyncio
import websockets
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed
from openagents.utils.message_util import parse_message_dict
from openagents.models.messages import BaseMessage, BroadcastMessage, DirectMessage, ProtocolMessage

logger = logging.getLogger(__name__)

class NetworkConnector:
    """Handles network connections and message passing for agents.
    
    Responsible for establishing connections to network servers and
    handling message sending/receiving.
    """
    
    def __init__(self, host: str, port: int, agent_id: str, metadata: Optional[Dict[str, Any]] = None):
        """Initialize a network connector.
        
        Args:
            host: Server host address
            port: Server port
            metadata: Agent metadata to send during registration
        """
        self.host = host
        self.port = port
        self.agent_id = agent_id
        self.metadata = metadata
        self.connection = None
        self.is_connected = False
        self.message_handlers = {}
    
    async def connect_to_server(self) -> bool:
        """Connect to a network server.
        
        Args:
            host: Server host address
            port: Server port
            metadata: Agent metadata to send during registration
            
        Returns:
            bool: True if connection successful
        """
        try:
            self.connection = await connect(f"ws://{self.host}:{self.port}")
            
            # Register with server
            await self.connection.send(json.dumps({
                "type": "openagents_register",
                "agent_id": self.agent_id,
                "metadata": self.metadata
            }))
            
            # Wait for registration response
            response = await self.connection.recv()
            data = json.loads(response)
            
            if data.get("type") == "openagents_register_response" and data.get("success"):
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
    
    async def disconnect(self) -> bool:
        """Disconnect from the network server.
        
        Returns:
            bool: True if disconnection was successful
        """
        if self.connection:
            try:
                await self.connection.close()
                self.connection = None
                self.is_connected = False
                logger.info(f"Agent {self.agent_id} disconnected from network")
                return True
            except Exception as e:
                logger.error(f"Error disconnecting: {e}")
                return False
        return False
    
    def register_message_handler(self, message_type: str, handler: Callable[[str, Dict[str, Any]], Awaitable[None]]) -> None:
        """Register a handler for a specific message type.
        
        Args:
            message_type: Type of message to handle
            handler: Async function to call when message is received
        """
        self.message_handlers[message_type] = handler
        logger.debug(f"Registered handler for message type: {message_type}")
    
    async def _listen_for_messages(self) -> None:
        """Listen for messages from the server."""
        try:
            while self.is_connected:
                message = await self.connection.recv()
                data = json.loads(message).get("data", {})
                message_obj = parse_message_dict(data)
                
                logger.debug(f"Received message from {message_obj.sender_id} with ID {message_obj.message_id}")
                
                # Call the appropriate message handler
                await self.consume_message(message_obj)
            

        except ConnectionClosed:
            self.is_connected = False
            logger.info("Disconnected from server")
        except Exception as e:
            logger.error(f"Error in message listener: {e}")
            self.is_connected = False
    
    async def consume_message(self, message: BaseMessage) -> None:
        """Consume a message on the agent side.
        
        Args:
            message: Message to consume
        """
        if isinstance(message, ProtocolMessage):
            message.direction = "inbound"
            message.relevant_agent_id = self.agent_id
            
        message_type = message.message_type
        if message_type in self.message_handlers:
            await self.message_handlers[message_type](message)
    
    async def send_message(self, message: BaseMessage) -> bool:
        """Send a message to another agent.
        
        Args:
            message: Message to send (must be a BaseMessage instance)
            
        Returns:
            bool: True if message sent successfully, False otherwise
        """
        if not self.is_connected:
            logger.warning(f"Agent {self.agent_id} is not connected to a network")
            return False
            
        try:
            # Ensure sender_id is set
            if not message.sender_id:
                message.sender_id = self.agent_id
            
            if isinstance(message, ProtocolMessage):
                message.direction = "outbound"
                message.relevant_agent_id = self.agent_id
                
            # Send the message
            await self.connection.send(json.dumps({
                "type": "message",
                "data": message.model_dump()
            }))
            
            logger.debug(f"Message sent: {message.message_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to send message: {e}")
            return False
    
    async def send_direct_message(self, message: DirectMessage) -> bool:
        """Send a direct message to another agent.
        
        Args:
            message: Direct message to send
        """
        return await self.send_message(message)
    
    async def send_broadcast_message(self, message: BroadcastMessage) -> bool:
        """Send a broadcast message to all connected agents.
        
        Args:
            message: Broadcast message to send

        Returns:
            bool: True if message sent successfully, False otherwise
        """
        return await self.send_message(message)
    
    async def send_protocol_message(self, message: ProtocolMessage) -> bool:
        """Send a protocol message to another agent.
        
        Args:
            message: Protocol message to send
        """
        return await self.send_message(message)