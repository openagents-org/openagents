# -*- coding: utf-8 -*-
"""Add project system: projects, project_members, project_contexts,
channel_sections, channel_human_members tables, and extend channels with
project_id, section_id, position, channel_type, agent_roles.

Revision ID: 023
Revises: 022
Create Date: 2026-05-28
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "023"
down_revision = "022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- Projects table ---
    op.create_table(
        "projects",
        sa.Column("id", UUID(as_uuid=False), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("workspace_id", UUID(as_uuid=False), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), server_default="active"),
        sa.Column("context_bot_name", sa.Text(), nullable=True),
        sa.Column("settings", JSONB, server_default="{}"),
        sa.Column("created_by", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
    )
    op.create_index("idx_projects_workspace_status", "projects", ["workspace_id", "status"])
    op.create_unique_constraint("uq_project_workspace_name", "projects", ["workspace_id", "name"])

    # --- Project members table ---
    op.create_table(
        "project_members",
        sa.Column("project_id", UUID(as_uuid=False), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_email", sa.Text(), nullable=False),
        sa.Column("role", sa.Text(), server_default="editor"),
        sa.Column("joined_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.PrimaryKeyConstraint("project_id", "user_email"),
    )
    op.create_index("idx_project_members_email", "project_members", ["user_email"])

    # --- Project contexts table ---
    op.create_table(
        "project_contexts",
        sa.Column("id", UUID(as_uuid=False), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=False), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("content_type", sa.Text(), server_default="markdown"),
        sa.Column("source_channel_id", UUID(as_uuid=False), nullable=True),
        sa.Column("updated_by", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
    )
    op.create_unique_constraint("uq_project_context_key", "project_contexts", ["project_id", "key"])
    op.create_index("idx_project_contexts_project", "project_contexts", ["project_id"])

    # --- Channel sections table ---
    op.create_table(
        "channel_sections",
        sa.Column("id", UUID(as_uuid=False), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=False), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("position", sa.Integer(), server_default=sa.text("0")),
        sa.Column("collapsed", sa.Boolean(), server_default=sa.text("FALSE")),
        sa.Column("created_by", sa.Text(), nullable=True),
    )
    op.create_index("idx_channel_sections_project", "channel_sections", ["project_id"])

    # --- Channel human members table ---
    op.create_table(
        "channel_human_members",
        sa.Column("channel_id", UUID(as_uuid=False), sa.ForeignKey("channels.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_email", sa.Text(), nullable=False),
        sa.Column("role", sa.Text(), server_default="member"),
        sa.Column("last_read_event_id", sa.Text(), nullable=True),
        sa.Column("joined_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.PrimaryKeyConstraint("channel_id", "user_email"),
    )
    op.create_index("idx_channel_human_members_email", "channel_human_members", ["user_email"])

    # --- Extend channels table ---
    op.add_column("channels", sa.Column("project_id", UUID(as_uuid=False), nullable=True))
    op.add_column("channels", sa.Column("section_id", UUID(as_uuid=False), nullable=True))
    op.add_column("channels", sa.Column("position", sa.Integer(), server_default=sa.text("0"), nullable=True))
    op.add_column("channels", sa.Column("channel_type", sa.Text(), server_default="general", nullable=True))
    op.add_column("channels", sa.Column("agent_roles", JSONB, nullable=True))

    op.create_foreign_key("fk_channels_project", "channels", "projects", ["project_id"], ["id"], ondelete="SET NULL")
    op.create_foreign_key("fk_channels_section", "channels", "channel_sections", ["section_id"], ["id"], ondelete="SET NULL")
    op.create_index("idx_channels_project", "channels", ["project_id"])
    op.create_index("idx_channels_section", "channels", ["section_id"])


def downgrade() -> None:
    # Remove channel extensions
    op.drop_index("idx_channels_section", "channels")
    op.drop_index("idx_channels_project", "channels")
    op.drop_constraint("fk_channels_section", "channels", type_="foreignkey")
    op.drop_constraint("fk_channels_project", "channels", type_="foreignkey")
    op.drop_column("channels", "agent_roles")
    op.drop_column("channels", "channel_type")
    op.drop_column("channels", "position")
    op.drop_column("channels", "section_id")
    op.drop_column("channels", "project_id")

    # Drop new tables (reverse order of creation)
    op.drop_table("channel_human_members")
    op.drop_table("channel_sections")
    op.drop_table("project_contexts")
    op.drop_table("project_members")
    op.drop_table("projects")
