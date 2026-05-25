# -*- coding: utf-8 -*-
"""Add enabled_skills JSONB column to workspace_members.

Stores per-agent skill overrides: {"files": true, "browser": false, ...}.
NULL means "use all defaults" (every skill enabled).

Revision ID: 016
Revises: 015
Create Date: 2026-05-25
"""

import sqlalchemy as sa
from alembic import op

revision = "016"
down_revision = "015"
branch_labels = None
depends_on = None


def _has_column(inspector, table, column):
    return any(c["name"] == column for c in inspector.get_columns(table))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not _has_column(inspector, "workspace_members", "enabled_skills"):
        op.add_column(
            "workspace_members",
            sa.Column("enabled_skills", sa.JSON(), nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if _has_column(inspector, "workspace_members", "enabled_skills"):
        op.drop_column("workspace_members", "enabled_skills")
