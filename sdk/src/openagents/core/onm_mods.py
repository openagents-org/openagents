# -*- coding: utf-8 -*-
"""
ONM Mods — ordered event pipeline interceptors.

Mods are the primary extensibility mechanism of the ONM. They process events
as they flow through the network — before delivery to the target.

Three modes:
  - guard:     Can reject events. Cannot modify. (auth, rate limiting, validation)
  - transform: Can modify events. Cannot reject. (enrichment, routing logic)
  - observe:   Cannot modify or reject. (logging, persistence, analytics)

Pipeline order: guard → transform → observe (sorted by priority within each mode).
"""

import fnmatch
import logging
from abc import ABC, abstractmethod
from typing import List, Optional

from openagents.core.onm_events import Event

logger = logging.getLogger(__name__)


class Mod(ABC):
    """
    Base class for all mods in the event pipeline.

    Subclasses must set name, intercepts, priority, and mode, and implement process().
    """
    name: str = ""                  # e.g., "auth", "persistence"
    intercepts: List[str] = []      # Event type patterns (e.g., ["workspace.message.*"])
    priority: int = 50              # Lower = earlier in pipeline
    mode: str = "observe"           # "guard" | "transform" | "observe"

    def matches(self, event_type: str) -> bool:
        """Check if this mod should process an event of the given type."""
        if not self.intercepts:
            return True  # Empty intercepts = match all
        return any(fnmatch.fnmatch(event_type, pattern) for pattern in self.intercepts)

    @abstractmethod
    async def process(self, event: Event, context: "PipelineContext") -> Optional[Event]:
        """
        Process an event flowing through the pipeline.

        For guard mods: return None to reject, return event to pass through.
        For transform mods: return the (possibly modified) event.
        For observe mods: return value is ignored. Do side effects only.
        """
        ...


class GuardMod(Mod):
    """
    Guard mod — can reject events, cannot modify them.

    Return None from process() to reject. Return the event to pass through.
    Rejecting an event stops the pipeline and sends network.event.error to the source.
    """
    mode = "guard"


class TransformMod(Mod):
    """
    Transform mod — can modify events, cannot reject them.

    Return the modified event from process(). The pipeline continues with
    the modified event.
    """
    mode = "transform"


class ObserveMod(Mod):
    """
    Observe mod — cannot modify or reject events.

    Perform side effects only (logging, persistence, analytics).
    Return value is ignored.
    """
    mode = "observe"


class PipelineContext:
    """
    Context object passed through the pipeline alongside an event.

    Carries network/agent metadata and accumulates side-effect events
    emitted by mods.
    """
    def __init__(self, network_id: str, agent_address: str = "", **extra: object):
        self.network_id = network_id
        self.agent_address = agent_address
        self.side_effects: List[Event] = []
        self.extra = extra

    def emit(self, event: Event) -> None:
        """Emit a side-effect event (e.g., mod/presence emitting agent.leave on timeout)."""
        self.side_effects.append(event)


class EventRejected(Exception):
    """Raised when a guard mod rejects an event."""
    def __init__(self, mod_name: str, reason: str):
        self.mod_name = mod_name
        self.reason = reason
        super().__init__(f"Event rejected by mod/{mod_name}: {reason}")
