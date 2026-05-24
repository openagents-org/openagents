# -*- coding: utf-8 -*-
"""Initial schema — events table + workspace state tables.

Revision ID: 001
Revises: -
Create Date: 2026-03-03
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Events — the core event log
    op.create_table(
        "events",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("network_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("type", sa.Text(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("target", sa.Text(), nullable=False),
        sa.Column("payload", postgresql.JSONB()),
        sa.Column("metadata", postgresql.JSONB(), server_default="{}"),
        sa.Column("timestamp", sa.BigInteger(), nullable=False),
        sa.Column("visibility", sa.Text(), server_default="channel"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_events_network_type", "events", ["network_id", "type"])
    op.create_index("idx_events_network_target", "events", ["network_id", "target"])
    op.create_index("idx_events_network_timestamp", "events", ["network_id", "timestamp"])

    # Workspaces
    op.create_table(
        "workspaces",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("slug", sa.Text(), unique=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("creator_email", sa.Text()),
        sa.Column("password_hash", sa.Text()),
        sa.Column("settings", postgresql.JSONB(), server_default="{}"),
        sa.Column("status", sa.Text(), server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.Column("last_activity_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.PrimaryKeyConstraint("id"),
    )

    # Workspace members
    op.create_table(
        "workspace_members",
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("agent_name", sa.Text(), nullable=False),
        sa.Column("role", sa.Text(), server_default="member"),
        sa.Column("status", sa.Text(), server_default="offline"),
        sa.Column("last_heartbeat", sa.DateTime(timezone=True)),
        sa.Column("joined_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.PrimaryKeyConstraint("workspace_id", "agent_name"),
    )

    # Channels
    op.create_table(
        "channels",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("title", sa.Text()),
        sa.Column("created_by", sa.Text()),
        sa.Column("master_agent", sa.Text()),
        sa.Column("status", sa.Text(), server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.PrimaryKeyConstraint("id"),
    )

    # Channel members (per-thread participants)
    op.create_table(
        "channel_members",
        sa.Column("channel_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("channels.id", ondelete="CASCADE"), nullable=False),
        sa.Column("agent_name", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("channel_id", "agent_name"),
    )

    # Invitations
    op.create_table(
        "invitations",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("target_agent", sa.Text(), nullable=False),
        sa.Column("invite_token", sa.Text(), nullable=False, unique=True),
        sa.Column("status", sa.Text(), server_default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    # Agents (standalone mode)
    op.create_table(
        "agents",
        sa.Column("agent_name", sa.Text(), nullable=False),
        sa.Column("display_name", sa.Text()),
        sa.Column("agent_type", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.PrimaryKeyConstraint("agent_name"),
    )

    # Browser tabs
    op.create_table(
        "browser_tabs",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=False), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("url", sa.Text(), nullable=False, server_default="about:blank"),
        sa.Column("title", sa.Text()),
        sa.Column("status", sa.Text(), nullable=False, server_default="active"),
        sa.Column("created_by", sa.Text(), nullable=False),
        sa.Column("shared_with", postgresql.JSONB(), server_default="[]"),
        sa.Column("session_id", sa.Text()),
        sa.Column("live_url", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.Column("last_active_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
    )
    op.create_index("idx_browser_tabs_workspace_status", "browser_tabs", ["workspace_id", "status"])


def downgrade() -> None:
    op.drop_index("idx_browser_tabs_workspace_status", "browser_tabs")
    op.drop_table("browser_tabs")
    op.drop_table("agents")
    op.drop_table("invitations")
    op.drop_table("channel_members")
    op.drop_table("channels")
    op.drop_table("workspace_members")
    op.drop_table("workspaces")
    op.drop_index("idx_events_network_timestamp", table_name="events")
    op.drop_index("idx_events_network_target", table_name="events")
    op.drop_index("idx_events_network_type", table_name="events")
    op.drop_table("events")
