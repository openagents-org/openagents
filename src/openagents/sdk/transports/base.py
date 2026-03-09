"""
Base Transport Layer for OpenAgents.

This module provides the abstract base class for transport implementations.
"""

from abc import ABC, abstractmethod
from typing import Dict, Any, List, Optional, Callable, Awaitable
import logging

from openagents.models.event_response import EventResponse
from openagents.models.transport import (
    TransportType,
    ConnectionState,
    PeerMetadata,
    ConnectionInfo,
    AgentConnection,
)
from openagents.models.event import Event

logger = logging.getLogger(__name__)


# Backward compatibility factory and alias
def Message(
    source_id: str,
    target_id: str = None,
    message_type: str = "direct",
    payload: dict = None,
    **kwargs,
):
    """Backward compatibility factory for creating Events with old Message constructor."""
    # Map old field names to new Event structure
    event_name_map = {
        "direct": "agent.message",
        "broadcast": "network.broadcast.sent",
        "direct_message": "agent.message",
    }

    event_name = event_name_map.get(message_type, f"agent.{message_type}")

    return Event(
        event_name=event_name,
        source_id=source_id,
        destination_id=target_id,
        payload=payload or {},
        **kwargs,
    )


class Transport(ABC):
    """Abstract base class for transport implementations."""

    def __init__(
        self,
        transport_type: TransportType,
        config: Optional[Dict[str, Any]] = None,
        is_notifiable: bool = True,
    ):
        self.transport_type = transport_type
        self.config = config or {}
        self.is_initialized = False
        self.is_listening = False
        self.is_notifiable = is_notifiable
        self.event_handler: Optional[Callable[[Event], Awaitable[EventResponse]]] = None
        self.peer_connections: Dict[str, ConnectionInfo] = {}
        self.peer_connection_handlers: List[
            Callable[[str, ConnectionState], Awaitable[None]]
        ] = []

    def notifiable(self) -> bool:
        """
        Return True if the agents connected to this transport can receive events directly.
        """
        return self.is_notifiable

    @abstractmethod
    async def initialize(self) -> bool:
        """Initialize the transport."""
        pass

    @abstractmethod
    async def shutdown(self) -> bool:
        """Shutdown the transport."""
        pass

    @abstractmethod
    async def peer_connect(self, peer_id: str, address: str) -> bool:
        """Connect to a peer."""
        pass

    @abstractmethod
    async def peer_disconnect(self, peer_id: str) -> bool:
        """Disconnect from a peer."""
        pass

    @abstractmethod
    async def send(self, message: Event) -> bool:
        """Send an event."""
        pass

    @abstractmethod
    async def listen(self, address: str) -> bool:
        """Start listening for connections."""
        pass

    def register_event_handler(
        self, handler: Callable[[Event], Awaitable[EventResponse]]
    ):
        """Register an event handler to process events sent via the unified SendEvent method.

        This allows the network to register an event handler in the transport, avoiding the need
        for the network to pass itself to the transport.

        Args:
            handler: Async function that takes an Event and processes it
        """
        self.event_handler = handler

    async def call_event_handler(self, event: Event) -> EventResponse:
        """Call the registered event handler."""
        if self.event_handler:
            return await self.event_handler(event)
        logger.warning("No event handler registered")
        return EventResponse(success=False, message="No event handler registered")

    def register_peer_connection_handler(
        self, handler: Callable[[str, ConnectionState], Awaitable[None]]
    ):
        """Register a connection state change handler."""
        if not hasattr(self, "peer_connection_handlers"):
            self.peer_connection_handlers = []
        self.peer_connection_handlers.append(handler)

    async def _notify_peer_connection_handlers(
        self, peer_id: str, state: ConnectionState
    ):
        """Notify all connection handlers of state changes."""
        for handler in self.peer_connection_handlers:
            try:
                await handler(peer_id, state)
            except Exception as e:
                logger.error(f"Error in connection handler: {e}")

    def get_peer_connection(self, peer_id: str) -> Optional[ConnectionInfo]:
        """Get connection information for a peer."""
        return self.peer_connections.get(peer_id)

    def list_peer_connections(self) -> Dict[str, ConnectionInfo]:
        """Get all connections."""
        return self.peer_connections.copy()

    def register_agent_peer_connection(self, agent_id: str, peer_id: str):
        """Register an agent ID with its peer connection for routing.

        Args:
            agent_id: The agent's registered ID
            peer_id: The peer/connection ID in the transport
        """
        pass  # Default implementation does nothing

    def cleanup_agent(self, agent_id: str):
        """Cleanup an agent's connection."""
        pass
