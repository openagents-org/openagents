# -*- coding: utf-8 -*-
"""Add kanban_tasks table for the agent Kanban board.

A workspace-wide, GitHub-issue-like board. Each task is assignable to a single
agent; assigning it creates a hidden `task:<id>` thread where the agent works,
and a fast-model classifier moves the card between columns
(backlog | todo | in_progress | need_input | done).

Distinct from the `todos` table (agent-private in-thread checklists), which is
left untouched.

Revision ID: 029
Revises: 028
Create Date: 2026-08-06
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "029"
down_revision = "028"
branch_labels = None
depends_on = None


def _has_table(inspector, table) -> bool:
    return table in inspector.get_table_names()


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not _has_table(inspector, "kanban_tasks"):
        op.create_table(
            "kanban_tasks",
            sa.Column("id", sa.Text(), primary_key=True),
            sa.Column("workspace_id", UUID(as_uuid=False), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
            sa.Column("title", sa.Text(), nullable=False),
            sa.Column("description", sa.Text(), nullable=False, server_default=""),
            sa.Column("status", sa.Text(), nullable=False, server_default="backlog"),
            sa.Column("assignee", sa.Text(), nullable=True),
            sa.Column("created_by", sa.Text(), nullable=False),
            sa.Column("channel_name", sa.Text(), nullable=True),
            sa.Column("priority", sa.Text(), nullable=False, server_default="normal"),
            sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        )
        op.create_index("idx_kanban_workspace_status", "kanban_tasks", ["workspace_id", "status"])
        op.create_index("idx_kanban_workspace_channel", "kanban_tasks", ["workspace_id", "channel_name"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if _has_table(inspector, "kanban_tasks"):
        op.drop_index("idx_kanban_workspace_channel", table_name="kanban_tasks")
        op.drop_index("idx_kanban_workspace_status", table_name="kanban_tasks")
        op.drop_table("kanban_tasks")
