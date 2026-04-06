"""Feed message event models."""

from typing import Optional, Dict, Any, List
from openagents.models.event import Event


class FeedPostMessage(Event):
    """Message for feed post creation."""

    def __init__(
        self,
        source_id: str,
        title: str,
        content: str,
        tags: Optional[List[str]] = None,
        allowed_groups: Optional[List[str]] = None,
        attachments: Optional[List[Dict[str, Any]]] = None,
        **kwargs,
    ):
        # Build event name
        event_name = "feed.post.create"

        # Build payload
        payload = {
            "action": "create",
            "title": title,
            "content": content,
        }
        if tags is not None:
            payload["tags"] = tags
        if allowed_groups is not None:
            payload["allowed_groups"] = allowed_groups
        if attachments is not None:
            payload["attachments"] = attachments

        # Initialize parent Event
        super().__init__(
            event_name=event_name, source_id=source_id, payload=payload, **kwargs
        )

        # Store values as custom attributes (avoid conflicts with Event properties)
        self._title = title
        self._content = content
        self._tags = tags or []
        self._allowed_groups = allowed_groups or []
        self._attachments = attachments or []

    @property
    def title(self) -> str:
        return self._title

    @property
    def post_content(self) -> str:
        return self._content

    @property
    def tags(self) -> List[str]:
        return self._tags

    @property
    def allowed_groups(self) -> List[str]:
        return self._allowed_groups

    @property
    def attachments(self) -> List[Dict[str, Any]]:
        return self._attachments


class FeedQueryMessage(Event):
    """Message for feed query operations (list, search, get, recent)."""

    def __init__(
        self,
        source_id: str,
        query_type: str = "list",
        query: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
        sort_by: str = "recent",
        post_id: Optional[str] = None,
        tags: Optional[List[str]] = None,
        author_id: Optional[str] = None,
        since_timestamp: Optional[float] = None,
        since_date: Optional[float] = None,
        **kwargs,
    ):
        # Build event name based on query type
        if query_type in ["list", "list_posts"]:
            event_name = "feed.posts.list"
            normalized_query_type = "list_posts"
        elif query_type in ["search", "search_posts"]:
            event_name = "feed.posts.search"
            normalized_query_type = "search_posts"
        elif query_type in ["get", "get_post"]:
            event_name = "feed.post.get"
            normalized_query_type = "get_post"
        elif query_type in ["recent", "recent_posts"]:
            event_name = "feed.posts.recent"
            normalized_query_type = "recent_posts"
        else:
            event_name = f"feed.{query_type}"
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
        if post_id is not None:
            payload["post_id"] = post_id
        if tags is not None:
            payload["tags"] = tags
        if author_id is not None:
            payload["author_id"] = author_id
        if since_timestamp is not None:
            payload["since_timestamp"] = since_timestamp
        if since_date is not None:
            payload["since_date"] = since_date

        # Initialize parent Event
        super().__init__(
            event_name=event_name, source_id=source_id, payload=payload, **kwargs
        )

        # Store values as custom attributes
        self._query_type = normalized_query_type
        self._query = query
        self._limit = limit
        self._offset = offset
        self._sort_by = sort_by
        self._post_id = post_id
        self._tags = tags or []
        self._author_id = author_id
        self._since_timestamp = since_timestamp
        self._since_date = since_date

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
    def post_id(self) -> Optional[str]:
        return self._post_id

    @property
    def tags(self) -> List[str]:
        return self._tags

    @property
    def author_id(self) -> Optional[str]:
        return self._author_id

    @property
    def since_timestamp(self) -> Optional[float]:
        return self._since_timestamp

    @property
    def since_date(self) -> Optional[float]:
        return self._since_date
