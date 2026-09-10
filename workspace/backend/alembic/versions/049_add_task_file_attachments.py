# -*- coding: utf-8 -*-
"""Add kanban_tasks.file_ids — files attached to a task.

Attached files (workspace FileRecord ids) are delivered as attachments on the
task's kickoff message so the assigned agent (or workflow step 1) can open
them, e.g. a bug-report screenshot.

Revision ID: 049
Revises: 048
Create Date: 2026-08-27
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "049"
down_revision = "048"
branch_labels = None
depends_on = None


def _has_column(inspector, table, column) -> bool:
    if table not in inspector.get_table_names():
        return False
    return any(c["name"] == column for c in inspector.get_columns(table))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not _has_column(inspector, "kanban_tasks", "file_ids"):
        op.add_column("kanban_tasks", sa.Column("file_ids", JSONB(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if _has_column(inspector, "kanban_tasks", "file_ids"):
        op.drop_column("kanban_tasks", "file_ids")
