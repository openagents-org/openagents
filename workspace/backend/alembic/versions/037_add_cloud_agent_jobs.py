# -*- coding: utf-8 -*-
"""Add cloud_agent_jobs — durable invocation for server-side agents.

A cloud agent is woken by a function call in this process, and that call used
to be a FastAPI background task: it lives and dies with the worker handling the
request. A deploy or a crash between the message landing and the model
answering meant the agent never replied, with nothing left to show it should
have. Locally-run agents were made recoverable by the durable consumption work;
this is the same guarantee for the ones that run here.

Rows are written in the same transaction as the triggering message, so the
queue cannot disagree with the event log.

Revision ID: 037
Revises: 036
Create Date: 2026-08-14
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "037"
down_revision = "036"
branch_labels = None
depends_on = None


def _has_table(inspector, table) -> bool:
    return table in inspector.get_table_names()


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not _has_table(inspector, "cloud_agent_jobs"):
        op.create_table(
            "cloud_agent_jobs",
            sa.Column("id", sa.Text(), primary_key=True),
            sa.Column("workspace_id", UUID(as_uuid=False), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
            sa.Column("agent_name", sa.Text(), nullable=False),
            sa.Column("event_id", sa.Text(), nullable=False),
            sa.Column("event_snapshot", JSONB(), nullable=False),
            sa.Column("status", sa.Text(), nullable=False, server_default="pending"),
            sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("next_attempt_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
            sa.Column("last_error", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
            sa.UniqueConstraint("event_id", "agent_name", name="uq_cloud_agent_job_event"),
        )
        op.create_index(
            "idx_cloud_agent_jobs_due", "cloud_agent_jobs", ["status", "next_attempt_at"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if _has_table(inspector, "cloud_agent_jobs"):
        op.drop_index("idx_cloud_agent_jobs_due", table_name="cloud_agent_jobs")
        op.drop_table("cloud_agent_jobs")
