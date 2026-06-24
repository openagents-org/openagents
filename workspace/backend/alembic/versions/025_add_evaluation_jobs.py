# -*- coding: utf-8 -*-
"""Add evaluation_jobs table for SWE-bench benchmark jobs.

Revision ID: 025
Revises: 024
Create Date: 2026-06-24

SWE-bench is an *evaluation* capability, not an agent. Each row is one
benchmark instance driven end-to-end (prepare working dir -> connected
coding agent -> collect git patch -> official Docker harness -> verdict).
Long-running work runs in a background worker, never on the request path.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID


revision = "025"
down_revision = "024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "evaluation_jobs",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("workspace_id", UUID(as_uuid=False), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("channel_name", sa.Text(), nullable=False),
        sa.Column("created_by", sa.Text(), nullable=False),
        sa.Column("dataset", sa.Text(), nullable=False),
        sa.Column("split", sa.Text(), nullable=False, server_default="test"),
        sa.Column("instance_id", sa.Text(), nullable=False),
        sa.Column("repo", sa.Text(), nullable=True),
        sa.Column("base_commit", sa.Text(), nullable=True),
        sa.Column("selected_agent", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="queued"),
        sa.Column("outcome", sa.Text(), nullable=True),
        sa.Column("resolved", sa.Boolean(), nullable=True),
        sa.Column("error_category", sa.Text(), nullable=True),
        sa.Column("error_reason", sa.Text(), nullable=True),
        sa.Column("cancel_requested", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("integrity_mode", sa.Text(), nullable=False, server_default="strict"),
        sa.Column("integrity_risk", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("environment", JSONB, nullable=True),
        sa.Column("patch_file_id", sa.Text(), nullable=True),
        sa.Column("log_file_id", sa.Text(), nullable=True),
        sa.Column("run_id", sa.Text(), nullable=True),
        sa.Column("work_dir", sa.Text(), nullable=True),
        sa.Column("docker_info", JSONB, nullable=True),
        sa.Column("report", JSONB, nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("agent_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("eval_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
    )
    op.create_index(
        "idx_evaluation_jobs_workspace_status",
        "evaluation_jobs",
        ["workspace_id", "status"],
    )
    op.create_index(
        "idx_evaluation_jobs_workspace_created",
        "evaluation_jobs",
        ["workspace_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("idx_evaluation_jobs_workspace_created", table_name="evaluation_jobs")
    op.drop_index("idx_evaluation_jobs_workspace_status", table_name="evaluation_jobs")
    op.drop_table("evaluation_jobs")
