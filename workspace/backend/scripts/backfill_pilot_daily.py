# -*- coding: utf-8 -*-
"""Backfill daily bonuses the ladder-cap bug swallowed for Pilot Program users.

Until 2026-09-18 `campaign.grant()` counted the $300 pilot row toward the
$100 onboarding cap, so every daily bonus (and any unpaid ladder milestone)
after a pilot grant was refused. This replays those days through the normal
engine: same rule (a qualifying launcher/CLI agent replied in an owned
workspace where the user has spoken, on that UTC day), same ledger keys
(`daily:YYYY-MM-DD`), same gateway idempotency — so it is safe to re-run.

Dry-run by default. Run from workspace/backend against production:

    DATABASE_URL=<postgres url> CAMPAIGN_ENABLED=true \\
    CAMPAIGN_GATEWAY_MASTER_KEY=<key> python -m scripts.backfill_pilot_daily [--apply] [--email a@b.co]
"""

import argparse
import sys
from datetime import datetime, timezone

from sqlalchemy import text

from app.config import config
from app.database import SessionLocal
from app.models import CampaignGrant, User
from app.services import campaign

# Distinct UTC days (>= the pilot day) with a qualifying agent reply in an owned
# workspace where the user has spoken. Mirrors on_agent_message's rule.
_DAYS_SQL = text("""
SELECT DISTINCT to_char(to_timestamp(e.timestamp / 1000.0) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day
FROM events e
JOIN workspace_memberships m
  ON m.workspace_id = e.network_id AND m.user_id = :uid AND m.role = 'owner'
JOIN workspace_members wm
  ON wm.workspace_id = e.network_id AND wm.agent_name = split_part(e.source, ':', 2)
WHERE e.type = 'workspace.message.posted'
  AND e.source LIKE 'openagents:%'
  AND wm.agent_type IS NOT NULL AND wm.agent_type NOT LIKE 'cloud:%'
  AND e.timestamp >= :since_ms
  AND EXISTS (SELECT 1 FROM events h
              WHERE h.network_id = e.network_id
                AND h.type = 'workspace.message.posted' AND h.source LIKE 'human:%')
ORDER BY day
""")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="actually grant (default: dry-run)")
    ap.add_argument("--email", help="only this user")
    args = ap.parse_args()
    if not campaign.enabled():
        print("campaign is not enabled (CAMPAIGN_ENABLED / CAMPAIGN_GATEWAY_MASTER_KEY)", file=sys.stderr)
        return 2

    db = SessionLocal()
    planned = applied = 0
    try:
        q = db.query(CampaignGrant).filter(CampaignGrant.milestone == "pilot").order_by(CampaignGrant.created_at)
        for pilot in q.all():
            user = db.get(User, pilot.user_id)
            if not user or (args.email and user.email.lower() != args.email.lower()):
                continue
            if args.apply:
                campaign.reconcile(db, user.id)  # unpaid ladder milestones first
            have = {g.milestone for g in db.query(CampaignGrant).filter(CampaignGrant.user_id == user.id).all()}
            pilot_day = pilot.created_at.astimezone(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
            days = [r[0] for r in db.execute(_DAYS_SQL, {"uid": user.id, "since_ms": int(pilot_day.timestamp() * 1000)})]
            missing = [d for d in days if f"daily:{d}" not in have]
            if not missing:
                continue
            before = campaign.ladder_total(db, user.id)
            print(f"{user.email:<40} ladder ${before:g}  missing {missing}")
            for d in missing:
                planned += 1
                if args.apply:
                    ok = campaign.grant(db, user.id, f"daily:{d}", config.CAMPAIGN_DAILY_GRANT_USD)
                    applied += ok
                    print(f"    daily:{d} -> {'granted' if ok else 'refused (cap/dup/gateway)'}")
        print(f"\n{'applied' if args.apply else 'would grant'} {applied if args.apply else planned} daily bonus(es)"
              f" × ${config.CAMPAIGN_DAILY_GRANT_USD:g} (today={datetime.now(timezone.utc):%Y-%m-%d} UTC)")
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
