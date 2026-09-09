# -*- coding: utf-8 -*-
"""Add device_tokens.prefs and clear the table for the APNs → FCM switch.

Revision ID: 048
Revises: 047
Create Date: 2026-09-09

Two changes that belong together because both are about the same cutover:

1. `prefs` (JSONB, nullable) stores the notification switches the user set on
   the device — {approvals, mentions, agentErrors, taskCompletions,
   allMessages, quietHours}. The push fan-out consults it before sending,
   since a banner the OS draws while the app is dead can only be stopped by
   not sending it. NULL means "registered before this column existed" and is
   read as all-on.

2. Every row currently in `device_tokens` holds an **APNs device token**,
   written by the previous direct-to-APNs sender. FCM cannot deliver to
   those — they are not registration tokens and every send would come back
   InvalidArgument. Rather than leave the table full of guaranteed-dead rows
   that the pruner would clear one failed send at a time, empty it here.
   Clients re-register their FCM token on next launch (the mobile apps call
   /v1/devices/register on every cold start), so the only user-visible effect
   is that a device gets no pushes until it is next opened.

Not reversible in any meaningful sense: downgrade drops the column, but the
deleted APNs tokens are gone for good.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "048"
down_revision = "047"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "device_tokens",
        sa.Column("prefs", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    # Purge the APNs-era tokens — see the module docstring.
    op.execute("DELETE FROM device_tokens")


def downgrade() -> None:
    op.drop_column("device_tokens", "prefs")
