"""Time-window index for human-sent messages (growth analytics)."""
from alembic import op
import sqlalchemy as sa

# Additive index built concurrently; old application versions are unaffected.
deployment_backward_compatible = True
revision = '090'
down_revision = '089'
branch_labels = None
depends_on = None


def upgrade():
    with op.get_context().autocommit_block():
        # Analytics count active people over created_at windows. Without this
        # every such query reads the whole events heap to find a few thousand
        # rows. The predicate matches those queries verbatim so it is provable.
        op.execute("SET lock_timeout = '300s'")
        try:
            op.execute("""CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_human_message_created_at
                ON events (created_at)
                WHERE type = 'workspace.message.posted' AND source LIKE 'human:%'""")
            valid = op.get_bind().execute(sa.text("""SELECT indisvalid FROM pg_index
                WHERE indexrelid = to_regclass('idx_events_human_message_created_at')""")).scalar_one()
            if not valid:
                raise RuntimeError('Invalid idx_events_human_message_created_at: drop concurrently and retry')
        finally:
            op.execute('RESET lock_timeout')


def downgrade():
    with op.get_context().autocommit_block():
        op.execute('DROP INDEX CONCURRENTLY IF EXISTS idx_events_human_message_created_at')
