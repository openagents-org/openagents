"""Retire automatic Everyone agent shares backfilled by migration 055.

067 removed insert-hook defaults but missed the earlier migration's marker.
Owner-created shares, including explicitly sharing with Everyone, survive.
"""
from alembic import op

revision = '068'
down_revision = '067'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""UPDATE resource_grants SET revoked_at = now(),
        revoked_by = 'system:migration-068'
        WHERE resource_kind = 'agent' AND grantee_kind = 'group'
        AND granted_by = 'system:migration-055' AND revoked_at IS NULL
        AND grantee_id IN (SELECT id FROM security_groups WHERE kind = 'everyone')
    """)


def downgrade():
    op.execute("""UPDATE resource_grants SET revoked_at = NULL, revoked_by = NULL
        WHERE revoked_by = 'system:migration-068'
    """)
