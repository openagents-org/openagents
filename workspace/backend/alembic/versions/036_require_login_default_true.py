# -*- coding: utf-8 -*-
"""Default workspaces.require_login to TRUE — secure by default.

Revision ID: 036
Revises: 035
Create Date: 2026-08-16

Only the column DEFAULT changes; existing rows keep their current value
(flipping legacy open workspaces to enforced could lock out their anonymous
users). Machine/token access is unaffected by require_login, so CLI-created
workspaces keep working; owners can still opt out via the Security settings.
"""

from alembic import op
import sqlalchemy as sa


revision = "036"
down_revision = "035"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("workspaces", "require_login", server_default=sa.text("TRUE"))


def downgrade() -> None:
    op.alter_column("workspaces", "require_login", server_default=sa.text("FALSE"))
