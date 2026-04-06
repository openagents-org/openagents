"""
Converters between Native OpenAgents models and A2A protocol models.

This module provides standalone conversion functions. The models themselves
also have to_a2a_* and from_a2a_* methods for convenience.

Conversion guarantees:
- Native -> A2A -> Native : Preserves all data (extensions stored in metadata)
- A2A -> Native -> A2A : Exact reproduction of A2A fields
"""

from typing import Optional

from openagents.models.a2a import (
    AgentCard,
    AgentSkill,
    Artifact as A2AArtifact,
    Task as A2ATask,
)
from openagents.models.skill import Skill
from openagents.models.artifact import Artifact
from openagents.models.task import Task
from openagents.models.profile import AgentProfile


# =============================================================================
# Skill Converters
# =============================================================================


def skill_to_a2a(skill: Skill) -> AgentSkill:
    """Convert native Skill to A2A AgentSkill."""
    return skill.to_a2a_skill()


def a2a_to_skill(a2a_skill: AgentSkill) -> Skill:
    """Convert A2A AgentSkill to native Skill."""
    return Skill.from_a2a_skill(a2a_skill)


# =============================================================================
# Artifact Converters
# =============================================================================


def artifact_to_a2a(artifact: Artifact) -> A2AArtifact:
    """Convert native Artifact to A2A Artifact."""
    return artifact.to_a2a_artifact()


def a2a_to_artifact(a2a_artifact: A2AArtifact) -> Artifact:
    """Convert A2A Artifact to native Artifact."""
    return Artifact.from_a2a_artifact(a2a_artifact)


# =============================================================================
# Task Converters
# =============================================================================


def task_to_a2a(task: Task) -> A2ATask:
    """Convert native Task to A2A Task.

    Native extensions (priority, delegator_id, assignee_id, native state)
    are stored in metadata["_native"] for round-trip preservation.
    """
    return task.to_a2a_task()


def a2a_to_task(a2a_task: A2ATask) -> Task:
    """Convert A2A Task to native Task.

    If metadata["_native"] exists, native extensions are restored.
    Otherwise, A2A state is mapped to closest native state.
    """
    return Task.from_a2a_task(a2a_task)


# =============================================================================
# Profile Converters
# =============================================================================


def profile_to_a2a_card(profile: AgentProfile) -> AgentCard:
    """Convert native AgentProfile to A2A AgentCard."""
    return profile.to_a2a_card()


def a2a_card_to_profile(card: AgentCard, agent_id: Optional[str] = None) -> AgentProfile:
    """Convert A2A AgentCard to native AgentProfile."""
    return AgentProfile.from_a2a_card(card, agent_id=agent_id)
