"""
Native Artifact model for OpenAgents.

This is a superset of A2A Artifact, providing additional fields
for richer artifact management while maintaining A2A compatibility.
"""

from enum import Enum
from typing import Any, Dict, List, Optional, TYPE_CHECKING, Union
from pydantic import BaseModel, ConfigDict, Field

if TYPE_CHECKING:
    from openagents.models.a2a import Artifact as A2AArtifact

# Import Part types from A2A (reuse them)
from openagents.models.a2a import Part, TextPart, FilePart, DataPart


class ArtifactType(str, Enum):
    """Types of artifacts."""

    RESULT = "result"
    INTERMEDIATE = "intermediate"
    LOG = "log"
    ATTACHMENT = "attachment"


class Artifact(BaseModel):
    """Native Artifact model - superset of A2A Artifact.

    Includes all A2A Artifact fields plus OpenAgents extensions.
    """

    model_config = ConfigDict(populate_by_name=True)

    # A2A compatible fields
    name: Optional[str] = None
    description: Optional[str] = None
    parts: List[Part] = Field(default_factory=list)
    index: int = 0
    append: bool = False
    last_chunk: bool = Field(default=True, alias="lastChunk")
    metadata: Optional[Dict[str, Any]] = None

    # OpenAgents extensions
    artifact_type: ArtifactType = ArtifactType.RESULT
    source_task_id: Optional[str] = None
    source_agent_id: Optional[str] = None

    def to_a2a_artifact(self) -> "A2AArtifact":
        """Convert to A2A Artifact for protocol compatibility."""
        from openagents.models.a2a import Artifact as A2AArtifact

        return A2AArtifact(
            name=self.name,
            description=self.description,
            parts=self.parts,
            index=self.index,
            append=self.append,
            last_chunk=self.last_chunk,
            metadata=self.metadata,
        )

    @classmethod
    def from_a2a_artifact(cls, a2a_artifact: "A2AArtifact") -> "Artifact":
        """Create from A2A Artifact."""
        return cls(
            name=a2a_artifact.name,
            description=a2a_artifact.description,
            parts=a2a_artifact.parts,
            index=a2a_artifact.index,
            append=a2a_artifact.append,
            last_chunk=a2a_artifact.last_chunk,
            metadata=a2a_artifact.metadata,
        )
