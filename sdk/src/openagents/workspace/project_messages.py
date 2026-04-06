"""
Project message classes for the OpenAgents workspace project mod.

This module provides message classes for all project events with granular
event handling, state management, and artifact operations.
"""

import time
from typing import Dict, Any, List, Optional
from pydantic import Field
from openagents.models.event import Event


class BaseProjectMessage(Event):
    """Base class for all project-related messages."""
    
    def __init__(self, event_name: str, source_id: str, **kwargs):
        """Initialize BaseProjectMessage."""
        if "timestamp" not in kwargs:
            kwargs["timestamp"] = int(time.time())
        super().__init__(event_name=event_name, source_id=source_id, **kwargs)


# Template Management Messages

class ProjectTemplateListMessage(BaseProjectMessage):
    """Message for listing project templates."""
    
    def __init__(self, source_id: str, **kwargs):
        super().__init__(event_name="project.template.list", source_id=source_id, **kwargs)


# Project Lifecycle Messages

class ProjectStartMessage(BaseProjectMessage):
    """Message for starting a new project."""
    
    template_id: str
    goal: str
    name: Optional[str] = None
    collaborators: List[str] = Field(default_factory=list)
    
    def __init__(
        self,
        template_id: str,
        goal: str,
        source_id: str,
        name: Optional[str] = None,
        collaborators: Optional[List[str]] = None,
        **kwargs
    ):
        super().__init__(
            event_name="project.start", 
            source_id=source_id, 
            template_id=template_id,
            goal=goal,
            name=name,
            collaborators=collaborators or [],
            **kwargs
        )


class ProjectStopMessage(BaseProjectMessage):
    """Message for stopping a project."""
    
    project_id: str
    reason: Optional[str] = None
    
    def __init__(self, project_id: str, source_id: str, reason: Optional[str] = None, **kwargs):
        super().__init__(
            event_name="project.stop", 
            source_id=source_id, 
            project_id=project_id,
            reason=reason,
            **kwargs
        )


class ProjectCompleteMessage(BaseProjectMessage):
    """Message for completing a project."""
    
    project_id: str
    summary: str
    
    def __init__(self, project_id: str, summary: str, source_id: str, **kwargs):
        super().__init__(
            event_name="project.complete", 
            source_id=source_id, 
            project_id=project_id,
            summary=summary,
            **kwargs
        )


class ProjectGetMessage(BaseProjectMessage):
    """Message for getting project details."""
    
    project_id: str
    
    def __init__(self, project_id: str, source_id: str, **kwargs):
        super().__init__(event_name="project.get", source_id=source_id, project_id=project_id, **kwargs)


# Messaging Messages

class ProjectMessageSendMessage(BaseProjectMessage):
    """Message for sending a project message."""

    project_id: str
    message_content: Dict[str, Any]  # Renamed from 'content' to avoid shadowing Event.content property
    reply_to_id: Optional[str] = None
    attachments: List[Dict[str, Any]] = Field(default_factory=list)

    def __init__(
        self,
        project_id: str,
        content: Dict[str, Any],
        source_id: str,
        reply_to_id: Optional[str] = None,
        attachments: Optional[List[Dict[str, Any]]] = None,
        **kwargs
    ):
        # Pass all fields to parent for proper Pydantic validation
        super().__init__(
            event_name="project.message.send",
            source_id=source_id,
            project_id=project_id,
            message_content=content,
            reply_to_id=reply_to_id,
            attachments=attachments or [],
            **kwargs
        )

        # Ensure content is in payload for backward compatibility with mod handlers
        if not hasattr(self, "payload") or not isinstance(self.payload, dict):
            self.payload = {}
        self.payload["content"] = content
        self.payload["project_id"] = project_id
        if reply_to_id:
            self.payload["reply_to_id"] = reply_to_id
        if attachments:
            self.payload["attachments"] = attachments


# Global State Messages

class ProjectGlobalStateSetMessage(BaseProjectMessage):
    """Message for setting project global state."""
    
    project_id: str
    key: str
    value: Any
    
    def __init__(self, project_id: str, key: str, value: Any, source_id: str, **kwargs):
        super().__init__(
            event_name="project.global_state.set", 
            source_id=source_id,
            project_id=project_id,
            key=key,
            value=value,
            **kwargs
        )


class ProjectGlobalStateGetMessage(BaseProjectMessage):
    """Message for getting project global state."""
    
    project_id: str
    key: str
    
    def __init__(self, project_id: str, key: str, source_id: str, **kwargs):
        super().__init__(
            event_name="project.global_state.get", 
            source_id=source_id,
            project_id=project_id,
            key=key,
            **kwargs
        )


class ProjectGlobalStateListMessage(BaseProjectMessage):
    """Message for listing project global state."""
    
    project_id: str
    
    def __init__(self, project_id: str, source_id: str, **kwargs):
        super().__init__(event_name="project.global_state.list", source_id=source_id, **kwargs)
        self.project_id = project_id


class ProjectGlobalStateDeleteMessage(BaseProjectMessage):
    """Message for deleting project global state."""
    
    project_id: str
    key: str
    
    def __init__(self, project_id: str, key: str, source_id: str, **kwargs):
        super().__init__(event_name="project.global_state.delete", source_id=source_id, **kwargs)
        self.project_id = project_id
        self.key = key


# Agent State Messages

class ProjectAgentStateSetMessage(BaseProjectMessage):
    """Message for setting agent-specific state."""
    
    project_id: str
    key: str
    value: Any
    
    def __init__(self, project_id: str, key: str, value: Any, source_id: str, **kwargs):
        super().__init__(event_name="project.agent_state.set", source_id=source_id, **kwargs)
        self.project_id = project_id
        self.key = key
        self.value = value


class ProjectAgentStateGetMessage(BaseProjectMessage):
    """Message for getting agent-specific state."""
    
    project_id: str
    key: str
    agent_id: Optional[str] = None  # Defaults to source_id
    
    def __init__(self, project_id: str, key: str, source_id: str, agent_id: Optional[str] = None, **kwargs):
        super().__init__(event_name="project.agent_state.get", source_id=source_id, **kwargs)
        self.project_id = project_id
        self.key = key
        self.agent_id = agent_id


class ProjectAgentStateListMessage(BaseProjectMessage):
    """Message for listing agent-specific state."""
    
    project_id: str
    agent_id: Optional[str] = None  # Defaults to source_id
    
    def __init__(self, project_id: str, source_id: str, agent_id: Optional[str] = None, **kwargs):
        super().__init__(event_name="project.agent_state.list", source_id=source_id, **kwargs)
        self.project_id = project_id
        self.agent_id = agent_id


class ProjectAgentStateDeleteMessage(BaseProjectMessage):
    """Message for deleting agent-specific state."""
    
    project_id: str
    key: str
    
    def __init__(self, project_id: str, key: str, source_id: str, **kwargs):
        super().__init__(event_name="project.agent_state.delete", source_id=source_id, **kwargs)
        self.project_id = project_id
        self.key = key


# Artifact Messages

class ProjectArtifactSetMessage(BaseProjectMessage):
    """Message for setting project artifacts."""
    
    project_id: str
    key: str
    value: str
    
    def __init__(self, project_id: str, key: str, value: str, source_id: str, **kwargs):
        super().__init__(event_name="project.artifact.set", source_id=source_id, **kwargs)
        self.project_id = project_id
        self.key = key
        self.value = value


class ProjectArtifactGetMessage(BaseProjectMessage):
    """Message for getting project artifacts."""
    
    project_id: str
    key: str
    
    def __init__(self, project_id: str, key: str, source_id: str, **kwargs):
        super().__init__(event_name="project.artifact.get", source_id=source_id, **kwargs)
        self.project_id = project_id
        self.key = key


class ProjectArtifactListMessage(BaseProjectMessage):
    """Message for listing project artifacts."""
    
    project_id: str
    
    def __init__(self, project_id: str, source_id: str, **kwargs):
        super().__init__(event_name="project.artifact.list", source_id=source_id, **kwargs)
        self.project_id = project_id


class ProjectArtifactDeleteMessage(BaseProjectMessage):
    """Message for deleting project artifacts."""
    
    project_id: str
    key: str
    
    def __init__(self, project_id: str, key: str, source_id: str, **kwargs):
        super().__init__(event_name="project.artifact.delete", source_id=source_id, **kwargs)
        self.project_id = project_id
        self.key = key