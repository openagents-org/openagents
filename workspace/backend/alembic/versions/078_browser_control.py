"""Bounded human control leases for shared browser tabs."""
from alembic import op
import sqlalchemy as sa
revision = '078'
down_revision = '077'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('browser_tabs', sa.Column('control_owner', sa.Text(), nullable=True))
    op.add_column('browser_tabs', sa.Column('control_token', sa.Text(), nullable=True))
    op.add_column('browser_tabs', sa.Column('control_expires_at', sa.DateTime(timezone=True), nullable=True))


def downgrade():
    for name in ('control_expires_at', 'control_token', 'control_owner'):
        op.drop_column('browser_tabs', name)
