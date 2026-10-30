# -*- coding: utf-8 -*-
"""Add integration_bindings.external_team_id — official Slack app routing.

Revision ID: 039
Revises: 038
Create Date: 2026-08-16

The official (Add to Slack) OpenAgents app delivers all teams' events to one
shared endpoint; the Slack team id is how an inbound event finds its binding.
"""

from alembic import op
import sqlalchemy as sa


revision = "039"
down_revision = "038"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("integration_bindings", sa.Column("external_team_id", sa.Text(), nullable=True))
    op.create_index("idx_integration_bindings_team", "integration_bindings", ["external_team_id"])


def downgrade() -> None:
    op.drop_index("idx_integration_bindings_team", table_name="integration_bindings")
    op.drop_column("integration_bindings", "external_team_id")
