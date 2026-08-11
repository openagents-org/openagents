# -*- coding: utf-8 -*-
"""Add nodes.runtimes — per-agent-type detection reported by the daemon.

Revision ID: 032
Revises: 031
Create Date: 2026-08-11

The daemon detects, for each supported agent type, whether its runtime is
installed on the device and whether it's logged-in/ready (via the launcher's
healthCheck). It reports this on the heartbeat so the workspace "Add agent"
gallery can show what's available on a node.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "032"
down_revision = "031"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "nodes",
        sa.Column("runtimes", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'[]'::jsonb"), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("nodes", "runtimes")
