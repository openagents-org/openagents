"""Require a selected reviewer before dispatching new service requests."""
from alembic import op
import sqlalchemy as sa
revision = "063"
down_revision = "062"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("workspace_members", sa.Column("request_approver_email", sa.Text(), nullable=True))

def downgrade():
    op.drop_column("workspace_members", "request_approver_email")
