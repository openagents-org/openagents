"""Per-person read markers shared by all of a person's devices."""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

# Additive table only; older application versions do not reference it.
deployment_backward_compatible = True

revision = '084'
down_revision = '083'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('read_markers',
        sa.Column('workspace_id', UUID(as_uuid=False), sa.ForeignKey('workspaces.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('user_email', sa.Text(), primary_key=True),
        sa.Column('session_id', sa.Text(), primary_key=True),
        sa.Column('read_at', sa.BigInteger(), nullable=False),
        sa.Column('updated_at', sa.BigInteger(), nullable=False))


def downgrade():
    op.drop_table('read_markers')
