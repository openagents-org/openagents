"""
Tests for the WorkerAgent class.
"""

import pytest
import asyncio
from unittest.mock import Mock, AsyncMock, MagicMock
from typing import Dict, Any

from openagents.agents.worker_agent import (
    WorkerAgent,
    DirectMessageContext,
    ChannelMessageContext,
    ReplyMessageContext,
    ReactionContext,
    FileContext
)
from openagents.models.messages import DirectMessage, BroadcastMessage, ModMessage


class TestWorkerAgent(WorkerAgent):
    """Test agent for unit testing."""
    
    name = "test-agent"
    
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.received_messages = []
        self.sent_messages = []
    
    async def on_direct(self, msg: DirectMessageContext):
        self.received_messages.append(('direct', msg))
        await self.send_direct(to=msg.sender_id, text=f"Got: {msg.text}")
    
    async def on_channel_post(self, msg: ChannelMessageContext):
        self.received_messages.append(('channel_post', msg))
    
    async def on_channel_mention(self, msg: ChannelMessageContext):
        self.received_messages.append(('channel_mention', msg))
    
    async def on_channel_reply(self, msg: ReplyMessageContext):
        self.received_messages.append(('channel_reply', msg))
    
    async def on_reaction(self, msg: ReactionContext):
        self.received_messages.append(('reaction', msg))
    
    async def on_file_received(self, msg: FileContext):
        self.received_messages.append(('file', msg))


@pytest.fixture
def mock_client():
    """Create a mock client for testing."""
    client = Mock()
    client.agent_id = "test-agent"
    client.mod_adapters = {}
    return client


@pytest.fixture
def mock_thread_adapter():
    """Create a mock thread messaging adapter."""
    adapter = Mock()
    adapter.mod_name = "thread_messaging"
    adapter.send_direct_message = AsyncMock()
    adapter.send_channel_message = AsyncMock()
    adapter.send_reply_message = AsyncMock()
    adapter.add_reaction = AsyncMock()
    adapter.upload_file = AsyncMock()
    adapter.list_channels = AsyncMock()
    adapter.available_channels = []
    return adapter


@pytest.fixture
def worker_agent(mock_client, mock_thread_adapter):
    """Create a test WorkerAgent instance."""
    agent = TestWorkerAgent(agent_id="test-agent")
    agent._network_client = mock_client
    mock_client.mod_adapters = {"thread_messaging": mock_thread_adapter}
    # Set the thread adapter directly for testing
    agent._thread_adapter = mock_thread_adapter
    return agent


class TestWorkerAgentBasics:
    """Test basic WorkerAgent functionality."""
    
    def test_initialization(self):
        """Test agent initialization."""
        agent = TestWorkerAgent()
        assert agent.name == "test-agent"
        assert agent.ignore_own_messages == True
        assert agent.auto_mention_response == True
        assert isinstance(agent._command_handlers, dict)
        assert isinstance(agent._scheduled_tasks, list)
    
    def test_initialization_with_custom_id(self):
        """Test agent initialization with custom ID."""
        agent = TestWorkerAgent(agent_id="custom-id")
        assert agent.client.agent_id == "custom-id"
    
    def test_is_mentioned(self, worker_agent):
        """Test mention detection."""
        assert worker_agent.is_mentioned("Hello @test-agent how are you?")
        assert worker_agent.is_mentioned("@test-agent")
        assert not worker_agent.is_mentioned("Hello @other-agent")
        assert not worker_agent.is_mentioned("Hello test-agent")  # No @ symbol
    
    def test_extract_mentions(self, worker_agent):
        """Test mention extraction."""
        mentions = worker_agent.extract_mentions("Hello @user1 and @user2!")
        assert mentions == ["user1", "user2"]
        
        mentions = worker_agent.extract_mentions("No mentions here")
        assert mentions == []
        
        mentions = worker_agent.extract_mentions("@single-mention")
        assert mentions == ["single-mention"]


class TestMessageHandling:
    """Test message handling functionality."""
    
    @pytest.mark.asyncio
    async def test_direct_message_handling(self, worker_agent):
        """Test direct message handling."""
        # Create a direct message
        message = DirectMessage(
            sender_id="user1",
            target_agent_id="test-agent",
            content={"text": "Hello agent!"},
            text_representation="Hello agent!"
        )
        
        # Process the message
        await worker_agent._handle_direct_message(message)
        
        # Check that the handler was called
        assert len(worker_agent.received_messages) == 1
        msg_type, context = worker_agent.received_messages[0]
        assert msg_type == "direct"
        assert isinstance(context, DirectMessageContext)
        assert context.sender_id == "user1"
        assert context.text == "Hello agent!"
        assert context.target_agent_id == "test-agent"
    
    @pytest.mark.asyncio
    async def test_broadcast_message_handling(self, worker_agent):
        """Test broadcast message handling."""
        # Create a broadcast message
        message = BroadcastMessage(
            sender_id="user1",
            content={"text": "Hello everyone!"},
            text_representation="Hello everyone!"
        )
        
        # Process the message
        await worker_agent._handle_broadcast_message(message)
        
        # Check that the handler was called
        assert len(worker_agent.received_messages) == 1
        msg_type, context = worker_agent.received_messages[0]
        assert msg_type == "channel_post"
        assert isinstance(context, ChannelMessageContext)
        assert context.sender_id == "user1"
        assert context.text == "Hello everyone!"
        assert context.channel == "general"  # Default channel for broadcasts
    
    @pytest.mark.asyncio
    async def test_broadcast_message_with_mention(self, worker_agent):
        """Test broadcast message with mention."""
        # Create a broadcast message that mentions the agent
        message = BroadcastMessage(
            sender_id="user1",
            content={"text": "Hello @test-agent!"},
            text_representation="Hello @test-agent!"
        )
        
        # Process the message
        await worker_agent._handle_broadcast_message(message)
        
        # Check that the mention handler was called
        assert len(worker_agent.received_messages) == 1
        msg_type, context = worker_agent.received_messages[0]
        assert msg_type == "channel_mention"
        assert isinstance(context, ChannelMessageContext)
        assert context.sender_id == "user1"
        assert context.text == "Hello @test-agent!"
    
    @pytest.mark.asyncio
    async def test_ignore_own_messages(self, worker_agent):
        """Test that agent ignores its own messages."""
        # Create a message from the agent itself
        message = DirectMessage(
            sender_id="test-agent",  # Same as agent ID
            target_agent_id="other-agent",
            content={"text": "Self message"},
            text_representation="Self message"
        )
        
        # Process the message
        await worker_agent.react({}, "thread1", message)
        
        # Check that no handlers were called
        assert len(worker_agent.received_messages) == 0


class TestSendingMethods:
    """Test message sending methods."""
    
    @pytest.mark.asyncio
    async def test_send_direct(self, worker_agent, mock_thread_adapter):
        """Test sending direct messages."""
        await worker_agent.send_direct(to="user1", text="Hello user!")
        
        mock_thread_adapter.send_direct_message.assert_called_once_with(
            target_agent_id="user1",
            text="Hello user!",
            quote=None
        )
    
    @pytest.mark.asyncio
    async def test_send_channel(self, worker_agent, mock_thread_adapter):
        """Test sending channel messages."""
        await worker_agent.send_channel(channel="#general", text="Hello channel!")
        
        mock_thread_adapter.send_channel_message.assert_called_once_with(
            channel="#general",
            text="Hello channel!",
            mentioned_agent_id=None,
            quote=None
        )
    
    @pytest.mark.asyncio
    async def test_send_channel_with_mention(self, worker_agent, mock_thread_adapter):
        """Test sending channel messages with mentions."""
        await worker_agent.send_channel(
            channel="#general", 
            text="Hello!", 
            mention="user1"
        )
        
        mock_thread_adapter.send_channel_message.assert_called_once_with(
            channel="#general",
            text="@user1 Hello!",
            mentioned_agent_id="user1",
            quote=None
        )
    
    @pytest.mark.asyncio
    async def test_send_reply(self, worker_agent, mock_thread_adapter):
        """Test sending reply messages."""
        await worker_agent.send_reply(reply_to_id="msg123", text="This is a reply")
        
        mock_thread_adapter.send_reply_message.assert_called_once_with(
            reply_to_id="msg123",
            text="This is a reply",
            quote=None
        )
    
    @pytest.mark.asyncio
    async def test_react_to(self, worker_agent, mock_thread_adapter):
        """Test adding reactions."""
        await worker_agent.react_to(message_id="msg123", reaction="thumbs_up")
        
        mock_thread_adapter.add_reaction.assert_called_once_with(
            target_message_id="msg123",
            reaction_type="thumbs_up"
        )
    
    @pytest.mark.asyncio
    async def test_upload_file(self, worker_agent, mock_thread_adapter):
        """Test file upload."""
        file_content = b"Hello, world!"
        await worker_agent.upload_file(
            filename="test.txt",
            content=file_content,
            mime_type="text/plain"
        )
        
        # Check that the adapter was called with base64 encoded content
        mock_thread_adapter.upload_file.assert_called_once()
        call_args = mock_thread_adapter.upload_file.call_args[1]
        assert call_args["filename"] == "test.txt"
        assert call_args["mime_type"] == "text/plain"
        assert call_args["file_size"] == len(file_content)
        
        # Verify base64 encoding
        import base64
        expected_b64 = base64.b64encode(file_content).decode('utf-8')
        assert call_args["file_content"] == expected_b64


class TestCommandHandling:
    """Test command registration and handling."""
    
    def test_register_command(self, worker_agent):
        """Test command registration."""
        async def test_handler(context, args):
            pass
        
        worker_agent.register_command("/test", test_handler)
        assert "/test" in worker_agent._command_handlers
        assert worker_agent._command_handlers["/test"] == test_handler
    
    @pytest.mark.asyncio
    async def test_command_handling(self, worker_agent):
        """Test command handling."""
        # Register a test command
        handled_commands = []
        
        async def test_handler(context, args):
            handled_commands.append((context, args))
        
        worker_agent.register_command("/test", test_handler)
        
        # Create a direct message with the command
        context = DirectMessageContext(
            message_id="msg1",
            sender_id="user1",
            timestamp=123456,
            content={"text": "/test arg1 arg2"},
            raw_message=Mock(),
            target_agent_id="test-agent"
        )
        
        # Handle the command
        result = await worker_agent._handle_command(context)
        
        # Check that the command was handled
        assert result == True
        assert len(handled_commands) == 1
        assert handled_commands[0][0] == context
        assert handled_commands[0][1] == "arg1 arg2"


class TestContextClasses:
    """Test message context classes."""
    
    def test_message_context_text_property(self):
        """Test text property extraction."""
        # Test with dict content
        context = DirectMessageContext(
            message_id="msg1",
            sender_id="user1",
            timestamp=123456,
            content={"text": "Hello world"},
            raw_message=Mock(),
            target_agent_id="test-agent"
        )
        assert context.text == "Hello world"
        
        # Test with string content
        context.content = "Direct string"
        assert context.text == "Direct string"
        
        # Test with other content
        context.content = {"other": "data"}
        assert context.text == "{'other': 'data'}"
    
    def test_channel_message_context_mentions(self):
        """Test mention extraction in channel context."""
        context = ChannelMessageContext(
            message_id="msg1",
            sender_id="user1",
            timestamp=123456,
            content={"text": "Hello @user2 and @user3!"},
            raw_message=Mock(),
            channel="#general"
        )
        
        assert context.mentions == ["user2", "user3"]
    
    def test_file_context_content_bytes(self):
        """Test file content decoding."""
        import base64
        
        original_content = b"Hello, world!"
        encoded_content = base64.b64encode(original_content).decode('utf-8')
        
        context = FileContext(
            message_id="msg1",
            sender_id="user1",
            filename="test.txt",
            file_content=encoded_content,
            mime_type="text/plain",
            file_size=len(original_content),
            timestamp=123456,
            raw_message=Mock()
        )
        
        assert context.content_bytes == original_content


class TestAsyncMethods:
    """Test async utility methods."""
    
    @pytest.mark.asyncio
    async def test_schedule_task(self, worker_agent):
        """Test task scheduling."""
        executed = []
        
        async def test_task():
            executed.append("done")
        
        # Schedule a task with minimal delay
        task = await worker_agent.schedule_task(0.01, test_task)
        
        # Wait for the task to complete
        await asyncio.sleep(0.02)
        
        assert executed == ["done"]
        assert task in worker_agent._scheduled_tasks
        assert task.done()


if __name__ == "__main__":
    pytest.main([__file__])
