"""Private, expiring drafts for Jam setup."""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = '103'
down_revision = '102'
branch_labels = None
depends_on = None
deployment_backward_compatible = True


def upgrade():
    op.create_table(
        'jam_setup_drafts',
        sa.Column('key_hash', sa.Text(), primary_key=True),
        sa.Column('draft', JSONB(), nullable=False),
        sa.Column('published_workspace', sa.Text(), nullable=True),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False, index=True),
    )


def downgrade():
    op.drop_table('jam_setup_drafts')
