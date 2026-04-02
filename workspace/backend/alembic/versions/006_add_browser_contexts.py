# -*- coding: utf-8 -*-
"""Add browser_tabs, browser_usage, browser_contexts tables.

Revision ID: 006
Revises: 005
Create Date: 2026-03-15
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "006"
down_revision = "005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create browser_contexts table first (browser_tabs has FK to it)
    op.create_table(
        "browser_contexts",
        sa.Column("id", sa.Text(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=False), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("bb_context_id", sa.Text(), nullable=True),
        sa.Column("domain", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), server_default="active", nullable=False),
        sa.Column("created_by", sa.Text(), nullable=False),
        sa.Column("shared_with", sa.JSON(), server_default="[]"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.Column("last_used_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.UniqueConstraint("workspace_id", "name", name="uq_browser_context_workspace_name"),
    )
    op.create_index("idx_browser_contexts_workspace_status", "browser_contexts", ["workspace_id", "status"])

    # Create browser_tabs table (was missing from migrations, only auto-created in SQLite dev mode)
    op.create_table(
        "browser_tabs",
        sa.Column("id", sa.Text(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=False), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("url", sa.Text(), nullable=False, server_default="about:blank"),
        sa.Column("title", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default="active"),
        sa.Column("created_by", sa.Text(), nullable=False),
        sa.Column("shared_with", postgresql.JSONB(), server_default="[]"),
        sa.Column("context_id", sa.Text(), sa.ForeignKey("browser_contexts.id", ondelete="SET NULL"), nullable=True),
        sa.Column("session_id", sa.Text(), nullable=True),
        sa.Column("live_url", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.Column("last_active_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
    )
    op.create_index("idx_browser_tabs_workspace_status", "browser_tabs", ["workspace_id", "status"])

    # Create browser_usage table (also missing from migrations)
    op.create_table(
        "browser_usage",
        sa.Column("id", sa.Text(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=False), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tab_id", sa.Text(), nullable=False),
        sa.Column("session_id", sa.Text(), nullable=True),
        sa.Column("opened_by", sa.Text(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
    )
    op.create_index("idx_browser_usage_workspace", "browser_usage", ["workspace_id"])
    op.create_index("idx_browser_usage_opened_by", "browser_usage", ["opened_by"])
    op.create_index("idx_browser_usage_started", "browser_usage", ["started_at"])


def downgrade() -> None:
    op.drop_index("idx_browser_usage_started", "browser_usage")
    op.drop_index("idx_browser_usage_opened_by", "browser_usage")
    op.drop_index("idx_browser_usage_workspace", "browser_usage")
    op.drop_table("browser_usage")
    op.drop_index("idx_browser_tabs_workspace_status", "browser_tabs")
    op.drop_table("browser_tabs")
    op.drop_index("idx_browser_contexts_workspace_status", "browser_contexts")
    op.drop_table("browser_contexts")
