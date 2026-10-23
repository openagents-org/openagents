"""Opaque identifiers for direct conversation URLs."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID
revision = "075"
down_revision = "074"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("direct_thread_links",
        sa.Column("id", UUID(as_uuid=False), primary_key=True),
        sa.Column("workspace_id", UUID(as_uuid=False), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("session_key", sa.Text(), nullable=False),
        sa.UniqueConstraint("workspace_id", "session_key", name="uq_direct_thread_link"))


def downgrade():
    op.drop_table("direct_thread_links")
