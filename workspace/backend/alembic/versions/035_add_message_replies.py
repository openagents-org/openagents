# -*- coding: utf-8 -*-
"""Add message_replies — at-most-once delivery for agent answers.

Durable agent consumption means an agent that dies mid-task reprocesses the
message on restart. That is the behaviour we want; the cost is that a crash
*after* the reply was posted but *before* it was recorded as done produces the
same answer twice. This table absorbs that.

Keyed on the position within the turn as well as the message being answered,
because one request does not mean one reply — an agent may ask a clarifying
question, report an interruption, and then send its conclusion. Without the
sequence, everything after the first would be swallowed.

Revision ID: 035
Revises: 034
Create Date: 2026-08-14
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "035"
down_revision = "034"
branch_labels = None
depends_on = None


def _has_table(inspector, table) -> bool:
    return table in inspector.get_table_names()


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not _has_table(inspector, "message_replies"):
        op.create_table(
            "message_replies",
            sa.Column("id", sa.Text(), primary_key=True),
            sa.Column("workspace_id", UUID(as_uuid=False), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
            sa.Column("source", sa.Text(), nullable=False),
            sa.Column("in_reply_to", sa.Text(), nullable=False),
            sa.Column("reply_seq", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("event_id", sa.Text(), nullable=False),
            sa.Column("channel_name", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
            sa.UniqueConstraint(
                "workspace_id", "source", "in_reply_to", "reply_seq",
                name="uq_message_reply_once",
            ),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if _has_table(inspector, "message_replies"):
        op.drop_table("message_replies")
