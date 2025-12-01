from typing import (
    Awaitable,
    Callable,
    Dict,
    Any,
    Optional,
    List,
    Set,
    TYPE_CHECKING,
    Union,
)
from abc import ABC, abstractmethod
import logging
import asyncio
import inspect

from pydantic import BaseModel, Field
from pathlib import Path
import tempfile

# Use TYPE_CHECKING to avoid circular imports
if TYPE_CHECKING:
    from openagents.core.workspace_manager import WorkspaceManager
    from openagents.models.tool import AgentTool
from openagents.models.event_response import EventResponse
from openagents.models.messages import Event, EventNames

logger = logging.getLogger(__name__)


def mod_event_handler(pattern: str):
    """
    Decorator for defining event handlers in BaseMod subclasses.

    This decorator allows you to define custom event handlers that will be called
    when events matching the specified pattern are received.

    Args:
        pattern: Event name pattern to match. Supports wildcards with '*'.
                Examples: "thread.channel_message.*", "system.notification.*"

    Example:
        class MyMod(BaseMod):
            @mod_event_handler("thread.channel_message.*")
            async def handle_channel_message(self, event: Event) -> Optional[EventResponse]:
                # Handle the event
                return None

    Note:
        - The decorated function must be async
        - The function should accept (self, event: Event) as parameters
        - The function should return Optional[EventResponse]
        - Multiple handlers can be defined for different patterns
        - Handlers are collected automatically during mod initialization
    """

    def decorator(func: Callable):
        # Validate that the function is async
        if not asyncio.iscoroutinefunction(func):
            raise ValueError(
                f"@mod_event_handler decorated function '{func.__name__}' must be async"
            )

        # Validate function signature
        sig = inspect.signature(func)
        params = list(sig.parameters.keys())
        if len(params) < 2 or params[0] != "self":
            raise ValueError(
                f"@mod_event_handler decorated function '{func.__name__}' must have signature (self, event: Event)"
            )

        # Store the event pattern on the function for later collection
        # Support multiple decorators by maintaining a list of patterns
        if not hasattr(func, "_mod_event_patterns"):
            func._mod_event_patterns = []
        func._mod_event_patterns.append(pattern)
        return func

    return decorator


class EventHandlerEntry(BaseModel):

    handler: Callable[[Event], Awaitable[Optional[EventResponse]]]
    patterns: List[str] = Field(default_factory=list)


class BaseMod(ABC):
    """Base class for network-level mods in OpenAgents.

    Network mods manage global state and coordinate interactions
    between agents across the network.
    """

    def __init__(self, mod_name: str):
        """Initialize the network mod.

        Args:
            name: Name for the mod
        """
        self._mod_name = mod_name
        self._network = None  # Will be set when registered with a network
        self._config = {}
        self._event_handlers: List[EventHandlerEntry] = []
        self._workspace_manager = None  # Will be set when registered with a network

        self._register_default_event_handlers()
        self._collect_mod_event_handlers()

        logger.info(f"Initializing network mod {self.mod_name}")

    def _register_default_event_handlers(self) -> None:
        """Register default event handlers for the mod."""

        async def handle_register_agent(event: Event) -> Optional[EventResponse]:
            return await self.handle_register_agent(
                event.payload.get("agent_id"), event.payload.get("metadata")
            )

        async def handle_unregister_agent(event: Event) -> Optional[EventResponse]:
            return await self.handle_unregister_agent(event.payload.get("agent_id"))

        self.register_event_handler(
            handle_register_agent, "system.notification.register_agent"
        )
        self.register_event_handler(
            handle_unregister_agent, "system.notification.unregister_agent"
        )

    def _collect_mod_event_handlers(self) -> None:
        """
        Collect all @mod_event_handler decorated methods from this class and its parent classes.

        This method scans the class hierarchy for methods with the _mod_event_pattern
        attribute (set by the @mod_event_handler decorator) and registers them as event handlers.
        """
        # Get all methods from this class and parent classes
        for cls in self.__class__.__mro__:
            for method_name in dir(cls):
                # Skip special methods but allow regular private methods with decorators
                if method_name.startswith("__"):
                    continue

                method = getattr(self, method_name, None)
                if method is None or not callable(method):
                    continue

                # Check if this method has the _mod_event_patterns attribute (set by @mod_event_handler decorator)
                if hasattr(method, "_mod_event_patterns"):
                    patterns = method._mod_event_patterns
                    self.register_event_handler(method, patterns)
                    logger.debug(
                        f"Collected mod event handler for patterns '{patterns}': {method_name}"
                    )

    def initialize(self) -> bool:
        """Initialize the mod.

        Returns:
            bool: True if initialization was successful, False otherwise
        """
        return True

    def shutdown(self) -> bool:
        """Shutdown the mod gracefully.

        Returns:
            bool: True if shutdown was successful, False otherwise
        """
        return True

    def register_event_handler(
        self,
        handler: Callable[[Event], Awaitable[EventResponse]],
        patterns: Union[List[str], str],
    ) -> None:
        """Register an event handler for the mod.

        Args:
            handler: The handler function to register
            patterns: The patterns to match the event
        """
        if isinstance(patterns, str):
            patterns = [patterns]
        self._event_handlers.append(
            EventHandlerEntry(handler=handler, patterns=patterns)
        )

    def unregister_event_handler(
        self, handler: Callable[[Event], Awaitable[EventResponse]]
    ) -> None:
        """Unregister an event handler for the mod.

        Args:
            handler: The handler function to unregister
        """
        self._event_handlers = [
            entry for entry in self._event_handlers if entry.handler != handler
        ]

    @property
    def mod_name(self) -> str:
        """Get the name of the mod.

        Returns:
            str: The name of the mod
        """
        return self._mod_name

    @property
    def config(self) -> Dict[str, Any]:
        """Get the configuration for the mod.

        Returns:
            Dict[str, Any]: The configuration for the mod
        """
        return self._config

    @property
    def network(self) -> Optional[Any]:
        """Get the network this mod is registered with.

        Returns:
            Optional[Any]: The network this mod is registered with
        """
        return self._network

    @property
    def workspace_manager(self) -> Optional["WorkspaceManager"]:
        """Get the workspace manager for this mod.

        Returns:
            Optional[WorkspaceManager]: The workspace manager if available
        """
        return self._workspace_manager

    def get_storage_path(self) -> Path:
        """Get the storage path for this mod.

        Returns:
            Optional[Path]: Path to mod's storage directory, or None if no workspace manager
        """
        if self._workspace_manager is not None:
            return self._workspace_manager.get_mod_storage_path(self._mod_name)
        else:
            # Create a temporary directory for file storage as backup
            logger.warning(
                f"No workspace manager found, using temporary directory for storage: {self._mod_name}"
            )
            logger.warning(
                f"This mod will not be able to persist data between restarts."
            )
            temp_dir = tempfile.mkdtemp(prefix=f"openagents_mod_{self._mod_name}_")
            return Path(temp_dir)

    def bind_network(self, network) -> bool:
        """Register this mod with a network.

        Args:
            network: The network to register with

        Returns:
            bool: True if registration was successful, False otherwise
        """
        self._network = network

        # Set workspace manager if available
        self._workspace_manager = network.workspace_manager

        logger.info(f"Mod {self.mod_name} bound to network {network.network_id}")
        return True

    async def handle_register_agent(
        self, agent_id: str, metadata: Dict[str, Any]
    ) -> Optional[EventResponse]:
        """Handle agent registration with this network mod.

        Args:
            agent_id: Unique identifier for the agent
            metadata: Agent metadata including capabilities

        Returns:
            Optional[EventResponse]: The response to the event, or None if the mod doesn't want to stop the event from being processed by other mods
        """
        return None

    async def handle_unregister_agent(self, agent_id: str) -> Optional[EventResponse]:
        """Handle agent unregistration from this network mod.

        Args:
            agent_id: Unique identifier for the agent

        Returns:
            Optional[EventResponse]: The response to the event, or None if the mod doesn't want to stop the event from being processed by other mods
        """
        return None

    def get_state(self) -> Dict[str, Any]:
        """Get the current state of the mod.

        Returns:
            Dict[str, Any]: Current network state
        """
        return {}

    def get_tools(self) -> List["AgentTool"]:
        """Get tools provided by this network mod for MCP exposure.

        Override this method to expose tools at the network level via MCP.
        By default, network mods don't expose tools.

        Returns:
            List[AgentTool]: Tools provided by this mod
        """
        return []

    def update_config(self, config: Dict[str, Any]) -> None:
        """Update the configuration for the mod.

        Args:
            config: The configuration to update
        """
        self._config.update(config)

    async def send_event(self, event: Event) -> Optional[EventResponse]:
        """Send an event to the network.

        Args:
            event: The event to send

        Returns:
            Optional[EventResponse]: The response to the event, or None if the event is not processed
        """
        return await self.network.process_event(event)

    async def process_event(self, event: Event) -> Optional[EventResponse]:
        """Process an event and return the response.

        A mod can intercept and process the event by returning an event response.
        Once an event response is return, the event will not be processed by any other mod and will not be delivered to the destination.
        If the mod wants to allow the event to be processed by other mods or be delivered, it should return None.

        Args:
            event: The event to process

        Returns:
            Optional[EventResponse]: The response to the event, or None if the event is not processed
        """
        response = None
        for handler_entry in self._event_handlers:
            if any(
                event.matches_pattern(pattern) for pattern in handler_entry.patterns
            ):
                response = await handler_entry.handler(event)
                if response:
                    break
        return response
