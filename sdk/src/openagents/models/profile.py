"""
Native AgentProfile model for OpenAgents.

This is a superset of A2A AgentCard, providing additional fields
for richer agent profiles while maintaining A2A compatibility.
"""

from typing import Any, Dict, List, Optional, TYPE_CHECKING
from pydantic import BaseModel, ConfigDict, Field

if TYPE_CHECKING:
    from openagents.models.a2a import AgentCard

from openagents.models.skill import Skill


class AgentProfile(BaseModel):
    """Native AgentProfile model - superset of A2A AgentCard.

    Includes all A2A AgentCard fields plus OpenAgents extensions.
    """

    model_config = ConfigDict(populate_by_name=True)

    # A2A compatible fields
    name: str
    version: str = "1.0.0"
    description: Optional[str] = None
    url: Optional[str] = None  # Optional for local agents
    protocol_version: str = Field(default="0.3", alias="protocolVersion")
    skills: List[Skill] = Field(default_factory=list)
    default_input_modes: List[str] = Field(
        default_factory=lambda: ["text"], alias="defaultInputModes"
    )
    default_output_modes: List[str] = Field(
        default_factory=lambda: ["text"], alias="defaultOutputModes"
    )

    # OpenAgents extensions
    agent_id: Optional[str] = None
    agent_type: str = "local"  # "local" or "a2a"
    is_available: bool = True
    metadata: Optional[Dict[str, Any]] = None

    def to_a2a_card(self) -> "AgentCard":
        """Convert to A2A AgentCard for protocol compatibility."""
        from openagents.models.a2a import AgentCard, AgentCapabilities

        return AgentCard(
            name=self.name,
            version=self.version,
            description=self.description,
            url=self.url or "",
            protocol_version=self.protocol_version,
            skills=[s.to_a2a_skill() for s in self.skills],
            capabilities=AgentCapabilities(),
            default_input_modes=self.default_input_modes,
            default_output_modes=self.default_output_modes,
        )

    @classmethod
    def from_a2a_card(cls, card: "AgentCard", agent_id: Optional[str] = None) -> "AgentProfile":
        """Create from A2A AgentCard."""
        return cls(
            name=card.name,
            version=card.version,
            description=card.description,
            url=card.url,
            protocol_version=card.protocol_version,
            skills=[Skill.from_a2a_skill(s) for s in card.skills],
            default_input_modes=card.default_input_modes,
            default_output_modes=card.default_output_modes,
            agent_id=agent_id,
            agent_type="a2a",
        )
