"""Extra issue boards; issues without a board stay on the default Team issues board."""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

# New table plus a nullable column; old application versions ignore both.
deployment_backward_compatible = True
revision = "093"
down_revision = "092"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "issue_boards",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("workspace_id", UUID(as_uuid=False), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("created_by", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
    )
    op.create_index("idx_issue_boards_workspace", "issue_boards", ["workspace_id"])
    op.add_column("issues", sa.Column("board_id", sa.Text(), sa.ForeignKey("issue_boards.id", ondelete="SET NULL"), nullable=True))
    op.create_index("idx_issues_board", "issues", ["board_id"])


def downgrade():
    op.drop_index("idx_issues_board", table_name="issues")
    op.drop_column("issues", "board_id")
    op.drop_index("idx_issue_boards_workspace", table_name="issue_boards")
    op.drop_table("issue_boards")
