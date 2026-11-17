"""Stop agent-to-agent DM reply loops.

Channels route agent messages through the LLM router, which prefers to stop.
Direct messages between two agents bypass it, so two agents acknowledging each
other ("收到。" ↔ "收到。") can talk forever: one workspace reached 100k DMs/day.

When the last AGENT_DM_LOOP_LIMIT chat DMs between two agents happened with no
person messaging either of them since, the next DM is still stored and shown,
but it no longer wakes the recipient (target_agents = ["__no_response__"],
which every connector version honours). A person messaging either agent — a DM
or routing them in a thread — resets the count.
"""
from typing import Optional

from sqlalchemy import and_, select

from app.models import EventRecord

# Agents send several status/thinking DMs per chat reply; read this many rows
# per direction to find the last N chats.
_SCAN_PER_DIRECTION = 300
_HUMAN_SCAN = 500


def _is_chat(payload) -> bool:
    return ((payload or {}).get("message_type") or "chat") == "chat"


def _recent_chat_timestamps(db, workspace_id: str, source: str, target: str, limit: int):
    rows = db.execute(
        select(EventRecord.timestamp, EventRecord.payload).where(
            EventRecord.network_id == workspace_id,
            EventRecord.visibility == "direct",
            EventRecord.type == "workspace.message.posted",
            EventRecord.source == source,
            EventRecord.target == target,
        ).order_by(EventRecord.timestamp.desc()).limit(_SCAN_PER_DIRECTION)
    ).all()
    return [ts for ts, payload in rows if _is_chat(payload)][:limit]


def _person_reached(db, workspace_id: str, agents, since_ms: int) -> bool:
    """Did a person message either agent at or after since_ms?"""
    addresses = {"openagents:" + a for a in agents}
    rows = db.execute(
        select(EventRecord.target, EventRecord.metadata_).where(
            EventRecord.network_id == workspace_id,
            EventRecord.type == "workspace.message.posted",
            EventRecord.timestamp >= since_ms,
            EventRecord.source.startswith("human:"),
        ).order_by(EventRecord.timestamp.desc()).limit(_HUMAN_SCAN)
    ).all()
    for target, metadata in rows:
        if target in addresses:
            return True
        targeted = (metadata or {}).get("target_agents") or []
        if isinstance(targeted, list) and set(targeted) & set(agents):
            return True
    return False


def should_quiet(db, workspace_id: str, source: str, target: str, limit: Optional[int] = None) -> bool:
    """True when this agent→agent chat DM continues a loop and must not wake the recipient."""
    if limit is None:
        from app.config import config
        limit = config.AGENT_DM_LOOP_LIMIT
    if limit <= 0 or not (source.startswith("openagents:") and target.startswith("openagents:")):
        return False
    stamps = sorted(
        _recent_chat_timestamps(db, workspace_id, source, target, limit)
        + _recent_chat_timestamps(db, workspace_id, target, source, limit),
        reverse=True,
    )[:limit]
    if len(stamps) < limit:
        return False
    agents = (source[len("openagents:"):], target[len("openagents:"):])
    return not _person_reached(db, workspace_id, agents, stamps[-1])
