# -*- coding: utf-8 -*-
"""Add agent_watches — bounded subscriptions to other threads / agents.

Revision ID: 052
Revises: 051
Create Date: 2026-09-30

An agent (the built-in assistant, typically) sets a watch right after it
hands work off to another thread, so the outcome is delivered back to the
thread where the human asked. Each row carries an expiry and a fire cap.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "052"
down_revision = "051"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "agent_watches",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=False),
                  sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("watcher_agent", sa.Text(), nullable=False),
        sa.Column("origin_channel", sa.Text(), nullable=False),
        sa.Column("subject_kind", sa.Text(), nullable=False),
        sa.Column("subject", sa.Text(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("max_fires", sa.Integer(), nullable=False, server_default="10"),
        sa.Column("fires", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.Text(), nullable=False, server_default="active"),
        sa.Column("last_fired_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.text("NOW()"), nullable=True),
    )
    op.create_index("idx_agent_watches_ws_status", "agent_watches", ["workspace_id", "status"])
    op.create_index("idx_agent_watches_status_expiry", "agent_watches", ["status", "expires_at"])


def downgrade() -> None:
    op.drop_index("idx_agent_watches_status_expiry", table_name="agent_watches")
    op.drop_index("idx_agent_watches_ws_status", table_name="agent_watches")
    op.drop_table("agent_watches")
