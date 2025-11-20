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
        self.resume_blob: Optional[str] = None  # Optional base64 blob for preview
        self.owner_id = owner_id
        self.visibility = "private"  # Always private
        self.timestamp = timestamp
        self.comment_count = 0
        self.last_activity = timestamp
        self.comments: Dict[str, "InterviewComment"] = {}
        self.comment_tree: Dict[str, List[str]] = defaultdict(list)
        self.root_comments: List[str] = []

    def to_dict(self, include_comments: bool = False, include_blob: bool = False) -> Dict[str, Any]:
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
        if include_blob and self.resume_blob:
            result["resume_blob"] = self.resume_blob
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
            "thread_level": self.depth,  # Frontend expects thread_level
            "depth": self.depth,  # Keep for backward compatibility
            "deleted": self.deleted,
        }


class Job:
    """Job posting for interview process."""

    def __init__(
        self,
        job_id: str,
        title: str,
        company_name: str,
        posted_agent_id: str,
        posted_date: float,
        detailed_description: str = "",
        image_url: str = "",
        requirements: Optional[List[str]] = None,
        salary_range: str = "",
        location: str = "",
        status: str = "open",
        application_deadline: Optional[float] = None,
        contact_info: str = "",
    ):
        self.job_id = job_id
        self.title = title
        self.company_name = company_name
        self.posted_agent_id = posted_agent_id
        self.posted_date = posted_date
        self.detailed_description = detailed_description
        self.image_url = image_url
        self.requirements = requirements or []
        self.salary_range = salary_range
        self.location = location
        self.status = status
        self.application_deadline = application_deadline
        self.contact_info = contact_info
        self.updated_at = posted_date

    def to_brief_dict(self) -> Dict[str, Any]:
        """Convert to brief dict for list view."""
        brief_desc = self.detailed_description[:200] if self.detailed_description else ""
        return {
            "job_id": self.job_id,
            "title": self.title,
            "company_name": self.company_name,
            "image_url": self.image_url,
            "posted_date": int(self.posted_date),
            "posted_agent_id": self.posted_agent_id,
            "status": self.status,
            "brief_description": brief_desc,
            "detailed_description": self.detailed_description,  # For frontend description field
            "location": self.location,  # For frontend location field
            "requirements": self.requirements,  # Can be mapped to tags by frontend
        }

    def to_dict(self) -> Dict[str, Any]:
        """Convert to full dict."""
        result = {
            "job_id": self.job_id,
            "title": self.title,
            "company_name": self.company_name,
            "image_url": self.image_url,
            "posted_date": int(self.posted_date),
            "posted_agent_id": self.posted_agent_id,
            "status": self.status,
            "detailed_description": self.detailed_description,
            "requirements": self.requirements,
            "salary_range": self.salary_range,
            "location": self.location,
            "contact_info": self.contact_info,
        }
        if self.application_deadline is not None:
            result["application_deadline"] = int(self.application_deadline)
        return result


class Notification:
    """Notification for interview events."""

    def __init__(
        self,
        notification_id: str,
        recipient_id: str,
        notification_type: str,
        message: str,
        created_at: float,
        status: str = "unread",
    ):
        self.notification_id = notification_id
        self.recipient_id = recipient_id
        self.notification_type = notification_type
        self.message = message
        self.created_at = created_at
        self.status = status

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dict."""
        return {
            "notification_id": self.notification_id,
            "recipient_id": self.recipient_id,
            "type": self.notification_type,
            "message": self.message,
            "created_at": int(self.created_at),
            "status": self.status,
        }


class Interview:
    """Interview session."""

    def __init__(
        self,
        interview_id: str,
        job_id: str,
        interview_url: str,
        interview_type: str,
        created_at: float,
        duration_minutes: int = 60,
        notes: str = "",
        status: str = "scheduled",
    ):
        self.interview_id = interview_id
        self.job_id = job_id
        self.interview_url = interview_url
        self.interview_type = interview_type
        self.created_at = created_at
        self.updated_at = created_at
        self.duration_minutes = duration_minutes
        self.notes = notes
        self.status = status
        self.results: Dict[str, Any] = {}
        self.cancelled_at: Optional[float] = None
        self.cancellation_reason: str = ""

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dict."""
        # Handle interview_url: return None if empty string or not scheduled
        interview_url = None
        if self.status == "scheduled" and self.interview_url:
            interview_url = self.interview_url if self.interview_url.strip() else None
        
        result = {
            "interview_id": self.interview_id,
            "job_id": self.job_id,
            "status": self.status,
            "interview_url": interview_url,
            "interview_type": self.interview_type if self.status == "scheduled" else None,
            "duration_minutes": self.duration_minutes if self.status == "scheduled" else None,
            "results": self.results,
            "created_at": int(self.created_at),
            "updated_at": int(self.updated_at),
            "notes": self.notes if self.notes else None,
        }
        return result


class UserInfo:
    """User (job candidate) information."""

    def __init__(
        self,
        user_id: str,
        email: str,
        first_name: str,
        last_name: str,
        registered_at: float,
        updated_at: Optional[float] = None,
        general_assessment_link: Optional[str] = None,
        general_assessment_application_id: Optional[str] = None,
        general_assessment_practice_session_id: Optional[str] = None,
        tasks: Optional[List[Dict[str, Any]]] = None,
        interview_invite_decisions: Optional[Dict[str, Dict[str, Any]]] = None,
    ):
        self.user_id = user_id
        self.email = email
        self.first_name = first_name
        self.last_name = last_name
        self.registered_at = registered_at
        self.updated_at = updated_at or registered_at
        self.general_assessment_link = general_assessment_link
        self.general_assessment_application_id = general_assessment_application_id
        self.general_assessment_practice_session_id = general_assessment_practice_session_id
        self.tasks = tasks or []
        # Track interview invite decisions: {job_id: {agent_id: decision_data, last_notified: timestamp}}
        self.interview_invite_decisions = interview_invite_decisions or {}

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dict."""
        result = {
            "user_id": self.user_id,
            "email": self.email,
            "first_name": self.first_name,
            "last_name": self.last_name,
            "registered_at": int(self.registered_at),
            "updated_at": int(self.updated_at),
            "tasks": self.tasks,
            "interview_invite_decisions": self.interview_invite_decisions,
        }
        if self.general_assessment_link:
            result["general_assessment_link"] = self.general_assessment_link
        if self.general_assessment_application_id:
            result["general_assessment_application_id"] = self.general_assessment_application_id
        if self.general_assessment_practice_session_id:
            result["general_assessment_practice_session_id"] = self.general_assessment_practice_session_id
        return result

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "UserInfo":
        """Create from dict."""
        return cls(
            user_id=data["user_id"],
            email=data["email"],
            first_name=data["first_name"],
            last_name=data["last_name"],
            registered_at=data["registered_at"],
            updated_at=data.get("updated_at", data["registered_at"]),
            general_assessment_link=data.get("general_assessment_link"),
            general_assessment_application_id=data.get("general_assessment_application_id"),
            general_assessment_practice_session_id=data.get("general_assessment_practice_session_id"),
            tasks=data.get("tasks", []),
            interview_invite_decisions=data.get("interview_invite_decisions", {}),
        )


class InterviewNetworkMod(BaseMod):
    """Network mod for AI interview with private resume access."""

    def __init__(self, mod_name: str = "interview"):
        super().__init__(mod_name=mod_name)
        self.topics: Dict[str, InterviewTopic] = {}
        self.files: Dict[str, Dict[str, Any]] = {}  # file_id -> file_metadata
        self.file_storage_path: Optional[Path] = None
        self.users_storage_path: Optional[Path] = None  # Storage for user info
        self.jobs: Dict[str, Job] = {}  # job_id -> Job
        self.notifications: Dict[str, Notification] = {}  # notification_id -> Notification
        self.interviews: Dict[str, Interview] = {}  # interview_id -> Interview
        self.monitoring_task: Optional[Any] = None  # Assessment monitoring task
        self.is_monitoring = False  # Flag to control monitoring loop

    def bind_network(self, network):
        """Bind network and initialize file storage."""
        super().bind_network(network)

        # Initialize file storage path
        storage_path = self.get_storage_path()
        if storage_path:
            self.file_storage_path = storage_path / "files"
            self.file_storage_path.mkdir(exist_ok=True)
            logger.info(f"Interview file storage initialized at {self.file_storage_path}")

            # Initialize users storage path
            self.users_storage_path = storage_path / "users"
            self.users_storage_path.mkdir(exist_ok=True)
            logger.info(f"Interview users storage initialized at {self.users_storage_path}")

            # Load existing file metadata if any
            self._load_file_metadata()
        else:
            logger.warning("No storage path available for interview file uploads")

        # Initialize test data if empty - DISABLED to use only real data from API
        # if not self.jobs:
        #     self._init_test_jobs()
        # if not self.interviews:
        #     self._init_test_interviews()

        # Start assessment completion monitoring task
        import asyncio
        self.is_monitoring = True
        self.monitoring_task = asyncio.create_task(self._monitor_assessment_completions())
        logger.info("Started assessment completion monitoring")

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

    def _get_user_file_path(self, user_id: str) -> Path:
        """Get file path for user data."""
        if not self.users_storage_path:
            raise RuntimeError("Users storage path not initialized")
        return self.users_storage_path / f"{user_id}.json"

    def _load_user_info(self, user_id: str) -> Optional[UserInfo]:
        """Load user info from file."""
        try:
            user_file = self._get_user_file_path(user_id)
            if not user_file.exists():
                return None

            import json
            with open(user_file, 'r') as f:
                data = json.load(f)
            return UserInfo.from_dict(data)
        except Exception as e:
            logger.error(f"Failed to load user info for {user_id}: {e}")
            return None

    def _save_user_info(self, user_info: UserInfo) -> bool:
        """Save user info to file."""
        try:
            user_file = self._get_user_file_path(user_info.user_id)
            import json
            with open(user_file, 'w') as f:
                json.dump(user_info.to_dict(), f, indent=2)
            logger.info(f"Saved user info for {user_info.user_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to save user info for {user_info.user_id}: {e}")
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

    # ========== Jobs Events ==========

    @mod_event_handler("interview.jobs.list")
    async def _list_jobs(self, event: Event) -> EventResponse:
        """List job postings with optional status filter."""
        payload = event.payload
        status = payload.get("status")

        # Filter jobs by status if provided
        if status:
            filtered_jobs = [
                job for job in self.jobs.values()
                if job.status == status
            ]
        else:
            filtered_jobs = list(self.jobs.values())

        # Sort by posted date (newest first)
        filtered_jobs.sort(key=lambda j: j.posted_date, reverse=True)

        jobs_data = [job.to_brief_dict() for job in filtered_jobs]

        return EventResponse(
            success=True,
            message="Jobs retrieved successfully",
            data={
                "jobs": jobs_data,
                "total_count": len(jobs_data),
            }
        )

    @mod_event_handler("interview.jobs.get")
    async def _get_job(self, event: Event) -> EventResponse:
        """Get detailed job information."""
        payload = event.payload
        job_id = payload.get("job_id")

        if not job_id:
            return EventResponse(
                success=False,
                message="Missing required field: job_id"
            )

        if job_id not in self.jobs:
            return EventResponse(
                success=False,
                message="Job not found"
            )

        job = self.jobs[job_id]
        return EventResponse(
            success=True,
            message="Job retrieved successfully",
            data=job.to_dict()
        )

    @mod_event_handler("interview.jobs.put")
    async def _update_job(self, event: Event) -> EventResponse:
        """Update job posting."""
        payload = event.payload
        job_id = payload.get("job_id")

        if not job_id:
            return EventResponse(
                success=False,
                message="Missing required field: job_id"
            )

        # If job doesn't exist, create it
        if job_id not in self.jobs:
            # Create new job
            title = payload.get("title", "")
            company_name = payload.get("company_name", "")
            
            if not title or not company_name:
                return EventResponse(
                    success=False,
                    message="Missing required fields for new job: title and company_name"
                )

            job = Job(
                job_id=job_id,
                title=title,
                company_name=company_name,
                posted_agent_id=event.source_id,
                posted_date=time.time(),
                detailed_description=payload.get("detailed_description", ""),
                image_url=payload.get("image_url", ""),
                requirements=payload.get("requirements", []),
                salary_range=payload.get("salary_range", ""),
                location=payload.get("location", ""),
                status=payload.get("status", "open"),
                application_deadline=payload.get("application_deadline"),
                contact_info=payload.get("contact_info", ""),
            )
            self.jobs[job_id] = job
            updated_fields = list(payload.keys())
            updated_fields.remove("job_id")
        else:
            # Update existing job
            job = self.jobs[job_id]
            updated_fields = []

            # Update allowed fields
            updatable_fields = {
                "title": str,
                "company_name": str,
                "image_url": str,
                "detailed_description": str,
                "requirements": list,
                "salary_range": str,
                "location": str,
                "status": str,
                "application_deadline": (int, float, type(None)),
                "contact_info": str,
            }

            for field, expected_type in updatable_fields.items():
                if field in payload:
                    setattr(job, field, payload[field])
                    updated_fields.append(field)

        job.updated_at = time.time()

        return EventResponse(
            success=True,
            message="Job updated successfully",
            data={
                "job_id": job_id,
                "updated_fields": updated_fields,
                "updated_at": int(job.updated_at),
                "success": True,
            }
        )

    @mod_event_handler("interview.jobs.delete")
    async def _delete_job(self, event: Event) -> EventResponse:
        """Delete job posting."""
        payload = event.payload
        job_id = payload.get("job_id")

        if not job_id:
            return EventResponse(
                success=False,
                message="Missing required field: job_id"
            )

        if job_id not in self.jobs:
            return EventResponse(
                success=False,
                message="Job not found"
            )

        del self.jobs[job_id]
        deleted_at = time.time()

        logger.info(f"Deleted job {job_id}")

        return EventResponse(
            success=True,
            message="Job deleted successfully",
            data={
                "job_id": job_id,
                "deleted_at": int(deleted_at),
                "success": True,
            }
        )

    # ========== Notification Events ==========

    @mod_event_handler("interview.notification.list")
    async def _list_notifications(self, event: Event) -> EventResponse:
        """List notifications with pagination and filters."""
        payload = event.payload
        limit = int(payload.get("limit", 50))
        offset = int(payload.get("offset", 0))
        status = payload.get("status")
        notification_type = payload.get("type")

        # Filter notifications
        filtered_notifications = []
        for notification in self.notifications.values():
            # Filter by recipient (only show notifications for requesting agent)
            if notification.recipient_id != event.source_id:
                continue
            
            # Filter by status if provided
            if status and notification.status != status:
                continue
            
            # Filter by type if provided
            if notification_type and notification.notification_type != notification_type:
                continue
            
            filtered_notifications.append(notification)

        # Sort by created date (newest first)
        filtered_notifications.sort(key=lambda n: n.created_at, reverse=True)

        # Paginate
        total_count = len(filtered_notifications)
        paginated_notifications = filtered_notifications[offset:offset + limit]
        notifications_data = [n.to_dict() for n in paginated_notifications]

        return EventResponse(
            success=True,
            message="Notifications retrieved successfully",
            data={
                "notifications": notifications_data,
                "total_count": total_count,
                "offset": offset,
                "limit": limit,
                "has_more": offset + limit < total_count,
            }
        )

    @mod_event_handler("interview.notification.add")
    async def _add_notification(self, event: Event) -> EventResponse:
        """Add a new notification."""
        payload = event.payload
        recipient_id = payload.get("recipient_id")
        notification_type = payload.get("type")
        message = payload.get("message")

        # Validate required fields
        if not recipient_id:
            return EventResponse(
                success=False,
                message="Missing required field: recipient_id"
            )
        
        if not notification_type:
            return EventResponse(
                success=False,
                message="Missing required field: type"
            )
        
        if not message:
            return EventResponse(
                success=False,
                message="Missing required field: message"
            )

        # Create notification
        notification_id = str(uuid.uuid4())
        notification = Notification(
            notification_id=notification_id,
            recipient_id=recipient_id,
            notification_type=notification_type,
            message=message,
            created_at=time.time(),
        )

        self.notifications[notification_id] = notification
        logger.info(f"Created notification {notification_id} for {recipient_id}")

        return EventResponse(
            success=True,
            message="Notification created successfully",
            data={
                "notification_id": notification_id,
            }
        )

    # ========== Interviews Events ==========

    @mod_event_handler("interview.interviews.list")
    async def _list_interviews(self, event: Event) -> EventResponse:
        """List interview sessions with optional status filter."""
        payload = event.payload
        status = payload.get("status")

        # Filter interviews by status if provided
        if status:
            filtered_interviews = [
                interview for interview in self.interviews.values()
                if interview.status == status
            ]
        else:
            filtered_interviews = list(self.interviews.values())

        # Sort by created date (newest first)
        filtered_interviews.sort(key=lambda i: i.created_at, reverse=True)

        interviews_data = [interview.to_dict() for interview in filtered_interviews]

        return EventResponse(
            success=True,
            message="Interviews retrieved successfully",
            data={
                "interviews": interviews_data,
                "total_count": len(interviews_data),
            }
        )

    @mod_event_handler("interview.interviews.add")
    async def _add_interview(self, event: Event) -> EventResponse:
        """Schedule a new interview."""
        payload = event.payload
        job_id = payload.get("job_id")
        interview_url = payload.get("interview_url")
        interview_type = payload.get("interview_type")
        duration_minutes = int(payload.get("duration_minutes", 60))
        notes = payload.get("notes", "")

        # Validate required fields
        if not job_id:
            return EventResponse(
                success=False,
                message="Missing required field: job_id"
            )
        
        if not interview_url:
            return EventResponse(
                success=False,
                message="Missing required field: interview_url"
            )
        
        if not interview_type:
            return EventResponse(
                success=False,
                message="Missing required field: interview_type"
            )

        # Create interview
        interview_id = str(uuid.uuid4())
        created_at = time.time()
        
        interview = Interview(
            interview_id=interview_id,
            job_id=job_id,
            interview_url=interview_url,
            interview_type=interview_type,
            created_at=created_at,
            duration_minutes=duration_minutes,
            notes=notes,
            status="scheduled",
        )

        self.interviews[interview_id] = interview
        logger.info(f"Scheduled interview {interview_id} for job {job_id}")

        return EventResponse(
            success=True,
            message="Interview scheduled successfully",
            data={
                "interview_id": interview_id,
                "status": "scheduled",
                "created_at": int(created_at),
            }
        )

    @mod_event_handler("interview.interviews.delete")
    async def _delete_interview(self, event: Event) -> EventResponse:
        """Cancel/delete an interview."""
        payload = event.payload
        interview_id = payload.get("interview_id")
        reason = payload.get("reason", "")

        if not interview_id:
            return EventResponse(
                success=False,
                message="Missing required field: interview_id"
            )

        if interview_id not in self.interviews:
            return EventResponse(
                success=False,
                message="Interview not found"
            )

        interview = self.interviews[interview_id]
        interview.status = "cancelled"
        interview.cancelled_at = time.time()
        interview.cancellation_reason = reason
        interview.updated_at = interview.cancelled_at

        logger.info(f"Cancelled interview {interview_id}: {reason}")

        return EventResponse(
            success=True,
            message="Interview cancelled successfully",
            data={
                "interview_id": interview_id,
                "cancelled_at": int(interview.cancelled_at),
                "reason": reason,
                "success": True,
            }
        )

    @mod_event_handler("interview.user.register")
    async def _register_user(self, event: Event) -> EventResponse:
        """Register or update user (job candidate) information.

        Expected payload:
        {
            "email": "user@example.com",
            "first_name": "John",
            "last_name": "Doe"
        }
        """
        payload = event.payload
        email = payload.get("email", "").strip()
        first_name = payload.get("first_name", "").strip()
        last_name = payload.get("last_name", "").strip()

        # Validate required fields
        if not email or not first_name or not last_name:
            return EventResponse(
                success=False,
                message="Missing required fields: email, first_name, and last_name are required"
            )

        # Basic email validation
        if "@" not in email or "." not in email.split("@")[1]:
            return EventResponse(
                success=False,
                message="Invalid email format"
            )

        # Use agent_id as user_id (one user per agent/connection)
        user_id = event.source_id
        current_time = time.time()

        # Check if user already exists
        existing_user = self._load_user_info(user_id)

        if existing_user:
            # Update existing user
            existing_user.email = email
            existing_user.first_name = first_name
            existing_user.last_name = last_name
            existing_user.updated_at = current_time
            user_info = existing_user
            is_new = False
        else:
            # Create new user with initial general assessment task
            initial_task = {
                "task_id": f"general_assessment_{user_id}",
                "name": "Complete General Assessment",
                "link": None,  # Will be generated when user clicks
                "status": "pending",
                "result": None,  # Will be populated when task is completed
                "created_timestamp": int(current_time),
            }

            # Hack codes
            initial_task["link"] = "https://app.readymojo.com/interview-flow/job_simulationtest_eng-conv-5/0bb4bdbe-147c-46d0-b7f4-1323ee66a78e/action/prep/ee956873-8099-4a60-b2b3-0a7772751c35/"
            initial_task["status"] = "in_progress"

            user_info = UserInfo(
                user_id=user_id,
                email=email,
                first_name=first_name,
                last_name=last_name,
                registered_at=current_time,
                tasks=[initial_task],
            )
            is_new = True

        # Save to file
        if not self._save_user_info(user_info):
            return EventResponse(
                success=False,
                message="Failed to save user information"
            )

        logger.info(f"{'Registered new' if is_new else 'Updated'} user: {email} ({user_id})")

        return EventResponse(
            success=True,
            message=f"User information {'registered' if is_new else 'updated'} successfully",
            data={
                "user": user_info.to_dict(),
                "is_new": is_new,
            }
        )

    @mod_event_handler("interview.user.get")
    async def _get_user(self, event: Event) -> EventResponse:
        """Get user (job candidate) information.

        Optional payload:
        {
            "user_id": "specific_user_id"  # If omitted, uses event.source_id
        }
        """
        payload = event.payload or {}
        user_id = payload.get("user_id", event.source_id)

        # Load user info from file
        user_info = self._load_user_info(user_id)

        if not user_info:
            return EventResponse(
                success=False,
                message="User information not found. Please register first.",
                data={
                    "registered": False,
                }
            )

        logger.info(f"Retrieved user info for {user_id}")

        return EventResponse(
            success=True,
            message="User information retrieved successfully",
            data={
                "user": user_info.to_dict(),
                "registered": True,
            }
        )

    @mod_event_handler("interview.get_general_assessment_link")
    async def _get_general_assessment_link(self, event: Event) -> EventResponse:
        """Get or create general assessment link for user.

        Expected payload:
        {
            "job_id": "job_simulationtest_eng-conv-5",  # Optional, defaults to general assessment job
            "peakmojo_api_url": "http://localhost:9500",  # Optional, defaults to localhost
            "skip_email": false  # Optional, defaults to false
        }
        """
        import uuid
        import json

        payload = event.payload or {}
        user_id = event.source_id

        # Load user info
        user_info = self._load_user_info(user_id)
        if not user_info:
            return EventResponse(
                success=False,
                message="User not registered. Please register first."
            )

        # Hack codes
        user_info.general_assessment_link = "https://app.readymojo.com/interview-flow/job_simulationtest_eng-conv-5/0bb4bdbe-147c-46d0-b7f4-1323ee66a78e/action/prep/ee956873-8099-4a60-b2b3-0a7772751c35/"
        user_info.general_assessment_application_id = "0bb4bdbe-147c-46d0-b7f4-1323ee66a78e"
        user_info.general_assessment_practice_session_id = "ee956873-8099-4a60-b2b3-0a7772751c35"

        # Check if link is already cached
        if user_info.general_assessment_link:
            logger.info(f"Returning cached general assessment link for {user_id}")
            return EventResponse(
                success=True,
                message="General assessment link retrieved from cache",
                data={
                    "assessment_link": user_info.general_assessment_link,
                    "application_id": user_info.general_assessment_application_id,
                    "practice_session_id": user_info.general_assessment_practice_session_id,
                    "cached": True,
                }
            )

        # Get parameters
        job_id = payload.get("job_id", "job_simulationtest_eng-conv-5")
        api_url = payload.get("peakmojo_api_url", "http://localhost:9500")
        skip_email = payload.get("skip_email", False)

        try:
            # Create application
            import httpx
            async with httpx.AsyncClient(timeout=30.0) as client:
                application_data = {
                    "job_id": job_id,
                    "user_email": user_info.email,
                    "first_name": user_info.first_name,
                    "last_name": user_info.last_name,
                    "skip_email": skip_email
                }

                logger.info(f"Creating application for {user_info.email} for job {job_id}")
                response = await client.post(
                    f"{api_url}/api/applications",
                    json=application_data,
                    headers={
                        "accept": "application/json",
                        "Content-Type": "application/json"
                    }
                )

                if response.status_code not in [200, 201]:
                    error_detail = response.text
                    logger.error(f"Failed to create application: {response.status_code} - {error_detail}")
                    return EventResponse(
                        success=False,
                        message=f"Failed to create application: {response.status_code}"
                    )

                application_response = response.json()

                # The API returns assessment_url, practice_session_id, and application_id directly
                assessment_link = application_response.get("assessment_url")
                practice_session_id = application_response.get("practice_session_id")
                application_id = application_response.get("application_id")

                if not assessment_link or not application_id or not practice_session_id:
                    logger.error(f"Missing required fields in response: {application_response}")
                    return EventResponse(
                        success=False,
                        message="Incomplete response from API"
                    )

                # Update user info with cached link
                user_info.general_assessment_link = assessment_link
                user_info.general_assessment_application_id = application_id
                user_info.general_assessment_practice_session_id = practice_session_id
                user_info.updated_at = time.time()

                # Save updated user info
                if not self._save_user_info(user_info):
                    logger.error(f"Failed to save user info after creating assessment link")
                    # Continue anyway, link is still valid

                logger.info(f"Created general assessment link for {user_id}: {assessment_link}")

                return EventResponse(
                    success=True,
                    message="General assessment link created successfully",
                    data={
                        "assessment_link": assessment_link,
                        "application_id": application_id,
                        "practice_session_id": practice_session_id,
                        "cached": False,
                    }
                )

        except httpx.HTTPError as e:
            logger.error(f"HTTP error creating assessment link: {e}")
            return EventResponse(
                success=False,
                message=f"Network error: {str(e)}"
            )
        except Exception as e:
            logger.error(f"Unexpected error creating assessment link: {e}")
            return EventResponse(
                success=False,
                message=f"Failed to create assessment link: {str(e)}"
            )

    @mod_event_handler("interview.task.start")
    async def _start_task(self, event: Event) -> EventResponse:
        """Start a task (e.g., general assessment).

        This generates the necessary link and opens it for the user.

        Expected payload:
        {
            "task_id": "general_assessment_..."
        }
        """
        payload = event.payload or {}
        task_id = payload.get("task_id")
        user_id = event.source_id

        if not task_id:
            return EventResponse(
                success=False,
                message="Missing required field: task_id"
            )

        # Load user info
        user_info = self._load_user_info(user_id)
        if not user_info:
            return EventResponse(
                success=False,
                message="User not registered. Please register first."
            )

        # Find the task
        task = None
        task_index = None
        for idx, t in enumerate(user_info.tasks):
            if t.get("task_id") == task_id:
                task = t
                task_index = idx
                break

        if not task:
            return EventResponse(
                success=False,
                message=f"Task not found: {task_id}"
            )

        # Handle general assessment task
        if task_id.startswith("general_assessment_"):
            # Get or create assessment link
            assessment_response = await self._get_general_assessment_link(event)

            if not assessment_response.success:
                return assessment_response

            assessment_link = assessment_response.data.get("assessment_link")

            # Update task with link and status
            user_info.tasks[task_index]["link"] = assessment_link
            user_info.tasks[task_index]["status"] = "in_progress"
            user_info.updated_at = time.time()

            # Save updated user info
            if not self._save_user_info(user_info):
                return EventResponse(
                    success=False,
                    message="Failed to save task update"
                )

            logger.info(f"Started task {task_id} for user {user_id}")

            return EventResponse(
                success=True,
                message="Task started successfully",
                data={
                    "task": user_info.tasks[task_index],
                    "assessment_link": assessment_link,
                }
            )

        # Handle other task types in the future
        return EventResponse(
            success=False,
            message=f"Unknown task type: {task_id}"
        )

    @mod_event_handler("interview.admin.get_all_users")
    async def _get_all_users(self, event: Event) -> EventResponse:
        """Get all users who were active in the last 72 hours (admin only).

        Access Control:
        - Only agents in the "admin" group can access this endpoint

        Returns:
        {
            "success": true,
            "users": [
                {
                    "user_id": "...",
                    "email": "...",
                    "first_name": "...",
                    "last_name": "...",
                    "registered_at": 1234567890,
                    "updated_at": 1234567890,
                    "tasks": [...]
                },
                ...
            ],
            "count": 10,
            "cutoff_time": 1234567890
        }
        """
        # Verify admin access
        agent_group = None
        if hasattr(self, "network") and self.network:
            agent_group = self.network.topology.agent_group_membership.get(event.source_id)

        if agent_group != "admin":
            logger.warning(f"Unauthorized access attempt to admin.get_all_users by {event.source_id} (group: {agent_group})")
            return EventResponse(
                success=False,
                message="Access denied: admin privileges required"
            )

        if not self.users_storage_path:
            return EventResponse(
                success=False,
                message="User storage not initialized"
            )

        # Calculate cutoff time (72 hours ago)
        current_time = time.time()
        cutoff_time = current_time - (72 * 60 * 60)  # 72 hours in seconds

        active_users = []

        try:
            # Iterate through all user files
            import json
            for user_file in self.users_storage_path.glob("*.json"):
                try:
                    with open(user_file, 'r') as f:
                        user_data = json.load(f)

                    # Check if user was active in last 72 hours
                    updated_at = user_data.get("updated_at", 0)
                    if updated_at >= cutoff_time:
                        active_users.append(user_data)

                except Exception as e:
                    logger.warning(f"Failed to load user file {user_file}: {e}")
                    continue

            # Sort by updated_at (most recent first)
            active_users.sort(key=lambda u: u.get("updated_at", 0), reverse=True)

            logger.info(f"Admin {event.source_id} retrieved {len(active_users)} active users (last 72h)")

            return EventResponse(
                success=True,
                message=f"Retrieved {len(active_users)} active users",
                data={
                    "users": active_users,
                    "count": len(active_users),
                    "cutoff_time": int(cutoff_time)
                }
            )

        except Exception as e:
            logger.error(f"Failed to retrieve all users: {e}")
            return EventResponse(
                success=False,
                message=f"Failed to retrieve users: {str(e)}"
            )

    @mod_event_handler("interview.admin.update_user_task")
    async def _update_user_task(self, event: Event) -> EventResponse:
        """Update a user's task (admin only).

        Access Control:
        - Only agents in the "admin" group can access this endpoint

        Input:
        {
            "user_id": "agent_abc123",
            "task_id": "general_assessment_agent_abc123",
            "updates": {
                "name": "New Task Name",  # Optional
                "link": "https://...",     # Optional
                "status": "completed",     # Optional: pending, in_progress, completed
                "result": {...}            # Optional: any JSON object
            }
        }

        Returns:
        {
            "success": true,
            "message": "Task updated successfully",
            "data": {
                "task": {...},  # Updated task object
                "updated_keys": ["status", "result"]  # List of updated fields
            }
        }
        """
        # Verify admin access
        agent_group = None
        if hasattr(self, "network") and self.network:
            agent_group = self.network.topology.agent_group_membership.get(event.source_id)

        if agent_group != "admin":
            logger.warning(f"Unauthorized access attempt to admin.update_user_task by {event.source_id} (group: {agent_group})")
            return EventResponse(
                success=False,
                message="Access denied: admin privileges required"
            )

        payload = event.payload
        user_id = payload.get("user_id")
        task_id = payload.get("task_id")
        updates = payload.get("updates", {})

        if not user_id or not task_id:
            return EventResponse(
                success=False,
                message="Missing required fields: user_id and task_id"
            )

        if not updates:
            return EventResponse(
                success=False,
                message="No updates provided"
            )

        # Load user info
        user_info = self._load_user_info(user_id)
        if not user_info:
            return EventResponse(
                success=False,
                message=f"User not found: {user_id}"
            )

        # Find task
        task_index = None
        for i, task in enumerate(user_info.tasks):
            if task.get("task_id") == task_id:
                task_index = i
                break

        if task_index is None:
            return EventResponse(
                success=False,
                message=f"Task not found: {task_id}"
            )

        # Track updated keys
        updated_keys = []
        valid_update_keys = ["name", "link", "status", "result"]

        # Apply updates
        for key, value in updates.items():
            if key not in valid_update_keys:
                logger.warning(f"Ignoring invalid update key: {key}")
                continue

            # Validate status values
            if key == "status" and value not in ["pending", "in_progress", "completed"]:
                return EventResponse(
                    success=False,
                    message=f"Invalid status value: {value}"
                )

            user_info.tasks[task_index][key] = value
            updated_keys.append(key)

        # Update user timestamp
        user_info.updated_at = time.time()

        # Save updated user info
        if not self._save_user_info(user_info):
            return EventResponse(
                success=False,
                message="Failed to save task update"
            )

        updated_task = user_info.tasks[task_index]

        logger.info(f"Admin {event.source_id} updated task {task_id} for user {user_id}: {updated_keys}")

        # Broadcast notification to interviewer group
        await self._broadcast_event(
            "interview.notification.user_task_updated",
            {
                "user_id": user_id,
                "task": updated_task,
                "updated_keys": updated_keys,
                "updated_by": event.source_id,
                "timestamp": int(user_info.updated_at)
            },
            event.source_id
        )

        return EventResponse(
            success=True,
            message="Task updated successfully",
            data={
                "task": updated_task,
                "updated_keys": updated_keys
            }
        )

    @mod_event_handler("interview.record_invite_decision")
    async def _record_invite_decision(self, event: Event) -> EventResponse:
        """Record an interview invite decision for a user-job pair.

        This event allows agents to record whether they want to invite a user
        for an interview for a specific job. Once a decision is recorded,
        automatic notifications for this user-job pair will stop.

        Input:
        {
            "user_id": "agent_abc123",
            "job_id": "job_simulationtest_eng-conv-5",
            "decision": "invite",  // or "reject", "pending"
            "interview_link": "https://...",  // Optional: if decision is "invite" and link provided, creates a task
            "reason": "Strong technical skills...",  // Optional
            "notes": "Follow up in 2 weeks"  // Optional
        }

        Returns:
        {
            "success": true,
            "message": "Decision recorded successfully",
            "data": {
                "user_id": "agent_abc123",
                "job_id": "job_simulationtest_eng-conv-5",
                "decision": "invite",
                "decided_by": "interviewer_agent",
                "decided_at": 1234567890
            }
        }
        """
        payload = event.payload
        user_id = payload.get("user_id")
        job_id = payload.get("job_id")
        decision = payload.get("decision")
        interview_link = payload.get("interview_link")
        reason = payload.get("reason")
        notes = payload.get("notes")

        # Validate required fields
        if not user_id or not job_id or not decision:
            return EventResponse(
                success=False,
                message="Missing required fields: user_id, job_id, and decision"
            )

        # Validate decision value
        valid_decisions = ["invite", "reject", "pending"]
        if decision not in valid_decisions:
            return EventResponse(
                success=False,
                message=f"Invalid decision value. Must be one of: {', '.join(valid_decisions)}"
            )

        # Load user info
        user_info = self._load_user_info(user_id)
        if not user_info:
            return EventResponse(
                success=False,
                message=f"User not found: {user_id}"
            )

        # Check if job exists
        if job_id not in self.jobs:
            return EventResponse(
                success=False,
                message=f"Job not found: {job_id}"
            )

        job = self.jobs[job_id]

        # Record decision
        current_time = time.time()

        if job_id not in user_info.interview_invite_decisions:
            user_info.interview_invite_decisions[job_id] = {}

        user_info.interview_invite_decisions[job_id].update({
            "decision": decision,
            "decided_by": event.source_id,
            "decided_at": current_time,
        })

        # Add optional fields if provided
        if reason:
            user_info.interview_invite_decisions[job_id]["reason"] = reason
        if notes:
            user_info.interview_invite_decisions[job_id]["notes"] = notes
        if interview_link:
            user_info.interview_invite_decisions[job_id]["interview_link"] = interview_link

        # If decision is "invite" and interview_link is provided, create a task
        task_created = False
        new_task = None
        if decision == "invite" and interview_link:
            task_id = f"interview_{job_id}_{user_id}"

            # Check if task already exists
            existing_task = None
            for task in user_info.tasks:
                if task.get("task_id") == task_id:
                    existing_task = task
                    break

            if not existing_task:
                # Create new interview task
                new_task = {
                    "task_id": task_id,
                    "name": f"Interview for {job.title}",
                    "link": interview_link,
                    "status": "pending",
                    "result": None,
                    "created_timestamp": int(current_time),
                    "job_id": job_id,
                    "job_title": job.title,
                    "company_name": job.company_name,
                }
                user_info.tasks.append(new_task)
                task_created = True
                logger.info(
                    f"Created interview task {task_id} for user {user_id} and job {job_id}"
                )

        # Update user timestamp
        user_info.updated_at = current_time

        # Save updated user info
        if not self._save_user_info(user_info):
            return EventResponse(
                success=False,
                message="Failed to save decision"
            )

        logger.info(
            f"Agent {event.source_id} recorded decision '{decision}' for user {user_id} "
            f"and job {job_id}" + (f" with interview link" if interview_link else "")
        )

        # Broadcast notification about the decision
        notification_data = {
            "user_id": user_id,
            "job_id": job_id,
            "decision": decision,
            "decided_by": event.source_id,
            "decided_at": int(current_time),
            "reason": reason,
            "notes": notes,
            "interview_link": interview_link,
            "task_created": task_created,
        }
        if task_created and new_task:
            notification_data["task"] = new_task

        await self._broadcast_event(
            "interview.notification.invite_decision_recorded",
            notification_data,
            event.source_id
        )

        response_data = {
            "user_id": user_id,
            "job_id": job_id,
            "decision": decision,
            "decided_by": event.source_id,
            "decided_at": int(current_time),
            "reason": reason,
            "notes": notes,
            "interview_link": interview_link,
            "task_created": task_created,
        }
        if task_created and new_task:
            response_data["task"] = new_task

        return EventResponse(
            success=True,
            message="Decision recorded successfully" + (", interview task created" if task_created else ""),
            data=response_data
        )

    async def _monitor_assessment_completions(self):
        """Periodically monitor for completed assessments and notify agents."""
        import asyncio

        MONITOR_INTERVAL = 60  # Check every 60 seconds
        NOTIFICATION_COOLDOWN = 300  # 5 minutes cooldown per job per user
        ACTIVE_USER_WINDOW = 72 * 60 * 60  # 72 hours

        while self.is_monitoring:
            try:
                await self._check_and_notify_completed_assessments(
                    active_window=ACTIVE_USER_WINDOW,
                    cooldown=NOTIFICATION_COOLDOWN
                )
            except Exception as e:
                logger.error(f"Error in assessment monitoring: {e}", exc_info=True)

            await asyncio.sleep(MONITOR_INTERVAL)

    async def _check_and_notify_completed_assessments(
        self,
        active_window: float,
        cooldown: float
    ):
        """Check for users with completed assessments and send notifications."""
        if not self.users_storage_path:
            return

        current_time = time.time()
        cutoff_time = current_time - active_window

        # Get all active users
        import json
        for user_file in self.users_storage_path.glob("*.json"):
            try:
                with open(user_file, 'r') as f:
                    user_data = json.load(f)

                # Check if user is active
                updated_at = user_data.get("updated_at", 0)
                if updated_at < cutoff_time:
                    continue

                user_info = UserInfo.from_dict(user_data)

                # Check if user has completed general assessment
                general_assessment_result = self._get_general_assessment_result(user_info)
                if not general_assessment_result:
                    continue  # No completed assessment

                # Check each job for notification
                for job_id, job in self.jobs.items():
                    await self._check_and_send_job_notification(
                        user_info=user_info,
                        job=job,
                        assessment_result=general_assessment_result,
                        current_time=current_time,
                        cooldown=cooldown
                    )

            except Exception as e:
                logger.warning(f"Failed to process user file {user_file}: {e}")
                continue

    def _get_general_assessment_result(self, user_info: UserInfo) -> Optional[Dict[str, Any]]:
        """Get general assessment result if completed."""
        for task in user_info.tasks:
            if (task.get("task_id", "").startswith("general_assessment_") and
                task.get("status") == "completed" and
                task.get("result") is not None):
                return task.get("result")
        return None

    async def _check_and_send_job_notification(
        self,
        user_info: UserInfo,
        job: "Job",
        assessment_result: Dict[str, Any],
        current_time: float,
        cooldown: float
    ):
        """Check and send notification for a specific job if needed."""
        job_id = job.job_id

        # Check if notification was already sent recently
        if job_id in user_info.interview_invite_decisions:
            last_notified = user_info.interview_invite_decisions[job_id].get("last_notified", 0)
            if current_time - last_notified < cooldown:
                # Still in cooldown period
                return

            # Check if decision already recorded
            if "decision" in user_info.interview_invite_decisions[job_id]:
                # Decision already made, no need to notify again
                return

        # Send notification directly to the agent who posted the job
        notification_payload = {
            "user_info": {
                "user_id": user_info.user_id,
                "email": user_info.email,
                "first_name": user_info.first_name,
                "last_name": user_info.last_name,
                "registered_at": int(user_info.registered_at),
            },
            "general_assessment_result": assessment_result,
            "job": job.to_dict(),
            "timestamp": int(current_time)
        }

        # Send notification directly to the agent who posted this job
        from openagents.models.event import Event
        notification_event = Event(
            event_name="interview.notification.general_assessment_completed",
            destination_id=job.posted_agent_id,
            source_id="mod:openagents.mods.workspace.interview",
            payload=notification_payload
        )
        await self.send_event(notification_event)

        # Update last notified timestamp
        if job_id not in user_info.interview_invite_decisions:
            user_info.interview_invite_decisions[job_id] = {}
        user_info.interview_invite_decisions[job_id]["last_notified"] = current_time

        # Save updated user info
        self._save_user_info(user_info)

        logger.info(
            f"Sent assessment completion notification for user {user_info.user_id} "
            f"and job {job_id} to agent {job.posted_agent_id}"
        )


