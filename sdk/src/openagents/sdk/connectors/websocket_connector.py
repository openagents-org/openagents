from typing import Dict, Any, Optional, Callable, Awaitable, List, Set
import logging
import json
import asyncio
import time
import websockets
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed
from openagents.utils.message_util import parse_message_dict
from openagents.models.messages import Event, EventNames
from openagents.models.event import Event
from .system_commands import send_system_request as send_system_request_impl
from .system_commands import (
    REGISTER_AGENT,
    LIST_AGENTS,
    LIST_MODS,
    GET_MOD_MANIFEST,
    PING_AGENT,
    CLAIM_AGENT_ID,
    VALIDATE_CERTIFICATE,
)

logger = logging.getLogger(__name__)


class NetworkConnector:
    """Handles network connections and message passing for agents.

    Responsible for establishing connections to network servers and
    handling message sending/receiving.
    """

    def __init__(
        self,
        host: str,
        port: int,
        agent_id: str,
        metadata: Optional[Dict[str, Any]] = None,
        max_message_size: int = 104857600,
    ):
        """Initialize a network connector.

        Args:
            host: Server host address
            port: Server port
            agent_id: Agent identifier
            metadata: Agent metadata to send during registration
            max_message_size: Maximum WebSocket message size in bytes (default 10MB)
        """
        self.host = host
        self.port = port
        self.agent_id = agent_id
        self.metadata = metadata
        self.max_message_size = max_message_size
        self.connection = None
        self.is_connected = False
        self.message_handlers: Dict[str, List[Callable[[Any], Awaitable[None]]]] = {}
        self.system_handlers = {}
        self.message_listener_task = None

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
            self.connection = await connect(
                f"ws://{self.host}:{self.port}", max_size=self.max_message_size
            )

            # Register with server using system_request
            await send_system_request_impl(
                self.connection,
                REGISTER_AGENT,
                agent_id=self.agent_id,
                metadata=self.metadata,
                force_reconnect=True,  # Allow reconnection if agent ID already exists
            )

            # Wait for registration response
            response = await self.connection.recv()
            data = json.loads(response)

            if (
                data.get("type") == "system_response"
                and data.get("command") == REGISTER_AGENT
                and data.get("success")
            ):
                self.is_connected = True
                logger.info(f"Connected to network: {data.get('network_name')}")

                # Start message listener and track the task
                self.message_listener_task = asyncio.create_task(
                    self._listen_for_messages()
                )
                logger.debug("Started message listener task for heartbeat handling")
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
                # Cancel message listener task first
                if self.message_listener_task and not self.message_listener_task.done():
                    self.message_listener_task.cancel()
                    try:
                        await self.message_listener_task
                    except asyncio.CancelledError:
                        pass

                await self.connection.close()
                self.connection = None
                self.is_connected = False
                self.message_listener_task = None
                logger.info(f"Agent {self.agent_id} disconnected from network")
                return True
            except Exception as e:
                logger.error(f"Error disconnecting: {e}")
                return False
        return False

    def register_message_handler(
        self, message_type: str, handler: Callable[[Any], Awaitable[None]]
    ) -> None:
        """Register a handler for a specific message type.

        Args:
            message_type: Type of message to handle
            handler: Async function to call when message is received
        """
        if message_type not in self.message_handlers:
            self.message_handlers[message_type] = []

        # Add handler to the list if it's not already there
        if handler not in self.message_handlers[message_type]:
            self.message_handlers[message_type].append(handler)
            logger.debug(f"Registered handler for message type: {message_type}")

    def unregister_message_handler(
        self, message_type: str, handler: Callable[[Any], Awaitable[None]]
    ) -> bool:
        """Unregister a handler for a specific message type.

        Args:
            message_type: Type of message to handle
            handler: The handler function to remove

        Returns:
            bool: True if handler was removed, False if not found
        """
        if (
            message_type in self.message_handlers
            and handler in self.message_handlers[message_type]
        ):
            self.message_handlers[message_type].remove(handler)
            logger.debug(f"Unregistered handler for message type: {message_type}")

            # Clean up empty lists
            if not self.message_handlers[message_type]:
                del self.message_handlers[message_type]

            return True
        return False

    def register_system_handler(
        self, command: str, handler: Callable[[Dict[str, Any]], Awaitable[None]]
    ) -> None:
        """Register a handler for a specific system command response.

        Args:
            command: Type of system command response to handle
            handler: Async function to call when system response is received
        """
        self.system_handlers[command] = handler
        logger.debug(f"Registered handler for system command: {command}")

    async def _listen_for_messages(self) -> None:
        """Listen for messages from the server."""
        try:
            while self.is_connected:
                message = await self.connection.recv()
                data = json.loads(message)

                # Handle different message types
                if data.get("type") == "message":
                    message_data = data.get("data", {})
                    message_obj = parse_message_dict(message_data)

                    logger.debug(
                        f"Received message from {message_obj.sender_id} with ID {message_obj.message_id}"
                    )

                    # Call the appropriate message handler
                    await self.consume_message(message_obj)

                # Handle system responses
                elif data.get("type") == "system_response":
                    command = data.get("command")
                    if command in self.system_handlers:
                        await self.system_handlers[command](data)
                    else:
                        logger.debug(f"Received system response for command {command}")

                # Handle system requests (like ping)
                elif data.get("type") == "system_request":
                    command = data.get("command")
                    if command == PING_AGENT:
                        # Respond to ping with pong
                        pong_response = {
                            "type": "system_response",
                            "command": "ping_agent",
                            "success": True,
                            "timestamp": data.get("timestamp", time.time()),
                            "agent_id": self.agent_id,  # Include agent_id for tracking
                        }
                        await self.connection.send(json.dumps(pong_response))
                        logger.debug(
                            f"Agent {self.agent_id} responded to heartbeat ping from server"
                        )
                    else:
                        logger.debug(f"Received unhandled system request: {command}")

        except ConnectionClosed:
            self.is_connected = False
            logger.info("Disconnected from server")
        except Exception as e:
            logger.error(f"Error in message listener: {e}")
            self.is_connected = False

    async def consume_message(self, message: Event) -> None:
        """Consume a message on the agent side.

        Args:
            message: Message to consume
        """
        if message.relevant_mod:
            message.relevant_agent_id = self.agent_id

        # Determine message type from payload or infer from message properties
        message_type = message.message_type
        if not message_type:
            # Auto-classify based on message properties
            # Prioritize based on targeting: direct > channel > broadcast > mod
            if message.destination_id:
                message_type = "direct_message"
            elif message.target_channel:
                message_type = "channel_message"
            elif (
                message.relevant_mod
                and not message.destination_id
                and not message.target_channel
            ):
                # Could be either broadcast or mod message - check event_name for hint
                if "broadcast" in message.event_name.lower():
                    message_type = "broadcast_message"
                else:
                    message_type = "mod_message"
            else:
                message_type = "broadcast_message"

            logger.debug(
                f"Auto-classified message as {message_type} based on properties"
            )

        if message_type in self.message_handlers:
            # Call all handlers for this message type
            for handler in reversed(self.message_handlers[message_type]):
                try:
                    await handler(message)
                except Exception as e:
                    logger.error(f"Error in message handler for {message_type}: {e}")

    async def send_message(self, message: Event) -> bool:
        """Send an event to the network.

        Args:
            message: Event to send (now extends Event)

        Returns:
            bool: True if event sent successfully, False otherwise
        """
        if not self.is_connected:
            logger.debug(f"Agent {self.agent_id} is not connected to a network")
            return False

        try:
            # Ensure source_id is set (Event field)
            if not message.source_id:
                message.source_id = self.agent_id

            # For Event backward compatibility
            if message.relevant_mod:
                if not message.relevant_agent_id:
                    message.relevant_agent_id = self.agent_id

            # Convert Event to transport format
            event_data = message.to_dict()

            await self.connection.send(
                json.dumps(
                    {
                        "type": "event",  # Changed from "message" to "event"
                        "data": event_data,
                    }
                )
            )

            logger.debug(f"Message sent: {message.message_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to send message: {e}")
            return False

    async def send_direct_message(self, message: Event) -> bool:
        """Send a direct message to another agent.

        Args:
            message: Direct message to send
        """
        return await self.send_message(message)

    async def send_broadcast_message(self, message: Event) -> bool:
        """Send a broadcast message to all connected agents.

        Args:
            message: Broadcast message to send

        Returns:
            bool: True if message sent successfully, False otherwise
        """
        return await self.send_message(message)

    async def send_mod_message(self, message: Event) -> bool:
        """Send a mod message to another agent.

        Args:
            message: Protocol message to send
        """
        return await self.send_message(message)

    async def wait_mod_message(
        self,
        mod_name: str,
        filter_dict: Optional[Dict[str, Any]] = None,
        timeout: float = 5.0,
    ) -> Optional[Event]:
        """Wait for a mod message from the specified mod that matches the filter criteria.

        Args:
            mod_name: The mod name to match
            filter_dict: Optional dictionary of key-value pairs to match in the message content
            timeout: Maximum time to wait for a response in seconds

        Returns:
            Optional[Event]: The matching message, or None if no matching message received within timeout
        """
        if not self.is_connected:
            logger.debug(f"Agent {self.agent_id} is not connected to a network")
            return None

        # Create a future to store the response
        response_future = asyncio.Future()

        async def temp_protocol_handler(msg: Event) -> None:
            # Check if this is the message we're waiting for
            if msg.mod == mod_name and msg.relevant_agent_id == self.agent_id:

                # If filter_dict is provided, check if all key-value pairs match in the content
                if filter_dict:
                    matches = True
                    for key, value in filter_dict.items():
                        if key not in msg.content or msg.content[key] != value:
                            matches = False
                            break

                    if matches:
                        response_future.set_result(msg)
                else:
                    # No filter, accept any message from this protocol
                    response_future.set_result(msg)

        # Register the temporary handler
        self.register_message_handler("mod_message", temp_protocol_handler)

        try:
            # Wait for the response with timeout
            try:
                response = await asyncio.wait_for(response_future, timeout)
                return response
            except asyncio.TimeoutError:
                filter_str = f" with filter {filter_dict}" if filter_dict else ""
                logger.warning(
                    f"Timeout waiting for mod message: {mod_name}{filter_str}"
                )
                return None

        finally:
            # Unregister the temporary handler
            self.unregister_message_handler("mod_message", temp_protocol_handler)

    async def wait_direct_message(
        self, sender_id: str, timeout: float = 5.0
    ) -> Optional[Event]:
        """Wait for a direct message from the specified sender.

        Args:
            sender_id: The ID of the sender to wait for
            timeout: Maximum time to wait for a response in seconds

        Returns:
            Optional[Event]: The received message or None if timeout occurs
        """
        # Create a future to be resolved when the message is received
        response_future = asyncio.Future()

        # Create a temporary handler that will resolve the future when the message arrives
        async def temp_direct_handler(msg: Event) -> None:
            # Check if this is the message we're waiting for
            if msg.source_id == sender_id:
                response_future.set_result(msg)

        # Register the temporary handler
        self.register_message_handler("direct_message", temp_direct_handler)

        try:
            # Wait for the response with timeout
            try:
                response = await asyncio.wait_for(response_future, timeout)
                return response
            except asyncio.TimeoutError:
                logger.warning(f"Timeout waiting for direct message from: {sender_id}")
                return None

        finally:
            # Unregister the temporary handler
            self.unregister_message_handler("direct_message", temp_direct_handler)

    async def send_system_request(self, command: str, **kwargs) -> bool:
        """Send a system request to the network server.

        Args:
            command: The system command to send
            **kwargs: Additional parameters for the command

        Returns:
            bool: True if request was sent successfully
        """
        if not self.is_connected:
            logger.debug(f"Agent {self.agent_id} is not connected to a network")
            return False

        # Automatically include the agent_id in system requests
        kwargs["agent_id"] = self.agent_id
        return await send_system_request_impl(self.connection, command, **kwargs)

    async def list_agents(self) -> bool:
        """Request a list of agents from the network server.

        Returns:
            bool: True if request was sent successfully
        """
        return await self.send_system_request(LIST_AGENTS)

    async def list_mods(self) -> bool:
        """Request a list of mods from the network server.

        Returns:
            bool: True if request was sent successfully
        """
        return await self.send_system_request(LIST_MODS)

    async def get_mod_manifest(self, mod_name: str) -> bool:
        """Request a mod manifest from the network server.

        Args:
            mod_name: Name of the mod to get the manifest for

        Returns:
            bool: True if request was sent successfully
        """
        return await self.send_system_request(GET_MOD_MANIFEST, mod_name=mod_name)

    async def claim_agent_id(self, agent_id: str, force: bool = False) -> bool:
        """Claim an agent ID and receive a certificate.

        Args:
            agent_id: The agent ID to claim
            force: If True, forcefully reclaim even if already claimed

        Returns:
            bool: True if request was sent successfully
        """
        return await self.send_system_request(
            CLAIM_AGENT_ID, agent_id=agent_id, force=force
        )

    async def validate_certificate(self, certificate_data: dict) -> bool:
        """Validate an agent certificate.

        Args:
            certificate_data: Certificate data to validate

        Returns:
            bool: True if request was sent successfully
        """
        return await self.send_system_request(
            VALIDATE_CERTIFICATE, certificate=certificate_data
        )
