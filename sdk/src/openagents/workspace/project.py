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


class ProjectTemplate(BaseModel):
    """Represents a project template with predefined configuration."""

    template_id: str
    name: str
    description: str
    agent_groups: List[str] = Field(
        default_factory=list,
        description="Agent group names from network config"
    )
    context: str
    created_timestamp: int = Field(default_factory=lambda: int(time.time()))

    # Tool configuration fields
    expose_as_tool: bool = Field(
        default=False,
        description="Whether to expose this template as a standalone tool"
    )
    tool_name: Optional[str] = Field(
        default=None,
        description="Custom tool name (defaults to start_{template_id}_project)"
    )
    tool_description: Optional[str] = Field(
        default=None,
        description="Custom tool description (defaults to template description)"
    )
    input_schema: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Custom JSON schema for tool inputs"
    )
    tool_mode: str = Field(
        default="sync",
        description="Tool execution mode: 'sync' (wait for completion) or 'async' (two tools: start and get_result)"
    )

    def to_dict(self) -> Dict[str, Any]:
        """Convert template to dictionary."""
        return self.model_dump()
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ProjectTemplate":
        """Create template from dictionary."""
        return cls(**data)


class Project(BaseModel):
    """Represents a project with its configuration and state.

    Projects are created from templates which specify agent groups and context.
    """

    project_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: Optional[str] = None
    goal: str
    context: Optional[str] = None
    template_id: str  # Required - from template
    status: ProjectStatus = ProjectStatus.CREATED
    created_timestamp: int = Field(
        default_factory=lambda: int(time.time())
    )
    started_timestamp: Optional[int] = None
    completed_timestamp: Optional[int] = None
    summary: Optional[str] = None  # Project completion summary
    initiator_agent_id: str  # Agent who created the project
    collaborators: List[str] = Field(
        default_factory=list,
        description="Additional agents beyond template groups"
    )
    agent_groups: List[str] = Field(
        default_factory=list,
        description="Agent groups from template"
    )
    authorized_agents: List[str] = Field(
        default_factory=list,
        description="Computed list of all authorized agents"
    )
    global_state: Dict[str, Any] = Field(
        default_factory=dict,
        description="Project-wide key-value state"
    )
    agent_states: Dict[str, Dict[str, Any]] = Field(
        default_factory=dict,
        description="Agent-specific states (agent_id -> state dict)"
    )
    artifacts: Dict[str, str] = Field(
        default_factory=dict,
        description="Project artifacts (key -> content)"
    )
    messages: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="Project message history"
    )
    error_details: Optional[str] = None

    def __init__(self, goal: str, template_id: str, initiator_agent_id: str, name: Optional[str] = None, **data):
        """Initialize a project.

        Args:
            goal: The goal/description of the project
            template_id: Template ID used to create this project
            initiator_agent_id: Agent who initiated the project
            name: Optional name for the project (defaults to auto-generated)
            **data: Additional project data
        """
        if name is None:
            # Generate a name based on project_id if not provided
            project_id = data.get("project_id", str(uuid.uuid4()))
            name = f"Project-{project_id[:8]}"

        super().__init__(goal=goal, template_id=template_id, initiator_agent_id=initiator_agent_id, name=name, **data)

    def start(self) -> None:
        """Mark the project as started."""
        self.status = ProjectStatus.RUNNING
        self.started_timestamp = int(time.time())

    def complete(self, summary: Optional[str] = None) -> None:
        """Mark the project as completed."""
        self.status = ProjectStatus.COMPLETED
        self.completed_timestamp = int(time.time())
        if summary:
            self.summary = summary

    def fail(self, error: str) -> None:
        """Mark the project as failed."""
        self.status = ProjectStatus.FAILED
        self.completed_timestamp = int(time.time())
        self.error_details = error

    def stop(self) -> None:
        """Stop the project."""
        self.status = ProjectStatus.STOPPED
        self.completed_timestamp = int(time.time())

    def pause(self) -> None:
        """Pause the project."""
        self.status = ProjectStatus.PAUSED

    def resume(self) -> None:
        """Resume the project."""
        self.status = ProjectStatus.RUNNING

    def compute_authorized_agents(self) -> List[str]:
        """Compute the list of authorized agents from groups and collaborators."""
        authorized = set([self.initiator_agent_id])
        authorized.update(self.collaborators)
        # Note: agent_groups will be resolved to actual agent IDs by the mod
        self.authorized_agents = list(authorized)
        return self.authorized_agents

    def set_global_state(self, key: str, value: Any) -> Optional[Any]:
        """Set global state value and return previous value."""
        previous = self.global_state.get(key)
        self.global_state[key] = value
        return previous

    def get_global_state(self, key: str) -> Optional[Any]:
        """Get global state value."""
        return self.global_state.get(key)

    def delete_global_state(self, key: str) -> Optional[Any]:
        """Delete global state value and return it."""
        return self.global_state.pop(key, None)

    def set_agent_state(self, agent_id: str, key: str, value: Any) -> Optional[Any]:
        """Set agent-specific state value and return previous value."""
        if agent_id not in self.agent_states:
            self.agent_states[agent_id] = {}
        previous = self.agent_states[agent_id].get(key)
        self.agent_states[agent_id][key] = value
        return previous

    def get_agent_state(self, agent_id: str, key: str) -> Optional[Any]:
        """Get agent-specific state value."""
        return self.agent_states.get(agent_id, {}).get(key)

    def get_agent_state_dict(self, agent_id: str) -> Dict[str, Any]:
        """Get all state for a specific agent."""
        return self.agent_states.get(agent_id, {})

    def delete_agent_state(self, agent_id: str, key: str) -> Optional[Any]:
        """Delete agent-specific state value and return it."""
        if agent_id in self.agent_states:
            return self.agent_states[agent_id].pop(key, None)
        return None

    def set_artifact(self, key: str, value: str) -> Optional[str]:
        """Set artifact value and return previous value."""
        previous = self.artifacts.get(key)
        self.artifacts[key] = value
        return previous

    def get_artifact(self, key: str) -> Optional[str]:
        """Get artifact value."""
        return self.artifacts.get(key)

    def delete_artifact(self, key: str) -> Optional[str]:
        """Delete artifact and return its value."""
        return self.artifacts.pop(key, None)

    def list_artifacts(self) -> List[str]:
        """List all artifact keys."""
        return list(self.artifacts.keys())

    def is_active(self) -> bool:
        """Check if the project is currently active (running or paused)."""
        return self.status in [ProjectStatus.RUNNING, ProjectStatus.PAUSED]

    def is_completed(self) -> bool:
        """Check if the project is completed (successfully or failed)."""
        return self.status in [
            ProjectStatus.COMPLETED,
            ProjectStatus.FAILED,
            ProjectStatus.STOPPED,
        ]

    def get_duration_seconds(self) -> Optional[int]:
        """Get the duration of the project in seconds."""
        if not self.started_timestamp:
            return None

        end_time = self.completed_timestamp or int(time.time())
        return end_time - self.started_timestamp

    def to_dict(self) -> Dict[str, Any]:
        """Convert project to dictionary."""
        return self.model_dump()

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Project":
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
    def from_dict(cls, data: Dict[str, Any]) -> "ProjectConfig":
        """Create config from dictionary."""
        return cls(**data)
