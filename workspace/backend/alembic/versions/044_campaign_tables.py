# -*- coding: utf-8 -*-
"""API credits campaign — per-user gateway keys and the grant ledger.

Revision ID: 044
Revises: 043
Create Date: 2026-08-21

campaign_accounts: one gateway API key per user (full key stored so the UI
can re-display it; it's a hard-capped credential on our own gateway).
campaign_grants: one row per (user, milestone) — the unique constraint is the
first idempotency wall, the gateway's idempotency_key is the second.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "044"
down_revision = "043"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "campaign_accounts",
        sa.Column("user_id", UUID(as_uuid=False), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("gateway_key_id", sa.Integer(), nullable=False),
        sa.Column("api_key", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
    )
    op.create_table(
        "campaign_grants",
        sa.Column("id", UUID(as_uuid=False), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", UUID(as_uuid=False), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("milestone", sa.Text(), nullable=False),
        sa.Column("amount_usd", sa.Float(), nullable=False),
        sa.Column("new_limit_usd", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.UniqueConstraint("user_id", "milestone", name="uq_campaign_grants_user_milestone"),
    )
    op.create_index("idx_campaign_grants_user", "campaign_grants", ["user_id"])


def downgrade() -> None:
    op.drop_index("idx_campaign_grants_user", table_name="campaign_grants")
    op.drop_table("campaign_grants")
    op.drop_table("campaign_accounts")
