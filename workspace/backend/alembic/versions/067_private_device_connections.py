"""Private device connections with explicit owners and private agent defaults.

Existing connections inherit the recorded workspace owner when pairing history
is absent. Ownerless legacy workspaces retain their existing machine access.
"""
from alembic import op, context
import json
import sqlalchemy as sa
revision = '067'
down_revision = '066'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('nodes', sa.Column('owner_email', sa.Text(), nullable=True))
    op.create_index('ix_nodes_owner_email', 'nodes', ['owner_email'])
    op.execute("""UPDATE nodes n SET owner_email = p.email FROM (
        SELECT DISTINCT ON (node_id) node_id, lower(trim(created_by)) AS email
        FROM node_pairing_codes
        WHERE redeemed_at IS NOT NULL AND nullif(trim(created_by), '') IS NOT NULL
        ORDER BY node_id, redeemed_at DESC
    ) p WHERE n.id = p.node_id""")
    # An operator supplies only user-confirmed legacy assignments:
    # alembic -x device_owners='{"connection-id":"owner@example.com"}' upgrade head
    assignments = json.loads(context.get_x_argument(as_dictionary=True).get('device_owners', '{}'))
    bind = op.get_bind()
    for connection_id, email in assignments.items():
        email = email.strip().lower()
        eligible = bind.execute(sa.text("""SELECT 1 FROM nodes n
            JOIN workspace_memberships wm ON wm.workspace_id=n.workspace_id
            JOIN users u ON u.id=wm.user_id
            WHERE n.id=:id AND lower(u.email)=:email AND wm.role IN ('owner','admin','member')"""),
            {'id': connection_id, 'email': email}).first()
        if not eligible:
            raise RuntimeError('Device owner must be a current workspace member')
        bind.execute(sa.text('UPDATE nodes SET owner_email=:email WHERE id=:id'), {'id': connection_id, 'email': email})
    from app.migration_support.ownership_v11 import backfill
    backfill(bind, grandfather_nodes=True)
    op.drop_constraint('uq_node_workspace_key', 'nodes', type_='unique')
    op.create_unique_constraint('uq_node_workspace_key_owner', 'nodes', ['workspace_id', 'node_key', 'owner_email'])
    op.execute("""UPDATE workspace_members m SET owner_email = n.owner_email
                  FROM nodes n WHERE m.node_id = n.id AND n.owner_email IS NOT NULL
                  AND nullif(trim(m.owner_email), '') IS NULL""")
    op.alter_column('workspace_members', 'visibility', server_default='personal')
    # Only automatic grants are retired. Explicit owner-created shares survive.
    op.execute("""UPDATE resource_grants SET revoked_at = now()
        WHERE resource_kind = 'agent' AND granted_by = 'system' AND note = 'default'
        AND revoked_at IS NULL""")
    op.execute("UPDATE workspace_members SET visibility = 'personal'")


def downgrade():
    # Two owners can now connect the same physical device; merging loses data.
    op.execute("""DO $$ BEGIN IF EXISTS (
        SELECT 1 FROM nodes GROUP BY workspace_id, node_key HAVING count(*) > 1
    ) THEN RAISE EXCEPTION 'Disconnect duplicate device connections before downgrade'; END IF; END $$""")
    op.drop_constraint('uq_node_workspace_key_owner', 'nodes', type_='unique')
    op.create_unique_constraint('uq_node_workspace_key', 'nodes', ['workspace_id', 'node_key'])
    op.drop_index('ix_nodes_owner_email', table_name='nodes')
    op.drop_column('nodes', 'owner_email')
    op.alter_column('workspace_members', 'visibility', server_default='team')
