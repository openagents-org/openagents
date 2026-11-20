"""Link routines to their originating conversation without moving their execution queue.

Revision ID: 099
Revises: 098
"""
from alembic import op
import sqlalchemy as sa

# Additive: a nullable column and two indexes; the running release ignores them.
deployment_backward_compatible = True
revision = '099'
down_revision = '098'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('routines', sa.Column('source_channel_name', sa.Text(), nullable=True))
    # routines is small; a regular index build is instant.
    op.create_index('idx_routines_source_channel', 'routines', ['workspace_id', 'source_channel_name'])

    if op.get_bind().dialect.name != 'postgresql':
        op.create_index('idx_events_routine_history', 'events',
                        ['network_id', sa.text("(payload ->> 'routine_id')"), sa.text('timestamp DESC')],
                        sqlite_where=sa.text("source = 'system:routine'"))
        return

    # events is the largest table: a plain CREATE INDEX blocks every event
    # write until it finishes. Build it concurrently, as 086 and 090 do.
    with op.get_context().autocommit_block():
        op.execute("SET lock_timeout = '300s'")
        try:
            op.execute("""CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_routine_history
                ON events (network_id, (payload ->> 'routine_id'), timestamp DESC)
                WHERE source = 'system:routine'""")
            valid = op.get_bind().execute(sa.text("""SELECT indisvalid FROM pg_index
                WHERE indexrelid = to_regclass('idx_events_routine_history')""")).scalar_one()
            if not valid:
                raise RuntimeError('Invalid idx_events_routine_history: drop concurrently and retry')
        finally:
            op.execute('RESET lock_timeout')


def downgrade():
    if op.get_bind().dialect.name == 'postgresql':
        with op.get_context().autocommit_block():
            op.execute('DROP INDEX CONCURRENTLY IF EXISTS idx_events_routine_history')
    else:
        op.drop_index('idx_events_routine_history', table_name='events')
    op.drop_index('idx_routines_source_channel', table_name='routines')
    op.drop_column('routines', 'source_channel_name')
