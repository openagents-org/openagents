"""Issue responsibility and labels; paused uses the existing text status."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
revision = "069"
down_revision = "068"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("issues", sa.Column("assignee", sa.Text(), nullable=True))
    op.add_column("issues", sa.Column("assignee_name", sa.Text(), nullable=True))
    op.add_column("issues", sa.Column("labels", JSONB(), nullable=False, server_default=sa.text("'[]'")))

def downgrade():
    op.drop_column("issues", "labels")
    op.drop_column("issues", "assignee_name")
    op.drop_column("issues", "assignee")
