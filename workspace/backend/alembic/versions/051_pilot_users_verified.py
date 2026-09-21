# -*- coding: utf-8 -*-
"""Pilot Program users count as email-verified.

A pilot grant is applied by a team member who checked the person by hand, so
it is a stronger verification than a confirmed email link. When the verified-
email gate for API credits landed (050, 2026-09-20) the 59 existing pilot
users had no stamp yet and were shut behind the verify wall; this backfills
them from their pilot grant. Idempotent; never touches an existing stamp.

Revision ID: 051
Revises: 050
Create Date: 2026-09-20
"""

import sqlalchemy as sa
from alembic import op

revision = "051"
down_revision = "050"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()
    if "users" not in tables or "campaign_grants" not in tables:
        return
    if not any(c["name"] == "email_verified_at" for c in inspector.get_columns("users")):
        return
    op.execute(sa.text("""
        UPDATE users u
           SET email_verified_at = g.created_at
          FROM campaign_grants g
         WHERE g.user_id = u.id
           AND g.milestone = 'pilot'
           AND u.email_verified_at IS NULL
    """))


def downgrade() -> None:
    # Verification is a fact about the person; there is nothing to undo.
    pass
