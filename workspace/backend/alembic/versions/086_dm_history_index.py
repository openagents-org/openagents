"""Cover direct-message history without scanning channel messages."""
from alembic import op
import sqlalchemy as sa

deployment_backward_compatible = True
revision = '086'
down_revision = '085'
branch_labels = None
depends_on = None


def upgrade():
    with op.get_context().autocommit_block():
        op.execute("SET lock_timeout = '5s'")
        try:
            op.execute("""CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_dm_history
                ON events (network_id, source, target, timestamp DESC, id DESC) INCLUDE (visibility)
                WHERE visibility = 'direct' AND type = 'workspace.message.posted'""")
            valid = op.get_bind().execute(sa.text("""SELECT indisvalid FROM pg_index
                WHERE indexrelid = to_regclass('idx_events_dm_history')""")).scalar_one()
            if not valid:
                raise RuntimeError('Invalid idx_events_dm_history: drop concurrently and retry')
        finally:
            op.execute('RESET lock_timeout')


def downgrade():
    with op.get_context().autocommit_block():
        op.execute('DROP INDEX CONCURRENTLY IF EXISTS idx_events_dm_history')
