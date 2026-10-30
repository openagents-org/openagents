# -*- coding: utf-8 -*-
"""Tests for mobile onboarding: the setup email endpoint and the 24h/72h
onboarding reminder sweep.

Email sends are stubbed at the service layer; identity verification is stubbed
via app.access.verify_identity_claims like the membership tests.
"""

from datetime import datetime, timedelta, timezone

import app.access as access
from app.models import Node, User, Workspace, WorkspaceMembership
from app.services import onboarding_reminders as reminders_mod
from app.services.onboarding_reminders import run_onboarding_reminders


def _claims(email, uid="uid", name="Test User"):
    return {"provider": "firebase", "email": email, "firebase_uid": uid,
            "apple_sub": None, "display_name": name}


def _stub_identity(monkeypatch, mapping):
    monkeypatch.setattr(access, "verify_identity_claims", lambda tok: mapping.get(tok))


def _auth(bearer):
    return {"Authorization": f"Bearer {bearer}"}


# ---------------------------------------------------------------------------
# POST /v1/workspaces/{id}/setup-email
# ---------------------------------------------------------------------------

class TestSetupEmail:
    def _mk_workspace(self, client, monkeypatch):
        _stub_identity(monkeypatch, {"al": _claims("al@x.com")})
        r = client.post("/v1/workspaces", json={"name": "WS"}, headers=_auth("al"))
        return r.json()["data"]

    def test_requires_identity(self, client, monkeypatch):
        ws = self._mk_workspace(client, monkeypatch)
        assert client.post(f"/v1/workspaces/{ws['workspaceId']}/setup-email").status_code == 401

    def test_requires_membership(self, client, monkeypatch):
        ws = self._mk_workspace(client, monkeypatch)
        _stub_identity(monkeypatch, {"al": _claims("al@x.com"),
                                     "ev": _claims("eve@x.com", uid="uid2")})
        r = client.post(f"/v1/workspaces/{ws['workspaceId']}/setup-email", headers=_auth("ev"))
        assert r.status_code == 403

    def test_unconfigured_email_reports_false_not_500(self, client, monkeypatch):
        ws = self._mk_workspace(client, monkeypatch)
        import app.routers.onboarding as onboarding_mod
        monkeypatch.setattr(onboarding_mod, "email_configured", lambda: False)
        r = client.post(f"/v1/workspaces/{ws['workspaceId']}/setup-email", headers=_auth("al"))
        assert r.status_code == 200
        assert r.json()["data"] == {"emailSent": False}

    def test_send_by_slug_and_daily_cap(self, client, monkeypatch):
        ws = self._mk_workspace(client, monkeypatch)
        import app.routers.onboarding as onboarding_mod
        sends = []
        monkeypatch.setattr(onboarding_mod, "email_configured", lambda: True)
        monkeypatch.setattr(
            onboarding_mod, "send_setup_email",
            lambda to, name, link: sends.append((to, name, link)) or True,
        )
        # Addressable by slug, not just UUID.
        for _ in range(3):
            r = client.post(f"/v1/workspaces/{ws['slug']}/setup-email", headers=_auth("al"))
            assert r.status_code == 200
            assert r.json()["data"] == {"emailSent": True}
        assert len(sends) == 3
        assert sends[0][0] == "al@x.com"
        assert sends[0][2].endswith(f"/{ws['slug']}")
        # Fourth send today → 429, and nothing else goes out.
        r = client.post(f"/v1/workspaces/{ws['slug']}/setup-email", headers=_auth("al"))
        assert r.status_code == 429
        assert len(sends) == 3


# ---------------------------------------------------------------------------
# run_onboarding_reminders — the 24h/72h sweep
# ---------------------------------------------------------------------------

def _mk_stalled_workspace(db, slug, hours_old, with_node=False, require_login=True):
    ws = Workspace(
        name=f"W-{slug}", slug=slug, require_login=require_login,
        created_at=datetime.now(timezone.utc) - timedelta(hours=hours_old),
    )
    db.add(ws); db.flush()
    u = User(email=f"owner-{slug}@x.com", firebase_uid=f"uid-{slug}")
    db.add(u); db.flush()
    db.add(WorkspaceMembership(workspace_id=ws.id, user_id=u.id, role="owner"))
    if with_node:
        db.add(Node(workspace_id=ws.id, node_key=f"key-{slug}"))
    db.commit()
    return ws


class TestOnboardingReminders:
    def _stub_sends(self, monkeypatch, result=True):
        sends = []
        monkeypatch.setattr(reminders_mod, "email_configured", lambda: True)
        monkeypatch.setattr(
            reminders_mod, "send_onboarding_reminder",
            lambda to, name, link, stage: sends.append((to, stage)) or result,
        )
        # The real cutoff is the feature's ship date — on/near that date every
        # >24h-old workspace is pre-cutoff, so back it off to test the rest.
        monkeypatch.setattr(
            reminders_mod, "ONBOARDING_REMINDER_CUTOFF",
            datetime.now(timezone.utc) - timedelta(days=10),
        )
        return sends

    def test_skips_entirely_when_email_unconfigured(self, db, monkeypatch):
        _mk_stalled_workspace(db, "r0", hours_old=30)
        monkeypatch.setattr(reminders_mod, "email_configured", lambda: False)
        assert run_onboarding_reminders(db) == 0

    def test_24h_then_72h_then_never_again(self, db, monkeypatch):
        sends = self._stub_sends(monkeypatch)
        ws = _mk_stalled_workspace(db, "r1", hours_old=30)

        assert run_onboarding_reminders(db) == 1
        assert sends == [("owner-r1@x.com", "24h")]
        db.refresh(ws)
        assert "onboard_reminder_24h" in (ws.settings or {})

        # Second sweep at the same age: 24h already sent, 72h not due → nothing.
        assert run_onboarding_reminders(db) == 0
        assert len(sends) == 1

        # Age the workspace past 72h → the second (and last) reminder.
        ws.created_at = datetime.now(timezone.utc) - timedelta(hours=80)
        db.commit()
        assert run_onboarding_reminders(db) == 1
        assert sends[-1] == ("owner-r1@x.com", "72h")
        db.refresh(ws)
        assert "onboard_reminder_72h" in (ws.settings or {})

        # No third reminder, ever.
        assert run_onboarding_reminders(db) == 0
        assert len(sends) == 2

    def test_skips_connected_young_and_precutoff_workspaces(self, db, monkeypatch):
        sends = self._stub_sends(monkeypatch)
        _mk_stalled_workspace(db, "r2", hours_old=30, with_node=True)  # has a node
        _mk_stalled_workspace(db, "r3", hours_old=2)                   # < 24h old
        # Created before the (patched) cutoff — must never be blasted.
        _mk_stalled_workspace(db, "r4", hours_old=11 * 24)
        assert run_onboarding_reminders(db) == 0
        assert sends == []
