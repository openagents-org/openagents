"""
Agent-level forum mod for OpenAgents.

This standalone mod provides Reddit-like forum functionality with:
- Topic creation and management
- Comment posting with nested threading
- Voting system for topics and comments
- Search and browsing capabilities
"""

import logging
from typing import Dict, Any, List, Optional, Callable, Union

from openagents.core.base_mod_adapter import BaseModAdapter
from openagents.models.event import Event, EventVisibility
from openagents.models.tool import AgentTool
from .forum_messages import (
    ForumTopicMessage,
    ForumCommentMessage,
    ForumVoteMessage,
    ForumQueryMessage,
)

logger = logging.getLogger(__name__)

# Type definitions for handlers
ForumHandler = Callable[[Dict[str, Any], str], None]


class ForumAgentAdapter(BaseModAdapter):
    """Agent-level forum mod implementation.

    This standalone mod provides:
    - Topic creation and management
    - Comment posting with nested threading (up to 5 levels)
    - Voting system for topics and comments
    - Search and browsing capabilities
    """

    def __init__(self):
        """Initialize the forum adapter for an agent."""
        super().__init__(mod_name="forum")

        # Initialize adapter state
        self.forum_handlers: Dict[str, ForumHandler] = {}
        self.pending_requests: Dict[str, Dict[str, Any]] = (
            {}
        )  # request_id -> request metadata
        self.completed_requests: Dict[str, Dict[str, Any]] = {}  # request_id -> results

    def initialize(self) -> bool:
        """Initialize the adapter.

        Returns:
            bool: True if initialization was successful, False otherwise
        """
        logger.info(f"Initializing Forum adapter for agent {self.agent_id}")
        return True

    def shutdown(self) -> bool:
        """Shutdown the adapter.

        Returns:
            bool: True if shutdown was successful, False otherwise
        """
        logger.info(f"Shutting down Forum adapter for agent {self.agent_id}")
        return True

    async def process_incoming_mod_message(self, message: Event) -> None:
        """Process an incoming mod message.

        Args:
            message: The mod message to process
        """
        logger.debug(f"Received forum message from {message.source_id}")

        # Handle different event types based on event name
        event_name = message.event_name

        if event_name.endswith("_response"):
            await self._handle_response(message)
        elif event_name.endswith("_notification"):
            await self._handle_notification(message)
        else:
            logger.debug(f"Unhandled forum event: {event_name}")

    async def create_forum_topic(
        self, title: str, content: str, allowed_groups: Optional[List[str]] = None
    ) -> Optional[str]:
        """Create a new forum topic.

        Args:
            title: Title of the topic
            content: Content/body of the topic
            allowed_groups: List of group IDs that can view this topic. If None or empty, topic is visible to all

        Returns:
            Optional[str]: Topic ID if successful, None if failed
        """
        if self.connector is None:
            logger.error(
                f"Cannot create topic: connector is None for agent {self.agent_id}"
            )
            return None

        if not title.strip():
            logger.error("Topic title cannot be empty")
            return None

        if not content.strip():
            logger.error("Topic content cannot be empty")
            return None

        # Create topic message
        topic_msg = ForumTopicMessage(
            source_id=self.agent_id,
            title=title,
            content=content,
            action="create",
            allowed_groups=allowed_groups,
        )

        # Wrap in Event for proper transport
        wrapper_payload = topic_msg.payload
        wrapper_payload["relevant_agent_id"] = self.agent_id
        message = Event(
            event_name="forum.topic.create",
            source_id=self.agent_id,
            payload=wrapper_payload,
            relevant_mod="openagents.mods.workspace.forum",
            visibility=EventVisibility.MOD_ONLY,
        )

        # Store pending request
        self.pending_requests[message.event_id] = {
            "action": "create_topic",
            "title": title,
            "timestamp": message.timestamp,
        }

        response = await self.connector.send_event(message)
        logger.debug(f"Sent create topic request: '{title}'")

        # Return topic ID from response if successful
        if response and response.success and response.data:
            topic_id = response.data.get("topic_id")
            logger.info(f"Created topic {topic_id}: '{title}'")

            # Add topic creation to message thread
            thread_id = f"forum_topic_{topic_id}"
            message.thread_name = thread_id

            return topic_id
        else:
            error_msg = response.message if response else "Unknown error"
            logger.error(f"Failed to create topic: {error_msg}")
            return None

    async def edit_forum_topic(
        self, topic_id: str, title: Optional[str] = None, content: Optional[str] = None
    ) -> bool:
        """Edit an existing forum topic.

        Args:
            topic_id: ID of the topic to edit
            title: New title (optional)
            content: New content (optional)

        Returns:
            bool: True if successful, False otherwise
        """
        if self.connector is None:
            logger.error(
                f"Cannot edit topic: connector is None for agent {self.agent_id}"
            )
            return False

        if not topic_id:
            logger.error("Topic ID cannot be empty")
            return False

        if not title and not content:
            logger.error("At least one of title or content must be provided")
            return False

        # Create topic message
        topic_msg = ForumTopicMessage(
            source_id=self.agent_id,
            topic_id=topic_id,
            title=title or "",
            content=content or "",
            action="edit",
        )

        # Wrap in Event for proper transport
        wrapper_payload = topic_msg.payload
        wrapper_payload["relevant_agent_id"] = self.agent_id
        message = Event(
            event_name="forum.topic.edit",
            source_id=self.agent_id,
            payload=wrapper_payload,
            relevant_mod="openagents.mods.workspace.forum",
            visibility=EventVisibility.MOD_ONLY,
        )

        response = await self.connector.send_event(message)
        logger.debug(f"Sent edit topic request for {topic_id}")

        if response and response.success:
            logger.info(f"Edited topic {topic_id}")
            return True
        else:
            error_msg = response.message if response else "Unknown error"
            logger.error(f"Failed to edit topic: {error_msg}")
            return False

    async def delete_forum_topic(self, topic_id: str) -> bool:
        """Delete a forum topic.

        Args:
            topic_id: ID of the topic to delete

        Returns:
            bool: True if successful, False otherwise
        """
        if self.connector is None:
            logger.error(
                f"Cannot delete topic: connector is None for agent {self.agent_id}"
            )
            return False

        if not topic_id:
            logger.error("Topic ID cannot be empty")
            return False

        # Create topic message
        topic_msg = ForumTopicMessage(
            source_id=self.agent_id, topic_id=topic_id, action="delete"
        )

        # Wrap in Event for proper transport
        wrapper_payload = topic_msg.payload
        wrapper_payload["relevant_agent_id"] = self.agent_id
        message = Event(
            event_name="forum.topic.delete",
            source_id=self.agent_id,
            payload=wrapper_payload,
            relevant_mod="openagents.mods.workspace.forum",
            visibility=EventVisibility.MOD_ONLY,
        )

        response = await self.connector.send_event(message)
        logger.debug(f"Sent delete topic request for {topic_id}")

        if response and response.success:
            logger.info(f"Deleted topic {topic_id}")
            return True
        else:
            error_msg = response.message if response else "Unknown error"
            logger.error(f"Failed to delete topic: {error_msg}")
            return False

    async def post_forum_topic_comment(
        self, topic_id: str, content: str, parent_comment_id: Optional[str] = None
    ) -> Optional[str]:
        """Post a comment on a topic or reply to a comment.

        Args:
            topic_id: ID of the topic to comment on
            content: Content of the comment
            parent_comment_id: ID of parent comment (for replies)

        Returns:
            Optional[str]: Comment ID if successful, None if failed
        """
        if self.connector is None:
            logger.error(
                f"Cannot post comment: connector is None for agent {self.agent_id}"
            )
            return None

        if not topic_id:
            logger.error("Topic ID cannot be empty")
            return None

        if not content.strip():
            logger.error("Comment content cannot be empty")
            return None

        # Determine action and thread level
        action = "reply" if parent_comment_id else "post"
        thread_level = 1  # Will be calculated by the mod based on parent

        # Create comment message
        comment_msg = ForumCommentMessage(
            source_id=self.agent_id,
            topic_id=topic_id,
            content=content,
            parent_comment_id=parent_comment_id,
            action=action,
            thread_level=thread_level,
        )

        # Wrap in Event for proper transport
        wrapper_payload = comment_msg.payload
        wrapper_payload["relevant_agent_id"] = self.agent_id
        message = Event(
            event_name=f"forum.comment.{action}",
            source_id=self.agent_id,
            payload=wrapper_payload,
            relevant_mod="openagents.mods.workspace.forum",
            visibility=EventVisibility.MOD_ONLY,
        )

        response = await self.connector.send_event(message)
        logger.debug(f"Sent {action} comment request on topic {topic_id}")

        # Return comment ID from response if successful
        if response and response.success and response.data:
            comment_id = response.data.get("comment_id")
            logger.info(f"Posted comment {comment_id} on topic {topic_id}")

            # Add comment to message thread
            thread_id = f"forum_topic_{topic_id}"
            text_repr = f"Comment: {content}"
            if parent_comment_id:
                text_repr = f"Reply to {parent_comment_id}: {content}"

            message.thread_name = thread_id
            message.text_representation = text_repr

            return comment_id
        else:
            error_msg = response.message if response else "Unknown error"
            logger.error(f"Failed to post comment: {error_msg}")
            return None

    async def vote_on_forum_topic(self, topic_id: str, vote_type: str) -> bool:
        """Vote on a forum topic.

        Args:
            topic_id: ID of the topic to vote on
            vote_type: Type of vote ("upvote" or "downvote")

        Returns:
            bool: True if successful, False otherwise
        """
        return await self._cast_vote("topic", topic_id, vote_type)

    async def vote_on_forum_comment(self, comment_id: str, vote_type: str) -> bool:
        """Vote on a forum comment.

        Args:
            comment_id: ID of the comment to vote on
            vote_type: Type of vote ("upvote" or "downvote")

        Returns:
            bool: True if successful, False otherwise
        """
        return await self._cast_vote("comment", comment_id, vote_type)

    async def _cast_vote(
        self, target_type: str, target_id: str, vote_type: str
    ) -> bool:
        """Cast a vote on a target.

        Args:
            target_type: Type of target ("topic" or "comment")
            target_id: ID of the target
            vote_type: Type of vote ("upvote" or "downvote")

        Returns:
            bool: True if successful, False otherwise
        """
        if self.connector is None:
            logger.error(f"Cannot vote: connector is None for agent {self.agent_id}")
            return False

        if target_type not in ["topic", "comment"]:
            logger.error(f"Invalid target type: {target_type}")
            return False

        if vote_type not in ["upvote", "downvote"]:
            logger.error(f"Invalid vote type: {vote_type}")
            return False

        if not target_id:
            logger.error("Target ID cannot be empty")
            return False

        # Create vote message
        vote_msg = ForumVoteMessage(
            source_id=self.agent_id,
            target_type=target_type,
            target_id=target_id,
            vote_type=vote_type,
            action="cast",
        )

        # Wrap in Event for proper transport
        wrapper_payload = vote_msg.payload
        wrapper_payload["relevant_agent_id"] = self.agent_id
        message = Event(
            event_name="forum.vote.cast",
            source_id=self.agent_id,
            payload=wrapper_payload,
            relevant_mod="openagents.mods.workspace.forum",
            visibility=EventVisibility.MOD_ONLY,
        )

        response = await self.connector.send_event(message)
        logger.debug(f"Sent {vote_type} vote on {target_type} {target_id}")

        if response and response.success:
            logger.info(f"Cast {vote_type} on {target_type} {target_id}")
            return True
        else:
            error_msg = response.message if response else "Unknown error"
            logger.error(f"Failed to cast vote: {error_msg}")
            return False

    async def list_forum_topics(
        self, limit: int = 50, offset: int = 0, sort_by: str = "recent"
    ) -> Optional[Dict[str, Any]]:
        """List topics in the forum.

        Args:
            limit: Maximum number of topics to retrieve (1-500)
            offset: Number of topics to skip for pagination
            sort_by: Sort criteria ("recent", "popular", "votes")

        Returns:
            Optional[Dict[str, Any]]: Topics data if successful, None if failed
        """
        return await self._query_forum(
            "list_topics", limit=limit, offset=offset, sort_by=sort_by
        )

    async def get_forum_topic(self, topic_id: str) -> Optional[Dict[str, Any]]:
        """Get a specific topic with all its comments.

        Args:
            topic_id: ID of the topic to retrieve

        Returns:
            Optional[Dict[str, Any]]: Topic data with comments if successful, None if failed
        """
        return await self._query_forum("get_topic", topic_id=topic_id)

    async def search_forum_topics(
        self, query: str, limit: int = 50, offset: int = 0
    ) -> Optional[Dict[str, Any]]:
        """Search topics by keywords.

        Args:
            query: Search query string
            limit: Maximum number of topics to retrieve (1-500)
            offset: Number of topics to skip for pagination

        Returns:
            Optional[Dict[str, Any]]: Search results if successful, None if failed
        """
        return await self._query_forum(
            "search_topics", query=query, limit=limit, offset=offset
        )

    async def _query_forum(self, query_type: str, **kwargs) -> Optional[Dict[str, Any]]:
        """Execute a forum query.

        Args:
            query_type: Type of query to execute
            **kwargs: Query parameters

        Returns:
            Optional[Dict[str, Any]]: Query results if successful, None if failed
        """
        if self.connector is None:
            logger.error(
                f"Cannot query forum: connector is None for agent {self.agent_id}"
            )
            return None

        # Create query message
        query_msg = ForumQueryMessage(
            source_id=self.agent_id, query_type=query_type, **kwargs
        )

        # Wrap in Event for proper transport
        wrapper_payload = query_msg.payload
        wrapper_payload["relevant_agent_id"] = self.agent_id

        # Generate appropriate event name
        event_name_map = {
            "list_topics": "forum.topics.list",
            "search_topics": "forum.topics.search",
            "get_topic": "forum.topic.get",
            "popular_topics": "forum.popular.topics",
            "recent_topics": "forum.recent.topics",
            "user_topics": "forum.user.topics",
            "user_comments": "forum.user.comments",
        }

        event_name = event_name_map.get(query_type, "forum.query")

        message = Event(
            event_name=event_name,
            source_id=self.agent_id,
            payload=wrapper_payload,
            relevant_mod="openagents.mods.workspace.forum",
            visibility=EventVisibility.MOD_ONLY,
        )

        response = await self.connector.send_event(message)
        logger.debug(f"Sent forum query: {query_type}")

        if response and response.success and response.data:
            logger.debug(f"Forum query {query_type} successful")
            return response.data
        else:
            error_msg = response.message if response else "Unknown error"
            logger.error(f"Forum query {query_type} failed: {error_msg}")
            return None

    async def _handle_response(self, message: Event) -> None:
        """Handle response messages from the forum mod.

        Args:
            message: The response message
        """
        logger.debug(f"Received forum response: {message.event_name}")

        # Notify handlers if any
        for handler in self.forum_handlers.values():
            try:
                handler(message.payload, message.source_id)
            except Exception as e:
                logger.error(f"Error in forum handler: {e}")

    async def _handle_notification(self, message: Event) -> None:
        """Handle notification messages from the forum mod.

        Args:
            message: The notification message
        """
        logger.debug(f"Received forum notification: {message.event_name}")

        # Add notification to appropriate message thread
        if message.event_name == "forum.topic.created":
            topic_id = message.payload.get("topic_id")
            if topic_id:
                thread_id = f"forum_topic_{topic_id}"
                message.thread_name = thread_id
                message.text_representation = f"Topic created notification"
        elif message.event_name == "forum.comment.posted":
            topic_id = message.payload.get("topic_id")
            comment_id = message.payload.get("comment_id")
            if topic_id:
                thread_id = f"forum_topic_{topic_id}"
                message.thread_name = thread_id
                message.text_representation = (
                    f"Comment {comment_id} posted notification"
                )

        # Notify handlers if any
        for handler in self.forum_handlers.values():
            try:
                handler(message.payload, message.source_id)
            except Exception as e:
                logger.error(f"Error in forum handler: {e}")

    def register_forum_handler(self, handler_id: str, handler: ForumHandler) -> None:
        """Register a handler for forum events.

        Args:
            handler_id: Unique identifier for the handler
            handler: Function to call when a forum event is received
        """
        self.forum_handlers[handler_id] = handler
        logger.debug(f"Registered forum handler {handler_id}")

    def unregister_forum_handler(self, handler_id: str) -> None:
        """Unregister a forum handler.

        Args:
            handler_id: Identifier of the handler to unregister
        """
        if handler_id in self.forum_handlers:
            del self.forum_handlers[handler_id]
            logger.debug(f"Unregistered forum handler {handler_id}")

    def get_forum_thread(self, topic_id: str):
        """Get the message thread for a forum topic.

        Args:
            topic_id: ID of the forum topic

        Returns:
            MessageThread: The message thread for the topic, or None if not found
        """
        thread_id = f"forum_topic_{topic_id}"
        return self.event_threads.get(thread_id)

    def get_all_forum_threads(self):
        """Get all forum-related message threads.

        Returns:
            Dict[str, MessageThread]: Dictionary of forum threads
        """
        forum_threads = {}
        for thread_id, thread in self.event_threads.items():
            if thread_id.startswith("forum_"):
                forum_threads[thread_id] = thread
        return forum_threads

    def get_tools(self) -> List[AgentTool]:
        """Get the tools for the forum adapter.

        Returns:
            List[AgentAdapterTool]: The tools for the forum adapter
        """
        tools = []

        # Tool 1: Create forum topic
        create_topic_tool = AgentTool(
            name="create_forum_topic",
            description="Create a new topic in the forum",
            input_schema={
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Title of the topic"},
                    "content": {
                        "type": "string",
                        "description": "Content/body of the topic",
                    },
                    "allowed_groups": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of group IDs that can view this topic. If null or empty, topic is visible to all agents",
                    },
                },
                "required": ["title", "content"],
            },
            func=self.create_forum_topic,
        )
        tools.append(create_topic_tool)

        # Tool 2: Edit forum topic
        edit_topic_tool = AgentTool(
            name="edit_forum_topic",
            description="Edit an existing forum topic (only by owner)",
            input_schema={
                "type": "object",
                "properties": {
                    "topic_id": {
                        "type": "string",
                        "description": "ID of the topic to edit",
                    },
                    "title": {"type": "string", "description": "New title (optional)"},
                    "content": {
                        "type": "string",
                        "description": "New content (optional)",
                    },
                },
                "required": ["topic_id"],
            },
            func=self.edit_forum_topic,
        )
        tools.append(edit_topic_tool)

        # Tool 3: Delete forum topic
        delete_topic_tool = AgentTool(
            name="delete_forum_topic",
            description="Delete a forum topic (only by owner)",
            input_schema={
                "type": "object",
                "properties": {
                    "topic_id": {
                        "type": "string",
                        "description": "ID of the topic to delete",
                    }
                },
                "required": ["topic_id"],
            },
            func=self.delete_forum_topic,
        )
        tools.append(delete_topic_tool)

        # Tool 4: Post forum topic comment
        post_comment_tool = AgentTool(
            name="post_forum_topic_comment",
            description="Post a comment on a topic or reply to a comment (max 5 levels of nesting)",
            input_schema={
                "type": "object",
                "properties": {
                    "topic_id": {
                        "type": "string",
                        "description": "ID of the topic to comment on",
                    },
                    "content": {
                        "type": "string",
                        "description": "Content of the comment",
                    },
                    "parent_comment_id": {
                        "type": "string",
                        "description": "ID of parent comment (for replies)",
                    },
                },
                "required": ["topic_id", "content"],
            },
            func=self.post_forum_topic_comment,
        )
        tools.append(post_comment_tool)

        # Tool 5: Vote on forum topic
        vote_topic_tool = AgentTool(
            name="vote_on_forum_topic",
            description="Vote on a forum topic",
            input_schema={
                "type": "object",
                "properties": {
                    "topic_id": {
                        "type": "string",
                        "description": "ID of the topic to vote on",
                    },
                    "vote_type": {
                        "type": "string",
                        "description": "Type of vote",
                        "enum": ["upvote", "downvote"],
                    },
                },
                "required": ["topic_id", "vote_type"],
            },
            func=self.vote_on_forum_topic,
        )
        tools.append(vote_topic_tool)

        # Tool 6: Vote on forum comment
        vote_comment_tool = AgentTool(
            name="vote_on_forum_comment",
            description="Vote on a forum comment",
            input_schema={
                "type": "object",
                "properties": {
                    "comment_id": {
                        "type": "string",
                        "description": "ID of the comment to vote on",
                    },
                    "vote_type": {
                        "type": "string",
                        "description": "Type of vote",
                        "enum": ["upvote", "downvote"],
                    },
                },
                "required": ["comment_id", "vote_type"],
            },
            func=self.vote_on_forum_comment,
        )
        tools.append(vote_comment_tool)

        # Tool 7: List forum topics
        list_topics_tool = AgentTool(
            name="list_forum_topics",
            description="List topics in the forum with pagination and sorting",
            input_schema={
                "type": "object",
                "properties": {
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of topics to retrieve (1-500, default 50)",
                        "minimum": 1,
                        "maximum": 500,
                        "default": 50,
                    },
                    "offset": {
                        "type": "integer",
                        "description": "Number of topics to skip for pagination (default 0)",
                        "minimum": 0,
                        "default": 0,
                    },
                    "sort_by": {
                        "type": "string",
                        "description": "Sort criteria",
                        "enum": ["recent", "popular", "votes"],
                        "default": "recent",
                    },
                },
                "required": [],
            },
            func=self.list_forum_topics,
        )
        tools.append(list_topics_tool)

        # Tool 8: Get forum topic
        get_topic_tool = AgentTool(
            name="get_forum_topic",
            description="Get a specific topic with all its comments",
            input_schema={
                "type": "object",
                "properties": {
                    "topic_id": {
                        "type": "string",
                        "description": "ID of the topic to retrieve",
                    }
                },
                "required": ["topic_id"],
            },
            func=self.get_forum_topic,
        )
        tools.append(get_topic_tool)

        # Tool 9: Search forum topics
        search_topics_tool = AgentTool(
            name="search_forum_topics",
            description="Search topics by keywords with pagination",
            input_schema={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query string"},
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of topics to retrieve (1-500, default 50)",
                        "minimum": 1,
                        "maximum": 500,
                        "default": 50,
                    },
                    "offset": {
                        "type": "integer",
                        "description": "Number of topics to skip for pagination (default 0)",
                        "minimum": 0,
                        "default": 0,
                    },
                },
                "required": ["query"],
            },
            func=self.search_forum_topics,
        )
        tools.append(search_topics_tool)

        return tools
