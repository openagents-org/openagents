# -*- coding: utf-8 -*-
"""Add workflows + workflow_runs, and workflow_id on tasks and channels.

Structured multi-agent collaboration templates (the "Workflows" feature).
A Workflow is an ordered list of steps; running one copies the template into a
WorkflowRun snapshot that drives a thread step by step, with fast-model-judged
"go to step X if <condition>" gates for forward skips and backward loops.

Revision ID: 033
Revises: 032
Create Date: 2026-08-11
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "033"
down_revision = "032"
branch_labels = None
depends_on = None


def _has_table(inspector, table) -> bool:
    return table in inspector.get_table_names()


def _has_column(inspector, table, column) -> bool:
    if table not in inspector.get_table_names():
        return False
    return any(c["name"] == column for c in inspector.get_columns(table))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not _has_table(inspector, "workflows"):
        op.create_table(
            "workflows",
            sa.Column("id", sa.Text(), primary_key=True),
            sa.Column("workspace_id", UUID(as_uuid=False), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
            sa.Column("name", sa.Text(), nullable=False),
            sa.Column("description", sa.Text(), nullable=False, server_default=""),
            sa.Column("steps", JSONB(), nullable=False),
            sa.Column("max_iterations", sa.Integer(), nullable=False, server_default="5"),
            sa.Column("created_by", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        )
        op.create_index("idx_workflows_workspace", "workflows", ["workspace_id"])

    if not _has_table(inspector, "workflow_runs"):
        op.create_table(
            "workflow_runs",
            sa.Column("id", sa.Text(), primary_key=True),
            sa.Column("workspace_id", UUID(as_uuid=False), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
            sa.Column("workflow_id", sa.Text(), nullable=True),
            sa.Column("channel_name", sa.Text(), nullable=False),
            sa.Column("snapshot", JSONB(), nullable=False),
            sa.Column("current_step", sa.Text(), nullable=True),
            sa.Column("iterations", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("status", sa.Text(), nullable=False, server_default="running"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        )
        op.create_index("idx_workflow_runs_ws_channel", "workflow_runs", ["workspace_id", "channel_name"])

    if not _has_column(inspector, "kanban_tasks", "workflow_id"):
        op.add_column("kanban_tasks", sa.Column("workflow_id", sa.Text(), nullable=True))
    if not _has_column(inspector, "channels", "workflow_id"):
        op.add_column("channels", sa.Column("workflow_id", sa.Text(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if _has_column(inspector, "channels", "workflow_id"):
        op.drop_column("channels", "workflow_id")
    if _has_column(inspector, "kanban_tasks", "workflow_id"):
        op.drop_column("kanban_tasks", "workflow_id")
    if _has_table(inspector, "workflow_runs"):
        op.drop_index("idx_workflow_runs_ws_channel", table_name="workflow_runs")
        op.drop_table("workflow_runs")
    if _has_table(inspector, "workflows"):
        op.drop_index("idx_workflows_workspace", table_name="workflows")
        op.drop_table("workflows")
