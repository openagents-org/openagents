"""Forum message event models."""

from typing import Optional, Dict, Any, List
from pydantic import BaseModel
from openagents.models.event import Event


class ForumTopicMessage(Event):
    """Message for forum topic operations (create, edit, delete)."""

    def __init__(
        self,
        source_id: str,
        action: str = "create",
        title: Optional[str] = None,
        content: Optional[str] = None,
        topic_id: Optional[str] = None,
        allowed_groups: Optional[List[str]] = None,
        **kwargs,
    ):
        # Build event name based on action
        event_name = f"forum.topic.{action}"

        # Build payload
        payload = {
            "action": action,
        }
        if title is not None:
            payload["title"] = title
        if content is not None:
            payload["content"] = content
        if topic_id is not None:
            payload["topic_id"] = topic_id
        if allowed_groups is not None:
            payload["allowed_groups"] = allowed_groups

        # Initialize parent Event
        super().__init__(
            event_name=event_name, source_id=source_id, payload=payload, **kwargs
        )

        # Store values as custom attributes (avoid conflicts with Event properties)
        self._title = title
        self._content = content
        self._action = action
        self._topic_id = topic_id
        self._allowed_groups = allowed_groups

    @property
    def title(self) -> Optional[str]:
        return self._title

    @property
    def topic_content(self) -> Optional[str]:
        return self._content

    @property
    def action(self) -> str:
        return self._action

    @property
    def topic_id(self) -> Optional[str]:
        return self._topic_id

    @property
    def allowed_groups(self) -> Optional[List[str]]:
        return self._allowed_groups


class ForumCommentMessage(Event):
    """Message for forum comment operations (post, edit, delete)."""

    def __init__(
        self,
        source_id: str,
        topic_id: str,
        action: str = "post",
        content: Optional[str] = None,
        comment_id: Optional[str] = None,
        parent_comment_id: Optional[str] = None,
        **kwargs,
    ):
        # Build event name based on action
        event_name = f"forum.comment.{action}"

        # Build payload
        payload = {
            "action": action,
            "topic_id": topic_id,
        }
        if content is not None:
            payload["content"] = content
        if comment_id is not None:
            payload["comment_id"] = comment_id
        if parent_comment_id is not None:
            payload["parent_comment_id"] = parent_comment_id

        # Initialize parent Event
        super().__init__(
            event_name=event_name, source_id=source_id, payload=payload, **kwargs
        )

        # Store values as custom attributes (avoid conflicts with Event properties)
        self._content = content
        self._action = action
        self._topic_id = topic_id
        self._comment_id = comment_id
        self._parent_comment_id = parent_comment_id

    @property
    def comment_content(self) -> Optional[str]:
        return self._content

    @property
    def action(self) -> str:
        return self._action

    @property
    def topic_id(self) -> str:
        return self._topic_id

    @property
    def comment_id(self) -> Optional[str]:
        return self._comment_id

    @property
    def parent_comment_id(self) -> Optional[str]:
        return self._parent_comment_id


class ForumVoteMessage(Event):
    """Message for forum voting operations."""

    def __init__(
        self,
        source_id: str,
        target_type: str,
        target_id: str,
        vote_type: str = "upvote",
        action: str = "cast",
        **kwargs,
    ):
        # Build event name based on action
        event_name = f"forum.vote.{action}"

        # Build payload
        payload = {
            "action": action,
            "vote_type": vote_type,
            "target_type": target_type,
            "target_id": target_id,
        }

        # Initialize parent Event
        super().__init__(
            event_name=event_name, source_id=source_id, payload=payload, **kwargs
        )

        # Store values as custom attributes (avoid conflicts with Event properties)
        self._action = action
        self._vote_type = vote_type
        self._target_type = target_type
        self._vote_target_id = target_id

    @property
    def action(self) -> str:
        return self._action

    @property
    def vote_type(self) -> str:
        return self._vote_type

    @property
    def target_type(self) -> str:
        return self._target_type

    @property
    def vote_target_id(self) -> str:
        return self._vote_target_id


class ForumQueryMessage(Event):
    """Message for forum query operations (list, search, get)."""

    def __init__(
        self,
        source_id: str,
        query_type: str = "list",
        query: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
        sort_by: str = "recent",
        topic_id: Optional[str] = None,
        **kwargs,
    ):
        # Build event name based on query type
        if query_type in ["list", "list_topics"]:
            event_name = "forum.topics.list"
            normalized_query_type = "list_topics"
        elif query_type in ["search", "search_topics"]:
            event_name = "forum.topics.search"
            normalized_query_type = "search_topics"
        elif query_type in ["get", "get_topic"]:
            event_name = "forum.topic.get"
            normalized_query_type = "get_topic"
        elif query_type == "popular_topics":
            event_name = "forum.popular.topics"
            normalized_query_type = "popular_topics"
        elif query_type == "recent_topics":
            event_name = "forum.recent.topics"
            normalized_query_type = "recent_topics"
        elif query_type == "user_topics":
            event_name = "forum.user.topics"
            normalized_query_type = "user_topics"
        elif query_type == "user_comments":
            event_name = "forum.user.comments"
            normalized_query_type = "user_comments"
        else:
            event_name = f"forum.{query_type}"
            normalized_query_type = query_type

        # Build payload
        payload = {
            "query_type": normalized_query_type,
            "limit": limit,
            "offset": offset,
            "sort_by": sort_by,
        }
        if query is not None:
            payload["query"] = query
        if topic_id is not None:
            payload["topic_id"] = topic_id

        # Initialize parent Event
        super().__init__(
            event_name=event_name, source_id=source_id, payload=payload, **kwargs
        )

        # Store values as custom attributes
        self._query_type = query_type
        self._query = query
        self._limit = limit
        self._offset = offset
        self._sort_by = sort_by
        self._topic_id = topic_id

    @property
    def query_type(self) -> str:
        return self._query_type

    @property
    def query(self) -> Optional[str]:
        return self._query

    @property
    def limit(self) -> int:
        return self._limit

    @property
    def offset(self) -> int:
        return self._offset

    @property
    def sort_by(self) -> str:
        return self._sort_by

    @property
    def topic_id(self) -> Optional[str]:
        return self._topic_id
