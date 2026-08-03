# -*- coding: utf-8 -*-
"""Add per-thread context mode to channels.

Revision ID: 028
Revises: 027
Create Date: 2026-08-03

Adds `context_mode`, which controls how much of a channel an agent sees when
it rebuilds its context (session recap, history tool):

  - 'shared'    — the whole stream verbatim. Today's behaviour, and the
                  default, so existing channels are untouched.
  - 'projected' — the agent's own messages, messages routed to it, and every
                  human message come back in full; other agents' turns are
                  reduced to a one-line digest that can be expanded by id.

NOT NULL with a server default so existing rows transparently keep the
shared behaviour.
"""

from alembic import op
import sqlalchemy as sa


revision = "028"
down_revision = "027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "channels",
        sa.Column(
            "context_mode",
            sa.Text(),
            server_default=sa.text("'shared'"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("channels", "context_mode")
