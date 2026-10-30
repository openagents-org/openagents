# -*- coding: utf-8 -*-
"""Add users.avatar_url — user-set profile picture.

Revision ID: 038
Revises: 037
Create Date: 2026-08-16

Holds an https:// URL or a small data:image/... URL (uploads are downscaled
client-side before saving; the PATCH endpoint enforces a size cap).
"""

from alembic import op
import sqlalchemy as sa


revision = "038"
down_revision = "037"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("avatar_url", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "avatar_url")
