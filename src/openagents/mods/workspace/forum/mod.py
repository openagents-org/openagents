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
import time
import uuid
from typing import Dict, Any, List, Optional, Set
from collections import defaultdict

from openagents.config.globals import BROADCAST_AGENT_ID
from openagents.core.base_mod import BaseMod
from openagents.models.event import Event
from openagents.models.event_response import EventResponse
from .forum_messages import (
    ForumTopicMessage,
    ForumCommentMessage,
    ForumVoteMessage,
    ForumQueryMessage
)

logger = logging.getLogger(__name__)

class ForumTopic:
    """Represents a forum topic."""
    
    def __init__(self, topic_id: str, title: str, content: str, owner_id: str, timestamp: float):
        self.topic_id = topic_id
        self.title = title
        self.content = content
        self.owner_id = owner_id
        self.timestamp = timestamp
        self.upvotes = 0
        self.downvotes = 0
        self.comment_count = 0
        self.last_activity = timestamp
        self.comments: Dict[str, 'ForumComment'] = {}  # comment_id -> ForumComment
        self.comment_tree: Dict[str, List[str]] = defaultdict(list)  # parent_id -> [child_ids]
        self.root_comments: List[str] = []  # Top-level comment IDs
    
    def get_vote_score(self) -> int:
        """Get the net vote score (upvotes - downvotes)."""
        return self.upvotes - self.downvotes
    
    def to_dict(self, include_comments: bool = False) -> Dict[str, Any]:
        """Convert topic to dictionary representation."""
        result = {
            'topic_id': self.topic_id,
            'title': self.title,
            'content': self.content,
            'owner_id': self.owner_id,
            'timestamp': self.timestamp,
            'upvotes': self.upvotes,
            'downvotes': self.downvotes,
            'vote_score': self.get_vote_score(),
            'comment_count': self.comment_count,
            'last_activity': self.last_activity
        }
        
        if include_comments:
            result['comments'] = self._build_comment_tree()
        
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
                        comment_dict['replies'] = build_subtree(self.comment_tree[comment_id])
                    else:
                        comment_dict['replies'] = []
                    subtree.append(comment_dict)
            return subtree
        
        return build_subtree(self.root_comments)

class ForumComment:
    """Represents a forum comment."""
    
    def __init__(self, comment_id: str, topic_id: str, content: str, author_id: str, 
                 timestamp: float, parent_comment_id: Optional[str] = None, thread_level: int = 1):
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
            'comment_id': self.comment_id,
            'topic_id': self.topic_id,
            'content': self.content,
            'author_id': self.author_id,
            'timestamp': self.timestamp,
            'parent_comment_id': self.parent_comment_id,
            'thread_level': self.thread_level,
            'upvotes': self.upvotes,
            'downvotes': self.downvotes,
            'vote_score': self.get_vote_score()
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
        
        # Register event handlers
        self.register_event_handler(self._handle_topic_operations, [
            "forum.topic.create", "forum.topic.edit", "forum.topic.delete"
        ])
        
        self.register_event_handler(self._handle_comment_operations, [
            "forum.comment.post", "forum.comment.reply", "forum.comment.edit", 
            "forum.comment.delete"
        ])
        
        self.register_event_handler(self._handle_voting, [
            "forum.vote.cast", "forum.vote.remove"
        ])
        
        self.register_event_handler(self._handle_queries, [
            "forum.topics.list", "forum.topics.search", "forum.topic.get",
            "forum.popular.topics", "forum.recent.topics",
            "forum.user.topics", "forum.user.comments"
        ])
        
        # Initialize forum state
        self.active_agents: Set[str] = set()
        self.topics: Dict[str, ForumTopic] = {}  # topic_id -> ForumTopic
        self.user_votes: Dict[str, Dict[str, str]] = defaultdict(dict)  # agent_id -> {target_id: vote_type}
        self.topic_order_recent: List[str] = []  # Topic IDs ordered by recency
        self.topic_order_popular: List[str] = []  # Topic IDs ordered by popularity
        
        logger.info(f"Initialized Forum Network Mod: {self.mod_name}")
    
    async def handle_register_agent(self, agent_id: str, metadata: Optional[Dict[str, Any]] = None) -> Optional[EventResponse]:
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
    
    async def _handle_topic_operations(self, event: Event) -> Optional[EventResponse]:
        """Handle topic creation, editing, and deletion."""
        try:
            payload = event.payload
            action = payload.get('action', '')
            
            if action == 'create':
                return await self._create_topic(event)
            elif action == 'edit':
                return await self._edit_topic(event)
            elif action == 'delete':
                return await self._delete_topic(event)
            else:
                return EventResponse(
                    success=False,
                    message=f"Unknown topic action: {action}"
                )
        
        except Exception as e:
            logger.error(f"Error handling topic operation: {e}")
            return EventResponse(
                success=False,
                message=f"Error processing topic operation: {str(e)}"
            )
    
    async def _create_topic(self, event: Event) -> EventResponse:
        """Create a new forum topic."""
        payload = event.payload
        title = payload.get('title', '').strip()
        content = payload.get('content', '').strip()
        owner_id = event.source_id
        
        # Validate input
        if not title:
            return EventResponse(
                success=False,
                message="Topic title cannot be empty"
            )
        
        if not content:
            return EventResponse(
                success=False,
                message="Topic content cannot be empty"
            )
        
        # Create topic
        topic_id = str(uuid.uuid4())
        timestamp = time.time()
        
        topic = ForumTopic(
            topic_id=topic_id,
            title=title,
            content=content,
            owner_id=owner_id,
            timestamp=timestamp
        )
        
        self.topics[topic_id] = topic
        self.topic_order_recent.insert(0, topic_id)  # Add to front for recency
        self._update_popular_order()
        
        logger.info(f"Created topic {topic_id}: '{title}' by {owner_id}")
        
        # Send notification event
        await self._send_topic_notification("forum.topic.created", topic, event.source_id)
        
        return EventResponse(
            success=True,
            message="Topic created successfully",
            data={
                'topic_id': topic_id,
                'title': title,
                'timestamp': timestamp
            }
        )
    
    async def _edit_topic(self, event: Event) -> EventResponse:
        """Edit an existing forum topic."""
        payload = event.payload
        topic_id = payload.get('topic_id')
        title = payload.get('title', '').strip()
        content = payload.get('content', '').strip()
        editor_id = event.source_id
        
        # Validate input
        if not topic_id or topic_id not in self.topics:
            return EventResponse(
                success=False,
                message="Topic not found"
            )
        
        topic = self.topics[topic_id]
        
        # Check ownership
        if topic.owner_id != editor_id:
            return EventResponse(
                success=False,
                message="Only the topic owner can edit this topic"
            )
        
        # Update topic
        if title:
            topic.title = title
        if content:
            topic.content = content
        topic.last_activity = time.time()
        
        logger.info(f"Edited topic {topic_id} by {editor_id}")
        
        # Send notification event
        await self._send_topic_notification("forum.topic.edited", topic, event.source_id)
        
        return EventResponse(
            success=True,
            message="Topic updated successfully",
            data=topic.to_dict()
        )
    
    async def _delete_topic(self, event: Event) -> EventResponse:
        """Delete a forum topic."""
        payload = event.payload
        topic_id = payload.get('topic_id')
        deleter_id = event.source_id
        
        # Validate input
        if not topic_id or topic_id not in self.topics:
            return EventResponse(
                success=False,
                message="Topic not found"
            )
        
        topic = self.topics[topic_id]
        
        # Check ownership
        if topic.owner_id != deleter_id:
            return EventResponse(
                success=False,
                message="Only the topic owner can delete this topic"
            )
        
        # Remove topic and clean up
        del self.topics[topic_id]
        if topic_id in self.topic_order_recent:
            self.topic_order_recent.remove(topic_id)
        if topic_id in self.topic_order_popular:
            self.topic_order_popular.remove(topic_id)
        
        # Clean up votes for this topic and its comments
        for agent_votes in self.user_votes.values():
            # Remove votes for the topic
            if topic_id in agent_votes:
                del agent_votes[topic_id]
            # Remove votes for comments in this topic
            for comment_id in list(agent_votes.keys()):
                if comment_id in topic.comments:
                    del agent_votes[comment_id]
        
        logger.info(f"Deleted topic {topic_id} by {deleter_id}")
        
        # Send notification event
        await self._send_topic_notification("forum.topic.deleted", topic, event.source_id)
        
        return EventResponse(
            success=True,
            message="Topic deleted successfully",
            data={'topic_id': topic_id}
        )
    
    async def _handle_comment_operations(self, event: Event) -> Optional[EventResponse]:
        """Handle comment posting, editing, and deletion."""
        try:
            payload = event.payload
            action = payload.get('action', '')
            
            if action == 'post':
                return await self._post_comment(event)
            elif action == 'reply':
                return await self._reply_comment(event)
            elif action == 'edit':
                return await self._edit_comment(event)
            elif action == 'delete':
                return await self._delete_comment(event)
            else:
                return EventResponse(
                    success=False,
                    message=f"Unknown comment action: {action}"
                )
        
        except Exception as e:
            logger.error(f"Error handling comment operation: {e}")
            return EventResponse(
                success=False,
                message=f"Error processing comment operation: {str(e)}"
            )
    
    async def _post_comment(self, event: Event) -> EventResponse:
        """Post a comment on a topic."""
        payload = event.payload
        topic_id = payload.get('topic_id')
        content = payload.get('content', '').strip()
        author_id = event.source_id
        
        # Validate input
        if not topic_id or topic_id not in self.topics:
            return EventResponse(
                success=False,
                message="Topic not found"
            )
        
        if not content:
            return EventResponse(
                success=False,
                message="Comment content cannot be empty"
            )
        
        topic = self.topics[topic_id]
        comment_id = str(uuid.uuid4())
        timestamp = time.time()
        
        comment = ForumComment(
            comment_id=comment_id,
            topic_id=topic_id,
            content=content,
            author_id=author_id,
            timestamp=timestamp,
            thread_level=1
        )
        
        # Add comment to topic
        topic.comments[comment_id] = comment
        topic.root_comments.append(comment_id)
        topic.comment_count += 1
        topic.last_activity = timestamp
        
        # Update topic ordering
        self._update_topic_activity(topic_id)
        
        logger.info(f"Posted comment {comment_id} on topic {topic_id} by {author_id}")
        
        # Send notifications
        await self._send_comment_notification("forum.comment.posted", comment, topic, event.source_id)
        
        return EventResponse(
            success=True,
            message="Comment posted successfully",
            data=comment.to_dict()
        )
    
    async def _reply_comment(self, event: Event) -> EventResponse:
        """Reply to an existing comment."""
        payload = event.payload
        topic_id = payload.get('topic_id')
        parent_comment_id = payload.get('parent_comment_id')
        content = payload.get('content', '').strip()
        author_id = event.source_id
        
        # Validate input
        if not topic_id or topic_id not in self.topics:
            return EventResponse(
                success=False,
                message="Topic not found"
            )
        
        topic = self.topics[topic_id]
        
        if not parent_comment_id or parent_comment_id not in topic.comments:
            return EventResponse(
                success=False,
                message="Parent comment not found"
            )
        
        if not content:
            return EventResponse(
                success=False,
                message="Reply content cannot be empty"
            )
        
        parent_comment = topic.comments[parent_comment_id]
        
        # Check thread depth limit
        if parent_comment.thread_level >= 5:
            return EventResponse(
                success=False,
                message="Maximum thread depth (5 levels) reached"
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
            thread_level=parent_comment.thread_level + 1
        )
        
        # Add comment to topic
        topic.comments[comment_id] = comment
        topic.comment_tree[parent_comment_id].append(comment_id)
        topic.comment_count += 1
        topic.last_activity = timestamp
        
        # Update topic ordering
        self._update_topic_activity(topic_id)
        
        logger.info(f"Posted reply {comment_id} to comment {parent_comment_id} by {author_id}")
        
        # Send notifications
        await self._send_comment_notification("forum.comment.replied", comment, topic, event.source_id)
        
        return EventResponse(
            success=True,
            message="Reply posted successfully",
            data=comment.to_dict()
        )
    
    async def _edit_comment(self, event: Event) -> EventResponse:
        """Edit an existing comment."""
        payload = event.payload
        topic_id = payload.get('topic_id')
        comment_id = payload.get('comment_id')
        content = payload.get('content', '').strip()
        editor_id = event.source_id
        
        # Validate input
        if not topic_id or topic_id not in self.topics:
            return EventResponse(
                success=False,
                message="Topic not found"
            )
        
        topic = self.topics[topic_id]
        
        if not comment_id or comment_id not in topic.comments:
            return EventResponse(
                success=False,
                message="Comment not found"
            )
        
        comment = topic.comments[comment_id]
        
        # Check ownership
        if comment.author_id != editor_id:
            return EventResponse(
                success=False,
                message="Only the comment author can edit this comment"
            )
        
        if not content:
            return EventResponse(
                success=False,
                message="Comment content cannot be empty"
            )
        
        # Update comment
        comment.content = content
        topic.last_activity = time.time()
        
        logger.info(f"Edited comment {comment_id} by {editor_id}")
        
        # Send notification
        await self._send_comment_notification("forum.comment.edited", comment, topic, event.source_id)
        
        return EventResponse(
            success=True,
            message="Comment updated successfully",
            data=comment.to_dict()
        )
    
    async def _delete_comment(self, event: Event) -> EventResponse:
        """Delete a comment."""
        payload = event.payload
        topic_id = payload.get('topic_id')
        comment_id = payload.get('comment_id')
        deleter_id = event.source_id
        
        # Validate input
        if not topic_id or topic_id not in self.topics:
            return EventResponse(
                success=False,
                message="Topic not found"
            )
        
        topic = self.topics[topic_id]
        
        if not comment_id or comment_id not in topic.comments:
            return EventResponse(
                success=False,
                message="Comment not found"
            )
        
        comment = topic.comments[comment_id]
        
        # Check ownership
        if comment.author_id != deleter_id:
            return EventResponse(
                success=False,
                message="Only the comment author can delete this comment"
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
                    if parent_id in topic.comment_tree and cid in topic.comment_tree[parent_id]:
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
        
        logger.info(f"Deleted comment {comment_id} by {deleter_id}")
        
        # Send notification
        await self._send_comment_notification("forum.comment.deleted", comment, topic, event.source_id)
        
        return EventResponse(
            success=True,
            message="Comment deleted successfully",
            data={'comment_id': comment_id, 'topic_id': topic_id}
        )
    
    async def _handle_voting(self, event: Event) -> Optional[EventResponse]:
        """Handle voting operations."""
        try:
            payload = event.payload
            action = payload.get('action', '')
            
            if action == 'cast':
                return await self._cast_vote(event)
            elif action == 'remove':
                return await self._remove_vote(event)
            else:
                return EventResponse(
                    success=False,
                    message=f"Unknown vote action: {action}"
                )
        
        except Exception as e:
            logger.error(f"Error handling vote operation: {e}")
            return EventResponse(
                success=False,
                message=f"Error processing vote operation: {str(e)}"
            )
    
    async def _cast_vote(self, event: Event) -> EventResponse:
        """Cast a vote on a topic or comment."""
        payload = event.payload
        target_type = payload.get('target_type')  # "topic" or "comment"
        target_id = payload.get('target_id')
        vote_type = payload.get('vote_type')  # "upvote" or "downvote"
        voter_id = event.source_id
        
        # Validate input
        if target_type not in ['topic', 'comment']:
            return EventResponse(
                success=False,
                message="Invalid target type. Must be 'topic' or 'comment'"
            )
        
        if vote_type not in ['upvote', 'downvote']:
            return EventResponse(
                success=False,
                message="Invalid vote type. Must be 'upvote' or 'downvote'"
            )
        
        # Find target
        target_obj = None
        if target_type == 'topic':
            if target_id not in self.topics:
                return EventResponse(
                    success=False,
                    message="Topic not found"
                )
            target_obj = self.topics[target_id]
        else:  # comment
            # Find comment in any topic
            for topic in self.topics.values():
                if target_id in topic.comments:
                    target_obj = topic.comments[target_id]
                    break
            
            if not target_obj:
                return EventResponse(
                    success=False,
                    message="Comment not found"
                )
        
        # Check if user already voted on this target
        existing_vote = self.user_votes[voter_id].get(target_id)
        if existing_vote:
            if existing_vote == vote_type:
                return EventResponse(
                    success=False,
                    message=f"You have already {vote_type}d this {target_type}"
                )
            else:
                # Remove previous vote
                if existing_vote == 'upvote':
                    target_obj.upvotes -= 1
                else:
                    target_obj.downvotes -= 1
        
        # Cast new vote
        if vote_type == 'upvote':
            target_obj.upvotes += 1
        else:
            target_obj.downvotes += 1
        
        self.user_votes[voter_id][target_id] = vote_type
        
        # Update popular ordering if it's a topic
        if target_type == 'topic':
            self._update_popular_order()
        
        logger.info(f"Cast {vote_type} on {target_type} {target_id} by {voter_id}")
        
        return EventResponse(
            success=True,
            message=f"Vote cast successfully",
            data={
                'target_type': target_type,
                'target_id': target_id,
                'vote_type': vote_type,
                'upvotes': target_obj.upvotes,
                'downvotes': target_obj.downvotes,
                'vote_score': target_obj.get_vote_score()
            }
        )
    
    async def _remove_vote(self, event: Event) -> EventResponse:
        """Remove a vote from a topic or comment."""
        payload = event.payload
        target_type = payload.get('target_type')  # "topic" or "comment"
        target_id = payload.get('target_id')
        voter_id = event.source_id
        
        # Check if user has voted on this target
        existing_vote = self.user_votes[voter_id].get(target_id)
        if not existing_vote:
            return EventResponse(
                success=False,
                message=f"You have not voted on this {target_type}"
            )
        
        # Find target
        target_obj = None
        if target_type == 'topic':
            if target_id not in self.topics:
                return EventResponse(
                    success=False,
                    message="Topic not found"
                )
            target_obj = self.topics[target_id]
        else:  # comment
            # Find comment in any topic
            for topic in self.topics.values():
                if target_id in topic.comments:
                    target_obj = topic.comments[target_id]
                    break
            
            if not target_obj:
                return EventResponse(
                    success=False,
                    message="Comment not found"
                )
        
        # Remove vote
        if existing_vote == 'upvote':
            target_obj.upvotes -= 1
        else:
            target_obj.downvotes -= 1
        
        del self.user_votes[voter_id][target_id]
        
        # Update popular ordering if it's a topic
        if target_type == 'topic':
            self._update_popular_order()
        
        logger.info(f"Removed {existing_vote} on {target_type} {target_id} by {voter_id}")
        
        return EventResponse(
            success=True,
            message="Vote removed successfully",
            data={
                'target_type': target_type,
                'target_id': target_id,
                'removed_vote': existing_vote,
                'upvotes': target_obj.upvotes,
                'downvotes': target_obj.downvotes,
                'vote_score': target_obj.get_vote_score()
            }
        )
    
    async def _handle_queries(self, event: Event) -> Optional[EventResponse]:
        """Handle query operations."""
        try:
            payload = event.payload
            query_type = payload.get('query_type', '')
            
            if query_type == 'list_topics':
                return await self._list_topics(event)
            elif query_type == 'search_topics':
                return await self._search_topics(event)
            elif query_type == 'get_topic':
                return await self._get_topic(event)
            elif query_type == 'popular_topics':
                return await self._get_popular_topics(event)
            elif query_type == 'recent_topics':
                return await self._get_recent_topics(event)
            elif query_type == 'user_topics':
                return await self._get_user_topics(event)
            elif query_type == 'user_comments':
                return await self._get_user_comments(event)
            else:
                return EventResponse(
                    success=False,
                    message=f"Unknown query type: {query_type}"
                )
        
        except Exception as e:
            logger.error(f"Error handling query operation: {e}")
            return EventResponse(
                success=False,
                message=f"Error processing query operation: {str(e)}"
            )
    
    async def _list_topics(self, event: Event) -> EventResponse:
        """List topics in the forum."""
        payload = event.payload
        limit = int(payload.get('limit', 50))
        offset = int(payload.get('offset', 0))
        sort_by = payload.get('sort_by', 'recent')
        
        # Get ordered topic list
        if sort_by == 'popular':
            ordered_topics = self.topic_order_popular
        elif sort_by == 'votes':
            # Sort by vote score
            ordered_topics = sorted(
                self.topics.keys(),
                key=lambda tid: self.topics[tid].get_vote_score(),
                reverse=True
            )
        else:  # recent
            ordered_topics = self.topic_order_recent
        
        # Apply pagination
        total_count = len(ordered_topics)
        paginated_topics = ordered_topics[offset:offset + limit]
        
        # Build response
        topics_data = []
        for topic_id in paginated_topics:
            if topic_id in self.topics:
                topics_data.append(self.topics[topic_id].to_dict())
        
        return EventResponse(
            success=True,
            message="Topics retrieved successfully",
            data={
                'topics': topics_data,
                'total_count': total_count,
                'offset': offset,
                'limit': limit,
                'has_more': offset + limit < total_count,
                'sort_by': sort_by
            }
        )
    
    async def _search_topics(self, event: Event) -> EventResponse:
        """Search topics by keywords."""
        payload = event.payload
        search_query = payload.get('query', '').strip().lower()
        limit = int(payload.get('limit', 50))
        offset = int(payload.get('offset', 0))
        
        if not search_query:
            return EventResponse(
                success=False,
                message="Search query cannot be empty"
            )
        
        # Search in titles and content
        matching_topics = []
        for topic in self.topics.values():
            if (search_query in topic.title.lower() or 
                search_query in topic.content.lower()):
                matching_topics.append(topic)
        
        # Sort by relevance (title matches first, then by recency)
        def relevance_score(topic):
            title_match = 2 if search_query in topic.title.lower() else 0
            return title_match + topic.timestamp / 1000000  # Add timestamp for tie-breaking
        
        matching_topics.sort(key=relevance_score, reverse=True)
        
        # Apply pagination
        total_count = len(matching_topics)
        paginated_topics = matching_topics[offset:offset + limit]
        
        topics_data = [topic.to_dict() for topic in paginated_topics]
        
        return EventResponse(
            success=True,
            message="Search completed successfully",
            data={
                'topics': topics_data,
                'total_count': total_count,
                'offset': offset,
                'limit': limit,
                'has_more': offset + limit < total_count,
                'search_query': search_query
            }
        )
    
    async def _get_topic(self, event: Event) -> EventResponse:
        """Get a specific topic with all its comments."""
        payload = event.payload
        topic_id = payload.get('topic_id')
        
        if not topic_id or topic_id not in self.topics:
            return EventResponse(
                success=False,
                message="Topic not found"
            )
        
        topic = self.topics[topic_id]
        
        return EventResponse(
            success=True,
            message="Topic retrieved successfully",
            data=topic.to_dict(include_comments=True)
        )
    
    async def _get_popular_topics(self, event: Event) -> EventResponse:
        """Get popular topics."""
        payload = event.payload
        limit = int(payload.get('limit', 50))
        offset = int(payload.get('offset', 0))
        
        # Use popular ordering
        ordered_topics = self.topic_order_popular
        
        # Apply pagination
        total_count = len(ordered_topics)
        paginated_topics = ordered_topics[offset:offset + limit]
        
        topics_data = []
        for topic_id in paginated_topics:
            if topic_id in self.topics:
                topics_data.append(self.topics[topic_id].to_dict())
        
        return EventResponse(
            success=True,
            message="Popular topics retrieved successfully",
            data={
                'topics': topics_data,
                'total_count': total_count,
                'offset': offset,
                'limit': limit,
                'has_more': offset + limit < total_count
            }
        )
    
    async def _get_recent_topics(self, event: Event) -> EventResponse:
        """Get recent topics."""
        payload = event.payload
        limit = int(payload.get('limit', 50))
        offset = int(payload.get('offset', 0))
        
        # Use recent ordering
        ordered_topics = self.topic_order_recent
        
        # Apply pagination
        total_count = len(ordered_topics)
        paginated_topics = ordered_topics[offset:offset + limit]
        
        topics_data = []
        for topic_id in paginated_topics:
            if topic_id in self.topics:
                topics_data.append(self.topics[topic_id].to_dict())
        
        return EventResponse(
            success=True,
            message="Recent topics retrieved successfully",
            data={
                'topics': topics_data,
                'total_count': total_count,
                'offset': offset,
                'limit': limit,
                'has_more': offset + limit < total_count
            }
        )
    
    async def _get_user_topics(self, event: Event) -> EventResponse:
        """Get topics created by a specific user."""
        payload = event.payload
        agent_id = payload.get('agent_id', event.source_id)
        limit = int(payload.get('limit', 50))
        offset = int(payload.get('offset', 0))
        
        # Find user's topics
        user_topics = []
        for topic in self.topics.values():
            if topic.owner_id == agent_id:
                user_topics.append(topic)
        
        # Sort by recency
        user_topics.sort(key=lambda t: t.timestamp, reverse=True)
        
        # Apply pagination
        total_count = len(user_topics)
        paginated_topics = user_topics[offset:offset + limit]
        
        topics_data = [topic.to_dict() for topic in paginated_topics]
        
        return EventResponse(
            success=True,
            message="User topics retrieved successfully",
            data={
                'topics': topics_data,
                'total_count': total_count,
                'offset': offset,
                'limit': limit,
                'has_more': offset + limit < total_count,
                'agent_id': agent_id
            }
        )
    
    async def _get_user_comments(self, event: Event) -> EventResponse:
        """Get comments made by a specific user."""
        payload = event.payload
        agent_id = payload.get('agent_id', event.source_id)
        limit = int(payload.get('limit', 50))
        offset = int(payload.get('offset', 0))
        
        # Find user's comments across all topics
        user_comments = []
        for topic in self.topics.values():
            for comment in topic.comments.values():
                if comment.author_id == agent_id:
                    comment_data = comment.to_dict()
                    comment_data['topic_title'] = topic.title
                    user_comments.append(comment_data)
        
        # Sort by recency
        user_comments.sort(key=lambda c: c['timestamp'], reverse=True)
        
        # Apply pagination
        total_count = len(user_comments)
        paginated_comments = user_comments[offset:offset + limit]
        
        return EventResponse(
            success=True,
            message="User comments retrieved successfully",
            data={
                'comments': paginated_comments,
                'total_count': total_count,
                'offset': offset,
                'limit': limit,
                'has_more': offset + limit < total_count,
                'agent_id': agent_id
            }
        )
    
    def _update_topic_activity(self, topic_id: str):
        """Update topic activity ordering."""
        # Move to front of recent list
        if topic_id in self.topic_order_recent:
            self.topic_order_recent.remove(topic_id)
        self.topic_order_recent.insert(0, topic_id)
        
        # Update popular ordering
        self._update_popular_order()
    
    def _update_popular_order(self):
        """Update the popular topics ordering based on vote scores and activity."""
        def popularity_score(topic_id):
            if topic_id not in self.topics:
                return 0
            topic = self.topics[topic_id]
            # Combine vote score with recent activity and comment count
            vote_score = topic.get_vote_score()
            activity_bonus = min(topic.last_activity / 1000000, 1000)  # Normalize timestamp
            comment_bonus = topic.comment_count * 0.1
            return vote_score + activity_bonus + comment_bonus
        
        self.topic_order_popular = sorted(
            self.topics.keys(),
            key=popularity_score,
            reverse=True
        )
    
    async def _send_topic_notification(self, event_name: str, topic: ForumTopic, source_id: str):
        """Send topic-related notifications."""
        # For now, we'll just log the notification
        # In a full implementation, this would send events to interested agents
        notification = Event(
            event_name=event_name,
            destination_id=BROADCAST_AGENT_ID,
            source_id=source_id,
            payload={
                "topic": topic.to_dict()
            }
        )
        await self.send_event(notification)
        logger.info(f"Topic notification: {event_name} for topic {topic.topic_id}")
    
    async def _send_comment_notification(self, event_name: str, comment: ForumComment, topic: ForumTopic, source_id: str):
        """Send comment-related notifications."""
        # For now, we'll just log the notification
        # In a full implementation, this would send events to topic owners and parent comment authors
        notification = Event(
            event_name=event_name,
            destination_id=BROADCAST_AGENT_ID,
            source_id=source_id,
            payload={
                "comment": comment.to_dict()
            }
        )
        await self.send_event(notification)
        logger.info(f"Comment notification: {event_name} for comment {comment.comment_id} on topic {topic.topic_id}")

