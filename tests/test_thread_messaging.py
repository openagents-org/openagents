"""
Tests for the Thread Messaging mod (Legacy).

NOTE: This is the legacy test file for the old thread messaging mod design.
For the new redesigned mod with 8 tools, see test_thread_messaging_redesigned.py

This module contains unit tests for the legacy thread messaging functionality including:
- Message threading
- Reactions  
- File handling
- Thread management
"""

import pytest
import asyncio
import tempfile
import uuid
from pathlib import Path
from unittest.mock import Mock, AsyncMock

from openagents.mods.communication.thread_messaging import (
    ThreadMessagingAgentAdapter,
    ThreadMessagingNetworkMod,
    ThreadMessage,
    ThreadDirectMessage,
    ThreadBroadcastMessage,
    ReactionMessage,
    ThreadStatusMessage,
    ChannelMessage,
    REACTION_TYPES
)
from openagents.models.messages import DirectMessage, BroadcastMessage


class TestThreadMessages:
    """Test thread message models."""
    
    def test_thread_message_creation(self):
        """Test creating a basic thread message."""
        message = ThreadMessage(
            sender_id="test_agent",
            content={"text": "Hello world"},
            reply_to_id="original_message_id"
        )
        
        assert message.sender_id == "test_agent"
        assert message.content["text"] == "Hello world"
        assert message.reply_to_id == "original_message_id"
        assert message.message_type == "thread_message"
        assert not message.is_thread_root
    
    def test_thread_direct_message(self):
        """Test creating a threaded direct message."""
        message = ThreadDirectMessage(
            sender_id="alice",
            target_agent_id="bob",
            content={"text": "Direct reply"},
            reply_to_id="msg_123"
        )
        
        assert message.target_agent_id == "bob"
        assert message.message_type == "thread_direct_message"
        assert message.reply_to_id == "msg_123"
    
    def test_thread_broadcast_message(self):
        """Test creating a threaded broadcast message.""" 
        message = ThreadBroadcastMessage(
            sender_id="alice",
            content={"text": "Broadcast reply"},
            reply_to_id="broadcast_123"
        )
        
        assert message.message_type == "thread_broadcast_message"
        assert message.reply_to_id == "broadcast_123"
        assert message.exclude_agent_ids == []
    
    def test_reaction_message_creation(self):
        """Test creating reaction messages."""
        message = ReactionMessage(
            sender_id="alice",
            target_message_id="msg_123", 
            reaction_type="like"
        )
        
        assert message.target_message_id == "msg_123"
        assert message.reaction_type == "like"
        assert message.message_type == "reaction_message"
    
    def test_reaction_validation(self):
        """Test reaction type validation."""
        # Valid reaction
        message = ReactionMessage(
            sender_id="alice",
            target_message_id="msg_123",
            reaction_type="+1"
        )
        assert message.reaction_type == "+1"
        
        # Invalid reaction should raise validation error
        with pytest.raises(ValueError):
            ReactionMessage(
                sender_id="alice",
                target_message_id="msg_123",
                reaction_type="invalid_reaction"
            )
    
    def test_thread_status_message(self):
        """Test thread status messages."""
        message = ThreadStatusMessage(
            sender_id="alice",
            action="get_thread",
            thread_id="thread_123"
        )
        
        assert message.action == "get_thread"
        assert message.thread_id == "thread_123"
        assert message.message_type == "thread_status_message"
    
    def test_channel_message_creation(self):
        """Test creating channel messages."""
        message = ChannelMessage(
            sender_id="alice",
            action="list_channels"
        )
        
        assert message.action == "list_channels"
        assert message.message_type == "channel_message"
        assert message.channel_name is None
    
    def test_channel_message_with_channel_name(self):
        """Test creating channel messages with channel name."""
        message = ChannelMessage(
            sender_id="alice",
            action="get_channel_info",
            channel_name="general"
        )
        
        assert message.action == "get_channel_info"
        assert message.channel_name == "general"
    
    def test_channel_message_validation(self):
        """Test channel message action validation."""
        # Valid action
        message = ChannelMessage(
            sender_id="alice",
            action="list_channels"
        )
        assert message.action == "list_channels"
        
        # Invalid action should raise validation error
        with pytest.raises(ValueError):
            ChannelMessage(
                sender_id="alice",
                action="invalid_action"
            )
    
    def test_thread_message_with_channel(self):
        """Test thread messages with channel support."""
        message = ThreadMessage(
            sender_id="alice",
            content={"text": "Hello in dev channel"},
            channel="dev"
        )
        
        assert message.channel == "dev"
        assert message.content["text"] == "Hello in dev channel"


class TestThreadMessagingNetworkMod:
    """Test the network-level thread messaging mod."""
    
    def setup_method(self):
        """Set up test fixtures."""
        self.mod = ThreadMessagingNetworkMod()
        self.mod.initialize()
        
        # Mock network
        self.mock_network = Mock()
        self.mock_network.network_id = "test_network"
        self.mock_network.send_mod_message = AsyncMock()
        self.mod.bind_network(self.mock_network)
    
    def teardown_method(self):
        """Clean up after tests."""
        self.mod.shutdown()
    
    def test_initialization(self):
        """Test mod initialization."""
        assert self.mod.mod_name == "thread_messaging"
        assert len(self.mod.active_agents) == 0
        assert len(self.mod.message_history) == 0
        assert len(self.mod.threads) == 0
        assert len(self.mod.channels) == 1  # Default "general" channel
        assert "general" in self.mod.channels
    
    def test_agent_registration(self):
        """Test agent registration and unregistration."""
        self.mod.handle_register_agent("alice", {})
        assert "alice" in self.mod.active_agents
        
        self.mod.handle_unregister_agent("alice")
        assert "alice" not in self.mod.active_agents
    
    @pytest.mark.asyncio
    async def test_direct_message_processing(self):
        """Test processing direct messages."""
        message = DirectMessage(
            sender_id="alice",
            target_agent_id="bob",
            content={"text": "Hello Bob"}
        )
        
        result = await self.mod.process_direct_message(message)
        
        assert result is not None
        assert message.message_id in self.mod.message_history
    
    @pytest.mark.asyncio
    async def test_thread_creation(self):
        """Test thread creation when replying to messages."""
        # Create original message
        original = DirectMessage(
            sender_id="alice",
            target_agent_id="bob", 
            content={"text": "Original message"}
        )
        await self.mod.process_direct_message(original)
        
        # Create reply
        reply = ThreadDirectMessage(
            sender_id="bob",
            target_agent_id="alice",
            content={"text": "Reply message"},
            reply_to_id=original.message_id
        )
        await self.mod.process_direct_message(reply)
        
        # Check thread was created
        assert len(self.mod.threads) == 1
        assert original.message_id in self.mod.message_to_thread
        assert reply.message_id in self.mod.message_to_thread
        
        # Both messages should be in the same thread
        thread_id = self.mod.message_to_thread[original.message_id]
        assert self.mod.message_to_thread[reply.message_id] == thread_id
        
        thread = self.mod.threads[thread_id]
        assert thread.root_message_id == original.message_id
        assert len(thread.replies) == 1
        assert thread.replies[0] == reply
    
    @pytest.mark.asyncio
    async def test_channel_configuration(self):
        """Test channel configuration."""
        # Test with custom channels
        mod = ThreadMessagingNetworkMod()
        mod.config = {"channels": ["general", "dev", "support"]}
        mod._initialize_default_channels()
        
        assert len(mod.channels) == 3
        assert "general" in mod.channels
        assert "dev" in mod.channels
        assert "support" in mod.channels
        
        # Check channel info structure
        channel_info = mod.channels["dev"]
        assert channel_info["name"] == "dev"
        assert "created_timestamp" in channel_info
        assert channel_info["message_count"] == 0
        assert channel_info["thread_count"] == 0
    
    @pytest.mark.asyncio
    async def test_channel_message_processing(self):
        """Test processing channel messages."""
        # Create a channel message
        channel_msg = ChannelMessage(
            sender_id="alice",
            action="list_channels"
        )
        
        # Should not raise an error
        await self.mod.process_mod_message(channel_msg)
        
        # Check that send_mod_message was called (for the response)
        self.mock_network.send_mod_message.assert_called()
    
    @pytest.mark.asyncio
    async def test_threaded_message_channel_tracking(self):
        """Test that threaded messages are tracked by channel."""
        # Create original message in dev channel
        original = ThreadDirectMessage(
            sender_id="alice",
            target_agent_id="bob",
            content={"text": "Original message"},
            channel="dev"
        )
        await self.mod.process_direct_message(original)
        
        # Should track message in dev channel (but dev doesn't exist, so warning expected)
        # Let's add dev channel first
        self.mod.channels["dev"] = {
            'name': 'dev',
            'description': 'Channel dev',
            'created_timestamp': 1000,
            'message_count': 0,
            'thread_count': 0
        }
        self.mod.channel_threads["dev"] = []
        self.mod.channel_messages["dev"] = []
        
        # Process message again
        await self.mod.process_direct_message(original)
        
        # Check that message was added to channel tracking
        assert original.message_id in self.mod.channel_messages["dev"]
        assert self.mod.channels["dev"]["message_count"] == 1
    
    @pytest.mark.asyncio
    async def test_reaction_processing(self):
        """Test processing reaction messages."""
        # Create original message and thread
        original = DirectMessage(
            sender_id="alice",
            target_agent_id="bob",
            content={"text": "Original message"}
        )
        await self.mod.process_direct_message(original)
        
        reply = ThreadDirectMessage(
            sender_id="bob", 
            target_agent_id="alice",
            content={"text": "Reply"},
            reply_to_id=original.message_id
        )
        await self.mod.process_direct_message(reply)
        
        # Add reaction
        reaction = ReactionMessage(
            sender_id="charlie",
            target_message_id=original.message_id,
            reaction_type="like"
        )
        await self.mod.process_mod_message(reaction)
        
        # Check reaction was added
        thread_id = self.mod.message_to_thread[original.message_id]
        thread = self.mod.threads[thread_id]
        reactions = thread.get_reactions_for_message(original.message_id)
        
        assert "like" in reactions
        assert "charlie" in reactions["like"]


class TestThreadMessagingAgentAdapter:
    """Test the agent-level thread messaging adapter."""
    
    def setup_method(self):
        """Set up test fixtures."""
        self.adapter = ThreadMessagingAgentAdapter()
        self.adapter.bind_agent("test_agent")
        
        # Mock connector
        self.mock_connector = Mock()
        self.mock_connector.send_direct_message = AsyncMock()
        self.mock_connector.send_broadcast_message = AsyncMock()
        self.mock_connector.send_mod_message = AsyncMock()
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
    
    @pytest.mark.asyncio
    async def test_reply_to_message(self):
        """Test replying to a message."""
        await self.adapter.reply_to_message(
            target_agent_id="bob",
            text="This is a reply",
            reply_to_id="original_123"
        )
        
        # Check that send_direct_message was called
        self.mock_connector.send_direct_message.assert_called_once()
        
        # Get the message that was sent
        sent_message = self.mock_connector.send_direct_message.call_args[0][0]
        assert isinstance(sent_message, ThreadDirectMessage)
        assert sent_message.reply_to_id == "original_123"
        assert sent_message.content["text"] == "This is a reply"
    
    @pytest.mark.asyncio
    async def test_quote_message(self):
        """Test quoting a message."""
        await self.adapter.quote_message(
            target_agent_id="bob",
            text="I agree with this",
            quoted_message_id="msg_456",
            quoted_text="Original text here"
        )
        
        self.mock_connector.send_direct_message.assert_called_once()
        
        sent_message = self.mock_connector.send_direct_message.call_args[0][0]
        assert sent_message.quoted_message_id == "msg_456"
        assert sent_message.quoted_text == "Original text here"
    
    @pytest.mark.asyncio
    async def test_react_to_message(self):
        """Test reacting to a message."""
        await self.adapter.react_to_message(
            message_id="msg_789",
            reaction_type="like",
            target_agent_id="alice"
        )
        
        self.mock_connector.send_mod_message.assert_called_once()
        
        sent_message = self.mock_connector.send_mod_message.call_args[0][0]
        assert isinstance(sent_message, ReactionMessage)
        assert sent_message.target_message_id == "msg_789"
        assert sent_message.reaction_type == "like"
    
    @pytest.mark.asyncio
    async def test_invalid_reaction_type(self):
        """Test that invalid reaction types are rejected."""
        # This should not send anything
        await self.adapter.react_to_message(
            message_id="msg_789",
            reaction_type="invalid_reaction",
            target_agent_id="alice"
        )
        
        # Should not have called send_mod_message
        self.mock_connector.send_mod_message.assert_not_called()
    
    def test_message_handlers(self):
        """Test message handler registration."""
        handler_called = False
        
        def test_handler(content, sender_id):
            nonlocal handler_called
            handler_called = True
        
        # Register handler
        self.adapter.register_message_handler("test", test_handler)
        assert "test" in self.adapter.message_handlers
        
        # Unregister handler
        self.adapter.unregister_message_handler("test")
        assert "test" not in self.adapter.message_handlers
    
    def test_reaction_handlers(self):
        """Test reaction handler registration."""
        self.adapter.register_reaction_handler("test", lambda a, b, c, d: None)
        assert "test" in self.adapter.reaction_handlers
        
        self.adapter.unregister_reaction_handler("test")
        assert "test" not in self.adapter.reaction_handlers
    
    def test_get_tools(self):
        """Test that tools are properly defined."""
        tools = self.adapter.get_tools()
        
        tool_names = [tool.name for tool in tools]
        expected_tools = [
            "reply_to_message",
            "reply_to_broadcast_message", 
            "quote_message",
            "quote_broadcast_message",
            "react_to_message",
            "send_thread_file",
            "broadcast_thread_file",
            "download_file",
            "delete_file",
            "get_thread",
            "get_message_reactions",
            "list_channels",
            "get_channel_info"
        ]
        
        for expected_tool in expected_tools:
            assert expected_tool in tool_names
    
    @pytest.mark.asyncio
    async def test_file_sending(self):
        """Test sending files in threads."""
        # Create a temporary file
        with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.txt') as f:
            f.write("Test file content")
            temp_path = f.name
        
        try:
            await self.adapter.send_thread_file(
                target_agent_id="bob",
                file_path=temp_path,
                message_text="Here's the file",
                reply_to_id="original_msg"
            )
            
            self.mock_connector.send_direct_message.assert_called_once()
            
            sent_message = self.mock_connector.send_direct_message.call_args[0][0]
            assert sent_message.reply_to_id == "original_msg"
            assert "files" in sent_message.content
            assert sent_message.content["text"] == "Here's the file"
        
        finally:
            # Clean up temp file
            Path(temp_path).unlink()
    
    @pytest.mark.asyncio
    async def test_channel_operations(self):
        """Test channel-related operations."""
        # Test list channels
        await self.adapter.list_channels()
        self.mock_connector.send_mod_message.assert_called()
        
        # Get the message that was sent
        sent_message = self.mock_connector.send_mod_message.call_args[0][0]
        assert isinstance(sent_message, ChannelMessage)
        assert sent_message.action == "list_channels"
        
        # Reset mock
        self.mock_connector.send_mod_message.reset_mock()
        
        # Test get channel info
        await self.adapter.get_channel_info("general")
        self.mock_connector.send_mod_message.assert_called()
        
        sent_message = self.mock_connector.send_mod_message.call_args[0][0]
        assert isinstance(sent_message, ChannelMessage)
        assert sent_message.action == "get_channel_info"
        assert sent_message.channel_name == "general"
    
    @pytest.mark.asyncio
    async def test_channel_support_in_messages(self):
        """Test that channel parameter works in message methods."""
        # Test reply with channel
        await self.adapter.reply_to_message(
            target_agent_id="bob",
            text="Reply in dev channel",
            reply_to_id="msg_123",
            channel="dev"
        )
        
        self.mock_connector.send_direct_message.assert_called()
        sent_message = self.mock_connector.send_direct_message.call_args[0][0]
        assert sent_message.channel == "dev"
        
        # Reset mock
        self.mock_connector.send_direct_message.reset_mock()
        
        # Test quote with channel
        await self.adapter.quote_message(
            target_agent_id="bob",
            text="Quoting in support channel",
            quoted_message_id="msg_456",
            quoted_text="Original text",
            channel="support"
        )
        
        sent_message = self.mock_connector.send_direct_message.call_args[0][0]
        assert sent_message.channel == "support"


class TestReactionTypes:
    """Test reaction type constants and validation."""
    
    def test_reaction_types_constant(self):
        """Test that REACTION_TYPES contains expected values."""
        expected_reactions = ["+1", "like", "smile", "ok", "done", "heart", "thumbs_up", "thumbs_down"]
        
        for reaction in expected_reactions:
            assert reaction in REACTION_TYPES
        
        # Should be exactly these reactions
        assert len(REACTION_TYPES) == len(expected_reactions)
    
    def test_all_reactions_valid(self):
        """Test that all defined reactions can be used in messages."""
        for reaction in REACTION_TYPES:
            # Should not raise validation error
            message = ReactionMessage(
                sender_id="test",
                target_message_id="msg_123",
                reaction_type=reaction
            )
            assert message.reaction_type == reaction


if __name__ == "__main__":
    # Run tests
    pytest.main([__file__, "-v"])
