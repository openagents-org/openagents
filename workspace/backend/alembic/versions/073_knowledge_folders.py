"""Shared knowledge folders, independent of entry permissions."""
from alembic import op
import sqlalchemy as sa
revision = "073"
down_revision = "072"
branch_labels = None
depends_on = None

def upgrade():
    op.create_table("knowledge_folders",
        sa.Column("workspace_id", sa.dialects.postgresql.UUID(as_uuid=False), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("path", sa.Text(), primary_key=True))
    op.add_column("knowledge_entries", sa.Column("folder_path", sa.Text(), nullable=False, server_default=""))

def downgrade():
    op.drop_column("knowledge_entries", "folder_path")
    op.drop_table("knowledge_folders")
