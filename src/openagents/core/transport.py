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
from openagents.utils.verbose import verbose_print

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
    
    def register_agent_connection_resolver(self, resolver: Callable[[str], Any]) -> None:
        """Register a callback to resolve agent_id to WebSocket connection.
        
        Args:
            resolver: Function that takes agent_id and returns WebSocket connection or None
        """
        self.agent_connection_resolver = resolver
    
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
        self.agent_connection_resolver = None  # callback to resolve agent_id to websocket
        
    async def initialize(self) -> bool:
        """Initialize WebSocket transport."""
        try:
            import websockets
            self.websockets = websockets
            # Extract websocket configuration options
            max_size = self.config.get("max_message_size", 104857600)  # Default 100MB
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
            
            # Extract websocket configuration options
            max_size = self.config.get("max_message_size", 104857600)  # Default 100MB
            
            self.server = await self.websockets.serve(
                self._handle_connection, host, port, max_size=max_size
            )
            self.is_running = True
            logger.info(f"WebSocket transport listening on {address} with max_size={max_size}")
            return True
        except Exception as e:
            logger.error(f"Failed to start WebSocket server: {e}")
            return False
    
    async def connect(self, peer_id: str, address: str) -> bool:
        """Connect to WebSocket peer."""
        try:
            # Extract websocket configuration options
            max_size = self.config.get("max_message_size", 104857600)  # Default 100MB
            
            websocket = await self.websockets.connect(f"ws://{address}", max_size=max_size)
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
            verbose_print(f"🚀 WebSocketTransport.send() called")
            verbose_print(f"   Message type: {type(message).__name__}")
            verbose_print(f"   Message target_id: {message.target_id}")
            verbose_print(f"   Message sender_id: {message.sender_id}")
            verbose_print(f"   Connected clients: {list(self.client_connections.keys())}")
            
            # Wrap message in the format expected by client connectors
            message_payload = {"type": "message", "data": message.model_dump()}
            message_data = json.dumps(message_payload)
            
            # Check for target - could be target_id (generic) or target_agent_id (DirectMessage)
            target = message.target_id or getattr(message, 'target_agent_id', None)
            if target:
                # Direct message - try agent connection resolver first
                verbose_print(f"   📨 Direct message routing to {target}")
                
                # Try agent connection resolver (for agent_id → websocket mapping)
                websocket_connection = None
                if self.agent_connection_resolver:
                    verbose_print(f"   🔍 Using agent connection resolver to find {target}")
                    websocket_connection = self.agent_connection_resolver(target)
                    if websocket_connection:
                        verbose_print(f"   ✅ Found agent connection via resolver")
                
                # Fallback to peer_id mapping (for backward compatibility)
                if not websocket_connection and target in self.client_connections:
                    verbose_print(f"   🔄 Fallback to peer_id mapping")
                    websocket_connection = self.client_connections[target]
                
                if websocket_connection:
                    verbose_print(f"   ✅ Target connection found, sending...")
                    await websocket_connection.send(message_data)
                    verbose_print(f"   ✅ Message sent successfully to {target}")
                    return True
                else:
                    verbose_print(f"   ❌ Target {target} NOT found in connections!")
                    verbose_print(f"   Available peer connections: {list(self.client_connections.keys())}")
                    logger.warning(f"Target {target} not connected")
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
                    verbose_print(f"📨 WebSocket received message from {peer_id}: {message_data[:200]}...")
                    data = json.loads(message_data)
                    verbose_print(f"📦 Parsed data: {data}")
                    
                    # Check if this is a system message (should be handled by network layer)
                    if data.get("type") == "system_request":
                        verbose_print("🔧 Processing system_request message")
                        # Forward system messages to system message handlers
                        await self._notify_system_message_handlers(peer_id, data, websocket)
                        continue
                    
                    # Check if this is a system response (should be handled by network layer)
                    if data.get("type") == "system_response":
                        verbose_print("🔧 Processing system_response message")
                        # Forward system responses to system message handlers
                        await self._notify_system_message_handlers(peer_id, data, websocket)
                        continue
                    
                    # Check if this is a regular message with data wrapper
                    if data.get("type") == "message" or data.get("type") == "event":
                        verbose_print(f"📬 Processing {data.get('type')} with data wrapper")
                        # Extract the actual message data from the wrapper
                        message_payload = data.get("data", {})
                        verbose_print(f"   Message payload: {message_payload}")
                        # Parse the inner message data as TransportMessage
                        message = Message(**message_payload)
                        verbose_print(f"✅ Parsed as Message: {message}")
                        verbose_print(f"🔔 Notifying message handlers... ({len(self.message_handlers)} handlers)")
                        for i, handler in enumerate(self.message_handlers):
                            verbose_print(f"   Handler {i}: {handler}")
                        await self._notify_message_handlers(message)
                        verbose_print(f"✅ Message handlers notified")
                    else:
                        verbose_print(f"🔄 Trying to parse as TransportMessage directly (type: {data.get('type')})")
                        # Try to parse as TransportMessage directly (for backward compatibility)
                        message = Message(**data)
                        verbose_print(f"✅ Parsed as Message: {message}")
                        await self._notify_message_handlers(message)
                    
                    # Update last activity
                    if peer_id in self.connections:
                        self.connections[peer_id].last_activity = asyncio.get_event_loop().time()
                        
                except Exception as e:
                    verbose_print(f"❌ Error processing message from {peer_id}: {e}")
                    import traceback
                    traceback.print_exc()
                    logger.error(f"Error processing message from {peer_id}: {e}")
        except Exception as e:
            verbose_print(f"❌ Error listening to messages from {peer_id}: {e}")
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
    """gRPC transport implementation."""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        super().__init__(TransportType.GRPC, config)
        self.server = None
        self.channels: Dict[str, Any] = {}  # peer_id -> gRPC channel
        self.stubs: Dict[str, Any] = {}    # peer_id -> gRPC stub
        self.streaming_calls: Dict[str, Any] = {}  # peer_id -> streaming call
        self.servicer = None
        self.http_adapter = None
        self.http_runner = None
        self.network_instance = None  # Reference to the network instance
    
    def set_network_instance(self, network_instance):
        """Set the network instance reference for system command handling."""
        self.network_instance = network_instance
        
    async def initialize(self) -> bool:
        """Initialize gRPC transport."""
        try:
            import grpc
            from grpc import aio
            from openagents.proto.agent_service_pb2_grpc import (
                AgentServiceServicer, AgentServiceStub, 
                add_AgentServiceServicer_to_server
            )
            
            self.grpc = grpc
            self.aio = aio
            self.AgentServiceServicer = AgentServiceServicer
            self.AgentServiceStub = AgentServiceStub
            self.add_AgentServiceServicer_to_server = add_AgentServiceServicer_to_server
            
            logger.info("gRPC transport initialized")
            return True
        except ImportError as e:
            logger.error(f"gRPC libraries not available: {e}")
            return False
    
    async def shutdown(self) -> bool:
        """Shutdown gRPC transport."""
        self.is_running = False
        
        # Close all streaming calls
        for call in self.streaming_calls.values():
            try:
                call.cancel()
            except:
                pass
        
        # Close all channels
        for channel in self.channels.values():
            try:
                await channel.close()
            except:
                pass
        
        # Stop HTTP adapter
        if self.http_runner:
            await self.http_runner.cleanup()
            self.http_runner = None
        
        # Stop server
        if self.server:
            await self.server.stop(grace=5)
        
        self.channels.clear()
        self.stubs.clear()
        self.streaming_calls.clear()
        
        logger.info("gRPC transport shutdown")
        return True
    
    async def connect(self, peer_id: str, address: str) -> bool:
        """Connect to gRPC peer."""
        try:
            # Create gRPC channel with configuration
            options = [
                ('grpc.keepalive_time_ms', self.config.get('keepalive_time', 60) * 1000),  # Default 60 seconds
                ('grpc.keepalive_timeout_ms', self.config.get('keepalive_timeout', 30) * 1000),  # Default 30 seconds
                ('grpc.keepalive_permit_without_calls', self.config.get('keepalive_permit_without_calls', False)),  # Default False
                ('grpc.http2_max_pings_without_data', self.config.get('http2_max_pings_without_data', 0)),
                ('grpc.http2_min_time_between_pings_ms', self.config.get('http2_min_time_between_pings', 60) * 1000),
                ('grpc.http2_min_ping_interval_without_data_ms', self.config.get('http2_min_ping_interval_without_data', 300) * 1000),
                ('grpc.max_receive_message_length', self.config.get('max_message_size', 104857600)),
                ('grpc.max_send_message_length', self.config.get('max_message_size', 104857600)),
            ]
            
            compression = self.config.get('compression')
            if compression == 'gzip':
                options.append(('grpc.default_compression_algorithm', self.grpc.Compression.Gzip))
            
            channel = self.aio.insecure_channel(address, options=options)
            stub = self.AgentServiceStub(channel)
            
            # Test connection with ping
            from openagents.proto.agent_service_pb2 import PingRequest
            import time
            ping_request = PingRequest(agent_id=peer_id, timestamp=self._to_timestamp(time.time()))
            
            try:
                response = await stub.Ping(ping_request, timeout=5)
                if response.success:
                    self.channels[peer_id] = channel
                    self.stubs[peer_id] = stub
                    
                    # Update connection info
                    self.connections[peer_id] = ConnectionInfo(
                        connection_id=f"grpc-{peer_id}",
                        peer_id=peer_id,
                        transport_type=self.transport_type,
                        state=ConnectionState.CONNECTED,
                        last_activity=asyncio.get_event_loop().time()
                    )
                    
                    await self._notify_connection_handlers(peer_id, ConnectionState.CONNECTED)
                    logger.info(f"Connected to gRPC peer {peer_id} at {address}")
                    return True
                else:
                    await channel.close()
                    return False
            except Exception as e:
                await channel.close()
                logger.error(f"Failed to ping gRPC peer {peer_id}: {e}")
                return False
                
        except Exception as e:
            logger.error(f"Failed to connect to gRPC peer {peer_id}: {e}")
            return False
    
    async def disconnect(self, peer_id: str) -> bool:
        """Disconnect from gRPC peer."""
        try:
            # Cancel streaming call if exists
            if peer_id in self.streaming_calls:
                self.streaming_calls[peer_id].cancel()
                del self.streaming_calls[peer_id]
            
            # Close channel
            if peer_id in self.channels:
                await self.channels[peer_id].close()
                del self.channels[peer_id]
            
            # Remove stub
            if peer_id in self.stubs:
                del self.stubs[peer_id]
            
            # Update connection info
            if peer_id in self.connections:
                del self.connections[peer_id]
            
            await self._notify_connection_handlers(peer_id, ConnectionState.DISCONNECTED)
            logger.info(f"Disconnected from gRPC peer {peer_id}")
            return True
            
        except Exception as e:
            logger.error(f"Error disconnecting from gRPC peer {peer_id}: {e}")
            return False
    
    async def send(self, message: Message) -> bool:
        """Send message via gRPC."""
        try:
            # Convert to gRPC message
            grpc_message = self._to_grpc_message(message)
            
            # For gRPC transport, we handle messages through the message handlers
            # rather than direct peer-to-peer connections like WebSocket
            
            # Notify local message handlers (for mod processing)
            await self._notify_message_handlers(message)
            
            # For now, always return success for local message handling
            # In a full implementation, this would route to other gRPC nodes
            return True
                    
        except Exception as e:
            logger.error(f"Failed to send gRPC message: {e}")
            return False
    
    async def listen(self, address: str) -> bool:
        """Start gRPC listener."""
        try:
            host, port = address.split(":")
            port = int(port)
            
            # Create gRPC server
            self.server = self.aio.server()
            
            # Create and add servicer
            self.servicer = GRPCAgentServicer(self)
            self.add_AgentServiceServicer_to_server(self.servicer, self.server)
            
            # Add port
            listen_addr = f"{host}:{port}"
            self.server.add_insecure_port(listen_addr)
            
            # Start server
            await self.server.start()
            self.is_running = True
            
            # Start HTTP adapter for browser compatibility
            from .grpc_http_adapter import GRPCHTTPAdapter
            self.http_adapter = GRPCHTTPAdapter(self)
            self.http_runner = await self.http_adapter.start_server(host, port)
            
            logger.info(f"gRPC transport listening on {listen_addr}")
            logger.info(f"gRPC HTTP adapter listening on {host}:{port + 1000}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to start gRPC server: {e}")
            return False
    
    def _to_grpc_message(self, message: Message):
        """Convert transport message to gRPC message."""
        from openagents.proto.agent_service_pb2 import Message as GRPCMessage
        from google.protobuf.any_pb2 import Any
        import json
        
        # Convert payload to Any
        payload_any = Any()
        payload_any.type_url = "type.googleapis.com/openagents.Payload"
        # Make payload JSON serializable before encoding
        serializable_payload = self._make_json_serializable(message.payload)
        payload_any.value = json.dumps(serializable_payload).encode('utf-8')
        
        return GRPCMessage(
            message_id=message.message_id,
            sender_id=message.sender_id,
            target_id=message.target_id or "",
            message_type=message.message_type,
            payload=payload_any,
            timestamp=self._to_timestamp(message.timestamp),
            metadata=message.metadata or {}
        )
    
    def _from_grpc_message(self, grpc_message) -> Message:
        """Convert gRPC message to transport message."""
        import json
        
        # Extract payload from Any
        payload = {}
        if grpc_message.payload:
            try:
                # Try to unpack as protobuf Struct first (from gRPC connector)
                from google.protobuf.struct_pb2 import Struct
                struct = Struct()
                if grpc_message.payload.Unpack(struct):
                    # Convert Struct to dict
                    payload = dict(struct)
                else:
                    # Fallback to JSON decoding (for other sources)
                    payload = json.loads(grpc_message.payload.value.decode('utf-8'))
            except Exception as e:
                logger.debug(f"Failed to deserialize gRPC payload: {e}")
                payload = {}
        
        return Message(
            message_id=grpc_message.message_id,
            sender_id=grpc_message.sender_id,
            target_id=grpc_message.target_id if grpc_message.target_id else None,
            message_type=grpc_message.message_type,
            payload=payload,
            timestamp=self._from_timestamp(grpc_message.timestamp),
            metadata=dict(grpc_message.metadata) if grpc_message.metadata else {}
        )
    
    def _to_timestamp(self, timestamp: float):
        """Convert float timestamp to protobuf timestamp."""
        from google.protobuf.timestamp_pb2 import Timestamp
        ts = Timestamp()
        try:
            # Handle both seconds and milliseconds timestamps
            if timestamp > 1e10:  # Likely milliseconds, convert to seconds
                timestamp = timestamp / 1000.0
            ts.FromSeconds(int(timestamp))
            # Set nanoseconds for the fractional part
            nanos = int((timestamp - int(timestamp)) * 1e9)
            ts.nanos = nanos
        except Exception as e:
            logger.warning(f"Invalid timestamp {timestamp}, using current time: {e}")
            ts.GetCurrentTime()
        return ts
    
    def _from_timestamp(self, timestamp) -> float:
        """Convert protobuf timestamp to float."""
        return timestamp.ToSeconds()
    
    def _make_json_serializable(self, obj):
        """Convert an object to be JSON serializable, handling gRPC types."""
        import json
        from google.protobuf.struct_pb2 import ListValue, Struct
        from google.protobuf.message import Message
        
        if isinstance(obj, dict):
            return {k: self._make_json_serializable(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [self._make_json_serializable(item) for item in obj]
        elif isinstance(obj, ListValue):
            return [self._make_json_serializable(item) for item in obj]
        elif isinstance(obj, Struct):
            return dict(obj)
        elif isinstance(obj, Message):
            # Convert protobuf message to dict
            from google.protobuf.json_format import MessageToDict
            return MessageToDict(obj)
        elif hasattr(obj, '__dict__'):
            # Handle custom objects by converting to dict
            try:
                return {k: self._make_json_serializable(v) for k, v in obj.__dict__.items()}
            except:
                return str(obj)
        else:
            # Try to serialize directly, fallback to string representation
            try:
                json.dumps(obj)
                return obj
            except (TypeError, ValueError):
                return str(obj)


class GRPCAgentServicer:
    """gRPC servicer implementation for AgentService."""
    
    def __init__(self, transport: GRPCTransport):
        self.transport = transport
    
    async def SendMessage(self, request, context):
        """Handle SendMessage RPC."""
        try:
            # Convert gRPC message to transport message
            message = self.transport._from_grpc_message(request)
            
            # Notify message handlers
            await self.transport._notify_message_handlers(message)
            
            # Create response
            from openagents.proto.agent_service_pb2 import MessageResponse
            return MessageResponse(
                success=True,
                message_id=request.message_id
            )
            
        except Exception as e:
            logger.error(f"Error handling SendMessage: {e}")
            from openagents.proto.agent_service_pb2 import MessageResponse
            return MessageResponse(
                success=False,
                error_message=str(e),
                message_id=request.message_id
            )
    
    async def RegisterAgent(self, request, context):
        """Handle RegisterAgent RPC."""
        try:
            # Extract peer address
            peer_address = context.peer()
            
            # Notify system message handlers
            system_message = {
                "command": "register_agent",
                "data": {
                    "agent_id": request.agent_id,
                    "metadata": dict(request.metadata),
                    "capabilities": list(request.capabilities),
                    "force_reconnect": True  # Allow reconnection for gRPC agents
                }
            }
            
            # Create a mock connection for gRPC system commands
            class MockGRPCConnection:
                def __init__(self, context):
                    self.context = context
                    
                async def send(self, data):
                    # For gRPC, we don't send responses back through the connection
                    # The response is handled by the gRPC return value
                    pass
                    
                def peer(self):
                    return self.context.peer() if hasattr(self.context, 'peer') else "grpc-client"
            
            mock_connection = MockGRPCConnection(context)
            await self.transport._notify_system_message_handlers(
                request.agent_id, system_message, mock_connection
            )
            
            from openagents.proto.agent_service_pb2 import RegisterAgentResponse
            return RegisterAgentResponse(
                success=True,
                network_name="OpenAgents Network",
                network_id="grpc-network"
            )
            
        except Exception as e:
            logger.error(f"Error handling RegisterAgent: {e}")
            from openagents.proto.agent_service_pb2 import RegisterAgentResponse
            return RegisterAgentResponse(
                success=False,
                error_message=str(e)
            )
    
    async def Ping(self, request, context):
        """Handle Ping RPC."""
        try:
            from openagents.proto.agent_service_pb2 import PingResponse
            import time
            
            return PingResponse(
                success=True,
                timestamp=self.transport._to_timestamp(time.time())
            )
            
        except Exception as e:
            logger.error(f"Error handling Ping: {e}")
            from openagents.proto.agent_service_pb2 import PingResponse
            return PingResponse(success=False)
    
    async def UnregisterAgent(self, request, context):
        """Handle UnregisterAgent RPC."""
        try:
            from openagents.proto.agent_service_pb2 import UnregisterAgentResponse
            return UnregisterAgentResponse(success=True)
        except Exception as e:
            logger.error(f"Error handling UnregisterAgent: {e}")
            from openagents.proto.agent_service_pb2 import UnregisterAgentResponse
            return UnregisterAgentResponse(success=False, error_message=str(e))
    
    async def DiscoverAgents(self, request, context):
        """Handle DiscoverAgents RPC."""
        try:
            from openagents.proto.agent_service_pb2 import DiscoverAgentsResponse, AgentInfo
            
            # Get agents from the network instance
            agents = []
            if hasattr(self.transport, 'network_instance') and self.transport.network_instance:
                network = self.transport.network_instance
                for agent_id, metadata in network.agents.items():
                    agent_info = AgentInfo(
                        agent_id=agent_id,
                        metadata=metadata,
                        capabilities=metadata.get('capabilities', []),
                        transport_type="grpc",
                        address=f"{network.host}:{network.port}"
                    )
                    agents.append(agent_info)
            
            return DiscoverAgentsResponse(agents=agents)
        except Exception as e:
            logger.error(f"Error handling DiscoverAgents: {e}")
            from openagents.proto.agent_service_pb2 import DiscoverAgentsResponse
            return DiscoverAgentsResponse(agents=[])
    
    async def GetAgentInfo(self, request, context):
        """Handle GetAgentInfo RPC."""
        try:
            from openagents.proto.agent_service_pb2 import GetAgentInfoResponse
            return GetAgentInfoResponse(found=False)
        except Exception as e:
            logger.error(f"Error handling GetAgentInfo: {e}")
            from openagents.proto.agent_service_pb2 import GetAgentInfoResponse
            return GetAgentInfoResponse(found=False)
    
    async def SendSystemCommand(self, request, context):
        """Handle SendSystemCommand RPC."""
        try:
            from openagents.proto.agent_service_pb2 import SystemCommandResponse
            import json
            
            # Extract command and data from the request
            command = request.command
            data = {}
            if request.data:
                try:
                    # Try to parse the data from Any type
                    data = json.loads(request.data.value.decode('utf-8'))
                except:
                    data = {}
            
            # Forward to network instance system message handler
            response_data = {}
            if hasattr(self.transport, 'network_instance') and self.transport.network_instance:
                system_message = {
                    "command": command,
                    "data": data
                }
                
                # Create a mock connection for gRPC system commands that captures responses
                class MockGRPCConnection:
                    def __init__(self, context):
                        self.context = context
                        self.response_data = {}
                        
                    async def send(self, data):
                        # Capture the response data for gRPC return
                        try:
                            import json
                            response = json.loads(data) if isinstance(data, str) else data
                            self.response_data = response
                        except:
                            self.response_data = {"raw_data": data}
                        
                    def peer(self):
                        return self.context.peer() if hasattr(self.context, 'peer') else "grpc-client"
                
                mock_connection = MockGRPCConnection(context)
                await self.transport.network_instance._handle_system_message(
                    "system", system_message, mock_connection
                )
                response_data = mock_connection.response_data
            
            # Serialize response data to Any field
            from google.protobuf.any_pb2 import Any
            response_any = Any()
            response_any.type_url = "type.googleapis.com/openagents.SystemCommandResponse"
            response_any.value = json.dumps(response_data).encode('utf-8')
            
            return SystemCommandResponse(
                success=True,
                data=response_any,
                request_id=request.request_id
            )
        except Exception as e:
            logger.error(f"Error handling SendSystemCommand: {e}")
            from openagents.proto.agent_service_pb2 import SystemCommandResponse
            return SystemCommandResponse(success=False, error_message=str(e))
    
    async def GetNetworkInfo(self, request, context):
        """Handle GetNetworkInfo RPC."""
        try:
            from openagents.proto.agent_service_pb2 import NetworkInfoResponse, AgentInfo
            import time
            
            # Get real network info from the network instance
            agents = []
            agent_count = 0
            network_id = "grpc-network"
            network_name = "OpenAgents gRPC Network"
            
            if hasattr(self.transport, 'network_instance') and self.transport.network_instance:
                network = self.transport.network_instance
                network_id = getattr(network, 'network_id', network_id)
                network_name = getattr(network, 'network_name', network_name)
                agent_count = len(network.agents)
                
                for agent_id, metadata in network.agents.items():
                    agent_info = AgentInfo(
                        agent_id=agent_id,
                        metadata=metadata,
                        capabilities=metadata.get('capabilities', []),
                        transport_type="grpc",
                        address=f"{network.host}:{network.port}"
                    )
                    agents.append(agent_info)
            
            return NetworkInfoResponse(
                network_id=network_id,
                network_name=network_name,
                is_running=True,
                uptime_seconds=int(time.time()),
                agent_count=agent_count,
                agents=agents,
                topology_mode="centralized",
                transport_type="grpc",
                host="0.0.0.0",
                port=50051
            )
        except Exception as e:
            logger.error(f"Error handling GetNetworkInfo: {e}")
            from openagents.proto.agent_service_pb2 import NetworkInfoResponse
            return NetworkInfoResponse(
                network_id="error",
                network_name="Error",
                is_running=False,
                uptime_seconds=0,
                agent_count=0,
                agents=[],
                topology_mode="unknown",
                transport_type="grpc",
                host="0.0.0.0",
                port=50051
            )

    async def StreamMessages(self, request_iterator, context):
        """Handle bidirectional streaming."""
        try:
            # This would implement bidirectional streaming for real-time communication
            # For now, we'll use unary calls for simplicity
            async for request in request_iterator:
                message = self.transport._from_grpc_message(request)
                await self.transport._notify_message_handlers(message)
                
                # Echo back for now
                yield request
                
        except Exception as e:
            logger.error(f"Error in StreamMessages: {e}")


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
            TransportType.GRPC,
            TransportType.LIBP2P,
            TransportType.WEBRTC,
            TransportType.WEBSOCKET
        ]
        
        for transport_type in priority_order:
            if transport_type in self.supported_transports and transport_type in peer_transports:
                return transport_type
        
        return None 