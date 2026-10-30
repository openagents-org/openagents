# -*- coding: utf-8 -*-
"""Add workspace_invites — tokenized invitation links for human members.

Revision ID: 035
Revises: 034
Create Date: 2026-08-16

An invite link carries only a random token (never the workspace machine
token). Email-bound invites are consumed on first accept; open links stay
usable until expiry or revocation.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "035"
down_revision = "034"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "workspace_invites",
        sa.Column("id", postgresql.UUID(as_uuid=False), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=False), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token", sa.Text(), nullable=False, unique=True),
        sa.Column("email", sa.Text(), nullable=True),
        sa.Column("role", sa.Text(), nullable=False, server_default=sa.text("'member'")),
        sa.Column("created_by", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("accepted_by", sa.Text(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("idx_workspace_invites_workspace", "workspace_invites", ["workspace_id"])


def downgrade() -> None:
    op.drop_index("idx_workspace_invites_workspace", table_name="workspace_invites")
    op.drop_table("workspace_invites")
