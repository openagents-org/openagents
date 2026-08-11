# -*- coding: utf-8 -*-
"""Add avatar columns to users.

The bytes live in the existing `FileStore` under `avatars/{user_id}/{blob_id}.webp`
— `avatar_key` holds that storage key and nothing else. Deliberately NOT a
`FileRecord` row: the Files page lists FileRecords by workspace, and an avatar
belongs to a user across every workspace they're in, so it must not show up
there (nor be deletable from it).

`avatar_updated_at` is display/diagnostics only. Cache-busting rides on the
random `blob_id` inside the key, so the URL changes on its own every upload.

Revision ID: 030
Revises: 029
Create Date: 2026-08-11
"""

import sqlalchemy as sa
from alembic import op

revision = "030"
down_revision = "029"
branch_labels = None
depends_on = None


def _columns(inspector, table) -> set:
    return {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = _columns(inspector, "users")

    if "avatar_key" not in existing:
        op.add_column("users", sa.Column("avatar_key", sa.Text(), nullable=True))
    if "avatar_updated_at" not in existing:
        op.add_column("users", sa.Column("avatar_updated_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = _columns(inspector, "users")

    if "avatar_updated_at" in existing:
        op.drop_column("users", "avatar_updated_at")
    if "avatar_key" in existing:
        op.drop_column("users", "avatar_key")
