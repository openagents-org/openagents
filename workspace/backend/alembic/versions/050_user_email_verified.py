# -*- coding: utf-8 -*-
"""Add users.email_verified_at — gate for API-credit minting/grants.

Stamped by app.access.get_or_create_user the first time a verified identity
token is seen (Google/Apple sign-in, or an email/password account that
confirmed the welcome-email link — carried as the `oa_email_verified` custom
claim by openagents.org's workspace handoff). Never cleared.

Revision ID: 050
Revises: 049
Create Date: 2026-09-20
"""

import sqlalchemy as sa
from alembic import op

revision = "050"
down_revision = "049"
branch_labels = None
depends_on = None


def _has_column(inspector, table, column) -> bool:
    if table not in inspector.get_table_names():
        return False
    return any(c["name"] == column for c in inspector.get_columns(table))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not _has_column(inspector, "users", "email_verified_at"):
        op.add_column("users", sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if _has_column(inspector, "users", "email_verified_at"):
        op.drop_column("users", "email_verified_at")
