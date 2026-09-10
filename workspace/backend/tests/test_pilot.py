# -*- coding: utf-8 -*-
"""Pilot User Program admin endpoints — eligibility + one-off grant."""

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.config import config
from app.models import CampaignAccount, CampaignGrant, EventRecord
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # sibling test module, tests/ is not a package
from test_campaign import campaign_on, gateway, _mk_member, _mk_user, _mk_workspace  # noqa: E402,F401 — fixtures

SECRET = "pilot-test-secret"
H = {"X-Admin-Secret": SECRET}


@pytest.fixture
def pilot_on(monkeypatch, campaign_on):  # noqa: F811
    monkeypatch.setattr(config, "PILOT_ADMIN_SECRET", SECRET)
    monkeypatch.setattr(config, "PILOT_GRANT_USD", 300.0)
    monkeypatch.setattr(config, "PILOT_MIN_ACTIVE_DAYS", 3)
    monkeypatch.setattr(config, "PILOT_WINDOW_DAYS", 30)


def _ms(days_ago: int, hour: int = 12) -> int:
    d = datetime.now(timezone.utc).replace(hour=hour, minute=0, second=0, microsecond=0) - timedelta(days=days_ago)
    return int(d.timestamp() * 1000)


def _msg(db, ws, source, ts_ms):
    db.add(EventRecord(id=str(uuid.uuid4()), network_id=str(ws.id), type="workspace.message.posted",
                       source=source, target="channel/x", payload={}, timestamp=ts_ms))
    db.commit()


def _conversation_days(db, ws, agent_name, days_ago_list):
    for d in days_ago_list:
        _msg(db, ws, "human:alice", _ms(d, 10))
        _msg(db, ws, f"openagents:{agent_name}", _ms(d, 11))


def test_secret_required(client, db, pilot_on):
    assert client.get("/v1/admin/pilot/eligibility?email=a@b.co").status_code == 401
    assert client.get("/v1/admin/pilot/eligibility?email=a@b.co", headers={"X-Admin-Secret": "nope"}).status_code == 401
    assert client.post("/v1/admin/pilot/grant", json={"email": "a@b.co"}).status_code == 401


def test_disabled_when_secret_unset(client, db, campaign_on, monkeypatch):  # noqa: F811
    monkeypatch.setattr(config, "PILOT_ADMIN_SECRET", "")
    assert client.get("/v1/admin/pilot/eligibility?email=a@b.co", headers=H).status_code == 404


def test_unknown_email(client, db, pilot_on):
    r = client.get("/v1/admin/pilot/eligibility?email=nobody@example.com", headers=H)
    assert r.status_code == 200 and r.json()["data"]["found"] is False


def test_eligible_then_grant_once(client, db, pilot_on, gateway):  # noqa: F811
    user = _mk_user(db, "pilot@example.com")
    ws = _mk_workspace(db, user)
    _mk_member(db, ws, "claude-1", "claude")
    _mk_member(db, ws, "yumi", "cloud:openagents")
    _conversation_days(db, ws, "claude-1", [0, 2, 5])          # 3 non-consecutive active days
    _msg(db, ws, "human:alice", _ms(9)); _msg(db, ws, "openagents:yumi", _ms(9))  # cloud reply: human-only day

    r = client.get("/v1/admin/pilot/eligibility?email=Pilot@Example.com", headers=H)  # case-insensitive
    d = r.json()["data"]
    assert d["found"] and d["agents"]["qualifyingTypes"] == ["claude"]
    assert d["activity"]["activeDayCount"] == 3
    assert [x["date"] for x in d["activity"]["humanOnlyDays"]] == [datetime.now(timezone.utc).date().__sub__(timedelta(days=9)).isoformat()]
    assert d["pilot"]["eligible"] is True and d["pilot"]["alreadyGranted"] is False

    r = client.post("/v1/admin/pilot/grant", json={"email": "pilot@example.com", "actor": "marketing"}, headers=H)
    assert r.status_code == 200, r.text
    body = r.json()["data"]
    assert body["status"] == "granted" and body["amountUsd"] == 300.0
    rows = db.query(CampaignGrant).filter_by(user_id=user.id, milestone="pilot").all()
    assert len(rows) == 1 and rows[0].amount_usd == 300.0
    # new_limit_usd is only ever filled from the gateway's /admin/credits response,
    # so its presence proves the credits call happened (fixture-shape agnostic).
    assert rows[0].new_limit_usd is not None

    # second click: clear already-granted state, no second ledger row
    r = client.post("/v1/admin/pilot/grant", json={"email": "pilot@example.com"}, headers=H)
    assert r.status_code == 200 and r.json()["data"]["status"] == "already_granted"
    assert db.query(CampaignGrant).filter_by(user_id=user.id, milestone="pilot").count() == 1
    assert r.json()["data"]["eligibility"]["pilot"]["alreadyGranted"] is True


def test_not_eligible_without_three_days_unless_forced(client, db, pilot_on, gateway):  # noqa: F811
    user = _mk_user(db, "two@example.com")
    ws = _mk_workspace(db, user)
    _mk_member(db, ws, "codex-1", "codex")
    _conversation_days(db, ws, "codex-1", [0, 1])
    r = client.post("/v1/admin/pilot/grant", json={"email": "two@example.com"}, headers=H)
    assert r.status_code == 400 and "2 active day" in r.json()["message"]
    assert db.query(CampaignGrant).filter_by(user_id=user.id, milestone="pilot").count() == 0
    r = client.post("/v1/admin/pilot/grant", json={"email": "two@example.com", "force": True}, headers=H)
    assert r.status_code == 200 and r.json()["data"]["status"] == "granted"


def test_no_agent_is_not_eligible(client, db, pilot_on, gateway):  # noqa: F811
    user = _mk_user(db, "cloudonly@example.com")
    ws = _mk_workspace(db, user)
    _mk_member(db, ws, "yumi", "cloud:openagents")
    for d in (0, 1, 2):
        _msg(db, ws, "human:alice", _ms(d)); _msg(db, ws, "openagents:yumi", _ms(d))
    d = client.get("/v1/admin/pilot/eligibility?email=cloudonly@example.com", headers=H).json()["data"]
    assert d["agents"]["connected"] is False and d["activity"]["activeDayCount"] == 0
    assert d["pilot"]["eligible"] is False and len(d["pilot"]["reasons"]) == 2


def test_grant_ignores_the_100_dollar_cap(client, db, pilot_on, gateway):  # noqa: F811
    user = _mk_user(db, "capped@example.com")
    ws = _mk_workspace(db, user)
    _mk_member(db, ws, "claude-1", "claude")
    _conversation_days(db, ws, "claude-1", [0, 1, 2])
    db.add(CampaignAccount(user_id=user.id, gateway_key_id=7, api_key="sk-x"))
    db.add(CampaignGrant(user_id=user.id, milestone="signup", amount_usd=100.0))  # ladder already maxed
    db.commit()
    r = client.post("/v1/admin/pilot/grant", json={"email": "capped@example.com"}, headers=H)
    assert r.status_code == 200 and r.json()["data"]["status"] == "granted"
