# -*- coding: utf-8 -*-
"""Add workspace_members.model_provider.

Revision ID: 050
Revises: 049
Create Date: 2026-09-17
"""

import sqlalchemy as sa
from alembic import op


revision = "050"
down_revision = "049"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "workspace_members",
        sa.Column("model_provider", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("workspace_members", "model_provider")
