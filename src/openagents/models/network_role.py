"""Network role definitions for OpenAgents.

This module defines the NetworkRole enum that specifies the types of
entities that can participate in the OpenAgents network.
"""

from enum import Enum


class NetworkRole(str, Enum):
    """Defines the type of destination for an event."""

    AGENT = "agent"
    CHANNEL = "channel"
    GROUP = "group"
    MOD = "mod"
    SYSTEM = "system"
    UNKNOWN = "unknown"
