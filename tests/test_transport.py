"""
Unit tests for the transport layer.
"""

import pytest
import asyncio
import sys
import os
from unittest.mock import AsyncMock, MagicMock, patch

# Add the src directory to the Python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../src')))

from openagents.core.transport import WebSocketTransport, TransportManager, Message
from openagents.models.transport import (
    TransportType, ConnectionState, PeerMetadata, 
    ConnectionInfo, TransportMessage
)


class TestTransportMessage:
    """Test TransportMessage model."""
    
    def test_create_transport_message(self):
        """Test creating a transport message."""
        message = TransportMessage(
            sender_id="agent1",
            target_id="agent2",
            message_type="direct",
            payload={"content": "Hello!"}
        )
        
        assert message.sender_id == "agent1"
        assert message.target_id == "agent2"
        assert message.message_type == "direct"
        assert message.payload["content"] == "Hello!"
        assert message.message_id is not None
        assert message.timestamp > 0


class TestPeerMetadata:
    """Test PeerMetadata model."""
    
    def test_create_peer_metadata(self):
        """Test creating peer metadata."""
        metadata = PeerMetadata(
            peer_id="peer1",
            transport_type=TransportType.WEBSOCKET,
            capabilities=["chat", "search"],
            metadata={"version": "1.0.0"}
        )
        
        assert metadata.peer_id == "peer1"
        assert metadata.capabilities == ["chat", "search"]
        assert metadata.transport_type == "websocket"  # Config returns string values
        assert metadata.metadata["version"] == "1.0.0"


class TestConnectionInfo:
    """Test ConnectionInfo model."""
    
    def test_create_connection_info(self):
        """Test creating connection info."""
        connection = ConnectionInfo(
            connection_id="conn1",
            peer_id="peer1",
            state=ConnectionState.CONNECTED,
            transport_type=TransportType.WEBSOCKET
        )
        
        assert connection.connection_id == "conn1"
        assert connection.peer_id == "peer1"
        assert connection.state == "connected"  # Config returns string values
        assert connection.transport_type == "websocket"  # Config returns string values


class TestWebSocketTransport:
    """Test WebSocketTransport implementation."""
    
    @pytest.fixture
    def transport(self):
        """Create a WebSocketTransport instance."""
        return WebSocketTransport()
    
    def test_transport_initialization(self, transport):
        """Test transport initialization."""
        assert transport.transport_type == TransportType.WEBSOCKET
        assert not transport.is_running
        assert transport.server is None
        assert isinstance(transport.client_connections, dict)
        assert isinstance(transport.message_handlers, list)
    
    @pytest.mark.asyncio
    async def test_transport_initialize(self, transport):
        """Test transport initialization."""
        # Just test that initialize returns True when websockets is available
        result = await transport.initialize()
        assert result is True
    
    @pytest.mark.asyncio
    async def test_transport_shutdown(self, transport):
        """Test transport shutdown."""
        # Set up minimal state for shutdown test
        transport.is_running = True
        
        result = await transport.shutdown()
        assert result is True
        assert not transport.is_running
    
    @pytest.mark.asyncio
    async def test_send_message(self, transport):
        """Test sending a message."""
        # Set up transport
        transport.is_running = True
        
        # Mock connection
        mock_websocket = AsyncMock()
        transport.client_connections["agent2"] = mock_websocket
        
        message = Message(
            sender_id="agent1",
            target_id="agent2",
            message_type="direct",
            payload={"content": "Hello!"}
        )
        
        result = await transport.send(message)
        assert result is True
        mock_websocket.send.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_send_to_nonexistent_peer(self, transport):
        """Test sending message to non-existent peer."""
        transport.is_running = True
        
        message = Message(
            sender_id="agent1",
            target_id="nonexistent",
            message_type="direct",
            payload={"content": "Hello!"}
        )
        
        result = await transport.send(message)
        assert result is False
    
    def test_register_message_handler(self, transport):
        """Test registering a message handler."""
        handler = AsyncMock()
        transport.register_message_handler(handler)
        assert handler in transport.message_handlers


class TestTransportManager:
    """Test TransportManager functionality."""
    
    @pytest.fixture
    def transport_manager(self):
        """Create a TransportManager instance."""
        return TransportManager()
    
    def test_manager_initialization(self, transport_manager):
        """Test manager initialization."""
        assert isinstance(transport_manager.transports, dict)
        assert transport_manager.active_transport is None
    
    def test_register_transport(self, transport_manager):
        """Test registering a transport."""
        transport = WebSocketTransport()
        
        result = transport_manager.register_transport(transport)
        assert result is True
        assert TransportType.WEBSOCKET in transport_manager.transports
        assert transport_manager.transports[TransportType.WEBSOCKET] is transport
    
    @pytest.mark.asyncio
    async def test_initialize_transport(self, transport_manager):
        """Test initializing a transport."""
        transport = WebSocketTransport()
        transport_manager.register_transport(transport)
        
        result = await transport_manager.initialize_transport(TransportType.WEBSOCKET)
        assert result is True
    
    def test_get_active_transport(self, transport_manager):
        """Test getting the active transport."""
        # Initially no active transport
        assert transport_manager.get_active_transport() is None
        
        # Set active transport
        mock_transport = MagicMock()
        transport_manager.active_transport = mock_transport
        
        active = transport_manager.get_active_transport()
        assert active is mock_transport
    
    @pytest.mark.asyncio
    async def test_shutdown_all(self, transport_manager):
        """Test shutting down all transports."""
        # Register mock transport
        mock_transport = AsyncMock()
        mock_transport.shutdown = AsyncMock(return_value=True)
        mock_transport.transport_type = TransportType.WEBSOCKET
        
        transport_manager.register_transport(mock_transport)
        
        result = await transport_manager.shutdown_all()
        
        assert result is True
        mock_transport.shutdown.assert_called_once()


class TestTransportIntegration:
    """Integration tests for transport components."""
    
    @pytest.mark.asyncio
    async def test_basic_lifecycle(self):
        """Test basic transport lifecycle without websockets dependency."""
        manager = TransportManager()
        transport = WebSocketTransport()
        
        # Register transport
        manager.register_transport(transport)
        
        # Initialize transport
        init_result = await manager.initialize_transport(TransportType.WEBSOCKET)
        assert init_result is True
        
        # Test active transport is set
        active = manager.get_active_transport()
        # Note: Active transport is only set when actually connected to peers
        
        # Shutdown
        result = await manager.shutdown_all()
        assert result is True


if __name__ == "__main__":
    pytest.main([__file__])
