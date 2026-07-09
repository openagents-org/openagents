# -*- coding: utf-8 -*-
"""Add per-thread orchestration mode + collaboration instruction to channels.

Revision ID: 025
Revises: 024
Create Date: 2026-07-09

Adds two columns supporting user-selectable multi-agent collaboration modes:

  - `orchestration_mode` (default 'dynamic') — how the thread routes the
    next speaker: 'dynamic' (LLM router, current behaviour), 'master'
    (deterministic star: humans + sub-agents route to the master, master
    delegates), or 'workflow' (LLM router steered by a user plan).

  - `orchestration_instruction` — the free-text collaboration plan (with
    @agent mentions) used only in 'workflow' mode.

`orchestration_mode` is NOT NULL with a server default so existing channels
transparently keep today's dynamic-router behaviour. Added with IF NOT
EXISTS so the migration is idempotent.
"""

from alembic import op
import sqlalchemy as sa


revision = "025"
down_revision = "024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "channels",
        sa.Column(
            "orchestration_mode",
            sa.Text(),
            server_default=sa.text("'dynamic'"),
            nullable=False,
        ),
    )
    op.add_column(
        "channels",
        sa.Column("orchestration_instruction", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("channels", "orchestration_instruction")
    op.drop_column("channels", "orchestration_mode")
