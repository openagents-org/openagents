"""
Capability matching utilities for task routing.

This module provides:
- NormalizedCapability dataclass for unified capability format
- Normalization functions for A2A and local agents
- Default prompt template for LLM-based matching

Note: This module is designed to work with or without A2A agents.
Uses native Skill model for individual skill representation.
"""

import json
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple, TYPE_CHECKING

from openagents.models.skill import Skill

if TYPE_CHECKING:
    from openagents.models.a2a import AgentSkill


# Default prompt template for LLM-based capability matching
DEFAULT_MATCHING_PROMPT = """You are an agent capability matcher. Given a task requirement and an agent's capabilities,
determine if the agent can handle the task.

Task Requirement:
{capability_description}

Agent: {agent_id}
Capabilities:
{agent_capabilities_json}

Respond with JSON only (no markdown, no explanation):
{{"matches": true, "confidence": 0.8, "reason": "brief explanation"}}

The confidence should be between 0.0 and 1.0, where:
- 1.0 = perfect match, agent has all required capabilities
- 0.7-0.9 = good match, agent can likely handle the task
- 0.4-0.6 = partial match, agent may be able to help
- 0.0-0.3 = poor match, agent lacks key capabilities

Only set "matches" to true if confidence >= 0.5."""


@dataclass
class NormalizedCapability:
    """Unified capability format for matching across A2A and local agents."""

    agent_id: str
    agent_type: str  # "a2a" or "local"
    skills: List[str] = field(default_factory=list)  # Skill IDs or capability keys
    tags: List[str] = field(default_factory=list)
    input_modes: List[str] = field(default_factory=lambda: ["text"])
    output_modes: List[str] = field(default_factory=lambda: ["text"])
    description: Optional[str] = None
    raw_capabilities: Dict[str, Any] = field(default_factory=dict)  # Original format

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "agent_id": self.agent_id,
            "agent_type": self.agent_type,
            "skills": self.skills,
            "tags": self.tags,
            "input_modes": self.input_modes,
            "output_modes": self.output_modes,
            "description": self.description,
            "raw_capabilities": self.raw_capabilities,
        }


def normalize_a2a_agent(
    agent_id: str,
    skills: List[Any],
    description: Optional[str] = None,
    agent_card_dict: Optional[Dict] = None,
) -> NormalizedCapability:
    """Normalize A2A agent capabilities to unified format.

    Works with AgentSkill objects or any object with compatible attributes
    (id, name, description, tags, input_modes, output_modes).

    Args:
        agent_id: The agent's ID
        skills: List of skill objects (AgentSkill or compatible) from the agent card
        description: Optional agent description
        agent_card_dict: Optional full agent card as dict for raw capabilities

    Returns:
        NormalizedCapability with extracted and normalized data
    """
    skill_ids = [s.id for s in skills]
    tags = set()
    input_modes = set()
    output_modes = set()

    for skill in skills:
        tags.update(skill.tags)
        input_modes.update(skill.input_modes)
        output_modes.update(skill.output_modes)

    raw_capabilities = {
        "skills": [
            {
                "id": s.id,
                "name": s.name,
                "description": s.description,
                "tags": s.tags,
                "input_modes": s.input_modes,
                "output_modes": s.output_modes,
            }
            for s in skills
        ],
    }
    if agent_card_dict:
        raw_capabilities["card"] = agent_card_dict

    return NormalizedCapability(
        agent_id=agent_id,
        agent_type="a2a",
        skills=skill_ids,
        tags=list(tags),
        input_modes=list(input_modes) if input_modes else ["text"],
        output_modes=list(output_modes) if output_modes else ["text"],
        description=description,
        raw_capabilities=raw_capabilities,
    )


def normalize_local_agent(
    agent_id: str,
    capabilities: Dict[str, Any],
) -> NormalizedCapability:
    """Normalize local discovery agent capabilities to unified format.

    Args:
        agent_id: The agent's ID
        capabilities: Unstructured capabilities dictionary

    Returns:
        NormalizedCapability with extracted and normalized data
    """
    skills = []
    tags = []

    # Handle structured skills format (from announce_skills)
    if "skills" in capabilities and isinstance(capabilities["skills"], list):
        for skill in capabilities["skills"]:
            if isinstance(skill, dict):
                skills.append(skill.get("id", skill.get("name", str(skill))))
                tags.extend(skill.get("tags", []))
            else:
                skills.append(str(skill))

    # Extract from common capability keys
    for key, value in capabilities.items():
        if key == "skills":
            continue  # Already handled above
        elif key in ("tools", "abilities", "functions"):
            if isinstance(value, list):
                skills.extend(str(v) for v in value)
        elif key in ("tags", "categories", "labels"):
            if isinstance(value, list):
                tags.extend(str(v) for v in value)

    # Get input/output modes or defaults
    input_modes = capabilities.get("input_modes", ["text"])
    output_modes = capabilities.get("output_modes", ["text"])

    if not isinstance(input_modes, list):
        input_modes = ["text"]
    if not isinstance(output_modes, list):
        output_modes = ["text"]

    return NormalizedCapability(
        agent_id=agent_id,
        agent_type="local",
        skills=skills,
        tags=tags,
        input_modes=input_modes,
        output_modes=output_modes,
        description=capabilities.get("description"),
        raw_capabilities=capabilities,
    )


def match_structured_capabilities(
    required: Dict[str, Any],
    normalized: NormalizedCapability,
) -> bool:
    """Match agent against structured capability requirements (ALL match logic).

    Args:
        required: Dictionary with required skills, tags, input_modes, output_modes
        normalized: Normalized agent capabilities

    Returns:
        True if agent has ALL required capabilities
    """
    # Check skill IDs - agent must have ALL required skills
    if "skills" in required and required["skills"]:
        agent_skills = set(normalized.skills)
        if not all(skill in agent_skills for skill in required["skills"]):
            return False

    # Check tags - agent must have ALL required tags
    if "tags" in required and required["tags"]:
        agent_tags = set(normalized.tags)
        if not all(tag in agent_tags for tag in required["tags"]):
            return False

    # Check input modes - agent must support ALL required inputs
    if "input_modes" in required and required["input_modes"]:
        agent_inputs = set(normalized.input_modes)
        if not all(mode in agent_inputs for mode in required["input_modes"]):
            return False

    # Check output modes - agent must support ALL required outputs
    if "output_modes" in required and required["output_modes"]:
        agent_outputs = set(normalized.output_modes)
        if not all(mode in agent_outputs for mode in required["output_modes"]):
            return False

    return True


def build_llm_prompt(
    capability_description: str,
    agent_id: str,
    capabilities: Dict[str, Any],
    custom_prompt: Optional[str] = None,
) -> str:
    """Build prompt for LLM-based capability matching.

    Args:
        capability_description: Natural language description of needed capabilities
        agent_id: The agent being evaluated
        capabilities: Agent's capabilities (raw or normalized)
        custom_prompt: Optional custom prompt template

    Returns:
        Formatted prompt string
    """
    template = custom_prompt or DEFAULT_MATCHING_PROMPT
    return template.format(
        capability_description=capability_description,
        agent_id=agent_id,
        agent_capabilities_json=json.dumps(capabilities, indent=2, default=str),
    )


def parse_llm_response(response: str) -> Tuple[bool, float, str]:
    """Parse LLM response for capability matching.

    Args:
        response: Raw LLM response string

    Returns:
        Tuple of (matches, confidence, reason)
    """
    try:
        # Try to extract JSON from response
        response = response.strip()

        # Handle markdown code blocks
        if response.startswith("```"):
            lines = response.split("\n")
            json_lines = []
            in_block = False
            for line in lines:
                if line.startswith("```"):
                    in_block = not in_block
                    continue
                if in_block:
                    json_lines.append(line)
            response = "\n".join(json_lines)

        result = json.loads(response)
        matches = result.get("matches", False)
        confidence = float(result.get("confidence", 0.5))
        reason = result.get("reason", "")

        return matches, confidence, reason

    except (json.JSONDecodeError, ValueError, TypeError):
        # If parsing fails, assume no match
        return False, 0.0, "Failed to parse LLM response"
