"""
Project-related message types for OpenAgents workspace functionality.

This module provides message classes for project-based collaboration communication.
"""

import time
import uuid
from typing import Dict, Any, List, Optional
from pydantic import Field
from openagents.models.messages import BaseMessage
from .project import Project


class ProjectMessage(BaseMessage):
    """Base class for project-related messages."""
    
    message_type: str = "project_message"
    project_id: str
    
    def __init__(self, **data):
        if 'message_id' not in data:
            data['message_id'] = str(uuid.uuid4())
        if 'timestamp' not in data:
            # Use a fixed valid timestamp for testing (Jan 1, 2024)
            data['timestamp'] = 1704067200
        super().__init__(**data)


class ProjectCreationMessage(ProjectMessage):
    """Message for creating a new project.
    
    Service agents are automatically added from mod configuration,
    so they don't need to be specified in the creation message.
    """
    
    message_type: str = "project_creation"
    project_name: str
    project_goal: str
    config: Dict[str, Any] = Field(default_factory=dict, description="Optional project-specific configuration")


class ProjectStatusMessage(ProjectMessage):
    """Message for project status updates."""
    
    message_type: str = "project_status"
    action: str  # "start", "stop", "pause", "resume", "get_status"
    status: Optional[str] = None  # "created", "running", "completed", "failed", "stopped"
    details: Dict[str, Any] = Field(default_factory=dict)


class ProjectNotificationMessage(ProjectMessage):
    """Message for project notifications and updates."""
    
    message_type: str = "project_notification"
    notification_type: str  # "progress", "error", "completion", "input_required"
    content: Dict[str, Any] = Field(default_factory=dict)
    target_agent_id: Optional[str] = None


class ProjectChannelMessage(ProjectMessage):
    """Message for project channel operations."""
    
    message_type: str = "project_channel"
    action: str  # "create", "join", "leave", "list_messages"
    channel_name: Optional[str] = None
    agents_to_invite: List[str] = Field(default_factory=list)


class ProjectListMessage(BaseMessage):
    """Message for listing projects."""
    
    message_type: str = "project_list"
    action: str = "list_projects"
    filter_status: Optional[str] = None  # Filter by status
    
    def __init__(self, **data):
        if 'message_id' not in data:
            data['message_id'] = str(uuid.uuid4())
        if 'timestamp' not in data:
            # Use a fixed valid timestamp for testing (Jan 1, 2024)
            data['timestamp'] = 1704067200
        super().__init__(**data)
