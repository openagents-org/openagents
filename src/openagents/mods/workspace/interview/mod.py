"""
Network-level interview mod for OpenAgents - Private AI interviews with resume upload.
"""

import logging
import time
import uuid
from typing import Dict, Any, List, Optional
from collections import defaultdict

from openagents.config.globals import BROADCAST_AGENT_ID
from openagents.core.base_mod import BaseMod, mod_event_handler
from openagents.models.event import Event
from openagents.models.event_response import EventResponse

logger = logging.getLogger(__name__)

MAX_COMMENT_DEPTH = 5  # Maximum nesting depth for comments


class InterviewTopic:
    """Interview topic with private resume."""

    def __init__(
        self,
        topic_id: str,
        title: str,
        content: str,
        resume_url: str,
        owner_id: str,
        timestamp: float,
    ):
        self.topic_id = topic_id
        self.title = title
        self.content = content
        self.resume_url = resume_url  # PDF resume URL (required)
        self.owner_id = owner_id
        self.visibility = "private"  # Always private
        self.timestamp = timestamp
        self.comment_count = 0
        self.last_activity = timestamp
        self.comments: Dict[str, "InterviewComment"] = {}
        self.comment_tree: Dict[str, List[str]] = defaultdict(list)
        self.root_comments: List[str] = []

    def to_dict(self, include_comments: bool = False) -> Dict[str, Any]:
        """Convert to dict."""
        result = {
            "topic_id": self.topic_id,
            "title": self.title,
            "content": self.content,
            "resume_url": self.resume_url,
            "owner_id": self.owner_id,
            "visibility": self.visibility,
            "timestamp": self.timestamp,
            "comment_count": self.comment_count,
            "last_activity": self.last_activity,
        }
        if include_comments:
            result["comments"] = self._build_comment_tree()
        return result

    def _build_comment_tree(self) -> List[Dict[str, Any]]:
        """Build nested comment tree."""
        def build_subtree(comment_ids: List[str]) -> List[Dict[str, Any]]:
            subtree = []
            for comment_id in comment_ids:
                if comment_id in self.comments:
                    comment = self.comments[comment_id]
                    if not comment.deleted:  # Skip deleted comments
                        comment_dict = comment.to_dict()
                        if comment_id in self.comment_tree:
                            comment_dict["replies"] = build_subtree(
                                self.comment_tree[comment_id]
                            )
                        else:
                            comment_dict["replies"] = []
                        subtree.append(comment_dict)
            return subtree
        return build_subtree(self.root_comments)


class InterviewComment:
    """Interview comment with depth limit and soft delete."""

    def __init__(
        self,
        comment_id: str,
        topic_id: str,
        content: str,
        author_id: str,
        timestamp: float,
        parent_comment_id: Optional[str] = None,
        depth: int = 0,
    ):
        self.comment_id = comment_id
        self.topic_id = topic_id
        self.content = content
        self.author_id = author_id
        self.timestamp = timestamp
        self.parent_comment_id = parent_comment_id
        self.depth = depth  # Depth in tree (0 = root)
        self.deleted = False  # Soft delete flag

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dict."""
        return {
            "comment_id": self.comment_id,
            "topic_id": self.topic_id,
            "content": self.content if not self.deleted else "[deleted]",
            "author_id": self.author_id,
            "timestamp": self.timestamp,
            "parent_comment_id": self.parent_comment_id,
            "depth": self.depth,
            "deleted": self.deleted,
        }


class InterviewNetworkMod(BaseMod):
    """Network mod for AI interview with private resume access."""

    def __init__(self, mod_name: str = "interview"):
        super().__init__(mod_name=mod_name)
        self.topics: Dict[str, InterviewTopic] = {}

    def _validate_pdf(self, resume_url: str) -> bool:
        """Validate PDF URL/file - basic check for .pdf extension."""
        return resume_url and resume_url.lower().endswith(".pdf")

    def _can_access_topic(self, agent_id: str, topic: InterviewTopic) -> bool:
        """Check if agent can access private topic."""
        # Owner can access
        if agent_id == topic.owner_id:
            return True
        
        # Check agent group via network
        if hasattr(self, "network") and self.network:
            agent_group = self.network.topology.agent_group_membership.get(agent_id)
            # interviewer and admin groups can access
            if agent_group in ("interviewer", "admin"):
                return True
        
        return False

    @mod_event_handler("interview.topic.create")
    async def _create_topic(self, event: Event) -> EventResponse:
        """Create interview topic with PDF resume (required)."""
        payload = event.payload
        title = payload.get("title")
        content = payload.get("content")
        resume_url = payload.get("resume_url")
        
        # Validate required fields
        if not title or not content:
            return EventResponse(
                success=False,
                message="Missing required fields: title and content"
            )
        
        # Require PDF resume
        if not resume_url or not self._validate_pdf(resume_url):
            return EventResponse(
                success=False,
                message="PDF resume is required for interview topics"
            )
        
        # Create topic
        topic_id = str(uuid.uuid4())
        topic = InterviewTopic(
            topic_id=topic_id,
            title=title,
            content=content,
            resume_url=resume_url,
            owner_id=event.source_id,
            timestamp=time.time(),
        )
        
        self.topics[topic_id] = topic
        logger.info(f"Created interview topic {topic_id} by {event.source_id}")
        
        # Broadcast notification
        await self._broadcast_event("interview.topic.created", {
            "topic": topic.to_dict()
        }, event.source_id)
        
        return EventResponse(
            success=True,
            message="Interview topic created successfully",
            data={"topic_id": topic_id, "topic": topic.to_dict()}
        )

    @mod_event_handler("interview.topic.delete")
    async def _delete_topic(self, event: Event) -> EventResponse:
        """Delete interview topic."""
        payload = event.payload
        topic_id = payload.get("topic_id")
        
        if not topic_id or topic_id not in self.topics:
            return EventResponse(
                success=False,
                message="Topic not found"
            )
        
        topic = self.topics[topic_id]
        
        # Check access
        if not self._can_access_topic(event.source_id, topic):
            return EventResponse(
                success=False,
                message="Unauthorized to delete this topic"
            )
        
        # Only owner can delete
        if event.source_id != topic.owner_id:
            return EventResponse(
                success=False,
                message="Only topic owner can delete"
            )
        
        del self.topics[topic_id]
        logger.info(f"Deleted interview topic {topic_id}")
        
        # Broadcast notification
        await self._broadcast_event("interview.topic.deleted", {
            "topic_id": topic_id
        }, event.source_id)
        
        return EventResponse(
            success=True,
            message="Topic deleted successfully",
            data={"topic_id": topic_id}
        )

    @mod_event_handler("interview.comment.create")
    async def _create_comment(self, event: Event) -> EventResponse:
        """Create comment on topic."""
        payload = event.payload
        topic_id = payload.get("topic_id")
        content = payload.get("content")
        parent_comment_id = payload.get("parent_comment_id")
        
        if not topic_id or topic_id not in self.topics:
            return EventResponse(
                success=False,
                message="Topic not found"
            )
        
        topic = self.topics[topic_id]
        
        # Check access
        if not self._can_access_topic(event.source_id, topic):
            return EventResponse(
                success=False,
                message="Unauthorized to access this topic"
            )
        
        if not content:
            return EventResponse(
                success=False,
                message="Content is required"
            )
        
        # Calculate depth
        depth = 0
        if parent_comment_id:
            if parent_comment_id not in topic.comments:
                return EventResponse(
                    success=False,
                    message="Parent comment not found"
                )
            parent = topic.comments[parent_comment_id]
            depth = parent.depth + 1
            
            # Enforce max depth
            if depth >= MAX_COMMENT_DEPTH:
                return EventResponse(
                    success=False,
                    message=f"Maximum comment depth ({MAX_COMMENT_DEPTH}) reached"
                )
        
        # Create comment
        comment_id = str(uuid.uuid4())
        comment = InterviewComment(
            comment_id=comment_id,
            topic_id=topic_id,
            content=content,
            author_id=event.source_id,
            timestamp=time.time(),
            parent_comment_id=parent_comment_id,
            depth=depth,
        )
        
        topic.comments[comment_id] = comment
        topic.comment_count += 1
        topic.last_activity = comment.timestamp
        
        # Update tree structure
        if parent_comment_id:
            topic.comment_tree[parent_comment_id].append(comment_id)
        else:
            topic.root_comments.append(comment_id)
        
        logger.info(f"Created comment {comment_id} on topic {topic_id}")
        
        # Broadcast notification
        event_name = "interview.comment.replied" if parent_comment_id else "interview.comment.created"
        await self._broadcast_event(event_name, {
            "comment": comment.to_dict(),
            "topic_id": topic_id
        }, event.source_id)
        
        return EventResponse(
            success=True,
            message="Comment created successfully",
            data={"comment_id": comment_id, "comment": comment.to_dict()}
        )

    @mod_event_handler("interview.comment.reply")
    async def _reply_comment(self, event: Event) -> EventResponse:
        """Reply to comment (alias for create with parent_comment_id)."""
        return await self._create_comment(event)

    @mod_event_handler("interview.comment.delete")
    async def _delete_comment(self, event: Event) -> EventResponse:
        """Delete comment and all its children recursively."""
        payload = event.payload
        topic_id = payload.get("topic_id")
        comment_id = payload.get("comment_id")
        
        if not topic_id or topic_id not in self.topics:
            return EventResponse(
                success=False,
                message="Topic not found"
            )
        
        topic = self.topics[topic_id]
        
        # Check access
        if not self._can_access_topic(event.source_id, topic):
            return EventResponse(
                success=False,
                message="Unauthorized to access this topic"
            )
        
        if not comment_id or comment_id not in topic.comments:
            return EventResponse(
                success=False,
                message="Comment not found"
            )
        
        comment = topic.comments[comment_id]
        
        # Only author or admin can delete
        agent_group = None
        if hasattr(self, "network") and self.network:
            agent_group = self.network.topology.agent_group_membership.get(event.source_id)
        
        if event.source_id != comment.author_id and agent_group != "admin":
            return EventResponse(
                success=False,
                message="Only comment author or admin can delete"
            )
        
        # Recursive delete all children
        deleted_count = self._recursive_delete_comment(topic, comment_id)
        
        logger.info(f"Deleted comment {comment_id} and {deleted_count-1} children")
        
        # Broadcast notification
        await self._broadcast_event("interview.comment.deleted", {
            "comment_id": comment_id,
            "topic_id": topic_id,
            "deleted_count": deleted_count
        }, event.source_id)
        
        return EventResponse(
            success=True,
            message=f"Comment and {deleted_count-1} replies deleted successfully",
            data={"comment_id": comment_id, "deleted_count": deleted_count}
        )

    def _recursive_delete_comment(self, topic: InterviewTopic, comment_id: str) -> int:
        """Recursively soft-delete comment and all children."""
        if comment_id not in topic.comments:
            return 0
        
        count = 1
        comment = topic.comments[comment_id]
        comment.deleted = True
        topic.comment_count -= 1
        
        # Recursively delete children
        if comment_id in topic.comment_tree:
            for child_id in topic.comment_tree[comment_id]:
                count += self._recursive_delete_comment(topic, child_id)
        
        return count

    @mod_event_handler("interview.topic.list")
    async def _list_topics(self, event: Event) -> EventResponse:
        """List interview topics (only accessible ones)."""
        payload = event.payload
        limit = int(payload.get("limit", 50))
        offset = int(payload.get("offset", 0))
        
        # Filter topics by access
        accessible_topics = [
            topic for topic in self.topics.values()
            if self._can_access_topic(event.source_id, topic)
        ]
        
        # Sort by last activity
        accessible_topics.sort(key=lambda t: t.last_activity, reverse=True)
        
        # Paginate
        total_count = len(accessible_topics)
        paginated_topics = accessible_topics[offset:offset + limit]
        topics_data = [t.to_dict() for t in paginated_topics]
        
        return EventResponse(
            success=True,
            message="Topics retrieved successfully",
            data={
                "topics": topics_data,
                "total_count": total_count,
                "offset": offset,
                "limit": limit,
                "has_more": offset + limit < total_count,
            }
        )

    @mod_event_handler("interview.topic.search")
    async def _search_topics(self, event: Event) -> EventResponse:
        """Search interview topics (only accessible ones)."""
        payload = event.payload
        query = payload.get("query", "").lower()
        limit = int(payload.get("limit", 50))
        offset = int(payload.get("offset", 0))
        
        # Filter and search
        matching_topics = []
        for topic in self.topics.values():
            if self._can_access_topic(event.source_id, topic):
                if query in topic.title.lower() or query in topic.content.lower():
                    matching_topics.append(topic)
        
        # Sort by relevance (last activity for now)
        matching_topics.sort(key=lambda t: t.last_activity, reverse=True)
        
        # Paginate
        total_count = len(matching_topics)
        paginated_topics = matching_topics[offset:offset + limit]
        topics_data = [t.to_dict() for t in paginated_topics]
        
        return EventResponse(
            success=True,
            message="Search completed successfully",
            data={
                "topics": topics_data,
                "query": query,
                "total_count": total_count,
                "offset": offset,
                "limit": limit,
                "has_more": offset + limit < total_count,
            }
        )

    @mod_event_handler("interview.topic.get")
    async def _get_topic(self, event: Event) -> EventResponse:
        """Get single interview topic with comments."""
        payload = event.payload
        topic_id = payload.get("topic_id")
        
        if not topic_id or topic_id not in self.topics:
            return EventResponse(
                success=False,
                message="Topic not found"
            )
        
        topic = self.topics[topic_id]
        
        # Check access
        if not self._can_access_topic(event.source_id, topic):
            return EventResponse(
                success=False,
                message="Unauthorized to access this topic"
            )
        
        return EventResponse(
            success=True,
            message="Topic retrieved successfully",
            data={"topic": topic.to_dict(include_comments=True)}
        )

    @mod_event_handler("interview.topic.list_by_user")
    async def _list_by_user(self, event: Event) -> EventResponse:
        """List topics by specific user (only accessible ones)."""
        payload = event.payload
        user_id = payload.get("user_id", event.source_id)
        limit = int(payload.get("limit", 50))
        offset = int(payload.get("offset", 0))
        
        # Filter by user and access
        user_topics = [
            topic for topic in self.topics.values()
            if topic.owner_id == user_id and self._can_access_topic(event.source_id, topic)
        ]
        
        # Sort by timestamp
        user_topics.sort(key=lambda t: t.timestamp, reverse=True)
        
        # Paginate
        total_count = len(user_topics)
        paginated_topics = user_topics[offset:offset + limit]
        topics_data = [t.to_dict() for t in paginated_topics]
        
        return EventResponse(
            success=True,
            message="User topics retrieved successfully",
            data={
                "topics": topics_data,
                "user_id": user_id,
                "total_count": total_count,
                "offset": offset,
                "limit": limit,
                "has_more": offset + limit < total_count,
            }
        )

    async def _broadcast_event(self, event_name: str, payload: Dict[str, Any], source_id: str):
        """Broadcast notification event."""
        notification = Event(
            event_name=event_name,
            destination_id=BROADCAST_AGENT_ID,
            source_id=source_id,
            payload=payload,
        )
        await self.send_event(notification)
        logger.info(f"Broadcast notification: {event_name}")

