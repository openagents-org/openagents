"""
gRPC Network Connector for OpenAgents

Provides gRPC-based connectivity for agents to connect to gRPC networks.
This is an alternative to the WebSocket-based NetworkConnector.
"""

import asyncio
import json
import logging
import time
from typing import Dict, Any, Optional, Callable, Awaitable, List

from openagents.config.globals import SYSTEM_EVENT_POLL_MESSAGES
from openagents.models.event_response import EventResponse
from openagents.models.messages import Event, EventNames
from openagents.models.event import Event
from openagents.core.connectors.base import NetworkConnector
from openagents.utils.cli_display import print_box

logger = logging.getLogger(__name__)


class GRPCNetworkConnector(NetworkConnector):
    """Handles gRPC network connections and message passing for agents.

    This connector allows agents to connect to gRPC-based networks using
    the AgentService gRPC interface.
    """

    def __init__(
        self,
        host: str,
        port: int,
        agent_id: str,
        metadata: Optional[Dict[str, Any]] = None,
        max_message_size: int = 104857600,
        password_hash: Optional[str] = None,
        use_tls: bool = False,
        ssl_ca_cert: Optional[str] = None,
        ssl_client_cert: Optional[str] = None,
        ssl_client_key: Optional[str] = None,
        ssl_verify: bool = True,
    ):
        """Initialize a gRPC network connector.

        Args:
            host: Server host address
            port: Server port
            agent_id: Agent identifier
            metadata: Agent metadata to send during registration
            max_message_size: Maximum message size in bytes (default 100MB)
            password_hash: Password hash for agent group authentication
            use_tls: Whether to use TLS/SSL for the connection
            ssl_ca_cert: Path to CA certificate for server verification
            ssl_client_cert: Path to client certificate for mTLS
            ssl_client_key: Path to client private key for mTLS
            ssl_verify: Whether to verify server certificate (default: True)
        """
        # Initialize base connector
        super().__init__(host, port, agent_id, metadata)

        self.max_message_size = max_message_size
        self.password_hash = password_hash
        self.is_polling = True  # gRPC uses polling for message retrieval

        # SSL/TLS configuration
        self.use_tls = use_tls
        self.ssl_ca_cert = ssl_ca_cert
        self.ssl_client_cert = ssl_client_cert
        self.ssl_client_key = ssl_client_key
        self.ssl_verify = ssl_verify

        # gRPC components
        self.channel = None
        self.stub = None
        self.stream = None

        # gRPC modules (loaded on demand)
        self.grpc = None
        self.aio = None
        self.agent_service_pb2 = None
        self.agent_service_pb2_grpc = None

    async def _load_grpc_modules(self):
        """Load gRPC modules on demand."""
        if self.grpc is None:
            try:
                import grpc
                from grpc import aio
                from openagents.proto import agent_service_pb2
                from openagents.proto import agent_service_pb2_grpc

                self.grpc = grpc
                self.aio = aio
                self.agent_service_pb2 = agent_service_pb2
                self.agent_service_pb2_grpc = agent_service_pb2_grpc

                logger.debug("gRPC modules loaded successfully")
                return True
            except ImportError as e:
                logger.error(f"Failed to load gRPC modules: {e}")
                return False
        return True

    async def connect_to_server(self) -> bool:
        """Connect to a gRPC network server.

        Returns:
            bool: True if connection successful
        """
        try:
            # Load gRPC modules
            if not await self._load_grpc_modules():
                return False

            # Create gRPC channel with configuration
            options = [
                ("grpc.keepalive_time_ms", 60000),  # 60 seconds - less aggressive
                ("grpc.keepalive_timeout_ms", 30000),  # 30 seconds
                (
                    "grpc.keepalive_permit_without_calls",
                    False,
                ),  # Disable keepalive without calls
                ("grpc.http2_max_pings_without_data", 0),  # Disable pings without data
                (
                    "grpc.http2_min_time_between_pings_ms",
                    60000,
                ),  # 60 seconds between pings
                (
                    "grpc.http2_min_ping_interval_without_data_ms",
                    300000,
                ),  # 5 minutes without data
                ("grpc.max_receive_message_length", self.max_message_size),
                ("grpc.max_send_message_length", self.max_message_size),
            ]

            address = f"{self.host}:{self.port}"
            
            # Create channel based on TLS configuration
            if self.use_tls:
                credentials = self._create_client_credentials()
                self.channel = self.aio.secure_channel(address, credentials, options=options)
                logger.info(f"Connecting to gRPCS server at {address} (TLS enabled)")
                if not self.ssl_verify:
                    logger.warning("⚠️  SSL certificate verification is disabled - use only for development!")
            else:
                self.channel = self.aio.insecure_channel(address, options=options)
                logger.info(f"Connecting to gRPC server at {address}")
            
            self.stub = self.agent_service_pb2_grpc.AgentServiceStub(self.channel)

            # Test connection with heartbeat
            heartbeat_request = self.agent_service_pb2.HeartbeatRequest(
                agent_id=self.agent_id, timestamp=int(time.time())
            )

            try:
                heartbeat_response = await self.stub.Heartbeat(
                    heartbeat_request, timeout=5.0
                )
                if not heartbeat_response.success:
                    logger.error("Server heartbeat failed")
                    return False
            except Exception as e:
                logger.error(f"Failed to send heartbeat to gRPC server: {e}")
                return False

            # Register with server
            register_request = self.agent_service_pb2.RegisterAgentRequest(
                agent_id=self.agent_id,
                metadata=self.metadata,
                capabilities=[],  # TODO: Add capabilities if needed
                password_hash=self.password_hash or "",
            )

            register_response = await self.stub.RegisterAgent(register_request)
            if not register_response.success:
                logger.error(
                    f"Agent registration failed: {register_response.error_message}"
                )
                return False

            # Store authentication secret
            if hasattr(register_response, 'secret') and register_response.secret:
                self.secret = register_response.secret
                logger.debug(f"Stored authentication secret for agent {self.agent_id}")
            else:
                logger.warning(f"No secret received from network for agent {self.agent_id}")

            logger.info(f"Connected to {'gRPCS' if self.use_tls else 'gRPC'} network successfully")

            # For now, skip bidirectional streaming and use unary calls
            # TODO: Implement proper streaming later
            self.is_connected = True
            logger.debug("gRPC connection established (using unary calls)")

            return True

        except Exception as e:
            logger.error(f"gRPC connection error: {e}")
            return False

    def _create_client_credentials(self) -> "grpc.ChannelCredentials":
        """Create SSL client credentials.
        
        Returns:
            grpc.ChannelCredentials configured for TLS
        """
        if not self.ssl_verify:
            # Skip verification (development only)
            logger.debug("Creating gRPC client credentials with verification disabled")
            return self.grpc.ssl_channel_credentials()

        # Load CA certificate
        root_ca = None
        if self.ssl_ca_cert:
            with open(self.ssl_ca_cert, 'rb') as f:
                root_ca = f.read()
            logger.debug(f"Loaded CA certificate from {self.ssl_ca_cert}")

        # Load client certificate for mTLS
        client_cert = None
        client_key = None
        if self.ssl_client_cert:
            with open(self.ssl_client_cert, 'rb') as f:
                client_cert = f.read()
            with open(self.ssl_client_key, 'rb') as f:
                client_key = f.read()
            logger.debug(f"Loaded client certificate from {self.ssl_client_cert} for mTLS")

        return self.grpc.ssl_channel_credentials(
            root_certificates=root_ca,
            private_key=client_key,
            certificate_chain=client_cert
        )

    async def disconnect(self) -> bool:
        """Disconnect from the gRPC network server.

        Returns:
            bool: True if disconnection was successful
        """
        try:
            self.is_connected = False

            # Cancel message listener task if exists
            if (
                hasattr(self, "message_listener_task")
                and self.event_listener_task
                and not self.event_listener_task.done()
            ):
                self.event_listener_task.cancel()
                try:
                    await self.event_listener_task
                except asyncio.CancelledError:
                    pass

            # Cancel streaming call if exists
            if hasattr(self, "stream") and self.stream:
                self.stream.cancel()
                self.stream = None

            # Unregister from server
            if self.stub:
                try:
                    unregister_request = self.agent_service_pb2.UnregisterAgentRequest(
                        agent_id=self.agent_id,
                        secret=self.secret or ""
                    )
                    await self.stub.UnregisterAgent(unregister_request, timeout=5.0)
                except Exception as e:
                    logger.warning(f"Failed to unregister agent: {e}")

            # Close channel
            if self.channel:
                await self.channel.close()
                self.channel = None
                self.stub = None

            logger.info(f"Agent {self.agent_id} disconnected from gRPC network")
            return True

        except Exception as e:
            logger.error(f"Error disconnecting from gRPC network: {e}")
            return False

    # Note: Streaming methods removed for simplicity
    # TODO: Implement bidirectional streaming for better performance

    async def send_event(self, message: Event) -> EventResponse:
        """Send an event via gRPC.

        Args:
            message: Event to send (now extends Event)

        Returns:
            EventResponse: The response from the server
        """
        # Display the event being sent in a box
        import json

        # Format payload for display
        if not message.event_name.startswith("system."):
            payload_str = json.dumps(
                {k: v for k, v in (message.payload or {}).items() if v is not None}, 
                indent=2, 
                default=str
            )
            if len(payload_str) > 500:
                payload_preview = payload_str[:500] + "..."
            else:
                payload_preview = payload_str

            lines = [
                f"Event:  {message.event_name}",
                f"Source: {message.source_id}",
                f"Target: {message.destination_id or 'None'}",
                "─" * 66,
            ]
            for line in payload_preview.split('\n'):
                lines.append(line)

            print_box("📤 SENDING EVENT (GRPC)", lines, color_code="\033[92m")
            
        if not self.is_connected:
            logger.debug(f"Agent {self.agent_id} is not connected to gRPC network")
            return self._create_error_response("Agent is not connected to gRPC network")

        try:
            # Validate event using base class method
            if not self._validate_event(message):
                return self._create_error_response("Event validation failed")

            # Add authentication secret to the message
            if self.secret and not message.secret:
                message.secret = self.secret

            # Send event via unified gRPC SendEvent
            grpc_event = self._to_grpc_event(message)

            # Send the event to the server using unified SendEvent
            response = await self.stub.SendEvent(grpc_event)

            # Convert gRPC response to EventResponse
            response_data = None
            if response.data and response.data.value:
                try:
                    # Try to unpack as protobuf Struct first
                    from google.protobuf.struct_pb2 import Struct
                    from google.protobuf.json_format import MessageToDict

                    struct = Struct()
                    if response.data.Unpack(struct):
                        response_data = MessageToDict(struct)
                        logger.debug(
                            f"Successfully unpacked response data as protobuf Struct"
                        )
                    else:
                        # Fallback to JSON decoding
                        import json

                        response_data = json.loads(response.data.value.decode("utf-8"))
                        logger.debug(f"Successfully decoded response data as JSON")
                except Exception as e:
                    logger.warning(f"Failed to decode response data: {e}")
                    # Last resort: try to extract raw string
                    try:
                        response_data = {
                            "raw_response": response.data.value.decode("utf-8")
                        }
                    except:
                        response_data = {"error": "Failed to decode response data"}

            if response.success:
                logger.debug(f"Successfully sent gRPC event {message.event_id}")
                return self._create_success_response(response.message, response_data)
            else:
                logger.error(
                    f"Failed to send gRPC event {message.event_id}: {response.message}"
                )
                return EventResponse(success=False, message=response.message, data=response_data)

        except Exception as e:
            # Handle gRPC-specific errors
            error_message = f"Failed to send gRPC message: {str(e)}"

            # Check for common gRPC errors
            if hasattr(e, "code"):
                if hasattr(e.code(), "name"):
                    error_message = f"gRPC error {e.code().name}: {e.details()}"
                else:
                    error_message = f"gRPC error: {e.details()}"

            logger.error(error_message)
            return self._create_error_response(error_message)

    async def poll_messages(self) -> List[Event]:
        """Poll for queued messages from the gRPC network server.

        Returns:
            List of Event objects waiting for this agent
        """
        if not self.is_connected:
            logger.debug(f"Agent {self.agent_id} is not connected to gRPC network")
            return []

        try:
            # Create poll messages event
            poll_event = Event(
                event_name=SYSTEM_EVENT_POLL_MESSAGES,
                source_id=self.agent_id,
                destination_id="system:system",
                payload={"agent_id": self.agent_id},
            )

            # Send the poll request
            response = await self.send_event(poll_event)

            if not response or not response.success:
                logger.warning(
                    f"Poll messages request failed: {response.message if response else 'No response'}"
                )
                return []

            # Extract messages from response data
            messages = []
            if response.data:
                try:
                    # Handle different response data structures
                    response_messages = []

                    if isinstance(response.data, list):
                        # Direct list of messages
                        response_messages = response.data
                        logger.debug(
                            f"🔧 GRPC: Received direct list of {len(response_messages)} messages"
                        )
                    elif isinstance(response.data, dict):
                        if "messages" in response.data:
                            # Response wrapped in a dict with 'messages' key
                            response_messages = response.data["messages"]
                            logger.debug(
                                f"🔧 GRPC: Extracted {len(response_messages)} messages from response dict"
                            )
                        else:
                            logger.warning(
                                f"🔧 GRPC: Dict response missing 'messages' key: {list(response.data.keys())}"
                            )
                            return []
                    else:
                        logger.warning(
                            f"🔧 GRPC: Unexpected poll_messages response format: {type(response.data)} - {response.data}"
                        )
                        return []

                    logger.debug(
                        f"🔧 GRPC: Processing {len(response_messages)} polled messages for {self.agent_id}"
                    )

                    # Convert each message to Event object
                    for message_data in response_messages:
                        try:
                            if isinstance(message_data, dict):
                                if "event_name" in message_data:
                                    # This is already an Event structure
                                    event = Event(**message_data)
                                    messages.append(event)
                                    logger.debug(
                                        f"🔧 GRPC: Successfully converted message to Event: {event.event_id}"
                                    )
                                else:
                                    # This might be a legacy message format - try to parse it
                                    from openagents.utils.message_util import (
                                        parse_message_dict,
                                    )

                                    event = parse_message_dict(message_data)
                                    if event:
                                        messages.append(event)
                                        logger.debug(
                                            f"🔧 GRPC: Successfully parsed legacy message to Event: {event.event_id}"
                                        )
                                    else:
                                        logger.warning(
                                            f"🔧 GRPC: Failed to parse message data: {message_data}"
                                        )
                            else:
                                logger.warning(
                                    f"🔧 GRPC: Invalid message format in poll response: {message_data}"
                                )

                        except Exception as e:
                            logger.error(
                                f"🔧 GRPC: Error processing polled message: {e}"
                            )
                            logger.debug(
                                f"🔧 GRPC: Problematic message data: {message_data}"
                            )

                    logger.debug(
                        f"🔧 GRPC: Successfully converted {len(messages)} messages to Events"
                    )
                    for event in messages:
                        await self.consume_message(event)
                    return messages

                except Exception as e:
                    logger.error(f"🔧 GRPC: Error parsing poll_messages response: {e}")
                    return []
            else:
                logger.debug(f"🔧 GRPC: No messages in poll response")
                return []

        except Exception as e:
            logger.error(f"Failed to poll messages: {e}")
            return []

    def _to_grpc_event(self, event: Event):
        """Convert internal event to unified gRPC Event format."""
        # Create unified gRPC Event
        grpc_event = self.agent_service_pb2.Event(
            event_id=event.event_id,
            event_name=event.event_name,
            source_id=event.source_id,
            target_agent_id=event.destination_id or "",
            timestamp=int(event.timestamp),
            visibility=event.visibility if hasattr(event, "visibility") else "network",
            relevant_mod=event.relevant_mod or "",
            secret=getattr(event, 'secret', '') or '',
        )

        # Add metadata
        if event.metadata:
            for key, value in event.metadata.items():
                grpc_event.metadata[key] = str(value)

        # Serialize event payload to protobuf Any field
        try:
            from google.protobuf.any_pb2 import Any
            from google.protobuf.struct_pb2 import Struct

            # Convert event payload to protobuf Struct
            struct = Struct()
            if event.payload:
                payload_data = self._make_json_serializable(event.payload)
                struct.update(payload_data)

            # Pack into Any field
            any_field = Any()
            any_field.Pack(struct)
            grpc_event.payload.CopyFrom(any_field)

        except Exception as e:
            logger.error(
                f"Failed to serialize event payload for {event.event_name}: {e}"
            )
            raise

        return grpc_event

    def _make_json_serializable(self, obj):
        """Convert an object to be JSON serializable, handling gRPC types."""
        import json
        from enum import Enum
        from google.protobuf.struct_pb2 import ListValue, Struct
        from google.protobuf.message import Message

        if isinstance(obj, dict):
            return {k: self._make_json_serializable(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [self._make_json_serializable(item) for item in obj]
        elif isinstance(obj, tuple):
            return [self._make_json_serializable(item) for item in obj]
        elif isinstance(obj, Enum):
            # Handle enum types by converting to their value
            return obj.value
        elif isinstance(obj, ListValue):
            return [self._make_json_serializable(item) for item in obj]
        elif isinstance(obj, Struct):
            return dict(obj)
        elif isinstance(obj, Message):
            # Convert protobuf message to dict
            from google.protobuf.json_format import MessageToDict

            return MessageToDict(obj)
        elif hasattr(obj, "__dict__"):
            # Handle custom objects by converting to dict
            try:
                return {
                    k: self._make_json_serializable(v) for k, v in obj.__dict__.items()
                }
            except:
                return str(obj)
        else:
            # Try to serialize directly, fallback to string representation
            try:
                json.dumps(obj)
                return obj
            except (TypeError, ValueError):
                return str(obj)

    def _from_grpc_message(self, grpc_message) -> Dict[str, Any]:
        """Convert gRPC message to internal message format."""
        content = {}

        # Deserialize message content from protobuf Any field
        try:
            if grpc_message.payload and grpc_message.payload.value:
                from google.protobuf.struct_pb2 import Struct

                # Unpack from Any
                struct = Struct()
                if grpc_message.payload.Unpack(struct):
                    # Convert Struct to dict
                    content = dict(struct)

        except Exception as e:
            logger.warning(f"Failed to deserialize message content: {e}")

        return {
            "type": "message",
            "data": {
                "message_id": grpc_message.message_id,
                "sender_id": grpc_message.sender_id,
                "target_id": grpc_message.target_id,
                "message_type": grpc_message.message_type,
                "content": content,
                "timestamp": grpc_message.timestamp,
            },
        }
