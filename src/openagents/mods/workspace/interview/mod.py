"""
Network-level interview mod for OpenAgents - Private AI interviews with resume upload.
"""

import logging
import time
import uuid
import base64
from typing import Dict, Any, List, Optional
from collections import defaultdict
from pathlib import Path

from openagents.config.globals import BROADCAST_AGENT_ID
from openagents.core.base_mod import BaseMod, mod_event_handler
from openagents.models.event import Event
from openagents.models.event_response import EventResponse

logger = logging.getLogger(__name__)

MAX_COMMENT_DEPTH = 5  # Maximum nesting depth for comments
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB for PDF files

# PDF magic numbers (file header signatures)
PDF_MAGIC_NUMBERS = [
    b'%PDF-1.',  # Standard PDF header
]


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
        self.files: Dict[str, Dict[str, Any]] = {}  # file_id -> file_metadata
        self.file_storage_path: Optional[Path] = None

    def bind_network(self, network):
        """Bind network and initialize file storage."""
        super().bind_network(network)
        
        # Initialize file storage path
        storage_path = self.get_storage_path()
        if storage_path:
            self.file_storage_path = storage_path / "files"
            self.file_storage_path.mkdir(exist_ok=True)
            logger.info(f"Interview file storage initialized at {self.file_storage_path}")
            
            # Load existing file metadata if any
            self._load_file_metadata()
        else:
            logger.warning("No storage path available for interview file uploads")

    def _load_file_metadata(self):
        """Load file metadata from storage."""
        if not self.file_storage_path:
            return
        
        metadata_file = self.file_storage_path.parent / "file_metadata.json"
        if metadata_file.exists():
            try:
                import json
                with open(metadata_file, 'r') as f:
                    self.files = json.load(f)
                logger.info(f"Loaded {len(self.files)} file metadata entries")
            except Exception as e:
                logger.warning(f"Failed to load file metadata: {e}")

    def _save_file_metadata(self):
        """Persist file metadata to storage."""
        if not self.file_storage_path:
            return
        
        metadata_file = self.file_storage_path.parent / "file_metadata.json"
        try:
            import json
            with open(metadata_file, 'w') as f:
                json.dump(self.files, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to save file metadata: {e}")

    def _validate_pdf_content(self, file_content: bytes) -> bool:
        """Validate PDF file by checking magic number."""
        if not file_content or len(file_content) < 8:
            return False
        
        # Check PDF magic number
        for magic in PDF_MAGIC_NUMBERS:
            if file_content.startswith(magic):
                return True
        return False

    def _validate_pdf(self, resume_url: str) -> bool:
        """Validate PDF URL/file - check for .pdf extension or file:// scheme."""
        if not resume_url:
            return False
        
        # Support local file IDs (file://{uuid}) or URLs
        if resume_url.startswith("file://"):
            file_id = resume_url.replace("file://", "")
            return file_id in self.files
        
        return resume_url.lower().endswith(".pdf")

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

    @mod_event_handler("interview.file.upload")
    async def _upload_file(self, event: Event) -> EventResponse:
        """Handle PDF file upload for resume.
        
        Expected payload:
        {
            "filename": "resume.pdf",
            "file_content": "base64_encoded_content",
            "mime_type": "application/pdf",
            "file_size": 12345
        }
        """
        if not self.file_storage_path:
            return EventResponse(
                success=False,
                message="File storage not initialized"
            )
        
        payload = event.payload
        filename = payload.get("filename")
        file_content_b64 = payload.get("file_content")
        mime_type = payload.get("mime_type", "application/pdf")
        file_size = payload.get("file_size", 0)
        
        # Validate required fields
        if not filename or not file_content_b64:
            return EventResponse(
                success=False,
                message="Missing required fields: filename and file_content"
            )
        
        # Validate file extension
        if not filename.lower().endswith(".pdf"):
            return EventResponse(
                success=False,
                message="Only PDF files are allowed for resume upload"
            )
        
        # Validate MIME type
        if mime_type not in ["application/pdf"]:
            return EventResponse(
                success=False,
                message=f"Invalid MIME type: {mime_type}. Only application/pdf is allowed"
            )
        
        try:
            # Decode base64 content
            file_content = base64.b64decode(file_content_b64)
            actual_size = len(file_content)
            
            # Validate file size
            if actual_size > MAX_FILE_SIZE:
                return EventResponse(
                    success=False,
                    message=f"File size ({actual_size} bytes) exceeds maximum allowed size ({MAX_FILE_SIZE} bytes)"
                )
            
            # Validate PDF magic number
            if not self._validate_pdf_content(file_content):
                return EventResponse(
                    success=False,
                    message="Invalid PDF file: file header does not match PDF format"
                )
            
            # Generate unique file ID
            file_id = str(uuid.uuid4())
            file_path = self.file_storage_path / file_id
            
            # Save file to disk
            with open(file_path, "wb") as f:
                f.write(file_content)
            
            # Store file metadata
            self.files[file_id] = {
                "file_id": file_id,
                "filename": filename,
                "mime_type": mime_type,
                "size": actual_size,
                "uploaded_by": event.source_id,
                "upload_timestamp": time.time(),
                "path": str(file_path),
            }
            
            # Persist metadata
            self._save_file_metadata()
            
            logger.info(f"PDF uploaded: {filename} -> {file_id} by {event.source_id}")
            
            return EventResponse(
                success=True,
                message="File uploaded successfully",
                data={
                    "file_id": file_id,
                    "filename": filename,
                    "size": actual_size,
                    "resume_url": f"file://{file_id}",  # Return file:// URL for use in topic creation
                }
            )
            
        except Exception as e:
            logger.error(f"File upload failed: {e}")
            return EventResponse(
                success=False,
                message=f"File upload failed: {str(e)}"
            )

    @mod_event_handler("interview.file.download")
    async def _download_file(self, event: Event) -> EventResponse:
        """Download a file by file_id.
        
        Expected payload:
        {
            "file_id": "uuid"
        }
        """
        payload = event.payload
        file_id = payload.get("file_id")
        
        if not file_id or file_id not in self.files:
            return EventResponse(
                success=False,
                message="File not found"
            )
        
        file_metadata = self.files[file_id]
        file_path = Path(file_metadata["path"])
        
        # Check if file still exists
        if not file_path.exists():
            return EventResponse(
                success=False,
                message="File has been deleted from storage"
            )
        
        try:
            # Read and encode file
            with open(file_path, "rb") as f:
                file_content = f.read()
            
            encoded_content = base64.b64encode(file_content).decode("utf-8")
            
            return EventResponse(
                success=True,
                message="File retrieved successfully",
                data={
                    "file_id": file_id,
                    "filename": file_metadata["filename"],
                    "mime_type": file_metadata["mime_type"],
                    "size": file_metadata["size"],
                    "file_content": encoded_content,
                    "uploaded_by": file_metadata["uploaded_by"],
                    "upload_timestamp": file_metadata["upload_timestamp"],
                }
            )
            
        except Exception as e:
            logger.error(f"File download failed: {e}")
            return EventResponse(
                success=False,
                message=f"File download failed: {str(e)}"
            )

    @mod_event_handler("interview.file.get")
    async def _get_file_info(self, event: Event) -> EventResponse:
        """Get file metadata without downloading content.
        
        Expected payload:
        {
            "file_id": "uuid"
        }
        """
        payload = event.payload
        file_id = payload.get("file_id")
        
        if not file_id or file_id not in self.files:
            return EventResponse(
                success=False,
                message="File not found"
            )
        
        file_metadata = self.files[file_id].copy()
        file_metadata.pop("path", None)  # Don't expose internal path
        
        return EventResponse(
            success=True,
            message="File info retrieved successfully",
            data={"file": file_metadata}
        )

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

