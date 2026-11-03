"""Add hosted_agents for provider-hosted (Acenta) cloud agents.

Revision ID: 091
Revises: 090
Create Date: 2026-11-03
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

# New table only; old application versions never read it.
deployment_backward_compatible = True
revision = "091"
down_revision = "090"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "hosted_agents" in set(sa.inspect(op.get_bind()).get_table_names()):
        return
    op.create_table(
        "hosted_agents",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("workspace_id", UUID(as_uuid=False), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.Text(), nullable=False, server_default="acenta"),
        sa.Column("agent_name", sa.Text(), nullable=True),
        sa.Column("display_name", sa.Text(), nullable=False),
        sa.Column("external_id", sa.Text(), nullable=True),
        sa.Column("node_id", UUID(as_uuid=False), sa.ForeignKey("nodes.id", ondelete="SET NULL"), nullable=True),
        sa.Column("owner_email", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="launching"),
        sa.Column("setup_url", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.UniqueConstraint("workspace_id", "agent_name", name="uq_hosted_agent_workspace_name"),
    )
    op.create_index("idx_hosted_agent_workspace", "hosted_agents", ["workspace_id"])


def downgrade() -> None:
    op.drop_index("idx_hosted_agent_workspace", table_name="hosted_agents")
    op.drop_table("hosted_agents")
