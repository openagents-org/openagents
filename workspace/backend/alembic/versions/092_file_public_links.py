"""Add file_public_links: open links that let anyone read one file.

Revision ID: 092
Revises: 091
Create Date: 2026-11-06
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

# New table only; old application versions never read it.
deployment_backward_compatible = True
revision = "092"
down_revision = "091"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "file_public_links" in set(sa.inspect(op.get_bind()).get_table_names()):
        return
    op.create_table(
        "file_public_links",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("workspace_id", UUID(as_uuid=False), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("file_id", sa.Text(), sa.ForeignKey("files.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token", sa.Text(), nullable=False, unique=True),
        sa.Column("created_by", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("idx_file_public_links_file", "file_public_links", ["file_id"])


def downgrade() -> None:
    op.drop_index("idx_file_public_links_file", table_name="file_public_links")
    op.drop_table("file_public_links")
