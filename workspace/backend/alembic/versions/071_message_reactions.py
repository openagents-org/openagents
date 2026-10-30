"""Emoji reactions attributed to authenticated humans."""
from alembic import op
import sqlalchemy as sa
revision = "071"
down_revision = "070"
branch_labels = None
depends_on = None

def upgrade():
    op.create_table("message_reactions",
        sa.Column("event_id", sa.Text(), sa.ForeignKey("events.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_email", sa.Text(), primary_key=True), sa.Column("emoji", sa.Text(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")))

def downgrade():
    op.drop_table("message_reactions")
