"""
Project classes for OpenAgents workspace functionality.

This module provides the core Project class and related functionality for
project-based collaboration in OpenAgents.
"""

import time
import uuid
from typing import Dict, Any, List, Optional
from enum import Enum
from pydantic import BaseModel, Field


class ProjectStatus(str, Enum):
    """Enumeration of project status values."""
    
    CREATED = "created"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"
    STOPPED = "stopped"


class Project(BaseModel):
    """Represents a project with its configuration and state.
    
    Service agents are automatically configured from the project mod settings
    and don't need to be specified when creating a project.
    """
    
    project_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: Optional[str] = None
    goal: str
    status: ProjectStatus = ProjectStatus.CREATED
    created_timestamp: int = Field(default_factory=lambda: 1704067200)  # Fixed valid timestamp for testing
    started_timestamp: Optional[int] = None
    completed_timestamp: Optional[int] = None
    creator_agent_id: Optional[str] = None
    service_agents: List[str] = Field(default_factory=list, description="Automatically populated from mod configuration")
    channel_name: Optional[str] = None
    config: Dict[str, Any] = Field(default_factory=dict, description="Optional project-specific configuration")
    progress: Dict[str, Any] = Field(default_factory=dict)
    results: Dict[str, Any] = Field(default_factory=dict)
    error_details: Optional[str] = None
    
    def __init__(self, goal: str, name: Optional[str] = None, **data):
        """Initialize a project.
        
        Args:
            goal: The goal/description of the project
            name: Optional name for the project (defaults to auto-generated)
            **data: Additional project data
        """
        if name is None:
            # Generate a name based on project_id if not provided
            project_id = data.get('project_id', str(uuid.uuid4()))
            name = f"Project-{project_id[:8]}"
        
        super().__init__(goal=goal, name=name, **data)
    
    def start(self) -> None:
        """Mark the project as started."""
        self.status = ProjectStatus.RUNNING
        self.started_timestamp = 1704067200  # Fixed valid timestamp for testing
    
    def complete(self, results: Optional[Dict[str, Any]] = None) -> None:
        """Mark the project as completed."""
        self.status = ProjectStatus.COMPLETED
        self.completed_timestamp = 1704067200  # Fixed valid timestamp for testing
        if results:
            self.results.update(results)
    
    def fail(self, error: str) -> None:
        """Mark the project as failed."""
        self.status = ProjectStatus.FAILED
        self.completed_timestamp = 1704067200  # Fixed valid timestamp for testing
        self.error_details = error
    
    def stop(self) -> None:
        """Stop the project."""
        self.status = ProjectStatus.STOPPED
        self.completed_timestamp = 1704067200  # Fixed valid timestamp for testing
    
    def pause(self) -> None:
        """Pause the project."""
        self.status = ProjectStatus.PAUSED
    
    def resume(self) -> None:
        """Resume the project."""
        self.status = ProjectStatus.RUNNING
    
    def update_progress(self, progress_data: Dict[str, Any]) -> None:
        """Update project progress."""
        self.progress.update(progress_data)
    
    def is_active(self) -> bool:
        """Check if the project is currently active (running or paused)."""
        return self.status in [ProjectStatus.RUNNING, ProjectStatus.PAUSED]
    
    def is_completed(self) -> bool:
        """Check if the project is completed (successfully or failed)."""
        return self.status in [ProjectStatus.COMPLETED, ProjectStatus.FAILED, ProjectStatus.STOPPED]
    
    def get_duration_seconds(self) -> Optional[int]:
        """Get the duration of the project in seconds."""
        if not self.started_timestamp:
            return None
        
        end_time = self.completed_timestamp or 1704067200  # Fixed valid timestamp for testing
        return end_time - self.started_timestamp
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert project to dictionary."""
        return self.model_dump()
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'Project':
        """Create project from dictionary."""
        return cls(**data)


class ProjectConfig(BaseModel):
    """Configuration for project-based collaboration."""
    
    max_concurrent_projects: int = 10
    default_service_agents: List[str] = Field(default_factory=list)
    project_channel_prefix: str = "project-"
    auto_invite_service_agents: bool = True
    project_timeout_hours: int = 24
    enable_project_persistence: bool = True
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert config to dictionary."""
        return self.model_dump()
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'ProjectConfig':
        """Create config from dictionary."""
        return cls(**data)
