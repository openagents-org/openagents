"""Add shared issues, discussion, and links to execution threads and tasks.

Revision ID: 053
Revises: 052
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "053"
down_revision = "052"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "issues",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column(
            "workspace_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.Text(), nullable=False, server_default="open"),
        sa.Column("created_by", sa.Text(), nullable=False),
        sa.Column("created_by_name", sa.Text()),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")
        ),
    )
    op.create_index("idx_issues_workspace_status", "issues", ["workspace_id", "status"])
    op.create_table(
        "issue_comments",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column(
            "issue_id",
            sa.Text(),
            sa.ForeignKey("issues.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("author", sa.Text(), nullable=False),
        sa.Column("author_name", sa.Text()),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False, server_default="comment"),
        sa.Column(
            "source_event_id",
            sa.Text(),
            sa.ForeignKey("events.id", ondelete="SET NULL"),
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")
        ),
        sa.UniqueConstraint(
            "issue_id", "source_event_id", name="uq_issue_comment_event"
        ),
    )
    op.create_index(
        "idx_issue_comments_issue_created", "issue_comments", ["issue_id", "created_at"]
    )
    op.create_table(
        "issue_threads",
        sa.Column(
            "issue_id",
            sa.Text(),
            sa.ForeignKey("issues.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "channel_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("channels.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")
        ),
    )
    op.add_column(
        "kanban_tasks",
        sa.Column(
            "issue_id",
            sa.Text(),
            sa.ForeignKey(
                "issues.id", name="fk_kanban_tasks_issue", ondelete="SET NULL"
            ),
        ),
    )
    op.create_index("ix_kanban_tasks_issue_id", "kanban_tasks", ["issue_id"])


def downgrade():
    op.drop_index("ix_kanban_tasks_issue_id", table_name="kanban_tasks")
    op.drop_constraint("fk_kanban_tasks_issue", "kanban_tasks", type_="foreignkey")
    op.drop_column("kanban_tasks", "issue_id")
    op.drop_table("issue_threads")
    op.drop_table("issue_comments")
    op.drop_table("issues")
