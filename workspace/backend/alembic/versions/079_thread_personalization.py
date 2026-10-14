"""Thread icons and personal DM navigation preferences."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID
revision = '079'
down_revision = '078'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('channels', sa.Column('icon', sa.Text(), nullable=True))
    op.create_table('direct_thread_preferences',
        sa.Column('thread_id', UUID(as_uuid=False), sa.ForeignKey('direct_thread_links.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('user_email', sa.Text(), primary_key=True),
        sa.Column('pinned', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('starred', sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade():
    op.drop_table('direct_thread_preferences')
    op.drop_column('channels', 'icon')
