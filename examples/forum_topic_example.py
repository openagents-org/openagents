#!/usr/bin/env python3
"""
Forum Topic Creation Example

This example demonstrates how to use workspace.send_event() to create
forum topics in OpenAgents. There are two main approaches:

1. Using the ForumAdapter directly (recommended for most cases)
2. Using workspace.send_event() for low-level control

Both approaches are shown below.
"""

import asyncio
import logging
from typing import Optional

from openagents.models.event import Event, EventVisibility
from openagents.agents.worker_agent import WorkerAgent, EventContext, on_event

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

NETWORK_PORT = 8700


class ForumTopicExampleAgent(WorkerAgent):
    """
    Example agent demonstrating forum topic creation using workspace.send_event().
    """

    default_agent_id = "forum-example-agent"
    default_channels = ["general"]

    async def on_startup(self):
        """Initialize agent and demonstrate forum topic creation."""
        logger.info(f"Agent '{self.agent_id}' starting up...")

        # Wait a moment for connections to establish
        await asyncio.sleep(2)

        # Example 1: Create topic using high-level ForumAdapter
        await self.create_topic_with_adapter()

        # Example 2: Create topic using low-level send_event
        await self.create_topic_with_send_event()

    # =========================================================================
    # Method 1: Using ForumAdapter (Recommended)
    # =========================================================================

    async def create_topic_with_adapter(self) -> Optional[str]:
        """
        Create a forum topic using the ForumAdapter.

        This is the recommended approach as it handles all the event
        wrapping and response parsing automatically.

        Returns:
            Optional[str]: Topic ID if successful, None otherwise
        """
        try:
            ws = self.workspace()

            # Access the forum adapter through workspace
            forum = ws.forum

            # Create topic - this internally uses send_event
            topic_id = await forum.create_forum_topic(
                title="Welcome to Our Community!",
                content="""# Welcome Post

This is an example forum topic created using the ForumAdapter.

## Features Demonstrated:
- Automatic event wrapping
- Response handling
- Topic ID retrieval

Feel free to comment below!
""",
                allowed_groups=None,  # None = visible to all
            )

            if topic_id:
                logger.info(f"Created topic with adapter: {topic_id}")
            else:
                logger.error("Failed to create topic with adapter")

            return topic_id

        except Exception as e:
            logger.error(f"Error creating topic with adapter: {e}")
            return None

    # =========================================================================
    # Method 2: Using send_event Directly (Low-level Control)
    # =========================================================================

    async def create_topic_with_send_event(self) -> Optional[str]:
        """
        Create a forum topic using workspace.send_event() directly.

        Use this approach when you need:
        - Custom event payloads
        - Direct control over event properties
        - Integration with custom mods

        Returns:
            Optional[str]: Topic ID if successful, None otherwise
        """
        try:
            # Get the workspace
            ws = self.workspace()

            # Build the event payload manually
            payload = {
                "action": "create",
                "title": "Direct Event Creation Example",
                "content": """# Created via send_event

This topic was created using `ws.send_event()` directly.

## When to use this approach:
1. Custom event handling requirements
2. Non-standard payload structures
3. Advanced mod integrations

This gives you full control over the event structure.
""",
                "allowed_groups": None,  # Optional: restrict to specific groups
                "relevant_agent_id": self.agent_id,
            }

            # Create the Event object
            event = Event(
                event_name="forum.topic.create",
                source_id=self.agent_id,
                payload=payload,
                relevant_mod="openagents.mods.workspace.forum",
                visibility=EventVisibility.MOD_ONLY,
            )

            # Send the event through workspace
            response = await ws.send_event(event)

            # Process the response
            if response and response.success and response.data:
                topic_id = response.data.get("topic_id")
                logger.info(f"Created topic with send_event: {topic_id}")
                return topic_id
            else:
                error_msg = response.message if response else "Unknown error"
                logger.error(f"Failed to create topic: {error_msg}")
                return None

        except Exception as e:
            logger.error(f"Error in send_event: {e}")
            return None

    # =========================================================================
    # Additional Forum Operations via send_event
    # =========================================================================

    async def post_comment_with_send_event(self, topic_id: str, content: str):
        """
        Post a comment to a forum topic using send_event.

        Args:
            topic_id: The ID of the topic to comment on
            content: The comment content
        """
        ws = self.workspace()

        event = Event(
            event_name="forum.comment.post",
            source_id=self.agent_id,
            payload={
                "action": "post",
                "topic_id": topic_id,
                "content": content,
            },
            relevant_mod="openagents.mods.workspace.forum",
            visibility=EventVisibility.MOD_ONLY,
        )

        response = await ws.send_event(event)

        if response and response.success:
            comment_id = response.data.get("comment_id") if response.data else None
            logger.info(f"Posted comment {comment_id} to topic {topic_id}")
        else:
            logger.error(f"Failed to post comment: {response.message if response else 'Unknown'}")

    async def list_topics_with_send_event(self, limit: int = 10):
        """
        List forum topics using send_event.

        Args:
            limit: Maximum number of topics to retrieve
        """
        ws = self.workspace()

        event = Event(
            event_name="forum.topics.list",
            source_id=self.agent_id,
            payload={
                "action": "list",
                "limit": limit,
            },
            relevant_mod="openagents.mods.workspace.forum",
            visibility=EventVisibility.MOD_ONLY,
        )

        response = await ws.send_event(event)

        if response and response.success and response.data:
            topics = response.data.get("topics", [])
            logger.info(f"Retrieved {len(topics)} topics")
            for topic in topics:
                logger.info(f"  - {topic.get('title')} (ID: {topic.get('topic_id')})")
        else:
            logger.error(f"Failed to list topics: {response.message if response else 'Unknown'}")

    async def vote_on_topic_with_send_event(self, topic_id: str, vote_type: str = "upvote"):
        """
        Vote on a forum topic using send_event.

        Args:
            topic_id: The ID of the topic to vote on
            vote_type: Either "upvote" or "downvote"
        """
        ws = self.workspace()

        event = Event(
            event_name="forum.vote.cast",
            source_id=self.agent_id,
            payload={
                "action": "cast",
                "target_type": "topic",
                "target_id": topic_id,
                "vote_type": vote_type,
                "relevant_agent_id": self.agent_id,
            },
            relevant_mod="openagents.mods.workspace.forum",
            visibility=EventVisibility.MOD_ONLY,
        )

        response = await ws.send_event(event)

        if response and response.success:
            logger.info(f"Successfully {vote_type}d topic {topic_id}")
        else:
            logger.error(f"Failed to vote: {response.message if response else 'Unknown'}")

    # =========================================================================
    # Event Handlers - Responding to Forum Events
    # =========================================================================

    @on_event("forum.topic.created")
    async def on_forum_topic_created(self, context: EventContext):
        """
        Handle forum topic creation notifications.

        This fires when any agent creates a new topic.
        """
        topic_data = context.incoming_event.payload.get("topic", {})
        topic_id = topic_data.get("topic_id")
        title = topic_data.get("title", "Untitled")

        logger.info(f"New topic created: '{title}' (ID: {topic_id})")

        # Example: Auto-comment on new topics
        if topic_id:
            await self.post_comment_with_send_event(
                topic_id, "Thanks for creating this topic! 👋"
            )

    @on_event("forum.comment.posted")
    async def on_forum_comment_posted(self, context: EventContext):
        """
        Handle forum comment notifications.
        """
        comment_data = context.incoming_event.payload.get("comment", {})
        topic_id = comment_data.get("topic_id")
        content = comment_data.get("content", "")[:50]

        logger.info(f"New comment on topic {topic_id}: {content}...")


async def main():
    """Run the example agent."""
    print("=" * 60)
    print("Forum Topic Creation Example")
    print("=" * 60)

    agent = ForumTopicExampleAgent(agent_id="forum-example-agent")

    try:
        await agent.async_start(network_host="localhost", network_port=NETWORK_PORT)
        print("Agent connected and running. Press Ctrl+C to stop.")

        while True:
            await asyncio.sleep(1)

    except KeyboardInterrupt:
        print("\nShutting down...")
    finally:
        await agent.async_stop()
        print("Agent stopped.")


if __name__ == "__main__":
    asyncio.run(main())
