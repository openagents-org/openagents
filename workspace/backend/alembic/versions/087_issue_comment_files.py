"""Images and videos attached to issue discussion comments."""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

# Additive column with a default; old application versions ignore it.
deployment_backward_compatible = True
revision = "087"
down_revision = "086"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "issue_comments",
        sa.Column("file_ids", JSONB(), nullable=False, server_default=sa.text("'[]'")),
    )


def downgrade():
    op.drop_column("issue_comments", "file_ids")
