"""Guest links into one thread (OpenAgents Share), and agent client capabilities.

Revision ID: 102
Revises: 101
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

# New tables and one nullable column; the running release ignores them.
deployment_backward_compatible = True
revision = '102'
down_revision = '101'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'thread_guest_links',
        sa.Column('id', sa.Text(), primary_key=True),
        sa.Column('workspace_id', UUID(as_uuid=False), sa.ForeignKey('workspaces.id', ondelete='CASCADE'), nullable=False),
        sa.Column('channel_name', sa.Text(), nullable=False),
        sa.Column('token', sa.Text(), nullable=False, unique=True),
        sa.Column('created_by', sa.Text(), nullable=False),
        sa.Column('owner_name', sa.Text(), nullable=True),
        sa.Column('can_post', sa.Boolean(), nullable=False, server_default=sa.text('TRUE')),
        sa.Column('approval_mode', sa.Text(), nullable=False, server_default=sa.text("'none'")),
        sa.Column('access', sa.Text(), nullable=False, server_default=sa.text("'link'")),
        sa.Column('allow_guest_agents', sa.Boolean(), nullable=False, server_default=sa.text('TRUE')),
        sa.Column('invited_emails', JSONB(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column('publish_key_hash', sa.Text(), nullable=True, unique=True),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('post_window_started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('post_window_count', sa.Integer(), nullable=False, server_default=sa.text('0')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
    )
    op.create_index('idx_thread_guest_links_channel', 'thread_guest_links', ['workspace_id', 'channel_name'])
    op.create_table(
        'thread_guests',
        sa.Column('id', sa.Text(), primary_key=True),
        sa.Column('link_id', sa.Text(), sa.ForeignKey('thread_guest_links.id', ondelete='CASCADE'), nullable=False),
        sa.Column('display_name', sa.Text(), nullable=False),
        sa.Column('email', sa.Text(), nullable=True),
        sa.Column('session_hash', sa.Text(), nullable=False, unique=True),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('post_window_started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('post_window_count', sa.Integer(), nullable=False, server_default=sa.text('0')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
        sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('idx_thread_guests_link', 'thread_guests', ['link_id'])
    op.create_table(
        'thread_guest_requests',
        sa.Column('id', sa.Text(), primary_key=True),
        sa.Column('link_id', sa.Text(), sa.ForeignKey('thread_guest_links.id', ondelete='CASCADE'), nullable=False),
        sa.Column('guest_id', sa.Text(), nullable=False),
        sa.Column('event_id', sa.Text(), nullable=False),
        sa.Column('status', sa.Text(), nullable=False, server_default=sa.text("'pending'")),
        sa.Column('decided_by', sa.Text(), nullable=True),
        sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('released_event_id', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
    )
    op.create_index('idx_thread_guest_requests_link', 'thread_guest_requests', ['link_id', 'status'])
    op.add_column('workspace_members', sa.Column('capabilities', JSONB(), nullable=True))
    op.add_column('nodes', sa.Column('scope_channel', sa.Text(), nullable=True))
    op.add_column('nodes', sa.Column('scope_agent', sa.Text(), nullable=True))


def downgrade():
    op.drop_column('workspace_members', 'capabilities')
    op.drop_column('nodes', 'scope_agent')
    op.drop_column('nodes', 'scope_channel')
    op.drop_index('idx_thread_guest_requests_link', table_name='thread_guest_requests')
    op.drop_table('thread_guest_requests')
    op.drop_index('idx_thread_guests_link', table_name='thread_guests')
    op.drop_table('thread_guests')
    op.drop_index('idx_thread_guest_links_channel', table_name='thread_guest_links')
    op.drop_table('thread_guest_links')
