# -*- coding: utf-8 -*-
"""Add node command queue + node agent roster (remote agent management).

Revision ID: 031
Revises: 030
Create Date: 2026-08-11

A `node_command` is a remote agent-management command an owner/admin queues in
the workspace for a connected node's daemon (create/start/stop/remove an agent).
The node isn't directly reachable, so the daemon picks the command up on its next
heartbeat, runs it locally, and posts the result back. `nodes.agents` stores the
roster the daemon reports each heartbeat so the workspace can list what runs on a
node.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "031"
down_revision = "030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "nodes",
        sa.Column("agents", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'[]'::jsonb"), nullable=True),
    )

    op.create_table(
        "node_commands",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("node_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("command", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb")),
        sa.Column("status", sa.Text(), server_default="pending"),
        sa.Column("result", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_by", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("idx_node_commands_node_status", "node_commands", ["node_id", "status"])


def downgrade() -> None:
    op.drop_index("idx_node_commands_node_status", "node_commands")
    op.drop_table("node_commands")
    op.drop_column("nodes", "agents")
