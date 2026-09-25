"""
Transport Layer for OpenAgents.

This package provides transport implementations for agent communication.
Includes WebSocket, gRPC, and base transport abstractions.
"""

from importlib import import_module
from typing import Any

# Import transport types and models
from openagents.models.event import Event

# Import base classes
from openagents.models.network_context import NetworkContext
from openagents.models.transport import (
    AgentConnection,
    ConnectionInfo,
    ConnectionState,
    PeerMetadata,
    TransportType,
)

from .a2a import A2ATransport, create_a2a_transport
from .base import Message, Transport
from .http import HttpTransport
from .mcp import MCPTransport, create_mcp_transport

# Import transport implementations
from .websocket import WebSocketTransport, create_websocket_transport

_GRPC_EXPORTS = {
    "GRPCTransport",
    "OpenAgentsGRPCServicer",
    "create_grpc_transport",
}

# Simplified exports - only working transports
__all__ = [
    # Base classes
    "Transport",
    "Message",
    "Event",
    # Transport implementations
    "WebSocketTransport",
    "GRPCTransport",
    "HttpTransport",
    "MCPTransport",
    "A2ATransport",
    "NetworkContext",
    # Convenience functions
    "create_websocket_transport",
    "create_grpc_transport",
    "create_mcp_transport",
    "create_a2a_transport",
    # Transport types and models
    "TransportType",
    "ConnectionState",
    "PeerMetadata",
    "ConnectionInfo",
    "AgentConnection",
    "OpenAgentsGRPCServicer",
]


def __getattr__(name: str) -> Any:
    """Load gRPC exports only when callers explicitly request them."""
    if name not in _GRPC_EXPORTS:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

    grpc_module = import_module(f"{__name__}.grpc")
    value = getattr(grpc_module, name)
    globals()[name] = value
    return value
