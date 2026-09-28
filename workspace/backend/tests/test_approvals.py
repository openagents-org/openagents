# -*- coding: utf-8 -*-
"""
Tests for approvals (/v1/approvals, /v1/approval-policy).

Covers: policy verdicts at creation (pause / allow / block), the thread and
inbox side effects, who may resolve (role vs required_role, token on legacy vs
enforced-login workspaces), the resolution message that reaches the agent,
Kanban parking, and policy overrides per workspace / channel.
"""

import app.access as access
import pytest
from app.models import (
    ApprovalRequest,
    EventRecord,
    KanbanTask,
    NotificationRecord,
    User,
    Workspace,
    WorkspaceMembership,
)
from sqlalchemy import select

# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def no_push(monkeypatch):
    import app.services.notify as notify_mod
    monkeypatch.setattr(notify_mod, "_dispatch", lambda snapshot: None)


def _claims(email, name=None):
    return {"provider": "firebase", "email": email, "firebase_uid": email,
            "apple_sub": None, "display_name": name or email.split("@")[0]}


@pytest.fixture
def people(db, workspace, monkeypatch):
    """Three signed-in humans with roles, addressable as `Bearer <name>`."""
    mapping = {}
    roles = {"olivia": "owner", "adam": "admin", "mia": "member", "vic": "viewer"}
    for name, role in roles.items():
        email = f"{name}@acme.test"
        user = User(email=email, display_name=name.capitalize())
        db.add(user)
        db.flush()
        db.add(WorkspaceMembership(workspace_id=workspace["id"], user_id=user.id, role=role))
        mapping[name] = _claims(email, name.capitalize())
    db.commit()
    monkeypatch.setattr(access, "verify_identity_claims", lambda tok: mapping.get(tok))
    return roles


def _tok(workspace):
    return {"X-Workspace-Token": workspace["token"]}


def _chan(workspace):
    """The seeded channel's name (the fixture hands back the full record)."""
    ch = workspace["channel"]
    return ch["name"] if isinstance(ch, dict) else ch


def _bearer(name):
    return {"Authorization": f"Bearer {name}"}


def _request(client, workspace, **overrides):
    body = {
        "network": workspace["id"],
        "channel": _chan(workspace),
        "kind": "external_send",
        "action": "Send incident note to 38 customers",
        "details": "sendgrid: template incident-4471",
        "risk": "medium",
        "source": "openagents:agent-alpha",
    }
    body.update(overrides)
    return client.post("/v1/approvals", json=body, headers=_tok(workspace))


def _channel_events(db, workspace, channel=None):
    target = f"channel/{channel or _chan(workspace)}"
    return db.execute(
        select(EventRecord).where(
            EventRecord.network_id == workspace["id"],
            EventRecord.target == target,
            EventRecord.type == "workspace.message.posted",
        ).order_by(EventRecord.timestamp.asc())
    ).scalars().all()


def _set_require_login(db, workspace, value):
    ws = db.execute(select(Workspace).where(Workspace.id == workspace["id"])).scalar_one()
    ws.require_login = value
    db.commit()


# ---------------------------------------------------------------------------
# Creation + policy verdicts
# ---------------------------------------------------------------------------

class TestCreate:
    def test_pauses_for_any_member_by_default(self, client, workspace, db):
        resp = _request(client, workspace)
        assert resp.status_code == 200, resp.text
        a = resp.json()["data"]
        assert a["status"] == "pending"
        assert a["required_role"] == "any"
        assert a["requested_by"] == "agent-alpha"
        assert a["kind"] == "external_send"

        # Posted into the thread as an `approval` message carrying the record.
        approval_events = [e for e in _channel_events(db, workspace)
                           if (e.payload or {}).get("message_type") == "approval"]
        assert len(approval_events) == 1
        evt = approval_events[0]
        assert evt.source == "openagents:agent-alpha"
        assert evt.payload["approval"]["id"] == a["id"]
        assert "Approval requested" in evt.payload["content"]
        assert a["request_event_id"] == evt.id
        # Addressed to people: routing must not have targeted any agent.
        assert not (evt.metadata_ or {}).get("target_agents")

        # Filed in the inbox, high priority.
        notes = db.execute(select(NotificationRecord).where(
            NotificationRecord.workspace_id == workspace["id"])).scalars().all()
        assert any("Approval requested" in n.title and n.priority == "high" for n in notes)

    def test_deploy_needs_admin(self, client, workspace):
        a = _request(client, workspace, kind="deploy", action="db:migrate --env prod-eu").json()["data"]
        assert a["status"] == "pending"
        assert a["required_role"] == "admin"

    def test_spend_needs_owner(self, client, workspace):
        a = _request(client, workspace, kind="spend", action="Buy 10k Apollo credits").json()["data"]
        assert a["required_role"] == "owner"

    def test_allowed_kind_auto_approves(self, client, workspace, db):
        a = _request(client, workspace, kind="repo_read", action="Clone acme/billing").json()["data"]
        assert a["status"] == "approved"
        assert a["resolved_by"] == "policy"
        # Still visible in the thread (audit), but nobody is paged.
        assert any((e.payload or {}).get("message_type") == "approval" for e in _channel_events(db, workspace))
        notes = db.execute(select(NotificationRecord).where(
            NotificationRecord.workspace_id == workspace["id"])).scalars().all()
        assert not any("Approval requested" in n.title for n in notes)

    def test_blocked_kind_auto_rejects(self, client, workspace):
        a = _request(client, workspace, kind="data_delete", action="DROP TABLE customers").json()["data"]
        assert a["status"] == "rejected"
        assert a["resolved_by"] == "policy"
        assert "policy" in (a["note"] or "").lower()

    def test_unknown_kind_falls_back_to_other(self, client, workspace):
        a = _request(client, workspace, kind="teleport").json()["data"]
        assert a["kind"] == "other"
        assert a["status"] == "pending"

    def test_requires_action_and_channel(self, client, workspace):
        assert _request(client, workspace, action="  ").json()["code"] != 0
        assert _request(client, workspace, channel="").json()["code"] != 0

    def test_requires_credentials(self, client, workspace):
        resp = client.post("/v1/approvals", json={
            "network": workspace["id"], "channel": _chan(workspace), "action": "x",
        })
        assert resp.json()["code"] != 0


# ---------------------------------------------------------------------------
# Resolution — who may decide
# ---------------------------------------------------------------------------

class TestResolve:
    def test_member_approves_any(self, client, workspace, db, people):
        a = _request(client, workspace).json()["data"]
        resp = client.post(f"/v1/approvals/{a['id']}/approve",
                           json={"network": workspace["id"], "note": "Wording is fine."},
                           headers=_bearer("mia"))
        assert resp.status_code == 200, resp.text
        out = resp.json()["data"]
        assert out["status"] == "approved"
        assert out["resolved_by"] == "mia@acme.test"
        assert out["resolved_by_role"] == "member"
        assert out["note"] == "Wording is fine."

        # The decision reaches the agent as a normal human message, targeted.
        events = _channel_events(db, workspace)
        res = [e for e in events if e.id == out["resolution_event_id"]]
        assert len(res) == 1
        evt = res[0]
        assert evt.source == "human:mia@acme.test"
        assert evt.payload["message_type"] == "chat"
        assert evt.payload["content"].startswith("@agent-alpha ✅ Approved")
        assert "Wording is fine." in evt.payload["content"]
        assert "agent-alpha" in (evt.metadata_ or {}).get("target_agents", [])
        assert evt.payload["approval"]["status"] == "approved"

    def test_member_rejects(self, client, workspace, db, people):
        a = _request(client, workspace).json()["data"]
        resp = client.post(f"/v1/approvals/{a['id']}/reject",
                           json={"network": workspace["id"]}, headers=_bearer("mia"))
        assert resp.json()["data"]["status"] == "rejected"
        evt = [e for e in _channel_events(db, workspace) if e.id == resp.json()["data"]["resolution_event_id"]][0]
        assert "❌ Rejected" in evt.payload["content"]

    def test_viewer_cannot_resolve(self, client, workspace, people):
        a = _request(client, workspace).json()["data"]
        resp = client.post(f"/v1/approvals/{a['id']}/approve",
                           json={"network": workspace["id"]}, headers=_bearer("vic"))
        assert resp.json()["code"] != 0
        assert "requires" in resp.json()["message"]

    def test_deploy_rejects_member_accepts_admin(self, client, workspace, people):
        a = _request(client, workspace, kind="deploy", action="Deploy 2.4 hotfix").json()["data"]
        denied = client.post(f"/v1/approvals/{a['id']}/approve",
                             json={"network": workspace["id"]}, headers=_bearer("mia"))
        assert denied.json()["code"] != 0
        ok = client.post(f"/v1/approvals/{a['id']}/approve",
                         json={"network": workspace["id"]}, headers=_bearer("adam"))
        assert ok.json()["data"]["status"] == "approved"
        assert ok.json()["data"]["resolved_by_role"] == "admin"

    def test_spend_needs_owner_not_admin(self, client, workspace, people):
        a = _request(client, workspace, kind="spend", action="Pay $120 for data").json()["data"]
        assert client.post(f"/v1/approvals/{a['id']}/approve",
                           json={"network": workspace["id"]}, headers=_bearer("adam")).json()["code"] != 0
        assert client.post(f"/v1/approvals/{a['id']}/approve",
                           json={"network": workspace["id"]}, headers=_bearer("olivia")).json()["data"]["status"] == "approved"

    def test_token_cannot_resolve_on_enforced_login_workspace(self, client, workspace, db):
        _set_require_login(db, workspace, True)
        a = _request(client, workspace).json()["data"]
        resp = client.post(f"/v1/approvals/{a['id']}/approve",
                           json={"network": workspace["id"]}, headers=_tok(workspace))
        assert resp.json()["code"] != 0
        assert "Sign in" in resp.json()["message"]

    def test_token_resolves_on_legacy_open_workspace(self, client, workspace, db):
        _set_require_login(db, workspace, False)
        a = _request(client, workspace, kind="deploy", action="Deploy").json()["data"]
        resp = client.post(f"/v1/approvals/{a['id']}/approve",
                           json={"network": workspace["id"]}, headers=_tok(workspace))
        assert resp.status_code == 200, resp.text
        assert resp.json()["data"]["status"] == "approved"
        assert resp.json()["data"]["resolved_by"] == "token"

    def test_cannot_resolve_twice(self, client, workspace, people):
        a = _request(client, workspace).json()["data"]
        client.post(f"/v1/approvals/{a['id']}/approve", json={"network": workspace["id"]}, headers=_bearer("mia"))
        again = client.post(f"/v1/approvals/{a['id']}/reject", json={"network": workspace["id"]}, headers=_bearer("mia"))
        assert again.json()["code"] != 0
        assert "already approved" in again.json()["message"]

    def test_unknown_id(self, client, workspace, people):
        resp = client.post("/v1/approvals/nope/approve", json={"network": workspace["id"]}, headers=_bearer("mia"))
        assert resp.json()["code"] != 0


# ---------------------------------------------------------------------------
# Listing
# ---------------------------------------------------------------------------

class TestList:
    def test_filters_and_pending_by_agent(self, client, workspace):
        _request(client, workspace)
        _request(client, workspace, source="openagents:agent-beta", kind="deploy", action="Deploy")
        _request(client, workspace, kind="repo_read", action="Clone")  # auto-approved
        resp = client.get(f"/v1/approvals?network={workspace['id']}&status=pending", headers=_tok(workspace))
        data = resp.json()["data"]
        assert {a["requested_by"] for a in data["approvals"]} == {"agent-alpha", "agent-beta"}
        assert data["pending_by_agent"] == {"agent-alpha": 1, "agent-beta": 1}
        everything = client.get(f"/v1/approvals?network={workspace['id']}", headers=_tok(workspace)).json()["data"]
        assert len(everything["approvals"]) == 3

    def test_get_one(self, client, workspace):
        a = _request(client, workspace).json()["data"]
        resp = client.get(f"/v1/approvals/{a['id']}?network={workspace['id']}", headers=_tok(workspace))
        assert resp.json()["data"]["id"] == a["id"]


# ---------------------------------------------------------------------------
# Kanban parking
# ---------------------------------------------------------------------------

class TestKanban:
    def test_request_parks_card_and_resolution_resumes(self, client, workspace, db, people):
        task = client.post("/v1/tasks", json={"network": workspace["id"], "title": "Ship hotfix"},
                           headers=_tok(workspace)).json()["data"]
        client.post(f"/v1/tasks/{task['id']}/assign",
                    json={"network": workspace["id"], "agent": "agent-alpha"}, headers=_tok(workspace))
        channel = f"task:{task['id']}"

        a = _request(client, workspace, channel=channel, kind="deploy", action="Deploy hotfix").json()["data"]
        row = db.execute(select(KanbanTask).where(KanbanTask.id == task["id"])).scalar_one()
        db.refresh(row)
        assert row.status == "need_input"

        client.post(f"/v1/approvals/{a['id']}/approve", json={"network": workspace["id"]}, headers=_bearer("adam"))
        db.refresh(row)
        assert row.status == "in_progress"

    def test_pending_gate_outranks_classifier_and_chatter(self, client, workspace, db, people, monkeypatch):
        import app.mods.workspace_mod as wm
        monkeypatch.setattr(wm, "_classify_task_progress", lambda *a, **k: "in_progress")
        task = client.post("/v1/tasks", json={"network": workspace["id"], "title": "Email customers"},
                           headers=_tok(workspace)).json()["data"]
        client.post(f"/v1/tasks/{task['id']}/assign",
                    json={"network": workspace["id"], "agent": "agent-alpha"}, headers=_tok(workspace))
        channel = f"task:{task['id']}"
        a = _request(client, workspace, channel=channel, kind="external_send", action="Send 38 emails").json()["data"]

        # Drive the pipeline directly (same path the REST layer uses) — the
        # /v1/events router's background fan-out needs a real Postgres.
        from app.routers.network import _emit_event_blocking

        from openagents.core.onm_events import Event
        ws = db.execute(select(Workspace).where(Workspace.id == workspace["id"])).scalar_one()

        def post(source, text):
            evt = Event(type="workspace.message.posted", source=source, target=f"channel/{channel}",
                        payload={"content": text, "message_type": "chat"}, metadata={})
            _emit_event_blocking(evt, ws, db, token=workspace["token"])

        # The agent narrates what it did → classifier says in_progress → card must stay parked.
        post("openagents:agent-alpha", "Approval requested, waiting for a decision.")
        row = db.execute(select(KanbanTask).where(KanbanTask.id == task["id"])).scalar_one()
        db.refresh(row)
        assert row.status == "need_input"
        # A human comment that is not the decision → still parked.
        post("human:user", "Looks reasonable, let me read the draft first.")
        db.refresh(row)
        assert row.status == "need_input"
        # The decision unparks it.
        client.post(f"/v1/approvals/{a['id']}/approve", json={"network": workspace["id"]}, headers=_bearer("mia"))
        db.refresh(row)
        assert row.status == "in_progress"

    def test_auto_allowed_request_does_not_park(self, client, workspace, db):
        task = client.post("/v1/tasks", json={"network": workspace["id"], "title": "Read the repo"},
                           headers=_tok(workspace)).json()["data"]
        client.post(f"/v1/tasks/{task['id']}/assign",
                    json={"network": workspace["id"], "agent": "agent-alpha"}, headers=_tok(workspace))
        _request(client, workspace, channel=f"task:{task['id']}", kind="repo_read", action="Clone")
        row = db.execute(select(KanbanTask).where(KanbanTask.id == task["id"])).scalar_one()
        db.refresh(row)
        assert row.status == "in_progress"


# ---------------------------------------------------------------------------
# Policy
# ---------------------------------------------------------------------------

class TestPolicy:
    def test_defaults(self, client, workspace):
        resp = client.get(f"/v1/approval-policy?network={workspace['id']}", headers=_tok(workspace))
        data = resp.json()["data"]
        by_kind = {r["kind"]: r for r in data["rules"]}
        assert by_kind["deploy"]["policy"] == "admin" and by_kind["deploy"]["source"] == "default"
        assert by_kind["data_delete"]["policy"] == "block"
        assert data["scope"] == "*"
        assert "allow" in data["policies"]

    def test_workspace_override_changes_verdict(self, client, workspace):
        put = client.put("/v1/approval-policy", json={
            "network": workspace["id"],
            "rules": [{"kind": "repo_write", "policy": "admin"}, {"kind": "data_delete", "policy": "owner"}],
        }, headers=_tok(workspace))
        assert put.status_code == 200, put.text
        by_kind = {r["kind"]: r for r in put.json()["data"]["rules"]}
        assert by_kind["repo_write"]["policy"] == "admin" and by_kind["repo_write"]["source"] == "workspace"
        assert by_kind["data_delete"]["policy"] == "owner"

        a = _request(client, workspace, kind="repo_write", action="Open PR #12").json()["data"]
        assert a["status"] == "pending" and a["required_role"] == "admin"
        b = _request(client, workspace, kind="data_delete", action="Purge staging").json()["data"]
        assert b["status"] == "pending" and b["required_role"] == "owner"

    def test_channel_override_beats_workspace(self, client, workspace):
        client.put("/v1/approval-policy", json={
            "network": workspace["id"], "rules": [{"kind": "deploy", "policy": "owner"}],
        }, headers=_tok(workspace))
        client.put("/v1/approval-policy", json={
            "network": workspace["id"], "channel": "sandbox",
            "rules": [{"kind": "deploy", "policy": "allow"}],
        }, headers=_tok(workspace))

        main = _request(client, workspace, kind="deploy", action="Deploy").json()["data"]
        assert main["status"] == "pending" and main["required_role"] == "owner"
        sandbox = _request(client, workspace, channel="sandbox", kind="deploy", action="Deploy").json()["data"]
        assert sandbox["status"] == "approved" and sandbox["resolved_by"] == "policy"

        view = client.get(f"/v1/approval-policy?network={workspace['id']}&channel=sandbox",
                          headers=_tok(workspace)).json()["data"]
        by_kind = {r["kind"]: r for r in view["rules"]}
        assert by_kind["deploy"]["source"] == "channel"
        assert view["channel_rules"] == [{"kind": "deploy", "policy": "allow"}]

    def test_invalid_policy_rejected(self, client, workspace):
        resp = client.put("/v1/approval-policy", json={
            "network": workspace["id"], "rules": [{"kind": "deploy", "policy": "maybe"}],
        }, headers=_tok(workspace))
        assert resp.json()["code"] != 0

    def test_member_cannot_edit_policy(self, client, workspace, people):
        resp = client.put("/v1/approval-policy", json={
            "network": workspace["id"], "rules": [{"kind": "deploy", "policy": "allow"}],
        }, headers=_bearer("mia"))
        assert resp.json()["code"] != 0
        ok = client.put("/v1/approval-policy", json={
            "network": workspace["id"], "rules": [{"kind": "deploy", "policy": "allow"}],
        }, headers=_bearer("adam"))
        assert ok.status_code == 200, ok.text
        assert ok.json()["data"]["saved"] == [{"kind": "deploy", "policy": "allow"}]

    def test_records_survive_in_table(self, client, workspace, db):
        _request(client, workspace)
        rows = db.execute(select(ApprovalRequest).where(ApprovalRequest.workspace_id == workspace["id"])).scalars().all()
        assert len(rows) == 1 and rows[0].status == "pending"
