# -*- coding: utf-8 -*-
"""Approvals — human-in-the-loop gates for agent actions.

Two tables:
  * approvals          — one row per "may I?" from an agent, with the policy
                         verdict, who resolved it and when.
  * approval_policies  — per-workspace ("*") and per-channel rules mapping an
                         action kind to allow | any | admin | owner | block.

Revision ID: 052
Revises: 051
Create Date: 2026-09-28
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "052"
down_revision = "051"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    tables = sa.inspect(bind).get_table_names()

    if "approvals" not in tables:
        op.create_table(
            "approvals",
            sa.Column("id", sa.Text(), primary_key=True),
            sa.Column("workspace_id", postgresql.UUID(as_uuid=False),
                      sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
            sa.Column("channel_name", sa.Text(), nullable=False),
            sa.Column("requested_by", sa.Text(), nullable=False),
            sa.Column("kind", sa.Text(), nullable=False),
            sa.Column("action", sa.Text(), nullable=False),
            sa.Column("details", sa.Text(), nullable=True),
            sa.Column("risk", sa.Text(), nullable=True),
            sa.Column("required_role", sa.Text(), nullable=False, server_default=sa.text("'any'")),
            sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'pending'")),
            sa.Column("resolved_by", sa.Text(), nullable=True),
            sa.Column("resolved_by_role", sa.Text(), nullable=True),
            sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("note", sa.Text(), nullable=True),
            sa.Column("request_event_id", sa.Text(), nullable=True),
            sa.Column("resolution_event_id", sa.Text(), nullable=True),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        )
        op.create_index("idx_approvals_workspace_status", "approvals", ["workspace_id", "status"])
        op.create_index("idx_approvals_workspace_channel", "approvals", ["workspace_id", "channel_name"])

    if "approval_policies" not in tables:
        op.create_table(
            "approval_policies",
            sa.Column("id", sa.Text(), primary_key=True),
            sa.Column("workspace_id", postgresql.UUID(as_uuid=False),
                      sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
            sa.Column("channel_name", sa.Text(), nullable=False, server_default=sa.text("'*'")),
            sa.Column("rules", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
            sa.Column("updated_by", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
            sa.UniqueConstraint("workspace_id", "channel_name", name="uq_approval_policies_ws_channel"),
        )


def downgrade() -> None:
    op.drop_table("approval_policies")
    op.drop_index("idx_approvals_workspace_channel", table_name="approvals")
    op.drop_index("idx_approvals_workspace_status", table_name="approvals")
    op.drop_table("approvals")
