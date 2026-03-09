"""
WebSocket Transport Implementation for OpenAgents.

This module provides the WebSocket transport implementation for agent communication.
"""

import asyncio
import json
import logging
import uuid
from typing import Dict, Any, Optional

from .base import Transport
from openagents.models.transport import TransportType, ConnectionState, ConnectionInfo
from openagents.models.event import Event

logger = logging.getLogger(__name__)


class WebSocketTransport(Transport):
    """WebSocket transport implementation."""

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        super().__init__(TransportType.WEBSOCKET, config)
        self.server = None
        self.websockets = {}
        self.client_connections = {}  # For backward compatibility
        self.agent_connection_resolver = (
            None  # Callback to resolve agent_id to websocket
        )
        self.is_running = False  # Track running state
        self.host = self.config.get("host", "localhost")
        self.port = self.config.get("port", 8765)
        self.max_size = self.config.get("max_size", 10 * 1024 * 1024)  # 10MB default

    async def initialize(self) -> bool:
        """Initialize WebSocket transport."""
        try:
            # Import websockets here to avoid dependency if not used
            import websockets

            self.websockets_lib = websockets
            self.is_initialized = True
            self.is_running = True
            logger.info("WebSocket transport initialized")
            return True
        except ImportError:
            logger.error("websockets library not installed")
            return False

    async def shutdown(self) -> bool:
        """Shutdown WebSocket transport."""
        try:
            self.is_running = False
            if self.server:
                self.server.close()
                await self.server.wait_closed()
                logger.info("WebSocket server shutdown")

            # Close all client connections
            for websocket in self.websockets.values():
                await websocket.close()
            self.websockets.clear()
            self.client_connections.clear()
            self.peer_connections.clear()

            self.is_initialized = False
            return True
        except Exception as e:
            logger.error(f"Error shutting down WebSocket transport: {e}")
            return False

    async def connect(self, peer_id: str, address: str) -> bool:
        """Connect to a WebSocket peer."""
        try:
            websocket = await self.websockets_lib.connect(
                f"ws://{address}", max_size=self.max_size
            )
            self.websockets[peer_id] = websocket
            self.peer_connections[peer_id] = ConnectionInfo(
                connection_id=peer_id,
                peer_id=peer_id,
                address=address,
                state=ConnectionState.CONNECTED,
                transport_type=TransportType.WEBSOCKET,
            )

            # Start message handling for this connection
            asyncio.create_task(self._handle_connection(peer_id, websocket))
            logger.info(f"Connected to WebSocket peer {peer_id} at {address}")
            return True
        except Exception as e:
            logger.error(f"Failed to connect to WebSocket peer {peer_id}: {e}")
            return False

    async def disconnect(self, peer_id: str) -> bool:
        """Disconnect from a WebSocket peer."""
        try:
            if peer_id in self.websockets:
                websocket = self.websockets[peer_id]
                await websocket.close()
                del self.websockets[peer_id]

            if peer_id in self.peer_connections:
                del self.peer_connections[peer_id]

            logger.info(f"Disconnected from WebSocket peer {peer_id}")
            return True
        except Exception as e:
            logger.error(f"Error disconnecting from peer {peer_id}: {e}")
            return False

    async def peer_connect(self, peer_id: str, address: str) -> bool:
        """Connect to a peer (alias for connect method)."""
        return await self.connect(peer_id, address)

    async def peer_disconnect(self, peer_id: str) -> bool:
        """Disconnect from a peer (alias for disconnect method)."""
        return await self.disconnect(peer_id)

    async def send(self, message: Event) -> bool:
        """Send event via WebSocket."""
        try:
            # Convert message to JSON in client-expected format
            message_data = {
                "event_name": message.event_name,
                "source_id": message.source_id,
                "target_agent_id": message.destination_id,
                "payload": message.payload,
                "event_id": message.event_id,
                "timestamp": message.timestamp,
                "metadata": message.metadata,
            }

            # Wrap in the format expected by client (like connector.py line 169)
            wrapped_data = {"type": "message", "data": message_data}
            message_json = json.dumps(wrapped_data)

            # Send to specific target or broadcast
            if hasattr(message, "target_agent_id") and message.destination_id:
                # Direct message - check both websockets and client_connections for backward compatibility
                websocket = None
                if message.destination_id in self.websockets:
                    websocket = self.websockets[message.destination_id]
                elif (
                    hasattr(self, "client_connections")
                    and message.destination_id in self.client_connections
                ):
                    websocket = self.client_connections[message.destination_id]

                if websocket:
                    await websocket.send(message_json)
                    return True
                else:
                    logger.warning(f"Target {message.destination_id} not connected")
                    return False
            else:
                # Broadcast message
                if self.websockets:
                    await asyncio.gather(
                        *[ws.send(message_json) for ws in self.websockets.values()],
                        return_exceptions=True,
                    )
                    return True
                else:
                    logger.info("No connected peers for broadcast")
                    return True

        except Exception as e:
            logger.error(f"Error sending WebSocket message: {e}")
            return False

    async def listen(self, address: str) -> bool:
        """Start WebSocket server."""
        try:
            host, port = (
                address.split(":") if ":" in address else (self.host, int(address))
            )
            port = int(port) if isinstance(port, str) else port

            # Create a wrapper to handle both old and new websockets API
            async def handler_wrapper(websocket, path=None):
                await self._handle_client(websocket, path or "/")

            self.server = await self.websockets_lib.serve(
                handler_wrapper, host, port, max_size=self.max_size
            )

            self.is_listening = True
            logger.info(
                f"WebSocket transport listening on {host}:{port} with max_size={self.max_size}"
            )
            return True
        except Exception as e:
            logger.error(f"Failed to start WebSocket server: {e}")
            return False

    async def _handle_client(self, websocket, path=None):
        """Handle incoming WebSocket client connection."""
        peer_id = str(uuid.uuid4())
        self.websockets[peer_id] = websocket
        self.peer_connections[peer_id] = ConnectionInfo(
            connection_id=peer_id,
            peer_id=peer_id,
            address=f"{websocket.remote_address[0]}:{websocket.remote_address[1]}",
            state=ConnectionState.CONNECTED,
            transport_type=TransportType.WEBSOCKET,
        )

        logger.info(f"New WebSocket client connected: {peer_id}")

        try:
            await self._handle_connection(peer_id, websocket)
        finally:
            # Clean up connection
            if peer_id in self.websockets:
                del self.websockets[peer_id]
            if peer_id in self.peer_connections:
                del self.peer_connections[peer_id]
            logger.info(f"WebSocket client disconnected: {peer_id}")

    async def _handle_connection(self, peer_id: str, websocket):
        """Handle messages from a WebSocket connection."""
        async for message_str in websocket:
            try:
                message_data = json.loads(message_str)

                # Check if this is an event message with nested data
                if message_data.get("type") == "event":
                    # Extract the event data from the nested structure
                    event_data = message_data.get("data", {})
                    message = Event.from_dict(event_data)
                else:
                    # Create Event from received data (backward compatibility)
                    message = Event(
                        event_name=message_data.get(
                            "event_name", "transport.message.received"
                        ),
                        source_id=message_data.get("source_id", peer_id),
                        destination_id=message_data.get("target_agent_id"),
                        payload=message_data.get("payload", {}),
                        event_id=message_data.get("event_id", str(uuid.uuid4())),
                        timestamp=message_data.get("timestamp"),
                        metadata=message_data.get("metadata", {}),
                    )

                # Handle the message
                await self.call_event_handler(message)

            except json.JSONDecodeError as e:
                logger.error(f"Invalid JSON from {peer_id}: {e}")
            except Exception as e:
                logger.error(f"Error handling message from {peer_id}: {e}")

    def register_agent_connection(self, agent_id: str, peer_id: str):
        """Register an agent ID with its peer connection for routing.

        Args:
            agent_id: The agent's registered ID
            peer_id: The peer/connection ID in the transport
        """
        if peer_id in self.websockets:
            self.websockets[agent_id] = self.websockets[peer_id]
            # Also add to client_connections for backward compatibility
            self.client_connections[agent_id] = self.websockets[peer_id]
            logger.debug(f"Mapped agent {agent_id} to WebSocket connection {peer_id}")
        else:
            logger.warning(
                f"Cannot map agent {agent_id}: peer {peer_id} not found in websockets"
            )


# Convenience function for creating WebSocket transport
def create_websocket_transport(
    host: str = "localhost", port: int = 8765, **kwargs
) -> WebSocketTransport:
    """Create a WebSocket transport with given configuration."""
    config = {"host": host, "port": port, **kwargs}
    return WebSocketTransport(config)
