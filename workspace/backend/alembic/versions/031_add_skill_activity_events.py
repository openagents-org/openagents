# -*- coding: utf-8 -*-
"""Add the append-only skill activity stream behind rolling leaderboards.

Revision ID: 031
Revises: 030
Create Date: 2026-08-08
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "031"
down_revision = "030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "skill_activity_events" in set(inspector.get_table_names()):
        return

    op.create_table(
        "skill_activity_events",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("skill_id", sa.Text(), sa.ForeignKey("registry_skills.id", ondelete="CASCADE"), nullable=False),
        sa.Column("event_type", sa.Text(), nullable=False),
        sa.Column("workspace_id", UUID(as_uuid=False), nullable=True),
        sa.Column("agent_name", sa.Text(), nullable=True),
        sa.Column("version_id", sa.Text(), nullable=True),
        sa.Column("self_authored", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
    )
    # Ranking reads a time range per skill; the dedup check additionally keys on
    # the installing workspace/agent.
    op.create_index(
        "idx_skill_activity_rank", "skill_activity_events",
        ["skill_id", "event_type", "created_at"],
    )
    op.create_index(
        "idx_skill_activity_dedup", "skill_activity_events",
        ["skill_id", "event_type", "workspace_id", "agent_name", "created_at"],
    )


def downgrade() -> None:
    for index_name in ("idx_skill_activity_dedup", "idx_skill_activity_rank"):
        try:
            op.drop_index(index_name, table_name="skill_activity_events")
        except Exception:
            pass
    try:
        op.drop_table("skill_activity_events")
    except Exception:
        pass
