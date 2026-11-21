"""A person's own settings in a workspace, shared across their devices.

Revision ID: 100
Revises: 099
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

# New table only; the running release ignores it.
deployment_backward_compatible = True
revision = '100'
down_revision = '099'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'personal_settings',
        sa.Column('workspace_id', UUID(as_uuid=False), sa.ForeignKey('workspaces.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('user_email', sa.Text(), primary_key=True),
        sa.Column('key', sa.Text(), primary_key=True),
        sa.Column('value', JSONB(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
    )


def downgrade():
    op.drop_table('personal_settings')
