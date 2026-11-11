"""Index workspaces by lower(creator_email).

GET /v1/account/workspaces runs on every sign-in and looks up the caller's
legacy-owned workspaces with lower(creator_email) = :email, which had no index
and read the whole workspaces table each time.
"""
from alembic import op
import sqlalchemy as sa

deployment_backward_compatible = True
revision = '095'
down_revision = '094'
branch_labels = None
depends_on = None


def upgrade():
    with op.get_context().autocommit_block():
        # Concurrent builds wait for existing writers and old snapshots too.
        # Allow API transactions to finish, bounded by this wait and the
        # deployment coordinator's migration timeout.
        op.execute("SET lock_timeout = '300s'")
        try:
            op.execute("""CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workspaces_creator_email_lower
                ON workspaces (lower(creator_email))""")
            valid = op.get_bind().execute(sa.text("""SELECT indisvalid FROM pg_index
                WHERE indexrelid = to_regclass('idx_workspaces_creator_email_lower')""")).scalar_one()
            if not valid:
                raise RuntimeError('Invalid idx_workspaces_creator_email_lower: drop concurrently and retry')
        finally:
            op.execute('RESET lock_timeout')


def downgrade():
    with op.get_context().autocommit_block():
        op.execute('DROP INDEX CONCURRENTLY IF EXISTS idx_workspaces_creator_email_lower')
