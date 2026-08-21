# -*- coding: utf-8 -*-
"""Add model_access — saved inference credentials per workspace.

Provider + API key (+ optional base URL) entries managed on the Model access
settings page and referenced by id from agent configs, so raw keys stay
server-side after creation.

Revision ID: 042
Revises: 041
Create Date: 2026-08-21
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "042"
down_revision = "041"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "model_access" in inspector.get_table_names():
        return
    op.create_table(
        "model_access",
        sa.Column("id", UUID(as_uuid=False), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("workspace_id", UUID(as_uuid=False), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column("provider", sa.Text(), nullable=False),
        sa.Column("base_url", sa.Text(), nullable=True),
        sa.Column("api_key", sa.Text(), nullable=False),
        sa.Column("created_by", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
    )
    op.create_index("ix_model_access_workspace", "model_access", ["workspace_id"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "model_access" in inspector.get_table_names():
        op.drop_index("ix_model_access_workspace", table_name="model_access")
        op.drop_table("model_access")
