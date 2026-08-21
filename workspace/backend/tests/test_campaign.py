# -*- coding: utf-8 -*-
"""API credits campaign — milestone engine tests with a mocked gateway."""

import uuid
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


def _mk_user(db, email="u@example.com"):
    user = User(id=str(uuid.uuid4()), email=email)
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

    # Yumi never counts.
    _mk_member(db, ws, "yumi", campaign.BUILTIN_AGENT_TYPE)
    campaign.on_agent_joined(str(ws.id), campaign.BUILTIN_AGENT_TYPE)
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
