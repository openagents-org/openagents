# -*- coding: utf-8 -*-
"""Add workspace skill authoring and public registry MVP tables.

Revision ID: 030
Revises: 029
Create Date: 2026-08-06
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "030"
down_revision = "029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "workspace_skills" not in tables:
        op.create_table(
            "workspace_skills",
            sa.Column("id", sa.Text(), primary_key=True),
            sa.Column("workspace_id", UUID(as_uuid=False), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
            sa.Column("slug", sa.Text(), nullable=False),
            sa.Column("name", sa.Text(), nullable=False),
            sa.Column("summary", sa.Text(), nullable=False, server_default=""),
            sa.Column("category", sa.Text(), nullable=False, server_default="custom"),
            sa.Column("tags", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
            sa.Column("created_by", sa.Text(), nullable=False),
            sa.Column("latest_version_id", sa.Text(), nullable=True),
            sa.Column("registry_skill_id", sa.Text(), nullable=True),
            sa.Column("forked_from_version_id", sa.Text(), nullable=True),
            sa.Column("status", sa.Text(), nullable=False, server_default="active"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
            sa.UniqueConstraint("workspace_id", "slug", name="uq_workspace_skills_slug"),
        )
        op.create_index("idx_workspace_skills_workspace", "workspace_skills", ["workspace_id", "status"])

    if "workspace_skill_versions" not in tables:
        op.create_table(
            "workspace_skill_versions",
            sa.Column("id", sa.Text(), primary_key=True),
            sa.Column("workspace_skill_id", sa.Text(), sa.ForeignKey("workspace_skills.id", ondelete="CASCADE"), nullable=False),
            sa.Column("version_seq", sa.Integer(), nullable=False),
            sa.Column("version", sa.Text(), nullable=False),
            sa.Column("file_id", sa.Text(), sa.ForeignKey("files.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("package_type", sa.Text(), nullable=False),
            sa.Column("content_sha256", sa.Text(), nullable=False),
            sa.Column("frontmatter", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
            sa.Column("changelog", sa.Text(), nullable=False, server_default=""),
            sa.Column("created_by", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
            sa.UniqueConstraint("workspace_skill_id", "version_seq", name="uq_workspace_skill_version_seq"),
            sa.UniqueConstraint("workspace_skill_id", "version", name="uq_workspace_skill_version"),
        )
        op.create_index("idx_workspace_skill_versions_skill", "workspace_skill_versions", ["workspace_skill_id", "version_seq"])

    if "skill_namespaces" not in tables:
        op.create_table(
            "skill_namespaces",
            sa.Column("id", sa.Text(), primary_key=True),
            sa.Column("slug", sa.Text(), nullable=False, unique=True),
            sa.Column("type", sa.Text(), nullable=False),
            sa.Column("owner_user_id", UUID(as_uuid=False), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("display_name", sa.Text(), nullable=False),
            sa.Column("source_url", sa.Text(), nullable=True),
            sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("status", sa.Text(), nullable=False, server_default="active"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        )

    if "skill_artifacts" not in tables:
        op.create_table(
            "skill_artifacts",
            sa.Column("id", sa.Text(), primary_key=True),
            sa.Column("sha256", sa.Text(), nullable=False, unique=True),
            sa.Column("storage_key", sa.Text(), nullable=False),
            sa.Column("filename", sa.Text(), nullable=False),
            sa.Column("package_type", sa.Text(), nullable=False),
            sa.Column("size", sa.Integer(), nullable=False),
            sa.Column("manifest", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
            sa.Column("scan_status", sa.Text(), nullable=False, server_default="passed"),
            sa.Column("retention_state", sa.Text(), nullable=False, server_default="published"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        )

    if "registry_skills" not in tables:
        op.create_table(
            "registry_skills",
            sa.Column("id", sa.Text(), primary_key=True),
            sa.Column("namespace_id", sa.Text(), sa.ForeignKey("skill_namespaces.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("slug", sa.Text(), nullable=False),
            sa.Column("name", sa.Text(), nullable=False),
            sa.Column("summary", sa.Text(), nullable=False, server_default=""),
            sa.Column("category", sa.Text(), nullable=False, server_default="other"),
            sa.Column("tags", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
            sa.Column("visibility", sa.Text(), nullable=False, server_default="public"),
            sa.Column("status", sa.Text(), nullable=False, server_default="active"),
            sa.Column("latest_published_version_id", sa.Text(), nullable=True),
            sa.Column("forked_from_version_id", sa.Text(), nullable=True),
            sa.Column("install_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
            sa.UniqueConstraint("namespace_id", "slug", name="uq_registry_skills_namespace_slug"),
        )
        op.create_index("idx_registry_skills_visibility_status", "registry_skills", ["visibility", "status"])
        op.create_index("idx_registry_skills_category", "registry_skills", ["category"])

    if "registry_skill_versions" not in tables:
        op.create_table(
            "registry_skill_versions",
            sa.Column("id", sa.Text(), primary_key=True),
            sa.Column("skill_id", sa.Text(), sa.ForeignKey("registry_skills.id", ondelete="CASCADE"), nullable=False),
            sa.Column("version", sa.Text(), nullable=False),
            sa.Column("version_seq", sa.Integer(), nullable=False),
            sa.Column("status", sa.Text(), nullable=False, server_default="published"),
            sa.Column("artifact_id", sa.Text(), sa.ForeignKey("skill_artifacts.id", ondelete="RESTRICT"), nullable=True),
            sa.Column("source_mode", sa.Text(), nullable=False, server_default="mirrored"),
            sa.Column("source_repo", sa.Text(), nullable=True),
            sa.Column("source_path", sa.Text(), nullable=True),
            sa.Column("source_commit", sa.Text(), nullable=True),
            sa.Column("content_sha256", sa.Text(), nullable=True),
            sa.Column("package_type", sa.Text(), nullable=False, server_default="md"),
            sa.Column("frontmatter", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
            sa.Column("changelog", sa.Text(), nullable=False, server_default=""),
            sa.Column("license_spdx", sa.Text(), nullable=False),
            sa.Column("attribution_snapshot", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
            sa.Column("capabilities", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
            sa.Column("scan_result", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
            sa.Column("published_by_user_id", UUID(as_uuid=False), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
            sa.Column("published_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
            sa.UniqueConstraint("skill_id", "version", name="uq_registry_skill_version"),
            sa.UniqueConstraint("skill_id", "version_seq", name="uq_registry_skill_version_seq"),
        )
        op.create_index("idx_registry_skill_versions_skill", "registry_skill_versions", ["skill_id", "version_seq"])

    if "agent_skill_installations" not in tables:
        op.create_table(
            "agent_skill_installations",
            sa.Column("workspace_id", UUID(as_uuid=False), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
            sa.Column("agent_name", sa.Text(), nullable=False),
            sa.Column("skill_id", sa.Text(), nullable=False),
            sa.Column("version_id", sa.Text(), nullable=True),
            sa.Column("state", sa.Text(), nullable=False),
            sa.Column("install_path", sa.Text(), nullable=True),
            sa.Column("error", sa.Text(), nullable=True),
            sa.Column("installed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
            sa.PrimaryKeyConstraint("workspace_id", "agent_name", "skill_id"),
        )
        op.create_index("idx_agent_skill_installations_skill", "agent_skill_installations", ["skill_id", "state"])

    # Existing JSONB custom skills are converted lazily on first list/install;
    # the app must read the original map until each record has a content hash.


def downgrade() -> None:
    for index_name, table_name in (
        ("idx_agent_skill_installations_skill", "agent_skill_installations"),
        ("idx_registry_skill_versions_skill", "registry_skill_versions"),
        ("idx_registry_skills_category", "registry_skills"),
        ("idx_registry_skills_visibility_status", "registry_skills"),
        ("idx_workspace_skill_versions_skill", "workspace_skill_versions"),
        ("idx_workspace_skills_workspace", "workspace_skills"),
    ):
        try:
            op.drop_index(index_name, table_name=table_name)
        except Exception:
            pass
    for table in (
        "agent_skill_installations",
        "registry_skill_versions",
        "registry_skills",
        "skill_artifacts",
        "skill_namespaces",
        "workspace_skill_versions",
        "workspace_skills",
    ):
        op.drop_table(table)
