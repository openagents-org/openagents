# -*- coding: utf-8 -*-
"""Add the platform-integration tables (Slack / Lark / Telegram bridge).

An exported agent becomes one `integration_bindings` row. Everything the
gateway may do is derived from that row: the restricted credential it presents
(`integration_keys`), the external threads it may open (`integration_conversations`),
and the two idempotency ledgers that make a retried webhook harmless
(`integration_inbound` for messages, `integration_file_uploads` for attachments).

Platform credentials are deliberately absent — the gateway holds those.

Revision ID: 035
Revises: 034
Create Date: 2026-08-14
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "035"
down_revision = "034"
branch_labels = None
depends_on = None


def _has_table(inspector, table) -> bool:
    return table in inspector.get_table_names()


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not _has_table(inspector, "integration_bindings"):
        op.create_table(
            "integration_bindings",
            sa.Column("id", sa.Text(), primary_key=True),
            sa.Column("workspace_id", UUID(as_uuid=False), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
            sa.Column("platform", sa.Text(), nullable=False),
            sa.Column("agent_name", sa.Text(), nullable=False),
            sa.Column("installation", JSONB(), server_default=sa.text("'{}'")),
            sa.Column("external_scope", JSONB(), server_default=sa.text("'{}'")),
            sa.Column("status", sa.Text(), nullable=False, server_default="authorizing"),
            sa.Column("ticket_nonce_hash", sa.Text(), nullable=True),
            sa.Column("ticket_expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_by", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
            sa.Column("activated_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("disconnect_requested_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("disconnected_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("idx_integration_bindings_workspace", "integration_bindings", ["workspace_id", "status"])
        op.create_index("idx_integration_bindings_agent", "integration_bindings", ["workspace_id", "agent_name"])

    if not _has_table(inspector, "integration_keys"):
        op.create_table(
            "integration_keys",
            sa.Column("id", sa.Text(), primary_key=True),
            sa.Column("binding_id", sa.Text(), sa.ForeignKey("integration_bindings.id", ondelete="CASCADE"), nullable=False),
            sa.Column("key_hash", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.UniqueConstraint("key_hash", name="uq_integration_key_hash"),
        )
        op.create_index("idx_integration_keys_binding", "integration_keys", ["binding_id"])

    if not _has_table(inspector, "integration_conversations"):
        op.create_table(
            "integration_conversations",
            sa.Column("id", sa.Text(), primary_key=True),
            sa.Column("binding_id", sa.Text(), sa.ForeignKey("integration_bindings.id", ondelete="CASCADE"), nullable=False),
            sa.Column("external_key", sa.Text(), nullable=False),
            sa.Column("conversation_kind", sa.Text(), nullable=False, server_default="dm"),
            sa.Column("channel_id", UUID(as_uuid=False), sa.ForeignKey("channels.id", ondelete="CASCADE"), nullable=False),
            sa.Column("channel_name", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
            sa.UniqueConstraint("binding_id", "external_key", name="uq_integration_conv_binding_key"),
            sa.UniqueConstraint("channel_id", name="uq_integration_conv_channel"),
        )

    if not _has_table(inspector, "integration_inbound"):
        op.create_table(
            "integration_inbound",
            sa.Column("id", sa.Text(), primary_key=True),
            sa.Column("binding_id", sa.Text(), sa.ForeignKey("integration_bindings.id", ondelete="CASCADE"), nullable=False),
            sa.Column("idempotency_key", sa.Text(), nullable=False),
            sa.Column("event_id", sa.Text(), nullable=False),
            sa.Column("channel_name", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
            sa.UniqueConstraint("binding_id", "idempotency_key", name="uq_integration_inbound_key"),
        )

    if not _has_table(inspector, "integration_file_uploads"):
        op.create_table(
            "integration_file_uploads",
            sa.Column("id", sa.Text(), primary_key=True),
            sa.Column("binding_id", sa.Text(), sa.ForeignKey("integration_bindings.id", ondelete="CASCADE"), nullable=False),
            sa.Column("platform_event_id", sa.Text(), nullable=False),
            sa.Column("platform_file_id", sa.Text(), nullable=False),
            sa.Column("file_id", sa.Text(), nullable=False),
            sa.Column("attached_event_id", sa.Text(), nullable=True),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
            sa.UniqueConstraint(
                "binding_id", "platform_event_id", "platform_file_id",
                name="uq_integration_file_upload",
            ),
        )
        op.create_index(
            "idx_integration_file_uploads_orphan",
            "integration_file_uploads",
            ["attached_event_id", "expires_at"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if _has_table(inspector, "integration_file_uploads"):
        op.drop_index("idx_integration_file_uploads_orphan", table_name="integration_file_uploads")
        op.drop_table("integration_file_uploads")
    if _has_table(inspector, "integration_inbound"):
        op.drop_table("integration_inbound")
    if _has_table(inspector, "integration_conversations"):
        op.drop_table("integration_conversations")
    if _has_table(inspector, "integration_keys"):
        op.drop_index("idx_integration_keys_binding", table_name="integration_keys")
        op.drop_table("integration_keys")
    if _has_table(inspector, "integration_bindings"):
        op.drop_index("idx_integration_bindings_agent", table_name="integration_bindings")
        op.drop_index("idx_integration_bindings_workspace", table_name="integration_bindings")
        op.drop_table("integration_bindings")
