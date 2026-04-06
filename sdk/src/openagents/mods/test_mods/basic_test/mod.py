"""
Network-level basic test mod for OpenAgents.

This mod provides basic testing capabilities for the OpenAgents framework,
including event processing, state management, and agent registration tracking.
"""

import logging
import time
from typing import Dict, Any, List, Optional, Set
from datetime import datetime

from openagents.core.base_mod import BaseMod
from openagents.models.messages import Event, EventNames
from openagents.models.event_response import EventResponse

logger = logging.getLogger(__name__)


class BasicTestNetworkMod(BaseMod):
    """Network-level basic test mod implementation.

    This mod provides:
    - Event processing and logging
    - Agent registration tracking
    - State management for testing
    - Configurable behavior for test scenarios
    """

    def __init__(self, mod_name: str = "basic_test"):
        """Initialize the basic test mod for a network."""
        super().__init__(mod_name=mod_name)

        # Register event handlers using the elegant pattern
        self.register_event_handler(self._handle_test_ping, "test.ping")
        self.register_event_handler(self._handle_test_get_state, "test.get_state")

        # Initialize mod state
        self.registered_agents: Set[str] = set()
        self.processed_events: List[Dict[str, Any]] = []
        self.event_count: int = 0
        self.start_time: float = time.time()

        # Test configuration
        self.max_event_history = 100  # Number of events to keep in history
        self.log_all_events = True
        self.intercept_events = False  # If True, intercepts and stops event processing
        self.test_responses = {}  # Custom responses for specific event types

        logger.info(f"Initializing Basic Test network mod")

    def initialize(self) -> bool:
        """Initialize the mod.

        Returns:
            bool: True if initialization was successful
        """
        logger.info(f"Basic Test mod initialized successfully")
        return True

    def shutdown(self) -> bool:
        """Shutdown the mod gracefully.

        Returns:
            bool: True if shutdown was successful
        """
        logger.info(
            f"Basic Test mod shutting down. Processed {self.event_count} events."
        )
        return True

    async def handle_register_agent(
        self, agent_id: str, metadata: Dict[str, Any]
    ) -> bool:
        """Handle agent registration with this network mod.

        Args:
            agent_id: Unique identifier for the agent
            metadata: Agent metadata including capabilities

        Returns:
            bool: True if registration was successful
        """
        self.registered_agents.add(agent_id)
        logger.info(
            f"Agent {agent_id} registered with Basic Test mod. Total agents: {len(self.registered_agents)}"
        )

        # Log agent capabilities if available
        if metadata.get("capabilities"):
            logger.info(f"Agent {agent_id} capabilities: {metadata['capabilities']}")

        return True

    async def handle_unregister_agent(self, agent_id: str) -> bool:
        """Handle agent unregistration from this network mod.

        Args:
            agent_id: Unique identifier for the agent

        Returns:
            bool: True if unregistration was successful
        """
        self.registered_agents.discard(agent_id)
        logger.info(
            f"Agent {agent_id} unregistered from Basic Test mod. Remaining agents: {len(self.registered_agents)}"
        )
        return True

    def get_state(self) -> Dict[str, Any]:
        """Get the current state of the mod.

        Returns:
            Dict[str, Any]: Current mod state
        """
        uptime = time.time() - self.start_time
        return {
            "mod_name": self.mod_name,
            "registered_agents": list(self.registered_agents),
            "agent_count": len(self.registered_agents),
            "event_count": self.event_count,
            "uptime_seconds": uptime,
            "recent_events": (
                self.processed_events[-10:] if self.processed_events else []
            ),
            "config": self.config,
        }

    async def process_event(self, event: Event) -> Optional[EventResponse]:
        """Process an event and return the response.

        This method handles general event processing logic and then delegates
        to specific handlers registered via register_event_handler.

        Args:
            event: The event to process

        Returns:
            Optional[EventResponse]: The response to the event, or None if not intercepted
        """
        self.event_count += 1

        # Log event if configured to do so
        if self.log_all_events:
            logger.info(
                f"Processing event #{self.event_count}: {event.event_name} from {event.source_id}"
            )

        # Store event in history (keep only recent events)
        event_record = {
            "event_id": event.event_id,
            "event_name": event.event_name,
            "source_id": event.source_id,
            "destination_id": event.destination_id,
            "timestamp": event.timestamp,
            "processed_at": time.time(),
        }

        self.processed_events.append(event_record)
        if len(self.processed_events) > self.max_event_history:
            self.processed_events.pop(0)

        # Check if we have a custom response for this event type
        if event.event_name in self.test_responses:
            response_data = self.test_responses[event.event_name]
            logger.info(f"Returning custom test response for {event.event_name}")
            return EventResponse(
                success=response_data.get("success", True),
                data=response_data.get("payload", {}),
                message=response_data.get("error_message", "Custom test response"),
            )

        # Check if we should intercept this event (for testing purposes)
        if self.intercept_events:
            logger.info(
                f"Intercepting event {event.event_name} - stopping further processing"
            )
            return EventResponse(
                success=True, data={"intercepted": True, "mod": self.mod_name}
            )

        # Delegate to base class for registered event handlers
        return await super().process_event(event)

    async def _handle_test_ping(self, event: Event) -> Optional[EventResponse]:
        """Handle test ping events.

        Args:
            event: The ping event to process

        Returns:
            EventResponse: Response with pong data
        """
        logger.info(f"Received ping from {event.source_id}")
        return EventResponse(
            success=True,
            data={
                "pong": True,
                "mod": self.mod_name,
                "timestamp": time.time(),
                "agent_count": len(self.registered_agents),
            },
        )

    async def _handle_test_get_state(self, event: Event) -> Optional[EventResponse]:
        """Handle test get state events.

        Args:
            event: The get state event to process

        Returns:
            EventResponse: Response with mod state data
        """
        logger.info(f"State request from {event.source_id}")
        return EventResponse(success=True, data=self.get_state())

    def set_test_response(self, event_name: str, response_data: Dict[str, Any]) -> None:
        """Set a custom response for a specific event type (for testing).

        Args:
            event_name: The event name to respond to
            response_data: The response data to return
        """
        self.test_responses[event_name] = response_data
        logger.info(f"Set custom test response for event: {event_name}")

    def clear_test_responses(self) -> None:
        """Clear all custom test responses."""
        self.test_responses.clear()
        logger.info("Cleared all custom test responses")

    def set_intercept_mode(self, intercept: bool) -> None:
        """Enable or disable event interception mode.

        Args:
            intercept: Whether to intercept all events
        """
        self.intercept_events = intercept
        logger.info(
            f"Event interception mode: {'enabled' if intercept else 'disabled'}"
        )

    def get_event_history(self, limit: int = 10) -> List[Dict[str, Any]]:
        """Get recent event history.

        Args:
            limit: Maximum number of events to return

        Returns:
            List of recent events
        """
        return self.processed_events[-limit:] if self.processed_events else []

    def clear_event_history(self) -> None:
        """Clear the event history."""
        self.processed_events.clear()
        self.event_count = 0
        logger.info("Cleared event history")
