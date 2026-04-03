# -*- coding: utf-8 -*-
"""
mod/persistence — save events to PostgreSQL.

Observe mod (priority 90). Stores every event that passes through the
pipeline into the events table.

Expects context.extra to contain:
  - db: SQLAlchemy Session
  - workspace: Workspace ORM object (for network_id)
"""

import logging
from typing import List, Optional

from openagents.core.onm_events import Event
from openagents.core.onm_mods import ObserveMod, PipelineContext

logger = logging.getLogger(__name__)


class PersistenceMod(ObserveMod):
    """Persist events to the events table."""
    name = "persistence"
    intercepts: List[str] = []   # Match all events
    priority = 90

    # Event types that are handled by their mods (e.g. heartbeats update
    # workspace_members.last_heartbeat) and don't need a permanent event record.
    _SKIP_PERSIST = frozenset({"network.ping"})

    async def process(self, event: Event, context: PipelineContext) -> Optional[Event]:
        if event.type in self._SKIP_PERSIST:
            return None

        from app.models import EventRecord

        db = context.extra.get("db")
        workspace = context.extra.get("workspace")
        if not db or not workspace:
            logger.warning("persistence: no db or workspace in context, skipping")
            return None

        record = EventRecord(
            id=event.id,
            network_id=workspace.id,
            type=event.type,
            source=event.source,
            target=event.target,
            payload=event.payload,
            metadata_=event.metadata,
            timestamp=event.timestamp,
            visibility=event.visibility if isinstance(event.visibility, str) else event.visibility,
        )
        db.add(record)
        db.flush()  # flush, don't commit — the router commits

        return None  # observe mods return value is ignored
