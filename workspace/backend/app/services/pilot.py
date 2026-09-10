# -*- coding: utf-8 -*-
"""Pilot User Program — eligibility + the one-off $300 grant.

Read side reuses the campaign engine's notions of "owned workspace",
"qualifying (launcher/CLI, non-cloud) agent" and the events table; write side
reuses campaign.grant() so the pilot credit is one more idempotent ledger row
(milestone "pilot") with the gateway idempotency key {user_id}:pilot.
"""

import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.config import config
from app.models import CampaignAccount, CampaignGrant, EventRecord, User, WorkspaceMember
from app.services import campaign

logger = logging.getLogger(__name__)

PILOT_MILESTONE = "pilot"
_MAX_EVENTS = 20000


def find_user(db: Session, email: str) -> Optional[User]:
    e = (email or "").strip().lower()
    if not e:
        return None
    return db.execute(select(User).where(User.email == e).limit(1)).scalar_one_or_none()


def activity(db: Session, user_id: str, window_days: int) -> dict:
    """Per-UTC-day interaction summary across the user's owned workspaces.

    An *active day* has at least one human message AND at least one reply from
    a qualifying agent in the same workspace on that day. Days where the human
    spoke but no qualifying agent replied are reported separately so a reviewer
    can judge borderline cases (e.g. a reply that landed just after midnight UTC).
    """
    ws_ids = campaign._owned_workspace_ids(db, user_id)
    if not ws_ids:
        return {"activeDays": [], "humanOnlyDays": [], "windowDays": window_days}
    since_ms = int((datetime.now(timezone.utc) - timedelta(days=window_days)).timestamp() * 1000)
    rows = db.execute(
        select(EventRecord.network_id, EventRecord.source, EventRecord.timestamp)
        .where(
            EventRecord.network_id.in_(ws_ids),
            EventRecord.type == "workspace.message.posted",
            EventRecord.timestamp >= since_ms,
            or_(EventRecord.source.like("human:%"), EventRecord.source.like("openagents:%")),
        )
        .order_by(EventRecord.timestamp.desc())
        .limit(_MAX_EVENTS)
    ).all()

    type_cache: dict[tuple[str, str], Optional[str]] = {}
    human: dict[tuple[str, str], int] = defaultdict(int)          # (ws, day) -> count
    agent: dict[tuple[str, str], dict[str, int]] = defaultdict(lambda: defaultdict(int))  # (ws, day) -> type -> count
    for ws, source, ts in rows:
        ws = str(ws)
        day = datetime.fromtimestamp((ts or 0) / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
        if source.startswith("human:"):
            human[(ws, day)] += 1
            continue
        name = source.split(":", 1)[1]
        key = (ws, name)
        if key not in type_cache:
            type_cache[key] = db.execute(
                select(WorkspaceMember.agent_type).where(
                    WorkspaceMember.workspace_id == ws,
                    WorkspaceMember.agent_name == name,
                )
            ).scalar_one_or_none()
        if campaign._qualifies(type_cache[key]):
            agent[(ws, day)][type_cache[key]] += 1

    per_day: dict[str, dict] = {}
    for (ws, day), n_h in human.items():
        d = per_day.setdefault(day, {"date": day, "humanMessages": 0, "agentMessages": 0, "agents": set()})
        d["humanMessages"] += n_h
        for t, n_a in agent.get((ws, day), {}).items():
            d["agentMessages"] += n_a
            d["agents"].add(t)
    active, human_only = [], []
    for day in sorted(per_day, reverse=True):
        d = per_day[day]
        d["agents"] = sorted(d["agents"])
        (active if d["agentMessages"] > 0 else human_only).append(d)
    return {"activeDays": active, "humanOnlyDays": human_only, "windowDays": window_days}


def _gateway_usage(user_id: str) -> Optional[dict]:
    try:
        r = httpx.get(
            f"{config.CAMPAIGN_GATEWAY_URL}/admin/keys",
            params={"external_id": user_id},
            headers=campaign._headers(),
            timeout=10.0,
        )
        r.raise_for_status()
        k = r.json()[0]
        return {"costLimitUsd": k.get("cost_limit_usd"), "costUsdUsed": k.get("cost_usd_used"), "isActive": k.get("is_active")}
    except Exception:  # noqa: BLE001 — decorative
        return None


def eligibility(db: Session, user: User) -> dict:
    types = sorted(campaign._connected_agent_types(db, user.id))
    act = activity(db, user.id, config.PILOT_WINDOW_DAYS)
    grants = db.execute(select(CampaignGrant).where(CampaignGrant.user_id == user.id)).scalars().all()
    pilot_row = next((g for g in grants if g.milestone == PILOT_MILESTONE), None)
    acct = db.get(CampaignAccount, user.id)

    reasons = []
    if not types:
        reasons.append("No launcher/CLI agent connected (cloud starter agents don't count).")
    n_active = len(act["activeDays"])
    if n_active < config.PILOT_MIN_ACTIVE_DAYS:
        reasons.append(
            f"Only {n_active} active day(s) in the last {config.PILOT_WINDOW_DAYS} days; "
            f"{config.PILOT_MIN_ACTIVE_DAYS} required."
        )
    if pilot_row is not None:
        reasons.append("Pilot credits already granted.")

    return {
        "found": True,
        "user": {
            "id": user.id,
            "email": user.email,
            "displayName": user.display_name,
            "createdAt": user.created_at.isoformat() if getattr(user, "created_at", None) else None,
        },
        "campaign": {
            "enabled": campaign.enabled(),
            "hasAccount": acct is not None,
            "gatewayKeyId": acct.gateway_key_id if acct else None,
            "totalGrantedUsd": float(sum(g.amount_usd for g in grants)),
            "dailyLedgerDays": sorted((g.milestone.split(":", 1)[1] for g in grants if g.milestone.startswith("daily:")), reverse=True),
            "usage": _gateway_usage(user.id) if (acct and campaign.enabled()) else None,
        },
        "agents": {"connected": bool(types), "qualifyingTypes": types},
        "activity": {**act, "activeDayCount": n_active, "timezone": "UTC"},
        "pilot": {
            "amountUsd": config.PILOT_GRANT_USD,
            "minActiveDays": config.PILOT_MIN_ACTIVE_DAYS,
            "alreadyGranted": pilot_row is not None,
            "grantedAt": pilot_row.created_at.isoformat() if pilot_row and pilot_row.created_at else None,
            "grantedNewLimitUsd": pilot_row.new_limit_usd if pilot_row else None,
            "eligible": not reasons,
            "reasons": reasons,
        },
    }


def apply_grant(db: Session, user: User, actor: str = "") -> dict:
    """Grant the pilot credits once. Returns {status: granted|already_granted|failed, ...}."""
    existing = db.execute(
        select(CampaignGrant).where(CampaignGrant.user_id == user.id, CampaignGrant.milestone == PILOT_MILESTONE)
    ).scalar_one_or_none()
    if existing:
        return {"status": "already_granted", "grantedAt": existing.created_at.isoformat() if existing.created_at else None,
                "newLimitUsd": existing.new_limit_usd}
    ok = campaign.grant(db, user.id, PILOT_MILESTONE, config.PILOT_GRANT_USD, ignore_cap=True)
    row = db.execute(
        select(CampaignGrant).where(CampaignGrant.user_id == user.id, CampaignGrant.milestone == PILOT_MILESTONE)
    ).scalar_one_or_none()
    if ok and row:
        logger.info("pilot: granted $%s to %s (%s) by %s", config.PILOT_GRANT_USD, user.email, user.id, actor or "unknown")
        return {"status": "granted", "amountUsd": config.PILOT_GRANT_USD, "newLimitUsd": row.new_limit_usd,
                "grantedAt": row.created_at.isoformat() if row.created_at else None}
    if row:  # lost a race with a concurrent grant
        return {"status": "already_granted", "grantedAt": row.created_at.isoformat() if row.created_at else None,
                "newLimitUsd": row.new_limit_usd}
    logger.warning("pilot: grant FAILED for %s (%s) by %s", user.email, user.id, actor or "unknown")
    return {"status": "failed"}
