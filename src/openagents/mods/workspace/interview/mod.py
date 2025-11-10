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


class InterviewNetworkMod(BaseMod):
    """Network mod for AI interview with private resume access."""

    def __init__(self, mod_name: str = "interview"):
        super().__init__(mod_name=mod_name)
        self.topics: Dict[str, InterviewTopic] = {}
        self.files: Dict[str, Dict[str, Any]] = {}  # file_id -> file_metadata
        self.file_storage_path: Optional[Path] = None
        self.jobs: Dict[str, Job] = {}  # job_id -> Job
        self.notifications: Dict[str, Notification] = {}  # notification_id -> Notification
        self.interviews: Dict[str, Interview] = {}  # interview_id -> Interview

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
        
        # Initialize test data if empty
        if not self.jobs:
            self._init_test_jobs()
        if not self.interviews:
            self._init_test_interviews()

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

    def _init_test_jobs(self):
        """Initialize test job data."""
        current_time = time.time()
        
        # Test job 1: Senior Software Engineer
        job1 = Job(
            job_id="test_job_001",
            title="Senior Software Engineer",
            company_name="Tech Company",
            posted_agent_id=BROADCAST_AGENT_ID,
            posted_date=current_time - 86400,  # 1 day ago
            detailed_description="We are looking for an experienced Senior Software Engineer to join our team. You will be responsible for designing and developing scalable software solutions, collaborating with cross-functional teams, and mentoring junior developers.",
            image_url="",
            requirements=["5+ years of experience", "Strong knowledge of React and TypeScript", "Experience with AWS"],
            salary_range="$120,000 - $180,000",
            location="San Francisco, CA",
            status="open",
        )
        self.jobs[job1.job_id] = job1
        
        # Test job 2: Full Stack Developer
        job2 = Job(
            job_id="test_job_002",
            title="Full Stack Developer",
            company_name="Innovation Labs",
            posted_agent_id=BROADCAST_AGENT_ID,
            posted_date=current_time - 172800,  # 2 days ago
            detailed_description="Join our dynamic team as a Full Stack Developer. You'll work on cutting-edge web applications, build RESTful APIs, and create intuitive user interfaces. Experience with modern JavaScript frameworks and cloud technologies is essential.",
            image_url="",
            requirements=["3+ years of experience", "JavaScript, Node.js, Vue.js", "MongoDB, GraphQL"],
            salary_range="$100,000 - $150,000",
            location="New York, NY",
            status="open",
        )
        self.jobs[job2.job_id] = job2
        
        # Test job 3: DevOps Engineer
        job3 = Job(
            job_id="test_job_003",
            title="DevOps Engineer",
            company_name="Cloud Solutions Inc",
            posted_agent_id=BROADCAST_AGENT_ID,
            posted_date=current_time - 259200,  # 3 days ago
            detailed_description="We're seeking a DevOps Engineer to help us build and maintain our infrastructure. You'll work with Kubernetes, CI/CD pipelines, and cloud platforms to ensure our systems are scalable, reliable, and secure.",
            image_url="",
            requirements=["4+ years of experience", "Kubernetes, Terraform, Jenkins", "Azure, Linux"],
            salary_range="$110,000 - $160,000",
            location="Remote",
            status="open",
        )
        self.jobs[job3.job_id] = job3
        
        # Test job 4: Machine Learning Engineer
        job4 = Job(
            job_id="test_job_004",
            title="Machine Learning Engineer",
            company_name="AI Innovations",
            posted_agent_id=BROADCAST_AGENT_ID,
            posted_date=current_time - 345600,  # 4 days ago
            detailed_description="Looking for a Machine Learning Engineer to develop and deploy ML models. You'll work on NLP, computer vision, and recommendation systems. Strong background in deep learning frameworks and data science is required.",
            image_url="",
            requirements=["3+ years of experience", "Python, TensorFlow, PyTorch", "MLOps, NLP"],
            salary_range="$130,000 - $200,000",
            location="Seattle, WA",
            status="open",
        )
        self.jobs[job4.job_id] = job4
        
        # Test job 5: Frontend Developer
        job5 = Job(
            job_id="test_job_005",
            title="Frontend Developer",
            company_name="Design Studio",
            posted_agent_id=BROADCAST_AGENT_ID,
            posted_date=current_time - 432000,  # 5 days ago
            detailed_description="Join our creative team as a Frontend Developer. You'll create beautiful, responsive web interfaces using modern frameworks. Strong design sense and attention to detail are essential for this role.",
            image_url="",
            requirements=["2+ years of experience", "React, CSS, Sass", "Webpack, Figma"],
            salary_range="$90,000 - $140,000",
            location="Los Angeles, CA",
            status="open",
        )
        self.jobs[job5.job_id] = job5
        
        # Test job 6: Backend Engineer
        job6 = Job(
            job_id="test_job_006",
            title="Backend Engineer",
            company_name="Data Systems",
            posted_agent_id=BROADCAST_AGENT_ID,
            posted_date=current_time - 518400,  # 6 days ago
            detailed_description="We need a Backend Engineer to build robust server-side applications. You'll design databases, create APIs, and optimize system performance. Experience with microservices architecture is a plus.",
            image_url="",
            requirements=["3+ years of experience", "Java, Spring Boot", "PostgreSQL, Redis", "Microservices"],
            salary_range="$110,000 - $160,000",
            location="Austin, TX",
            status="open",
        )
        self.jobs[job6.job_id] = job6
        
        logger.info(f"Initialized {len(self.jobs)} test jobs")

    def _init_test_interviews(self):
        """Initialize test interview data."""
        current_time = time.time()
        
        # Test interview 1: Scheduled virtual interview
        interview1 = Interview(
            interview_id="interview_001",
            job_id="test_job_001",
            interview_url="https://meet.example.com/interview/001",
            interview_type="virtual",
            created_at=current_time - 86400,  # 1 day ago
            duration_minutes=60,
            notes="Please prepare for technical questions about React and TypeScript.",
            status="scheduled",
        )
        interview1.updated_at = current_time - 3600  # 1 hour ago
        self.interviews[interview1.interview_id] = interview1
        
        # Test interview 2: Scheduled virtual interview
        interview2 = Interview(
            interview_id="interview_002",
            job_id="test_job_002",
            interview_url="https://meet.example.com/interview/002",
            interview_type="virtual",
            created_at=current_time - 172800,  # 2 days ago
            duration_minutes=45,
            notes="Focus on system design and architecture discussions.",
            status="scheduled",
        )
        interview2.updated_at = current_time - 7200  # 2 hours ago
        self.interviews[interview2.interview_id] = interview2
        
        # Test interview 3: Completed interview
        interview3 = Interview(
            interview_id="interview_003",
            job_id="test_job_003",
            interview_url="https://meet.example.com/interview/003",
            interview_type="virtual",
            created_at=current_time - 259200,  # 3 days ago
            duration_minutes=90,
            notes="Interview completed successfully.",
            status="completed",
        )
        interview3.updated_at = current_time - 86400  # 1 day ago
        interview3.results = {
            "score": 85,
            "feedback": "Strong technical skills demonstrated.",
        }
        self.interviews[interview3.interview_id] = interview3
        
        # Test interview 4: Scheduled onsite interview
        interview4 = Interview(
            interview_id="interview_004",
            job_id="test_job_004",
            interview_url="",  # Empty URL for onsite
            interview_type="onsite",
            created_at=current_time - 43200,  # 12 hours ago
            duration_minutes=120,
            notes="Onsite interview at company headquarters. Please arrive 15 minutes early.",
            status="scheduled",
        )
        interview4.updated_at = current_time - 1800  # 30 minutes ago
        self.interviews[interview4.interview_id] = interview4
        
        # Test interview 5: Cancelled interview
        interview5 = Interview(
            interview_id="interview_005",
            job_id="test_job_005",
            interview_url="https://meet.example.com/interview/005",
            interview_type="virtual",
            created_at=current_time - 345600,  # 4 days ago
            duration_minutes=60,
            notes="Interview cancelled due to scheduling conflict.",
            status="cancelled",
        )
        interview5.updated_at = current_time - 172800  # 2 days ago
        interview5.cancelled_at = current_time - 172800
        interview5.cancellation_reason = "Scheduling conflict"
        self.interviews[interview5.interview_id] = interview5
        
        logger.info(f"Initialized {len(self.interviews)} test interviews")

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
        resume_blob = payload.get("resume_blob")  # Optional base64 blob

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

        # Store optional blob for preview
        if resume_blob:
            topic.resume_blob = resume_blob

        self.topics[topic_id] = topic
        logger.info(f"Created interview topic {topic_id} by {event.source_id}")

        # Broadcast notification (without blob to save bandwidth)
        await self._broadcast_event("interview.topic.created", {
            "topic": topic.to_dict()
        }, event.source_id)

        return EventResponse(
            success=True,
            message="Interview topic created successfully",
            data={"topic_id": topic_id, "topic": topic.to_dict(include_blob=True)}
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
            data={"topic": topic.to_dict(include_comments=True, include_blob=True)}
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


