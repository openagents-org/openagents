# -*- coding: utf-8 -*-
"""Add schema objects that were present in models but missing from migrations.

Revision ID: 015
Revises: 014
Create Date: 2026-05-22
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "015"
down_revision = "014"
branch_labels = None
depends_on = None


def _has_table(inspector: sa.Inspector, table_name: str) -> bool:
    return table_name in inspector.get_table_names()


def _has_column(inspector: sa.Inspector, table_name: str, column_name: str) -> bool:
    if not _has_table(inspector, table_name):
        return False
    return any(column["name"] == column_name for column in inspector.get_columns(table_name))


def _has_index(inspector: sa.Inspector, table_name: str, index_name: str) -> bool:
    if not _has_table(inspector, table_name):
        return False
    return any(index["name"] == index_name for index in inspector.get_indexes(table_name))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not _has_column(inspector, "workspace_members", "description"):
        op.add_column("workspace_members", sa.Column("description", sa.Text(), nullable=True))

    if not _has_column(inspector, "channels", "title_manually_set"):
        op.add_column(
            "channels",
            sa.Column("title_manually_set", sa.Boolean(), server_default=sa.text("FALSE"), nullable=False),
        )

    if not _has_column(inspector, "channels", "resume_from"):
        op.add_column("channels", sa.Column("resume_from", sa.Text(), nullable=True))

    if not _has_index(inspector, "channels", "uq_channels_ws_name"):
        op.create_index("uq_channels_ws_name", "channels", ["workspace_id", "name"], unique=True)

    if not _has_table(inspector, "files"):
        op.create_table(
            "files",
            sa.Column("id", sa.Text(), primary_key=True),
            sa.Column("workspace_id", UUID(as_uuid=False), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
            sa.Column("filename", sa.Text(), nullable=False),
            sa.Column("content_type", sa.Text(), nullable=False, server_default="application/octet-stream"),
            sa.Column("size", sa.Integer(), nullable=False),
            sa.Column("storage_key", sa.Text(), nullable=False),
            sa.Column("uploaded_by", sa.Text(), nullable=False),
            sa.Column("channel_name", sa.Text(), nullable=True),
            sa.Column("status", sa.Text(), nullable=False, server_default="active"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        )
        inspector = sa.inspect(bind)

    if not _has_index(inspector, "files", "idx_files_workspace_status"):
        op.create_index("idx_files_workspace_status", "files", ["workspace_id", "status"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if _has_index(inspector, "files", "idx_files_workspace_status"):
        op.drop_index("idx_files_workspace_status", table_name="files")
    if _has_table(inspector, "files"):
        op.drop_table("files")

    if _has_index(inspector, "channels", "uq_channels_ws_name"):
        op.drop_index("uq_channels_ws_name", table_name="channels")
    if _has_column(inspector, "channels", "resume_from"):
        op.drop_column("channels", "resume_from")
    if _has_column(inspector, "channels", "title_manually_set"):
        op.drop_column("channels", "title_manually_set")
    if _has_column(inspector, "workspace_members", "description"):
        op.drop_column("workspace_members", "description")
