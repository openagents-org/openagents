# -*- coding: utf-8 -*-
"""Add human users + workspace memberships + require_login (enforced-login v1.0).

Revision ID: 028
Revises: 027
Create Date: 2026-08-03

Introduces first-class human identity and workspace membership for OpenAgents
Workspace v1.0's enforced-login model, plus a per-workspace opt-in switch:

  - `users` — a human end-user resolved from a verified Google/Apple ID token.
  - `workspace_memberships` — user↔workspace with role (owner|admin|member|
    viewer); the replacement for owner=creator_email + editor/viewer
    collaborators.
  - `workspaces.require_login` — when True, human web/mobile access requires a
    member identity. Defaults False so every existing workspace keeps its
    current behaviour (token access, or open when no token) untouched.

Additive only — no data backfill. Existing email-keyed access (creator_email,
collaborators) is reconciled into memberships lazily at login, so nothing
breaks and no bulk migration is needed. Agents/daemons continue to use the
workspace token regardless of require_login.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "028"
down_revision = "027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("firebase_uid", sa.Text(), nullable=True),
        sa.Column("apple_sub", sa.Text(), nullable=True),
        sa.Column("display_name", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("email", name="uq_users_email"),
    )

    op.create_table(
        "workspace_memberships",
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.Text(), nullable=False, server_default=sa.text("'member'")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.PrimaryKeyConstraint("workspace_id", "user_id"),
    )
    op.create_index("idx_memberships_user", "workspace_memberships", ["user_id"])

    op.add_column(
        "workspaces",
        sa.Column("require_login", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )


def downgrade() -> None:
    op.drop_column("workspaces", "require_login")
    op.drop_index("idx_memberships_user", "workspace_memberships")
    op.drop_table("workspace_memberships")
    op.drop_table("users")
