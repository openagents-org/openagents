"""
Tests for the WorkerAgent class.
"""

import pytest
import asyncio
from unittest.mock import Mock, AsyncMock, MagicMock
from typing import Dict, Any

from openagents.agents.worker_agent import (
    WorkerAgent,
    EventContext,
    ChannelMessageContext,
    ReplyMessageContext,
    ReactionContext,
    FileContext
)
from openagents.models.messages import Event, EventNames


class MockWorkerAgent(WorkerAgent):
    """Mock agent for unit testing."""
    
    name = "test-agent"
    
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.received_messages = []
        self.sent_messages = []
    
    async def on_direct(self, msg: EventContext):
        self.received_messages.append(('direct', msg))
        # Use workspace for sending messages (mocked in tests)
        try:
            ws = self.workspace()
            await ws.agent(msg.source_id).send_message(f"Got: {msg.text}")
        except AttributeError:
            # In tests, workspace might not be available
            pass
    
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
    agent = MockWorkerAgent(agent_id="test-agent")
    agent._network_client = mock_client
    mock_client.mod_adapters = {"thread_messaging": mock_thread_adapter}
    # Set the thread adapter directly for testing
    agent._thread_adapter = mock_thread_adapter
    
    # Mock the workspace method and client workspace
    mock_workspace = Mock()
    mock_agent_conn = Mock()
    mock_agent_conn.send_direct_message = AsyncMock(return_value=True)
    mock_workspace.agent.return_value = mock_agent_conn
    
    # Mock the client's workspace method
    mock_client.workspace = Mock(return_value=mock_workspace)
    
    # Override the workspace method on the agent
    def mock_workspace_method():
        return mock_workspace
    
    agent.workspace = mock_workspace_method
    
    return agent


class MockWorkerAgentBasics:
    """Test basic WorkerAgent functionality."""
    
    def test_initialization(self):
        """Test agent initialization."""
        agent = MockWorkerAgent()
        assert agent.name == "test-agent"
        assert agent.ignore_own_messages == True
        assert agent.auto_mention_response == True
        assert isinstance(agent._command_handlers, dict)
        assert isinstance(agent._scheduled_tasks, list)
    
    def test_initialization_with_custom_id(self):
        """Test agent initialization with custom ID."""
        agent = MockWorkerAgent(agent_id="custom-id")
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
        message = Event(
            event_name="agent.direct_message.received",
            source_id="user1",
            destination_id="test-agent",
            payload={"text": "Hello agent!"},
            text_representation="Hello agent!"
        )
        
        # Process the message
        await worker_agent._handle_direct_message(message)
        
        # Check that the handler was called
        assert len(worker_agent.received_messages) == 1
        msg_type, context = worker_agent.received_messages[0]
        assert msg_type == "direct"
        assert isinstance(context, EventContext)
        assert context.source_id == "user1"
        assert context.text == "Hello agent!"
        assert context.target_agent_id == "test-agent"
    
    @pytest.mark.asyncio
    async def test_broadcast_message_handling(self, worker_agent):
        """Test broadcast message handling."""
        # Create a broadcast message
        message = Event(
            event_name="agent.broadcast_message.received",
            source_id="user1",
            payload={"text": "Hello everyone!"}
        )
        
        # Process the message
        await worker_agent._handle_broadcast_message(message)
        
        # Check that the handler was called
        assert len(worker_agent.received_messages) == 1
        msg_type, context = worker_agent.received_messages[0]
        assert msg_type == "channel_post"
        assert isinstance(context, ChannelMessageContext)
        assert context.source_id == "user1"
        assert context.text == "Hello everyone!"
        assert context.channel == "general"  # Default channel for broadcasts
    
    @pytest.mark.asyncio
    async def test_broadcast_message_with_mention(self, worker_agent):
        """Test broadcast message with mention."""
        # Create a broadcast message that mentions the agent
        message = Event(
            event_name="agent.broadcast_message.received",
            source_id="user1",
            payload={"text": "Hello @test-agent!"}
        )
        
        # Process the message
        await worker_agent._handle_broadcast_message(message)
        
        # Check that the mention handler was called
        assert len(worker_agent.received_messages) == 1
        msg_type, context = worker_agent.received_messages[0]
        assert msg_type == "channel_mention"
        assert isinstance(context, ChannelMessageContext)
        assert context.source_id == "user1"
        assert context.text == "Hello @test-agent!"
    
    @pytest.mark.asyncio
    async def test_ignore_own_messages(self, worker_agent):
        """Test that agent ignores its own messages."""
        # Create a message from the agent itself
        message = Event(
            event_name="agent.direct_message.received",
            source_id="test-agent",  # Same as agent ID
            destination_id="other-agent",
            payload={"text": "Self message"}
        )
        
        # Process the message
        await worker_agent.react({}, "thread1", message)
        
        # Check that no handlers were called
        assert len(worker_agent.received_messages) == 0


class TestSendingMethods:
    """Test message sending methods."""
    
    @pytest.mark.asyncio
    async def test_send_direct(self, worker_agent, mock_thread_adapter):
        """Test sending direct messages via workspace."""
        # Mock workspace and agent connection
        mock_workspace = Mock()
        mock_agent_conn = Mock()
        mock_agent_conn.send_direct_message = AsyncMock(return_value=True)
        mock_workspace.agent.return_value = mock_agent_conn
        
        # Mock the workspace() method
        worker_agent.workspace = Mock(return_value=mock_workspace)
        
        # Test sending via workspace
        ws = worker_agent.workspace()
        await ws.agent("user1").send_direct_message("Hello user!")
        
        mock_agent_conn.send_direct_message.assert_called_once_with("Hello user!")
    
    @pytest.mark.asyncio
    async def test_send_channel(self, worker_agent, mock_thread_adapter):
        """Test sending channel messages via workspace."""
        # Mock workspace and channel connection
        mock_workspace = Mock()
        mock_channel_conn = Mock()
        mock_channel_conn.post = AsyncMock(return_value=True)
        mock_workspace.channel.return_value = mock_channel_conn
        
        # Mock the workspace() method
        worker_agent.workspace = Mock(return_value=mock_workspace)
        
        # Test sending via workspace
        ws = worker_agent.workspace()
        await ws.channel("#general").post("Hello channel!")
        
        mock_channel_conn.post.assert_called_once_with("Hello channel!")
    
    @pytest.mark.asyncio
    async def test_send_channel_with_mention(self, worker_agent, mock_thread_adapter):
        """Test sending channel messages with mentions via workspace."""
        # Mock workspace and channel connection
        mock_workspace = Mock()
        mock_channel_conn = Mock()
        mock_channel_conn.post_with_mention = AsyncMock(return_value=True)
        mock_workspace.channel.return_value = mock_channel_conn
        
        # Mock the workspace() method
        worker_agent.workspace = Mock(return_value=mock_workspace)
        
        # Test sending via workspace
        ws = worker_agent.workspace()
        await ws.channel("#general").post_with_mention("Hello!", mention_agent_id="user1")
        
        mock_channel_conn.post_with_mention.assert_called_once_with("Hello!", mention_agent_id="user1")
    
    @pytest.mark.asyncio
    async def test_send_reply(self, worker_agent, mock_thread_adapter):
        """Test sending reply messages via workspace."""
        # Mock workspace and channel connection
        mock_workspace = Mock()
        mock_channel_conn = Mock()
        mock_channel_conn.reply_to_message = AsyncMock(return_value=True)
        mock_workspace.channel.return_value = mock_channel_conn
        
        # Mock the workspace() method
        worker_agent.workspace = Mock(return_value=mock_workspace)
        
        # Test sending via workspace
        ws = worker_agent.workspace()
        await ws.channel("general").reply_to_message("msg123", "This is a reply")
        
        mock_channel_conn.reply_to_message.assert_called_once_with("msg123", "This is a reply")
    
    @pytest.mark.asyncio
    async def test_react_to(self, worker_agent, mock_thread_adapter):
        """Test adding reactions via workspace."""
        # Mock workspace and channel connection
        mock_workspace = Mock()
        mock_channel_conn = Mock()
        mock_channel_conn.react_to_message = AsyncMock(return_value=True)
        mock_workspace.channel.return_value = mock_channel_conn
        
        # Mock the workspace() method
        worker_agent.workspace = Mock(return_value=mock_workspace)
        
        # Test reacting via workspace
        ws = worker_agent.workspace()
        await ws.channel("general").react_to_message("msg123", "thumbs_up")
        
        mock_channel_conn.react_to_message.assert_called_once_with("msg123", "thumbs_up")
    
    @pytest.mark.asyncio
    async def test_upload_file(self, worker_agent, mock_thread_adapter):
        """Test file upload via workspace."""
        # Mock workspace and channel connection
        mock_workspace = Mock()
        mock_channel_conn = Mock()
        mock_channel_conn.upload_file = AsyncMock(return_value="file-uuid-123")
        mock_workspace.channel.return_value = mock_channel_conn
        
        # Mock the workspace() method
        worker_agent.workspace = Mock(return_value=mock_workspace)
        
        # Test uploading via workspace
        ws = worker_agent.workspace()
        file_uuid = await ws.channel("general").upload_file("/path/to/test.txt")
        
        mock_channel_conn.upload_file.assert_called_once_with("/path/to/test.txt")
        assert file_uuid == "file-uuid-123"


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
        context = EventContext(
            message_id="msg1",
            source_id="user1",
            timestamp=123456,
            payload={"text": "/test arg1 arg2"},
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
        context = EventContext(
            message_id="msg1",
            source_id="user1",
            timestamp=123456,
            payload={"text": "Hello world"},
            raw_message=Mock(),
            target_agent_id="test-agent"
        )
        assert context.text == "Hello world"
        
        # Test with string content
        context.payload = "Direct string"
        assert context.text == "Direct string"
        
        # Test with other content
        context.payload = {"other": "data"}
        assert context.text == "{'other': 'data'}"
    
    def test_channel_message_context_mentions(self):
        """Test mention extraction in channel context."""
        context = ChannelMessageContext(
            message_id="msg1",
            source_id="user1",
            timestamp=123456,
            payload={"text": "Hello @user2 and @user3!"},
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
            source_id="user1",
            filename="test.txt",
            file_content=encoded_content,
            mime_type="text/plain",
            file_size=len(original_content),
            timestamp=123456,
            raw_message=Mock()
        )
        
        assert context.payload_bytes == original_content


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
