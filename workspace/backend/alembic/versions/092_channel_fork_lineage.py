"""Record which thread a forked thread was copied from."""
import sqlalchemy as sa
from alembic import op

# Nullable additive columns; old application versions may keep serving traffic.
deployment_backward_compatible = True
revision = "092"
down_revision = "091"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("channels", sa.Column("forked_from", sa.Text(), nullable=True))
    op.add_column("channels", sa.Column("forked_at_event_id", sa.Text(), nullable=True))


def downgrade():
    op.drop_column("channels", "forked_at_event_id")
    op.drop_column("channels", "forked_from")
