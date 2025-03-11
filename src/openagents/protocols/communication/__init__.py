"""
Communication protocols for OpenAgents.

This package contains protocols for agent communication.
"""

# Import submodules
from . import messaging
from . import topic_subscription

__all__ = ["messaging", "topic_subscription"] 