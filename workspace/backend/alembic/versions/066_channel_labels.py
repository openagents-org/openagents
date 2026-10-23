"""Label ongoing conversations as channels without changing their behavior."""
from alembic import op
import sqlalchemy as sa
revision = "066"
down_revision = "065"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("channels", sa.Column("is_channel", sa.Boolean(), nullable=False, server_default=sa.false()))

def downgrade():
    op.drop_column("channels", "is_channel")
