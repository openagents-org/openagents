# -*- coding: utf-8 -*-
"""Add description column to workspace_members table.

Revision ID: 015
Revises: 014
Create Date: 2026-05-24
"""

from alembic import op
import sqlalchemy as sa


revision = "015"
down_revision = "014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "workspace_members",
        sa.Column("description", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("workspace_members", "description")
