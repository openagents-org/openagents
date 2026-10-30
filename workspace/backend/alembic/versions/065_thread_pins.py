"""Persist personal thread pins."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID
revision = "065"
down_revision = "064"
branch_labels = None
depends_on = None

def upgrade():
    op.create_table("thread_pins",
        sa.Column("channel_id", UUID(as_uuid=False), sa.ForeignKey("channels.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_email", sa.Text(), primary_key=True))

def downgrade():
    op.drop_table("thread_pins")
