"""Preserve legacy connections and inherit the actual workspace owner."""
from alembic import op

revision = '081'
down_revision = '080'
branch_labels = None
depends_on = None


def upgrade():
    from app.migration_support.ownership_v11 import backfill
    # Existing 080 connections are already private; do not broaden their tokens.
    backfill(op.get_bind())


def downgrade():
    # A rollback that drops ownership continuity would disconnect live devices.
    raise RuntimeError('Restore the reviewed pre-upgrade snapshot for a full rollback')
