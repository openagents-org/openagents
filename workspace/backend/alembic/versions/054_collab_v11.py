# -*- coding: utf-8 -*-
"""Roadmap v1.1 — private agents and threads, team sharing, escalation to owner.

One migration for the whole v1.1 slice so the milestone branches never race
on schema:

  * workspace_members  — owner_email / visibility (personal|team), specialist
                         profile (purpose, example_requests, required_inputs,
                         shared_instructions, allowed_knowledge, cost_owner)
                         and live presence detail (presence_state, busy_channels,
                         queue_depth).
  * channels           — visibility (workspace|private) + director_email.
  * agent_grants       — "teammate X may use personal agent Y".
  * workspace_invites  — target_kind/target_id/note so an invite lands on the
                         agent, thread or task that motivated it.
  * notifications      — recipient_email (NULL = everyone), kind, action_ref.
  * approvals          — assignee_email (a specific person must resolve).
  * channel_briefs     — the persistent shared work brief per thread.
  * agent_pins         — per-person pinned specialists.

Revision ID: 054
Revises: 053
Create Date: 2026-09-30
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "054"
down_revision = "053"
branch_labels = None
depends_on = None


def _cols(bind, table):
    return {c["name"] for c in sa.inspect(bind).get_columns(table)}


def _add(bind, table, column):
    if column.name not in _cols(bind, table):
        op.add_column(table, column)


def upgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())

    # --- workspace_members -------------------------------------------------
    _add(bind, "workspace_members", sa.Column("owner_email", sa.Text(), nullable=True))
    _add(bind, "workspace_members", sa.Column("visibility", sa.Text(), nullable=False, server_default=sa.text("'team'")))
    _add(bind, "workspace_members", sa.Column("purpose", sa.Text(), nullable=True))
    _add(bind, "workspace_members", sa.Column("example_requests", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    _add(bind, "workspace_members", sa.Column("required_inputs", sa.Text(), nullable=True))
    _add(bind, "workspace_members", sa.Column("shared_instructions", sa.Text(), nullable=True))
    _add(bind, "workspace_members", sa.Column("allowed_knowledge", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    _add(bind, "workspace_members", sa.Column("cost_owner", sa.Text(), nullable=True))
    _add(bind, "workspace_members", sa.Column("presence_state", sa.Text(), nullable=True))
    _add(bind, "workspace_members", sa.Column("busy_channels", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    _add(bind, "workspace_members", sa.Column("queue_depth", sa.Integer(), nullable=False, server_default=sa.text("0")))
    op.create_index("idx_workspace_members_owner", "workspace_members", ["workspace_id", "owner_email"], if_not_exists=True)

    # --- channels ------------------------------------------------------------
    _add(bind, "channels", sa.Column("visibility", sa.Text(), nullable=False, server_default=sa.text("'workspace'")))
    _add(bind, "channels", sa.Column("director_email", sa.Text(), nullable=True))
    op.create_index("idx_channels_workspace_visibility", "channels", ["workspace_id", "visibility"], if_not_exists=True)

    # --- agent_grants --------------------------------------------------------
    if "agent_grants" not in tables:
        op.create_table(
            "agent_grants",
            sa.Column("id", sa.Text(), primary_key=True),
            sa.Column("workspace_id", postgresql.UUID(as_uuid=False),
                      sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
            sa.Column("agent_name", sa.Text(), nullable=False),
            sa.Column("grantee_email", sa.Text(), nullable=False),
            sa.Column("granted_by", sa.Text(), nullable=True),
            sa.Column("note", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("revoked_by", sa.Text(), nullable=True),
        )
        op.create_index("idx_agent_grants_agent", "agent_grants", ["workspace_id", "agent_name"])
        op.create_index("idx_agent_grants_grantee", "agent_grants", ["workspace_id", "grantee_email"])

    # --- workspace_invites ---------------------------------------------------
    _add(bind, "workspace_invites", sa.Column("target_kind", sa.Text(), nullable=True))
    _add(bind, "workspace_invites", sa.Column("target_id", sa.Text(), nullable=True))
    _add(bind, "workspace_invites", sa.Column("note", sa.Text(), nullable=True))

    # --- notifications -------------------------------------------------------
    _add(bind, "notifications", sa.Column("recipient_email", sa.Text(), nullable=True))
    _add(bind, "notifications", sa.Column("kind", sa.Text(), nullable=True))
    _add(bind, "notifications", sa.Column("action_ref", sa.Text(), nullable=True))
    op.create_index("idx_notifications_recipient", "notifications", ["workspace_id", "recipient_email"], if_not_exists=True)

    # --- approvals -----------------------------------------------------------
    _add(bind, "approvals", sa.Column("assignee_email", sa.Text(), nullable=True))

    # --- channel_briefs ------------------------------------------------------
    if "channel_briefs" not in tables:
        op.create_table(
            "channel_briefs",
            sa.Column("workspace_id", postgresql.UUID(as_uuid=False),
                      sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
            sa.Column("channel_name", sa.Text(), nullable=False),
            sa.Column("objective", sa.Text(), nullable=True),
            sa.Column("owner", sa.Text(), nullable=True),
            sa.Column("latest_result", sa.Text(), nullable=True),
            sa.Column("open_questions", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
            sa.Column("next_step", sa.Text(), nullable=True),
            sa.Column("updated_by", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
            sa.PrimaryKeyConstraint("workspace_id", "channel_name"),
        )

    # --- agent_pins ----------------------------------------------------------
    if "agent_pins" not in tables:
        op.create_table(
            "agent_pins",
            sa.Column("workspace_id", postgresql.UUID(as_uuid=False),
                      sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
            sa.Column("user_email", sa.Text(), nullable=False),
            sa.Column("agent_name", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
            sa.PrimaryKeyConstraint("workspace_id", "user_email", "agent_name"),
        )


def downgrade() -> None:
    op.drop_table("agent_pins")
    op.drop_table("channel_briefs")
    op.drop_column("approvals", "assignee_email")
    op.drop_index("idx_notifications_recipient", table_name="notifications")
    for c in ("recipient_email", "kind", "action_ref"):
        op.drop_column("notifications", c)
    for c in ("target_kind", "target_id", "note"):
        op.drop_column("workspace_invites", c)
    op.drop_index("idx_agent_grants_grantee", table_name="agent_grants")
    op.drop_index("idx_agent_grants_agent", table_name="agent_grants")
    op.drop_table("agent_grants")
    op.drop_index("idx_channels_workspace_visibility", table_name="channels")
    for c in ("visibility", "director_email"):
        op.drop_column("channels", c)
    op.drop_index("idx_workspace_members_owner", table_name="workspace_members")
    for c in ("owner_email", "visibility", "purpose", "example_requests", "required_inputs",
              "shared_instructions", "allowed_knowledge", "cost_owner", "presence_state",
              "busy_channels", "queue_depth"):
        op.drop_column("workspace_members", c)
