# -*- coding: utf-8 -*-
"""Add workspace_collaborators table for email-based sharing.

Revision ID: 005
Revises: 004
Create Date: 2026-03-11
"""

from alembic import op
import sqlalchemy as sa

revision = "005"
down_revision = "004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "workspace_collaborators",
        sa.Column("id", sa.Text(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("workspace_id", sa.Text(), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("role", sa.Text(), server_default="editor"),
        sa.Column("added_by", sa.Text(), nullable=True),
        sa.Column("added_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.UniqueConstraint("workspace_id", "email", name="uq_collaborator_workspace_email"),
    )
    op.create_index("idx_collaborators_workspace", "workspace_collaborators", ["workspace_id"])
    op.create_index("idx_collaborators_email", "workspace_collaborators", ["email"])


def downgrade() -> None:
    op.drop_index("idx_collaborators_email", "workspace_collaborators")
    op.drop_index("idx_collaborators_workspace", "workspace_collaborators")
    op.drop_table("workspace_collaborators")
