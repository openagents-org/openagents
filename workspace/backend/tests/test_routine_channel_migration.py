# -*- coding: utf-8 -*-
"""
Tests for migrating legacy per-agent routine channels to per-routine channels.
"""

import importlib.util
from pathlib import Path

import sqlalchemy as sa


def _load_migration():
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "016_migrate_legacy_routine_channels.py"
    )
    spec = importlib.util.spec_from_file_location("routine_channel_migration_016", migration_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_migrates_active_legacy_routines_to_per_routine_channels():
    migration = _load_migration()
    engine = sa.create_engine("sqlite://")

    metadata = sa.MetaData()
    sa.Table(
        "routines",
        metadata,
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("workspace_id", sa.Text(), nullable=False),
        sa.Column("channel_name", sa.Text(), nullable=False),
        sa.Column("created_by", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False),
    )
    sa.Table(
        "channels",
        metadata,
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("workspace_id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=True),
        sa.Column("master_agent", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=True),
    )
    sa.Table(
        "channel_members",
        metadata,
        sa.Column("channel_id", sa.Text(), nullable=False),
        sa.Column("agent_name", sa.Text(), nullable=False),
    )
    metadata.create_all(engine)

    with engine.begin() as conn:
        conn.execute(sa.text(
            "INSERT INTO channels "
            "(id, workspace_id, name, title, master_agent, created_by, status) "
            "VALUES ('legacy-channel', 'ws-1', 'routines:agent-alpha', 'agent-alpha', "
            "'agent-alpha', 'system:routine', 'active')"
        ))
        conn.execute(sa.text(
            "INSERT INTO routines "
            "(id, workspace_id, channel_name, created_by, name, status) "
            "VALUES "
            "('routine-1', 'ws-1', 'routines:agent-alpha', "
            "'openagents:agent-alpha', 'Daily A', 'active'), "
            "('routine-2', 'ws-1', 'routines:agent-alpha', "
            "'agent-alpha', 'Daily B', 'active'), "
            "('routine-3', 'ws-1', 'routine:routine-3', "
            "'agent-alpha', 'Already migrated', 'active'), "
            "('routine-4', 'ws-1', 'routines:agent-alpha', "
            "'agent-alpha', 'Cancelled', 'cancelled')"
        ))

        migration.migrate_existing_routine_channels(conn)

        routines = conn.execute(sa.text(
            "SELECT id, channel_name, created_by FROM routines ORDER BY id"
        )).fetchall()
        channels = conn.execute(sa.text(
            "SELECT name, title, master_agent, created_by, status FROM channels ORDER BY name"
        )).fetchall()
        members = conn.execute(sa.text(
            "SELECT c.name, cm.agent_name "
            "FROM channel_members cm JOIN channels c ON c.id = cm.channel_id "
            "ORDER BY c.name"
        )).fetchall()

    assert routines == [
        ("routine-1", "routine:routine-1", "agent-alpha"),
        ("routine-2", "routine:routine-2", "agent-alpha"),
        ("routine-3", "routine:routine-3", "agent-alpha"),
        ("routine-4", "routines:agent-alpha", "agent-alpha"),
    ]
    assert (
        "routine:routine-1", "Routine: Daily A", "agent-alpha", "system:routine", "active",
    ) in channels
    assert (
        "routine:routine-2", "Routine: Daily B", "agent-alpha", "system:routine", "active",
    ) in channels
    assert ("routine:routine-1", "agent-alpha") in members
    assert ("routine:routine-2", "agent-alpha") in members
