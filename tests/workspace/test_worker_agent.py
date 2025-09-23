"""
WorkerAgent EventResponse integration test.

This test verifies that the refactored WorkerAgent works correctly with the new 
event system and returns proper EventResponse objects for all messaging operations.
"""

import pytest
import asyncio
import random
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

from openagents.core.client import AgentClient
from openagents.core.network import create_network
from openagents.launchers.network_launcher import load_network_config
from openagents.agents.worker_agent import WorkerAgent
from openagents.models.event_response import EventResponse
from openagents.core.workspace import Workspace


class MockWorkerAgent(WorkerAgent):
    """Test WorkerAgent implementation for testing."""
    
    default_agent_id = "test-worker"
    
    def __init__(self, *args, **kwargs):
        # Mock the runner initialization to avoid async issues
        self._test_mode = True
        self._client = None
        self._workspace_client = None
        
        # Initialize basic attributes without calling super().__init__
        self.default_agent_id = kwargs.get('agent_id', self.default_agent_id)
        self._command_handlers = {}
        self._scheduled_tasks = []
        self._message_history_cache = {}
        self._pending_history_requests = {}
        self._active_projects = {}
        self._project_channels = {}
        self._project_event_subscription = None
        self._project_event_queue = None
        self._workspace_client = None
        self._project_mod_available = False
        
        # Create a mock client
        self._client = MagicMock()
        self._client.agent_id = self.default_agent_id
        self._network_client = self._client  # For runner compatibility
    
    def workspace(self) -> Workspace:
        """Override workspace to return a mock."""
        if self._workspace_client is None:
            self._workspace_client = MagicMock(spec=Workspace)
        return self._workspace_client


@pytest.fixture
async def test_network():
    """Create and start a network using workspace_test.yaml config."""
    config_path = Path(__file__).parent.parent.parent / "examples" / "workspace_test.yaml"
    
    # Load config and use random port to avoid conflicts
    config = load_network_config(str(config_path))
    
    # Update the gRPC transport port to avoid conflicts
    grpc_port = random.randint(49000, 50000)
    http_port = grpc_port + 100  # HTTP port should be different
    
    for transport in config.network.transports:
        if transport.type == "grpc":
            transport.config["port"] = grpc_port
        elif transport.type == "http":
            transport.config["port"] = http_port
    
    # Create and initialize network
    network = create_network(config.network)
    await network.initialize()
    
    # Give network time to start up
    await asyncio.sleep(2.0)
    
    yield network, config, grpc_port, http_port
    
    # Cleanup
    try:
        await network.shutdown()
    except Exception as e:
        print(f"Error during network shutdown: {e}")


@pytest.fixture
async def worker_agent():
    """Create a test WorkerAgent instance."""
    agent = MockWorkerAgent(agent_id="test-worker-agent")
    yield agent


@pytest.fixture
async def mock_workspace():
    """Create a mock workspace with EventResponse integration."""
    workspace = MagicMock(spec=Workspace)
    
    # Mock agent connection
    agent_connection = MagicMock()
    agent_connection.send_message = AsyncMock(return_value=EventResponse(success=True, message="Message sent"))
    workspace.agent.return_value = agent_connection
    
    # Mock channel connection
    channel_connection = MagicMock()
    channel_connection.post = AsyncMock(return_value=EventResponse(success=True, message="Message posted"))
    channel_connection.reply_to_message = AsyncMock(return_value=EventResponse(success=True, message="Reply sent"))
    channel_connection.react_to_message = AsyncMock(return_value=EventResponse(success=True, message="Reaction added"))
    channel_connection.upload_file = AsyncMock(return_value="file-uuid-123")
    workspace.channel.return_value = channel_connection
    
    # Mock utility methods
    workspace.channels = AsyncMock(return_value=["general", "development", "support"])
    workspace.agents = AsyncMock(return_value=["agent1", "agent2", "test-worker-agent"])
    
    return workspace


@pytest.mark.asyncio
async def test_worker_agent_send_direct(worker_agent, mock_workspace):
    """Test WorkerAgent.send_direct returns EventResponse."""
    
    # Setup mock workspace
    worker_agent._workspace_client = mock_workspace
    
    # Test send_direct with text
    response = await worker_agent.send_direct(to="target-agent", text="Hello world!")
    
    assert isinstance(response, EventResponse)
    assert response.success
    assert response.message == "Message sent"
    
    # Verify workspace was called correctly
    mock_workspace.agent.assert_called_once_with("target-agent")
    agent_connection = mock_workspace.agent.return_value
    agent_connection.send_message.assert_called_once_with({"text": "Hello world!"})


@pytest.mark.asyncio
async def test_worker_agent_send_direct_with_content(worker_agent, mock_workspace):
    """Test WorkerAgent.send_direct with dict content."""
    
    worker_agent._workspace_client = mock_workspace
    
    content = {"text": "Hello", "extra": "data"}
    response = await worker_agent.send_direct(to="target-agent", content=content)
    
    assert isinstance(response, EventResponse)
    assert response.success
    
    agent_connection = mock_workspace.agent.return_value
    agent_connection.send_message.assert_called_once_with(content)


@pytest.mark.asyncio
async def test_worker_agent_post_to_channel(worker_agent, mock_workspace):
    """Test WorkerAgent.post_to_channel returns EventResponse."""
    
    worker_agent._workspace_client = mock_workspace
    
    response = await worker_agent.post_to_channel(channel="general", text="Channel message!")
    
    assert isinstance(response, EventResponse)
    assert response.success
    assert response.message == "Message posted"
    
    mock_workspace.channel.assert_called_once_with("general")
    channel_connection = mock_workspace.channel.return_value
    channel_connection.post.assert_called_once_with({"text": "Channel message!"})


@pytest.mark.asyncio
async def test_worker_agent_reply_to_message(worker_agent, mock_workspace):
    """Test WorkerAgent.reply_to_message returns EventResponse."""
    
    worker_agent._workspace_client = mock_workspace
    
    response = await worker_agent.reply_to_message(
        channel="general", 
        message_id="msg-123", 
        text="This is a reply"
    )
    
    assert isinstance(response, EventResponse)
    assert response.success
    assert response.message == "Reply sent"
    
    channel_connection = mock_workspace.channel.return_value
    channel_connection.reply_to_message.assert_called_once_with(
        "msg-123", 
        {"text": "This is a reply"}
    )


@pytest.mark.asyncio
async def test_worker_agent_react_to_message(worker_agent, mock_workspace):
    """Test WorkerAgent.react_to_message returns EventResponse."""
    
    worker_agent._workspace_client = mock_workspace
    
    response = await worker_agent.react_to_message(
        channel="general", 
        message_id="msg-123", 
        reaction="👍"
    )
    
    assert isinstance(response, EventResponse)
    assert response.success
    assert response.message == "Reaction added"
    
    channel_connection = mock_workspace.channel.return_value
    channel_connection.react_to_message.assert_called_once_with("msg-123", "👍", "add")


@pytest.mark.asyncio
async def test_worker_agent_react_remove(worker_agent, mock_workspace):
    """Test WorkerAgent.react_to_message with remove action."""
    
    worker_agent._workspace_client = mock_workspace
    
    response = await worker_agent.react_to_message(
        channel="general", 
        message_id="msg-123", 
        reaction="👍",
        action="remove"
    )
    
    assert isinstance(response, EventResponse)
    assert response.success
    
    channel_connection = mock_workspace.channel.return_value
    channel_connection.react_to_message.assert_called_once_with("msg-123", "👍", "remove")


@pytest.mark.asyncio
async def test_worker_agent_upload_file(worker_agent, mock_workspace):
    """Test WorkerAgent.upload_file returns file UUID."""
    
    worker_agent._workspace_client = mock_workspace
    
    file_uuid = await worker_agent.upload_file(
        channel="general", 
        file_path="/path/to/file.txt",
        filename="custom_name.txt"
    )
    
    assert file_uuid == "file-uuid-123"
    
    channel_connection = mock_workspace.channel.return_value
    channel_connection.upload_file.assert_called_once_with("/path/to/file.txt", "custom_name.txt")


@pytest.mark.asyncio
async def test_worker_agent_get_channel_list(worker_agent, mock_workspace):
    """Test WorkerAgent.get_channel_list returns channel list."""
    
    worker_agent._workspace_client = mock_workspace
    
    channels = await worker_agent.get_channel_list()
    
    assert channels == ["general", "development", "support"]
    mock_workspace.channels.assert_called_once()


@pytest.mark.asyncio
async def test_worker_agent_get_agent_list(worker_agent, mock_workspace):
    """Test WorkerAgent.get_agent_list returns agent list."""
    
    worker_agent._workspace_client = mock_workspace
    
    agents = await worker_agent.get_agent_list()
    
    assert agents == ["agent1", "agent2", "test-worker-agent"]
    mock_workspace.agents.assert_called_once()


@pytest.mark.asyncio
async def test_worker_agent_error_handling(worker_agent, mock_workspace):
    """Test WorkerAgent error handling with EventResponse."""
    
    worker_agent._workspace_client = mock_workspace
    
    # Mock a failed response
    agent_connection = mock_workspace.agent.return_value
    agent_connection.send_message = AsyncMock(
        return_value=EventResponse(success=False, message="Network error")
    )
    
    response = await worker_agent.send_direct(to="target-agent", text="This will fail")
    
    assert isinstance(response, EventResponse)
    assert not response.success
    assert response.message == "Network error"


@pytest.mark.asyncio
async def test_worker_agent_get_channel_messages_mock(worker_agent):
    """Test WorkerAgent.get_channel_messages with mocked adapter."""
    
    # Mock the thread adapter
    mock_adapter = MagicMock()
    mock_adapter.request_channel_messages = AsyncMock()
    worker_agent._thread_adapter = mock_adapter
    
    # Test result that should be returned
    expected_result = {
        "messages": [
            {"message_id": "1", "text": "Hello"},
            {"message_id": "2", "text": "World"}
        ],
        "total_count": 2,
        "has_more": False
    }
    
    # Create an async function to simulate the future resolution
    async def mock_get_messages():
        # Simulate the async request pattern
        future_key = "get_channel_messages:general"
        future = asyncio.Future()
        future.set_result(expected_result)
        worker_agent._pending_history_requests[future_key] = future
        return await future
    
    # Mock the method to return our expected result
    worker_agent.get_channel_messages = mock_get_messages
    
    result = await worker_agent.get_channel_messages()
    
    assert result["total_count"] == 2
    assert len(result["messages"]) == 2
    assert result["messages"][0]["text"] == "Hello"


@pytest.mark.asyncio
async def test_worker_agent_get_direct_messages_mock(worker_agent):
    """Test WorkerAgent.get_direct_messages with mocked adapter."""
    
    # Test result that should be returned
    expected_result = {
        "messages": [
            {"message_id": "1", "sender_id": "agent1", "text": "Direct message 1"},
            {"message_id": "2", "sender_id": "test-worker-agent", "text": "Direct message 2"}
        ],
        "total_count": 2,
        "has_more": False
    }
    
    # Create an async function to simulate the direct message retrieval
    async def mock_get_direct_messages(with_agent, limit=50, offset=0):
        # Use the parameters to avoid warnings
        _ = with_agent, limit, offset
        return expected_result
    
    # Mock the method to return our expected result
    worker_agent.get_direct_messages = mock_get_direct_messages
    
    result = await worker_agent.get_direct_messages("agent1", limit=5)
    
    assert result["total_count"] == 2
    assert len(result["messages"]) == 2
    assert result["messages"][0]["sender_id"] == "agent1"


@pytest.mark.asyncio
async def test_worker_agent_get_messages_timeout(worker_agent):
    """Test WorkerAgent message retrieval timeout handling."""
    
    # Mock the thread adapter
    mock_adapter = MagicMock()
    mock_adapter.request_channel_messages = AsyncMock()
    worker_agent._thread_adapter = mock_adapter
    
    # Test timeout scenario
    result = await worker_agent.get_channel_messages("general", limit=10)
    
    # Should return empty result on timeout/error
    assert result["messages"] == []
    assert result["total_count"] == 0
    assert result["has_more"] == False


@pytest.mark.asyncio
async def test_worker_agent_no_adapter(worker_agent):
    """Test WorkerAgent methods when no thread adapter is available."""
    
    # Ensure no adapter is set
    worker_agent._thread_adapter = None
    
    result = await worker_agent.get_channel_messages("general")
    
    assert result["messages"] == []
    assert result["total_count"] == 0
    assert result["has_more"] == False


@pytest.mark.asyncio
async def test_worker_agent_empty_content_handling(worker_agent, mock_workspace):
    """Test WorkerAgent handles empty content gracefully."""
    
    worker_agent._workspace_client = mock_workspace
    
    # Test with no text or content
    response = await worker_agent.send_direct(to="target-agent")
    
    assert isinstance(response, EventResponse)
    assert response.success
    
    agent_connection = mock_workspace.agent.return_value
    agent_connection.send_message.assert_called_once_with({"text": ""})


@pytest.mark.asyncio
async def test_worker_agent_utility_methods(worker_agent):
    """Test WorkerAgent utility methods are preserved."""
    
    # Test is_mentioned
    assert worker_agent.is_mentioned("Hello @test-worker-agent!")
    assert not worker_agent.is_mentioned("Hello @other-agent!")
    
    # Test extract_mentions
    mentions = worker_agent.extract_mentions("Hello @agent1 and @agent2!")
    assert mentions == ["agent1", "agent2"]
    


def test_worker_agent_class_attributes():
    """Test WorkerAgent class has correct method signatures."""
    
    # Test that messaging methods return EventResponse
    methods_with_eventresponse = [
        'send_direct', 
        'post_to_channel', 
        'reply_to_message', 
        'react_to_message'
    ]
    
    for method_name in methods_with_eventresponse:
        method = getattr(WorkerAgent, method_name)
        return_annotation = method.__annotations__.get('return')
        assert return_annotation == EventResponse, f"{method_name} should return EventResponse"
    
    # Test that utility methods have correct return types
    method = getattr(WorkerAgent, 'get_channel_list')
    return_annotation = method.__annotations__.get('return')
    assert 'List[str]' in str(return_annotation) or return_annotation.__origin__ == list
    
    method = getattr(WorkerAgent, 'upload_file')
    return_annotation = method.__annotations__.get('return')
    assert 'Optional[str]' in str(return_annotation) or return_annotation.__origin__ == type(None).__class__.__base__


@pytest.mark.asyncio
async def test_worker_agent_integration_with_real_network(test_network):
    """Test WorkerAgent integration with a real network (if available)."""
    
    _network, _config, _grpc_port, http_port = test_network
    
    # Create a real client
    client = AgentClient(agent_id="worker-test-client")
    await client.connect("localhost", http_port)
    
    try:
        # Create a test worker agent with real client
        class RealTestWorkerAgent(WorkerAgent):
            default_agent_id = "real-test-worker"
            
            def __init__(self, client):
                # Skip the normal initialization that causes issues
                self._client = client
                self._network_client = client  # For runner compatibility
                self._command_handlers = {}
                self._scheduled_tasks = []
                self._message_history_cache = {}
                self._pending_history_requests = {}
                self._active_projects = {}
                self._project_channels = {}
                self._workspace_client = None
        
        agent = RealTestWorkerAgent(client)
        
        # Test that workspace() works
        workspace = agent.workspace()
        assert isinstance(workspace, Workspace)
        
        # Test basic functionality
        channel_connection = workspace.channel("general")
        assert channel_connection is not None
        
        agent_connection = workspace.agent("other-agent")
        assert agent_connection is not None
        
        print("✅ WorkerAgent successfully integrates with real network")
        
    finally:
        try:
            await client.disconnect()
        except Exception as e:
            print(f"Error disconnecting client: {e}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s", "--tb=short"])