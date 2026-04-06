"""
Agent-level basic test mod for OpenAgents.

This mod provides basic testing capabilities for individual agents,
including event processing, tool provision, and message handling.
"""

import logging
import time
from typing import Dict, Any, List, Optional, Callable, Union

from openagents.core.base_mod_adapter import BaseModAdapter
from openagents.models.messages import Event
from openagents.models.tool import AgentTool

logger = logging.getLogger(__name__)

# Type definitions for message handlers
MessageHandler = Callable[[Dict[str, Any], str], None]


class BasicTestAgentAdapter(BaseModAdapter):
    """Agent-level basic test mod implementation.

    This mod provides:
    - Event processing and logging for agents
    - Test tools for agent capabilities
    - Message handling and threading
    - Configurable behavior for test scenarios
    """

    def __init__(self):
        """Initialize the basic test mod for an agent."""
        super().__init__(mod_name="basic_test")

        # Initialize adapter state
        self.processed_events: List[Dict[str, Any]] = []
        self.event_count: int = 0
        self.start_time: float = time.time()

        # Test configuration
        self.max_event_history = 50  # Number of events to keep in history
        self.log_all_events = True
        self.test_mode = False  # Special test mode for debugging

        # Message handlers
        self.message_handlers: Dict[str, MessageHandler] = {}

        logger.info(f"Initializing Basic Test agent adapter")

    def initialize(self) -> bool:
        """Initialize the mod.

        Returns:
            bool: True if initialization was successful
        """
        logger.info(f"Basic Test agent adapter initialized successfully")
        return True

    def shutdown(self) -> bool:
        """Shutdown the mod gracefully.

        Returns:
            bool: True if shutdown was successful
        """
        logger.info(
            f"Basic Test agent adapter shutting down. Processed {self.event_count} events."
        )
        return True

    def on_connect(self) -> None:
        """Called when the mod adapter is connected to the network."""
        logger.info(f"Basic Test adapter connected for agent {self.agent_id}")

    def on_disconnect(self) -> None:
        """Called when the mod adapter is disconnected from the network."""
        logger.info(f"Basic Test adapter disconnected for agent {self.agent_id}")

    async def process_incoming_event(self, event: Event) -> Optional[Event]:
        """Process an incoming event.

        Args:
            event: The event to process

        Returns:
            Optional[Event]: The processed event, or None to stop processing
        """
        self.event_count += 1

        # Log event if configured to do so
        if self.log_all_events:
            logger.info(
                f"Agent {self.agent_id} processing incoming event #{self.event_count}: {event.event_name}"
            )

        # Store event in history
        event_record = {
            "direction": "incoming",
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

        # Handle test-specific events
        if event.event_name == "test.agent_ping":
            logger.info(f"Agent {self.agent_id} received ping")
            # Could send a response event here if needed

        # Call registered message handlers
        if event.event_name in self.message_handlers:
            try:
                handler = self.message_handlers[event.event_name]
                handler(event.payload or {}, event.source_id)
            except Exception as e:
                logger.error(f"Error in message handler for {event.event_name}: {e}")

        # Allow event to continue processing
        return event

    async def process_outgoing_event(self, event: Event) -> Optional[Event]:
        """Process an outgoing event.

        Args:
            event: The event to process

        Returns:
            Optional[Event]: The processed event, or None to stop processing
        """
        # Log outgoing event
        if self.log_all_events:
            logger.info(
                f"Agent {self.agent_id} processing outgoing event: {event.event_name}"
            )

        # Store event in history
        event_record = {
            "direction": "outgoing",
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

        # Allow event to continue processing
        return event

    def get_tools(self) -> List[AgentTool]:
        """Get the tools for the mod adapter.

        Returns:
            List[AgentAdapterTool]: The tools for the mod adapter
        """
        tools = []

        # Test ping tool
        tools.append(
            AgentTool(
                name="test_ping",
                description="Send a test ping to the network",
                parameters={
                    "type": "object",
                    "properties": {
                        "message": {
                            "type": "string",
                            "description": "Optional message to include with the ping",
                        }
                    },
                },
                handler=self._handle_test_ping,
            )
        )

        # Get adapter state tool
        tools.append(
            AgentTool(
                name="get_test_state",
                description="Get the current state of the test adapter",
                parameters={"type": "object", "properties": {}},
                handler=self._handle_get_state,
            )
        )

        # Send test message tool
        tools.append(
            AgentTool(
                name="send_test_message",
                description="Send a test message to another agent or broadcast",
                parameters={
                    "type": "object",
                    "properties": {
                        "target_agent": {
                            "type": "string",
                            "description": "Target agent ID (optional, if not provided will broadcast)",
                        },
                        "message": {"type": "string", "description": "Message content"},
                        "event_name": {
                            "type": "string",
                            "description": "Custom event name (optional)",
                        },
                    },
                    "required": ["message"],
                },
                handler=self._handle_send_test_message,
            )
        )

        return tools

    async def _handle_test_ping(self, parameters: Dict[str, Any]) -> Dict[str, Any]:
        """Handle test ping tool execution.

        Args:
            parameters: Tool parameters

        Returns:
            Dict with result
        """
        message = parameters.get("message", "ping")

        # Create and send ping event
        ping_event = Event(
            event_name="test.ping",
            source_id=self.agent_id,
            destination_id="",  # Network-level event
            payload={"message": message, "timestamp": time.time()},
        )

        try:
            # Send through connector if available
            if self.connector:
                await self.connector.send_message(ping_event)
                return {"success": True, "message": f"Ping sent: {message}"}
            else:
                return {"success": False, "error": "No connector available"}
        except Exception as e:
            logger.error(f"Error sending ping: {e}")
            return {"success": False, "error": str(e)}

    async def _handle_get_state(self, parameters: Dict[str, Any]) -> Dict[str, Any]:
        """Handle get state tool execution.

        Args:
            parameters: Tool parameters

        Returns:
            Dict with adapter state
        """
        uptime = time.time() - self.start_time
        return {
            "success": True,
            "state": {
                "agent_id": self.agent_id,
                "mod_name": self.mod_name,
                "event_count": self.event_count,
                "uptime_seconds": uptime,
                "recent_events": (
                    self.processed_events[-5:] if self.processed_events else []
                ),
                "event_threads": len(self.event_threads),
                "test_mode": self.test_mode,
            },
        }

    async def _handle_send_test_message(
        self, parameters: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Handle send test message tool execution.

        Args:
            parameters: Tool parameters

        Returns:
            Dict with result
        """
        target_agent = parameters.get("target_agent")
        message = parameters["message"]
        event_name = parameters.get("event_name", "test.message")

        # Create test message event
        test_event = Event(
            event_name=event_name,
            source_id=self.agent_id,
            destination_id=target_agent or "",  # Empty for broadcast
            payload={"message": message, "timestamp": time.time()},
        )

        try:
            # Send through connector if available
            if self.connector:
                await self.connector.send_message(test_event)
                target_desc = f"agent {target_agent}" if target_agent else "all agents"
                return {
                    "success": True,
                    "message": f"Test message sent to {target_desc}",
                }
            else:
                return {"success": False, "error": "No connector available"}
        except Exception as e:
            logger.error(f"Error sending test message: {e}")
            return {"success": False, "error": str(e)}

    def register_message_handler(
        self, event_name: str, handler: MessageHandler
    ) -> None:
        """Register a message handler for a specific event type.

        Args:
            event_name: The event name to handle
            handler: The handler function
        """
        self.message_handlers[event_name] = handler
        logger.info(f"Registered message handler for {event_name}")

    def unregister_message_handler(self, event_name: str) -> None:
        """Unregister a message handler.

        Args:
            event_name: The event name to unregister
        """
        if event_name in self.message_handlers:
            del self.message_handlers[event_name]
            logger.info(f"Unregistered message handler for {event_name}")

    def set_test_mode(self, enabled: bool) -> None:
        """Enable or disable test mode.

        Args:
            enabled: Whether to enable test mode
        """
        self.test_mode = enabled
        logger.info(f"Test mode: {'enabled' if enabled else 'disabled'}")

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
