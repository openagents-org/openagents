# -*- coding: utf-8 -*-
"""API credits campaign — milestone engine tests with a mocked gateway."""

import uuid
from datetime import datetime, timezone
from unittest.mock import patch, MagicMock

import pytest

from app.config import config
from app.models import (
    CampaignAccount,
    CampaignGrant,
    EventRecord,
    User,
    Workspace,
    WorkspaceMember,
    WorkspaceMembership,
)
from app.services import campaign


def _mk_user(db, email="u@example.com", verified=True):
    # Credits require a verified address (2026-09-20); tests default to one.
    user = User(id=str(uuid.uuid4()), email=email,
                email_verified_at=datetime.now(timezone.utc) if verified else None)
    db.add(user)
    db.commit()
    return user


def _mk_workspace(db, user):
    ws = Workspace(id=str(uuid.uuid4()), slug=uuid.uuid4().hex[:8], name="My Workspace")
    db.add(ws)
    db.add(WorkspaceMembership(workspace_id=ws.id, user_id=user.id, role="owner"))
    db.commit()
    return ws


def _mk_member(db, ws, name, agent_type):
    db.add(WorkspaceMember(workspace_id=str(ws.id), agent_name=name, agent_type=agent_type))
    db.commit()


def _mk_message(db, ws, source, eid=None):
    db.add(EventRecord(
        id=eid or str(uuid.uuid4()), network_id=str(ws.id),
        type="workspace.message.posted", source=source, target="channel/x",
        payload={}, timestamp=0,
    ))
    db.commit()


class _NoCloseSession:
    """Hooks close their session; tests share one — make close a no-op."""

    def __init__(self, s):
        self._s = s

    def __getattr__(self, name):
        return getattr(self._s, name)

    def close(self):
        pass


@pytest.fixture
def campaign_on(monkeypatch):
    monkeypatch.setattr(config, "CAMPAIGN_ENABLED", True)
    monkeypatch.setattr(config, "CAMPAIGN_GATEWAY_MASTER_KEY", "test-master")


@pytest.fixture
def gateway(monkeypatch):
    """Mock httpx against the gateway; records grant calls."""
    calls = []

    def fake_post(url, json=None, headers=None, timeout=None):
        resp = MagicMock()
        resp.status_code = 200
        resp.raise_for_status = lambda: None
        if url.endswith("/admin/keys"):
            resp.json = lambda: {"api_key": "sk-demo-test", "cost_limit_usd": 5.0}
        else:  # /admin/credits
            calls.append(json)
            resp.json = lambda: {"new_limit_usd": 25.0, "already_applied": False}
        return resp

    def fake_get(url, params=None, headers=None, timeout=None):
        resp = MagicMock()
        resp.raise_for_status = lambda: None
        resp.json = lambda: [{"id": 42, "cost_usd_used": 0.0, "cost_limit_usd": 5.0, "is_active": True}]
        return resp

    monkeypatch.setattr(campaign.httpx, "post", fake_post)
    monkeypatch.setattr(campaign.httpx, "get", fake_get)
    return calls


def test_disabled_is_total_noop(db):
    user = _mk_user(db)
    assert campaign.ensure_account(db, user) is None
    assert campaign.grant(db, user.id, "first_agent", 20.0) is False


def test_ensure_account_mints_key_and_signup_grant(db, campaign_on, gateway):
    user = _mk_user(db)
    acct = campaign.ensure_account(db, user)
    assert acct is not None and acct.api_key == "sk-demo-test" and acct.gateway_key_id == 42
    grants = db.query(CampaignGrant).filter_by(user_id=user.id).all()
    assert [g.milestone for g in grants] == ["signup"]
    assert campaign.total_granted(db, user.id) == 5.0
    # Second call reuses, doesn't duplicate.
    assert campaign.ensure_account(db, user).user_id == acct.user_id
    assert db.query(CampaignAccount).count() == 1


def test_grant_is_idempotent_and_capped(db, campaign_on, gateway):
    user = _mk_user(db)
    campaign.ensure_account(db, user)
    assert campaign.grant(db, user.id, "first_agent", 20.0) is True
    assert campaign.grant(db, user.id, "first_agent", 20.0) is False  # replay
    assert campaign.total_granted(db, user.id) == 25.0
    # Cap: a grant that would exceed CAMPAIGN_TOTAL_CAP_USD is refused.
    assert campaign.grant(db, user.id, "huge", 999.0) is False


def test_agent_joined_milestones(db, campaign_on, gateway):
    user = _mk_user(db)
    ws = _mk_workspace(db, user)
    campaign.ensure_account(db, user)

    # Cloud agents (incl. Yumi) never count.
    _mk_member(db, ws, "yumi", "cloud:openagents")
    campaign.on_agent_joined(str(ws.id), "cloud:openagents")
    _mk_member(db, ws, "gpt-cloud", "cloud:openai")
    campaign.on_agent_joined(str(ws.id), "cloud:openai")
    assert campaign.total_granted(db, user.id) == 5.0

    with patch.object(campaign, "SessionLocal", lambda: _NoCloseSession(db)):
        _mk_member(db, ws, "claude-1", "claude")
        campaign.on_agent_joined(str(ws.id), "claude")
        assert campaign.total_granted(db, user.id) == 25.0  # +first_agent

        # Same type again — no second_agent.
        _mk_member(db, ws, "claude-2", "claude")
        campaign.on_agent_joined(str(ws.id), "claude")
        assert campaign.total_granted(db, user.id) == 25.0

        # A different type unlocks second_agent.
        _mk_member(db, ws, "codex-1", "codex")
        campaign.on_agent_joined(str(ws.id), "codex")
        assert campaign.total_granted(db, user.id) == 35.0


def test_conversation_and_daily_milestones(db, campaign_on, gateway):
    user = _mk_user(db)
    ws = _mk_workspace(db, user)
    campaign.ensure_account(db, user)
    _mk_member(db, ws, "claude-1", "claude")
    _mk_member(db, ws, "codex-1", "codex")

    with patch.object(campaign, "SessionLocal", lambda: _NoCloseSession(db)):
        # Agent reply with NO prior human message → nothing (greeting spam guard).
        _mk_message(db, ws, "openagents:claude-1")
        campaign.on_agent_message(str(ws.id), "openagents:claude-1")
        assert campaign.total_granted(db, user.id) == 5.0

        # Human speaks, agent replies → first_conversation + daily.
        _mk_message(db, ws, "human:maya@example.com")
        campaign.on_agent_message(str(ws.id), "openagents:claude-1")
        milestones = {g.milestone for g in db.query(CampaignGrant).filter_by(user_id=user.id)}
        assert "first_conversation" in milestones
        assert any(m.startswith("daily:") for m in milestones)
        total_after = campaign.total_granted(db, user.id)  # 5 + 10 + 10

        # Same day again → no double daily.
        campaign.on_agent_message(str(ws.id), "openagents:claude-1")
        assert campaign.total_granted(db, user.id) == total_after

        # Second agent TYPE responds → second_agent_response.
        _mk_message(db, ws, "openagents:codex-1")
        campaign.on_agent_message(str(ws.id), "openagents:codex-1")
        milestones = {g.milestone for g in db.query(CampaignGrant).filter_by(user_id=user.id)}
        assert "second_agent_response" in milestones


def test_status_payload_shape(db, campaign_on, gateway):
    user = _mk_user(db)
    payload = campaign.status_payload(db, user)
    assert payload["enabled"] is True
    assert payload["apiKey"] == "sk-demo-test"
    assert payload["totalGrantedUsd"] == 5.0
    assert {m["key"] for m in payload["milestones"]} == set(campaign.MILESTONE_AMOUNTS)
    assert payload["daily"]["daysGranted"] == 0
    assert payload["usage"]["costLimitUsd"] == 5.0


def test_reconcile_heals_missed_hooks(db, campaign_on, gateway):
    """Agents that joined via WebSocket (or pre-launch) never fired the REST
    hooks — a status fetch must still grant everything the DB proves."""
    user = _mk_user(db)
    ws = _mk_workspace(db, user)
    campaign.ensure_account(db, user)

    # Members + messages exist, but NO hooks ever fired (the bug report).
    _mk_member(db, ws, "codexbot", "codex")
    _mk_member(db, ws, "claude2", "claude")
    _mk_message(db, ws, "human:raphael@example.com")
    _mk_message(db, ws, "openagents:codexbot")
    _mk_message(db, ws, "openagents:claude2")
    assert campaign.total_granted(db, user.id) == 5.0  # signup only

    campaign.reconcile(db, user.id)
    milestones = {g.milestone for g in db.query(CampaignGrant).filter_by(user_id=user.id)}
    assert {"first_agent", "second_agent", "first_conversation", "second_agent_response"} <= milestones
    # Messages carry timestamp=0 (not today) → no daily grant from reconcile.
    assert not any(m.startswith("daily:") for m in milestones)
    # 5 + 20 + 10 + 10 + 5
    assert campaign.total_granted(db, user.id) == 50.0

    # Idempotent: a second sweep changes nothing.
    campaign.reconcile(db, user.id)
    assert campaign.total_granted(db, user.id) == 50.0


def test_reconcile_grants_daily_for_todays_reply(db, campaign_on, gateway):
    import time as _time
    user = _mk_user(db)
    ws = _mk_workspace(db, user)
    campaign.ensure_account(db, user)
    _mk_member(db, ws, "codexbot", "codex")
    _mk_message(db, ws, "human:raphael@example.com")
    # An agent reply stamped NOW (today) → reconcile also grants the daily.
    db.add(EventRecord(
        id=str(uuid.uuid4()), network_id=str(ws.id),
        type="workspace.message.posted", source="openagents:codexbot",
        target="channel/x", payload={}, timestamp=int(_time.time() * 1000),
    ))
    db.commit()
    campaign.reconcile(db, user.id)
    milestones = {g.milestone for g in db.query(CampaignGrant).filter_by(user_id=user.id)}
    assert "first_conversation" in milestones
    assert any(m.startswith("daily:") for m in milestones)


def test_cloud_agents_never_count(db, campaign_on, gateway):
    """Cloud agents don't qualify for any milestone — joins, replies, or
    reconcile (confirmed 2026-08-23)."""
    user = _mk_user(db)
    ws = _mk_workspace(db, user)
    campaign.ensure_account(db, user)
    _mk_member(db, ws, "claude-cloud", "cloud:anthropic")
    _mk_member(db, ws, "gemini-cloud", "cloud:google")
    _mk_message(db, ws, "human:maya@example.com")
    _mk_message(db, ws, "openagents:claude-cloud")

    with patch.object(campaign, "SessionLocal", lambda: _NoCloseSession(db)):
        campaign.on_agent_joined(str(ws.id), "cloud:anthropic")
        campaign.on_agent_message(str(ws.id), "openagents:claude-cloud")
    campaign.reconcile(db, user.id)

    milestones = {g.milestone for g in db.query(CampaignGrant).filter_by(user_id=user.id)}
    assert milestones == {"signup"}


def test_pilot_bonus_does_not_consume_the_ladder_cap(db, campaign_on, gateway):
    """A $300 pilot row must not freeze the $100 onboarding ladder — the user
    is meant to end at $100 + $300 = $400 (regression: 2026-09-18)."""
    user = _mk_user(db)
    campaign.ensure_account(db, user)                                   # signup $5
    assert campaign.grant(db, user.id, "pilot", 300.0, ignore_cap=True) is True
    assert campaign.total_granted(db, user.id) == 305.0
    assert campaign.ladder_total(db, user.id) == 5.0
    # Ladder and daily grants still flow after the pilot bonus…
    assert campaign.grant(db, user.id, "first_agent", 20.0) is True
    assert campaign.grant(db, user.id, "daily:2026-09-17", 10.0) is True
    assert campaign.ladder_total(db, user.id) == 35.0
    # …and the cap still applies to the ladder on its own.
    assert campaign.grant(db, user.id, "huge", 70.0) is False           # 35 + 70 > 100
    assert campaign.grant(db, user.id, "fits", 65.0) is True            # 35 + 65 = 100
    assert campaign.grant(db, user.id, "daily:2026-09-18", 10.0) is False
    assert campaign.total_granted(db, user.id) == 400.0


def test_status_reports_ladder_and_pilot_separately(db, campaign_on, gateway):
    user = _mk_user(db)
    campaign.ensure_account(db, user)
    payload = campaign.status_payload(db, user)
    assert payload["totalGrantedUsd"] == 5.0 and payload["grandTotalUsd"] == 5.0
    assert payload["pilot"] is None
    assert campaign.grant(db, user.id, "pilot", 300.0, ignore_cap=True) is True
    payload = campaign.status_payload(db, user)
    assert payload["totalGrantedUsd"] == 5.0            # the checklist figure stays ladder-only
    assert payload["grandTotalUsd"] == 305.0
    assert payload["pilot"]["amountUsd"] == 300.0 and payload["pilot"]["grantedAt"]


# ---------------------------------------------------------------------------
# Anti-farming gates (2026-09-20 incident)
# ---------------------------------------------------------------------------

def test_unverified_email_gets_no_key_and_no_grants(db, campaign_on, gateway):
    user = _mk_user(db, "new@example.com", verified=False)
    assert campaign.ensure_account(db, user) is None
    assert campaign.grant(db, user.id, "first_agent", 20.0) is False
    assert db.query(CampaignGrant).filter_by(user_id=user.id).count() == 0
    payload = campaign.status_payload(db, user)
    assert payload["enabled"] is True and payload["requiresEmailVerification"] is True
    assert payload["apiKey"] is None and payload["email"] == "new@example.com"
    assert gateway == []  # nothing reached the gateway
    # Verification flips everything on, on the next status fetch.
    user.email_verified_at = datetime.now(timezone.utc)
    db.commit()
    payload = campaign.status_payload(db, user)
    assert "requiresEmailVerification" not in payload and payload["apiKey"] == "sk-demo-test"
    assert campaign.total_granted(db, user.id) == 5.0


def test_legacy_unverified_account_stops_earning(db, campaign_on, gateway):
    """An account minted before the gate keeps its key but earns nothing more
    until the address is verified."""
    user = _mk_user(db, "legacy@example.com", verified=False)
    db.add(CampaignAccount(user_id=user.id, gateway_key_id=7, api_key="sk-legacy"))
    db.add(CampaignGrant(user_id=user.id, milestone="signup", amount_usd=5.0))
    db.commit()
    assert campaign.grant(db, user.id, "first_agent", 20.0) is False
    payload = campaign.status_payload(db, user)
    assert payload["requiresEmailVerification"] is True and payload["apiKey"] == "sk-legacy"


@pytest.mark.parametrize("email", [
    "bot@000-webmail.myhome-server.de",   # the farm domain (blocklist)
    "bot@deep.sub.myhome-server.de",      # parent-domain match
    "bot@mailinator.com",                 # disposable pattern
    "bot@grr.la",
])
def test_blocked_domains_are_invisible_to_the_campaign(db, campaign_on, gateway, email):
    user = _mk_user(db, email)  # verified — still blocked
    assert campaign.email_blocked(email) is True
    assert campaign.ensure_account(db, user) is None
    assert campaign.grant(db, user.id, "first_agent", 20.0) is False
    assert campaign.status_payload(db, user) == {"enabled": False}
    assert gateway == []


@pytest.mark.parametrize("email", ["a@gmail.com", "b@qq.com", "c@163.com", "d@company.co.uk", "e@canada.com"])
def test_ordinary_domains_are_not_blocked(email):
    assert campaign.email_blocked(email) is False


def test_verified_claim_stamps_the_user(db):
    from app.access import get_or_create_user
    u = get_or_create_user(db, {"email": "g@example.com", "firebase_uid": "uid1", "email_verified": True})
    assert u.email_verified_at is not None
    stamped = u.email_verified_at
    # An unverified token later (e.g. the China session path) never un-verifies.
    u2 = get_or_create_user(db, {"email": "g@example.com", "email_verified": False})
    assert u2.id == u.id and u2.email_verified_at == stamped
    # Unverified first sign-in → no stamp; verified later → stamped then.
    v = get_or_create_user(db, {"email": "p@example.com", "firebase_uid": "uid2"})
    assert v.email_verified_at is None
    v = get_or_create_user(db, {"email": "p@example.com", "oa_email_verified": True, "email_verified": True})
    assert v.email_verified_at is not None


def test_unverified_user_is_synced_from_the_account_api(db, campaign_on, gateway, monkeypatch):
    """A session that predates the handoff claim: openagents.org says the
    address is confirmed → stamp and proceed; says no → still walled."""
    user = _mk_user(db, "old-session@example.com", verified=False)
    answers = {"email": "old-session@example.com", "email_verified": False}
    calls = []
    real_get = campaign.httpx.get

    def fake_get(url, params=None, headers=None, timeout=None):
        if url.endswith("/v1/me"):
            calls.append(headers.get("Authorization"))
            resp = MagicMock(); resp.status_code = 200; resp.json = lambda: {"data": dict(answers)}
            return resp
        return real_get(url, params=params, headers=headers, timeout=timeout)

    monkeypatch.setattr(campaign.httpx, "get", fake_get)
    assert campaign.sync_email_verification(db, user, "tok-1") is False
    assert user.email_verified_at is None and campaign.ineligible_reason(user) == "unverified"
    answers["email_verified"] = True
    assert campaign.sync_email_verification(db, user, "tok-1") is True
    assert user.email_verified_at is not None and campaign.ineligible_reason(user) is None
    assert calls == ["Bearer tok-1", "Bearer tok-1"]
    # A mismatched email never stamps (token for someone else).
    other = _mk_user(db, "someone-else@example.com", verified=False)
    assert campaign.sync_email_verification(db, other, "tok-2") is False
    assert other.email_verified_at is None
