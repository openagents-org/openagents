# -*- coding: utf-8 -*-
"""Per-node machine tokens + node attribution on members.

Revision ID: 045
Revises: 044
Create Date: 2026-08-23

nodes.token: a dedicated credential per (device, workspace), minted at pairing
redeem and reused on re-pair. Replaces handing devices the shared workspace
token — deleting the node row becomes real revocation, and rotating the
workspace token no longer bricks paired devices. Stored raw for parity with
workspaces.password_hash (hashing both is a later hardening pass).

workspace_members.node_id: stamped at /v1/join when the join authenticated
with a node token — finally answers "which device does this agent run on?".
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "045"
down_revision = "044"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("nodes", sa.Column("token", sa.Text(), nullable=True))
    op.create_index("ix_nodes_token", "nodes", ["token"], unique=True)
    op.add_column(
        "workspace_members",
        sa.Column(
            "node_id",
            UUID(as_uuid=False),
            sa.ForeignKey("nodes.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("workspace_members", "node_id")
    op.drop_index("ix_nodes_token", table_name="nodes")
    op.drop_column("nodes", "token")
