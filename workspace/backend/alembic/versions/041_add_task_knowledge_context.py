# -*- coding: utf-8 -*-
"""Add kanban_tasks.knowledge_ids — knowledge-base context for a task.

A task can carry a list of KnowledgeEntry ids as context; the kickoff message
references them as @knowledge:<slug> so the assigned agent (or workflow steps)
reads them before starting.

Revision ID: 041
Revises: 040
Create Date: 2026-08-21
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "041"
down_revision = "040"
branch_labels = None
depends_on = None


def _has_column(inspector, table, column) -> bool:
    if table not in inspector.get_table_names():
        return False
    return any(c["name"] == column for c in inspector.get_columns(table))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not _has_column(inspector, "kanban_tasks", "knowledge_ids"):
        op.add_column("kanban_tasks", sa.Column("knowledge_ids", JSONB(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if _has_column(inspector, "kanban_tasks", "knowledge_ids"):
        op.drop_column("kanban_tasks", "knowledge_ids")
