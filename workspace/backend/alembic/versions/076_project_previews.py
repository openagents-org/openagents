"""Short-lived static project previews."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
revision = '076'
down_revision = '075'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('project_preview_tickets',
        sa.Column('id', sa.Text(), primary_key=True),
        sa.Column('file_id', sa.Text(), sa.ForeignKey('files.id', ondelete='CASCADE'), nullable=False),
        sa.Column('storage_key', sa.Text(), nullable=False),
        sa.Column('principal', JSONB(), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False))
    op.create_index('ix_project_preview_tickets_expires_at', 'project_preview_tickets', ['expires_at'])


def downgrade():
    op.drop_table('project_preview_tickets')
