"""
Native Skill model for OpenAgents.

This is a superset of A2A AgentSkill, providing additional fields
for richer skill definitions while maintaining A2A compatibility.
"""

from typing import Any, Dict, List, Optional, TYPE_CHECKING
from pydantic import BaseModel, ConfigDict, Field

if TYPE_CHECKING:
    from openagents.models.a2a import AgentSkill


class Skill(BaseModel):
    """Native Skill model - superset of A2A AgentSkill.

    Includes all A2A AgentSkill fields plus OpenAgents extensions.
    """

    model_config = ConfigDict(populate_by_name=True)

    # A2A compatible fields
    id: str
    name: str
    description: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    input_modes: List[str] = Field(default_factory=lambda: ["text"], alias="inputModes")
    output_modes: List[str] = Field(default_factory=lambda: ["text"], alias="outputModes")
    examples: List[str] = Field(default_factory=list)

    # OpenAgents extensions
    version: Optional[str] = None
    is_enabled: bool = True
    metadata: Optional[Dict[str, Any]] = None

    def to_a2a_skill(self) -> "AgentSkill":
        """Convert to A2A AgentSkill for protocol compatibility."""
        from openagents.models.a2a import AgentSkill

        return AgentSkill(
            id=self.id,
            name=self.name,
            description=self.description,
            tags=self.tags,
            input_modes=self.input_modes,
            output_modes=self.output_modes,
            examples=self.examples,
        )

    @classmethod
    def from_a2a_skill(cls, a2a_skill: "AgentSkill") -> "Skill":
        """Create from A2A AgentSkill."""
        return cls(
            id=a2a_skill.id,
            name=a2a_skill.name,
            description=a2a_skill.description,
            tags=a2a_skill.tags,
            input_modes=a2a_skill.input_modes,
            output_modes=a2a_skill.output_modes,
            examples=a2a_skill.examples,
        )
