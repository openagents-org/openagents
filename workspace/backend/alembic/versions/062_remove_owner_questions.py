"""Remove the retired owner-question feature's preview data."""
from alembic import op

revision = "062"
down_revision = "061"
branch_labels = None
depends_on = None


def upgrade():
    # Remove only feature-owned records; ordinary conversation text and existing
    # shared instructions are not rewritten. Events must go before approvals
    # because their request/resolution ids identify the associated messages.
    op.execute("""
        DELETE FROM notifications
        WHERE kind = 'help'
           OR action_ref IN (SELECT id FROM approvals WHERE kind = 'help')
    """)
    op.execute("""
        DELETE FROM events
        WHERE payload->'approval'->>'kind' = 'help'
           OR metadata->>'approval_id' IN (SELECT id FROM approvals WHERE kind = 'help')
           OR id IN (SELECT request_event_id FROM approvals WHERE kind = 'help')
           OR id IN (SELECT resolution_event_id FROM approvals WHERE kind = 'help')
    """)
    op.execute("DELETE FROM approvals WHERE kind = 'help'")


def downgrade():
    # Removed preview records cannot be reconstructed.
    pass
