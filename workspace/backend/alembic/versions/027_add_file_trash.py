# -*- coding: utf-8 -*-
"""Add trash columns to files.

Soft-deleted records already existed (status = "deleted") but carried nothing
about the deletion itself, so they could be neither listed nor restored as a
unit. These three nullable columns add that:

    deleted_at   when it was trashed — also what a future expiry sweep reads
    trash_id     groups one delete action, so a folder's files restore together
    trash_path   what the user deleted: a file's path, or a folder's

Records deleted before this migration keep NULL in all three; the trash listing
treats each of them as its own single-file entry.

Revision ID: 027
Revises: 026
Create Date: 2026-07-30
"""

import sqlalchemy as sa
from alembic import op

revision = "027"
down_revision = "026"
branch_labels = None
depends_on = None


def _has_column(inspector, table, column):
    if table not in inspector.get_table_names():
        return False
    return any(c["name"] == column for c in inspector.get_columns(table))


def _has_index(inspector, table, index):
    if table not in inspector.get_table_names():
        return False
    return any(i["name"] == index for i in inspector.get_indexes(table))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not _has_column(inspector, "files", "deleted_at"):
        op.add_column("files", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    if not _has_column(inspector, "files", "trash_id"):
        op.add_column("files", sa.Column("trash_id", sa.Text(), nullable=True))
    if not _has_column(inspector, "files", "trash_path"):
        op.add_column("files", sa.Column("trash_path", sa.Text(), nullable=True))

    inspector = sa.inspect(bind)
    if not _has_index(inspector, "files", "idx_files_trash"):
        op.create_index("idx_files_trash", "files", ["workspace_id", "trash_id"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if _has_index(inspector, "files", "idx_files_trash"):
        op.drop_index("idx_files_trash", table_name="files")
    for column in ("trash_path", "trash_id", "deleted_at"):
        if _has_column(inspector, "files", column):
            op.drop_column("files", column)
