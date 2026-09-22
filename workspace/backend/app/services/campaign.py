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
  * cloud agents (any "cloud:*" type, incl. the auto-provisioned Yumi) NEVER
    count — for connections or responses; only launcher/CLI agents qualify
  * milestones attribute to the OWNER of the workspace where the event
    happened, so joining someone else's workspace earns them nothing

Every entry point no-ops unless CAMPAIGN_ENABLED and a gateway master key are
configured, so self-hosted deployments carry zero behavior change.
"""

import logging
import re
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
from app.services.notify import notify

logger = logging.getLogger(__name__)

MILESTONE_AMOUNTS = {
    "signup": 5.0,
    "first_agent": 20.0,
    "first_conversation": 10.0,
    "second_agent": 10.0,
    "second_agent_response": 5.0,
}
# Grants that sit OUTSIDE the onboarding ladder. They stack on top of the
# $100 cap instead of consuming it (a Pilot Program user ends at $100 + $300),
# so they are excluded from the cap check and reported separately. Counting
# them froze every pilot user's ladder at whatever it had reached (2026-09-18).
EXTRA_MILESTONES = frozenset({"pilot"})

# Cloud agents never count for campaign milestones (confirmed 2026-08-23):
# they run on server-held or provider keys, not the user's own setup — the
# campaign rewards connecting real launcher/CLI agents. This also covers the
# auto-provisioned Yumi (cloud:openagents).
CLOUD_TYPE_PREFIX = "cloud:"


def _qualifies(agent_type) -> bool:
    """True when an agent type counts for campaign milestones."""
    return bool(agent_type) and not str(agent_type).startswith(CLOUD_TYPE_PREFIX)


def enabled() -> bool:
    return bool(config.CAMPAIGN_ENABLED and config.CAMPAIGN_GATEWAY_MASTER_KEY)


# Disposable / throwaway mail providers. Matched against the whole domain
# (and its parent domains), case-insensitive. Kept deliberately short and
# well-known: false positives here lock a real person out of credits.
_DISPOSABLE_DOMAIN_RE = re.compile(
    r"(^|\.)("
    r"mailinator|guerrillamail|guerrillamailblock|sharklasers|grr\.la|10minutemail|10minemail|"
    r"temp-?mail[a-z0-9-]*|tempr|tempail|throwawaymail|throwam|trashmail|trash-mail|yopmail|"
    r"dispostable|getnada|nada|mohmal|maildrop|fakeinbox|mailnesia|emailondeck|minutemail|"
    r"mintemail|mytemp|discard|spamgourmet|33mail|burnermail|mailcatch|inboxbear|"
    r"linshiyouxiang|linshiyou|bccto|chacuo|mailnull|tmpmail|tmail|moakt|dropmail|1secmail|"
    r"emailfake|crazymailing|mailsac|harakirimail|mail-temp|tempinbox|instantemailaddress"
    r")\.[a-z.]+$"
    r"|(^|\.)grr\.la$"
    r"|(^|\.)dedyn\.io$",  # deSEC dynamic-DNS catch-alls (temp-mail-free.dedyn.io farm, 2026-09-21)
    re.IGNORECASE,
)


def _blocked_domains() -> set[str]:
    return {
        d.strip().lower()
        for d in (config.CAMPAIGN_BLOCKED_EMAIL_DOMAINS or "").split(",")
        if d.strip()
    }


def email_blocked(email: Optional[str]) -> bool:
    """True when the address's domain (or a parent domain) is on the operator
    blocklist or looks like a disposable-mail provider."""
    domain = (email or "").rsplit("@", 1)[-1].strip().lower()
    if not domain or "@" not in (email or ""):
        return True  # no usable address → no credits
    blocked = _blocked_domains()
    parts = domain.split(".")
    for i in range(len(parts) - 1):
        if ".".join(parts[i:]) in blocked:
            return True
    return bool(_DISPOSABLE_DOMAIN_RE.search(domain))


def sync_email_verification(db: Session, user: User, bearer: Optional[str]) -> bool:
    """Ask openagents.org whether this account's address is confirmed and stamp
    the user if so. Returns True when the user is verified afterwards.

    Needed because a Firebase session established BEFORE the workspace handoff
    started carrying `oa_email_verified` keeps its old claims until the next
    sign-in — without this, a long-lived legit session would sit behind the
    verify wall. Also covers providers whose token lacks the claim. Best-effort:
    any failure just leaves the user unverified for now. Never raises.
    """
    if user.email_verified_at:
        return True
    if not bearer or not config.ACCOUNT_API_URL:
        return False
    try:
        r = httpx.get(
            f"{config.ACCOUNT_API_URL.rstrip('/')}/v1/me",
            headers={"Authorization": f"Bearer {bearer}"},
            timeout=5.0,
        )
        if r.status_code != 200:
            return False
        data = (r.json() or {}).get("data") or {}
        same_user = (data.get("email") or "").strip().lower() == (user.email or "").lower()
        if same_user and data.get("email_verified") is True:
            user.email_verified_at = datetime.now(timezone.utc)
            db.commit()
            logger.info("campaign: verification synced from account API for %s", user.id)
            return True
    except Exception as exc:  # noqa: BLE001 — decorative lookup
        logger.debug("campaign: account API verification lookup failed: %s", exc)
    return False


def ineligible_reason(user: Optional[User]) -> Optional[str]:
    """None when the user may receive credits, else "blocked" | "unverified".

    "unverified" here means the address is not verified — the caller decides
    what that allows: nothing beyond CAMPAIGN_UNVERIFIED_ALLOWANCE_USD on the
    ladder (see grant_block). Pilot grants stamp verification first.
    """
    if user is None or email_blocked(user.email):
        return "blocked"
    if config.CAMPAIGN_REQUIRE_VERIFIED_EMAIL and not user.email_verified_at:
        return "unverified"
    return None


def grant_block(db: Session, user: Optional[User], amount: float, *, ladder: bool = True) -> Optional[str]:
    """Why this grant may NOT be applied right now, or None.

    Blocked addresses never get anything. Unverified addresses get the first
    rewards while their ladder total stays within the allowance (decision
    2026-09-20: $5 — the instant key + signup credit, the rest after verifying);
    the first reward that would cross it waits, and reconcile() catches it up
    on the status fetch after verification. Non-ladder grants (pilot) are
    never allowed for unverified addresses — but pilot stamps verification.
    """
    reason = ineligible_reason(user)
    if reason != "unverified":
        return reason
    if not ladder:
        return "unverified"
    allowance = float(config.CAMPAIGN_UNVERIFIED_ALLOWANCE_USD or 0)
    if allowance <= 0:
        return "unverified"
    return None if ladder_total(db, user.id) + amount <= allowance + 1e-6 else "unverified"


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
    if grant_block(db, user, signup):
        return None  # blocked address, or unverified with no allowance: no key
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
    """Everything on the key: ladder + extras (pilot)."""
    rows = db.execute(
        select(CampaignGrant.amount_usd).where(CampaignGrant.user_id == user_id)
    ).scalars().all()
    return float(sum(rows))


def ladder_total(db: Session, user_id: str) -> float:
    """Onboarding-ladder grants only — the number the $100 cap applies to."""
    rows = db.execute(
        select(CampaignGrant.amount_usd).where(
            CampaignGrant.user_id == user_id,
            CampaignGrant.milestone.notin_(EXTRA_MILESTONES),
        )
    ).scalars().all()
    return float(sum(rows))


def grant(db: Session, user_id: str, milestone: str, amount: float, *, ignore_cap: bool = False) -> bool:
    """Idempotently apply one grant. True only when newly applied.

    `ignore_cap` is for grants that sit outside the $100 onboarding ladder
    (the Pilot Program's $300, applied by an admin): the ledger row and the
    gateway idempotency key still apply, only the cap check is skipped. The
    cap itself only counts ladder rows (see EXTRA_MILESTONES), so an earlier
    pilot grant never blocks the ladder that follows it.
    """
    if not enabled():
        return False
    user = db.get(User, user_id)
    if grant_block(db, user, amount, ladder=milestone not in EXTRA_MILESTONES):
        return False
    acct = db.get(CampaignAccount, user_id)
    if not acct:
        acct = ensure_account(db, user)
        if not acct:
            return False
    if not ignore_cap and ladder_total(db, user_id) + amount > config.CAMPAIGN_TOTAL_CAP_USD + 1e-6:
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

MILESTONE_TITLES = {
    "first_agent": "You connected your first agent",
    "first_conversation": "You had your first agent conversation",
    "second_agent": "You connected a second agent type",
    "second_agent_response": "Your second agent replied",
}


def _notify_grant(db: Session, workspace_id: str, user_id: str, milestone: str, amount: float) -> None:
    """Drop a workspace-inbox notification so the reward is visible right
    where it was earned. Best-effort — never blocks the grant.

    Inbox only, no push: credits unlocking is good news that keeps until the
    user next opens the app. A phone that buzzes for it is an app that has
    taught its user to ignore the buzz.
    """
    try:
        total = ladder_total(db, user_id)
        label = MILESTONE_TITLES.get(milestone) or (
            "Daily active bonus" if milestone.startswith("daily:") else milestone
        )
        notify(
            db,
            workspace_id,
            source="system:campaign",
            title=f"🎉 +${amount:g} API credits unlocked",
            message=(
                f"{label} — ${total:g} of ${config.CAMPAIGN_TOTAL_CAP_USD:g} unlocked. "
                "Your API key and full checklist are on your workspace list page."
            ),
            priority="low" if milestone.startswith("daily:") else "normal",
            push=False,
        )
        db.commit()
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        logger.warning("campaign: notification failed (%s, %s): %s", workspace_id, milestone, exc)


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
            WorkspaceMember.agent_type.notlike(f"{CLOUD_TYPE_PREFIX}%"),
        )
    ).scalars().all()
    return {t for t in types if t}


def on_agent_joined(workspace_id: str, agent_type: Optional[str]) -> None:
    """An agent joined a workspace (launcher join, node agent, cloud agent)."""
    if not enabled() or not _qualifies(agent_type):
        return
    db = SessionLocal()
    try:
        uid = _owner_user_id(db, workspace_id)
        if not uid:
            return
        n_types = len(_connected_agent_types(db, uid))
        if n_types >= 1 and grant(db, uid, "first_agent", MILESTONE_AMOUNTS["first_agent"]):
            _notify_grant(db, workspace_id, uid, "first_agent", MILESTONE_AMOUNTS["first_agent"])
        if n_types >= 2 and grant(db, uid, "second_agent", MILESTONE_AMOUNTS["second_agent"]):
            _notify_grant(db, workspace_id, uid, "second_agent", MILESTONE_AMOUNTS["second_agent"])
    except Exception as exc:  # noqa: BLE001
        logger.warning("campaign: on_agent_joined failed for %s: %s", workspace_id, exc)
    finally:
        db.close()


def _responding_agent_types(db: Session, user_id: str, min_ts_ms: Optional[int] = None) -> set[str]:
    """Distinct types of user-connected agents that have posted a message in
    the user's owned workspaces (optionally only since min_ts_ms)."""
    ws_ids = _owned_workspace_ids(db, user_id)
    if not ws_ids:
        return set()
    conds = [
        EventRecord.network_id.in_(ws_ids),
        EventRecord.type == "workspace.message.posted",
        EventRecord.source.like("openagents:%"),
    ]
    if min_ts_ms is not None:
        conds.append(EventRecord.timestamp >= min_ts_ms)
    sources = db.execute(
        select(EventRecord.source, EventRecord.network_id).distinct().where(*conds).limit(200)
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
        if _qualifies(member_type):
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
        if not _qualifies(member_type):
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

        if grant(db, uid, "first_conversation", MILESTONE_AMOUNTS["first_conversation"]):
            _notify_grant(db, workspace_id, uid, "first_conversation", MILESTONE_AMOUNTS["first_conversation"])
        if len(_responding_agent_types(db, uid)) >= 2 and grant(
            db, uid, "second_agent_response", MILESTONE_AMOUNTS["second_agent_response"]
        ):
            _notify_grant(db, workspace_id, uid, "second_agent_response", MILESTONE_AMOUNTS["second_agent_response"])
        # Daily active: gated behind the first conversation by construction
        # (we only reach here on a qualifying agent response).
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        daily_key = f"daily:{today}"
        if grant(db, uid, daily_key, config.CAMPAIGN_DAILY_GRANT_USD):
            _notify_grant(db, workspace_id, uid, daily_key, config.CAMPAIGN_DAILY_GRANT_USD)
    except Exception as exc:  # noqa: BLE001
        logger.warning("campaign: on_agent_message failed for %s: %s", workspace_id, exc)
    finally:
        db.close()


def _human_spoke_in_owned(db: Session, user_id: str) -> bool:
    ws_ids = _owned_workspace_ids(db, user_id)
    if not ws_ids:
        return False
    return db.execute(
        select(EventRecord.id).where(
            EventRecord.network_id.in_(ws_ids),
            EventRecord.type == "workspace.message.posted",
            EventRecord.source.like("human:%"),
        ).limit(1)
    ).scalar_one_or_none() is not None


def reconcile(db: Session, user_id: str) -> None:
    """Self-healing sweep: recompute the agent/conversation milestones from
    current DB state. The event hooks only see REST traffic — agents that join
    or post over the WebSocket transport (the launcher's normal path), or that
    connected before the campaign launched, would otherwise never count.
    Runs on every status fetch with an early exit once everything is granted.
    Catch-up grants are quiet (no inbox note) — the frontend toast diff still
    announces them.
    """
    if not enabled():
        return
    try:
        have = set(db.execute(
            select(CampaignGrant.milestone).where(CampaignGrant.user_id == user_id)
        ).scalars().all())
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        daily_key = f"daily:{today}"
        needed = {"first_agent", "second_agent", "first_conversation", "second_agent_response", daily_key}
        if needed <= have:
            return

        n_types = len(_connected_agent_types(db, user_id))
        if n_types >= 1 and "first_agent" not in have:
            if grant(db, user_id, "first_agent", MILESTONE_AMOUNTS["first_agent"]):
                have.add("first_agent")
        if n_types >= 2 and "second_agent" not in have:
            if grant(db, user_id, "second_agent", MILESTONE_AMOUNTS["second_agent"]):
                have.add("second_agent")

        resp_types = _responding_agent_types(db, user_id)
        if resp_types and _human_spoke_in_owned(db, user_id):
            if "first_conversation" not in have:
                if grant(db, user_id, "first_conversation", MILESTONE_AMOUNTS["first_conversation"]):
                    have.add("first_conversation")
            if len(resp_types) >= 2 and "second_agent_response" not in have:
                grant(db, user_id, "second_agent_response", MILESTONE_AMOUNTS["second_agent_response"])
            # Daily active: a qualifying agent reply today (UTC), gated on the
            # first conversation existing.
            if "first_conversation" in have and daily_key not in have:
                day_start_ms = int(datetime.now(timezone.utc)
                                   .replace(hour=0, minute=0, second=0, microsecond=0)
                                   .timestamp() * 1000)
                if _responding_agent_types(db, user_id, min_ts_ms=day_start_ms):
                    grant(db, user_id, daily_key, config.CAMPAIGN_DAILY_GRANT_USD)
    except Exception as exc:  # noqa: BLE001 — reconcile must never break status
        logger.warning("campaign: reconcile failed for %s: %s", user_id, exc)


# ---------------------------------------------------------------------------
# Status (for the frontend checklist)
# ---------------------------------------------------------------------------

def status_payload(db: Session, user: User) -> dict:
    """Everything the checklist UI needs. Provisions the key lazily on first
    view (that IS the signup milestone — the user completed login to get here).
    """
    if not enabled():
        return {"enabled": False}
    reason = ineligible_reason(user)
    if reason == "blocked":
        return {"enabled": False}  # hide the whole campaign for blocked addresses
    # Unverified: the key and the first rewards (within the allowance) still
    # arrive; the payload carries the flag so the UI shows a verify banner on
    # top of the normal checklist. Grants past the allowance are refused by
    # grant_block until the address is verified; reconcile catches them up.
    unverified = reason == "unverified"
    acct = ensure_account(db, user)
    reconcile(db, user.id)
    grants = db.execute(
        select(CampaignGrant).where(CampaignGrant.user_id == user.id)
    ).scalars().all()
    by_milestone = {g.milestone: g for g in grants}
    # The checklist compares `total` against the cap, so it is ladder-only;
    # extras (pilot) are reported on their own and in the grand total.
    total = float(sum(g.amount_usd for g in grants if g.milestone not in EXTRA_MILESTONES))
    grand_total = float(sum(g.amount_usd for g in grants))
    pilot_row = by_milestone.get("pilot")
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
                "inputTokens": k.get("input_tokens_used"),
                "outputTokens": k.get("output_tokens_used"),
            }
        except Exception:  # noqa: BLE001 — usage is decorative
            pass

    return {
        "enabled": True,
        **({"requiresEmailVerification": True, "email": user.email,
            "unverifiedAllowanceUsd": float(config.CAMPAIGN_UNVERIFIED_ALLOWANCE_USD or 0)} if unverified else {}),
        "apiKey": acct.api_key if acct else None,
        "gatewayUrl": config.CAMPAIGN_GATEWAY_URL,
        "capUsd": config.CAMPAIGN_TOTAL_CAP_USD,
        "totalGrantedUsd": total,
        "grandTotalUsd": grand_total,
        "pilot": (
            {"amountUsd": pilot_row.amount_usd,
             "grantedAt": pilot_row.created_at.isoformat() if pilot_row.created_at else None}
            if pilot_row else None
        ),
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
