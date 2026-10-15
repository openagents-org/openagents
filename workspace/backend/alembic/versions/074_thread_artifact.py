"""Owner-pinned default artifact per thread."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
revision = "074"
down_revision = "073"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("channels", sa.Column("pinned_artifact", JSONB(), nullable=True))

def downgrade():
    op.drop_column("channels", "pinned_artifact")
