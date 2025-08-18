"""
Tests for the redesigned Thread Messaging mod.

This module contains comprehensive unit and integration tests for the redesigned
thread messaging functionality including:
- All 8 tools (send_direct_message, send_channel_message, upload_file, 
  reply_channel_message, reply_direct_message, list_channels,
  retrieve_channel_messages, retrieve_direct_messages)
- New message types (DirectMessage, ChannelMessage, ReplyMessage, etc.)
- 5-level Reddit-like threading
- Message retrieval with pagination
- File upload/download
- Channel management
- Message quoting
"""

import pytest
import asyncio
import tempfile
import uuid
import json
import base64
from pathlib import Path
from unittest.mock import Mock, AsyncMock
from typing import Dict, Any, List

from openagents.mods.communication.thread_messaging import (
    ThreadMessagingAgentAdapter,
    ThreadMessagingNetworkMod,
    DirectMessage,
    ChannelMessage,
    ReplyMessage,
    FileUploadMessage,
    FileOperationMessage,
    ChannelInfoMessage,
    MessageRetrievalMessage
)
from openagents.models.messages import ModMessage


class TestNewMessageTypes:
    """Test the new redesigned message models."""
    
    def test_direct_message_creation(self):
        """Test creating direct messages."""
        message = DirectMessage(
            sender_id="alice",
            target_agent_id="bob",
            content={"text": "Hello Bob!"},
            mod="thread_messaging",
            direction="outbound",
            relevant_agent_id="alice"
        )
        
        assert message.sender_id == "alice"
        assert message.target_agent_id == "bob"
        assert message.content["text"] == "Hello Bob!"
        assert message.message_type == "direct_message"
        assert message.quoted_message_id is None
        assert message.quoted_text is None
    
    def test_direct_message_with_quote(self):
        """Test direct message with quote."""
        message = DirectMessage(
            sender_id="alice",
            target_agent_id="bob",
            content={"text": "I agree!"},
            quoted_message_id="msg_123",
            quoted_text="Great idea about the feature",
            mod="thread_messaging",
            direction="outbound",
            relevant_agent_id="alice"
        )
        
        assert message.quoted_message_id == "msg_123"
        assert message.quoted_text == "Great idea about the feature"
    
    def test_channel_message_creation(self):
        """Test creating channel messages."""
        message = ChannelMessage(
            sender_id="alice",
            channel="dev",
            content={"text": "New feature ready for review"},
            mod="thread_messaging",
            direction="outbound",
            relevant_agent_id="alice"
        )
        
        assert message.sender_id == "alice"
        assert message.channel == "development"
        assert message.content["text"] == "New feature ready for review"
        assert message.message_type == "channel_message"
        assert message.mentioned_agent_id is None
    
    def test_channel_message_with_mention(self):
        """Test channel message with agent mention."""
        message = ChannelMessage(
            sender_id="alice",
            channel="dev",
            content={"text": "Please review this"},
            mentioned_agent_id="bob",
            quoted_message_id="feature_msg",
            quoted_text="Here's the feature",
            mod="thread_messaging",
            direction="outbound",
            relevant_agent_id="alice"
        )
        
        assert message.mentioned_agent_id == "bob"
        assert message.quoted_message_id == "feature_msg"
        assert message.quoted_text == "Here's the feature"
    
    def test_reply_message_creation(self):
        """Test creating reply messages."""
        message = ReplyMessage(
            sender_id="bob",
            reply_to_id="original_msg",
            content={"text": "This is a reply"},
            thread_level=1,
            channel="dev",
            mod="thread_messaging",
            direction="outbound",
            relevant_agent_id="bob"
        )
        
        assert message.sender_id == "bob"
        assert message.reply_to_id == "original_msg"
        assert message.thread_level == 1
        assert message.channel == "development"
        assert message.target_agent_id is None  # Channel reply
    
    def test_reply_message_direct(self):
        """Test creating direct message replies."""
        message = ReplyMessage(
            sender_id="bob",
            reply_to_id="original_dm",
            content={"text": "Direct reply"},
            thread_level=2,
            target_agent_id="alice",
            quoted_message_id="context_msg",
            quoted_text="For context",
            mod="thread_messaging",
            direction="outbound",
            relevant_agent_id="bob"
        )
        
        assert message.target_agent_id == "alice"  # Direct reply
        assert message.thread_level == 2
        assert message.channel is None
        assert message.quoted_message_id == "context_msg"
    
    def test_thread_level_validation(self):
        """Test thread level validation (1-5)."""
        # Valid levels
        for level in range(1, 6):
            message = ReplyMessage(
                sender_id="bob",
                reply_to_id="msg",
                content={"text": "test"},
                thread_level=level,
                channel="general",
                mod="thread_messaging",
                direction="outbound",
                relevant_agent_id="bob"
            )
            assert message.thread_level == level
        
        # Invalid levels should raise validation error
        with pytest.raises(ValueError):
            ReplyMessage(
                sender_id="bob",
                reply_to_id="msg",
                content={"text": "test"},
                thread_level=0,  # Too low
                channel="general",
                mod="thread_messaging",
                direction="outbound",
                relevant_agent_id="bob"
            )
        
        with pytest.raises(ValueError):
            ReplyMessage(
                sender_id="bob",
                reply_to_id="msg",
                content={"text": "test"},
                thread_level=6,  # Too high
                channel="general",
                mod="thread_messaging",
                direction="outbound",
                relevant_agent_id="bob"
            )
    
    def test_file_upload_message(self):
        """Test file upload message creation."""
        file_content = base64.b64encode(b"test file content").decode()
        
        message = FileUploadMessage(
            sender_id="alice",
            file_content=file_content,
            filename="test.txt",
            mime_type="text/plain",
            file_size=17,
            mod="thread_messaging",
            direction="outbound",
            relevant_agent_id="alice"
        )
        
        assert message.file_content == file_content
        assert message.filename == "test.txt"
        assert message.mime_type == "text/plain"
        assert message.file_size == 17
        assert message.message_type == "file_upload"
    
    def test_file_operation_message(self):
        """Test file operation message creation."""
        message = FileOperationMessage(
            sender_id="alice",
            action="download",
            file_id="file_uuid_123",
            mod="thread_messaging",
            direction="outbound",
            relevant_agent_id="alice"
        )
        
        assert message.action == "download"
        assert message.file_id == "file_uuid_123"
        assert message.message_type == "file_operation"
    
    def test_channel_info_message(self):
        """Test channel info message creation."""
        message = ChannelInfoMessage(
            sender_id="alice",
            action="list_channels",
            mod="thread_messaging",
            direction="outbound",
            relevant_agent_id="alice"
        )
        
        assert message.action == "list_channels"
        assert message.message_type == "channel_info"
    
    def test_message_retrieval_message(self):
        """Test message retrieval message creation."""
        # Channel message retrieval
        message = MessageRetrievalMessage(
            sender_id="alice",
            action="retrieve_channel_messages",
            channel="dev",
            limit=25,
            offset=10,
            include_threads=True,
            mod="thread_messaging",
            direction="outbound",
            relevant_agent_id="alice"
        )
        
        assert message.action == "retrieve_channel_messages"
        assert message.channel == "development"
        assert message.limit == 25
        assert message.offset == 10
        assert message.include_threads is True
        assert message.target_agent_id is None
    
    def test_message_retrieval_direct(self):
        """Test direct message retrieval."""
        message = MessageRetrievalMessage(
            sender_id="alice",
            action="retrieve_direct_messages",
            target_agent_id="bob",
            limit=50,
            offset=0,
            include_threads=False,
            mod="thread_messaging",
            direction="outbound",
            relevant_agent_id="alice"
        )
        
        assert message.action == "retrieve_direct_messages"
        assert message.target_agent_id == "bob"
        assert message.channel is None
        assert message.include_threads is False
    
    def test_retrieval_message_validation(self):
        """Test retrieval message validation."""
        # Invalid action
        with pytest.raises(ValueError):
            MessageRetrievalMessage(
                sender_id="alice",
                action="invalid_action",
                channel="general",
                mod="thread_messaging",
                direction="outbound",
                relevant_agent_id="alice"
            )
        
        # Invalid limit (too low)
        with pytest.raises(ValueError):
            MessageRetrievalMessage(
                sender_id="alice",
                action="retrieve_channel_messages",
                channel="general",
                limit=0,
                mod="thread_messaging",
                direction="outbound",
                relevant_agent_id="alice"
            )
        
        # Invalid limit (too high)
        with pytest.raises(ValueError):
            MessageRetrievalMessage(
                sender_id="alice",
                action="retrieve_channel_messages",
                channel="general",
                limit=501,
                mod="thread_messaging",
                direction="outbound",
                relevant_agent_id="alice"
            )


class TestThreadMessagingNetworkModRedesigned:
    """Test the redesigned network-level thread messaging mod."""
    
    def setup_method(self):
        """Set up test fixtures."""
        self.mod = ThreadMessagingNetworkMod()
        # Configure before initialization
        self.mod._config = {
            "default_channels": [
                {"name": "general", "description": "General discussion"},
                {"name": "development", "description": "Development discussions"},
                {"name": "support", "description": "Support and help"}
            ]
        }
        self.mod.initialize()
        
        # Mock network
        self.mock_network = Mock()
        self.mock_network.network_id = "test_network"
        self.mock_network.send_mod_message = AsyncMock()
        self.mod.bind_network(self.mock_network)
    
    def teardown_method(self):
        """Clean up after tests."""
        self.mod.shutdown()
    
    def test_initialization_with_channels(self):
        """Test mod initialization with configured channels."""
        assert self.mod.mod_name == "thread_messaging"
        assert len(self.mod.channels) == 3
        assert "general" in self.mod.channels
        assert "dev" in self.mod.channels
        assert "support" in self.mod.channels
        
        # Check channel structure
        general_channel = self.mod.channels["general"]
        assert general_channel["name"] == "general"
        assert general_channel["description"] == "General discussion"
        assert general_channel["message_count"] == 0
        assert general_channel["thread_count"] == 0
        
        # Check channel agents are tracked separately
        assert "general" in self.mod.channel_agents
        assert len(self.mod.channel_agents["general"]) == 0
    
    @pytest.mark.asyncio
    async def test_direct_message_handling(self):
        """Test handling direct messages."""
        message = DirectMessage(
            sender_id="alice",
            target_agent_id="bob",
            content={"text": "Hello Bob!"},
            mod="thread_messaging",
            direction="inbound",
            relevant_agent_id="alice"
        )
        
        await self.mod.process_mod_message(message)
        
        # Should be stored in message history
        assert message.message_id in self.mod.message_history
        
        # Should be forwarded to target agent
        self.mock_network.send_mod_message.assert_called_once()
        forwarded_msg = self.mock_network.send_mod_message.call_args[0][0]
        assert forwarded_msg.relevant_agent_id == "bob"
        assert forwarded_msg.direction == "outbound"
    
    @pytest.mark.asyncio
    async def test_channel_message_handling(self):
        """Test handling channel messages."""
        message = ChannelMessage(
            sender_id="alice",
            channel="dev",
            content={"text": "New feature completed!"},
            mentioned_agent_id="bob",
            mod="thread_messaging",
            direction="inbound",
            relevant_agent_id="alice"
        )
        
        await self.mod.process_mod_message(message)
        
        # Should be stored in message history
        assert message.message_id in self.mod.message_history
        
        # Should update channel message count
        assert self.mod.channels["dev"]["message_count"] == 1
        
        # Should add agent to channel if not already there
        assert "alice" in self.mod.channel_agents["dev"]
        
        # Should send to all agents in channel (none yet) and mentioned agent
        if self.mock_network.send_mod_message.call_count > 0:
            # At least one message should be sent to mentioned agent
            call_args_list = self.mock_network.send_mod_message.call_args_list
            mentioned_msg_sent = any(
                call[0][0].relevant_agent_id == "bob" 
                for call in call_args_list
            )
            assert mentioned_msg_sent
    
    @pytest.mark.asyncio
    async def test_reply_message_threading(self):
        """Test reply message threading logic."""
        # First, create an original channel message
        original = ChannelMessage(
            sender_id="alice",
            channel="dev", 
            content={"text": "Original message"},
            mod="thread_messaging",
            direction="inbound",
            relevant_agent_id="alice"
        )
        await self.mod.process_mod_message(original)
        
        # Now reply to it
        reply = ReplyMessage(
            sender_id="bob",
            reply_to_id=original.message_id,
            content={"text": "This is a reply"},
            thread_level=1,
            channel="dev",
            mod="thread_messaging",
            direction="inbound",
            relevant_agent_id="bob"
        )
        await self.mod.process_mod_message(reply)
        
        # Should create a thread
        assert len(self.mod.threads) == 1
        thread_id = list(self.mod.threads.keys())[0]
        thread = self.mod.threads[thread_id]
        
        assert thread.root_message_id == original.message_id
        assert original.message_id in self.mod.message_to_thread
        assert reply.message_id in self.mod.message_to_thread
        assert self.mod.message_to_thread[original.message_id] == thread_id
        assert self.mod.message_to_thread[reply.message_id] == thread_id
    
    @pytest.mark.asyncio
    async def test_deep_threading_5_levels(self):
        """Test Reddit-like threading with 5 levels."""
        # Create original message
        original = ChannelMessage(
            sender_id="alice",
            channel="dev",
            content={"text": "Original"},
            mod="thread_messaging",
            direction="inbound",
            relevant_agent_id="alice"
        )
        await self.mod.process_mod_message(original)
        
        # Create nested replies up to level 5
        messages = [original]
        for level in range(1, 6):
            reply = ReplyMessage(
                sender_id=f"user_{level}",
                reply_to_id=messages[-1].message_id,
                content={"text": f"Reply level {level}"},
                thread_level=level,
                channel="dev",
                mod="thread_messaging",
                direction="inbound",
                relevant_agent_id=f"user_{level}"
            )
            await self.mod.process_mod_message(reply)
            messages.append(reply)
        
        # Should all be in the same thread
        thread_id = self.mod.message_to_thread[original.message_id]
        for msg in messages:
            assert self.mod.message_to_thread[msg.message_id] == thread_id
        
        # Check thread structure
        thread = self.mod.threads[thread_id]
        assert thread.root_message_id == original.message_id
        assert len(thread.get_thread_structure()) == 6  # Original + 5 replies
    
    @pytest.mark.asyncio
    async def test_file_upload_handling(self):
        """Test file upload handling."""
        file_content = base64.b64encode(b"test file content").decode()
        
        message = FileUploadMessage(
            sender_id="alice",
            file_content=file_content,
            filename="test.txt",
            mime_type="text/plain",
            file_size=17,
            mod="thread_messaging",
            direction="inbound",
            relevant_agent_id="alice"
        )
        
        await self.mod.process_mod_message(message)
        
        # Should generate a file UUID and store the file
        assert len(self.mod.files) == 1
        file_id = list(self.mod.files.keys())[0]
        file_info = self.mod.files[file_id]
        
        assert file_info["filename"] == "test.txt"
        assert file_info["mime_type"] == "text/plain"
        assert file_info["file_size"] == 17
        assert file_info["uploaded_by"] == "alice"
        
        # Should send response with file UUID
        self.mock_network.send_mod_message.assert_called()
        response = self.mock_network.send_mod_message.call_args[0][0]
        assert response.content["action"] == "file_upload_response"
        assert response.content["success"] is True
        assert response.content["file_id"] == file_id
    
    @pytest.mark.asyncio
    async def test_channel_messages_retrieval(self):
        """Test retrieving channel messages."""
        # Add some messages to a channel first
        for i in range(5):
            msg = ChannelMessage(
                sender_id=f"user_{i}",
                channel="dev",
                content={"text": f"Message {i}"},
                mod="thread_messaging",
                direction="inbound",
                relevant_agent_id=f"user_{i}"
            )
            await self.mod.process_mod_message(msg)
        
        # Request retrieval
        retrieval_msg = MessageRetrievalMessage(
            sender_id="alice",
            action="retrieve_channel_messages",
            channel="dev",
            limit=3,
            offset=1,
            include_threads=True,
            mod="thread_messaging",
            direction="inbound",
            relevant_agent_id="alice"
        )
        
        await self.mod.process_mod_message(retrieval_msg)
        
        # Should send response with paginated messages
        self.mock_network.send_mod_message.assert_called()
        response = self.mock_network.send_mod_message.call_args[0][0]
        
        assert response.content["action"] == "retrieve_channel_messages_response"
        assert response.content["success"] is True
        assert response.content["channel"] == "development"
        assert response.content["total_count"] == 5
        assert response.content["offset"] == 1
        assert response.content["limit"] == 3
        assert len(response.content["messages"]) == 3
        assert response.content["has_more"] is True
    
    @pytest.mark.asyncio
    async def test_direct_messages_retrieval(self):
        """Test retrieving direct messages between agents."""
        # Create conversation between alice and bob
        dm1 = DirectMessage(
            sender_id="alice",
            target_agent_id="bob",
            content={"text": "Hello Bob"},
            mod="thread_messaging",
            direction="inbound",
            relevant_agent_id="alice"
        )
        await self.mod.process_mod_message(dm1)
        
        dm2 = DirectMessage(
            sender_id="bob", 
            target_agent_id="alice",
            content={"text": "Hi Alice"},
            mod="thread_messaging",
            direction="inbound",
            relevant_agent_id="bob"
        )
        await self.mod.process_mod_message(dm2)
        
        # Request retrieval
        retrieval_msg = MessageRetrievalMessage(
            sender_id="alice",
            action="retrieve_direct_messages",
            target_agent_id="bob",
            limit=10,
            offset=0,
            include_threads=True,
            mod="thread_messaging",
            direction="inbound",
            relevant_agent_id="alice"
        )
        
        await self.mod.process_mod_message(retrieval_msg)
        
        # Should return conversation between alice and bob
        self.mock_network.send_mod_message.assert_called()
        response = self.mock_network.send_mod_message.call_args[0][0]
        
        assert response.content["action"] == "retrieve_direct_messages_response"
        assert response.content["success"] is True
        assert response.content["target_agent_id"] == "bob"
        assert len(response.content["messages"]) == 2
        assert response.content["total_count"] == 2
    
    @pytest.mark.asyncio
    async def test_list_channels_request(self):
        """Test listing channels."""
        request = ChannelInfoMessage(
            sender_id="alice",
            action="list_channels",
            mod="thread_messaging",
            direction="inbound", 
            relevant_agent_id="alice"
        )
        
        await self.mod.process_mod_message(request)
        
        # Should send response with all channels
        self.mock_network.send_mod_message.assert_called()
        response = self.mock_network.send_mod_message.call_args[0][0]
        
        assert response.content["action"] == "list_channels_response"
        assert response.content["success"] is True
        assert len(response.content["channels"]) == 3
        
        # Check channel data
        channels = response.content["channels"]
        channel_names = [ch["name"] for ch in channels]
        assert "general" in channel_names
        assert "development" in channel_names
        assert "support" in channel_names


class TestThreadMessagingAgentAdapterRedesigned:
    """Test the redesigned agent-level thread messaging adapter."""
    
    def setup_method(self):
        """Set up test fixtures."""
        self.adapter = ThreadMessagingAgentAdapter()
        self.adapter.bind_agent("test_agent")
        
        # Mock connector
        self.mock_connector = Mock()
        self.mock_connector.send_mod_message = AsyncMock()
        self.mock_connector.send_direct_message = AsyncMock()
        self.mock_connector.send_broadcast_message = AsyncMock()
        self.adapter.bind_connector(self.mock_connector)
        
        self.adapter.initialize()
    
    def teardown_method(self):
        """Clean up after tests."""
        self.adapter.shutdown()
    
    def test_initialization(self):
        """Test adapter initialization."""
        assert self.adapter.agent_id == "test_agent"
        assert self.adapter.mod_name == "thread_messaging"
        assert len(self.adapter.message_handlers) == 0
        assert len(self.adapter.file_handlers) == 0
    
    def test_get_tools_new_design(self):
        """Test that all 8 redesigned tools are available."""
        tools = self.adapter.get_tools()
        tool_names = [tool.name for tool in tools]
        
        expected_tools = [
            "send_direct_message",
            "send_channel_message", 
            "upload_file",
            "reply_channel_message",
            "reply_direct_message",
            "list_channels",
            "retrieve_channel_messages",
            "retrieve_direct_messages"
        ]
        
        assert len(tools) == 8
        for expected_tool in expected_tools:
            assert expected_tool in tool_names
    
    @pytest.mark.asyncio
    async def test_send_direct_message(self):
        """Test sending direct messages."""
        await self.adapter.send_direct_message(
            target_agent_id="bob",
            text="Hello Bob!",
            quote="msg_123"
        )
        
        self.mock_connector.send_direct_message.assert_called_once()
        sent_message = self.mock_connector.send_direct_message.call_args[0][0]
        
        assert isinstance(sent_message, DirectMessage)
        assert sent_message.target_agent_id == "bob"
        assert sent_message.content["text"] == "Hello Bob!"
        assert sent_message.quoted_message_id == "msg_123"
    
    @pytest.mark.asyncio
    async def test_send_channel_message(self):
        """Test sending channel messages."""
        await self.adapter.send_channel_message(
            channel="dev",
            text="Feature is ready!",
            target_agent="bob",
            quote="feature_request_id"
        )
        
        self.mock_connector.send_broadcast_message.assert_called_once()
        sent_message = self.mock_connector.send_broadcast_message.call_args[0][0]
        
        assert isinstance(sent_message, ChannelMessage)
        assert sent_message.channel == "development"
        assert sent_message.content["text"] == "Feature is ready!"
        assert sent_message.mentioned_agent_id == "bob"
        assert sent_message.quoted_message_id == "feature_request_id"
    
    @pytest.mark.asyncio
    async def test_upload_file(self):
        """Test file upload."""
        # Create temporary file
        with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.txt') as f:
            f.write("Test file content for upload")
            temp_path = f.name
        
        try:
            await self.adapter.upload_file(temp_path)
            
            self.mock_connector.send_mod_message.assert_called_once()
            sent_message = self.mock_connector.send_mod_message.call_args[0][0]
            
            assert isinstance(sent_message, FileUploadMessage)
            assert sent_message.filename == Path(temp_path).name
            assert sent_message.mime_type == "text/plain"
            assert len(sent_message.file_content) > 0  # Base64 encoded content
            
        finally:
            Path(temp_path).unlink()
    
    @pytest.mark.asyncio
    async def test_reply_channel_message(self):
        """Test replying to channel messages."""
        await self.adapter.reply_channel_message(
            channel="dev",
            reply_to_id="original_msg_123",
            text="Great idea!",
            quote="context_msg_456"
        )
        
        self.mock_connector.send_mod_message.assert_called_once()
        sent_message = self.mock_connector.send_mod_message.call_args[0][0]
        
        assert isinstance(sent_message, ReplyMessage)
        assert sent_message.channel == "development"
        assert sent_message.reply_to_id == "original_msg_123"
        assert sent_message.content["text"] == "Great idea!"
        assert sent_message.quoted_message_id == "context_msg_456"
        assert sent_message.target_agent_id is None  # Channel reply
    
    @pytest.mark.asyncio
    async def test_reply_direct_message(self):
        """Test replying to direct messages."""
        await self.adapter.reply_direct_message(
            target_agent_id="alice",
            reply_to_id="dm_msg_789",
            text="Thanks for the info!",
            quote="info_msg_101"
        )
        
        self.mock_connector.send_mod_message.assert_called_once()
        sent_message = self.mock_connector.send_mod_message.call_args[0][0]
        
        assert isinstance(sent_message, ReplyMessage)
        assert sent_message.target_agent_id == "alice"
        assert sent_message.reply_to_id == "dm_msg_789"
        assert sent_message.content["text"] == "Thanks for the info!"
        assert sent_message.quoted_message_id == "info_msg_101"
        assert sent_message.channel is None  # Direct reply
    
    @pytest.mark.asyncio
    async def test_list_channels(self):
        """Test listing channels."""
        await self.adapter.list_channels()
        
        self.mock_connector.send_mod_message.assert_called_once()
        sent_message = self.mock_connector.send_mod_message.call_args[0][0]
        
        assert isinstance(sent_message, ChannelInfoMessage)
        assert sent_message.action == "list_channels"
    
    @pytest.mark.asyncio
    async def test_retrieve_channel_messages(self):
        """Test retrieving channel messages."""
        await self.adapter.retrieve_channel_messages(
            channel="dev",
            limit=25,
            offset=5,
            include_threads=True
        )
        
        self.mock_connector.send_mod_message.assert_called_once()
        sent_message = self.mock_connector.send_mod_message.call_args[0][0]
        
        assert isinstance(sent_message, MessageRetrievalMessage)
        assert sent_message.action == "retrieve_channel_messages"
        assert sent_message.channel == "development"
        assert sent_message.limit == 25
        assert sent_message.offset == 5
        assert sent_message.include_threads is True
    
    @pytest.mark.asyncio
    async def test_retrieve_direct_messages(self):
        """Test retrieving direct messages."""
        await self.adapter.retrieve_direct_messages(
            target_agent_id="alice",
            limit=50,
            offset=0,
            include_threads=False
        )
        
        self.mock_connector.send_mod_message.assert_called_once()
        sent_message = self.mock_connector.send_mod_message.call_args[0][0]
        
        assert isinstance(sent_message, MessageRetrievalMessage)
        assert sent_message.action == "retrieve_direct_messages"
        assert sent_message.target_agent_id == "alice"
        assert sent_message.limit == 50
        assert sent_message.offset == 0
        assert sent_message.include_threads is False
    
    @pytest.mark.asyncio
    async def test_message_handler_registration(self):
        """Test message handler registration and callbacks."""
        handler_called = False
        received_content = None
        received_sender = None
        
        def test_handler(content: Dict[str, Any], sender_id: str):
            nonlocal handler_called, received_content, received_sender
            handler_called = True
            received_content = content
            received_sender = sender_id
        
        # Register handler
        self.adapter.register_message_handler("test_handler", test_handler)
        assert "test_handler" in self.adapter.message_handlers
        
        # Simulate incoming message response
        mock_message = ModMessage(
            sender_id="network",
            mod="thread_messaging",
            content={
                "action": "retrieve_channel_messages_response",
                "success": True,
                "channel": "development",
                "messages": [{"id": "msg1", "text": "Hello"}],
                "total_count": 1,
                "offset": 0,
                "limit": 50,
                "has_more": False,
                "request_id": "test_request"
            },
            direction="inbound",
            relevant_agent_id="test_agent"
        )
        
        # Add a pending request so the handler gets called
        self.adapter.pending_retrieval_requests["test_request"] = {
            "action": "retrieve_channel_messages",
            "channel": "development"
        }
        
        await self.adapter.process_incoming_mod_message(mock_message)
        
        # Handler should have been called (message needs to match expected structure)
        # The test message should trigger the handler since it has "action" field
        assert handler_called
        assert received_content["action"] == "channel_messages_retrieved"
        assert received_sender == "network"
        
        # Unregister handler
        self.adapter.unregister_message_handler("test_handler")
        assert "test_handler" not in self.adapter.message_handlers
    
    @pytest.mark.asyncio 
    async def test_file_handler_registration(self):
        """Test file handler registration and callbacks."""
        handler_called = False
        received_file_id = None
        received_filename = None
        received_info = None
        
        def test_file_handler(file_id: str, filename: str, file_info: Dict[str, Any]):
            nonlocal handler_called, received_file_id, received_filename, received_info
            handler_called = True
            received_file_id = file_id
            received_filename = filename
            received_info = file_info
        
        # Register handler
        self.adapter.register_file_handler("test_file_handler", test_file_handler)
        assert "test_file_handler" in self.adapter.file_handlers
        
        # Simulate file upload response
        mock_message = ModMessage(
            sender_id="network",
            mod="thread_messaging",
            content={
                "action": "file_upload_response",
                "success": True,
                "file_id": "uuid_123",
                "filename": "test.txt",
                "request_id": "req_456"
            },
            direction="inbound",
            relevant_agent_id="test_agent"
        )
        
        # Add pending file operation
        self.adapter.pending_file_operations["req_456"] = {
            "action": "upload",
            "filename": "test.txt"
        }
        
        await self.adapter.process_incoming_mod_message(mock_message)
        
        # File handler should have been called
        assert handler_called
        assert received_file_id == "uuid_123"
        assert received_filename == "test.txt"
        assert received_info["action"] == "upload"
        assert received_info["success"] is True
        
        # Unregister handler
        self.adapter.unregister_file_handler("test_file_handler")
        assert "test_file_handler" not in self.adapter.file_handlers


class TestThreadMessagingIntegration:
    """Integration tests for complete thread messaging workflows."""
    
    def setup_method(self):
        """Set up integration test fixtures."""
        # Create network mod
        self.network_mod = ThreadMessagingNetworkMod()
        self.network_mod._config = {
            "default_channels": [
                {"name": "general", "description": "General discussion"},
                {"name": "dev", "description": "Development discussions"}
            ]
        }
        self.network_mod.initialize()
        
        # Mock network
        self.mock_network = Mock()
        self.mock_network.network_id = "test_network"
        self.mock_network.send_mod_message = AsyncMock()
        self.network_mod.bind_network(self.mock_network)
        
        # Create agent adapters
        self.alice_adapter = ThreadMessagingAgentAdapter()
        self.alice_adapter.bind_agent("alice")
        alice_connector = Mock()
        alice_connector.send_mod_message = AsyncMock()
        alice_connector.send_direct_message = AsyncMock()
        alice_connector.send_broadcast_message = AsyncMock()
        self.alice_adapter.bind_connector(alice_connector)
        self.alice_adapter.initialize()
        
        self.bob_adapter = ThreadMessagingAgentAdapter()
        self.bob_adapter.bind_agent("bob")
        bob_connector = Mock()
        bob_connector.send_mod_message = AsyncMock()
        bob_connector.send_direct_message = AsyncMock()
        bob_connector.send_broadcast_message = AsyncMock()
        self.bob_adapter.bind_connector(bob_connector)
        self.bob_adapter.initialize()
    
    def teardown_method(self):
        """Clean up integration tests."""
        self.network_mod.shutdown()
        self.alice_adapter.shutdown()
        self.bob_adapter.shutdown()
    
    @pytest.mark.asyncio
    async def test_complete_conversation_workflow(self):
        """Test a complete conversation workflow with threading."""
        # 1. Alice sends message to development channel
        await self.alice_adapter.send_channel_message(
            channel="dev",
            text="I've completed the new authentication feature"
        )
        
        alice_msg = self.alice_adapter.connector.send_broadcast_message.call_args[0][0]
        
        # Process on network
        await self.network_mod.process_mod_message(alice_msg)
        
        # 2. Bob replies to Alice's message
        await self.bob_adapter.reply_channel_message(
            channel="dev",
            reply_to_id=alice_msg.message_id,
            text="Great work! Can you add 2FA support?"
        )
        
        bob_reply = self.bob_adapter.connector.send_mod_message.call_args[0][0]
        
        # Process on network
        await self.network_mod.process_mod_message(bob_reply)
        
        # 3. Alice replies to Bob (level 2 threading)
        await self.alice_adapter.reply_channel_message(
            channel="dev",
            reply_to_id=bob_reply.message_id,
            text="Yes, I can add that. Will take about 2 days.",
            quote=alice_msg.message_id  # Quote original message
        )
        
        alice_reply = self.alice_adapter.connector.send_mod_message.call_args[0][0]
        await self.network_mod.process_mod_message(alice_reply)
        
        # Verify thread structure
        assert len(self.network_mod.threads) == 1
        thread_id = self.network_mod.message_to_thread[alice_msg.message_id]
        thread = self.network_mod.threads[thread_id]
        
        assert thread.root_message_id == alice_msg.message_id
        assert len(thread.get_thread_structure()) == 3
        
        # Verify all messages are in the same thread
        assert alice_msg.message_id in self.network_mod.message_to_thread
        assert bob_reply.message_id in self.network_mod.message_to_thread
        assert alice_reply.message_id in self.network_mod.message_to_thread
        
        # Verify quote was preserved
        assert alice_reply.quoted_message_id == alice_msg.message_id
    
    @pytest.mark.asyncio
    async def test_file_sharing_workflow(self):
        """Test complete file sharing workflow."""
        # 1. Alice uploads a file
        with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.py') as f:
            f.write("# New authentication module\nclass AuthService:\n    pass")
            temp_path = f.name
        
        try:
            await self.alice_adapter.upload_file(temp_path)
            upload_msg = self.alice_adapter.connector.send_mod_message.call_args[0][0]
            
            # Process upload on network
            await self.network_mod.process_mod_message(upload_msg)
            
            # Network should generate file UUID and send response
            network_response = self.mock_network.send_mod_message.call_args[0][0]
            assert network_response.content["action"] == "file_upload_response"
            assert network_response.content["success"] is True
            file_uuid = network_response.content["file_id"]
            
            # 2. Alice shares file in channel with the UUID
            await self.alice_adapter.send_channel_message(
                channel="dev",
                text=f"Here's the new auth module: {file_uuid}",
                target_agent="bob"
            )
            
            share_msg = self.alice_adapter.connector.send_mod_message.call_args[0][0]
            await self.network_mod.process_mod_message(share_msg)
            
            # Verify file is stored and accessible
            assert file_uuid in self.network_mod.files
            file_info = self.network_mod.files[file_uuid]
            assert file_info["filename"] == Path(temp_path).name
            assert file_info["uploaded_by"] == "alice"
            
        finally:
            Path(temp_path).unlink()
    
    @pytest.mark.asyncio
    async def test_message_retrieval_workflow(self):
        """Test message retrieval with pagination."""
        # Create multiple messages in development channel
        messages = []
        for i in range(10):
            await self.alice_adapter.send_channel_message(
                channel="dev",
                text=f"Message number {i}"
            )
            msg = self.alice_adapter.connector.send_mod_message.call_args[0][0]
            await self.network_mod.process_mod_message(msg)
            messages.append(msg)
        
        # Retrieve first page (5 messages, offset 0)
        await self.bob_adapter.retrieve_channel_messages(
            channel="dev",
            limit=5,
            offset=0,
            include_threads=True
        )
        
        retrieval_msg = self.bob_adapter.connector.send_mod_message.call_args[0][0]
        await self.network_mod.process_mod_message(retrieval_msg)
        
        # Check response
        response = self.mock_network.send_mod_message.call_args[0][0]
        assert response.content["action"] == "retrieve_channel_messages_response"
        assert response.content["success"] is True
        assert response.content["total_count"] == 10
        assert len(response.content["messages"]) == 5
        assert response.content["has_more"] is True
        
        # Retrieve second page (5 messages, offset 5)
        await self.bob_adapter.retrieve_channel_messages(
            channel="dev",
            limit=5,
            offset=5,
            include_threads=True
        )
        
        retrieval_msg2 = self.bob_adapter.connector.send_mod_message.call_args[0][0]
        await self.network_mod.process_mod_message(retrieval_msg2)
        
        # Check second page response
        response2 = self.mock_network.send_mod_message.call_args[0][0]
        assert len(response2.content["messages"]) == 5
        assert response2.content["has_more"] is False  # No more messages


if __name__ == "__main__":
    # Run tests with verbose output
    pytest.main([__file__, "-v", "--tb=short"])
