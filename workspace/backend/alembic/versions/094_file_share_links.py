"""Public "anyone with the link" view links for files."""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

# New table only; old application versions ignore it.
deployment_backward_compatible = True
revision = "094"
down_revision = "093"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "file_share_links",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("workspace_id", UUID(as_uuid=False), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("file_id", sa.Text(), sa.ForeignKey("files.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token", sa.Text(), nullable=False, unique=True),
        sa.Column("created_by", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("idx_file_share_links_file", "file_share_links", ["file_id"])
    # At most one live link per file, even when two creates race.
    op.create_index(
        "uq_file_share_links_live", "file_share_links", ["file_id"], unique=True,
        postgresql_where=sa.text("revoked_at IS NULL"),
    )


def downgrade():
    op.drop_index("uq_file_share_links_live", table_name="file_share_links")
    op.drop_index("idx_file_share_links_file", table_name="file_share_links")
    op.drop_table("file_share_links")
