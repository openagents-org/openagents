# -*- coding: utf-8 -*-
"""Migrate legacy per-agent routine channels to per-routine channels.

Existing deployments of this branch may still point routines at the old shared
channel format ``routines:<agent>``. Current code creates one dedicated channel
per routine (``routine:<routine_id>``), so active legacy routines need their own
channel before they fire again.

Revision ID: 016
Revises: 015
Create Date: 2026-05-25
"""

import uuid

from alembic import op
import sqlalchemy as sa


revision = "016"
down_revision = "015"
branch_labels = None
depends_on = None


def _bare_agent(created_by: str) -> str:
    if created_by and created_by.startswith("openagents:"):
        return created_by[len("openagents:"):]
    return created_by or ""


def migrate_existing_routine_channels(conn) -> None:
    """Move active routines from ``routines:<agent>`` to ``routine:<id>``."""
    # Only active routines can still be picked up by the scheduler. Leave
    # cancelled/history rows untouched so this migration does not rewrite
    # historical channel references that will never fire again.
    routines = conn.execute(
        sa.text(
            "SELECT id, workspace_id, created_by, name "
            "FROM routines "
            "WHERE status = 'active' AND channel_name LIKE 'routines:%'"
        )
    ).fetchall()

    for routine_id, workspace_id, created_by, routine_name in routines:
        agent = _bare_agent(created_by)
        if not agent:
            continue

        channel_name = f"routine:{routine_id}"
        channel_row = conn.execute(
            sa.text(
                "SELECT id FROM channels "
                "WHERE workspace_id = :ws AND name = :n"
            ),
            {"ws": workspace_id, "n": channel_name},
        ).first()

        if channel_row is None:
            channel_id = str(uuid.uuid4())
            conn.execute(
                sa.text(
                    "INSERT INTO channels "
                    "(id, workspace_id, name, title, master_agent, created_by, status) "
                    "VALUES (:id, :ws, :n, :t, :ma, 'system:routine', 'active')"
                ),
                {
                    "id": channel_id,
                    "ws": workspace_id,
                    "n": channel_name,
                    "t": f"Routine: {routine_name}" if routine_name else "Routine",
                    "ma": agent,
                },
            )
        else:
            channel_id = channel_row[0]

        existing_member = conn.execute(
            sa.text(
                "SELECT 1 FROM channel_members "
                "WHERE channel_id = :cid AND agent_name = :a"
            ),
            {"cid": channel_id, "a": agent},
        ).first()
        if existing_member is None:
            conn.execute(
                sa.text(
                    "INSERT INTO channel_members (channel_id, agent_name) "
                    "VALUES (:cid, :a)"
                ),
                {"cid": channel_id, "a": agent},
            )

        conn.execute(
            sa.text(
                "UPDATE routines "
                "SET channel_name = :n, created_by = :a "
                "WHERE id = :id"
            ),
            {"n": channel_name, "a": agent, "id": routine_id},
        )


def upgrade() -> None:
    migrate_existing_routine_channels(op.get_bind())


def downgrade() -> None:
    # No-op: we don't know each routine's original shared per-agent channel.
    pass
