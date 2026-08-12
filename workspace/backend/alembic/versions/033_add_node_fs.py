# -*- coding: utf-8 -*-
"""Add nodes.fs — filesystem hint for the working-directory picker.

Revision ID: 033
Revises: 032
Create Date: 2026-08-12

The daemon reports the device's home directory and its immediate subfolders each
heartbeat so the workspace's "Add agent" working-directory picker can show real
folders instantly (deeper browsing is on-demand via a list_dir command).
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "033"
down_revision = "032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "nodes",
        sa.Column("fs", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("nodes", "fs")
