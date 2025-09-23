"""
Project-related message types for OpenAgents workspace functionality.

This module provides message classes for project-based collaboration communication.
"""

import time
import uuid
from typing import Dict, Any, List, Optional
from pydantic import Field
from openagents.models.event import Event
from .project import Project


class ProjectMessage(Event):
    """Base class for project-related messages."""
    
    project_id: str
    
    def __init__(self, event_name: str = "project.message_received", source_id: str = "", **kwargs):
        """Initialize ProjectMessage with proper event name."""
        # Handle backward compatibility for sender_id -> source_id
        if 'sender_id' in kwargs and not source_id:
            source_id = kwargs.pop('sender_id')
        
        # Ensure source_id is not empty (required by modern Event)
        if not source_id:
            source_id = "system"  # Default for system-generated project messages
            
        # Extract project-specific fields
        project_id = kwargs.pop('project_id', '')
        
        if 'timestamp' not in kwargs:
            kwargs['timestamp'] = 1704067200  # Fixed timestamp for testing
        
        # Call parent constructor
        super().__init__(event_name=event_name, source_id=source_id, **kwargs)
        
        # Set project-specific fields
        self.project_id = project_id
    


class ProjectCreationMessage(ProjectMessage):
    """Message for creating a new project.
    
    Service agents are automatically added from mod configuration,
    so they don't need to be specified in the creation message.
    """
    
    project_name: str
    project_goal: str
    config: Dict[str, Any] = Field(default_factory=dict, description="Optional project-specific configuration")
    
    def __init__(self, event_name: str = "project.creation.requested", source_id: str = "", **kwargs):
        """Initialize ProjectCreationMessage with proper event name."""
        # Extract project creation specific fields
        project_name = kwargs.pop('project_name', '')
        project_goal = kwargs.pop('project_goal', '')
        config = kwargs.pop('config', {})
        
        # Call parent constructor
        super().__init__(event_name=event_name, source_id=source_id, **kwargs)
        
        # Set creation-specific fields
        self.project_name = project_name
        self.project_goal = project_goal
        self.config = config


class ProjectStatusMessage(ProjectMessage):
    """Message for project status updates."""
    
    action: str  # "start", "stop", "pause", "resume", "get_status"
    status: Optional[str] = None  # "created", "running", "completed", "failed", "stopped"
    details: Dict[str, Any] = Field(default_factory=dict)
    
    def __init__(self, event_name: str = "", source_id: str = "", **kwargs):
        """Initialize ProjectStatusMessage with dynamic event name based on action."""
        # Extract status-specific fields
        action = kwargs.pop('action', '')
        status = kwargs.pop('status', None)
        details = kwargs.pop('details', {})
        
        # Generate event name based on action if not provided
        if not event_name:
            if action in ['start']:
                event_name = "project.execution.started"
            elif action in ['stop']:
                event_name = "project.execution.stopped"
            elif action in ['pause']:
                event_name = "project.execution.paused"
            elif action in ['resume']:
                event_name = "project.execution.resumed"
            elif action in ['get_status']:
                event_name = "project.status.requested"
            else:
                event_name = "project.status.updated"
        
        # Call parent constructor
        super().__init__(event_name=event_name, source_id=source_id, **kwargs)
        
        # Set status-specific fields
        self.action = action
        self.status = status
        self.details = details


class ProjectNotificationMessage(ProjectMessage):
    """Message for project notifications and updates."""
    
    notification_type: str  # "progress", "error", "completion", "input_required"
    notification_content: Dict[str, Any] = Field(default_factory=dict)
    target_agent_id: Optional[str] = None
    
    def __init__(self, event_name: str = "", source_id: str = "", **kwargs):
        """Initialize ProjectNotificationMessage with dynamic event name based on notification type."""
        # Extract notification-specific fields
        notification_type = kwargs.pop('notification_type', '')
        content = kwargs.pop('content', {})
        target_agent_id = kwargs.pop('target_agent_id', None)
        
        # Generate event name based on notification type if not provided
        if not event_name:
            if notification_type == 'progress':
                event_name = "project.progress.updated"
            elif notification_type == 'error':
                event_name = "project.error.occurred"
            elif notification_type == 'completion':
                event_name = "project.execution.completed"
            elif notification_type == 'input_required':
                event_name = "project.input.required"
            else:
                event_name = "project.notification.sent"
        
        # Set target_agent_id if provided
        if target_agent_id:
            kwargs['target_agent_id'] = target_agent_id
        
        # Call parent constructor
        super().__init__(event_name=event_name, source_id=source_id, **kwargs)
        
        # Set notification-specific fields
        self.notification_type = notification_type
        self.notification_content = content
        self.target_agent_id = target_agent_id
    
    @property
    def content(self) -> Dict[str, Any]:
        """Backward compatibility: content maps to notification_content."""
        return self.notification_content
    
    @content.setter
    def content(self, value: Dict[str, Any]):
        """Backward compatibility: content maps to notification_content."""
        self.notification_content = value


class ProjectChannelMessage(ProjectMessage):
    """Message for project channel operations."""
    
    action: str  # "create", "join", "leave", "list_messages"
    channel_name: Optional[str] = None
    agents_to_invite: List[str] = Field(default_factory=list)
    
    def __init__(self, event_name: str = "", source_id: str = "", **kwargs):
        """Initialize ProjectChannelMessage with dynamic event name based on action."""
        # Extract channel-specific fields
        action = kwargs.pop('action', '')
        channel_name = kwargs.pop('channel_name', None)
        agents_to_invite = kwargs.pop('agents_to_invite', [])
        
        # Generate event name based on action if not provided
        if not event_name:
            if action == 'create':
                event_name = "project.channel.created"
            elif action == 'join':
                event_name = "project.channel.joined"
            elif action == 'leave':
                event_name = "project.channel.left"
            elif action == 'list_messages':
                event_name = "project.channel.messages_requested"
            else:
                event_name = "project.channel.action_performed"
        
        # Call parent constructor
        super().__init__(event_name=event_name, source_id=source_id, **kwargs)
        
        # Set channel-specific fields
        self.action = action
        self.channel_name = channel_name
        self.agents_to_invite = agents_to_invite


class ProjectListMessage(ProjectMessage):
    """Message for listing projects."""
    
    action: str = "list_projects"
    filter_status: Optional[str] = None  # Filter by status
    
    def __init__(self, event_name: str = "project.list.requested", source_id: str = "", **kwargs):
        """Initialize ProjectListMessage with proper event name."""
        # Extract list-specific fields
        action = kwargs.pop('action', 'list_projects')
        filter_status = kwargs.pop('filter_status', None)
        
        # Handle legacy message_id and timestamp
        if 'message_id' in kwargs:
            kwargs['event_id'] = kwargs.pop('message_id')
        if 'timestamp' not in kwargs:
            kwargs['timestamp'] = 1704067200  # Fixed timestamp for testing
        
        # Call parent constructor (project_id is empty for list messages)
        super().__init__(event_name=event_name, source_id=source_id, project_id="", **kwargs)
        
        # Set list-specific fields
        self.action = action
        self.filter_status = filter_status
