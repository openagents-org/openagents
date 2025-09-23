"""
Tests for the new message processing pipeline.
"""

import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock

from openagents.models.event import Event, EventVisibility
from openagents.core.message_processor import EventProcessor
from openagents.core.base_mod import BaseMod


class MockTestMod(BaseMod):
    """Test mod for pipeline testing."""
    
    def __init__(self, mod_name: str):
        super().__init__(mod_name)
        self.processed_direct = []
        self.processed_broadcast = []
        self.processed_system = []
    
    async def process_direct_message(self, message: Event):
        self.processed_direct.append(message.event_id)
        return message  # Continue processing
    
    async def process_broadcast_message(self, message: Event):
        self.processed_broadcast.append(message.event_id)
        return message  # Continue processing
    
    async def process_system_message(self, message: Event):
        self.processed_system.append(message.event_id)
        return message  # Continue processing


class MockStoppingTestMod(BaseMod):
    """Test mod that stops processing."""
    
    def __init__(self, mod_name: str):
        super().__init__(mod_name)
    
    async def process_direct_message(self, message: Event):
        return None  # Stop processing
    
    async def process_broadcast_message(self, message: Event):
        return None  # Stop processing
    
    async def process_system_message(self, message: Event):
        return None  # Stop processing


@pytest.fixture
def mock_network():
    """Create a mock network for testing."""
    network = MagicMock()
    network.network_id = "test-network"
    network.mods = {}
    network.agents = {"agent1": {"metadata": {}}, "agent2": {"metadata": {}}}
    network._registered_workspaces = {}
    network._registered_agent_clients = {}
    network._queue_message_for_agent = MagicMock()
    network.topology = MagicMock()
    network.topology.route_message = AsyncMock(return_value=True)
    return network


@pytest.fixture
def message_processor(mock_network):
    """Create a message processor with mock network."""
    return EventProcessor(mock_network)


@pytest.mark.asyncio
async def test_event_message_type_classification():
    """Test that events are properly classified by message type."""
    # Direct message
    direct_event = Event(
        event_name="agent.message",
        source_id="agent1",
        destination_id="agent2"
    )
    assert direct_event.is_direct_message() == True
    assert direct_event.is_broadcast_message() == False
    assert direct_event.is_system_message() == False
    assert direct_event.get_message_type() == "direct_message"
    
    # Broadcast message
    broadcast_event = Event(
        event_name="agent.broadcast_message.sent",
        source_id="agent1"
    )
    assert broadcast_event.is_direct_message() == False
    assert broadcast_event.is_broadcast_message() == True
    assert broadcast_event.is_system_message() == False
    assert broadcast_event.get_message_type() == "broadcast_message"
    
    # System message
    system_event = Event(
        event_name="project.created",
        source_id="agent1"
    )
    assert system_event.is_direct_message() == False
    assert system_event.is_broadcast_message() == False
    assert system_event.is_system_message() == True
    assert system_event.get_message_type() == "system_message"


@pytest.mark.asyncio
async def test_direct_message_pipeline(message_processor, mock_network):
    """Test direct message processing through mod pipeline."""
    # Set up mods
    mod1 = MockTestMod("mod1")
    mod2 = MockTestMod("mod2")
    mock_network.mods = {"mod1": mod1, "mod2": mod2}
    
    # Create direct message
    message = Event(
        event_name="agent.message",
        source_id="agent1",
        destination_id="agent2",
        payload={"text": "Hello"}
    )
    
    # Process message
    result = await message_processor.process_message(message)
    
    # Verify processing
    assert result == True
    assert message.event_id in mod1.processed_direct
    assert message.event_id in mod2.processed_direct
    assert message.event_id not in mod1.processed_broadcast
    assert message.event_id not in mod1.processed_system
    
    # Verify delivery was attempted
    mock_network.topology.route_message.assert_called_once()


@pytest.mark.asyncio
async def test_broadcast_message_pipeline(message_processor, mock_network):
    """Test broadcast message processing through mod pipeline."""
    # Set up mods
    mod1 = MockTestMod("mod1")
    mod2 = MockTestMod("mod2")
    mock_network.mods = {"mod1": mod1, "mod2": mod2}
    
    # Create broadcast message
    message = Event(
        event_name="agent.broadcast_message.sent",
        source_id="agent1",
        payload={"text": "Hello everyone"}
    )
    
    # Process message
    result = await message_processor.process_message(message)
    
    # Verify processing
    assert result == True
    assert message.event_id in mod1.processed_broadcast
    assert message.event_id in mod2.processed_broadcast
    assert message.event_id not in mod1.processed_direct
    assert message.event_id not in mod1.processed_system
    
    # Verify delivery was attempted
    mock_network.topology.route_message.assert_called_once()


@pytest.mark.asyncio
async def test_system_message_pipeline(message_processor, mock_network):
    """Test system message processing through mod pipeline."""
    # Set up mods
    mod1 = MockTestMod("mod1")
    mod2 = MockTestMod("mod2")
    mock_network.mods = {"mod1": mod1, "mod2": mod2}
    
    # Create system message (inbound)
    message = Event(
        event_name="project.created",
        source_id="agent1",
        payload={"project_id": "test-project"}
    )
    
    # Process message
    result = await message_processor.process_message(message)
    
    # Verify processing
    assert result == True
    assert message.event_id in mod1.processed_system
    assert message.event_id in mod2.processed_system
    assert message.event_id not in mod1.processed_direct
    assert message.event_id not in mod1.processed_broadcast
    
    # System messages are discarded, no delivery should be attempted
    mock_network.topology.route_message.assert_not_called()


@pytest.mark.asyncio
async def test_system_message_outbound(message_processor, mock_network):
    """Test outbound system message (mod to agent) processing."""
    # Set up mods
    mod1 = MockTestMod("mod1")
    mod2 = MockTestMod("mod2")
    mock_network.mods = {"mod1": mod1, "mod2": mod2}
    
    # Create outbound system message
    message = Event(
        event_name="project.status.updated",
        source_id="project_mod",
        destination_id="agent1",
        payload={"status": "completed"}
    )
    
    # Process message
    result = await message_processor.process_message(message)
    
    # Verify processing - outbound system messages skip mod processing
    assert result == True
    assert message.event_id not in mod1.processed_system
    assert message.event_id not in mod2.processed_system
    
    # Direct delivery should be attempted
    mock_network.topology.route_message.assert_called_once()


@pytest.mark.asyncio
async def test_mod_stops_processing(message_processor, mock_network):
    """Test that a mod can stop message processing."""
    # Set up mods - stopping mod first, then regular mod
    stopping_mod = MockStoppingTestMod("stopping_mod")
    regular_mod = MockTestMod("regular_mod")
    mock_network.mods = {"stopping_mod": stopping_mod, "regular_mod": regular_mod}
    
    # Create direct message
    message = Event(
        event_name="agent.message",
        source_id="agent1",
        destination_id="agent2",
        payload={"text": "Hello"}
    )
    
    # Process message
    result = await message_processor.process_message(message)
    
    # Verify processing stopped at first mod
    assert result == True  # Processing was successful
    assert message.event_id not in regular_mod.processed_direct  # Second mod never got the message
    
    # No delivery should happen since message was stopped
    mock_network.topology.route_message.assert_not_called()


@pytest.mark.asyncio
async def test_relevant_mod_filtering(message_processor, mock_network):
    """Test that relevant_mod filtering works."""
    # Set up mods
    mod1 = MockTestMod("mod1")
    mod2 = MockTestMod("mod2")
    mock_network.mods = {"mod1": mod1, "mod2": mod2}
    
    # Create message with relevant_mod set
    message = Event(
        event_name="project.created",
        source_id="agent1",
        relevant_mod="mod2",  # Only mod2 should process this
        payload={"project_id": "test-project"}
    )
    
    # Process message
    result = await message_processor.process_message(message)
    
    # Verify only mod2 processed the message
    assert result == True
    assert message.event_id not in mod1.processed_system
    assert message.event_id in mod2.processed_system


if __name__ == "__main__":
    # Run the tests
    pytest.main([__file__, "-v"])