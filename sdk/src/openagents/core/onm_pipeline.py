# -*- coding: utf-8 -*-
"""
ONM Pipeline — ordered event processing through mods.

Events flow through mods in priority order:

    Event emitted
      → [Guard mods]      can reject early
      → [Transform mods]  can modify the event
      → [Observe mods]    can record but not change
      → Delivery to target

A guard mod that rejects an event stops the pipeline. The event is not
delivered and an EventRejected exception is raised.
"""

import logging
from typing import List, Optional

from openagents.core.onm_events import Event
from openagents.core.onm_mods import (
    EventRejected,
    Mod,
    PipelineContext,
)

logger = logging.getLogger(__name__)

# Canonical mode ordering
_MODE_ORDER = {"guard": 0, "transform": 1, "observe": 2}


class Pipeline:
    """
    Ordered event pipeline. Events flow through guard → transform → observe mods.

    Mods are sorted first by mode (guard < transform < observe), then by priority
    within each mode (lower number = earlier).
    """

    def __init__(self, mods: Optional[List[Mod]] = None):
        self._mods: List[Mod] = []
        for mod in (mods or []):
            self._mods.append(mod)
        self._sort()

    def _sort(self) -> None:
        self._mods.sort(key=lambda m: (_MODE_ORDER.get(m.mode, 99), m.priority))

    def add_mod(self, mod: Mod) -> None:
        """Add a mod to the pipeline and re-sort."""
        self._mods.append(mod)
        self._sort()

    def remove_mod(self, name: str) -> None:
        """Remove a mod by name."""
        self._mods = [m for m in self._mods if m.name != name]

    @property
    def mods(self) -> List[Mod]:
        return list(self._mods)

    async def process(self, event: Event, context: PipelineContext) -> Event:
        """
        Run an event through the full mod pipeline.

        Args:
            event: The event to process.
            context: Pipeline context (network info, side-effect accumulator).

        Returns:
            The (possibly transformed) event after passing through all mods.

        Raises:
            EventRejected: If a guard mod rejects the event.
        """
        for mod in self._mods:
            if not mod.matches(event.type):
                continue

            try:
                if mod.mode == "guard":
                    result = await mod.process(event, context)
                    if result is None:
                        raise EventRejected(mod.name, "rejected by guard")
                    # Guards can return the event unchanged or a modified copy
                    event = result

                elif mod.mode == "transform":
                    result = await mod.process(event, context)
                    if result is not None:
                        event = result

                elif mod.mode == "observe":
                    # Observers cannot modify the event; return value ignored
                    await mod.process(event, context)

            except EventRejected:
                raise
            except Exception:
                logger.exception("Mod %s raised an unexpected error", mod.name)
                raise

        return event
