"""Three-state owner consent for agent use within a thread."""
from alembic import op
import sqlalchemy as sa
revision = "072"
down_revision = "071"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("channel_agent_sharing", sa.Column("mode", sa.Text(), nullable=False, server_default="no"))
    op.execute("UPDATE channel_agent_sharing SET mode = 'yes' WHERE enabled = TRUE")

    op.create_table("issue_agent_sharing",
        sa.Column("issue_id", sa.Text(), sa.ForeignKey("issues.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("owner_email", sa.Text(), primary_key=True),
        sa.Column("mode", sa.Text(), nullable=False, server_default="no"))


def downgrade():
    op.drop_table("issue_agent_sharing")
    op.drop_column("channel_agent_sharing", "mode")
