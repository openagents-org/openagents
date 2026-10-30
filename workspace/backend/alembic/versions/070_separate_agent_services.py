"""Separate service audiences from direct agent access."""
import uuid
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID
revision = "070"
down_revision = "069"
branch_labels = None
depends_on = None

def upgrade():
    op.create_table("agent_services",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("workspace_id", UUID(as_uuid=False), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("agent_name", sa.Text(), nullable=False), sa.Column("owner_email", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False), sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("instructions", sa.Text(), nullable=False, server_default=""),
        sa.Column("example_requests", JSONB(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("required_inputs", sa.Text()), sa.Column("allowed_knowledge", JSONB(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("request_approver_email", sa.Text()), sa.Column("cost_owner", sa.Text(), nullable=False, server_default="owner"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")))
    op.create_index("idx_agent_services_workspace", "agent_services", ["workspace_id"])
    op.add_column("channels", sa.Column("service_id", sa.Text(), sa.ForeignKey("agent_services.id", ondelete="SET NULL"), nullable=True))
    conn = op.get_bind()
    # This preview's approved conversion only; other workspaces keep their access.
    rows = conn.execute(sa.text("""SELECT m.* FROM workspace_members m JOIN workspaces w ON w.id=m.workspace_id
        WHERE w.slug='cef1c57a' AND m.status <> 'removed' AND m.owner_email IS NOT NULL""")).mappings().all()
    service_table = sa.table("agent_services", *[sa.column(n, t) for n,t in [
        ("id",sa.Text()),("workspace_id",UUID(as_uuid=False)),("agent_name",sa.Text()),("owner_email",sa.Text()),("name",sa.Text()),
        ("description",sa.Text()),("instructions",sa.Text()),("example_requests",JSONB()),("required_inputs",sa.Text()),
        ("allowed_knowledge",JSONB()),("request_approver_email",sa.Text()),("cost_owner",sa.Text())]])
    for row in rows:
        sid = str(uuid.uuid4())
        conn.execute(service_table.insert().values(id=sid, workspace_id=row['workspace_id'], agent_name=row['agent_name'],
            owner_email=row['owner_email'], name=row['display_name'] or row['agent_name'], description=row['purpose'] or row['description'] or '',
            instructions=row['shared_instructions'] or '', example_requests=row['example_requests'] or [], required_inputs=row['required_inputs'],
            allowed_knowledge=row['allowed_knowledge'] or [], request_approver_email=row['request_approver_email'], cost_owner=row['cost_owner'] or 'owner'))
        conn.execute(sa.text("UPDATE resource_grants SET resource_kind='service', resource_id=:sid WHERE workspace_id=:wid AND resource_kind='agent' AND resource_id=:agent AND revoked_at IS NULL"),
                     dict(sid=sid,wid=row['workspace_id'],agent=row['agent_name']))
        conn.execute(sa.text("UPDATE channel_agent_sharing SET enabled=FALSE WHERE owner_email=:owner AND channel_id IN (SELECT id FROM channels WHERE workspace_id=:wid)"), dict(owner=row['owner_email'],wid=row['workspace_id']))
        conn.execute(sa.text("UPDATE workspace_members SET visibility='personal', request_approver_email=NULL WHERE workspace_id=:wid AND agent_name=:agent"), dict(wid=row['workspace_id'],agent=row['agent_name']))

def downgrade():
    # Do not silently expand agent access again during rollback.
    op.drop_column("channels", "service_id")
    op.drop_table("agent_services")
