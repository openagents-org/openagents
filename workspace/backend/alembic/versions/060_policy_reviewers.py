"""Specific-member approval requirements and decisions."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
revision = "060"
down_revision = "059"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("approvals", sa.Column("policy_requirements", postgresql.JSONB(), nullable=True))

def downgrade():
    op.drop_column("approvals", "policy_requirements")
