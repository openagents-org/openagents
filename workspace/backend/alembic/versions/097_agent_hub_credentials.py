"""Agent hub credentials: personal API keys, OAuth clients and authorization codes.

Other apps (ChatGPT, Claude, personal assistants) use these to delegate work to
a person's agents through the hub API and the MCP endpoint.
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

# New tables only; old application versions ignore them.
deployment_backward_compatible = True
revision = "097"
down_revision = "096"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "personal_access_tokens",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=False), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False, server_default="api_key"),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("client_id", sa.Text(), nullable=True),
        sa.Column("token_hash", sa.Text(), nullable=False, unique=True),
        sa.Column("token_prefix", sa.Text(), nullable=False),
        sa.Column("refresh_hash", sa.Text(), nullable=True, unique=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("refresh_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
    )
    op.create_index("idx_personal_access_tokens_user", "personal_access_tokens", ["user_id"])
    op.create_table(
        "oauth_clients",
        sa.Column("client_id", sa.Text(), primary_key=True),
        sa.Column("client_name", sa.Text(), nullable=False),
        sa.Column("redirect_uris", JSONB(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
    )
    op.create_table(
        "oauth_authorization_codes",
        sa.Column("code_hash", sa.Text(), primary_key=True),
        sa.Column("client_id", sa.Text(), sa.ForeignKey("oauth_clients.client_id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", UUID(as_uuid=False), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("redirect_uri", sa.Text(), nullable=False),
        sa.Column("code_challenge", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
    )


def downgrade():
    op.drop_table("oauth_authorization_codes")
    op.drop_table("oauth_clients")
    op.drop_index("idx_personal_access_tokens_user", table_name="personal_access_tokens")
    op.drop_table("personal_access_tokens")
