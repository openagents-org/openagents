# -*- coding: utf-8 -*-
"""Add busy_channels JSONB column to workspace_members.

Records which channels an agent is currently running a turn in, so the
workspace can show per-agent working state (and offer to interrupt one
agent in a multi-agent thread) instead of guessing from whether the
channel's last message happened to be a status message.

NULL / [] means idle.

Revision ID: 029
Revises: 028
Create Date: 2026-08-06
"""

import sqlalchemy as sa
from alembic import op

revision = "029"
down_revision = "028"
branch_labels = None
depends_on = None


def _has_column(inspector, table, column):
    return any(c["name"] == column for c in inspector.get_columns(table))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not _has_column(inspector, "workspace_members", "busy_channels"):
        op.add_column(
            "workspace_members",
            sa.Column("busy_channels", sa.JSON(), nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if _has_column(inspector, "workspace_members", "busy_channels"):
        op.drop_column("workspace_members", "busy_channels")
