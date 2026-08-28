# -*- coding: utf-8 -*-
"""Add users.welcome_seen — has this account dismissed the first-run welcome?

Revision ID: 047
Revises: 046
Create Date: 2026-08-28

Per-account (not per-device) flag so the mobile onboarding welcome shows
exactly once across all of a user's devices.
"""

from alembic import op
import sqlalchemy as sa


revision = "047"
down_revision = "046"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("welcome_seen", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )


def downgrade() -> None:
    op.drop_column("users", "welcome_seen")
