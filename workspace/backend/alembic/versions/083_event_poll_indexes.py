"""Selective ordered indexes for hot event-poll prefixes."""
from alembic import op
import sqlalchemy as sa

revision = '083'
down_revision = '082'
branch_labels = None
depends_on = None

INDEXES = (
    ('idx_events_poll_message', 'workspace.message.posted%'),
    ('idx_events_poll_control', 'workspace.agent.control%'),
    ('idx_events_poll_tool_result', 'workspace.tool_result%'),
)


def upgrade():
    with op.get_context().autocommit_block():
        for name, pattern in INDEXES:
            op.execute(f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {name} "
                       f"ON events (network_id, timestamp DESC, id DESC) WHERE type LIKE '{pattern}'")
            valid = op.get_bind().execute(sa.text(
                'SELECT indisvalid FROM pg_index WHERE indexrelid = to_regclass(:name)'), {'name': name}).scalar_one()
            if not valid:
                raise RuntimeError(f'Invalid {name}: drop concurrently and retry')


def downgrade():
    with op.get_context().autocommit_block():
        for name, _ in reversed(INDEXES):
            op.execute(f'DROP INDEX CONCURRENTLY IF EXISTS {name}')
