# -*- coding: utf-8 -*-
"""Track BF credential reference + session release state on browser tabs.

Revision ID: 026
Revises: 025
Create Date: 2026-07-14

Fixes the shared-browser session leak. Browser Fabric sessions created
with a per-workspace API key could never be reliably closed after a server
restart because the tab→key mapping lived only in process memory, and
closed-in-DB tabs whose remote close failed were silently forgotten.

New columns on `browser_tabs`:

  - `bf_key_source` / `bf_key_fingerprint` — a *reference* to the key the
    session was created with ('workspace' settings key or 'global' env key)
    plus its SHA-256 fingerprint. The key itself is never stored here.
  - `session_closed` (bool) — remote BF session confirmed released.
  - `close_status` — none | open | closing | closed | close_failed |
    retry_exhausted. Drives the maintenance sweeper's retry state machine.
  - `close_attempts`, `last_close_attempt_at`, `last_close_error` — retry
    bookkeeping (errors are redacted before storage).
  - `last_error` — last init/navigation error surfaced to the caller.

Backfill policy (deliberately NOT "assume old sessions are gone"):

  - rows with no remote session_id: nothing to release →
    session_closed=TRUE, close_status='none'.
  - active rows with a session_id: live session → close_status='open'.
  - non-active rows WITH a session_id: the remote session may still exist
    and be eating the per-key ephemeral quota → session_closed=FALSE,
    close_status='close_failed' so the maintenance sweeper retries the
    close. Load is bounded by the sweeper's per-pass action cap and
    retry window, not by faking release here.

Credential backfill resolves each workspace's key reference at migration
time (settings key → 'workspace', else global env key → 'global') and
stores only source + fingerprint.
"""

import hashlib
import json
import os

from alembic import op
import sqlalchemy as sa


revision = "026"
down_revision = "025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()

    # Idempotent add: only create columns that don't already exist. Guards
    # against a re-run on a partially-applied DB (this codebase has a history
    # of stuck/partial migrations) so `alembic upgrade head` can't hard-fail
    # with "column already exists" in production. Dialect-agnostic (works on
    # Postgres and sqlite; avoids Postgres-only ADD COLUMN IF NOT EXISTS).
    existing_cols = {c["name"] for c in sa.inspect(bind).get_columns("browser_tabs")}

    def _add(name, column):
        if name not in existing_cols:
            op.add_column("browser_tabs", column)

    _add("bf_key_source", sa.Column("bf_key_source", sa.Text(), nullable=True))
    _add("bf_key_fingerprint", sa.Column("bf_key_fingerprint", sa.Text(), nullable=True))
    _add("session_closed", sa.Column("session_closed", sa.Boolean(), server_default=sa.text("FALSE"), nullable=False))
    _add("close_status", sa.Column("close_status", sa.Text(), server_default=sa.text("'none'"), nullable=False))
    _add("close_attempts", sa.Column("close_attempts", sa.Integer(), server_default=sa.text("0"), nullable=False))
    _add("last_close_attempt_at", sa.Column("last_close_attempt_at", sa.DateTime(timezone=True), nullable=True))
    _add("last_close_error", sa.Column("last_close_error", sa.Text(), nullable=True))
    _add("last_error", sa.Column("last_error", sa.Text(), nullable=True))

    # ── Release-state backfill ──
    # No remote session → nothing to release.
    bind.execute(sa.text(
        "UPDATE browser_tabs SET session_closed = TRUE, close_status = 'none' "
        "WHERE session_id IS NULL"
    ))
    # Live sessions on active tabs.
    bind.execute(sa.text(
        "UPDATE browser_tabs SET session_closed = FALSE, close_status = 'open' "
        "WHERE session_id IS NOT NULL AND status = 'active'"
    ))
    # Closed-in-DB tabs that still reference a remote session: the remote
    # side may still hold the session — queue for retried release.
    bind.execute(sa.text(
        "UPDATE browser_tabs SET session_closed = FALSE, close_status = 'close_failed' "
        "WHERE session_id IS NOT NULL AND status != 'active'"
    ))

    # ── Credential-reference backfill ──
    global_key = os.environ.get("BROWSERFABRIC_API_KEY", "")
    global_fp = hashlib.sha256(global_key.encode("utf-8")).hexdigest() if global_key else None

    rows = bind.execute(sa.text("SELECT id, settings FROM workspaces")).fetchall()
    for ws_id, settings in rows:
        if isinstance(settings, str):
            try:
                settings = json.loads(settings)
            except Exception:
                settings = {}
        settings = settings or {}
        ws_key = settings.get("browserfabric_api_key")
        if ws_key:
            source, fp = "workspace", hashlib.sha256(ws_key.encode("utf-8")).hexdigest()
        elif global_key:
            source, fp = "global", global_fp
        else:
            continue  # local mode — leave NULL
        bind.execute(
            sa.text(
                "UPDATE browser_tabs SET bf_key_source = :source, bf_key_fingerprint = :fp "
                "WHERE workspace_id = :ws AND session_id IS NOT NULL"
            ),
            {"source": source, "fp": fp, "ws": str(ws_id)},
        )


def downgrade() -> None:
    bind = op.get_bind()
    existing_cols = {c["name"] for c in sa.inspect(bind).get_columns("browser_tabs")}
    for name in (
        "last_error",
        "last_close_error",
        "last_close_attempt_at",
        "close_attempts",
        "close_status",
        "session_closed",
        "bf_key_fingerprint",
        "bf_key_source",
    ):
        if name in existing_cols:
            op.drop_column("browser_tabs", name)
