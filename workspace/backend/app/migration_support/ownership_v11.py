"""Frozen PostgreSQL backfill for revisions 067 and 081; no runtime ORM use."""
import sqlalchemy as sa
from alembic import op


def backfill(bind, grandfather_nodes=False):
    cols = lambda table: {c['name'] for c in sa.inspect(bind).get_columns(table)}
    if 'legacy_machine_access' not in cols('workspaces'):
        op.add_column('workspaces', sa.Column('legacy_machine_access', sa.Boolean(),
            nullable=False, server_default=sa.text('FALSE')))
    if 'legacy_workspace_token' not in cols('nodes'):
        op.add_column('nodes', sa.Column('legacy_workspace_token', sa.Boolean(),
            nullable=False, server_default=sa.text('FALSE')))
    if grandfather_nodes:
        op.execute('UPDATE nodes SET legacy_workspace_token=TRUE')
    op.alter_column('nodes', 'owner_email', nullable=True)
    # Match runtime role precedence; never pick an admin/member as owner.
    bind.execute(sa.text("""CREATE TEMP TABLE v11_workspace_owners ON COMMIT DROP AS
        SELECT w.id, COALESCE(
            CASE WHEN nullif(lower(trim(w.creator_email)),'') IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM workspace_memberships wm JOIN users u ON u.id=wm.user_id
                    WHERE wm.workspace_id=w.id AND lower(u.email)=lower(trim(w.creator_email)) AND wm.role<>'owner')
                THEN lower(trim(w.creator_email)) END,
            (SELECT lower(trim(u.email)) FROM workspace_memberships wm JOIN users u ON u.id=wm.user_id
                WHERE wm.workspace_id=w.id AND wm.role='owner' AND nullif(trim(u.email),'') IS NOT NULL
                ORDER BY wm.created_at,u.email LIMIT 1)
        ) AS email FROM workspaces w"""))
    op.execute("""UPDATE nodes n SET owner_email=o.email FROM v11_workspace_owners o
        WHERE n.workspace_id=o.id AND nullif(trim(n.owner_email),'') IS NULL AND o.email IS NOT NULL""")
    op.execute("""UPDATE workspace_members m SET owner_email=n.owner_email FROM nodes n
        WHERE m.node_id=n.id AND nullif(trim(m.owner_email),'') IS NULL AND n.owner_email IS NOT NULL""")
    op.execute("""UPDATE workspace_members m SET owner_email=o.email FROM v11_workspace_owners o
        WHERE m.workspace_id=o.id AND nullif(trim(m.owner_email),'') IS NULL AND o.email IS NOT NULL""")
    op.execute("""UPDATE workspaces w SET legacy_machine_access=(o.email IS NULL)
        FROM v11_workspace_owners o WHERE w.id=o.id""")
    op.execute('DROP TABLE v11_workspace_owners')
