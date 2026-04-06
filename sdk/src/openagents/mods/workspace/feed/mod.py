"""
Network-level feed mod for OpenAgents.

This standalone mod enables information publishing functionality with:
- One-way information broadcasting (announcements, updates, alerts)
- Immutable posts (no updates/deletes once published)
- Full-text search and filtering
- Tag-based organization
- Quick retrieval of recent posts
"""

import logging
import json
import time
import uuid
from typing import Dict, Any, List, Optional, Set
from pathlib import Path
from dataclasses import dataclass, field, asdict

from openagents.config.globals import BROADCAST_AGENT_ID
from openagents.core.base_mod import BaseMod, mod_event_handler
from openagents.models.event import Event
from openagents.models.event_response import EventResponse

logger = logging.getLogger(__name__)

@dataclass
class Attachment:
    """Represents a file attachment for a feed post."""

    file_id: str
    filename: str
    content_type: str
    size: int

    def to_dict(self) -> Dict[str, Any]:
        """Convert attachment to dictionary representation."""
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Attachment":
        """Create attachment from dictionary."""
        return cls(
            file_id=data["file_id"],
            filename=data["filename"],
            content_type=data["content_type"],
            size=data["size"],
        )


@dataclass
class FeedPost:
    """Represents a feed post.

    Posts are immutable once created - no updates or deletes are supported.
    """

    post_id: str
    title: str  # Max 200 chars
    content: str  # Markdown content
    author_id: str
    created_at: float  # Unix timestamp
    tags: List[str] = field(default_factory=list)
    allowed_groups: List[str] = field(default_factory=list)  # Empty = public
    attachments: List[Attachment] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        """Convert post to dictionary representation."""
        return {
            "post_id": self.post_id,
            "title": self.title,
            "content": self.content,
            "author_id": self.author_id,
            "created_at": self.created_at,
            "tags": self.tags,
            "allowed_groups": self.allowed_groups,
            "attachments": [att.to_dict() for att in self.attachments],
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "FeedPost":
        """Create post from dictionary."""
        attachments = [
            Attachment.from_dict(att) for att in data.get("attachments", [])
        ]
        return cls(
            post_id=data["post_id"],
            title=data["title"],
            content=data["content"],
            author_id=data["author_id"],
            created_at=data["created_at"],
            tags=data.get("tags", []),
            allowed_groups=data.get("allowed_groups", []),
            attachments=attachments,
        )


class FeedNetworkMod(BaseMod):
    """Network-level feed mod implementation.

    This standalone mod enables:
    - One-way information broadcasting (announcements, updates)
    - Immutable posts (no updates/deletes)
    - Full-text search with relevance scoring
    - Tag-based filtering
    - Quick retrieval of recent posts since timestamp
    """

    # This mod requires an agent adapter for clients to use feed tools
    requires_adapter = True

    def __init__(self, mod_name: str = "feed"):
        """Initialize the feed mod for a network."""
        super().__init__(mod_name=mod_name)

        # Track active agents
        self.active_agents: Set[str] = set()

        logger.info(f"Initialized Feed Network Mod: {self.mod_name}")

    def _get_agent_groups(self, agent_id: str) -> List[str]:
        """Get the groups that an agent belongs to.

        Args:
            agent_id: ID of the agent

        Returns:
            List[str]: List of group names the agent belongs to
        """
        if not self.network or not self.network.topology:
            return []

        # Get agent's primary group from topology
        agent_group = self.network.topology.agent_group_membership.get(agent_id)
        if agent_group:
            return [agent_group]
        return []

    def _can_agent_view_post(self, agent_id: str, post: FeedPost) -> bool:
        """Check if an agent can view a post based on allowed_groups.

        Args:
            agent_id: ID of the agent
            post: The post to check

        Returns:
            bool: True if agent can view the post, False otherwise
        """
        # If allowed_groups is empty, everyone can view
        if not post.allowed_groups:
            return True

        # Post author can always view their own posts
        if post.author_id == agent_id:
            return True

        # Get agent's groups
        agent_groups = self._get_agent_groups(agent_id)

        # Check if agent is in any of the allowed groups
        return any(group in post.allowed_groups for group in agent_groups)

    @property
    def posts(self) -> Dict[str, FeedPost]:
        """Get all posts (loaded from storage)."""
        posts = {}
        metadata = self._get_posts_metadata()
        # Load all posts from storage
        for post_id in metadata["posts"].keys():
            post = self._load_post(post_id)
            if post:
                posts[post_id] = post
        return posts

    @property
    def post_order_recent(self) -> List[str]:
        """Get recent post order (loaded from storage)."""
        metadata = self._get_posts_metadata()
        return metadata.get("post_order_recent", [])

    def _load_post(self, post_id: str) -> Optional[FeedPost]:
        """Load a specific post from storage."""
        try:
            storage_path = self.get_storage_path()
            posts_dir = storage_path / "posts"
            post_file = posts_dir / f"{post_id}.json"

            if not post_file.exists():
                return None

            with open(post_file, "r", encoding="utf-8") as f:
                post_dict = json.load(f)

            return FeedPost.from_dict(post_dict)

        except Exception as e:
            logger.error(f"Failed to load post {post_id}: {e}")
            return None

    def _get_posts_metadata(self) -> Dict[str, Any]:
        """Get post metadata (for listing) without loading full posts."""
        try:
            storage_path = self.get_storage_path()

            # Load basic post info from individual files
            posts_data = {}
            posts_dir = storage_path / "posts"
            if posts_dir.exists():
                for post_file in posts_dir.glob("*.json"):
                    try:
                        post_id = post_file.stem  # filename without extension
                        with open(post_file, "r", encoding="utf-8") as f:
                            post_dict = json.load(f)
                        # Extract only metadata, not full content
                        posts_data[post_id] = {
                            "post_id": post_dict["post_id"],
                            "title": post_dict["title"],
                            "author_id": post_dict["author_id"],
                            "created_at": post_dict["created_at"],
                            "tags": post_dict.get("tags", []),
                            "allowed_groups": post_dict.get("allowed_groups", []),
                        }
                    except Exception as e:
                        logger.error(
                            f"Failed to load metadata for post file {post_file}: {e}"
                        )
                        continue

            # Load ordering metadata
            metadata = {}
            metadata_file = storage_path / "metadata.json"
            if metadata_file.exists():
                with open(metadata_file, "r", encoding="utf-8") as f:
                    metadata = json.load(f)

            return {
                "posts": posts_data,
                "post_order_recent": metadata.get("post_order_recent", []),
            }

        except Exception as e:
            logger.error(f"Failed to load posts metadata: {e}")
            return {"posts": {}, "post_order_recent": []}

    def _save_post(self, post: FeedPost):
        """Save a single post to its own file."""
        try:
            storage_path = self.get_storage_path()
            posts_dir = storage_path / "posts"
            posts_dir.mkdir(parents=True, exist_ok=True)

            post_file = posts_dir / f"{post.post_id}.json"

            # Save to individual file
            with open(post_file, "w", encoding="utf-8") as f:
                json.dump(post.to_dict(), f, indent=2, default=str)

        except Exception as e:
            logger.error(f"Failed to save post {post.post_id}: {e}")

    def _save_metadata(self, post_order_recent: List[str]):
        """Save post ordering metadata."""
        try:
            storage_path = self.get_storage_path()
            storage_path.mkdir(parents=True, exist_ok=True)
            metadata_file = storage_path / "metadata.json"

            metadata = {
                "post_order_recent": post_order_recent,
                "last_saved": time.time(),
            }

            with open(metadata_file, "w", encoding="utf-8") as f:
                json.dump(metadata, f, indent=2, default=str)

        except Exception as e:
            logger.error(f"Failed to save metadata: {e}")

    def _save_attachment(self, post_id: str, file_id: str, content: bytes):
        """Save an attachment file."""
        try:
            storage_path = self.get_storage_path()
            attachments_dir = storage_path / "attachments"
            attachments_dir.mkdir(parents=True, exist_ok=True)

            attachment_file = attachments_dir / file_id

            with open(attachment_file, "wb") as f:
                f.write(content)

        except Exception as e:
            logger.error(f"Failed to save attachment {file_id}: {e}")

    def _load_attachment(self, file_id: str) -> Optional[bytes]:
        """Load an attachment file."""
        try:
            storage_path = self.get_storage_path()
            attachment_file = storage_path / "attachments" / file_id

            if not attachment_file.exists():
                return None

            with open(attachment_file, "rb") as f:
                return f.read()

        except Exception as e:
            logger.error(f"Failed to load attachment {file_id}: {e}")
            return None

    def initialize(self) -> bool:
        """Initialize the mod without loading all data into memory.

        Returns:
            bool: True if initialization was successful, False otherwise
        """
        try:
            # Ensure storage directories exist
            storage_path = self.get_storage_path()
            (storage_path / "posts").mkdir(parents=True, exist_ok=True)
            (storage_path / "attachments").mkdir(parents=True, exist_ok=True)

            logger.info("Feed mod initialization complete (storage-first mode)")
            return True
        except Exception as e:
            logger.error(f"Feed mod initialization failed: {e}")
            return False

    def shutdown(self) -> bool:
        """Shutdown the mod gracefully.

        Returns:
            bool: True if shutdown was successful, False otherwise
        """
        try:
            # Clear state (data is already in storage)
            self.active_agents.clear()

            logger.info("Feed mod shutdown complete")
            return True
        except Exception as e:
            logger.error(f"Feed mod shutdown failed: {e}")
            return False

    async def handle_register_agent(
        self, agent_id: str, metadata: Optional[Dict[str, Any]] = None
    ) -> Optional[EventResponse]:
        """Handle agent registration."""
        self.active_agents.add(agent_id)
        logger.info(f"Registered agent {agent_id} with feed mod")
        return None

    async def handle_unregister_agent(self, agent_id: str) -> Optional[EventResponse]:
        """Handle agent unregistration."""
        if agent_id in self.active_agents:
            self.active_agents.remove(agent_id)
        logger.info(f"Unregistered agent {agent_id} from feed mod")
        return None

    @mod_event_handler("feed.post.create")
    async def _handle_post_create(self, event: Event) -> Optional[EventResponse]:
        """Handle post creation."""
        try:
            return await self._create_post(event)
        except Exception as e:
            logger.error(f"Error handling post creation: {e}")
            return EventResponse(
                success=False, message=f"Error creating post: {str(e)}"
            )

    async def _create_post(self, event: Event) -> EventResponse:
        """Create a new feed post."""
        payload = event.payload
        title = payload.get("title", "").strip()
        content = payload.get("content", "").strip()
        tags = payload.get("tags", [])
        allowed_groups = payload.get("allowed_groups", [])
        attachments_data = payload.get("attachments", [])
        author_id = event.source_id

        # Validate title
        if not title:
            return EventResponse(success=False, message="Post title cannot be empty")

        if len(title) > 200:
            return EventResponse(
                success=False, message="Post title cannot exceed 200 characters"
            )

        # Validate content
        if not content:
            return EventResponse(success=False, message="Post content cannot be empty")

        # Validate tags
        if not isinstance(tags, list):
            return EventResponse(success=False, message="Tags must be a list of strings")

        # Clean tags
        tags = [str(tag).strip().lower() for tag in tags if tag]

        # Create post
        post_id = str(uuid.uuid4())
        timestamp = time.time()

        # Process attachments
        attachments = []
        for att_data in attachments_data:
            if isinstance(att_data, dict):
                try:
                    attachment = Attachment(
                        file_id=att_data.get("file_id", str(uuid.uuid4())),
                        filename=att_data.get("filename", "unknown"),
                        content_type=att_data.get("content_type", "application/octet-stream"),
                        size=att_data.get("size", 0),
                    )
                    attachments.append(attachment)
                except Exception as e:
                    logger.warning(f"Failed to process attachment: {e}")

        post = FeedPost(
            post_id=post_id,
            title=title,
            content=content,
            author_id=author_id,
            created_at=timestamp,
            tags=tags,
            allowed_groups=allowed_groups if allowed_groups else [],
            attachments=attachments,
        )

        # Save the new post to storage
        self._save_post(post)

        # Update post ordering metadata
        metadata = self._get_posts_metadata()
        post_order_recent = metadata["post_order_recent"]

        # Add to front for recency
        if post_id in post_order_recent:
            post_order_recent.remove(post_id)
        post_order_recent.insert(0, post_id)

        # Save metadata
        self._save_metadata(post_order_recent)

        logger.info(f"Created post {post_id}: '{title}' by {author_id}")

        # Send notification event
        await self._send_post_notification(
            "feed.notification.post_created", post, event.source_id
        )

        return EventResponse(
            success=True,
            message="Post created successfully",
            data={
                "post_id": post_id,
                "title": title,
                "created_at": timestamp,
                "tags": tags,
            },
        )

    @mod_event_handler("feed.posts.list")
    async def _handle_posts_list(self, event: Event) -> Optional[EventResponse]:
        """Handle listing posts."""
        try:
            return await self._list_posts(event)
        except Exception as e:
            logger.error(f"Error listing posts: {e}")
            return EventResponse(
                success=False, message=f"Error listing posts: {str(e)}"
            )

    async def _list_posts(self, event: Event) -> EventResponse:
        """List posts with filters and pagination."""
        payload = event.payload
        limit = int(payload.get("limit", 50))
        offset = int(payload.get("offset", 0))
        sort_by = payload.get("sort_by", "recent")
        author_id = payload.get("author_id")
        tags = payload.get("tags", [])
        since_date = payload.get("since_date")  # Unix timestamp
        requester_id = event.source_id

        # Get ordered post list
        ordered_posts = self.post_order_recent

        # Filter posts by permission and criteria
        viewable_posts = []
        for post_id in ordered_posts:
            post = self._load_post(post_id)
            if not post:
                continue

            # Check view permission
            if not self._can_agent_view_post(requester_id, post):
                continue

            # Filter by author
            if author_id and post.author_id != author_id:
                continue

            # Filter by tags (all specified tags must match)
            if tags:
                if not all(tag.lower() in [t.lower() for t in post.tags] for tag in tags):
                    continue

            # Filter by date
            if since_date and post.created_at < since_date:
                continue

            viewable_posts.append(post)

        # Sort posts
        if sort_by == "oldest":
            viewable_posts.sort(key=lambda p: p.created_at)
        else:  # recent (default)
            viewable_posts.sort(key=lambda p: p.created_at, reverse=True)

        # Apply pagination
        total_count = len(viewable_posts)
        paginated_posts = viewable_posts[offset : offset + limit]

        posts_data = [post.to_dict() for post in paginated_posts]

        return EventResponse(
            success=True,
            message="Posts retrieved successfully",
            data={
                "posts": posts_data,
                "total_count": total_count,
                "offset": offset,
                "limit": limit,
                "has_more": offset + limit < total_count,
                "sort_by": sort_by,
            },
        )

    @mod_event_handler("feed.posts.search")
    async def _handle_posts_search(self, event: Event) -> Optional[EventResponse]:
        """Handle searching posts."""
        try:
            return await self._search_posts(event)
        except Exception as e:
            logger.error(f"Error searching posts: {e}")
            return EventResponse(
                success=False, message=f"Error searching posts: {str(e)}"
            )

    async def _search_posts(self, event: Event) -> EventResponse:
        """Search posts by keywords with relevance scoring."""
        payload = event.payload
        query = payload.get("query", "").strip().lower()
        limit = int(payload.get("limit", 50))
        offset = int(payload.get("offset", 0))
        tags = payload.get("tags", [])
        author_id = payload.get("author_id")
        requester_id = event.source_id

        if not query:
            return EventResponse(success=False, message="Search query cannot be empty")

        # Search in titles and content with relevance scoring
        matching_posts = []
        for post in self.posts.values():
            # Check view permission
            if not self._can_agent_view_post(requester_id, post):
                continue

            # Filter by author
            if author_id and post.author_id != author_id:
                continue

            # Filter by tags
            if tags:
                if not all(tag.lower() in [t.lower() for t in post.tags] for tag in tags):
                    continue

            # Calculate relevance score
            score = 0
            title_lower = post.title.lower()
            content_lower = post.content.lower()

            # Title match has higher weight
            if query in title_lower:
                score += 10
                # Exact title match gets bonus
                if title_lower == query:
                    score += 5
                # Title starts with query gets bonus
                elif title_lower.startswith(query):
                    score += 3

            # Content match
            if query in content_lower:
                score += 5
                # Count occurrences for additional scoring
                score += min(content_lower.count(query), 5)

            # Tag match
            if any(query in tag.lower() for tag in post.tags):
                score += 3

            if score > 0:
                matching_posts.append((post, score))

        # Sort by relevance score (descending), then by recency
        matching_posts.sort(key=lambda x: (x[1], x[0].created_at), reverse=True)

        # Apply pagination
        total_count = len(matching_posts)
        paginated_posts = matching_posts[offset : offset + limit]

        posts_data = [post.to_dict() for post, _ in paginated_posts]

        return EventResponse(
            success=True,
            message="Search completed successfully",
            data={
                "posts": posts_data,
                "total_count": total_count,
                "offset": offset,
                "limit": limit,
                "has_more": offset + limit < total_count,
                "query": query,
            },
        )

    @mod_event_handler("feed.posts.recent")
    async def _handle_posts_recent(self, event: Event) -> Optional[EventResponse]:
        """Handle getting recent posts since timestamp."""
        try:
            return await self._get_recent_posts(event)
        except Exception as e:
            logger.error(f"Error getting recent posts: {e}")
            return EventResponse(
                success=False, message=f"Error getting recent posts: {str(e)}"
            )

    async def _get_recent_posts(self, event: Event) -> EventResponse:
        """Get posts since a specific timestamp (for polling)."""
        payload = event.payload
        since_timestamp = payload.get("since_timestamp", 0)
        limit = int(payload.get("limit", 100))
        tags = payload.get("tags", [])
        requester_id = event.source_id

        # Validate timestamp
        if not isinstance(since_timestamp, (int, float)):
            return EventResponse(
                success=False, message="since_timestamp must be a number"
            )

        # Get posts newer than timestamp
        recent_posts = []
        for post in self.posts.values():
            # Check view permission
            if not self._can_agent_view_post(requester_id, post):
                continue

            # Only include posts newer than timestamp
            if post.created_at <= since_timestamp:
                continue

            # Filter by tags
            if tags:
                if not all(tag.lower() in [t.lower() for t in post.tags] for tag in tags):
                    continue

            recent_posts.append(post)

        # Sort by creation time (oldest first for chronological order)
        recent_posts.sort(key=lambda p: p.created_at)

        # Apply limit
        total_count = len(recent_posts)
        limited_posts = recent_posts[:limit]

        posts_data = [post.to_dict() for post in limited_posts]

        # Determine latest timestamp for next poll
        latest_timestamp = (
            max(p.created_at for p in limited_posts) if limited_posts else since_timestamp
        )

        return EventResponse(
            success=True,
            message="Recent posts retrieved successfully",
            data={
                "posts": posts_data,
                "count": len(posts_data),
                "total_new": total_count,
                "has_more": total_count > limit,
                "since_timestamp": since_timestamp,
                "latest_timestamp": latest_timestamp,
            },
        )

    @mod_event_handler("feed.post.get")
    async def _handle_post_get(self, event: Event) -> Optional[EventResponse]:
        """Handle getting a single post."""
        try:
            return await self._get_post(event)
        except Exception as e:
            logger.error(f"Error getting post: {e}")
            return EventResponse(
                success=False, message=f"Error getting post: {str(e)}"
            )

    async def _get_post(self, event: Event) -> EventResponse:
        """Get a specific post by ID."""
        payload = event.payload
        post_id = payload.get("post_id")
        requester_id = event.source_id

        if not post_id:
            return EventResponse(success=False, message="Post ID is required")

        post = self._load_post(post_id)
        if not post:
            return EventResponse(success=False, message="Post not found")

        # Check view permission
        if not self._can_agent_view_post(requester_id, post):
            return EventResponse(
                success=False,
                message="Permission denied: You are not allowed to view this post",
                data={"error_code": "PERMISSION_DENIED_NOT_IN_ALLOWED_GROUPS"},
            )

        return EventResponse(
            success=True,
            message="Post retrieved successfully",
            data=post.to_dict(),
        )

    async def _send_post_notification(
        self, event_name: str, post: FeedPost, source_id: str
    ):
        """Send post-related notifications."""
        notification = Event(
            event_name=event_name,
            destination_id=BROADCAST_AGENT_ID,
            source_id=source_id,
            payload={"post": post.to_dict()},
        )
        await self.send_event(notification)
        logger.info(f"Post notification: {event_name} for post {post.post_id}")
