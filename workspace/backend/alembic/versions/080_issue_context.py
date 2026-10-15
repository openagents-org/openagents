"""Persist selected knowledge and attachments on issues."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
revision = '080'
down_revision = '079'
branch_labels = None
depends_on = None


def upgrade():
    for name in ('knowledge_ids', 'file_ids'):
        op.add_column('issues', sa.Column(name, JSONB(), nullable=False, server_default=sa.text("'[]'")))


def downgrade():
    op.drop_column('issues', 'file_ids')
    op.drop_column('issues', 'knowledge_ids')
