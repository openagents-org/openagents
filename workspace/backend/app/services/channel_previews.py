"""Latest visible channel events without ranking full message histories."""
from sqlalchemy import func, literal_column, select, true

from app.models import EventRecord


def latest_channel_query(workspace_id, event_type, visibility_filters=(), *,
                         postgres=False, events=None):
    events = events if events is not None else EventRecord.__table__
    e = events.c
    # Keep this literal predicate identical to the partial index predicate.
    # No user input is interpolated into SQL.
    channel_filter = e.target.like(literal_column("'channel/%'"))
    scope = (e.network_id == workspace_id, channel_filter)
    filters = (*scope, *visibility_filters)
    if event_type:
        filters += (e.type.startswith(event_type),)

    if postgres:
        # A loose index scan jumps to the next target instead of DISTINCT over
        # every historical event. Deriving targets from events also preserves
        # previews for legacy channels missing from the channels projection.
        targets = (select(e.target).where(*scope).order_by(e.target).limit(1)
                   .cte('preview_targets', recursive=True))
        following = (select(e.target).where(*scope, e.target > targets.c.target)
                     .order_by(e.target).limit(1).correlate(targets).lateral())
        targets = targets.union_all(
            select(following.c.target).select_from(targets.join(following, true())))
        latest = (select(e.id).where(*filters, e.target == targets.c.target)
                  .order_by(e.timestamp.desc(), e.id.desc()).limit(1)
                  .correlate(targets).lateral())
        winners = (select(latest.c.id).select_from(targets.join(latest, true()))
                   .cte('preview_winners'))
    else:
        # SQLite has no LATERAL. Rank only narrow IDs, then fetch the payloads
        # of winning rows. Use the same deterministic tie-break as PostgreSQL.
        ranked = select(e.id, func.row_number().over(
            partition_by=e.target,
            order_by=(e.timestamp.desc(), e.id.desc()),
        ).label('rn')).where(*filters).subquery()
        winners = select(ranked.c.id).where(ranked.c.rn == 1).cte('preview_winners')

    return select(events).join(winners, e.id == winners.c.id)
