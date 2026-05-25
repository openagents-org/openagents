# -*- coding: utf-8 -*-
"""Add shared browser tab and usage tables.

Revision ID: 005_browser_tables
Revises: 005
Create Date: 2026-03-14
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "005_browser_tables"
down_revision = "005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "browser_tabs",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=False), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default="active"),
        sa.Column("created_by", sa.Text(), nullable=False),
        sa.Column("shared_with", postgresql.JSONB(), server_default="[]"),
        sa.Column("session_id", sa.Text(), nullable=True),
        sa.Column("live_url", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.Column("last_active_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
    )
    op.create_index("idx_browser_tabs_workspace_status", "browser_tabs", ["workspace_id", "status"])

    op.create_table(
        "browser_usage",
        sa.Column("id", sa.Text(), primary_key=True),
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
