"""
Base Network Connector for OpenAgents

Provides abstract base class for network connectors that allow agents to connect
to different types of networks (gRPC, WebSocket, etc.).
"""

import asyncio
import logging
from abc import ABC, abstractmethod
from typing import Dict, Any, Optional, Callable, Awaitable, List

from openagents.models.event import Event
from openagents.models.event_response import EventResponse

logger = logging.getLogger(__name__)


class NetworkConnector(ABC):
    """Abstract base class for network connectors.

    This class defines the interface that all network connectors must implement
    to allow agents to connect to different types of networks.
    """

    def __init__(
        self,
        host: str,
        port: int,
        agent_id: str,
        metadata: Optional[Dict[str, Any]] = None,
    ):
        """Initialize a network connector.

        Args:
            host: Server host address
            port: Server port
            agent_id: Agent identifier
            metadata: Agent metadata to send during registration
        """
        self.host = host
        self.port = port
        self.agent_id = agent_id
        self.metadata = metadata or {}

        # Connection state
        self.is_connected = False
        self.is_polling = (
            False  # Whether this connector uses polling for message retrieval
        )
        
        # Authentication
        self.secret: Optional[str] = None

        # Message handling
        self.event_handlers: List[Callable[[Any], Awaitable[None]]] = []
        self.system_handlers = {}
        self.event_listener_task = None

    @abstractmethod
    async def connect_to_server(self) -> bool:
        """Connect to a network server.

        Returns:
            bool: True if connection successful
        """
        pass

    @abstractmethod
    async def disconnect(self) -> bool:
        """Disconnect from the network server.

        Returns:
            bool: True if disconnection was successful
        """
        pass

    def register_event_handler(self, handler: Callable[[Any], Awaitable[None]]) -> None:
        """Register a handler for events.

        Args:
            handler: Async function to call when event is received
        """
        if handler not in self.event_handlers:
            self.event_handlers.append(handler)
            logger.debug(f"Registered event handler for {self.__class__.__name__}")

    def unregister_event_handler(
        self, handler: Callable[[Any], Awaitable[None]]
    ) -> bool:
        """Unregister an event handler.

        Args:
            handler: The handler function to remove

        Returns:
            bool: True if handler was removed, False if not found
        """
        if handler in self.event_handlers:
            self.event_handlers.remove(handler)
            logger.debug(f"Unregistered event handler for {self.__class__.__name__}")
            return True
        return False

    async def consume_message(self, message: Event) -> None:
        """Consume a message on the agent side.

        Args:
            message: Message to consume
        """
        # Call all registered event handlers in reverse order
        for handler in reversed(self.event_handlers):
            try:
                await handler(message)
            except Exception as e:
                logger.error(f"Error in event handler: {e}")

    @abstractmethod
    async def send_event(self, message: Event) -> EventResponse:
        """Send an event via the network connector.

        Args:
            message: Event to send

        Returns:
            EventResponse: The response from the server
        """
        pass

    async def poll_messages(self) -> List[Event]:
        """Poll for queued messages from the network server.

        This method should be implemented by connectors that use polling.
        For streaming connectors, this can return an empty list.

        Returns:
            List of Event objects waiting for this agent
        """
        if not self.is_polling:
            logger.debug(f"{self.__class__.__name__} does not support polling")
            return []

        # Default implementation - subclasses should override if they support polling
        return []

    def _validate_event(self, event: Event) -> bool:
        """Validate an event before sending.

        Args:
            event: Event to validate

        Returns:
            bool: True if event is valid
        """
        if not event.event_name:
            logger.error("Event name is required")
            return False

        if not event.source_id:
            event.source_id = self.agent_id

        if not event.event_id:
            logger.warning("Event missing event_id, this may cause issues")

        return True

    def _create_error_response(self, message: str) -> EventResponse:
        """Create a standard error response.

        Args:
            message: Error message

        Returns:
            EventResponse: Error response
        """
        return EventResponse(success=False, message=message)

    def _create_success_response(
        self, message: str = "Success", data: Any = None
    ) -> EventResponse:
        """Create a standard success response.

        Args:
            message: Success message
            data: Optional response data

        Returns:
            EventResponse: Success response
        """
        return EventResponse(success=True, message=message, data=data)

    async def start_event_listener(self) -> None:
        """Start the event listener task.

        This method can be overridden by subclasses that need custom event listening logic.
        """
        if self.event_listener_task and not self.event_listener_task.done():
            logger.warning("Event listener task is already running")
            return

        if hasattr(self, "_event_listener_loop"):
            self.event_listener_task = asyncio.create_task(self._event_listener_loop())
            logger.debug(f"Started event listener for {self.__class__.__name__}")

    async def stop_event_listener(self) -> None:
        """Stop the event listener task."""
        if self.event_listener_task and not self.event_listener_task.done():
            self.event_listener_task.cancel()
            try:
                await self.event_listener_task
            except asyncio.CancelledError:
                pass
            logger.debug(f"Stopped event listener for {self.__class__.__name__}")

    def __str__(self) -> str:
        """String representation of the connector."""
        return f"{self.__class__.__name__}(agent_id={self.agent_id}, host={self.host}, port={self.port}, connected={self.is_connected})"

    def __repr__(self) -> str:
        """Detailed string representation of the connector."""
        return self.__str__()
