# -*- coding: utf-8 -*-
"""Add browser_contexts table and context_id FK on browser_tabs.

Revision ID: 006
Revises: 005
Create Date: 2026-03-15
"""

from alembic import op
import sqlalchemy as sa

revision = "006"
down_revision = "005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create browser_contexts table
    op.create_table(
        "browser_contexts",
        sa.Column("id", sa.Text(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("workspace_id", sa.dialects.postgresql.UUID(as_uuid=False), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
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

    # Add context_id FK to browser_tabs
    op.add_column(
        "browser_tabs",
        sa.Column("context_id", sa.Text(), sa.ForeignKey("browser_contexts.id", ondelete="SET NULL"), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("browser_tabs", "context_id")
    op.drop_index("idx_browser_contexts_workspace_status", "browser_contexts")
    op.drop_table("browser_contexts")
