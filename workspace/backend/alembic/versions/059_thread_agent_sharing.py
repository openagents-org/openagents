"""Per-owner agent sharing with a thread's current human roster."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "059"
down_revision = "058"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("channel_agent_sharing",
        sa.Column("channel_id", postgresql.UUID(as_uuid=False), sa.ForeignKey("channels.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("owner_email", sa.Text(), primary_key=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade():
    op.drop_table("channel_agent_sharing")
