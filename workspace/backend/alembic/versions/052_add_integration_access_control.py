# -*- coding: utf-8 -*-
"""Add integration_bindings access-control columns — Telegram allowlisting.

Revision ID: 052
Revises: 051
Create Date: 2026-09-20

Two independent gates on who can reach a bridged bot:

- access_mode / allowed_senders: which individual senders may talk to it
  ("open" = anyone, "allowlist" = only the listed Telegram user ids/usernames).
- restrict_chats / allowed_chats: which conversations (DMs or groups) it will
  bridge at all, regardless of who's in them.

Both default to today's fully-open behavior; existing bindings are untouched.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "052"
down_revision = "051"
branch_labels = None
depends_on = None


def _has_column(inspector, table, column) -> bool:
    if table not in inspector.get_table_names():
        return False
    return any(c["name"] == column for c in inspector.get_columns(table))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not _has_column(inspector, "integration_bindings", "access_mode"):
        op.add_column(
            "integration_bindings",
            sa.Column("access_mode", sa.Text(), nullable=False, server_default=sa.text("'open'")),
        )
    if not _has_column(inspector, "integration_bindings", "allowed_senders"):
        op.add_column(
            "integration_bindings",
            sa.Column("allowed_senders", JSONB(), server_default=sa.text("'[]'::jsonb"), nullable=True),
        )
    if not _has_column(inspector, "integration_bindings", "restrict_chats"):
        op.add_column(
            "integration_bindings",
            sa.Column("restrict_chats", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        )
    if not _has_column(inspector, "integration_bindings", "allowed_chats"):
        op.add_column(
            "integration_bindings",
            sa.Column("allowed_chats", JSONB(), server_default=sa.text("'[]'::jsonb"), nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    for column in ("allowed_chats", "restrict_chats", "allowed_senders", "access_mode"):
        if _has_column(inspector, "integration_bindings", column):
            op.drop_column("integration_bindings", column)
