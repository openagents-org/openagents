# -*- coding: utf-8 -*-
"""Add nodes + node pairing codes (connect-a-node onboarding).

Revision ID: 030
Revises: 029
Create Date: 2026-08-04

A `node` is a device running the launcher daemon, connected to a workspace
independently of any agent (the early onboarding win). A `node_pairing_code` is
a short-lived, single-use code an owner/admin generates in the workspace so the
launcher can redeem it (→ workspace token) and register the node — no manual
workspace-id/token copy-paste.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "030"
down_revision = "029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "nodes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("node_key", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=True),
        sa.Column("hostname", sa.Text(), nullable=True),
        sa.Column("device_type", sa.Text(), server_default="unknown"),
        sa.Column("os", sa.Text(), nullable=True),
        sa.Column("launcher_version", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), server_default="offline"),
        sa.Column("last_heartbeat", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.UniqueConstraint("workspace_id", "node_key", name="uq_node_workspace_key"),
    )
    op.create_index("idx_nodes_workspace", "nodes", ["workspace_id"])

    op.create_table(
        "node_pairing_codes",
        sa.Column("code", sa.Text(), primary_key=True),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_by", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("redeemed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("node_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index("idx_pairing_workspace", "node_pairing_codes", ["workspace_id"])


def downgrade() -> None:
    op.drop_index("idx_pairing_workspace", "node_pairing_codes")
    op.drop_table("node_pairing_codes")
    op.drop_index("idx_nodes_workspace", "nodes")
    op.drop_table("nodes")
