"""Remember the conversations a live browser tab is attached to."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
revision = '077'
down_revision = '076'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('browser_tabs', sa.Column('artifact_channels', JSONB(), nullable=False, server_default=sa.text("'[]'")))


def downgrade():
    op.drop_column('browser_tabs', 'artifact_channels')
