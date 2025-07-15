"""
Transport abstraction layer for OpenAgents networking.

This module provides protocol-agnostic transport interfaces and adapters
for different networking protocols (WebSocket, libp2p, gRPC, WebRTC).
"""

from abc import ABC, abstractmethod
from typing import Dict, Any, List, Optional, Callable, Awaitable, Union
import asyncio
import logging
import json
import uuid

from openagents.models.transport import (
    TransportType, ConnectionState, PeerMetadata, 
    ConnectionInfo, TransportMessage, AgentInfo
)

logger = logging.getLogger(__name__)

# Type alias for backward compatibility
Message = TransportMessage

# Export models for convenience
__all__ = [
    "Transport",
    "WebSocketTransport", 
    "LibP2PTransport",
    "GRPCTransport", 
    "WebRTCTransport",
    "TransportManager",
    "Message",
    "TransportMessage",
    "TransportType",
    "ConnectionState", 
    "PeerMetadata",
    "ConnectionInfo",
    "AgentInfo"
]


class Transport(ABC):
    """Abstract base class for transport implementations."""
    
    def __init__(self, transport_type: TransportType, config: Optional[Dict[str, Any]] = None):
        self.transport_type = transport_type
        self.config = config or {}
        self.is_running = False
        self.connections: Dict[str, ConnectionInfo] = {}
        self.message_handlers: List[Callable[[Message], Awaitable[None]]] = []
        self.connection_handlers: List[Callable[[str, ConnectionState], Awaitable[None]]] = []
        self.system_message_handlers: List[Callable[[str, Dict[str, Any], Any], Awaitable[None]]] = []
    
    @abstractmethod
    async def initialize(self) -> bool:
        """Initialize the transport.
        
        Returns:
            bool: True if initialization successful
        """
        pass
    
    @abstractmethod
    async def shutdown(self) -> bool:
        """Shutdown the transport.
        
        Returns:
            bool: True if shutdown successful
        """
        pass
    
    @abstractmethod
    async def connect(self, peer_id: str, address: str) -> bool:
        """Connect to a peer.
        
        Args:
            peer_id: ID of the peer to connect to
            address: Address of the peer
            
        Returns:
            bool: True if connection successful
        """
        pass
    
    @abstractmethod
    async def disconnect(self, peer_id: str) -> bool:
        """Disconnect from a peer.
        
        Args:
            peer_id: ID of the peer to disconnect from
            
        Returns:
            bool: True if disconnection successful
        """
        pass
    
    @abstractmethod
    async def send(self, message: Message) -> bool:
        """Send a message to a peer or broadcast.
        
        Args:
            message: Message to send
            
        Returns:
            bool: True if message sent successfully
        """
        pass
    
    @abstractmethod
    async def listen(self, address: str) -> bool:
        """Start listening for connections.
        
        Args:
            address: Address to listen on
            
        Returns:
            bool: True if listening started successfully
        """
        pass
    
    def register_message_handler(self, handler: Callable[[Message], Awaitable[None]]) -> None:
        """Register a message handler.
        
        Args:
            handler: Handler function for incoming messages
        """
        self.message_handlers.append(handler)
    
    def register_connection_handler(self, handler: Callable[[str, ConnectionState], Awaitable[None]]) -> None:
        """Register a connection state handler.
        
        Args:
            handler: Handler function for connection state changes
        """
        self.connection_handlers.append(handler)
    
    def register_system_message_handler(self, handler: Callable[[str, Dict[str, Any], Any], Awaitable[None]]) -> None:
        """Register a system message handler.
        
        Args:
            handler: Handler function for incoming system messages
        """
        self.system_message_handlers.append(handler)
    
    async def _notify_message_handlers(self, message: Message) -> None:
        """Notify all message handlers of a new message."""
        for handler in self.message_handlers:
            try:
                await handler(message)
            except Exception as e:
                logger.error(f"Error in message handler: {e}")
    
    async def _notify_connection_handlers(self, peer_id: str, state: ConnectionState) -> None:
        """Notify all connection handlers of a state change."""
        for handler in self.connection_handlers:
            try:
                await handler(peer_id, state)
            except Exception as e:
                logger.error(f"Error in connection handler: {e}")
    
    async def _notify_system_message_handlers(self, peer_id: str, message: Dict[str, Any], connection: Any) -> None:
        """Notify all system message handlers of a new system message."""
        for handler in self.system_message_handlers:
            try:
                await handler(peer_id, message, connection)
            except Exception as e:
                logger.error(f"Error in system message handler: {e}")


class WebSocketTransport(Transport):
    """WebSocket transport implementation."""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        super().__init__(TransportType.WEBSOCKET, config)
        self.server = None
        self.client_connections: Dict[str, Any] = {}  # websocket connections
        
    async def initialize(self) -> bool:
        """Initialize WebSocket transport."""
        try:
            import websockets
            self.websockets = websockets
            logger.info("WebSocket transport initialized")
            return True
        except ImportError:
            logger.error("websockets library not available")
            return False
    
    async def shutdown(self) -> bool:
        """Shutdown WebSocket transport."""
        self.is_running = False
        if self.server:
            self.server.close()
            await self.server.wait_closed()
        
        # Close all client connections
        for websocket in self.client_connections.values():
            await websocket.close()
        
        self.client_connections.clear()
        logger.info("WebSocket transport shutdown")
        return True
    
    async def listen(self, address: str) -> bool:
        """Start WebSocket server."""
        try:
            host, port = address.split(":")
            port = int(port)
            
            self.server = await self.websockets.serve(
                self._handle_connection, host, port
            )
            self.is_running = True
            logger.info(f"WebSocket transport listening on {address}")
            return True
        except Exception as e:
            logger.error(f"Failed to start WebSocket server: {e}")
            return False
    
    async def connect(self, peer_id: str, address: str) -> bool:
        """Connect to WebSocket peer."""
        try:
            websocket = await self.websockets.connect(f"ws://{address}")
            self.client_connections[peer_id] = websocket
            
            # Update connection info
            self.connections[peer_id] = ConnectionInfo(
                connection_id=f"ws-{peer_id}",
                peer_id=peer_id,
                transport_type=self.transport_type,
                state=ConnectionState.CONNECTED,
                last_activity=asyncio.get_event_loop().time()
            )
            
            await self._notify_connection_handlers(peer_id, ConnectionState.CONNECTED)
            
            # Start message listener
            asyncio.create_task(self._listen_messages(peer_id, websocket))
            
            logger.info(f"Connected to WebSocket peer {peer_id} at {address}")
            return True
        except Exception as e:
            logger.error(f"Failed to connect to WebSocket peer {peer_id}: {e}")
            return False
    
    async def disconnect(self, peer_id: str) -> bool:
        """Disconnect from WebSocket peer."""
        try:
            if peer_id in self.client_connections:
                await self.client_connections[peer_id].close()
                del self.client_connections[peer_id]
            
            if peer_id in self.connections:
                self.connections[peer_id].state = ConnectionState.DISCONNECTED
                await self._notify_connection_handlers(peer_id, ConnectionState.DISCONNECTED)
            
            logger.info(f"Disconnected from WebSocket peer {peer_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to disconnect from WebSocket peer {peer_id}: {e}")
            return False
    
    async def send(self, message: Message) -> bool:
        """Send message via WebSocket."""
        try:
            message_data = json.dumps(message.model_dump())
            
            if message.target_id:
                # Direct message
                if message.target_id in self.client_connections:
                    await self.client_connections[message.target_id].send(message_data)
                    return True
                else:
                    logger.warning(f"Peer {message.target_id} not connected")
                    return False
            else:
                # Broadcast message
                success = True
                for peer_id, websocket in self.client_connections.items():
                    if peer_id != message.sender_id:  # Don't send to sender
                        try:
                            await websocket.send(message_data)
                        except Exception as e:
                            logger.error(f"Failed to send broadcast to {peer_id}: {e}")
                            success = False
                return success
        except Exception as e:
            logger.error(f"Failed to send message: {e}")
            return False
    
    async def _handle_connection(self, websocket):
        """Handle incoming WebSocket connection."""
        peer_id = f"peer-{uuid.uuid4().hex[:8]}"
        self.client_connections[peer_id] = websocket
        
        try:
            await self._notify_connection_handlers(peer_id, ConnectionState.CONNECTED)
            await self._listen_messages(peer_id, websocket)
        finally:
            if peer_id in self.client_connections:
                del self.client_connections[peer_id]
            await self._notify_connection_handlers(peer_id, ConnectionState.DISCONNECTED)
    
    async def _listen_messages(self, peer_id: str, websocket):
        """Listen for messages from a WebSocket connection."""
        try:
            async for message_data in websocket:
                try:
                    data = json.loads(message_data)
                    
                    # Check if this is a system message (should be handled by network layer)
                    if data.get("type") == "system_request":
                        # Forward system messages to system message handlers
                        await self._notify_system_message_handlers(peer_id, data, websocket)
                        continue
                    
                    # Check if this is a regular message with data wrapper
                    if data.get("type") == "message":
                        # Extract the actual message data from the wrapper
                        message_payload = data.get("data", {})
                        # Parse the inner message data as TransportMessage
                        message = Message(**message_payload)
                        await self._notify_message_handlers(message)
                    else:
                        # Try to parse as TransportMessage directly (for backward compatibility)
                        message = Message(**data)
                        await self._notify_message_handlers(message)
                    
                    # Update last activity
                    if peer_id in self.connections:
                        self.connections[peer_id].last_activity = asyncio.get_event_loop().time()
                        
                except Exception as e:
                    logger.error(f"Error processing message from {peer_id}: {e}")
        except Exception as e:
            logger.error(f"Error listening to messages from {peer_id}: {e}")


class LibP2PTransport(Transport):
    """libp2p transport implementation (placeholder)."""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        super().__init__(TransportType.LIBP2P, config)
    
    async def initialize(self) -> bool:
        """Initialize libp2p transport."""
        # TODO: Implement libp2p integration
        logger.warning("libp2p transport not yet implemented")
        return False
    
    async def shutdown(self) -> bool:
        """Shutdown libp2p transport."""
        # TODO: Implement libp2p shutdown
        return True
    
    async def connect(self, peer_id: str, address: str) -> bool:
        """Connect to libp2p peer."""
        # TODO: Implement libp2p connection
        return False
    
    async def disconnect(self, peer_id: str) -> bool:
        """Disconnect from libp2p peer."""
        # TODO: Implement libp2p disconnection
        return False
    
    async def send(self, message: Message) -> bool:
        """Send message via libp2p."""
        # TODO: Implement libp2p message sending
        return False
    
    async def listen(self, address: str) -> bool:
        """Start libp2p listener."""
        # TODO: Implement libp2p listening
        return False


class GRPCTransport(Transport):
    """gRPC transport implementation (placeholder)."""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        super().__init__(TransportType.GRPC, config)
    
    async def initialize(self) -> bool:
        """Initialize gRPC transport."""
        # TODO: Implement gRPC integration
        logger.warning("gRPC transport not yet implemented")
        return False
    
    async def shutdown(self) -> bool:
        """Shutdown gRPC transport."""
        # TODO: Implement gRPC shutdown
        return True
    
    async def connect(self, peer_id: str, address: str) -> bool:
        """Connect to gRPC peer."""
        # TODO: Implement gRPC connection
        return False
    
    async def disconnect(self, peer_id: str) -> bool:
        """Disconnect from gRPC peer."""
        # TODO: Implement gRPC disconnection
        return False
    
    async def send(self, message: Message) -> bool:
        """Send message via gRPC."""
        # TODO: Implement gRPC message sending
        return False
    
    async def listen(self, address: str) -> bool:
        """Start gRPC listener."""
        # TODO: Implement gRPC listening
        return False


class WebRTCTransport(Transport):
    """WebRTC transport implementation (placeholder)."""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        super().__init__(TransportType.WEBRTC, config)
    
    async def initialize(self) -> bool:
        """Initialize WebRTC transport."""
        # TODO: Implement WebRTC integration
        logger.warning("WebRTC transport not yet implemented")
        return False
    
    async def shutdown(self) -> bool:
        """Shutdown WebRTC transport."""
        # TODO: Implement WebRTC shutdown
        return True
    
    async def connect(self, peer_id: str, address: str) -> bool:
        """Connect to WebRTC peer."""
        # TODO: Implement WebRTC connection
        return False
    
    async def disconnect(self, peer_id: str) -> bool:
        """Disconnect from WebRTC peer."""
        # TODO: Implement WebRTC disconnection
        return False
    
    async def send(self, message: Message) -> bool:
        """Send message via WebRTC."""
        # TODO: Implement WebRTC message sending
        return False
    
    async def listen(self, address: str) -> bool:
        """Start WebRTC listener."""
        # TODO: Implement WebRTC listening
        return False


class TransportManager:
    """Manages multiple transport protocols and handles transport selection."""
    
    def __init__(self):
        self.transports: Dict[TransportType, Transport] = {}
        self.active_transport: Optional[Transport] = None
        self.supported_transports: List[TransportType] = []
    
    def register_transport(self, transport: Transport) -> bool:
        """Register a transport.
        
        Args:
            transport: Transport instance to register
            
        Returns:
            bool: True if registration successful
        """
        self.transports[transport.transport_type] = transport
        if transport.transport_type not in self.supported_transports:
            self.supported_transports.append(transport.transport_type)
        logger.info(f"Registered {transport.transport_type.value} transport")
        return True
    
    async def initialize_transport(self, transport_type: TransportType) -> bool:
        """Initialize and activate a specific transport.
        
        Args:
            transport_type: Type of transport to initialize
            
        Returns:
            bool: True if initialization successful
        """
        if transport_type not in self.transports:
            logger.error(f"Transport {transport_type.value} not registered")
            return False
        
        transport = self.transports[transport_type]
        if await transport.initialize():
            self.active_transport = transport
            logger.info(f"Activated {transport_type.value} transport")
            return True
        else:
            logger.error(f"Failed to initialize {transport_type.value} transport")
            return False
    
    async def shutdown_all(self) -> bool:
        """Shutdown all transports."""
        success = True
        for transport in self.transports.values():
            try:
                await transport.shutdown()
            except Exception as e:
                logger.error(f"Error shutting down {transport.transport_type.value}: {e}")
                success = False
        return success
    
    def get_active_transport(self) -> Optional[Transport]:
        """Get the currently active transport."""
        return self.active_transport
    
    def negotiate_transport(self, peer_transports: List[TransportType]) -> Optional[TransportType]:
        """Negotiate transport with a peer based on supported transports.
        
        Args:
            peer_transports: List of transports supported by peer
            
        Returns:
            Optional[TransportType]: Best transport to use, or None if no match
        """
        # Priority order for transport selection
        priority_order = [
            TransportType.LIBP2P,
            TransportType.WEBRTC,
            TransportType.GRPC,
            TransportType.WEBSOCKET
        ]
        
        for transport_type in priority_order:
            if transport_type in self.supported_transports and transport_type in peer_transports:
                return transport_type
        
        return None 