# -*- coding: utf-8 -*-
"""Add integration_bindings — Slack/Telegram chat-platform bridges.

Revision ID: 037
Revises: 036
Create Date: 2026-08-16

One row per connected bot (Telegram bot or Slack app). External conversations
are bridged to deterministic ``ext-<platform>-<binding8>-<chat id>`` channels,
so no per-conversation mapping table is needed.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "037"
down_revision = "036"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "integration_bindings",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=False),
                  sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("platform", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=True),
        sa.Column("bot_token", sa.Text(), nullable=False),
        sa.Column("signing_secret", sa.Text(), nullable=True),
        sa.Column("webhook_secret", sa.Text(), nullable=True),
        sa.Column("default_agent", sa.Text(), nullable=True),
        sa.Column("config", postgresql.JSONB(astext_type=sa.Text()),
                  server_default=sa.text("'{}'::jsonb"), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'active'")),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("last_event_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.text("NOW()"), nullable=True),
    )
    op.create_index("idx_integration_bindings_workspace", "integration_bindings", ["workspace_id"])


def downgrade() -> None:
    op.drop_index("idx_integration_bindings_workspace", table_name="integration_bindings")
    op.drop_table("integration_bindings")
