"""Add opt-in account profiles with platform-wide handles."""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "104"
down_revision = "103"
branch_labels = None
depends_on = None
deployment_backward_compatible = True


def upgrade():
    op.create_table(
        "public_profiles",
        sa.Column("user_id", UUID(as_uuid=False), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("handle", sa.String(28), nullable=False),
        sa.Column("bio", sa.String(160), nullable=False, server_default=""),
        sa.Column("is_public", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.UniqueConstraint("handle", name="uq_public_profiles_handle"),
        sa.CheckConstraint("handle = lower(handle)", name="ck_public_profiles_handle_lowercase"),
    )


def downgrade():
    op.drop_table("public_profiles")
