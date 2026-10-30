# -*- coding: utf-8 -*-
"""Add workspace_members.model — per-agent model override picked in the UI.

Revision ID: 043
Revises: 042
Create Date: 2026-08-21

Null means "agent uses its own local default". For connector agents the
launcher reads this at adapter start (and on the model.set control event)
and passes it to the CLI; for cloud:* members the PATCH endpoint mirrors
the value into cloud_agent_configs.model, which stays the runtime source.
"""

from alembic import op
import sqlalchemy as sa


revision = "043"
down_revision = "042"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("workspace_members", sa.Column("model", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("workspace_members", "model")
