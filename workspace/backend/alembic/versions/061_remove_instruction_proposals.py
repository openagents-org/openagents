"""Remove the retired instruction-proposal feature's preview data."""
from alembic import op

revision = "061"
down_revision = "060"
branch_labels = None
depends_on = None


def upgrade():
    # Remove only feature-owned records; ordinary conversation text and existing
    # shared instructions are not rewritten. Events must go before approvals
    # because their request/resolution ids identify the associated messages.
    op.execute("""
        DELETE FROM notifications
        WHERE kind = 'proposal'
           OR action_ref IN (SELECT id FROM approvals WHERE kind = 'proposal')
    """)
    op.execute("""
        DELETE FROM events
        WHERE payload->'approval'->>'kind' = 'proposal'
           OR metadata->>'approval_id' IN (SELECT id FROM approvals WHERE kind = 'proposal')
           OR id IN (SELECT request_event_id FROM approvals WHERE kind = 'proposal')
           OR id IN (SELECT resolution_event_id FROM approvals WHERE kind = 'proposal')
    """)
    op.execute("DELETE FROM approvals WHERE kind = 'proposal'")


def downgrade():
    # Removed preview records cannot be reconstructed.
    pass
