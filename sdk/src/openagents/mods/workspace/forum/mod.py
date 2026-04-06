"""
Network-level forum mod for OpenAgents.

This standalone mod enables Reddit-like forum functionality with:
- Single forum with multiple topics
- Topic ownership and management
- Nested comment threading (up to 5 levels)
- Voting system for topics and comments
- Search and browsing capabilities
"""

import logging
import json
import time
import uuid
from typing import Dict, Any, List, Optional, Set
from collections import defaultdict
from pathlib import Path

from openagents.config.globals import BROADCAST_AGENT_ID
from openagents.core.base_mod import BaseMod, mod_event_handler
from openagents.models.event import Event
from openagents.models.event_response import EventResponse
from .forum_messages import (
    ForumTopicMessage,
    ForumCommentMessage,
    ForumVoteMessage,
    ForumQueryMessage,
)

logger = logging.getLogger(__name__)


class ForumTopic:
    """Represents a forum topic."""

    def __init__(
        self,
        topic_id: str,
        title: str,
        content: str,
        owner_id: str,
        timestamp: float,
        allowed_groups: Optional[List[str]] = None,
    ):
        self.topic_id = topic_id
        self.title = title
        self.content = content
        self.owner_id = owner_id
        self.timestamp = timestamp
        self.allowed_groups = allowed_groups  # None or [] means visible to all
        self.upvotes = 0
        self.downvotes = 0
        self.comment_count = 0
        self.last_activity = timestamp
        self.comments: Dict[str, "ForumComment"] = {}  # comment_id -> ForumComment
        self.comment_tree: Dict[str, List[str]] = defaultdict(
            list
        )  # parent_id -> [child_ids]
        self.root_comments: List[str] = []  # Top-level comment IDs

    def get_vote_score(self) -> int:
        """Get the net vote score (upvotes - downvotes)."""
        return self.upvotes - self.downvotes

    def to_dict(self, include_comments: bool = False) -> Dict[str, Any]:
        """Convert topic to dictionary representation."""
        result = {
            "topic_id": self.topic_id,
            "title": self.title,
            "content": self.content,
            "owner_id": self.owner_id,
            "allowed_groups": self.allowed_groups,
            "timestamp": self.timestamp,
            "upvotes": self.upvotes,
            "downvotes": self.downvotes,
            "vote_score": self.get_vote_score(),
            "comment_count": self.comment_count,
            "last_activity": self.last_activity,
        }

        if include_comments:
            result["comments"] = self._build_comment_tree()

        return result

    def _build_comment_tree(self) -> List[Dict[str, Any]]:
        """Build nested comment tree structure."""

        def build_subtree(comment_ids: List[str]) -> List[Dict[str, Any]]:
            subtree = []
            for comment_id in comment_ids:
                if comment_id in self.comments:
                    comment = self.comments[comment_id]
                    comment_dict = comment.to_dict()
                    # Add nested replies
                    if comment_id in self.comment_tree:
                        comment_dict["replies"] = build_subtree(
                            self.comment_tree[comment_id]
                        )
                    else:
                        comment_dict["replies"] = []
                    subtree.append(comment_dict)
            return subtree

        return build_subtree(self.root_comments)


class ForumComment:
    """Represents a forum comment."""

    def __init__(
        self,
        comment_id: str,
        topic_id: str,
        content: str,
        author_id: str,
        timestamp: float,
        parent_comment_id: Optional[str] = None,
        thread_level: int = 1,
    ):
        self.comment_id = comment_id
        self.topic_id = topic_id
        self.content = content
        self.author_id = author_id
        self.timestamp = timestamp
        self.parent_comment_id = parent_comment_id
        self.thread_level = thread_level
        self.upvotes = 0
        self.downvotes = 0

    def get_vote_score(self) -> int:
        """Get the net vote score (upvotes - downvotes)."""
        return self.upvotes - self.downvotes

    def to_dict(self) -> Dict[str, Any]:
        """Convert comment to dictionary representation."""
        return {
            "comment_id": self.comment_id,
            "topic_id": self.topic_id,
            "content": self.content,
            "author_id": self.author_id,
            "timestamp": self.timestamp,
            "parent_comment_id": self.parent_comment_id,
            "thread_level": self.thread_level,
            "upvotes": self.upvotes,
            "downvotes": self.downvotes,
            "vote_score": self.get_vote_score(),
        }


class ForumNetworkMod(BaseMod):
    """Network-level forum mod implementation.

    This standalone mod enables:
    - Single forum with multiple topics
    - Topic ownership and management
    - Nested comment threading (up to 5 levels)
    - Voting system for topics and comments
    - Search and browsing capabilities
    """

    def __init__(self, mod_name: str = "forum"):
        """Initialize the forum mod for a network."""
        super().__init__(mod_name=mod_name)

        # Initialize forum state
        self.active_agents: Set[str] = set()

        logger.info(f"Initialized Forum Network Mod: {self.mod_name}")

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

    def _can_agent_view_topic(self, agent_id: str, topic: ForumTopic) -> bool:
        """Check if an agent can view a topic based on allowed_groups.

        Args:
            agent_id: ID of the agent
            topic: The topic to check

        Returns:
            bool: True if agent can view the topic, False otherwise
        """
        # If allowed_groups is None or empty, everyone can view
        if not topic.allowed_groups:
            return True

        # Get agent's groups
        agent_groups = self._get_agent_groups(agent_id)

        # Check if agent is in any of the allowed groups
        return any(group in topic.allowed_groups for group in agent_groups)

    @property
    def topics(self) -> Dict[str, ForumTopic]:
        """Get all topics (loaded from storage)."""
        topics = {}
        metadata = self._get_topics_metadata()
        # Load all topics from storage
        for topic_id in metadata["topics"].keys():
            topic = self._load_topic(topic_id)
            if topic:
                topics[topic_id] = topic
        return topics

    @property
    def user_votes(self) -> Dict[str, Dict[str, str]]:
        """Get all user votes (loaded from storage)."""
        try:
            storage_path = self.get_storage_path()
            votes_file = storage_path / "votes.json"

            if votes_file.exists():
                with open(votes_file, "r") as f:
                    votes_data = json.load(f)
                return defaultdict(dict, votes_data)
            else:
                return defaultdict(dict)
        except Exception as e:
            logger.error(f"Failed to load user votes: {e}")
            return defaultdict(dict)

    @property
    def topic_order_recent(self) -> List[str]:
        """Get recent topic order (loaded from storage)."""
        metadata = self._get_topics_metadata()
        return metadata.get("topic_order_recent", [])

    @property
    def topic_order_popular(self) -> List[str]:
        """Get popular topic order (loaded from storage)."""
        metadata = self._get_topics_metadata()
        return metadata.get("topic_order_popular", [])

    def _load_topic(self, topic_id: str) -> Optional[ForumTopic]:
        """Get a specific topic from storage."""
        try:
            storage_path = self.get_storage_path()
            topics_dir = storage_path / "topics"
            topic_file = topics_dir / f"{topic_id}.json"

            if not topic_file.exists():
                return None

            with open(topic_file, "r") as f:
                topic_dict = json.load(f)
            topic = ForumTopic(
                topic_id=topic_dict["topic_id"],
                title=topic_dict["title"],
                content=topic_dict["content"],
                owner_id=topic_dict["owner_id"],
                timestamp=topic_dict["timestamp"],
                allowed_groups=topic_dict.get("allowed_groups"),
            )

            # Restore additional attributes
            topic.upvotes = topic_dict.get("upvotes", 0)
            topic.downvotes = topic_dict.get("downvotes", 0)
            topic.comment_count = topic_dict.get("comment_count", 0)
            topic.last_activity = topic_dict.get("last_activity", topic.timestamp)

            # Reconstruct comments
            if "comments_data" in topic_dict:
                for comment_id, comment_dict in topic_dict["comments_data"].items():
                    comment = ForumComment(
                        comment_id=comment_dict["comment_id"],
                        topic_id=comment_dict["topic_id"],
                        content=comment_dict["content"],
                        author_id=comment_dict["author_id"],
                        timestamp=comment_dict["timestamp"],
                        parent_comment_id=comment_dict.get("parent_comment_id"),
                        thread_level=comment_dict.get("thread_level", 1),
                    )
                    comment.upvotes = comment_dict.get("upvotes", 0)
                    comment.downvotes = comment_dict.get("downvotes", 0)
                    topic.comments[comment_id] = comment

            # Reconstruct comment tree structure
            if "comment_tree_data" in topic_dict:
                topic.comment_tree = defaultdict(list, topic_dict["comment_tree_data"])
            if "root_comments" in topic_dict:
                topic.root_comments = topic_dict["root_comments"]

            return topic

        except Exception as e:
            logger.error(f"Failed to load topic {topic_id}: {e}")
            return None

    def _get_topics_metadata(self) -> Dict[str, Any]:
        """Get topic metadata (for listing) without loading full topics."""
        try:
            storage_path = self.get_storage_path()

            # Load basic topic info from individual files
            topics_data = {}
            topics_dir = storage_path / "topics"
            if topics_dir.exists():
                for topic_file in topics_dir.glob("*.json"):
                    try:
                        topic_id = topic_file.stem  # filename without extension
                        with open(topic_file, "r") as f:
                            topic_dict = json.load(f)
                        # Extract only metadata, not full content/comments
                        topics_data[topic_id] = {
                            "topic_id": topic_dict["topic_id"],
                            "title": topic_dict["title"],
                            "owner_id": topic_dict["owner_id"],
                            "timestamp": topic_dict["timestamp"],
                            "upvotes": topic_dict.get("upvotes", 0),
                            "downvotes": topic_dict.get("downvotes", 0),
                            "comment_count": topic_dict.get("comment_count", 0),
                            "last_activity": topic_dict.get(
                                "last_activity", topic_dict["timestamp"]
                            ),
                        }
                    except Exception as e:
                        logger.error(
                            f"Failed to load metadata for topic file {topic_file}: {e}"
                        )
                        continue

            # Load ordering metadata
            metadata = {}
            metadata_file = storage_path / "metadata.json"
            if metadata_file.exists():
                with open(metadata_file, "r") as f:
                    metadata = json.load(f)

            return {
                "topics": topics_data,
                "topic_order_recent": metadata.get("topic_order_recent", []),
                "topic_order_popular": metadata.get("topic_order_popular", []),
            }

        except Exception as e:
            logger.error(f"Failed to load topics metadata: {e}")
            return {"topics": {}, "topic_order_recent": [], "topic_order_popular": []}

    def _get_user_votes(self, agent_id: str) -> Dict[str, str]:
        """Get votes for a specific user from storage."""
        try:
            storage_path = self.get_storage_path()
            votes_file = storage_path / "votes.json"

            if not votes_file.exists():
                return {}

            with open(votes_file, "r") as f:
                all_votes = json.load(f)

            return all_votes.get(agent_id, {})

        except Exception as e:
            logger.error(f"Failed to load votes for user {agent_id}: {e}")
            return {}

    def _save_topic(self, topic: ForumTopic):
        """Save a single topic to its own file."""
        try:
            storage_path = self.get_storage_path()
            topics_dir = storage_path / "topics"
            topics_dir.mkdir(parents=True, exist_ok=True)

            topic_file = topics_dir / f"{topic.topic_id}.json"

            # Prepare topic data
            topic_dict = topic.to_dict()
            topic_dict["comments_data"] = {}
            for comment_id, comment in topic.comments.items():
                topic_dict["comments_data"][comment_id] = comment.to_dict()
            topic_dict["comment_tree_data"] = dict(topic.comment_tree)
            topic_dict["root_comments"] = topic.root_comments

            # Save to individual file
            with open(topic_file, "w") as f:
                json.dump(topic_dict, f, indent=2, default=str)

            # Topic saved to individual file

        except Exception as e:
            logger.error(f"Failed to save topic {topic.topic_id}: {e}")

    def _save_user_votes(self, agent_id: str, votes: Dict[str, str]):
        """Save votes for a specific user."""
        try:
            storage_path = self.get_storage_path()
            storage_path.mkdir(parents=True, exist_ok=True)
            votes_file = storage_path / "votes.json"

            # Load existing votes
            all_votes = {}
            if votes_file.exists():
                with open(votes_file, "r") as f:
                    all_votes = json.load(f)

            # Update this user's votes
            all_votes[agent_id] = votes

            # Save back to file
            with open(votes_file, "w") as f:
                json.dump(all_votes, f, indent=2)

        except Exception as e:
            logger.error(f"Failed to save votes for user {agent_id}: {e}")

    def _save_metadata(
        self, topic_order_recent: List[str], topic_order_popular: List[str]
    ):
        """Save topic ordering metadata."""
        try:
            storage_path = self.get_storage_path()
            storage_path.mkdir(parents=True, exist_ok=True)
            metadata_file = storage_path / "metadata.json"

            metadata = {
                "topic_order_recent": topic_order_recent,
                "topic_order_popular": topic_order_popular,
                "last_saved": time.time(),
            }

            with open(metadata_file, "w") as f:
                json.dump(metadata, f, indent=2, default=str)

        except Exception as e:
            logger.error(f"Failed to save metadata: {e}")

    def _get_topic_vote_score(self, topic_id: str) -> int:
        """Get vote score for a topic from storage."""
        metadata = self._get_topics_metadata()
        topic_info = metadata["topics"].get(topic_id, {})
        upvotes = topic_info.get("upvotes", 0)
        downvotes = topic_info.get("downvotes", 0)
        return upvotes - downvotes

    def initialize(self) -> bool:
        """Initialize the mod without loading all data into memory.

        Returns:
            bool: True if initialization was successful, False otherwise
        """
        try:
            # No need to load all data - storage-first approach
            logger.info("Forum mod initialization complete (storage-first mode)")
            return True
        except Exception as e:
            logger.error(f"Forum mod initialization failed: {e}")
            return False

    def shutdown(self) -> bool:
        """Shutdown the mod gracefully.

        Returns:
            bool: True if shutdown was successful, False otherwise
        """
        try:
            # Clear state (data is already in storage)
            self.active_agents.clear()

            logger.info("Forum mod shutdown complete")
            return True
        except Exception as e:
            logger.error(f"Forum mod shutdown failed: {e}")
            return False

    # Old memory-based methods removed - now using storage-first approach

    async def handle_register_agent(
        self, agent_id: str, metadata: Optional[Dict[str, Any]] = None
    ) -> Optional[EventResponse]:
        """Handle agent registration."""
        self.active_agents.add(agent_id)
        logger.info(f"Registered agent {agent_id} with forum mod")
        return None

    async def handle_unregister_agent(self, agent_id: str) -> Optional[EventResponse]:
        """Handle agent unregistration."""
        if agent_id in self.active_agents:
            self.active_agents.remove(agent_id)
        # Clean up user votes
        if agent_id in self.user_votes:
            del self.user_votes[agent_id]
        logger.info(f"Unregistered agent {agent_id} from forum mod")
        return None

    @mod_event_handler("forum.topic.create")
    @mod_event_handler("forum.topic.edit")
    @mod_event_handler("forum.topic.delete")
    async def _handle_topic_operations(self, event: Event) -> Optional[EventResponse]:
        """Handle topic creation, editing, and deletion."""
        try:
            payload = event.payload
            action = payload.get("action", "")

            if action == "create":
                return await self._create_topic(event)
            elif action == "edit":
                return await self._edit_topic(event)
            elif action == "delete":
                return await self._delete_topic(event)
            else:
                return EventResponse(
                    success=False, message=f"Unknown topic action: {action}"
                )

        except Exception as e:
            logger.error(f"Error handling topic operation: {e}")
            return EventResponse(
                success=False, message=f"Error processing topic operation: {str(e)}"
            )

    async def _create_topic(self, event: Event) -> EventResponse:
        """Create a new forum topic."""
        payload = event.payload
        title = payload.get("title", "").strip()
        content = payload.get("content", "").strip()
        allowed_groups = payload.get("allowed_groups")
        owner_id = event.source_id

        # Validate input
        if not title:
            return EventResponse(success=False, message="Topic title cannot be empty")

        if not content:
            return EventResponse(success=False, message="Topic content cannot be empty")

        # Create topic
        topic_id = str(uuid.uuid4())
        timestamp = time.time()

        topic = ForumTopic(
            topic_id=topic_id,
            title=title,
            content=content,
            owner_id=owner_id,
            timestamp=timestamp,
            allowed_groups=allowed_groups,
        )

        # Save the new topic to storage
        self._save_topic(topic)

        # Update topic ordering metadata
        metadata = self._get_topics_metadata()
        topic_order_recent = metadata["topic_order_recent"]
        topic_order_popular = metadata["topic_order_popular"]

        # Add to front for recency
        if topic_id in topic_order_recent:
            topic_order_recent.remove(topic_id)
        topic_order_recent.insert(0, topic_id)

        # Update popular order
        if topic_id not in topic_order_popular:
            topic_order_popular.append(topic_id)
        # Sort by vote score (will be 0 for new topics)
        topic_order_popular.sort(
            key=lambda tid: self._get_topic_vote_score(tid), reverse=True
        )

        # Save metadata
        self._save_metadata(topic_order_recent, topic_order_popular)

        # Topic data now stored in storage

        logger.info(f"Created topic {topic_id}: '{title}' by {owner_id}")

        # Send notification event
        await self._send_topic_notification(
            "forum.topic.created", topic, event.source_id
        )

        return EventResponse(
            success=True,
            message="Topic created successfully",
            data={"topic_id": topic_id, "title": title, "timestamp": timestamp},
        )

    async def _edit_topic(self, event: Event) -> EventResponse:
        """Edit an existing forum topic."""
        payload = event.payload
        topic_id = payload.get("topic_id")
        title = payload.get("title", "").strip()
        content = payload.get("content", "").strip()
        editor_id = event.source_id

        # Validate input
        if not topic_id or topic_id not in self.topics:
            return EventResponse(success=False, message="Topic not found")

        topic = self.topics[topic_id]

        # Check ownership
        if topic.owner_id != editor_id:
            return EventResponse(
                success=False, message="Only the topic owner can edit this topic"
            )

        # Update topic
        if title:
            topic.title = title
        if content:
            topic.content = content
        topic.last_activity = time.time()

        logger.info(f"Edited topic {topic_id} by {editor_id}")

        # Save the updated topic to storage
        self._save_topic(topic)

        # Update metadata (ordering might have changed due to activity update)
        metadata = self._get_topics_metadata()
        self._save_metadata(
            metadata["topic_order_recent"], metadata["topic_order_popular"]
        )

        # Send notification event
        await self._send_topic_notification(
            "forum.topic.edited", topic, event.source_id
        )

        return EventResponse(
            success=True, message="Topic updated successfully", data=topic.to_dict()
        )

    async def _delete_topic(self, event: Event) -> EventResponse:
        """Delete a forum topic."""
        payload = event.payload
        topic_id = payload.get("topic_id")
        deleter_id = event.source_id

        # Validate input
        if not topic_id or topic_id not in self.topics:
            return EventResponse(success=False, message="Topic not found")

        topic = self.topics[topic_id]

        # Check ownership
        if topic.owner_id != deleter_id:
            return EventResponse(
                success=False, message="Only the topic owner can delete this topic"
            )

        # Remove topic file
        storage_path = self.get_storage_path()
        topics_dir = storage_path / "topics"
        topic_file = topics_dir / f"{topic_id}.json"
        if topic_file.exists():
            topic_file.unlink()

        # Update metadata - remove from ordering
        metadata = self._get_topics_metadata()
        topic_order_recent = metadata["topic_order_recent"]
        topic_order_popular = metadata["topic_order_popular"]

        if topic_id in topic_order_recent:
            topic_order_recent.remove(topic_id)
        if topic_id in topic_order_popular:
            topic_order_popular.remove(topic_id)

        # Clean up votes for this topic and its comments
        all_user_votes = self.user_votes
        updated_votes = {}
        for agent_id, agent_votes in all_user_votes.items():
            # Remove votes for the topic and its comments
            filtered_votes = {}
            for vote_target_id, vote_type in agent_votes.items():
                # Keep vote if it's not for this topic or its comments
                if vote_target_id != topic_id and vote_target_id not in topic.comments:
                    filtered_votes[vote_target_id] = vote_type
            if filtered_votes:  # Only save if user has remaining votes
                updated_votes[agent_id] = filtered_votes

        # Save updated votes
        storage_path.mkdir(parents=True, exist_ok=True)
        votes_file = storage_path / "votes.json"
        with open(votes_file, "w") as f:
            json.dump(updated_votes, f, indent=2)

        # Save updated metadata
        self._save_metadata(topic_order_recent, topic_order_popular)

        logger.info(f"Deleted topic {topic_id} by {deleter_id}")

        # Send notification event
        await self._send_topic_notification(
            "forum.topic.deleted", topic, event.source_id
        )

        return EventResponse(
            success=True,
            message="Topic deleted successfully",
            data={"topic_id": topic_id},
        )

    @mod_event_handler("forum.comment.post")
    @mod_event_handler("forum.comment.reply")
    @mod_event_handler("forum.comment.edit")
    @mod_event_handler("forum.comment.delete")
    async def _handle_comment_operations(self, event: Event) -> Optional[EventResponse]:
        """Handle comment posting, editing, and deletion."""
        try:
            payload = event.payload
            action = payload.get("action", "")

            if action == "post":
                return await self._post_comment(event)
            elif action == "reply":
                return await self._reply_comment(event)
            elif action == "edit":
                return await self._edit_comment(event)
            elif action == "delete":
                return await self._delete_comment(event)
            else:
                return EventResponse(
                    success=False, message=f"Unknown comment action: {action}"
                )

        except Exception as e:
            logger.error(f"Error handling comment operation: {e}")
            return EventResponse(
                success=False, message=f"Error processing comment operation: {str(e)}"
            )

    async def _post_comment(self, event: Event) -> EventResponse:
        """Post a comment on a topic."""
        payload = event.payload
        topic_id = payload.get("topic_id")
        content = payload.get("content", "").strip()
        author_id = event.source_id

        # Validate input and load topic from storage
        if not topic_id:
            return EventResponse(success=False, message="Topic ID required")

        if not content:
            return EventResponse(
                success=False, message="Comment content cannot be empty"
            )

        topic = self._load_topic(topic_id)
        if not topic:
            return EventResponse(success=False, message="Topic not found")

        # Check if agent can view the topic
        if not self._can_agent_view_topic(author_id, topic):
            return EventResponse(
                success=False,
                message="Permission denied: You are not allowed to view this topic",
                data={"error_code": "PERMISSION_DENIED_NOT_IN_ALLOWED_GROUPS"},
            )
        comment_id = str(uuid.uuid4())
        timestamp = time.time()

        comment = ForumComment(
            comment_id=comment_id,
            topic_id=topic_id,
            content=content,
            author_id=author_id,
            timestamp=timestamp,
            thread_level=1,
        )

        # Add comment to topic
        topic.comments[comment_id] = comment
        topic.root_comments.append(comment_id)
        topic.comment_count += 1
        topic.last_activity = timestamp

        logger.info(f"Posted comment {comment_id} on topic {topic_id} by {author_id}")

        # Save the updated topic with new comment
        self._save_topic(topic)

        # Update metadata for activity ordering
        metadata = self._get_topics_metadata()
        self._save_metadata(
            metadata["topic_order_recent"], metadata["topic_order_popular"]
        )

        # Send notifications
        await self._send_comment_notification(
            "forum.comment.posted", comment, topic, event.source_id
        )

        return EventResponse(
            success=True, message="Comment posted successfully", data=comment.to_dict()
        )

    async def _reply_comment(self, event: Event) -> EventResponse:
        """Reply to an existing comment."""
        payload = event.payload
        topic_id = payload.get("topic_id")
        parent_comment_id = payload.get("parent_comment_id")
        content = payload.get("content", "").strip()
        author_id = event.source_id

        # Validate input and load topic from storage
        if not topic_id:
            return EventResponse(success=False, message="Topic ID required")

        topic = self._load_topic(topic_id)
        if not topic:
            return EventResponse(success=False, message="Topic not found")

        # Check if agent can view the topic
        if not self._can_agent_view_topic(author_id, topic):
            return EventResponse(
                success=False,
                message="Permission denied: You are not allowed to view this topic",
                data={"error_code": "PERMISSION_DENIED_NOT_IN_ALLOWED_GROUPS"},
            )

        if not parent_comment_id:
            return EventResponse(success=False, message="Parent comment ID required")

        if parent_comment_id not in topic.comments:
            logger.error(
                f"Parent comment {parent_comment_id} not found in topic {topic_id}. Available comments: {list(topic.comments.keys())}"
            )
            return EventResponse(success=False, message="Parent comment not found")

        if not content:
            return EventResponse(success=False, message="Reply content cannot be empty")

        parent_comment = topic.comments[parent_comment_id]

        # Check thread depth limit
        if parent_comment.thread_level >= 5:
            return EventResponse(
                success=False, message="Maximum thread depth (5 levels) reached"
            )

        comment_id = str(uuid.uuid4())
        timestamp = time.time()

        comment = ForumComment(
            comment_id=comment_id,
            topic_id=topic_id,
            content=content,
            author_id=author_id,
            timestamp=timestamp,
            parent_comment_id=parent_comment_id,
            thread_level=parent_comment.thread_level + 1,
        )

        # Add comment to topic
        topic.comments[comment_id] = comment
        topic.comment_tree[parent_comment_id].append(comment_id)
        topic.comment_count += 1
        topic.last_activity = timestamp

        logger.info(
            f"Posted reply {comment_id} to comment {parent_comment_id} by {author_id}"
        )

        # Save the updated topic with new reply
        self._save_topic(topic)

        # Update metadata for activity ordering
        metadata = self._get_topics_metadata()
        self._save_metadata(
            metadata["topic_order_recent"], metadata["topic_order_popular"]
        )

        # Send notifications
        await self._send_comment_notification(
            "forum.comment.replied", comment, topic, event.source_id
        )

        return EventResponse(
            success=True, message="Reply posted successfully", data=comment.to_dict()
        )

    async def _edit_comment(self, event: Event) -> EventResponse:
        """Edit an existing comment."""
        payload = event.payload
        topic_id = payload.get("topic_id")
        comment_id = payload.get("comment_id")
        content = payload.get("content", "").strip()
        editor_id = event.source_id

        # Validate input and load topic from storage
        if not topic_id:
            return EventResponse(success=False, message="Topic ID required")

        topic = self._load_topic(topic_id)
        if not topic:
            return EventResponse(success=False, message="Topic not found")

        if not comment_id or comment_id not in topic.comments:
            return EventResponse(success=False, message="Comment not found")

        comment = topic.comments[comment_id]

        # Check ownership
        if comment.author_id != editor_id:
            return EventResponse(
                success=False, message="Only the comment author can edit this comment"
            )

        if not content:
            return EventResponse(
                success=False, message="Comment content cannot be empty"
            )

        # Update comment
        comment.content = content
        topic.last_activity = time.time()

        # Save the updated topic with edited comment
        self._save_topic(topic)

        logger.info(f"Edited comment {comment_id} by {editor_id}")

        # Send notification
        await self._send_comment_notification(
            "forum.comment.edited", comment, topic, event.source_id
        )

        return EventResponse(
            success=True, message="Comment updated successfully", data=comment.to_dict()
        )

    async def _delete_comment(self, event: Event) -> EventResponse:
        """Delete a comment."""
        payload = event.payload
        topic_id = payload.get("topic_id")
        comment_id = payload.get("comment_id")
        deleter_id = event.source_id

        # Validate input and load topic from storage
        if not topic_id:
            return EventResponse(success=False, message="Topic ID required")

        topic = self._load_topic(topic_id)
        if not topic:
            return EventResponse(success=False, message="Topic not found")

        if not comment_id or comment_id not in topic.comments:
            return EventResponse(success=False, message="Comment not found")

        comment = topic.comments[comment_id]

        # Check ownership
        if comment.author_id != deleter_id:
            return EventResponse(
                success=False, message="Only the comment author can delete this comment"
            )

        # Remove comment and its replies recursively
        def remove_comment_tree(cid: str):
            if cid in topic.comments:
                # Remove all child comments first
                if cid in topic.comment_tree:
                    for child_id in topic.comment_tree[cid]:
                        remove_comment_tree(child_id)
                    del topic.comment_tree[cid]

                # Remove from parent's children list
                if topic.comments[cid].parent_comment_id:
                    parent_id = topic.comments[cid].parent_comment_id
                    if (
                        parent_id in topic.comment_tree
                        and cid in topic.comment_tree[parent_id]
                    ):
                        topic.comment_tree[parent_id].remove(cid)
                else:
                    # Remove from root comments
                    if cid in topic.root_comments:
                        topic.root_comments.remove(cid)

                # Clean up votes for this comment
                for agent_votes in self.user_votes.values():
                    if cid in agent_votes:
                        del agent_votes[cid]

                # Remove the comment
                del topic.comments[cid]
                topic.comment_count -= 1

        remove_comment_tree(comment_id)
        topic.last_activity = time.time()

        # Save the updated topic after comment deletion
        self._save_topic(topic)

        # Clean up votes (already done in remove_comment_tree but save updated votes)
        updated_votes = {}
        for agent_id, agent_votes in self.user_votes.items():
            if agent_votes:  # Only include agents that still have votes
                updated_votes[agent_id] = agent_votes

        storage_path = self.get_storage_path()
        storage_path.mkdir(parents=True, exist_ok=True)
        votes_file = storage_path / "votes.json"
        with open(votes_file, "w") as f:
            json.dump(updated_votes, f, indent=2)

        logger.info(f"Deleted comment {comment_id} by {deleter_id}")

        # Send notification
        await self._send_comment_notification(
            "forum.comment.deleted", comment, topic, event.source_id
        )

        return EventResponse(
            success=True,
            message="Comment deleted successfully",
            data={"comment_id": comment_id, "topic_id": topic_id},
        )

    @mod_event_handler("forum.vote.cast")
    @mod_event_handler("forum.vote.remove")
    async def _handle_voting(self, event: Event) -> Optional[EventResponse]:
        """Handle voting operations."""
        try:
            payload = event.payload
            action = payload.get("action", "")

            if action == "cast":
                return await self._cast_vote(event)
            elif action == "remove":
                return await self._remove_vote(event)
            else:
                return EventResponse(
                    success=False, message=f"Unknown vote action: {action}"
                )

        except Exception as e:
            logger.error(f"Error handling vote operation: {e}")
            return EventResponse(
                success=False, message=f"Error processing vote operation: {str(e)}"
            )

    async def _cast_vote(self, event: Event) -> EventResponse:
        """Cast a vote on a topic or comment."""
        payload = event.payload
        target_type = payload.get("target_type")  # "topic" or "comment"
        target_id = payload.get("target_id")
        vote_type = payload.get("vote_type")  # "upvote" or "downvote"
        voter_id = event.source_id

        # Validate input
        if target_type not in ["topic", "comment"]:
            return EventResponse(
                success=False,
                message="Invalid target type. Must be 'topic' or 'comment'",
            )

        if vote_type not in ["upvote", "downvote"]:
            return EventResponse(
                success=False,
                message="Invalid vote type. Must be 'upvote' or 'downvote'",
            )

        # Find target
        target_obj = None
        containing_topic = None  # Track which topic contains a comment
        if target_type == "topic":
            target_obj = self._load_topic(target_id)
            if not target_obj:
                return EventResponse(success=False, message="Topic not found")
            # Check if agent can view the topic
            if not self._can_agent_view_topic(voter_id, target_obj):
                return EventResponse(
                    success=False,
                    message="Permission denied: You are not allowed to view this topic",
                    data={"error_code": "PERMISSION_DENIED_NOT_IN_ALLOWED_GROUPS"},
                )
        else:  # comment
            # Find comment in any topic - need to search through all topics
            for topic_id in self._get_topics_metadata()["topics"].keys():
                topic = self._load_topic(topic_id)
                if topic and target_id in topic.comments:
                    target_obj = topic.comments[target_id]
                    containing_topic = (
                        topic  # Save reference to the topic containing this comment
                    )
                    break

            if not target_obj:
                return EventResponse(success=False, message="Comment not found")

            # Check if agent can view the topic containing this comment
            if containing_topic and not self._can_agent_view_topic(voter_id, containing_topic):
                return EventResponse(
                    success=False,
                    message="Permission denied: You are not allowed to view this topic",
                    data={"error_code": "PERMISSION_DENIED_NOT_IN_ALLOWED_GROUPS"},
                )

        # Check if user already voted on this target - get fresh vote data each time
        user_vote_data = self._get_user_votes(voter_id)
        existing_vote = user_vote_data.get(target_id)
        if existing_vote:
            if existing_vote == vote_type:
                return EventResponse(
                    success=False,
                    message=f"You have already {vote_type}d this {target_type}",
                )
            else:
                # Remove previous vote
                if existing_vote == "upvote":
                    target_obj.upvotes -= 1
                else:
                    target_obj.downvotes -= 1

        # Cast new vote
        if vote_type == "upvote":
            target_obj.upvotes += 1
        else:
            target_obj.downvotes += 1

        # Update user votes and save
        user_vote_data[target_id] = vote_type

        # Save the updated topic with new vote counts
        if target_type == "topic":
            self._save_topic(target_obj)
        else:
            # For comments, we need to save the topic that contains the comment
            # Use the containing_topic that we already found during comment lookup
            if containing_topic:
                self._save_topic(containing_topic)
            else:
                logger.error(
                    f"Could not find topic containing comment {target_id} for vote save"
                )

        # Save updated user votes
        self._save_user_votes(voter_id, user_vote_data)

        # Update metadata if it's a topic vote (affects popular ordering)
        if target_type == "topic":
            metadata = self._get_topics_metadata()
            # Re-sort popular order based on new vote scores
            topic_order_popular = sorted(
                metadata["topics"].keys(),
                key=lambda tid: metadata["topics"][tid].get("upvotes", 0)
                - metadata["topics"][tid].get("downvotes", 0),
                reverse=True,
            )
            self._save_metadata(metadata["topic_order_recent"], topic_order_popular)

        logger.info(f"Cast {vote_type} on {target_type} {target_id} by {voter_id}")

        await self.send_event(
            Event(
                event_name="forum.vote.notification",
                source_id=voter_id,
                destination_id=BROADCAST_AGENT_ID,
                payload={
                    "target_type": target_type,
                    "target_id": target_id,
                    "vote_type": vote_type,
                    "upvotes": target_obj.upvotes,
                    "downvotes": target_obj.downvotes,
                    "vote_score": target_obj.get_vote_score(),
                },
            )
        )

        return EventResponse(
            success=True,
            message=f"Vote cast successfully",
            data={
                "target_type": target_type,
                "target_id": target_id,
                "vote_type": vote_type,
                "upvotes": target_obj.upvotes,
                "downvotes": target_obj.downvotes,
                "vote_score": target_obj.get_vote_score(),
            },
        )

    async def _remove_vote(self, event: Event) -> EventResponse:
        """Remove a vote from a topic or comment."""
        payload = event.payload
        target_type = payload.get("target_type")  # "topic" or "comment"
        target_id = payload.get("target_id")
        voter_id = event.source_id

        # Check if user has voted on this target - get fresh vote data each time
        user_vote_data = self._get_user_votes(voter_id)
        existing_vote = user_vote_data.get(target_id)
        if not existing_vote:
            return EventResponse(
                success=False, message=f"You have not voted on this {target_type}"
            )

        # Find target
        target_obj = None
        if target_type == "topic":
            target_obj = self._load_topic(target_id)
            if not target_obj:
                return EventResponse(success=False, message="Topic not found")
        else:  # comment
            # Find comment in any topic - need to search through all topics
            for topic_id in self._get_topics_metadata()["topics"].keys():
                topic = self._load_topic(topic_id)
                if topic and target_id in topic.comments:
                    target_obj = topic.comments[target_id]
                    break

            if not target_obj:
                return EventResponse(success=False, message="Comment not found")

        # Remove vote
        if existing_vote == "upvote":
            target_obj.upvotes -= 1
        else:
            target_obj.downvotes -= 1

        del user_vote_data[target_id]

        # Save updated user votes
        self._save_user_votes(voter_id, user_vote_data)

        # Update metadata if it's a topic vote (affects popular ordering)
        if target_type == "topic":
            metadata = self._get_topics_metadata()
            # Re-sort popular order based on new vote scores
            topic_order_popular = sorted(
                metadata["topics"].keys(),
                key=lambda tid: metadata["topics"][tid].get("upvotes", 0)
                - metadata["topics"][tid].get("downvotes", 0),
                reverse=True,
            )
            self._save_metadata(metadata["topic_order_recent"], topic_order_popular)

        logger.info(
            f"Removed {existing_vote} on {target_type} {target_id} by {voter_id}"
        )

        return EventResponse(
            success=True,
            message="Vote removed successfully",
            data={
                "target_type": target_type,
                "target_id": target_id,
                "removed_vote": existing_vote,
                "upvotes": target_obj.upvotes,
                "downvotes": target_obj.downvotes,
                "vote_score": target_obj.get_vote_score(),
            },
        )

    @mod_event_handler("forum.topics.list")
    @mod_event_handler("forum.topics.search")
    @mod_event_handler("forum.topic.get")
    @mod_event_handler("forum.popular.topics")
    @mod_event_handler("forum.recent.topics")
    @mod_event_handler("forum.user.topics")
    @mod_event_handler("forum.user.comments")
    async def _handle_queries(self, event: Event) -> Optional[EventResponse]:
        """Handle query operations."""
        try:
            payload = event.payload
            query_type = payload.get("query_type", "")

            if query_type == "list_topics":
                return await self._list_topics(event)
            elif query_type == "search_topics":
                return await self._search_topics(event)
            elif query_type == "get_topic":
                return await self._get_topic(event)
            elif query_type == "popular_topics":
                return await self._get_popular_topics(event)
            elif query_type == "recent_topics":
                return await self._get_recent_topics(event)
            elif query_type == "user_topics":
                return await self._get_user_topics(event)
            elif query_type == "user_comments":
                return await self._get_user_comments(event)
            else:
                return EventResponse(
                    success=False, message=f"Unknown query type: {query_type}"
                )

        except Exception as e:
            logger.error(f"Error handling query operation: {e}")
            return EventResponse(
                success=False, message=f"Error processing query operation: {str(e)}"
            )

    async def _list_topics(self, event: Event) -> EventResponse:
        """List topics in the forum."""
        payload = event.payload
        limit = int(payload.get("limit", 50))
        offset = int(payload.get("offset", 0))
        sort_by = payload.get("sort_by", "recent")
        requester_id = event.source_id

        # Get ordered topic list
        if sort_by == "popular":
            ordered_topics = self.topic_order_popular
        elif sort_by == "votes":
            # Sort by vote score
            ordered_topics = sorted(
                self.topics.keys(),
                key=lambda tid: self.topics[tid].get_vote_score(),
                reverse=True,
            )
        else:  # recent
            ordered_topics = self.topic_order_recent

        # Filter topics by permission
        viewable_topics = []
        for topic_id in ordered_topics:
            if topic_id in self.topics:
                topic = self.topics[topic_id]
                if self._can_agent_view_topic(requester_id, topic):
                    viewable_topics.append(topic_id)

        # Apply pagination on filtered topics
        total_count = len(viewable_topics)
        paginated_topics = viewable_topics[offset : offset + limit]

        # Build response
        topics_data = []
        for topic_id in paginated_topics:
            if topic_id in self.topics:
                topics_data.append(self.topics[topic_id].to_dict())

        return EventResponse(
            success=True,
            message="Topics retrieved successfully",
            data={
                "topics": topics_data,
                "total_count": total_count,
                "offset": offset,
                "limit": limit,
                "has_more": offset + limit < total_count,
                "sort_by": sort_by,
            },
        )

    async def _search_topics(self, event: Event) -> EventResponse:
        """Search topics by keywords."""
        payload = event.payload
        search_query = payload.get("query", "").strip().lower()
        limit = int(payload.get("limit", 50))
        offset = int(payload.get("offset", 0))
        requester_id = event.source_id

        if not search_query:
            return EventResponse(success=False, message="Search query cannot be empty")

        # Search in titles and content (only viewable topics)
        matching_topics = []
        for topic in self.topics.values():
            if self._can_agent_view_topic(requester_id, topic):
                if (
                    search_query in topic.title.lower()
                    or search_query in topic.content.lower()
                ):
                    matching_topics.append(topic)

        # Sort by relevance (title matches first, then by recency)
        def relevance_score(topic):
            title_match = 2 if search_query in topic.title.lower() else 0
            return (
                title_match + topic.timestamp / 1000000
            )  # Add timestamp for tie-breaking

        matching_topics.sort(key=relevance_score, reverse=True)

        # Apply pagination
        total_count = len(matching_topics)
        paginated_topics = matching_topics[offset : offset + limit]

        topics_data = [topic.to_dict() for topic in paginated_topics]

        return EventResponse(
            success=True,
            message="Search completed successfully",
            data={
                "topics": topics_data,
                "total_count": total_count,
                "offset": offset,
                "limit": limit,
                "has_more": offset + limit < total_count,
                "search_query": search_query,
            },
        )

    async def _get_topic(self, event: Event) -> EventResponse:
        """Get a specific topic with all its comments."""
        payload = event.payload
        topic_id = payload.get("topic_id")
        requester_id = event.source_id

        if not topic_id or topic_id not in self.topics:
            return EventResponse(success=False, message="Topic not found")

        topic = self.topics[topic_id]

        # Check if agent can view the topic
        if not self._can_agent_view_topic(requester_id, topic):
            return EventResponse(
                success=False,
                message="Permission denied: You are not allowed to view this topic",
                data={"error_code": "PERMISSION_DENIED_NOT_IN_ALLOWED_GROUPS"},
            )

        return EventResponse(
            success=True,
            message="Topic retrieved successfully",
            data=topic.to_dict(include_comments=True),
        )

    async def _get_popular_topics(self, event: Event) -> EventResponse:
        """Get popular topics."""
        payload = event.payload
        limit = int(payload.get("limit", 50))
        offset = int(payload.get("offset", 0))
        requester_id = event.source_id

        # Use popular ordering
        ordered_topics = self.topic_order_popular

        # Filter topics by permission
        viewable_topics = []
        for topic_id in ordered_topics:
            if topic_id in self.topics:
                topic = self.topics[topic_id]
                if self._can_agent_view_topic(requester_id, topic):
                    viewable_topics.append(topic_id)

        # Apply pagination on filtered topics
        total_count = len(viewable_topics)
        paginated_topics = viewable_topics[offset : offset + limit]

        topics_data = []
        for topic_id in paginated_topics:
            if topic_id in self.topics:
                topics_data.append(self.topics[topic_id].to_dict())

        return EventResponse(
            success=True,
            message="Popular topics retrieved successfully",
            data={
                "topics": topics_data,
                "total_count": total_count,
                "offset": offset,
                "limit": limit,
                "has_more": offset + limit < total_count,
            },
        )

    async def _get_recent_topics(self, event: Event) -> EventResponse:
        """Get recent topics."""
        payload = event.payload
        limit = int(payload.get("limit", 50))
        offset = int(payload.get("offset", 0))
        requester_id = event.source_id

        # Use recent ordering
        ordered_topics = self.topic_order_recent

        # Filter topics by permission
        viewable_topics = []
        for topic_id in ordered_topics:
            if topic_id in self.topics:
                topic = self.topics[topic_id]
                if self._can_agent_view_topic(requester_id, topic):
                    viewable_topics.append(topic_id)

        # Apply pagination on filtered topics
        total_count = len(viewable_topics)
        paginated_topics = viewable_topics[offset : offset + limit]

        topics_data = []
        for topic_id in paginated_topics:
            if topic_id in self.topics:
                topics_data.append(self.topics[topic_id].to_dict())

        return EventResponse(
            success=True,
            message="Recent topics retrieved successfully",
            data={
                "topics": topics_data,
                "total_count": total_count,
                "offset": offset,
                "limit": limit,
                "has_more": offset + limit < total_count,
            },
        )

    async def _get_user_topics(self, event: Event) -> EventResponse:
        """Get topics created by a specific user."""
        payload = event.payload
        agent_id = payload.get("agent_id", event.source_id)
        limit = int(payload.get("limit", 50))
        offset = int(payload.get("offset", 0))
        requester_id = event.source_id

        # Find user's topics (only viewable ones)
        user_topics = []
        for topic in self.topics.values():
            if topic.owner_id == agent_id and self._can_agent_view_topic(requester_id, topic):
                user_topics.append(topic)

        # Sort by recency
        user_topics.sort(key=lambda t: t.timestamp, reverse=True)

        # Apply pagination
        total_count = len(user_topics)
        paginated_topics = user_topics[offset : offset + limit]

        topics_data = [topic.to_dict() for topic in paginated_topics]

        return EventResponse(
            success=True,
            message="User topics retrieved successfully",
            data={
                "topics": topics_data,
                "total_count": total_count,
                "offset": offset,
                "limit": limit,
                "has_more": offset + limit < total_count,
                "agent_id": agent_id,
            },
        )

    async def _get_user_comments(self, event: Event) -> EventResponse:
        """Get comments made by a specific user."""
        payload = event.payload
        agent_id = payload.get("agent_id", event.source_id)
        limit = int(payload.get("limit", 50))
        offset = int(payload.get("offset", 0))
        requester_id = event.source_id

        # Find user's comments across all topics (only from viewable topics)
        user_comments = []
        for topic in self.topics.values():
            if self._can_agent_view_topic(requester_id, topic):
                for comment in topic.comments.values():
                    if comment.author_id == agent_id:
                        comment_data = comment.to_dict()
                        comment_data["topic_title"] = topic.title
                        user_comments.append(comment_data)

        # Sort by recency
        user_comments.sort(key=lambda c: c["timestamp"], reverse=True)

        # Apply pagination
        total_count = len(user_comments)
        paginated_comments = user_comments[offset : offset + limit]

        return EventResponse(
            success=True,
            message="User comments retrieved successfully",
            data={
                "comments": paginated_comments,
                "total_count": total_count,
                "offset": offset,
                "limit": limit,
                "has_more": offset + limit < total_count,
                "agent_id": agent_id,
            },
        )

    def _update_topic_activity(self, topic_id: str):
        """Update topic activity ordering in metadata."""
        metadata = self._get_topics_metadata()
        topic_order_recent = metadata["topic_order_recent"]
        topic_order_popular = metadata["topic_order_popular"]

        # Move to front of recent list
        if topic_id in topic_order_recent:
            topic_order_recent.remove(topic_id)
        topic_order_recent.insert(0, topic_id)

        # Update popular ordering based on current vote scores
        topic_order_popular = sorted(
            metadata["topics"].keys(),
            key=lambda tid: self._get_topic_popularity_score(metadata["topics"][tid]),
            reverse=True,
        )

        # Save updated metadata
        self._save_metadata(topic_order_recent, topic_order_popular)

    def _get_topic_popularity_score(self, topic_metadata: Dict[str, Any]) -> float:
        """Calculate popularity score for a topic based on metadata."""
        vote_score = topic_metadata.get("upvotes", 0) - topic_metadata.get(
            "downvotes", 0
        )
        activity_bonus = min(
            topic_metadata.get("last_activity", 0) / 1000000, 1000
        )  # Normalize timestamp
        comment_bonus = topic_metadata.get("comment_count", 0) * 0.1
        return vote_score + activity_bonus + comment_bonus

    async def _send_topic_notification(
        self, event_name: str, topic: ForumTopic, source_id: str
    ):
        """Send topic-related notifications."""
        # For now, we'll just log the notification
        # In a full implementation, this would send events to interested agents
        notification = Event(
            event_name=event_name,
            destination_id=BROADCAST_AGENT_ID,
            source_id=source_id,
            payload={"topic": topic.to_dict()},
        )
        await self.send_event(notification)
        logger.info(f"Topic notification: {event_name} for topic {topic.topic_id}")

    async def _send_comment_notification(
        self, event_name: str, comment: ForumComment, topic: ForumTopic, source_id: str
    ):
        """Send comment-related notifications."""
        # For now, we'll just log the notification
        # In a full implementation, this would send events to topic owners and parent comment authors
        notification = Event(
            event_name=event_name,
            destination_id=BROADCAST_AGENT_ID,
            source_id=source_id,
            payload={"comment": comment.to_dict()},
        )
        await self.send_event(notification)
        logger.info(
            f"Comment notification: {event_name} for comment {comment.comment_id} on topic {topic.topic_id}"
        )
