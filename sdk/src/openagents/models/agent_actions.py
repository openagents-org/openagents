"""
Agent action data models for OpenAgents.

This module defines Pydantic models for representing agent actions and trajectories,
enabling structured tracking of agent behaviors and decision-making processes.
"""

from typing import Dict, List, Any, Optional, Union
from datetime import datetime
from enum import Enum
from pydantic import BaseModel, Field, ConfigDict


class AgentActionType(str, Enum):
    """Types of actions an agent can perform."""

    CALL_TOOL = "call_tool"
    COMPLETE = "complete"


class AgentAction(BaseModel):
    """Represents a single action performed by an agent.

    This model captures the essential information about an agent's action,
    including its type, parameters, execution status, and results.
    """

    action_id: str = Field(..., description="Unique identifier for this action")

    action_type: AgentActionType = Field(
        ..., description="Type of action being performed"
    )

    timestamp: datetime = Field(
        default_factory=datetime.now, description="When this action was initiated"
    )

    payload: Dict[str, Any] = Field(
        default_factory=dict, description="Payload of the action"
    )


class AgentTrajectory(BaseModel):
    """Represents a sequence of actions performed by an agent over time.

    This model tracks the complete trajectory of an agent's actions,
    providing insights into behavior patterns and decision-making processes.
    """

    actions: List[AgentAction] = Field(
        default_factory=list, description="Sequence of actions in this trajectory"
    )

    summary: str = Field(description="Summary of the trajectory")
