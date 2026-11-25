#!/usr/bin/env python
"""Backfill dm_pair_summaries (migration 101), one workspace at a time.

    python scripts/backfill_dm_summaries.py --workspace <id> [--workspace <id> ...]
    python scripts/backfill_dm_summaries.py --all [--pause 2] [--limit N]

Each workspace is backfilled exactly once (see app/services/dm_pair_summary.py)
and is safe while messages keep arriving. Run off-peak: a workspace with a
very long DM history reads it in full once (minutes for the largest).
"""
import argparse
import json
import os
import sys
import time

# Make `app` importable when run as `python scripts/backfill_dm_summaries.py`.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select  # noqa: E402

from app.database import engine  # noqa: E402
from app.models import DmSummaryBackfill, Workspace  # noqa: E402
from app.services.dm_pair_summary import backfill_workspace  # noqa: E402


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", action="append", default=[])
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--pause", type=float, default=1.0, help="seconds between workspaces")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()
    ids = list(args.workspace)
    if args.all:
        with engine.connect() as conn:
            done = {r[0] for r in conn.execute(select(DmSummaryBackfill.workspace_id))}
            ids += [str(r[0]) for r in conn.execute(select(Workspace.id).order_by(Workspace.created_at))
                    if str(r[0]) not in done]
    if args.limit:
        ids = ids[:args.limit]
    for i, workspace_id in enumerate(ids, 1):
        result = backfill_workspace(engine, workspace_id)
        print(json.dumps({"n": i, "of": len(ids), **result}), flush=True)
        if args.pause and i < len(ids):
            time.sleep(args.pause)


if __name__ == "__main__":
    main()
