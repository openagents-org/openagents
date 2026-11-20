"""Read actual run activity; never infer which routine old untagged fires belong to."""
import time

from sqlalchemy import select
from sqlalchemy.orm import Session
from app.models import EventRecord, RoutineRecord
from app.services.routine_backoff import ROUTINE_STUCK_MS, _run_outcome


def routine_runs(db: Session, routine: RoutineRecord, limit: int = 20) -> list[dict]:
    fires = db.execute(select(EventRecord).where(
        EventRecord.network_id == routine.workspace_id,
        EventRecord.source == 'system:routine',
        EventRecord.type == 'workspace.message.posted',
        EventRecord.payload['routine_id'].astext == routine.id,
    ).order_by(EventRecord.timestamp.desc(), EventRecord.id.desc()).limit(limit)).scalars().all()
    result = []
    for fire in fires:
        # The queue is shared per agent. The next fire, including another
        # routine's fire, closes this run's response window.
        next_fire = db.execute(select(EventRecord.timestamp).where(
            EventRecord.network_id == routine.workspace_id,
            EventRecord.target == fire.target,
            EventRecord.source == 'system:routine',
            EventRecord.timestamp > fire.timestamp,
        ).order_by(EventRecord.timestamp).limit(1)).scalar_one_or_none()
        query = select(EventRecord).where(
            EventRecord.network_id == routine.workspace_id,
            EventRecord.target == fire.target,
            EventRecord.source == f"openagents:{(fire.payload or {}).get('routine_agent', routine.created_by).removeprefix('openagents:')}",
            EventRecord.type == 'workspace.message.posted',
            EventRecord.timestamp > fire.timestamp,
        )
        if next_fire is not None:
            query = query.where(EventRecord.timestamp < next_fire)
        replies = db.execute(query.order_by(EventRecord.timestamp.desc()).limit(100)).scalars().all()
        outcome = _run_outcome(replies)
        answers = [r for r in replies if (r.payload or {}).get('message_type', 'chat') in ('chat', 'error')]
        stale = int(time.time() * 1000) - fire.timestamp >= ROUTINE_STUCK_MS
        status = 'failed' if outcome == 'failed' else 'responded' if outcome == 'ok' else 'unanswered' if next_fire or stale else 'waiting'
        result.append({
            'id': fire.id, 'started_at': fire.timestamp, 'status': status,
            'summary': str((answers[0].payload or {}).get('content') or '')[:2000] if answers else None,
            'channel_name': fire.target.removeprefix('channel/'),
        })
    return result
