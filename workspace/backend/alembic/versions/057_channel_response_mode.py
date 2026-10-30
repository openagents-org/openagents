"""Add per-thread proactive/passive response mode.

Revision ID: 057
Revises: 056
"""
from alembic import op
import sqlalchemy as sa

revision = "057"
down_revision = "056"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("channels", sa.Column("response_mode", sa.Text(), nullable=False, server_default="proactive"))


def downgrade():
    op.drop_column("channels", "response_mode")
