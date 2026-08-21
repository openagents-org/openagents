# -*- coding: utf-8 -*-
"""API credits campaign — server-verified onboarding milestones.

New users earn model-gateway credits (raises to their key's cost_limit_usd)
as they hit onboarding milestones. Confirmed ladder (2026-08-21):

    signup                 $5    complete sign-up/login (baked into key creation)
    first_agent            $20   connect the first agent          (=$25)
    first_conversation     $10   send a message, agent responds   (=$35)
    second_agent           $10   connect a 2nd agent, DIFFERENT type (=$45)
    second_agent_response  $5    the 2nd-type agent responds      (=$50)
    daily:<date>           $10   each active day, until the $100 cap

Farming resistance:
  * every grant comes from a server-observed event, never a client claim
  * unique (user_id, milestone) ledger rows + gateway idempotency keys
  * Yumi (cloud:openagents) is auto-provisioned and NEVER counts — for
    connections or responses
  * milestones attribute to the OWNER of the workspace where the event
    happened, so joining someone else's workspace earns them nothing

Every entry point no-ops unless CAMPAIGN_ENABLED and a gateway master key are
configured, so self-hosted deployments carry zero behavior change.
"""

import logging
from datetime import datetime, timezone
from typing import Optional

import httpx
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import config
from app.database import SessionLocal
from app.models import (
    CampaignAccount,
    CampaignGrant,
    EventRecord,
    User,
    Workspace,
    WorkspaceMember,
    WorkspaceMembership,
)

logger = logging.getLogger(__name__)

MILESTONE_AMOUNTS = {
    "signup": 5.0,
    "first_agent": 20.0,
    "first_conversation": 10.0,
    "second_agent": 10.0,
    "second_agent_response": 5.0,
}
# Yumi — auto-provisioned first-party agent; never a campaign milestone.
BUILTIN_AGENT_TYPE = "cloud:openagents"


def enabled() -> bool:
    return bool(config.CAMPAIGN_ENABLED and config.CAMPAIGN_GATEWAY_MASTER_KEY)


def _headers() -> dict:
    return {"Authorization": f"Bearer {config.CAMPAIGN_GATEWAY_MASTER_KEY}"}


# ---------------------------------------------------------------------------
# Account provisioning
# ---------------------------------------------------------------------------

def ensure_account(db: Session, user: User) -> Optional[CampaignAccount]:
    """Return the user's campaign account, minting the gateway key on first
    call. The key starts at the signup grant ($5), recorded in the ledger so
    totals add up. Returns None when disabled or the gateway is unreachable —
    callers treat that as "campaign unavailable right now", never an error.
    """
    if not enabled():
        return None
    acct = db.get(CampaignAccount, user.id)
    if acct:
        return acct
    signup = MILESTONE_AMOUNTS["signup"]
    try:
        r = httpx.post(
            f"{config.CAMPAIGN_GATEWAY_URL}/admin/keys",
            json={
                "name": f"campaign-{user.id}",
                "cost_limit_usd": signup,
                "external_id": user.id,
                "metadata": {"campaign": "onboarding-v1", "email": user.email},
            },
            headers=_headers(),
            timeout=10.0,
        )
        if r.status_code == 409:
            # Gateway has a key but our row is gone — the secret is
            # unrecoverable (GET only returns prefixes). Log loudly; a human
            # can delete the orphan key to let the user re-mint.
            logger.error("campaign: orphan gateway key for user %s (409 on create)", user.id)
            return None
        r.raise_for_status()
        api_key = r.json()["api_key"]
        # The create response has no numeric id; fetch it for /admin/credits.
        rr = httpx.get(
            f"{config.CAMPAIGN_GATEWAY_URL}/admin/keys",
            params={"external_id": user.id},
            headers=_headers(),
            timeout=10.0,
        )
        rr.raise_for_status()
        key_id = rr.json()[0]["id"]
    except Exception as exc:  # noqa: BLE001 — campaign must never break auth flows
        logger.warning("campaign: key provisioning failed for %s: %s", user.id, exc)
        return None

    acct = CampaignAccount(user_id=user.id, gateway_key_id=key_id, api_key=api_key)
    db.add(acct)
    db.add(CampaignGrant(
        user_id=user.id, milestone="signup",
        amount_usd=signup, new_limit_usd=signup,
    ))
    try:
        db.commit()
    except IntegrityError:  # concurrent first request won the race
        db.rollback()
        return db.get(CampaignAccount, user.id)
    return acct


def total_granted(db: Session, user_id: str) -> float:
    rows = db.execute(
        select(CampaignGrant.amount_usd).where(CampaignGrant.user_id == user_id)
    ).scalars().all()
    return float(sum(rows))


def grant(db: Session, user_id: str, milestone: str, amount: float) -> bool:
    """Idempotently apply one grant. True only when newly applied."""
    if not enabled():
        return False
    acct = db.get(CampaignAccount, user_id)
    if not acct:
        user = db.get(User, user_id)
        acct = ensure_account(db, user) if user else None
        if not acct:
            return False
    if total_granted(db, user_id) + amount > config.CAMPAIGN_TOTAL_CAP_USD + 1e-6:
        return False
    row = CampaignGrant(user_id=user_id, milestone=milestone, amount_usd=amount)
    db.add(row)
    try:
        db.flush()
    except IntegrityError:  # already granted
        db.rollback()
        return False
    try:
        r = httpx.post(
            f"{config.CAMPAIGN_GATEWAY_URL}/admin/credits",
            json={
                "key_id": acct.gateway_key_id,
                "amount_usd": amount,
                "reason": f"milestone: {milestone}",
                "idempotency_key": f"{user_id}:{milestone}",
            },
            headers=_headers(),
            timeout=10.0,
        )
        r.raise_for_status()
        row.new_limit_usd = r.json().get("new_limit_usd")
        db.commit()
        logger.info("campaign: granted %s +$%s to %s", milestone, amount, user_id)
        return True
    except Exception as exc:  # noqa: BLE001
        # Roll the ledger row back so the milestone can retry on a later event.
        db.rollback()
        logger.warning("campaign: gateway grant failed (%s, %s): %s", user_id, milestone, exc)
        return False


# ---------------------------------------------------------------------------
# Milestone hooks — called from routers / services on server-observed events.
# All open their own session: they run as background tasks.
# ---------------------------------------------------------------------------

def _owner_user_id(db: Session, workspace_id: str) -> Optional[str]:
    return db.execute(
        select(WorkspaceMembership.user_id)
        .where(
            WorkspaceMembership.workspace_id == workspace_id,
            WorkspaceMembership.role == "owner",
        )
        .limit(1)
    ).scalar_one_or_none()


def _owned_workspace_ids(db: Session, user_id: str) -> list[str]:
    return [
        str(w) for w in db.execute(
            select(WorkspaceMembership.workspace_id).where(
                WorkspaceMembership.user_id == user_id,
                WorkspaceMembership.role == "owner",
            )
        ).scalars().all()
    ]


def _connected_agent_types(db: Session, user_id: str) -> set[str]:
    """Distinct user-connected agent types across all owned workspaces."""
    ws_ids = _owned_workspace_ids(db, user_id)
    if not ws_ids:
        return set()
    types = db.execute(
        select(WorkspaceMember.agent_type).distinct().where(
            WorkspaceMember.workspace_id.in_(ws_ids),
            WorkspaceMember.agent_type.isnot(None),
            WorkspaceMember.agent_type != BUILTIN_AGENT_TYPE,
        )
    ).scalars().all()
    return {t for t in types if t}


def on_agent_joined(workspace_id: str, agent_type: Optional[str]) -> None:
    """An agent joined a workspace (launcher join, node agent, cloud agent)."""
    if not enabled() or (agent_type or "") == BUILTIN_AGENT_TYPE:
        return
    db = SessionLocal()
    try:
        uid = _owner_user_id(db, workspace_id)
        if not uid:
            return
        n_types = len(_connected_agent_types(db, uid))
        if n_types >= 1:
            grant(db, uid, "first_agent", MILESTONE_AMOUNTS["first_agent"])
        if n_types >= 2:
            grant(db, uid, "second_agent", MILESTONE_AMOUNTS["second_agent"])
    except Exception as exc:  # noqa: BLE001
        logger.warning("campaign: on_agent_joined failed for %s: %s", workspace_id, exc)
    finally:
        db.close()


def _responding_agent_types(db: Session, user_id: str) -> set[str]:
    """Distinct types of user-connected agents that have posted a message in
    the user's owned workspaces."""
    ws_ids = _owned_workspace_ids(db, user_id)
    if not ws_ids:
        return set()
    sources = db.execute(
        select(EventRecord.source, EventRecord.network_id).distinct().where(
            EventRecord.network_id.in_(ws_ids),
            EventRecord.type == "workspace.message.posted",
            EventRecord.source.like("openagents:%"),
        ).limit(200)
    ).all()
    types: set[str] = set()
    for source, ws_id in sources:
        name = source.split(":", 1)[1]
        member_type = db.execute(
            select(WorkspaceMember.agent_type).where(
                WorkspaceMember.workspace_id == str(ws_id),
                WorkspaceMember.agent_name == name,
            )
        ).scalar_one_or_none()
        if member_type and member_type != BUILTIN_AGENT_TYPE:
            types.add(member_type)
    return types


def on_agent_message(workspace_id: str, source: str) -> None:
    """A message was posted by an agent — conversation and daily milestones."""
    if not enabled() or not source.startswith("openagents:"):
        return
    db = SessionLocal()
    try:
        uid = _owner_user_id(db, workspace_id)
        if not uid:
            return
        # The responder must be a user-connected agent (not Yumi).
        agent_name = source.split(":", 1)[1]
        member_type = db.execute(
            select(WorkspaceMember.agent_type).where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.agent_name == agent_name,
            )
        ).scalar_one_or_none()
        if not member_type or member_type == BUILTIN_AGENT_TYPE:
            return
        # ... and a human must have spoken in this workspace, so an agent
        # posting unprompted doesn't unlock a "conversation".
        human_spoke = db.execute(
            select(EventRecord.id).where(
                EventRecord.network_id == workspace_id,
                EventRecord.type == "workspace.message.posted",
                EventRecord.source.like("human:%"),
            ).limit(1)
        ).scalar_one_or_none()
        if not human_spoke:
            return

        grant(db, uid, "first_conversation", MILESTONE_AMOUNTS["first_conversation"])
        if len(_responding_agent_types(db, uid)) >= 2:
            grant(db, uid, "second_agent_response", MILESTONE_AMOUNTS["second_agent_response"])
        # Daily active: gated behind the first conversation by construction
        # (we only reach here on a qualifying agent response).
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        grant(db, uid, f"daily:{today}", config.CAMPAIGN_DAILY_GRANT_USD)
    except Exception as exc:  # noqa: BLE001
        logger.warning("campaign: on_agent_message failed for %s: %s", workspace_id, exc)
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Status (for the frontend checklist)
# ---------------------------------------------------------------------------

def status_payload(db: Session, user: User) -> dict:
    """Everything the checklist UI needs. Provisions the key lazily on first
    view (that IS the signup milestone — the user completed login to get here).
    """
    if not enabled():
        return {"enabled": False}
    acct = ensure_account(db, user)
    grants = db.execute(
        select(CampaignGrant).where(CampaignGrant.user_id == user.id)
    ).scalars().all()
    by_milestone = {g.milestone: g for g in grants}
    total = float(sum(g.amount_usd for g in grants))
    daily_days = sorted(m.split(":", 1)[1] for m in by_milestone if m.startswith("daily:"))
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    usage = None
    if acct:
        try:
            r = httpx.get(
                f"{config.CAMPAIGN_GATEWAY_URL}/admin/keys",
                params={"external_id": user.id},
                headers=_headers(),
                timeout=10.0,
            )
            r.raise_for_status()
            k = r.json()[0]
            usage = {
                "costUsdUsed": k.get("cost_usd_used"),
                "costLimitUsd": k.get("cost_limit_usd"),
                "isActive": k.get("is_active"),
            }
        except Exception:  # noqa: BLE001 — usage is decorative
            pass

    return {
        "enabled": True,
        "apiKey": acct.api_key if acct else None,
        "gatewayUrl": config.CAMPAIGN_GATEWAY_URL,
        "capUsd": config.CAMPAIGN_TOTAL_CAP_USD,
        "totalGrantedUsd": total,
        "milestones": [
            {
                "key": key,
                "amountUsd": amount,
                "grantedAt": by_milestone[key].created_at.isoformat() if key in by_milestone else None,
            }
            for key, amount in MILESTONE_AMOUNTS.items()
        ],
        "daily": {
            "grantUsd": config.CAMPAIGN_DAILY_GRANT_USD,
            "daysGranted": len(daily_days),
            "todayGranted": today in daily_days,
        },
        "usage": usage,
    }
