"""
Test cases for the forum topic creation example.

This test validates that the example code works correctly by:
1. Testing event structure creation
2. Testing the agent methods with mocked workspace
3. Integration test with real network
"""

import pytest
import asyncio
import logging
from unittest.mock import AsyncMock, MagicMock, patch

from openagents.models.event import Event, EventVisibility
from openagents.models.event_response import EventResponse
from openagents.core.network import AgentNetwork
from openagents.core.client import AgentClient
from openagents.models.network_config import NetworkConfig, NetworkMode
from openagents.mods.workspace.forum import ForumNetworkMod, ForumAgentAdapter

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class TestForumTopicEventStructure:
    """Test that event structures are correctly formed."""

    def test_create_topic_event_structure(self):
        """Test that a forum topic create event has correct structure."""
        agent_id = "test-agent"

        payload = {
            "action": "create",
            "title": "Test Topic",
            "content": "Test content for the topic",
            "allowed_groups": None,
            "relevant_agent_id": agent_id,
        }

        event = Event(
            event_name="forum.topic.create",
            source_id=agent_id,
            payload=payload,
            relevant_mod="openagents.mods.workspace.forum",
            visibility=EventVisibility.MOD_ONLY,
        )

        # Verify event structure
        assert event.event_name == "forum.topic.create"
        assert event.source_id == agent_id
        assert event.payload["action"] == "create"
        assert event.payload["title"] == "Test Topic"
        assert event.payload["content"] == "Test content for the topic"
        assert event.relevant_mod == "openagents.mods.workspace.forum"
        assert event.visibility == EventVisibility.MOD_ONLY

    def test_post_comment_event_structure(self):
        """Test that a forum comment post event has correct structure."""
        agent_id = "test-agent"
        topic_id = "topic-123"

        event = Event(
            event_name="forum.comment.post",
            source_id=agent_id,
            destination_id="mod:openagents.mods.workspace.forum",
            payload={
                "action": "post",
                "topic_id": topic_id,
                "content": "This is a test comment",
            },
        )

        assert event.event_name == "forum.comment.post"
        assert event.source_id == agent_id
        assert event.payload["topic_id"] == topic_id
        assert event.payload["content"] == "This is a test comment"

    def test_list_topics_event_structure(self):
        """Test that a forum topics list event has correct structure."""
        agent_id = "test-agent"

        event = Event(
            event_name="forum.topics.list",
            source_id=agent_id,
            payload={
                "action": "list",
                "limit": 10,
            },
            relevant_mod="openagents.mods.workspace.forum",
            visibility=EventVisibility.MOD_ONLY,
        )

        assert event.event_name == "forum.topics.list"
        assert event.payload["action"] == "list"
        assert event.payload["limit"] == 10

    def test_vote_event_structure(self):
        """Test that a forum vote event has correct structure."""
        agent_id = "test-agent"
        topic_id = "topic-123"

        event = Event(
            event_name="forum.vote.cast",
            source_id=agent_id,
            payload={
                "action": "cast",
                "target_type": "topic",
                "target_id": topic_id,
                "vote_type": "upvote",
                "relevant_agent_id": agent_id,
            },
            relevant_mod="openagents.mods.workspace.forum",
            visibility=EventVisibility.MOD_ONLY,
        )

        assert event.event_name == "forum.vote.cast"
        assert event.payload["vote_type"] == "upvote"
        assert event.payload["target_type"] == "topic"
        assert event.payload["target_id"] == topic_id


class TestForumTopicExampleIntegration:
    """Integration tests for forum topic creation with real network."""

    @pytest.fixture
    async def network_with_forum(self):
        """Create a network with the forum mod."""
        from openagents.models.transport import TransportType
        from openagents.models.network_config import TransportConfigItem
        import random

        # Use random ports to avoid conflicts
        http_port = random.randint(22000, 23999)
        grpc_port = http_port + 2000

        config = NetworkConfig(
            name="TestForumExampleNetwork",
            mode=NetworkMode.CENTRALIZED,
            transports=[
                TransportConfigItem(
                    type=TransportType.HTTP, config={"port": http_port}
                ),
                TransportConfigItem(
                    type=TransportType.GRPC, config={"port": grpc_port}
                ),
            ],
        )
        network = AgentNetwork(config, workspace_path=None)

        # Add forum mod
        forum_mod = ForumNetworkMod()
        forum_mod.bind_network(network)
        network.mods["forum"] = forum_mod

        await network.initialize()

        yield {"network": network, "http_port": http_port, "grpc_port": grpc_port}

        await network.shutdown()

    @pytest.fixture
    async def connected_agent(self, network_with_forum):
        """Create a connected test agent with forum adapter."""
        network_info = network_with_forum
        http_port = network_info["http_port"]

        agent = AgentClient("forum-example-test-agent")
        forum_adapter = ForumAgentAdapter()
        agent.register_mod_adapter(forum_adapter)

        await agent.connect_to_server("localhost", http_port)

        yield {"agent": agent, "forum": forum_adapter}

        await agent.disconnect()

    @pytest.mark.asyncio
    async def test_create_topic_via_adapter(self, connected_agent):
        """Test creating a topic using the ForumAdapter."""
        forum = connected_agent["forum"]

        topic_id = await forum.create_forum_topic(
            title="Integration Test Topic",
            content="This topic was created by the integration test.",
        )

        assert topic_id is not None
        assert isinstance(topic_id, str)
        logger.info(f"Created topic via adapter: {topic_id}")

        # Verify topic exists
        topic_data = await forum.get_forum_topic(topic_id)
        assert topic_data is not None
        assert topic_data["title"] == "Integration Test Topic"

    @pytest.mark.asyncio
    async def test_create_topic_via_send_event(self, connected_agent, network_with_forum):
        """Test creating a topic using send_event directly."""
        agent = connected_agent["agent"]
        forum = connected_agent["forum"]

        # Build event manually (as shown in the example)
        payload = {
            "action": "create",
            "title": "Direct Send Event Topic",
            "content": "Created via send_event for testing.",
            "allowed_groups": None,
            "relevant_agent_id": agent.agent_id,
        }

        event = Event(
            event_name="forum.topic.create",
            source_id=agent.agent_id,
            payload=payload,
            relevant_mod="openagents.mods.workspace.forum",
            visibility=EventVisibility.MOD_ONLY,
        )

        # Send via agent's connector
        response = await agent.send_event(event)

        assert response is not None
        assert response.success is True
        assert response.data is not None

        topic_id = response.data.get("topic_id")
        assert topic_id is not None
        logger.info(f"Created topic via send_event: {topic_id}")

        # Verify topic exists using adapter
        topic_data = await forum.get_forum_topic(topic_id)
        assert topic_data is not None
        assert topic_data["title"] == "Direct Send Event Topic"

    @pytest.mark.asyncio
    async def test_post_comment_via_send_event(self, connected_agent):
        """Test posting a comment using send_event."""
        agent = connected_agent["agent"]
        forum = connected_agent["forum"]

        # First create a topic
        topic_id = await forum.create_forum_topic(
            title="Topic for Comments",
            content="This topic will receive comments.",
        )
        assert topic_id is not None

        # Post comment via send_event
        event = Event(
            event_name="forum.comment.post",
            source_id=agent.agent_id,
            payload={
                "action": "post",
                "topic_id": topic_id,
                "content": "Test comment via send_event!",
            },
            relevant_mod="openagents.mods.workspace.forum",
            visibility=EventVisibility.MOD_ONLY,
        )

        response = await agent.send_event(event)

        assert response is not None
        assert response.success is True
        logger.info(f"Posted comment via send_event")

        # Verify comment count increased
        topic_data = await forum.get_forum_topic(topic_id)
        assert topic_data["comment_count"] == 1

    @pytest.mark.asyncio
    async def test_vote_via_send_event(self, connected_agent):
        """Test voting on a topic using send_event."""
        agent = connected_agent["agent"]
        forum = connected_agent["forum"]

        # First create a topic
        topic_id = await forum.create_forum_topic(
            title="Topic for Voting",
            content="This topic will receive votes.",
        )
        assert topic_id is not None

        # Vote via send_event
        event = Event(
            event_name="forum.vote.cast",
            source_id=agent.agent_id,
            payload={
                "action": "cast",
                "target_type": "topic",
                "target_id": topic_id,
                "vote_type": "upvote",
                "relevant_agent_id": agent.agent_id,
            },
            relevant_mod="openagents.mods.workspace.forum",
            visibility=EventVisibility.MOD_ONLY,
        )

        response = await agent.send_event(event)

        assert response is not None
        assert response.success is True
        logger.info(f"Voted on topic via send_event")

        # Verify vote score increased
        topic_data = await forum.get_forum_topic(topic_id)
        assert topic_data["vote_score"] == 1
