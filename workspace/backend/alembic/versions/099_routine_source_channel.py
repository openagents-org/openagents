"""Link routines to their originating conversation without moving their execution queue.

Revision ID: 099
Revises: 098
"""
from alembic import op
import sqlalchemy as sa

revision = '099'
down_revision = '098'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('routines', sa.Column('source_channel_name', sa.Text(), nullable=True))
    op.create_index('idx_routines_source_channel', 'routines', ['workspace_id', 'source_channel_name'])
    op.create_index('idx_events_routine_history', 'events',
                    ['network_id', sa.text("(payload ->> 'routine_id')"), sa.text('timestamp DESC')],
                    postgresql_where=sa.text("source = 'system:routine'"),
                    sqlite_where=sa.text("source = 'system:routine'"))


def downgrade():
    op.drop_index('idx_events_routine_history', table_name='events')
    op.drop_index('idx_routines_source_channel', table_name='routines')
    op.drop_column('routines', 'source_channel_name')
