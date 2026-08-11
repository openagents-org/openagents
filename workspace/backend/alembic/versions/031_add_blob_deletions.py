# -*- coding: utf-8 -*-
"""Add blob_deletions — a transactional outbox for FileStore deletions.

Deleting a blob is a side effect on a remote system (S3), so it can't join the
transaction that stops pointing at it. Doing it best-effort right after the
commit means one S3 timeout leaves an avatar the user asked us to remove
readable forever, with nothing in the system that knows about it.

Instead the row that stops pointing at a key and the row that says "delete this
key" commit together. A drainer then empties the table, retrying with backoff.
Deletion becomes a durable to-do rather than a fire-and-forget side effect.

Named `blob_deletions`, not `avatar_deletions`: nothing here is avatar-specific,
and any other FileStore blob needing reliable deletion can enqueue into it.

Revision ID: 031
Revises: 030
Create Date: 2026-08-11
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "031"
down_revision = "030"
branch_labels = None
depends_on = None


def _has_table(inspector, table) -> bool:
    return table in inspector.get_table_names()


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not _has_table(inspector, "blob_deletions"):
        op.create_table(
            "blob_deletions",
            sa.Column("id", UUID(as_uuid=False), primary_key=True),
            sa.Column("storage_key", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
            sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("next_retry_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
            sa.Column("last_error", sa.Text(), nullable=True),
        )
        # The drainer's only query is "rows due now, oldest first".
        op.create_index("idx_blob_deletions_due", "blob_deletions", ["next_retry_at"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if _has_table(inspector, "blob_deletions"):
        op.drop_index("idx_blob_deletions_due", table_name="blob_deletions")
        op.drop_table("blob_deletions")
