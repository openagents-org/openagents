"""Save explicitly added issue participants."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
revision = "064"
down_revision = "063"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("issues", sa.Column("participants", JSONB(), nullable=False, server_default=sa.text("'[]'")))

def downgrade():
    op.drop_column("issues", "participants")
