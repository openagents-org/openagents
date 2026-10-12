"""Add per-thread control for members bringing agents."""
from alembic import op
import sqlalchemy as sa

revision = "058"
down_revision = "057"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("channels", sa.Column("members_can_add_agents", sa.Boolean(), nullable=False, server_default=sa.true()))


def downgrade():
    op.drop_column("channels", "members_can_add_agents")
