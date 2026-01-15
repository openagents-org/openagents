"""Tests for trigger filter functionality in CollaboratorAgent."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from openagents.agents.collaborator_agent import CollaboratorAgent
from openagents.models.agent_config import AgentConfig, AgentTriggerConfigItem, TriggerFilter
from openagents.models.event import Event
from openagents.models.event_context import EventContext


class TestTriggerFilter:
    """Tests for the TriggerFilter model."""

    def test_trigger_filter_creation(self):
        """Test creating a TriggerFilter with various options."""
        # Test with sender_type only
        filter1 = TriggerFilter(sender_type="human")
        assert filter1.sender_type == "human"
        assert filter1.source_id is None
        assert filter1.extra_filters is None

        # Test with source_id only
        filter2 = TriggerFilter(source_id="user_123")
        assert filter2.sender_type is None
        assert filter2.source_id == "user_123"

        # Test with extra_filters
        filter3 = TriggerFilter(extra_filters={"channel": "general"})
        assert filter3.extra_filters == {"channel": "general"}

        # Test with all options
        filter4 = TriggerFilter(
            sender_type="human",
            source_id="user_123",
            extra_filters={"channel": "general"}
        )
        assert filter4.sender_type == "human"
        assert filter4.source_id == "user_123"
        assert filter4.extra_filters == {"channel": "general"}

    def test_trigger_config_item_with_filter(self):
        """Test creating AgentTriggerConfigItem with filter."""
        trigger = AgentTriggerConfigItem(
            event="thread.channel_message.notification",
            instruction="Respond to human messages only",
            filter=TriggerFilter(sender_type="human")
        )
        assert trigger.event == "thread.channel_message.notification"
        assert trigger.filter is not None
        assert trigger.filter.sender_type == "human"

    def test_trigger_config_item_without_filter(self):
        """Test creating AgentTriggerConfigItem without filter (backward compatible)."""
        trigger = AgentTriggerConfigItem(
            event="thread.channel_message.notification",
            instruction="Respond to all messages"
        )
        assert trigger.event == "thread.channel_message.notification"
        assert trigger.filter is None


class TestCollaboratorAgentFilter:
    """Tests for CollaboratorAgent._matches_filter method."""

    @pytest.fixture
    def mock_agent(self):
        """Create a mock CollaboratorAgent for testing."""
        agent_config = AgentConfig(
            instruction="Test agent",
            model_name="gpt-4o-mini",
            triggers=[
                AgentTriggerConfigItem(
                    event="thread.channel_message.notification",
                    instruction="Human only",
                    filter=TriggerFilter(sender_type="human")
                ),
                AgentTriggerConfigItem(
                    event="thread.direct_message.notification",
                    instruction="Agent only",
                    filter=TriggerFilter(sender_type="agent")
                ),
                AgentTriggerConfigItem(
                    event="test.no_filter",
                    instruction="No filter"
                ),
            ],
            react_to_all_messages=False
        )

        # Create a mock agent with the required methods
        agent = MagicMock(spec=CollaboratorAgent)
        agent._agent_config = agent_config
        agent._triggers_map = {
            trigger.event: trigger for trigger in agent_config.triggers
        }
        # Use the real _matches_filter method
        agent._matches_filter = CollaboratorAgent._matches_filter.__get__(agent, CollaboratorAgent)
        return agent

    def test_matches_filter_no_filter(self, mock_agent):
        """Test that events match when no filter is specified."""
        event = Event(
            event_name="test.no_filter",
            source_id="any_source",
            payload={"text": "Hello"}
        )

        # No filter means it should match
        assert mock_agent._matches_filter(event, None) is True

    def test_matches_filter_sender_type_human_from_payload(self, mock_agent):
        """Test matching sender_type='human' when set in payload."""
        filter_config = TriggerFilter(sender_type="human")

        # Event with explicit sender_type="human" in payload
        event = Event(
            event_name="thread.channel_message.notification",
            source_id="user_123",
            payload={"text": "Hello", "sender_type": "human"}
        )

        assert mock_agent._matches_filter(event, filter_config) is True

    def test_matches_filter_sender_type_agent_from_payload(self, mock_agent):
        """Test matching sender_type='agent' when set in payload."""
        filter_config = TriggerFilter(sender_type="agent")

        # Event with explicit sender_type="agent" in payload
        event = Event(
            event_name="thread.channel_message.notification",
            source_id="charlie",
            payload={"text": "Hello from agent", "sender_type": "agent"}
        )

        assert mock_agent._matches_filter(event, filter_config) is True

    def test_matches_filter_sender_type_mismatch(self, mock_agent):
        """Test that filter doesn't match when sender_type doesn't match."""
        filter_config = TriggerFilter(sender_type="human")

        # Event from agent (has sender_type="agent")
        event = Event(
            event_name="thread.channel_message.notification",
            source_id="charlie",
            payload={"text": "Hello from agent", "sender_type": "agent"}
        )

        assert mock_agent._matches_filter(event, filter_config) is False

    def test_matches_filter_sender_type_default_human(self, mock_agent):
        """Test that missing sender_type defaults to 'human'."""
        filter_config = TriggerFilter(sender_type="human")

        # Event without sender_type (from human via UI)
        event = Event(
            event_name="thread.channel_message.notification",
            source_id="user_123",
            payload={"text": "Hello from user"}  # No sender_type
        )

        # Should match because missing sender_type defaults to "human"
        assert mock_agent._matches_filter(event, filter_config) is True

    def test_matches_filter_agent_filter_no_sender_type(self, mock_agent):
        """Test that agent filter doesn't match when sender_type is missing."""
        filter_config = TriggerFilter(sender_type="agent")

        # Event without sender_type (from human via UI)
        event = Event(
            event_name="thread.channel_message.notification",
            source_id="user_123",
            payload={"text": "Hello from user"}  # No sender_type
        )

        # Should NOT match because missing sender_type defaults to "human"
        assert mock_agent._matches_filter(event, filter_config) is False

    def test_matches_filter_source_id(self, mock_agent):
        """Test matching by source_id."""
        filter_config = TriggerFilter(source_id="specific_user")

        # Matching source_id
        event1 = Event(
            event_name="test.event",
            source_id="specific_user",
            payload={"text": "Hello"}
        )
        assert mock_agent._matches_filter(event1, filter_config) is True

        # Non-matching source_id
        event2 = Event(
            event_name="test.event",
            source_id="other_user",
            payload={"text": "Hello"}
        )
        assert mock_agent._matches_filter(event2, filter_config) is False

    def test_matches_filter_extra_filters(self, mock_agent):
        """Test matching by extra_filters against payload."""
        filter_config = TriggerFilter(extra_filters={"channel": "general"})

        # Matching extra filter
        event1 = Event(
            event_name="test.event",
            source_id="user",
            payload={"text": "Hello", "channel": "general"}
        )
        assert mock_agent._matches_filter(event1, filter_config) is True

        # Non-matching extra filter
        event2 = Event(
            event_name="test.event",
            source_id="user",
            payload={"text": "Hello", "channel": "random"}
        )
        assert mock_agent._matches_filter(event2, filter_config) is False

    def test_matches_filter_combined(self, mock_agent):
        """Test matching with multiple filter criteria."""
        filter_config = TriggerFilter(
            sender_type="human",
            source_id="user_123",
            extra_filters={"channel": "general"}
        )

        # All criteria match
        event1 = Event(
            event_name="test.event",
            source_id="user_123",
            payload={"text": "Hello", "channel": "general", "sender_type": "human"}
        )
        assert mock_agent._matches_filter(event1, filter_config) is True

        # sender_type mismatch
        event2 = Event(
            event_name="test.event",
            source_id="user_123",
            payload={"text": "Hello", "channel": "general", "sender_type": "agent"}
        )
        assert mock_agent._matches_filter(event2, filter_config) is False

        # source_id mismatch
        event3 = Event(
            event_name="test.event",
            source_id="other_user",
            payload={"text": "Hello", "channel": "general", "sender_type": "human"}
        )
        assert mock_agent._matches_filter(event3, filter_config) is False


class TestAgentConfigWithFilter:
    """Tests for loading AgentConfig with filter from YAML-like dict."""

    def test_agent_config_with_trigger_filter(self):
        """Test creating AgentConfig with triggers that have filters."""
        config_data = {
            "instruction": "Test agent with filters",
            "model_name": "gpt-4o-mini",
            "triggers": [
                {
                    "event": "thread.channel_message.notification",
                    "instruction": "Respond to human messages",
                    "filter": {
                        "sender_type": "human"
                    }
                },
                {
                    "event": "thread.direct_message.notification",
                    "instruction": "Handle all direct messages"
                }
            ],
            "react_to_all_messages": False
        }

        agent_config = AgentConfig(**config_data)

        assert len(agent_config.triggers) == 2

        # First trigger has filter
        assert agent_config.triggers[0].event == "thread.channel_message.notification"
        assert agent_config.triggers[0].filter is not None
        assert agent_config.triggers[0].filter.sender_type == "human"

        # Second trigger has no filter
        assert agent_config.triggers[1].event == "thread.direct_message.notification"
        assert agent_config.triggers[1].filter is None

    def test_agent_config_trigger_filter_with_extra_filters(self):
        """Test AgentConfig with trigger filter containing extra_filters."""
        config_data = {
            "instruction": "Test agent",
            "model_name": "gpt-4o-mini",
            "triggers": [
                {
                    "event": "thread.channel_message.notification",
                    "instruction": "Only respond in general channel from humans",
                    "filter": {
                        "sender_type": "human",
                        "extra_filters": {
                            "channel": "general"
                        }
                    }
                }
            ]
        }

        agent_config = AgentConfig(**config_data)

        assert len(agent_config.triggers) == 1
        trigger = agent_config.triggers[0]
        assert trigger.filter is not None
        assert trigger.filter.sender_type == "human"
        assert trigger.filter.extra_filters == {"channel": "general"}
