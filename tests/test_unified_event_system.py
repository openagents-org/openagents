"""
Tests for the unified event system.

This module tests the core functionality of the new unified event system
that replaces the old message types with a single Event type.
"""

import pytest
import asyncio
import time
from unittest.mock import AsyncMock, MagicMock

from openagents.core.events import EventBus
from openagents.models.event import Event, EventSubscription, EventVisibility, EventNames
from openagents.core.events.event_bridge import EventBridge
from openagents.models.messages import DirectMessage, BroadcastMessage, ModMessage


class TestEvent:
    """Test the Event model."""
    
    def test_event_creation(self):
        """Test basic event creation."""
        event = Event(
            event_name="test.event",
            source_id="agent1",
            payload={"key": "value"}
        )
        
        assert event.event_name == "test.event"
        assert event.source_id == "agent1"
        assert event.payload == {"key": "value"}
        assert event.visibility == EventVisibility.NETWORK
    
    def test_event_auto_visibility(self):
        """Test automatic visibility setting based on targeting."""
        # Direct message
        direct_event = Event(
            event_name="agent.direct_message.sent",
            source_id="agent1",
            target_agent_id="agent2"
        )
        assert direct_event.visibility == EventVisibility.DIRECT
        
        # Channel message
        channel_event = Event(
            event_name="channel.message.posted",
            source_id="agent1",
            target_channel="#general"
        )
        assert channel_event.visibility == EventVisibility.CHANNEL
        
        # Mod message
        mod_event = Event(
            event_name="project.creation.requested",
            source_id="agent1",
            relevant_mod="project.default"
        )
        assert mod_event.visibility == EventVisibility.MOD_ONLY
    
    def test_event_pattern_matching(self):
        """Test event pattern matching."""
        event = Event(
            event_name="project.run.completed",
            source_id="agent1"
        )
        
        assert event.matches_pattern("*")
        assert event.matches_pattern("project.*")
        assert event.matches_pattern("project.run.*")
        assert event.matches_pattern("project.run.completed")
        assert not event.matches_pattern("channel.*")
        assert not event.matches_pattern("project.creation.*")
    
    def test_event_visibility_check(self):
        """Test event visibility to agents."""
        # Network event - visible to all
        network_event = Event(
            event_name="network.broadcast.sent",
            source_id="agent1",
            visibility=EventVisibility.NETWORK
        )
        assert network_event.is_visible_to_agent("agent2")
        assert network_event.is_visible_to_agent("agent3")
        
        # Direct event - only visible to target
        direct_event = Event(
            event_name="agent.direct_message.sent",
            source_id="agent1",
            target_agent_id="agent2",
            visibility=EventVisibility.DIRECT
        )
        assert direct_event.is_visible_to_agent("agent1")  # Source always sees
        assert direct_event.is_visible_to_agent("agent2")  # Target sees
        assert not direct_event.is_visible_to_agent("agent3")  # Others don't see
        
        # Channel event - only visible to agents in channel
        channel_event = Event(
            event_name="channel.message.posted",
            source_id="agent1",
            target_channel="#general",
            visibility=EventVisibility.CHANNEL
        )
        assert channel_event.is_visible_to_agent("agent1")  # Source always sees
        assert channel_event.is_visible_to_agent("agent2", {"#general", "#dev"})  # In channel
        assert not channel_event.is_visible_to_agent("agent3", {"#dev"})  # Not in channel
    
    def test_event_serialization(self):
        """Test event to/from dict conversion."""
        original_event = Event(
            event_name="test.event",
            source_id="agent1",
            target_agent_id="agent2",
            payload={"key": "value"},
            allowed_agents={"agent1", "agent2"}
        )
        
        # Convert to dict
        event_dict = original_event.to_dict()
        assert event_dict["event_name"] == "test.event"
        assert event_dict["source_id"] == "agent1"
        assert set(event_dict["allowed_agents"]) == {"agent1", "agent2"}
        
        # Convert back from dict
        restored_event = Event.from_dict(event_dict)
        assert restored_event.event_name == original_event.event_name
        assert restored_event.source_id == original_event.source_id
        assert restored_event.allowed_agents == original_event.allowed_agents


class TestEventSubscription:
    """Test the EventSubscription model."""
    
    def test_subscription_creation(self):
        """Test basic subscription creation."""
        subscription = EventSubscription(
            agent_id="agent1",
            event_patterns=["project.*", "channel.message.*"]
        )
        
        assert subscription.agent_id == "agent1"
        assert subscription.event_patterns == ["project.*", "channel.message.*"]
        assert subscription.is_active
    
    def test_subscription_event_matching(self):
        """Test subscription event matching."""
        subscription = EventSubscription(
            agent_id="agent1",
            event_patterns=["project.*"],
            mod_filter="project.default"
        )
        
        # Matching event (explicitly set visibility to NETWORK to override auto-setting)
        matching_event = Event(
            event_name="project.run.completed",
            source_id="agent2",
            relevant_mod="project.default"
        )
        # Override the auto-set visibility for this test
        matching_event.visibility = EventVisibility.NETWORK
        assert subscription.matches_event(matching_event)
        
        # Non-matching pattern
        non_matching_event = Event(
            event_name="channel.message.posted",
            source_id="agent2",
            visibility=EventVisibility.NETWORK
        )
        assert not subscription.matches_event(non_matching_event)
        
        # Non-matching mod filter
        wrong_mod_event = Event(
            event_name="project.run.completed",
            source_id="agent2",
            relevant_mod="other.mod",
            visibility=EventVisibility.NETWORK
        )
        assert not subscription.matches_event(wrong_mod_event)


class TestEventBus:
    """Test the EventBus functionality."""
    
    @pytest.fixture
    def event_bus(self):
        """Create an EventBus for testing."""
        return EventBus()
    
    @pytest.mark.asyncio
    async def test_basic_event_emission(self, event_bus):
        """Test basic event emission."""
        event = Event(
            event_name="test.event",
            source_id="agent1",
            payload={"message": "hello"}
        )
        
        # Should not raise any exceptions
        await event_bus.emit_event(event)
        
        # Check event was added to history
        assert event_bus.event_count == 1
        assert event_bus.events_by_name["test.event"] == 1
        
        history = event_bus.get_event_history()
        assert len(history) == 1
        assert history[0].event_name == "test.event"
    
    @pytest.mark.asyncio
    async def test_event_subscription_and_delivery(self, event_bus):
        """Test event subscription and delivery."""
        # Create event queue for agent
        agent_queue = event_bus.create_agent_event_queue("agent1")
        
        # Subscribe to events
        subscription = event_bus.subscribe("agent1", ["test.*"])
        
        # Emit event
        event = Event(
            event_name="test.event",
            source_id="agent2",
            payload={"message": "hello"}
        )
        await event_bus.emit_event(event)
        
        # Check event was delivered to queue
        assert not agent_queue.empty()
        delivered_event = agent_queue.get_nowait()
        assert delivered_event.event_name == "test.event"
        assert delivered_event.payload["message"] == "hello"
    
    @pytest.mark.asyncio
    async def test_mod_event_handling(self, event_bus):
        """Test mod-specific event handling."""
        # Create mock mod handler
        mod_handler = AsyncMock()
        event_bus.register_mod_handler("test.mod", mod_handler)
        
        # Emit mod event
        event = Event(
            event_name="test.mod.action",
            source_id="agent1",
            relevant_mod="test.mod",
            visibility=EventVisibility.MOD_ONLY
        )
        await event_bus.emit_event(event)
        
        # Check mod handler was called
        mod_handler.assert_called_once_with(event)
    
    @pytest.mark.asyncio
    async def test_global_event_handler(self, event_bus):
        """Test global event handlers."""
        # Create mock global handler
        global_handler = AsyncMock()
        event_bus.register_global_handler(global_handler)
        
        # Emit event
        event = Event(
            event_name="test.event",
            source_id="agent1"
        )
        await event_bus.emit_event(event)
        
        # Check global handler was called
        global_handler.assert_called_once_with(event)
    
    def test_subscription_management(self, event_bus):
        """Test subscription management."""
        # Create subscription
        subscription = event_bus.subscribe("agent1", ["test.*"])
        assert subscription.agent_id == "agent1"
        
        # Check subscription is tracked
        agent_subscriptions = event_bus.get_agent_subscriptions("agent1")
        assert len(agent_subscriptions) == 1
        assert agent_subscriptions[0].subscription_id == subscription.subscription_id
        
        # Remove subscription
        success = event_bus.unsubscribe(subscription.subscription_id)
        assert success
        
        # Check subscription is removed
        agent_subscriptions = event_bus.get_agent_subscriptions("agent1")
        assert len(agent_subscriptions) == 0
    
    def test_agent_cleanup(self, event_bus):
        """Test agent cleanup functionality."""
        # Create multiple subscriptions for agent
        sub1 = event_bus.subscribe("agent1", ["test.*"])
        sub2 = event_bus.subscribe("agent1", ["project.*"])
        
        # Create event queue
        queue = event_bus.create_agent_event_queue("agent1")
        
        # Check agent has subscriptions and queue
        assert len(event_bus.get_agent_subscriptions("agent1")) == 2
        assert "agent1" in event_bus.agent_event_queues
        
        # Remove all agent subscriptions
        removed_count = event_bus.unsubscribe_agent("agent1")
        assert removed_count == 2
        
        # Remove event queue
        success = event_bus.remove_agent_event_queue("agent1")
        assert success
        
        # Check cleanup
        assert len(event_bus.get_agent_subscriptions("agent1")) == 0
        assert "agent1" not in event_bus.agent_event_queues


class TestEventBridge:
    """Test the EventBridge for backward compatibility."""
    
    def test_direct_message_to_event(self):
        """Test converting DirectMessage to Event."""
        message = DirectMessage(
            event_id="msg1",
            source_id="agent1",
            target_agent_id="agent2",
            payload={"text": "Hello!"},
            timestamp=int(time.time())
        )
        
        event = EventBridge.message_to_event(message)
        
        assert event.event_name == EventNames.AGENT_DIRECT_MESSAGE_SENT
        assert event.source_id == "agent1"
        assert event.target_agent_id == "agent2"
        assert event.payload == {"text": "Hello!"}
        assert event.visibility == EventVisibility.DIRECT
    
    def test_broadcast_message_to_event(self):
        """Test converting BroadcastMessage to Event."""
        message = BroadcastMessage(
            event_id="msg1",
            source_id="agent1",
            payload={"announcement": "Server maintenance"},
            timestamp=int(time.time())
        )
        
        event = EventBridge.message_to_event(message)
        
        assert event.event_name == EventNames.NETWORK_BROADCAST_SENT
        assert event.source_id == "agent1"
        assert event.target_agent_id is None
        assert event.payload == {"announcement": "Server maintenance"}
        assert event.visibility == EventVisibility.NETWORK
    
    def test_mod_message_to_event(self):
        """Test converting ModMessage to Event."""
        message = ModMessage(
            event_id="msg1",
            source_id="agent1",
            mod="openagents.mods.project.default",
            relevant_agent_id="agent1",
            payload={
                "action": "project_creation",
                "project_name": "Test Project"
            },
            timestamp=int(time.time())
        )
        
        event = EventBridge.message_to_event(message)
        
        assert event.event_name == "project.project_creation"  # Generated from mod name and message_type
        assert event.source_id == "agent1"
        assert event.relevant_mod == "openagents.mods.project.default"
        assert event.payload["project_name"] == "Test Project"
        assert event.visibility == EventVisibility.MOD_ONLY
    
    def test_event_to_direct_message(self):
        """Test converting Event back to DirectMessage."""
        event = Event(
            event_id="evt1",
            event_name=EventNames.AGENT_DIRECT_MESSAGE_SENT,
            source_id="agent1",
            target_agent_id="agent2",
            payload={"text": "Hello!"},
            timestamp=int(time.time())
        )
        
        message = EventBridge.event_to_message(event)
        
        assert isinstance(message, DirectMessage)
        assert message.message_id == "evt1"
        assert message.sender_id == "agent1"
        assert message.target_agent_id == "agent2"
        assert message.content == {"text": "Hello!"}
    
    def test_event_to_mod_message(self):
        """Test converting Event back to ModMessage."""
        event = Event(
            event_id="evt1",
            event_name=EventNames.PROJECT_CREATION_REQUESTED,
            source_id="agent1",
            relevant_mod="project.default",
            payload={
                "message_type": "project_creation",
                "project_name": "Test Project"
            },
            timestamp=int(time.time())
        )
        
        message = EventBridge.event_to_message(event)
        
        assert isinstance(message, ModMessage)
        assert message.message_id == "evt1"
        assert message.sender_id == "agent1"
        assert message.mod == "project.default"
        assert message.content["project_name"] == "Test Project"


if __name__ == "__main__":
    pytest.main([__file__])
