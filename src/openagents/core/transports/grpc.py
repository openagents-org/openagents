"""
gRPC Transport Implementation for OpenAgents.

This module provides the gRPC transport implementation and servicer for agent communication.
"""

import json
import logging
import re
from typing import Dict, Any, Optional
import time

import grpc
from grpc import aio
from openagents.config.globals import (
    SYSTEM_EVENT_HEARTBEAT,
    SYSTEM_EVENT_REGISTER_AGENT,
    SYSTEM_EVENT_UNREGISTER_AGENT,
)
from openagents.proto import agent_service_pb2_grpc, agent_service_pb2

from .base import Transport
from openagents.models.transport import TransportType, ConnectionState, ConnectionInfo
from openagents.models.event import Event
from openagents.models.event_response import EventResponse

logger = logging.getLogger(__name__)


class OpenAgentsGRPCServicer(agent_service_pb2_grpc.AgentServiceServicer):
    """gRPC servicer for the OpenAgents transport."""

    def __init__(self, transport: "GRPCTransport"):
        self.transport = transport

    async def SendEvent(self, request, context):
        """Unified event handling for all message and system command types."""
        try:
            logger.debug(
                f"gRPC unified event: {request.event_name} from {request.source_id}"
            )

            # Extract payload from protobuf Any field
            payload = self._extract_payload_from_protobuf(request.payload)

            # Create internal Event from gRPC Event
            event = Event(
                event_name=request.event_name,
                source_id=request.source_id,
                destination_id=request.target_agent_id or None,
                payload=payload,
                event_id=request.event_id,
                timestamp=request.timestamp if request.timestamp else int(time.time()),
                metadata=dict(request.metadata) if request.metadata else {},
                visibility=request.visibility if request.visibility else "network",
                secret=request.secret if hasattr(request, 'secret') else None,
            )

            # Route through unified handler
            event_response = await self._handle_sent_event(event)

            # Extract response data from EventResponse
            response_data = None
            if (
                event_response
                and hasattr(event_response, "data")
                and event_response.data
            ):
                response_data = event_response.data

            # Serialize response data if available
            protobuf_response_data = None
            if response_data and isinstance(response_data, dict):
                from google.protobuf.any_pb2 import Any

                try:
                    response_any = Any()
                    response_any.type_url = (
                        "type.googleapis.com/openagents.EventResponseData"
                    )
                    response_any.value = json.dumps(response_data, default=str).encode(
                        "utf-8"
                    )
                    protobuf_response_data = response_any
                    logger.debug(
                        f"🔧 GRPC_TRANSPORT: Successfully serialized unified event response for {request.event_name}"
                    )
                except Exception as serialization_error:
                    logger.error(
                        f"🔧 GRPC_TRANSPORT: JSON serialization failed for {request.event_name}: {serialization_error}"
                    )

            return agent_service_pb2.EventResponse(
                success=event_response.success if event_response else True,
                message=event_response.message if event_response else "",
                data=protobuf_response_data,
                event_name=request.event_name,
            )

        except Exception as e:
            logger.error(f"Error handling unified gRPC event {request.event_name}: {e}")
            return agent_service_pb2.EventResponse(
                success=False, message=str(e), event_name=request.event_name
            )

    async def Heartbeat(self, request, context):
        """Handle heartbeat requests."""
        logger.debug(f"gRPC Heartbeat received from {request.agent_id}")
        current_timestamp = int(time.time())
        heartbeat_event = Event(
            event_name=SYSTEM_EVENT_HEARTBEAT,
            source_id=request.agent_id,
            payload={"agent_id": request.agent_id, "timestamp": current_timestamp},
        )
        await self.transport.call_event_handler(heartbeat_event)
        return agent_service_pb2.HeartbeatResponse(
            success=True, timestamp=current_timestamp
        )

    async def RegisterAgent(self, request, context):
        """Handle agent registration."""
        logger.info(f"Agent registration: {request.agent_id}")

        # Extract metadata from request
        metadata = dict(request.metadata) if request.metadata else {}

        # Register with network instance if available
        register_event = Event(
            event_name=SYSTEM_EVENT_REGISTER_AGENT,
            source_id=request.agent_id,
            payload={
                "agent_id": request.agent_id,
                "metadata": metadata,
                "transport_type": TransportType.GRPC,
                "certificate": getattr(request, "certificate", None),
                "force_reconnect": getattr(request, "force_reconnect", True),
                "password_hash": getattr(request, "password_hash", None),
            },
        )
        try:
            return_data = await self.transport.call_event_handler(register_event)
            logger.info(
                f"✅ Successfully registered agent {request.agent_id} with network"
            )
            
            # Extract secret from response data
            secret = ""
            if return_data.success and return_data.data and isinstance(return_data.data, dict):
                secret = return_data.data.get("secret", "")
            
            return agent_service_pb2.RegisterAgentResponse(
                success=return_data.success,
                error_message=return_data.message if not return_data.success else "",
                secret=secret,
            )
        except Exception as e:
            logger.error(f"Error calling event handler: {e}")
            return agent_service_pb2.RegisterAgentResponse(
                success=False, error_message=str(e)
            )

    async def UnregisterAgent(self, request, context):
        """Handle agent unregistration."""
        logger.info(f"Agent unregistration: {request.agent_id}")
        unregister_event = Event(
            event_name=SYSTEM_EVENT_UNREGISTER_AGENT,
            source_id=request.agent_id,
            payload={"agent_id": request.agent_id},
            secret=getattr(request, 'secret', None),
        )
        
        # Process the unregistration event through the event handler
        event_response = await self.transport.call_event_handler(unregister_event)
        
        if event_response and event_response.success:
            return agent_service_pb2.UnregisterAgentResponse(success=True)
        else:
            error_message = (
                event_response.message
                if event_response
                else "No response from event handler"
            )
            return agent_service_pb2.UnregisterAgentResponse(
                success=False, error_message=error_message
            )

    def _extract_payload_from_protobuf(self, protobuf_payload):
        """Extract payload from protobuf Any field with various fallback strategies."""
        payload = {}
        if protobuf_payload and protobuf_payload.value:
            try:
                # Unpack protobuf Struct from Any field
                from google.protobuf.struct_pb2 import Struct
                from google.protobuf.json_format import MessageToDict

                struct = Struct()
                protobuf_payload.Unpack(struct)
                payload_dict = MessageToDict(struct)

                logger.debug(f"Decoded protobuf payload: {payload_dict}")

                # Handle different payload structures

                # Case 1: Check if the main payload contains a 'payload' field with protobuf text format
                if (
                    "payload" in payload_dict
                    and isinstance(payload_dict["payload"], str)
                    and "fields {" in payload_dict["payload"]
                ):
                    # This is the protobuf text format case - extract the simple key-value pairs
                    extracted_payload = {}
                    protobuf_text = payload_dict["payload"]

                    # Pattern to match: key: "text" value { string_value: "Hello everyone!" }
                    field_pattern = r'key:\s*"([^"]+)"\s+value\s*\{\s*string_value:\s*"([^"]*)"\s*\}'
                    for match in re.finditer(field_pattern, protobuf_text):
                        key, value = match.groups()
                        # Handle escaped quotes in the value
                        value = value.replace("\\'", "'")
                        extracted_payload[key] = value

                    if extracted_payload:
                        payload = extracted_payload
                        logger.debug(f"Extracted payload from protobuf text: {payload}")
                    else:
                        payload = payload_dict

                # Case 2: Check if payload has nested 'payload' dict (Event serialized into payload)
                elif "payload" in payload_dict and isinstance(
                    payload_dict["payload"], dict
                ):
                    # The original payload is nested inside - extract it
                    nested_payload = payload_dict["payload"]
                    if "text" in nested_payload or "message_type" in nested_payload:
                        # This looks like the original simple payload we want
                        payload = nested_payload
                        logger.debug(f"Extracted nested payload: {payload}")
                    else:
                        payload = payload_dict
                else:
                    # If no special cases, use the payload as-is
                    payload = payload_dict
            except Exception as e:
                logger.warning(f"Could not decode protobuf payload: {e}")
                # Fallback: try JSON decode
                try:
                    payload = json.loads(protobuf_payload.value.decode("utf-8"))
                except (json.JSONDecodeError, UnicodeDecodeError) as e2:
                    logger.warning(f"Could not decode as JSON either: {e2}")
                    payload = {"raw_data": protobuf_payload.value.hex()}
        return payload

    async def _handle_sent_event(self, event):
        """Unified event handler that routes both regular messages and system commands."""
        logger.debug(
            f"Processing unified event: {event.event_name} from {event.source_id}"
        )

        # Notify registered event handlers and return the response
        response = await self.transport.call_event_handler(event)
        return response


class GRPCTransport(Transport):
    """gRPC transport implementation."""

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        super().__init__(TransportType.GRPC, config)
        self.server = None
        self.servicer = None
        self.host = self.config.get("host", "localhost")
        self.port = self.config.get("port", 50051)

    async def initialize(self) -> bool:
        """Initialize gRPC transport."""
        try:
            from concurrent import futures

            self.grpc = grpc
            self.futures = futures
            self.is_initialized = True
            logger.info("gRPC transport initialized")
            return True
        except ImportError:
            logger.error("grpcio library not installed")
            return False

    async def shutdown(self) -> bool:
        """Shutdown gRPC transport."""
        try:
            if self.server:
                await self.server.stop(grace=5)  # 5 second grace period
                logger.info("gRPC server shutdown")
                self.server = None

            self.peer_connections.clear()
            self.is_initialized = False
            self.is_listening = False
            return True
        except Exception as e:
            logger.error(f"Error shutting down gRPC transport: {e}")
            return False

    async def connect(self, peer_id: str, address: str) -> bool:
        """Connect to gRPC peer (client-side)."""
        try:
            # gRPC connections are typically managed by the framework
            self.peer_connections[peer_id] = ConnectionInfo(
                connection_id=peer_id,
                peer_id=peer_id,
                address=address,
                state=ConnectionState.CONNECTED,
                transport_type=TransportType.GRPC,
            )
            logger.info(f"Registered gRPC connection to {peer_id} at {address}")
            return True
        except Exception as e:
            logger.error(f"Failed to connect to gRPC peer {peer_id}: {e}")
            return False

    async def disconnect(self, peer_id: str) -> bool:
        """Disconnect from gRPC peer."""
        try:
            if peer_id in self.peer_connections:
                del self.peer_connections[peer_id]
            logger.info(f"Disconnected from gRPC peer {peer_id}")
            return True
        except Exception as e:
            logger.error(f"Error disconnecting from gRPC peer {peer_id}: {e}")
            return False

    async def send(self, message: Event) -> EventResponse:
        """Send event via gRPC."""
        # TODO: Implement gRPC message sending
        try:
            # gRPC message sending is typically handled by the servicer
            # This is a simplified implementation
            logger.debug(
                f"Sending gRPC message from {message.source_id} to {message.destination_id}"
            )
            return EventResponse(
                success=True, message="Event sent successfully via gRPC transport"
            )
        except Exception as e:
            logger.error(f"Error sending gRPC message: {e}")
            return EventResponse(
                success=False, message=f"Error sending gRPC message: {str(e)}"
            )

    async def listen(self, address: str) -> bool:
        """Start gRPC server."""
        try:
            host, port = (
                address.split(":") if ":" in address else (self.host, int(address))
            )
            port = int(port) if isinstance(port, str) else port

            # Create and start gRPC server
            self.server = aio.server()
            self.servicer = OpenAgentsGRPCServicer(self)
            agent_service_pb2_grpc.add_AgentServiceServicer_to_server(
                self.servicer, self.server
            )

            listen_addr = f"{host}:{port}"
            
            # Check if TLS is configured
            tls_config = self.config.get("tls")
            if tls_config and isinstance(tls_config, dict) and tls_config.get("enabled"):
                # Create SSL server credentials
                server_credentials = self._create_server_credentials(tls_config)
                self.server.add_secure_port(listen_addr, server_credentials)
                logger.info(f"gRPCS transport listening on {host}:{port} (TLS enabled)")
            else:
                # Non-TLS server
                self.server.add_insecure_port(listen_addr)
                logger.info(f"gRPC transport listening on {host}:{port}")

            await self.server.start()
            self.is_listening = True
            return True

        except ImportError as e:
            logger.error(f"gRPC libraries not available: {e}")
            return False
        except Exception as e:
            logger.error(f"Failed to start gRPC server: {e}")
            return False

    def _create_server_credentials(self, tls_config: Dict[str, Any]) -> grpc.ServerCredentials:
        """Create SSL server credentials from TLS configuration.

        Args:
            tls_config: TLS configuration dictionary

        Returns:
            grpc.ServerCredentials configured for TLS
        """
        cert_file = tls_config.get("cert_file")
        key_file = tls_config.get("key_file")
        ca_file = tls_config.get("ca_file")
        require_client_cert = tls_config.get("require_client_cert", False)

        if not cert_file or not key_file:
            raise ValueError(
                f"TLS enabled but required files missing - "
                f"cert_file: {cert_file or 'not provided'}, "
                f"key_file: {key_file or 'not provided'}"
            )

        # Read certificate files
        with open(cert_file, 'rb') as f:
            server_cert = f.read()
        with open(key_file, 'rb') as f:
            server_key = f.read()

        # Optional CA certificate for client verification
        root_ca = None
        if ca_file:
            with open(ca_file, 'rb') as f:
                root_ca = f.read()

        # Create credentials
        if require_client_cert and root_ca:
            # mTLS: require and verify client certificates
            logger.info("Creating gRPC server credentials with mTLS (client cert required)")
            return grpc.ssl_server_credentials(
                [(server_key, server_cert)],
                root_certificates=root_ca,
                require_client_auth=True
            )
        else:
            # Server-only TLS
            logger.info("Creating gRPC server credentials with TLS (no client cert)")
            return grpc.ssl_server_credentials(
                [(server_key, server_cert)]
            )

    async def peer_connect(self, peer_id: str, metadata: Dict[str, Any] = None) -> bool:
        """Connect to a gRPC peer."""
        logger.debug(f"gRPC transport peer_connect called for {peer_id}")
        # For gRPC, connections are managed by the gRPC framework
        # We just track the peer in our connections
        if peer_id not in self.peer_connections:
            self.peer_connections[peer_id] = ConnectionInfo(
                peer_id=peer_id,
                transport_type=TransportType.GRPC,
                connection_state=ConnectionState.CONNECTED,
                metadata=metadata or {},
            )
        return True

    async def peer_disconnect(self, peer_id: str) -> bool:
        """Disconnect from a gRPC peer."""
        logger.debug(f"gRPC transport peer_disconnect called for {peer_id}")
        if peer_id in self.peer_connections:
            del self.peer_connections[peer_id]
        return True


# Convenience function for creating gRPC transport
def create_grpc_transport(
    host: str = "localhost", port: int = 50051, **kwargs
) -> GRPCTransport:
    """Create a gRPC transport with given configuration."""
    config = {"host": host, "port": port, **kwargs}
    return GRPCTransport(config)
