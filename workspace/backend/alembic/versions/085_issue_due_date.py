"""Optional calendar due date owned by the issue creator."""
import sqlalchemy as sa
from alembic import op

# Nullable additive column; old application versions may keep serving traffic.
deployment_backward_compatible = True
revision = "085"
down_revision = "084"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("issues", sa.Column("due_date", sa.Date(), nullable=True))


def downgrade():
    op.drop_column("issues", "due_date")
