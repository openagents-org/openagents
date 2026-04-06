"""
A2A Delegation utilities for Task Delegation mod.

This module provides utilities for A2A protocol compatibility:
- Delegation metadata creation and extraction
- Task creation and management utilities
- Progress reporting and result artifact helpers
"""

import time
import uuid
from typing import Any, Dict, List, Optional

from openagents.models.a2a import (
    A2AMessage,
    Artifact,
    DataPart,
    Role,
    Task,
    TaskState,
    TaskStatus,
    TextPart,
)


# =============================================================================
# Constants
# =============================================================================

# Terminal states that indicate task completion (success or failure)
TERMINAL_STATES = {
    TaskState.COMPLETED,
    TaskState.FAILED,
    TaskState.CANCELED,
    TaskState.REJECTED,
}

# Default timeout in seconds
DEFAULT_TIMEOUT_SECONDS = 300


# =============================================================================
# Delegation Metadata Helpers
# =============================================================================


def create_delegation_metadata(
    delegator_id: str,
    assignee_id: str,
    description: str,
    payload: Optional[Dict[str, Any]] = None,
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
    is_external_delegator: bool = False,
    is_external_assignee: bool = False,
    delegator_url: Optional[str] = None,
    assignee_url: Optional[str] = None,
) -> Dict[str, Any]:
    """Create delegation metadata for an A2A Task.

    Args:
        delegator_id: ID of the agent delegating the task
        assignee_id: ID of the agent assigned to the task
        description: Human-readable task description
        payload: Optional task data/parameters
        timeout_seconds: Timeout duration in seconds
        is_external_delegator: True if delegator is an external A2A agent
        is_external_assignee: True if assignee is an external A2A agent
        delegator_url: A2A URL if external delegator
        assignee_url: A2A URL if external assignee

    Returns:
        Metadata dictionary for the A2A Task
    """
    return {
        "delegation": {
            "delegator_id": delegator_id,
            "assignee_id": assignee_id,
            "description": description,
            "timeout_seconds": timeout_seconds,
            "created_at": time.time(),
            "completed_at": None,
            "is_external_delegator": is_external_delegator,
            "is_external_assignee": is_external_assignee,
            "delegator_url": delegator_url,
            "assignee_url": assignee_url,
        },
        "payload": payload or {},
        "progress_summary": {
            "total_reports": 0,
            "last_report_at": None,
        },
        "error_details": {
            "error": None,
            "is_timeout": False,
        },
    }


def extract_delegation_metadata(task: Task) -> Dict[str, Any]:
    """Extract delegation-specific metadata from an A2A Task.

    Args:
        task: The A2A Task to extract metadata from

    Returns:
        Dictionary with delegation fields, or empty dict if not a delegation task
    """
    if not task.metadata:
        return {}

    delegation = task.metadata.get("delegation", {})
    return {
        "delegator_id": delegation.get("delegator_id"),
        "assignee_id": delegation.get("assignee_id"),
        "description": delegation.get("description"),
        "timeout_seconds": delegation.get("timeout_seconds", DEFAULT_TIMEOUT_SECONDS),
        "created_at": delegation.get("created_at"),
        "completed_at": delegation.get("completed_at"),
        "is_external_delegator": delegation.get("is_external_delegator", False),
        "is_external_assignee": delegation.get("is_external_assignee", False),
        "delegator_url": delegation.get("delegator_url"),
        "assignee_url": delegation.get("assignee_url"),
        "payload": task.metadata.get("payload", {}),
        "error": task.metadata.get("error_details", {}).get("error"),
        "is_timeout": task.metadata.get("error_details", {}).get("is_timeout", False),
    }


def update_delegation_metadata(
    task: Task,
    completed_at: Optional[float] = None,
    error: Optional[str] = None,
    is_timeout: bool = False,
) -> Dict[str, Any]:
    """Update delegation metadata with completion information.

    Args:
        task: The A2A Task to update
        completed_at: Completion timestamp
        error: Error message if failed
        is_timeout: Whether failure was due to timeout

    Returns:
        Updated metadata dictionary
    """
    metadata = dict(task.metadata) if task.metadata else {}

    if "delegation" not in metadata:
        metadata["delegation"] = {}

    if completed_at is not None:
        metadata["delegation"]["completed_at"] = completed_at

    if "error_details" not in metadata:
        metadata["error_details"] = {}

    if error is not None:
        metadata["error_details"]["error"] = error
        metadata["error_details"]["is_timeout"] = is_timeout

    return metadata


def increment_progress_count(task: Task) -> Dict[str, Any]:
    """Increment the progress report count in metadata.

    Args:
        task: The A2A Task to update

    Returns:
        Updated metadata dictionary
    """
    metadata = dict(task.metadata) if task.metadata else {}

    if "progress_summary" not in metadata:
        metadata["progress_summary"] = {"total_reports": 0, "last_report_at": None}

    metadata["progress_summary"]["total_reports"] += 1
    metadata["progress_summary"]["last_report_at"] = time.time()

    return metadata


# =============================================================================
# Task Creation Helpers
# =============================================================================


def create_delegation_task(
    delegator_id: str,
    assignee_id: str,
    description: str,
    payload: Optional[Dict[str, Any]] = None,
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
    context_id: Optional[str] = None,
    is_external_delegator: bool = False,
    is_external_assignee: bool = False,
    delegator_url: Optional[str] = None,
    assignee_url: Optional[str] = None,
) -> Task:
    """Create an A2A Task for a delegation request.

    Args:
        delegator_id: ID of the agent delegating the task
        assignee_id: ID of the agent assigned to the task
        description: Human-readable task description
        payload: Optional task data/parameters
        timeout_seconds: Timeout duration in seconds
        context_id: Optional context ID for multi-turn conversations
        is_external_delegator: True if delegator is an external A2A agent
        is_external_assignee: True if assignee is an external A2A agent
        delegator_url: A2A URL if external delegator
        assignee_url: A2A URL if external assignee

    Returns:
        New A2A Task in SUBMITTED state
    """
    metadata = create_delegation_metadata(
        delegator_id=delegator_id,
        assignee_id=assignee_id,
        description=description,
        payload=payload,
        timeout_seconds=timeout_seconds,
        is_external_delegator=is_external_delegator,
        is_external_assignee=is_external_assignee,
        delegator_url=delegator_url,
        assignee_url=assignee_url,
    )

    # Create initial message describing the task
    initial_message = A2AMessage(
        role=Role.USER,
        parts=[
            TextPart(text=description),
            DataPart(data=payload or {}),
        ],
        metadata={"delegator_id": delegator_id},
    )

    return Task(
        id=str(uuid.uuid4()),
        context_id=context_id or str(uuid.uuid4()),
        status=TaskStatus(state=TaskState.SUBMITTED),
        artifacts=[],
        history=[initial_message],
        metadata=metadata,
    )


def create_progress_message(
    message: str,
    data: Optional[Dict[str, Any]] = None,
    reporter_id: Optional[str] = None,
) -> A2AMessage:
    """Create an A2A Message for a progress report.

    Args:
        message: Progress message text
        data: Optional progress data
        reporter_id: ID of the agent reporting progress

    Returns:
        A2AMessage representing the progress report
    """
    parts = [TextPart(text=message)]
    if data:
        parts.append(DataPart(data=data))

    return A2AMessage(
        role=Role.AGENT,
        parts=parts,
        metadata={
            "type": "progress_report",
            "reporter_id": reporter_id,
            "timestamp": time.time(),
        },
    )


def create_result_artifact(
    result: Any,
    name: str = "result",
    description: Optional[str] = None,
) -> Artifact:
    """Create an A2A Artifact for a task result.

    Args:
        result: Result data (can be string, dict, list, or any type)
        name: Artifact name
        description: Optional artifact description

    Returns:
        Artifact containing the result
    """
    parts = []

    # Handle different result types
    if isinstance(result, str):
        # For strings, add as TextPart and wrap in DataPart
        parts.append(TextPart(text=result))
        parts.append(DataPart(data={"value": result}))
    elif isinstance(result, dict):
        # For dicts, use existing logic
        if "text" in result:
            parts.append(TextPart(text=result["text"]))
        parts.append(DataPart(data=result))
    else:
        # For other types (list, number, etc.), wrap in a dict
        parts.append(DataPart(data={"value": result}))

    return Artifact(
        name=name,
        description=description,
        parts=parts,
        index=0,
        metadata={"created_at": time.time()},
    )


# =============================================================================
# Task Inspection Helpers
# =============================================================================


def is_delegation_task(task: Task) -> bool:
    """Check if an A2A Task is a delegation task.

    Args:
        task: The A2A Task to check

    Returns:
        True if task has delegation metadata
    """
    return bool(task.metadata and "delegation" in task.metadata)


def is_task_expired(task: Task) -> bool:
    """Check if a delegation task has exceeded its timeout.

    Args:
        task: The A2A Task to check

    Returns:
        True if task has timed out
    """
    if task.status.state in TERMINAL_STATES:
        return False

    delegation = extract_delegation_metadata(task)
    created_at = delegation.get("created_at")
    timeout_seconds = delegation.get("timeout_seconds", DEFAULT_TIMEOUT_SECONDS)

    if not created_at:
        return False

    elapsed = time.time() - created_at
    return elapsed > timeout_seconds
