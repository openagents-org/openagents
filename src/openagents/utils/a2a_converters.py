"""
A2A Event Names and Converters for OpenAgents.

This module provides:
- Event name constants for A2A protocol integration
- Conversion utilities between OpenAgents Events and A2A Messages/Tasks
"""

from typing import Dict, Any, Optional, List
import uuid
import time

from openagents.models.event import Event
from openagents.models.a2a import (
    Task,
    TaskState,
    TaskStatus,
    A2AMessage,
    Part,
    TextPart,
    DataPart,
    FilePart,
    Artifact,
    Role,
    parse_parts,
)


class A2ATaskEventNames:
    """A2A task event name constants for OpenAgents.

    Event naming convention: agent.task.{category}.{action}
    """

    # === TASK LIFECYCLE ===
    CREATED = "agent.task.created"
    SUBMITTED = "agent.task.submitted"
    WORKING = "agent.task.working"
    COMPLETED = "agent.task.completed"
    FAILED = "agent.task.failed"
    CANCELED = "agent.task.canceled"
    REJECTED = "agent.task.rejected"
    INPUT_REQUIRED = "agent.task.input_required"
    AUTH_REQUIRED = "agent.task.auth_required"

    # === TASK OPERATIONS ===
    MESSAGE_RECEIVED = "agent.task.message.received"
    MESSAGE_SENT = "agent.task.message.sent"
    GET = "agent.task.get"
    LIST = "agent.task.list"
    CANCEL = "agent.task.cancel"
    ARTIFACT_ADDED = "agent.task.artifact.added"
    ARTIFACT_UPDATED = "agent.task.artifact.updated"
    HISTORY_UPDATED = "agent.task.history.updated"
    STATUS_UPDATED = "agent.task.status.updated"

    # === TASK NOTIFICATIONS ===
    NOTIFICATION_SENT = "agent.task.notification.sent"
    NOTIFICATION_FAILED = "agent.task.notification.failed"
    NOTIFICATION_ACKNOWLEDGED = "agent.task.notification.acknowledged"
    NOTIFICATION_CONFIG_SET = "agent.task.notification.config.set"
    NOTIFICATION_CONFIG_GET = "agent.task.notification.config.get"
    NOTIFICATION_CONFIG_DELETED = "agent.task.notification.config.deleted"
    NOTIFICATION_SUBSCRIBED = "agent.task.notification.subscribed"
    NOTIFICATION_UNSUBSCRIBED = "agent.task.notification.unsubscribed"
    NOTIFICATION_STREAM_STARTED = "agent.task.notification.stream.started"
    NOTIFICATION_STREAM_ENDED = "agent.task.notification.stream.ended"

    # === TASK CONTEXT ===
    CONTEXT_CREATED = "agent.task.context.created"
    CONTEXT_CONTINUED = "agent.task.context.continued"
    CONTEXT_CLOSED = "agent.task.context.closed"

    # === TASK DISCOVERY ===
    DISCOVERY_CARD_REQUESTED = "agent.task.discovery.card_requested"
    DISCOVERY_CARD_EXTENDED = "agent.task.discovery.card_extended"
    DISCOVERY_SKILLS_LISTED = "agent.task.discovery.skills_listed"

    # === TASK OUTBOUND ===
    OUTBOUND_CREATED = "agent.task.outbound.created"
    OUTBOUND_SENT = "agent.task.outbound.sent"
    OUTBOUND_RECEIVED = "agent.task.outbound.received"
    OUTBOUND_COMPLETED = "agent.task.outbound.completed"
    OUTBOUND_FAILED = "agent.task.outbound.failed"
    OUTBOUND_AGENT_DISCOVERED = "agent.task.outbound.agent_discovered"
    OUTBOUND_AGENT_UNAVAILABLE = "agent.task.outbound.agent_unavailable"

    # === TASK TRANSPORT ===
    TRANSPORT_STARTED = "agent.task.transport.started"
    TRANSPORT_STOPPED = "agent.task.transport.stopped"
    TRANSPORT_ERROR = "agent.task.transport.error"


# Mapping from TaskState to event name
TASK_STATE_TO_EVENT: Dict[TaskState, str] = {
    TaskState.SUBMITTED: A2ATaskEventNames.SUBMITTED,
    TaskState.WORKING: A2ATaskEventNames.WORKING,
    TaskState.COMPLETED: A2ATaskEventNames.COMPLETED,
    TaskState.FAILED: A2ATaskEventNames.FAILED,
    TaskState.CANCELED: A2ATaskEventNames.CANCELED,
    TaskState.REJECTED: A2ATaskEventNames.REJECTED,
    TaskState.INPUT_REQUIRED: A2ATaskEventNames.INPUT_REQUIRED,
    TaskState.AUTH_REQUIRED: A2ATaskEventNames.AUTH_REQUIRED,
}

# Mapping from event name to TaskState
EVENT_TO_TASK_STATE: Dict[str, TaskState] = {v: k for k, v in TASK_STATE_TO_EVENT.items()}


def a2a_message_to_event(
    message: A2AMessage,
    task_id: str,
    context_id: Optional[str] = None,
    source_id: str = "a2a:external",
    destination_id: str = "system",
) -> Event:
    """Convert an A2A Message to an OpenAgents Event.

    Args:
        message: The A2A message to convert
        task_id: The task ID this message belongs to
        context_id: Optional context ID for multi-turn conversations
        source_id: Source identifier for the event
        destination_id: Destination for the event

    Returns:
        OpenAgents Event representing the A2A message
    """
    # Extract content from parts
    text_content = ""
    data_content: Dict[str, Any] = {}
    files: List[Dict[str, Any]] = []

    for part in message.parts:
        if isinstance(part, TextPart):
            text_content += part.text
        elif isinstance(part, DataPart):
            data_content.update(part.data)
        elif isinstance(part, FilePart):
            files.append({
                "name": part.name,
                "mime_type": part.mime_type,
                "uri": part.uri,
            })

    # Build thread name for context tracking
    thread_name = f"a2a:{context_id}" if context_id else f"a2a:{task_id}"

    return Event(
        event_name=A2ATaskEventNames.MESSAGE_RECEIVED,
        source_id=source_id,
        destination_id=destination_id,
        thread_name=thread_name,
        payload={
            "text": text_content,
            "data": data_content,
            "files": files,
            "role": message.role.value,
        },
        metadata={
            "a2a_task_id": task_id,
            "a2a_context_id": context_id,
            "a2a_message_metadata": message.metadata,
        },
    )


def event_to_a2a_message(event: Event) -> A2AMessage:
    """Convert an OpenAgents Event to an A2A Message.

    Args:
        event: The OpenAgents event to convert

    Returns:
        A2A Message representing the event
    """
    parts: List[Part] = []

    # Extract text content
    text = event.payload.get("text") or event.text_representation
    if text:
        parts.append(TextPart(text=text))

    # Extract data content
    data = event.payload.get("data")
    if data and isinstance(data, dict):
        parts.append(DataPart(data=data))

    # Extract file content
    files = event.payload.get("files", [])
    for f in files:
        parts.append(FilePart(
            name=f.get("name", "file"),
            mime_type=f.get("mime_type"),
            uri=f.get("uri"),
        ))

    # If no parts extracted, use full payload as data
    if not parts:
        parts.append(DataPart(data=event.payload))

    # Determine role - check payload first, then fall back to source type
    payload_role = event.payload.get("role")
    if payload_role:
        role = Role(payload_role)
    else:
        role = Role.AGENT if event.source_type == "agent" else Role.USER

    return A2AMessage(
        role=role,
        parts=parts,
        metadata=event.metadata,
    )


def event_to_a2a_artifact(event: Event, index: int = 0) -> Artifact:
    """Convert an OpenAgents Event to an A2A Artifact.

    Args:
        event: The OpenAgents event to convert
        index: Artifact index (for multiple artifacts)

    Returns:
        A2A Artifact representing the event
    """
    parts: List[Part] = []

    # Extract text content
    text = event.payload.get("text") or event.text_representation
    if text:
        parts.append(TextPart(text=text))

    # Extract data content
    data = event.payload.get("data")
    if data:
        parts.append(DataPart(data=data))

    # If no parts, use full payload
    if not parts:
        parts.append(DataPart(data=event.payload))

    return Artifact(
        name=event.payload.get("artifact_name"),
        description=event.payload.get("artifact_description"),
        parts=parts,
        index=index,
        metadata=event.metadata,
    )


def create_task_from_message(
    message: A2AMessage,
    context_id: Optional[str] = None,
) -> Task:
    """Create a new A2A Task from an incoming message.

    Args:
        message: The A2A message that initiates the task
        context_id: Optional context ID for conversation grouping

    Returns:
        New Task in SUBMITTED state
    """
    return Task(
        id=str(uuid.uuid4()),
        context_id=context_id or str(uuid.uuid4()),
        status=TaskStatus(state=TaskState.SUBMITTED),
        history=[message],
        metadata={},
    )


def create_task_status_event(
    task_id: str,
    state: TaskState,
    context_id: Optional[str] = None,
    message: Optional[str] = None,
) -> Event:
    """Create an event for a task status change.

    Args:
        task_id: The task ID
        state: The new task state
        context_id: Optional context ID
        message: Optional status message

    Returns:
        Event representing the status change
    """
    event_name = TASK_STATE_TO_EVENT.get(state, A2ATaskEventNames.STATUS_UPDATED)

    return Event(
        event_name=event_name,
        source_id="a2a:transport",
        payload={
            "task_id": task_id,
            "state": state.value,
            "message": message,
        },
        metadata={
            "a2a_task_id": task_id,
            "a2a_context_id": context_id,
        },
    )


def create_artifact_event(
    task_id: str,
    artifact: Artifact,
    context_id: Optional[str] = None,
) -> Event:
    """Create an event for an artifact being added.

    Args:
        task_id: The task ID
        artifact: The artifact being added
        context_id: Optional context ID

    Returns:
        Event representing the artifact addition
    """
    return Event(
        event_name=A2ATaskEventNames.ARTIFACT_ADDED,
        source_id="a2a:transport",
        payload={
            "task_id": task_id,
            "artifact": artifact.model_dump(by_alias=True, exclude_none=True),
        },
        metadata={
            "a2a_task_id": task_id,
            "a2a_context_id": context_id,
        },
    )


def extract_text_from_parts(parts: List[Part]) -> str:
    """Extract all text content from a list of parts.

    Args:
        parts: List of A2A parts

    Returns:
        Concatenated text content
    """
    text_parts = []
    for part in parts:
        if isinstance(part, TextPart):
            text_parts.append(part.text)
    return " ".join(text_parts)


def extract_data_from_parts(parts: List[Part]) -> Dict[str, Any]:
    """Extract all data content from a list of parts.

    Args:
        parts: List of A2A parts

    Returns:
        Merged data dictionary
    """
    data: Dict[str, Any] = {}
    for part in parts:
        if isinstance(part, DataPart):
            data.update(part.data)
    return data
