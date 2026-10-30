# -*- coding: utf-8 -*-
"""Workspace ownership & permission model — v1.1 slice.

See workspace/docs/permission-model-v1.md §2 (the build contract).

  * security_groups / security_group_members — named sets of principals.
    'everyone' and 'guest' are builtins (derived membership); 'custom' groups
    carry explicit member rows.
  * resource_grants — grantee (human | agent | group) may exercise rights on
    a resource (channel | agent | file | knowledge | browser_context).
    Replaces agent_grants, which stays for one release behind shim endpoints.
  * channels — owner_email (backfill: director_email), participants_can_invite;
    visibility 'workspace' → 'public'; DM threads ('dm:…') → private with both
    parties as participants.
  * files — owner (backfill: uploaded_by), visibility (NULL = inherit from the
    channel; unattached files → 'public' for compat).
  * knowledge_entries — owner (backfill: created_by), visibility 'public'.
  * data: agent_grants (active) → resource_grants(agent → human); every agent
    with visibility 'team' / NULL → resource_grants(agent → group everyone,
    rights ["act"]). Builtin groups are created for every workspace that has
    agents so those grants have a target.

Revision ID: 055
Revises: 054
Create Date: 2026-10-03
"""

import uuid

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "055"
down_revision = "054"
branch_labels = None
depends_on = None


def _cols(bind, table):
    return {c["name"] for c in sa.inspect(bind).get_columns(table)}


def _add(bind, table, column):
    if column.name not in _cols(bind, table):
        op.add_column(table, column)


# ---------------------------------------------------------------------------
# upgrade
# ---------------------------------------------------------------------------

def upgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    is_pg = bind.dialect.name == "postgresql"

    # --- security_groups -----------------------------------------------------
    if "security_groups" not in tables:
        op.create_table(
            "security_groups",
            sa.Column("id", sa.Text(), primary_key=True),
            sa.Column("workspace_id", postgresql.UUID(as_uuid=False),
                      sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
            sa.Column("name", sa.Text(), nullable=False),
            sa.Column("slug", sa.Text(), nullable=False),
            sa.Column("kind", sa.Text(), nullable=False, server_default=sa.text("'custom'")),
            sa.Column("created_by", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
            sa.UniqueConstraint("workspace_id", "slug", name="uq_security_groups_workspace_slug"),
        )
        op.create_index("idx_security_groups_workspace", "security_groups", ["workspace_id"])

    # --- security_group_members ---------------------------------------------
    if "security_group_members" not in tables:
        op.create_table(
            "security_group_members",
            sa.Column("group_id", sa.Text(),
                      sa.ForeignKey("security_groups.id", ondelete="CASCADE"), nullable=False),
            sa.Column("principal_kind", sa.Text(), nullable=False),
            sa.Column("principal_id", sa.Text(), nullable=False),
            sa.Column("added_by", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
            sa.PrimaryKeyConstraint("group_id", "principal_kind", "principal_id"),
        )
        op.create_index("idx_security_group_members_principal", "security_group_members",
                        ["principal_kind", "principal_id"])

    # --- resource_grants -----------------------------------------------------
    if "resource_grants" not in tables:
        op.create_table(
            "resource_grants",
            sa.Column("id", sa.Text(), primary_key=True),
            sa.Column("workspace_id", postgresql.UUID(as_uuid=False),
                      sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
            sa.Column("resource_kind", sa.Text(), nullable=False),
            sa.Column("resource_id", sa.Text(), nullable=False),
            sa.Column("grantee_kind", sa.Text(), nullable=False),
            sa.Column("grantee_id", sa.Text(), nullable=False),
            sa.Column("rights", postgresql.JSONB(astext_type=sa.Text()), nullable=False,
                      server_default=sa.text("'[\"read\", \"act\"]'::jsonb") if is_pg else sa.text("'[\"read\", \"act\"]'")),
            sa.Column("scope", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("budget", sa.Numeric(), nullable=True),
            sa.Column("granted_by", sa.Text(), nullable=True),
            sa.Column("note", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("revoked_by", sa.Text(), nullable=True),
        )
        op.create_index("idx_resource_grants_resource", "resource_grants",
                        ["workspace_id", "resource_kind", "resource_id"])
        op.create_index("idx_resource_grants_grantee", "resource_grants",
                        ["workspace_id", "grantee_kind", "grantee_id"])

    # --- channels ------------------------------------------------------------
    _add(bind, "channels", sa.Column("owner_email", sa.Text(), nullable=True))
    _add(bind, "channels", sa.Column("participants_can_invite", sa.Boolean(), nullable=False,
                                     server_default=sa.text("FALSE")))
    op.execute("UPDATE channels SET visibility = 'public' WHERE visibility = 'workspace' OR visibility IS NULL")
    op.execute("UPDATE channels SET owner_email = lower(director_email) "
               "WHERE owner_email IS NULL AND director_email IS NOT NULL AND director_email <> ''")
    if is_pg:
        op.alter_column("channels", "visibility", server_default=sa.text("'public'"))

    # DM threads → private, both parties become participants.
    _backfill_dm_channels(bind)

    # --- files ---------------------------------------------------------------
    _add(bind, "files", sa.Column("owner", sa.Text(), nullable=True))
    _add(bind, "files", sa.Column("visibility", sa.Text(), nullable=True))
    op.execute("UPDATE files SET owner = uploaded_by WHERE owner IS NULL")
    op.execute("UPDATE files SET visibility = 'public' "
               "WHERE visibility IS NULL AND (channel_name IS NULL OR channel_name = '')")

    # --- knowledge_entries ---------------------------------------------------
    _add(bind, "knowledge_entries", sa.Column("owner", sa.Text(), nullable=True))
    _add(bind, "knowledge_entries", sa.Column("visibility", sa.Text(), nullable=True))
    op.execute("UPDATE knowledge_entries SET owner = created_by WHERE owner IS NULL")
    op.execute("UPDATE knowledge_entries SET visibility = 'public' WHERE visibility IS NULL")

    # --- agent grants → resource_grants; team agents → everyone --------------
    _backfill_agent_grants(bind)


def _backfill_dm_channels(bind) -> None:
    """`dm:<party>,<party>` threads: visibility private, each party a
    participant. A component containing '@' (optionally 'human:'-prefixed)
    is a person; anything else is an agent (optionally 'openagents:'-
    prefixed). A DM where no human can be identified — neither from the name
    nor from an existing participant row — is left public so nobody is
    locked out of it."""
    rows = bind.execute(sa.text(
        "SELECT id, name, owner_email FROM channels WHERE name LIKE 'dm:%'"
    )).fetchall()
    for channel_id, name, owner_email in rows:
        humans, agents = [], []
        for part in name[len("dm:"):].split(","):
            part = part.strip()
            if not part:
                continue
            if "@" in part:
                email = part.split(":", 1)[1] if part.lower().startswith("human:") else part
                humans.append(email.strip().lower())
            elif part.lower().startswith("human:"):
                continue  # anonymous person ("human:user"): nothing to backfill
            else:
                agent = part.split(":", 1)[1] if part.lower().startswith("openagents:") else part
                if agent:
                    agents.append(agent)
        for email in humans:
            exists = bind.execute(sa.text(
                "SELECT 1 FROM channel_human_members WHERE channel_id = :c AND user_email = :e"
            ), {"c": channel_id, "e": email}).first()
            if exists is None:
                bind.execute(sa.text(
                    "INSERT INTO channel_human_members (channel_id, user_email) VALUES (:c, :e)"
                ), {"c": channel_id, "e": email})
        for agent in agents:
            exists = bind.execute(sa.text(
                "SELECT 1 FROM channel_members WHERE channel_id = :c AND agent_name = :a"
            ), {"c": channel_id, "a": agent}).first()
            if exists is None:
                bind.execute(sa.text(
                    "INSERT INTO channel_members (channel_id, agent_name) VALUES (:c, :a)"
                ), {"c": channel_id, "a": agent})
        any_human = bind.execute(sa.text(
            "SELECT user_email FROM channel_human_members WHERE channel_id = :c ORDER BY joined_at LIMIT 1"
        ), {"c": channel_id}).first()
        if any_human is None:
            continue
        bind.execute(sa.text(
            "UPDATE channels SET visibility = 'private', owner_email = COALESCE(owner_email, :o) WHERE id = :c"
        ), {"c": channel_id, "o": (humans[0] if humans else any_human[0])})


def _backfill_agent_grants(bind) -> None:
    rights_read_act = '["read", "act"]'
    rights_act = '["act"]'

    # Builtin groups for every workspace that has agents.
    ws_ids = [r[0] for r in bind.execute(sa.text(
        "SELECT DISTINCT workspace_id FROM workspace_members"
    )).fetchall()]
    everyone_by_ws = {}
    for ws_id in ws_ids:
        for kind, name in (("everyone", "Everyone"), ("guest", "Guests")):
            row = bind.execute(sa.text(
                "SELECT id FROM security_groups WHERE workspace_id = :w AND slug = :s"
            ), {"w": ws_id, "s": kind}).first()
            if row is None:
                gid = str(uuid.uuid4())
                bind.execute(sa.text(
                    "INSERT INTO security_groups (id, workspace_id, name, slug, kind, created_by) "
                    "VALUES (:i, :w, :n, :s, :k, 'system:migration-055')"
                ), {"i": gid, "w": ws_id, "n": name, "s": kind, "k": kind})
            else:
                gid = row[0]
            if kind == "everyone":
                everyone_by_ws[ws_id] = gid

    # Active agent_grants → resource_grants(agent → human).
    grants = bind.execute(sa.text(
        "SELECT id, workspace_id, agent_name, grantee_email, granted_by, note, created_at "
        "FROM agent_grants WHERE revoked_at IS NULL"
    )).fetchall()
    for gid, ws_id, agent_name, grantee_email, granted_by, note, created_at in grants:
        exists = bind.execute(sa.text(
            "SELECT 1 FROM resource_grants WHERE workspace_id = :w AND resource_kind = 'agent' "
            "AND resource_id = :a AND grantee_kind = 'human' AND grantee_id = :g AND revoked_at IS NULL"
        ), {"w": ws_id, "a": agent_name, "g": grantee_email}).first()
        if exists is not None:
            continue
        bind.execute(sa.text(
            "INSERT INTO resource_grants (id, workspace_id, resource_kind, resource_id, grantee_kind, grantee_id, "
            "rights, granted_by, note, created_at) VALUES (:i, :w, 'agent', :a, 'human', :g, :r, :b, :n, :c)"
        ), {"i": f"ag-{gid}", "w": ws_id, "a": agent_name, "g": grantee_email, "r": rights_read_act,
            "b": granted_by, "n": note, "c": created_at})

    # Team (or legacy NULL) agents → everyone may act.
    members = bind.execute(sa.text(
        "SELECT workspace_id, agent_name FROM workspace_members "
        "WHERE visibility IS NULL OR visibility <> 'personal'"
    )).fetchall()
    for ws_id, agent_name in members:
        everyone = everyone_by_ws.get(ws_id)
        if not everyone:
            continue
        exists = bind.execute(sa.text(
            "SELECT 1 FROM resource_grants WHERE workspace_id = :w AND resource_kind = 'agent' "
            "AND resource_id = :a AND grantee_kind = 'group' AND grantee_id = :g AND revoked_at IS NULL"
        ), {"w": ws_id, "a": agent_name, "g": everyone}).first()
        if exists is not None:
            continue
        bind.execute(sa.text(
            "INSERT INTO resource_grants (id, workspace_id, resource_kind, resource_id, grantee_kind, grantee_id, "
            "rights, granted_by) VALUES (:i, :w, 'agent', :a, 'group', :g, :r, 'system:migration-055')"
        ), {"i": str(uuid.uuid4()), "w": ws_id, "a": agent_name, "g": everyone, "r": rights_act})


# ---------------------------------------------------------------------------
# downgrade
# ---------------------------------------------------------------------------

def downgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"

    for c in ("owner", "visibility"):
        op.drop_column("knowledge_entries", c)
    for c in ("owner", "visibility"):
        op.drop_column("files", c)

    # Threads: 'public' → 'workspace'; DM threads were private-by-backfill
    # only, so they open up again. Participant rows are harmless and stay.
    op.execute("UPDATE channels SET visibility = 'workspace' WHERE visibility = 'public'")
    op.execute("UPDATE channels SET visibility = 'workspace' WHERE name LIKE 'dm:%'")
    if is_pg:
        op.alter_column("channels", "visibility", server_default=sa.text("'workspace'"))
    op.drop_column("channels", "participants_can_invite")
    op.drop_column("channels", "owner_email")

    op.drop_index("idx_resource_grants_grantee", table_name="resource_grants")
    op.drop_index("idx_resource_grants_resource", table_name="resource_grants")
    op.drop_table("resource_grants")
    op.drop_index("idx_security_group_members_principal", table_name="security_group_members")
    op.drop_table("security_group_members")
    op.drop_index("idx_security_groups_workspace", table_name="security_groups")
    op.drop_table("security_groups")
