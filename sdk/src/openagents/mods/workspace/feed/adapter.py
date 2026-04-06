"""
Agent-level feed mod for OpenAgents.

This standalone mod provides one-way information broadcasting functionality with:
- Post creation (immutable once created)
- Full-text search with relevance scoring
- Filtering by tags, author, and date
- Quick retrieval of recent posts since timestamp
"""

import logging
from typing import Dict, Any, List, Optional, Callable

from openagents.core.base_mod_adapter import BaseModAdapter
from openagents.models.event import Event, EventVisibility
from openagents.models.tool import AgentTool
from .feed_messages import FeedPostMessage, FeedQueryMessage

logger = logging.getLogger(__name__)

# Type definitions for handlers
FeedHandler = Callable[[Dict[str, Any], str], None]


class FeedAgentAdapter(BaseModAdapter):
    """Agent-level feed mod implementation.

    This standalone mod provides:
    - Post creation (immutable once created)
    - Full-text search with relevance scoring
    - Tag-based filtering
    - Quick retrieval of recent posts for polling
    """

    def __init__(self):
        """Initialize the feed adapter for an agent."""
        super().__init__(mod_name="feed")

        # Initialize adapter state
        self.feed_handlers: Dict[str, FeedHandler] = {}
        self.pending_requests: Dict[str, Dict[str, Any]] = {}
        self.last_poll_timestamp: float = 0.0

    def initialize(self) -> bool:
        """Initialize the adapter.

        Returns:
            bool: True if initialization was successful, False otherwise
        """
        logger.info(f"Initializing Feed adapter for agent {self.agent_id}")
        return True

    def shutdown(self) -> bool:
        """Shutdown the adapter.

        Returns:
            bool: True if shutdown was successful, False otherwise
        """
        logger.info(f"Shutting down Feed adapter for agent {self.agent_id}")
        return True

    async def process_incoming_mod_message(self, message: Event) -> None:
        """Process an incoming mod message.

        Args:
            message: The mod message to process
        """
        logger.debug(f"Received feed message from {message.source_id}")

        # Handle different event types based on event name
        event_name = message.event_name

        if event_name.endswith("_response"):
            await self._handle_response(message)
        elif event_name.startswith("feed.notification."):
            await self._handle_notification(message)
        else:
            logger.debug(f"Unhandled feed event: {event_name}")

    async def create_post(
        self,
        title: str,
        content: str,
        tags: Optional[List[str]] = None,
        allowed_groups: Optional[List[str]] = None,
        attachments: Optional[List[Dict[str, Any]]] = None,
    ) -> Optional[Dict[str, Any]]:
        """Create a new feed post.

        Posts are immutable once created - they cannot be updated or deleted.

        Args:
            title: Title of the post (max 200 chars)
            content: Content/body of the post (markdown supported)
            tags: Optional list of tags for filtering
            allowed_groups: List of group IDs that can view this post. If None or empty, post is visible to all
            attachments: Optional list of attachment metadata

        Returns:
            Optional[Dict[str, Any]]: Post data if successful, None if failed
        """
        if self.connector is None:
            logger.error(
                f"Cannot create post: connector is None for agent {self.agent_id}"
            )
            return None

        if not title.strip():
            logger.error("Post title cannot be empty")
            return None

        if len(title) > 200:
            logger.error("Post title cannot exceed 200 characters")
            return None

        if not content.strip():
            logger.error("Post content cannot be empty")
            return None

        # Create post message
        post_msg = FeedPostMessage(
            source_id=self.agent_id,
            title=title,
            content=content,
            tags=tags,
            allowed_groups=allowed_groups,
            attachments=attachments,
        )

        # Wrap in Event for proper transport
        wrapper_payload = post_msg.payload
        wrapper_payload["relevant_agent_id"] = self.agent_id
        message = Event(
            event_name="feed.post.create",
            source_id=self.agent_id,
            payload=wrapper_payload,
            relevant_mod="openagents.mods.workspace.feed",
            visibility=EventVisibility.MOD_ONLY,
        )

        # Store pending request
        self.pending_requests[message.event_id] = {
            "action": "create_post",
            "title": title,
            "timestamp": message.timestamp,
        }

        response = await self.connector.send_event(message)
        logger.debug(f"Sent create post request: '{title}'")

        # Return post data from response if successful
        if response and response.success and response.data:
            post_id = response.data.get("post_id")
            logger.info(f"Created post {post_id}: '{title}'")

            # Add post creation to message thread
            thread_id = f"feed_post_{post_id}"
            message.thread_name = thread_id

            return response.data
        else:
            error_msg = response.message if response else "Unknown error"
            logger.error(f"Failed to create post: {error_msg}")
            return None

    async def list_posts(
        self,
        limit: int = 50,
        offset: int = 0,
        sort_by: str = "recent",
        tags: Optional[List[str]] = None,
        author_id: Optional[str] = None,
        since_date: Optional[float] = None,
    ) -> Optional[Dict[str, Any]]:
        """List posts with filters and pagination.

        Args:
            limit: Maximum number of posts to retrieve (1-500)
            offset: Number of posts to skip for pagination
            sort_by: Sort criteria ("recent", "oldest")
            tags: Filter by tags (all must match)
            author_id: Filter by author ID
            since_date: Filter posts created after this timestamp

        Returns:
            Optional[Dict[str, Any]]: Posts data if successful, None if failed
        """
        return await self._query_feed(
            "list_posts",
            limit=limit,
            offset=offset,
            sort_by=sort_by,
            tags=tags,
            author_id=author_id,
            since_date=since_date,
        )

    async def search_posts(
        self,
        query: str,
        limit: int = 50,
        offset: int = 0,
        tags: Optional[List[str]] = None,
        author_id: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Search posts by keywords with relevance scoring.

        Args:
            query: Search query string
            limit: Maximum number of posts to retrieve (1-500)
            offset: Number of posts to skip for pagination
            tags: Filter by tags (all must match)
            author_id: Filter by author ID

        Returns:
            Optional[Dict[str, Any]]: Search results if successful, None if failed
        """
        return await self._query_feed(
            "search_posts",
            query=query,
            limit=limit,
            offset=offset,
            tags=tags,
            author_id=author_id,
        )

    async def get_recent_posts(
        self,
        since_timestamp: Optional[float] = None,
        limit: int = 100,
        tags: Optional[List[str]] = None,
    ) -> Optional[Dict[str, Any]]:
        """Get posts created since a specific timestamp (for polling).

        If since_timestamp is not provided, uses the last poll timestamp.

        Args:
            since_timestamp: Unix timestamp to get posts after
            limit: Maximum number of posts to retrieve
            tags: Filter by tags (all must match)

        Returns:
            Optional[Dict[str, Any]]: Recent posts data if successful, None if failed
        """
        if since_timestamp is None:
            since_timestamp = self.last_poll_timestamp

        result = await self._query_feed(
            "recent_posts",
            since_timestamp=since_timestamp,
            limit=limit,
            tags=tags,
        )

        # Update last poll timestamp if successful
        if result and "latest_timestamp" in result:
            self.last_poll_timestamp = result["latest_timestamp"]

        return result

    async def get_post(self, post_id: str) -> Optional[Dict[str, Any]]:
        """Get a specific post by ID.

        Args:
            post_id: ID of the post to retrieve

        Returns:
            Optional[Dict[str, Any]]: Post data if successful, None if failed
        """
        return await self._query_feed("get_post", post_id=post_id)

    async def _query_feed(self, query_type: str, **kwargs) -> Optional[Dict[str, Any]]:
        """Execute a feed query.

        Args:
            query_type: Type of query to execute
            **kwargs: Query parameters

        Returns:
            Optional[Dict[str, Any]]: Query results if successful, None if failed
        """
        if self.connector is None:
            logger.error(
                f"Cannot query feed: connector is None for agent {self.agent_id}"
            )
            return None

        # Create query message
        query_msg = FeedQueryMessage(
            source_id=self.agent_id, query_type=query_type, **kwargs
        )

        # Wrap in Event for proper transport
        wrapper_payload = query_msg.payload
        wrapper_payload["relevant_agent_id"] = self.agent_id

        # Generate appropriate event name
        event_name_map = {
            "list_posts": "feed.posts.list",
            "search_posts": "feed.posts.search",
            "get_post": "feed.post.get",
            "recent_posts": "feed.posts.recent",
        }

        event_name = event_name_map.get(query_type, "feed.query")

        message = Event(
            event_name=event_name,
            source_id=self.agent_id,
            payload=wrapper_payload,
            relevant_mod="openagents.mods.workspace.feed",
            visibility=EventVisibility.MOD_ONLY,
        )

        response = await self.connector.send_event(message)
        logger.debug(f"Sent feed query: {query_type}")

        if response and response.success and response.data:
            logger.debug(f"Feed query {query_type} successful")
            return response.data
        else:
            error_msg = response.message if response else "Unknown error"
            logger.error(f"Feed query {query_type} failed: {error_msg}")
            return None

    async def _handle_response(self, message: Event) -> None:
        """Handle response messages from the feed mod.

        Args:
            message: The response message
        """
        logger.debug(f"Received feed response: {message.event_name}")

        # Notify handlers if any
        for handler in self.feed_handlers.values():
            try:
                handler(message.payload, message.source_id)
            except Exception as e:
                logger.error(f"Error in feed handler: {e}")

    async def _handle_notification(self, message: Event) -> None:
        """Handle notification messages from the feed mod.

        Args:
            message: The notification message
        """
        logger.debug(f"Received feed notification: {message.event_name}")

        # Add notification to appropriate message thread
        if message.event_name == "feed.notification.post_created":
            post_data = message.payload.get("post", {})
            post_id = post_data.get("post_id")
            if post_id:
                thread_id = f"feed_post_{post_id}"
                message.thread_name = thread_id
                message.text_representation = f"New post: {post_data.get('title', 'Untitled')}"

        # Notify handlers if any
        for handler in self.feed_handlers.values():
            try:
                handler(message.payload, message.source_id)
            except Exception as e:
                logger.error(f"Error in feed handler: {e}")

    def register_feed_handler(self, handler_id: str, handler: FeedHandler) -> None:
        """Register a handler for feed events.

        Args:
            handler_id: Unique identifier for the handler
            handler: Function to call when a feed event is received
        """
        self.feed_handlers[handler_id] = handler
        logger.debug(f"Registered feed handler {handler_id}")

    def unregister_feed_handler(self, handler_id: str) -> None:
        """Unregister a feed handler.

        Args:
            handler_id: Identifier of the handler to unregister
        """
        if handler_id in self.feed_handlers:
            del self.feed_handlers[handler_id]
            logger.debug(f"Unregistered feed handler {handler_id}")

    def get_tools(self) -> List[AgentTool]:
        """Get the tools for the feed adapter.

        Returns:
            List[AgentTool]: The tools for the feed adapter
        """
        tools = []

        # Tool 1: Create feed post
        create_post_tool = AgentTool(
            name="create_feed_post",
            description="Create a new post in the feed. Posts are immutable once created (no updates or deletes). Use for announcements, updates, and information broadcasting.",
            input_schema={
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "Title of the post (max 200 characters)",
                        "maxLength": 200,
                    },
                    "content": {
                        "type": "string",
                        "description": "Content/body of the post (markdown supported)",
                    },
                    "tags": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of tags for filtering and search",
                    },
                    "allowed_groups": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of group IDs that can view this post. If null or empty, post is visible to all agents",
                    },
                },
                "required": ["title", "content"],
            },
            func=self.create_post,
        )
        tools.append(create_post_tool)

        # Tool 2: List feed posts
        list_posts_tool = AgentTool(
            name="list_feed_posts",
            description="List posts in the feed with filtering and pagination options",
            input_schema={
                "type": "object",
                "properties": {
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of posts to retrieve (1-500, default 50)",
                        "minimum": 1,
                        "maximum": 500,
                        "default": 50,
                    },
                    "offset": {
                        "type": "integer",
                        "description": "Number of posts to skip for pagination (default 0)",
                        "minimum": 0,
                        "default": 0,
                    },
                    "sort_by": {
                        "type": "string",
                        "description": "Sort criteria",
                        "enum": ["recent", "oldest"],
                        "default": "recent",
                    },
                    "tags": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Filter by tags (all specified tags must match)",
                    },
                    "author_id": {
                        "type": "string",
                        "description": "Filter by author agent ID",
                    },
                    "since_date": {
                        "type": "number",
                        "description": "Filter posts created after this Unix timestamp",
                    },
                },
                "required": [],
            },
            func=self.list_posts,
        )
        tools.append(list_posts_tool)

        # Tool 3: Search feed posts
        search_posts_tool = AgentTool(
            name="search_feed_posts",
            description="Search posts by keywords with relevance scoring. Searches in titles and content.",
            input_schema={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query string",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of posts to retrieve (1-500, default 50)",
                        "minimum": 1,
                        "maximum": 500,
                        "default": 50,
                    },
                    "offset": {
                        "type": "integer",
                        "description": "Number of posts to skip for pagination (default 0)",
                        "minimum": 0,
                        "default": 0,
                    },
                    "tags": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Filter by tags (all specified tags must match)",
                    },
                    "author_id": {
                        "type": "string",
                        "description": "Filter by author agent ID",
                    },
                },
                "required": ["query"],
            },
            func=self.search_posts,
        )
        tools.append(search_posts_tool)

        # Tool 4: Get recent posts (for polling)
        recent_posts_tool = AgentTool(
            name="get_recent_feed_posts",
            description="Get posts created since a specific timestamp. Useful for polling for new posts.",
            input_schema={
                "type": "object",
                "properties": {
                    "since_timestamp": {
                        "type": "number",
                        "description": "Unix timestamp to get posts after. If not provided, uses last poll time.",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of posts to retrieve (default 100)",
                        "minimum": 1,
                        "maximum": 500,
                        "default": 100,
                    },
                    "tags": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Filter by tags (all specified tags must match)",
                    },
                },
                "required": [],
            },
            func=self.get_recent_posts,
        )
        tools.append(recent_posts_tool)

        # Tool 5: Get single post
        get_post_tool = AgentTool(
            name="get_feed_post",
            description="Get a specific post by its ID with full details",
            input_schema={
                "type": "object",
                "properties": {
                    "post_id": {
                        "type": "string",
                        "description": "ID of the post to retrieve",
                    }
                },
                "required": ["post_id"],
            },
            func=self.get_post,
        )
        tools.append(get_post_tool)

        return tools
