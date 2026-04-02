# -*- coding: utf-8 -*-
"""Catch-up: add files table and missing columns on channels/workspace_members.

Revision ID: 007
Revises: 006
Create Date: 2026-04-02
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "007"
down_revision = "006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Files table (missing from initial migration)
    op.create_table(
        "files",
        sa.Column("id", sa.Text(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=False), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("filename", sa.Text(), nullable=False),
        sa.Column("content_type", sa.Text(), nullable=False, server_default="application/octet-stream"),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("storage_key", sa.Text(), nullable=False),
        sa.Column("uploaded_by", sa.Text(), nullable=False),
        sa.Column("channel_name", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
    )
    op.create_index("idx_files_workspace_status", "files", ["workspace_id", "status"])

    # Missing columns on channels
    op.add_column("channels", sa.Column("title_manually_set", sa.Boolean(), server_default=sa.text("FALSE")))
    op.add_column("channels", sa.Column("resume_from", sa.Text(), nullable=True))

    # Missing column on workspace_members
    op.add_column("workspace_members", sa.Column("description", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("workspace_members", "description")
    op.drop_column("channels", "resume_from")
    op.drop_column("channels", "title_manually_set")
    op.drop_index("idx_files_workspace_status", "files")
    op.drop_table("files")
