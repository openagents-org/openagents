"""Public "anyone with the link" snapshot links for thread artifacts.

Replaces file_share_links (which never held a live row in production); that
table is left in place so an old application version still running during a
rolling deploy keeps working, and can be dropped in a later migration.
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

# New table only; old application versions ignore it.
deployment_backward_compatible = True
revision = "098"
down_revision = "097"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "public_shares",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("workspace_id", UUID(as_uuid=False), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("resource_kind", sa.Text(), nullable=False),
        sa.Column("resource_id", sa.Text(), nullable=False),
        sa.Column("token", sa.Text(), nullable=False, unique=True),
        sa.Column("created_by", sa.Text(), nullable=False),
        sa.Column("approval_id", sa.Text(), nullable=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("content_type", sa.Text(), nullable=True),
        sa.Column("size", sa.BigInteger(), nullable=True),
        sa.Column("storage_key", sa.Text(), nullable=False),
        sa.Column("assets", JSONB(), nullable=True),
        sa.Column("entrypoint", sa.Text(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.Column("snapshot_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("idx_public_shares_resource", "public_shares", ["resource_kind", "resource_id"])
    # At most one live link per artifact, even when two creates race.
    op.create_index(
        "uq_public_shares_live", "public_shares", ["resource_kind", "resource_id"], unique=True,
        postgresql_where=sa.text("revoked_at IS NULL"),
    )


def downgrade():
    op.drop_index("uq_public_shares_live", table_name="public_shares")
    op.drop_index("idx_public_shares_resource", table_name="public_shares")
    op.drop_table("public_shares")
