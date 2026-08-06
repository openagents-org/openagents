#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Backfill the built-in Yumi assistant into existing (active) workspaces.

New workspaces get Yumi automatically at creation (see
routers/workspaces.py). This one-off script adds Yumi to workspaces that
already existed before the feature shipped.

Idempotent: skips workspaces that already have a live Yumi. Safe to re-run.
Requires the same env as the backend (DATABASE_URL, YUMI_API_KEY, ...). Yumi is
only added when config.should_provision() is True (i.e. enabled + key set).

Usage (from workspace/backend/):
    python scripts/backfill_yumi.py            # apply
    python scripts/backfill_yumi.py --dry-run  # report only
"""

import os
import sys

# Make `app` importable when run as `python scripts/backfill_yumi.py`.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app.models import Workspace  # noqa: E402
from app.services.yumi import provision_yumi, should_provision  # noqa: E402


def main() -> int:
    dry_run = "--dry-run" in sys.argv

    if not should_provision():
        print(
            "Yumi provisioning is disabled or no YUMI_API_KEY is configured — "
            "nothing to do. Set YUMI_ENABLED=true and YUMI_API_KEY."
        )
        return 1

    db = SessionLocal()
    added = 0
    skipped = 0
    try:
        workspaces = db.execute(
            select(Workspace).where(Workspace.status != "deleted")
        ).scalars().all()
        print(f"Found {len(workspaces)} active workspace(s).")

        for ws in workspaces:
            if dry_run:
                # provision_yumi mutates + returns whether it *would* add; roll
                # back so a dry run changes nothing.
                would = provision_yumi(db, ws)
                db.rollback()
                print(f"  [{ws.slug}] {'would add' if would else 'already has'} Yumi")
                added += 1 if would else 0
                skipped += 0 if would else 1
                continue

            if provision_yumi(db, ws):
                db.commit()
                added += 1
                print(f"  [{ws.slug}] added Yumi")
            else:
                skipped += 1
                print(f"  [{ws.slug}] already has Yumi — skipped")
    finally:
        db.close()

    verb = "would add" if dry_run else "added"
    print(f"\nDone. {verb} Yumi to {added} workspace(s), {skipped} already had it.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
