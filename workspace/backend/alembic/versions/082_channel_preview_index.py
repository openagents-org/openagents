"""Index newest channel events without blocking writes during construction."""
from alembic import op
import sqlalchemy as sa

revision = '082'
down_revision = '081'
branch_labels = None
depends_on = None


def upgrade():
    with op.get_context().autocommit_block():
        # IF NOT EXISTS allows deploying after an operational pre-build. Fail
        # explicitly if an interrupted concurrent build left an invalid index.
        op.execute("""CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_channel_latest
                   ON events (network_id, target, timestamp DESC, id DESC)
                   WHERE target LIKE 'channel/%'""")
        valid = op.get_bind().execute(sa.text("""SELECT indisvalid FROM pg_index
            WHERE indexrelid = 'idx_events_channel_latest'::regclass""")).scalar_one()
        if not valid:
            raise RuntimeError('Invalid idx_events_channel_latest: drop concurrently and retry')


def downgrade():
    with op.get_context().autocommit_block():
        op.execute('DROP INDEX CONCURRENTLY IF EXISTS idx_events_channel_latest')
