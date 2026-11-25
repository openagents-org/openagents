"""Per-pair DM totals kept by a trigger, so the DM list never rescans history.

GET /v1/events/conversations needs, per DM pair, the message count and the
newest timestamp. Today that comes from a full-history aggregate cached in
Redis, which takes minutes for a workspace with a long agent reply loop; when
the cache is missing every request recomputes it (incidents 2026-11-20/25).

``dm_pair_summaries`` holds one row per (workspace, pair). A trigger on
``events`` keeps it current inside the same transaction as every insert,
delete or relevant update, for every writer (ORM, raw SQL, scripts). The pair
and the counted rows match conversation_pairs_query exactly: direct
``workspace.message.posted`` rows, not to a channel, neither side
``human:system``, pair = (LEAST(source, target), GREATEST(source, target)).

Until a workspace is backfilled (``dm_summary_backfills``) its rows are only
the trigger's deltas since this migration; the backfill adds the history in
one exact step (see app/services/dm_pair_summary.py). Counts may be <= 0 for
pairs whose messages were all deleted; readers skip those rows.

Revision ID: 101
Revises: 100
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

# Additive: new tables plus a trigger the running release does not read.
deployment_backward_compatible = True
revision = '101'
down_revision = '100'
branch_labels = None
depends_on = None

QUALIFIES = """COALESCE(
    {r}.visibility = 'direct'
    AND {r}.type = 'workspace.message.posted'
    AND lower({r}.source) <> 'human:system'
    AND lower({r}.target) <> 'human:system'
    AND NOT ({r}.target LIKE 'channel/%'), false)"""

FUNCTION_SQL = f"""
CREATE OR REPLACE FUNCTION dm_pair_summary_apply() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    pair_a text;
    pair_b text;
    old_ok boolean := false;
    new_ok boolean := false;
    newest bigint;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        old_ok := {QUALIFIES.format(r='OLD')};
    END IF;
    IF TG_OP <> 'DELETE' THEN
        new_ok := {QUALIFIES.format(r='NEW')};
    END IF;
    IF TG_OP = 'UPDATE' AND old_ok AND new_ok
       AND OLD.network_id = NEW.network_id AND OLD.source = NEW.source
       AND OLD.target = NEW.target AND OLD.timestamp = NEW.timestamp THEN
        RETURN NULL;  -- same pair, same time: nothing to change
    END IF;

    IF old_ok THEN
        pair_a := LEAST(OLD.source, OLD.target);
        pair_b := GREATEST(OLD.source, OLD.target);
        -- Upsert so a delta is never lost before the workspace is backfilled.
        INSERT INTO dm_pair_summaries AS s (workspace_id, agent_a, agent_b, msg_count, last_ts)
        VALUES (OLD.network_id, pair_a, pair_b, -1, 0)
        ON CONFLICT (workspace_id, agent_a, agent_b)
        DO UPDATE SET msg_count = s.msg_count - 1
        RETURNING s.last_ts INTO newest;
        IF OLD.timestamp >= newest THEN
            SELECT max(e.timestamp) INTO newest FROM events e
             WHERE e.network_id = OLD.network_id
               AND {QUALIFIES.format(r='e')}
               AND ((e.source = pair_a AND e.target = pair_b)
                 OR (e.source = pair_b AND e.target = pair_a));
            UPDATE dm_pair_summaries SET last_ts = COALESCE(newest, 0)
             WHERE workspace_id = OLD.network_id AND agent_a = pair_a AND agent_b = pair_b;
        END IF;
    END IF;

    IF new_ok THEN
        INSERT INTO dm_pair_summaries AS s (workspace_id, agent_a, agent_b, msg_count, last_ts)
        VALUES (NEW.network_id, LEAST(NEW.source, NEW.target), GREATEST(NEW.source, NEW.target), 1, NEW.timestamp)
        ON CONFLICT (workspace_id, agent_a, agent_b)
        DO UPDATE SET msg_count = s.msg_count + 1, last_ts = GREATEST(s.last_ts, EXCLUDED.last_ts);
    END IF;
    RETURN NULL;
END
$$;
"""

TRIGGER_SQL = """
CREATE TRIGGER events_dm_pair_summary
AFTER INSERT OR DELETE OR UPDATE OF network_id, source, target, type, visibility, timestamp ON events
FOR EACH ROW EXECUTE FUNCTION dm_pair_summary_apply();
"""


def upgrade():
    op.create_table(
        'dm_pair_summaries',
        sa.Column('workspace_id', UUID(as_uuid=False), primary_key=True),
        sa.Column('agent_a', sa.Text(), primary_key=True),
        sa.Column('agent_b', sa.Text(), primary_key=True),
        sa.Column('msg_count', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('last_ts', sa.BigInteger(), nullable=False, server_default='0'),
    )
    op.create_table(
        'dm_summary_backfills',
        sa.Column('workspace_id', UUID(as_uuid=False), primary_key=True),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('NOW()')),
    )
    if op.get_bind().dialect.name != 'postgresql':
        return  # SQLite (dev/tests): no trigger; the table stays empty and unused.
    op.execute(FUNCTION_SQL)
    # CREATE TRIGGER briefly takes a lock that blocks event writes; never queue
    # behind a long transaction (and block every writer behind us) for long.
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute(TRIGGER_SQL)


def downgrade():
    if op.get_bind().dialect.name == 'postgresql':
        op.execute("SET LOCAL lock_timeout = '5s'")
        op.execute('DROP TRIGGER IF EXISTS events_dm_pair_summary ON events')
        op.execute('DROP FUNCTION IF EXISTS dm_pair_summary_apply()')
    op.drop_table('dm_summary_backfills')
    op.drop_table('dm_pair_summaries')
