# -*- coding: utf-8 -*-
"""Add the requirement-clarification phase gate to channels.

Two columns backing a per-thread gate that stops execution agents from
starting work while the requirement is still being clarified:

    phase        "open" (no gate, current behaviour) | "clarifying" | "building"
    phase_owner  agent that owns the clarifying phase; falls back to master_agent

`phase` is NOT NULL with a server default of 'open', so every existing channel
keeps today's routing untouched until a thread is explicitly gated.

Revision ID: 029
Revises: 028
Create Date: 2026-08-02
"""

import sqlalchemy as sa
from alembic import op

revision = "029"
down_revision = "028"
branch_labels = None
depends_on = None


def _has_column(inspector, table, column):
    if table not in inspector.get_table_names():
        return False
    return any(c["name"] == column for c in inspector.get_columns(table))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not _has_column(inspector, "channels", "phase"):
        op.add_column(
            "channels",
            sa.Column(
                "phase",
                sa.Text(),
                server_default=sa.text("'open'"),
                nullable=False,
            ),
        )
    if not _has_column(inspector, "channels", "phase_owner"):
        op.add_column("channels", sa.Column("phase_owner", sa.Text(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    for column in ("phase_owner", "phase"):
        if _has_column(inspector, "channels", column):
            op.drop_column("channels", column)
