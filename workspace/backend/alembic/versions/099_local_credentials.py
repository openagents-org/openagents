"""Local email + password credentials for self-hosted instances.

One row per user holding a scrypt password hash. Only written when local auth
is enabled (LOCAL_AUTH_ENABLED, auto-on without FIREBASE_PROJECT_ID); the
hosted deployment never touches it.
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

# New table only; old application versions ignore it.
deployment_backward_compatible = True
revision = "099"
down_revision = "098"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "local_credentials",
        sa.Column(
            "user_id",
            UUID(as_uuid=False),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
    )


def downgrade():
    op.drop_table("local_credentials")
