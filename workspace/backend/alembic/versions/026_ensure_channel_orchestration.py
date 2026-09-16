# -*- coding: utf-8 -*-
"""Ensure channel orchestration columns exist (repair for stuck revision 025).

Revision ID: 026
Revises: 025
Create Date: 2026-07-09

Background
----------
Two divergent migrations were both authored as revision "025":

  - ``025_add_channel_orchestration`` (this lineage / origin/develop /
    release) adds ``channels.orchestration_mode`` and
    ``channels.orchestration_instruction``.
  - ``025_add_evaluation_jobs`` (an experimental SWE-bench lineage) creates
    the ``evaluation_jobs`` table.

Because both declared ``revision = "025"``, any database that ran the
evaluation-jobs variant first got stamped ``alembic_version = '025'``. When
the orchestration code later deployed, ``alembic upgrade head`` saw the DB
already at "025" and became a no-op — so the orchestration columns were
never created. Every channel-list / ``/v1/discover`` query then 500s with
``column channels.orchestration_mode does not exist``.

This migration re-applies the orchestration columns idempotently so a
database stuck at "025" (missing the columns) is repaired on the next
deploy, while a database that already has them is left untouched. Uses
Postgres ``ADD COLUMN IF NOT EXISTS`` for true idempotency.
"""

from alembic import op


revision = "026"
down_revision = "025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent: repairs DBs stuck at "025" without the columns, and is a
    # no-op where 025_add_channel_orchestration already applied them.
    op.execute(
        "ALTER TABLE channels "
        "ADD COLUMN IF NOT EXISTS orchestration_mode TEXT NOT NULL DEFAULT 'dynamic'"
    )
    op.execute(
        "ALTER TABLE channels "
        "ADD COLUMN IF NOT EXISTS orchestration_instruction TEXT"
    )


def downgrade() -> None:
    # No-op: leave the columns in place. 025's downgrade owns dropping them,
    # and dropping here would fight that revision on a normal downgrade path.
    pass
