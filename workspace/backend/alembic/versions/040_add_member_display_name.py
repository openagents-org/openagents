# -*- coding: utf-8 -*-
"""Add workspace_members.display_name — user-set label for an agent.

Revision ID: 040
Revises: 039
Create Date: 2026-08-18

Any script is allowed (Chinese, emoji, ...). agent_name remains the ASCII
identity used for @mentions, routing and storage keys; UIs fall back to it
when display_name is null.
"""

from alembic import op
import sqlalchemy as sa


revision = "040"
down_revision = "039"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("workspace_members", sa.Column("display_name", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("workspace_members", "display_name")
