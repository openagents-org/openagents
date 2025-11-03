"""Interview message event models."""

from typing import Optional, List
import base64
from openagents.models.event import Event


class InterviewTopicMessage(Event):
    """Message for interview topic operations (create, delete)."""

    def __init__(
        self,
        source_id: str,
        action: str = "create",
        title: Optional[str] = None,
        content: Optional[str] = None,
        resume_url: Optional[str] = None,
        topic_id: Optional[str] = None,
        **kwargs,
    ):
        event_name = f"interview.topic.{action}"
        
        payload = {"action": action}
        if title is not None:
            payload["title"] = title
        if content is not None:
            payload["content"] = content
        if resume_url is not None:
            payload["resume_url"] = resume_url
        if topic_id is not None:
            payload["topic_id"] = topic_id
        
        super().__init__(
            event_name=event_name, source_id=source_id, payload=payload, **kwargs
        )
        
        self._title = title
        self._content = content
        self._resume_url = resume_url
        self._action = action
        self._topic_id = topic_id

    @property
    def title(self) -> Optional[str]:
        return self._title

    @property
    def topic_content(self) -> Optional[str]:
        return self._content

    @property
    def resume_url(self) -> Optional[str]:
        return self._resume_url

    @property
    def action(self) -> str:
        return self._action

    @property
    def topic_id(self) -> Optional[str]:
        return self._topic_id


class InterviewCommentMessage(Event):
    """Message for interview comment operations (create, reply, delete)."""

    def __init__(
        self,
        source_id: str,
        topic_id: str,
        action: str = "create",
        content: Optional[str] = None,
        comment_id: Optional[str] = None,
        parent_comment_id: Optional[str] = None,
        **kwargs,
    ):
        event_name = f"interview.comment.{action}"
        
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
        
        super().__init__(
            event_name=event_name, source_id=source_id, payload=payload, **kwargs
        )
        
        self._topic_id = topic_id
        self._content = content
        self._action = action
        self._comment_id = comment_id
        self._parent_comment_id = parent_comment_id

    @property
    def topic_id(self) -> str:
        return self._topic_id

    @property
    def comment_content(self) -> Optional[str]:
        return self._content

    @property
    def action(self) -> str:
        return self._action

    @property
    def comment_id(self) -> Optional[str]:
        return self._comment_id

    @property
    def parent_comment_id(self) -> Optional[str]:
        return self._parent_comment_id


class InterviewQueryMessage(Event):
    """Message for interview query operations (list, search, get)."""

    def __init__(
        self,
        source_id: str,
        action: str = "list",
        topic_id: Optional[str] = None,
        query: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
        **kwargs,
    ):
        event_name = f"interview.topic.{action}"
        
        payload = {
            "action": action,
            "limit": limit,
            "offset": offset,
        }
        if topic_id is not None:
            payload["topic_id"] = topic_id
        if query is not None:
            payload["query"] = query
        
        super().__init__(
            event_name=event_name, source_id=source_id, payload=payload, **kwargs
        )
        
        self._action = action
        self._topic_id = topic_id
        self._query = query
        self._limit = limit
        self._offset = offset

    @property
    def action(self) -> str:
        return self._action

    @property
    def topic_id(self) -> Optional[str]:
        return self._topic_id

    @property
    def query(self) -> Optional[str]:
        return self._query

    @property
    def limit(self) -> int:
        return self._limit

    @property
    def offset(self) -> int:
        return self._offset


class InterviewFileUploadMessage(Event):
    """Message for interview file upload (PDF resume)."""

    def __init__(
        self,
        source_id: str,
        filename: str,
        file_content: str,
        mime_type: str = "application/pdf",
        file_size: Optional[int] = None,
        **kwargs,
    ):
        # Calculate file size if not provided
        if file_size is None:
            try:
                decoded = base64.b64decode(file_content)
                file_size = len(decoded)
            except Exception:
                file_size = len(file_content)
        
        payload = {
            "filename": filename,
            "file_content": file_content,
            "mime_type": mime_type,
            "file_size": file_size,
        }
        
        super().__init__(
            event_name="interview.file.upload",
            source_id=source_id,
            payload=payload,
            **kwargs,
        )
        
        self._filename = filename
        self._file_content = file_content
        self._mime_type = mime_type
        self._file_size = file_size

    @property
    def filename(self) -> str:
        return self._filename

    @property
    def file_content(self) -> str:
        return self._file_content

    @property
    def mime_type(self) -> str:
        return self._mime_type

    @property
    def file_size(self) -> int:
        return self._file_size

    @staticmethod
    def get_filename(event: Event) -> str:
        """Extract filename from event payload."""
        return event.payload.get("filename", "") if event.payload else ""

    @staticmethod
    def get_file_content(event: Event) -> str:
        """Extract file content from event payload."""
        return event.payload.get("file_content", "") if event.payload else ""

    @staticmethod
    def get_mime_type(event: Event) -> str:
        """Extract MIME type from event payload."""
        return event.payload.get("mime_type", "application/pdf") if event.payload else "application/pdf"

    @staticmethod
    def get_file_size(event: Event) -> int:
        """Extract file size from event payload."""
        return event.payload.get("file_size", 0) if event.payload else 0

