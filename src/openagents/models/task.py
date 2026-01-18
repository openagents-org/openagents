"""
Native Task model for OpenAgents.

This is a superset of A2A Task, providing additional fields
for richer task management while maintaining A2A compatibility.
"""

import uuid
from enum import Enum
from typing import Any, Dict, List, Optional, TYPE_CHECKING
from pydantic import BaseModel, ConfigDict, Field

if TYPE_CHECKING:
    from openagents.models.a2a import Task as A2ATask

from openagents.models.artifact import Artifact


class TaskState(str, Enum):
    """Task states - superset of A2A TaskState."""

    # A2A standard states
    SUBMITTED = "submitted"
    WORKING = "working"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELED = "canceled"
    REJECTED = "rejected"
    INPUT_REQUIRED = "input-required"

    # OpenAgents extensions
    PENDING = "pending"
    DELEGATED = "delegated"


class TaskPriority(str, Enum):
    """Task priority levels."""

    HIGH = "high"
    NORMAL = "normal"
    LOW = "low"


class Task(BaseModel):
    """Native Task model - superset of A2A Task.

    Includes all A2A Task fields plus OpenAgents extensions.
    """

    model_config = ConfigDict(populate_by_name=True)

    # A2A compatible fields
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    context_id: Optional[str] = Field(default=None, alias="contextId")
    state: TaskState = TaskState.PENDING
    artifacts: List[Artifact] = Field(default_factory=list)
    metadata: Optional[Dict[str, Any]] = None

    # OpenAgents extensions
    priority: TaskPriority = TaskPriority.NORMAL
    delegator_id: Optional[str] = None
    assignee_id: Optional[str] = None

    def to_a2a_task(self) -> "A2ATask":
        """Convert to A2A Task for protocol compatibility."""
        from openagents.models.a2a import Task as A2ATask, TaskStatus, TaskState as A2ATaskState

        # Map native state to A2A state
        a2a_state_map = {
            TaskState.SUBMITTED: A2ATaskState.SUBMITTED,
            TaskState.WORKING: A2ATaskState.WORKING,
            TaskState.COMPLETED: A2ATaskState.COMPLETED,
            TaskState.FAILED: A2ATaskState.FAILED,
            TaskState.CANCELED: A2ATaskState.CANCELED,
            TaskState.REJECTED: A2ATaskState.REJECTED,
            TaskState.INPUT_REQUIRED: A2ATaskState.INPUT_REQUIRED,
            # Extensions map to closest A2A state
            TaskState.PENDING: A2ATaskState.SUBMITTED,
            TaskState.DELEGATED: A2ATaskState.WORKING,
        }

        a2a_state = a2a_state_map.get(self.state, A2ATaskState.UNKNOWN)

        # Store native extensions in metadata
        extended_metadata = dict(self.metadata) if self.metadata else {}
        extended_metadata["_native"] = {
            "state": self.state.value,
            "priority": self.priority.value,
            "delegator_id": self.delegator_id,
            "assignee_id": self.assignee_id,
        }

        return A2ATask(
            id=self.id,
            context_id=self.context_id,
            status=TaskStatus(state=a2a_state),
            artifacts=[a.to_a2a_artifact() for a in self.artifacts],
            history=[],
            metadata=extended_metadata,
        )

    @classmethod
    def from_a2a_task(cls, a2a_task: "A2ATask") -> "Task":
        """Create from A2A Task."""
        from openagents.models.a2a import TaskState as A2ATaskState

        # Map A2A state to native state
        state_map = {
            A2ATaskState.SUBMITTED: TaskState.SUBMITTED,
            A2ATaskState.WORKING: TaskState.WORKING,
            A2ATaskState.COMPLETED: TaskState.COMPLETED,
            A2ATaskState.FAILED: TaskState.FAILED,
            A2ATaskState.CANCELED: TaskState.CANCELED,
            A2ATaskState.REJECTED: TaskState.REJECTED,
            A2ATaskState.INPUT_REQUIRED: TaskState.INPUT_REQUIRED,
            A2ATaskState.UNKNOWN: TaskState.PENDING,
        }

        # Check for native extensions in metadata
        metadata = dict(a2a_task.metadata) if a2a_task.metadata else {}
        native_data = metadata.pop("_native", None)

        if native_data:
            # Restore native state and extensions
            state = TaskState(native_data.get("state", TaskState.PENDING.value))
            priority = TaskPriority(native_data.get("priority", TaskPriority.NORMAL.value))
            delegator_id = native_data.get("delegator_id")
            assignee_id = native_data.get("assignee_id")
        else:
            # Map from A2A state
            state = state_map.get(a2a_task.status.state, TaskState.PENDING)
            priority = TaskPriority.NORMAL
            delegator_id = None
            assignee_id = None

        return cls(
            id=a2a_task.id,
            context_id=a2a_task.context_id,
            state=state,
            artifacts=[Artifact.from_a2a_artifact(a) for a in a2a_task.artifacts],
            metadata=metadata if metadata else None,
            priority=priority,
            delegator_id=delegator_id,
            assignee_id=assignee_id,
        )
