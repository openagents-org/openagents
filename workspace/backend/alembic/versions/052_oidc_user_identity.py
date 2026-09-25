# -*- coding: utf-8 -*-
"""Add stable OIDC identity fields to users.

Revision ID: 052
Revises: 051
Create Date: 2026-09-24
"""

import sqlalchemy as sa
from alembic import op

revision = "052"
down_revision = "051"
branch_labels = None
depends_on = None


def _has_column(inspector, table: str, column: str) -> bool:
    return table in inspector.get_table_names() and any(item["name"] == column for item in inspector.get_columns(table))


def _has_check(inspector, name: str) -> bool:
    return name in {item["name"] for item in inspector.get_check_constraints("users")}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "users" not in inspector.get_table_names():
        return
    if not _has_column(inspector, "users", "oidc_issuer"):
        op.add_column("users", sa.Column("oidc_issuer", sa.Text(), nullable=True))
    if not _has_column(inspector, "users", "oidc_subject"):
        op.add_column("users", sa.Column("oidc_subject", sa.Text(), nullable=True))
    if not _has_column(inspector, "users", "disabled_at"):
        op.add_column("users", sa.Column("disabled_at", sa.DateTime(timezone=True), nullable=True))
    if not _has_column(inspector, "users", "is_invite_placeholder"):
        op.add_column(
            "users",
            sa.Column("is_invite_placeholder", sa.Boolean(), nullable=False, server_default=sa.text("FALSE")),
        )
    op.execute(
        sa.text(
            "UPDATE users SET is_invite_placeholder = TRUE "
            "WHERE oidc_issuer IS NULL AND firebase_uid IS NULL AND apple_sub IS NULL "
            "AND last_login_at IS NULL AND email_verified_at IS NULL AND disabled_at IS NULL "
            "AND EXISTS (SELECT 1 FROM workspace_memberships wm WHERE wm.user_id = users.id)"
        )
    )
    constraints = {item["name"] for item in inspector.get_unique_constraints("users")}
    if "uq_users_oidc_identity" not in constraints:
        op.create_unique_constraint("uq_users_oidc_identity", "users", ["oidc_issuer", "oidc_subject"])
    if not _has_check(inspector, "ck_users_oidc_identity_pair"):
        op.create_check_constraint(
            "ck_users_oidc_identity_pair",
            "users",
            "(oidc_issuer IS NULL) = (oidc_subject IS NULL)",
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "users" not in inspector.get_table_names():
        return
    constraints = {item["name"] for item in inspector.get_unique_constraints("users")}
    if _has_check(inspector, "ck_users_oidc_identity_pair"):
        op.drop_constraint("ck_users_oidc_identity_pair", "users", type_="check")
    if "uq_users_oidc_identity" in constraints:
        op.drop_constraint("uq_users_oidc_identity", "users", type_="unique")
    if _has_column(inspector, "users", "oidc_subject"):
        op.drop_column("users", "oidc_subject")
    if _has_column(inspector, "users", "oidc_issuer"):
        op.drop_column("users", "oidc_issuer")
    if _has_column(inspector, "users", "disabled_at"):
        op.drop_column("users", "disabled_at")
    if _has_column(inspector, "users", "is_invite_placeholder"):
        op.drop_column("users", "is_invite_placeholder")
