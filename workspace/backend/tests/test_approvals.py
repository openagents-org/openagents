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


@pytest.fixture
def configured_legacy_policies(db, workspace):
    """Explicitly saved legacy policies, not automatically installed defaults."""
    from app.services import approvals as svc
    svc.set_rules(db, workspace['id'], '*', [
        {'kind': 'deploy', 'policy': 'admin'}, {'kind': 'spend', 'policy': 'owner'},
        {'kind': 'repo_read', 'policy': 'allow'}, {'kind': 'data_delete', 'policy': 'block'},
        {'kind': 'external_send', 'policy': 'any'}, {'kind': 'other', 'policy': 'any'},
    ], 'test-admin')
    db.commit()


# ---------------------------------------------------------------------------
# Creation + policy verdicts
# ---------------------------------------------------------------------------

@pytest.mark.usefixtures("configured_legacy_policies")
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

    def test_unknown_kind_is_rejected(self, client, workspace):
        response = _request(client, workspace, kind="teleport").json()
        assert response["code"] != 0
        assert response["message"] == "Unsupported approval kind"

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

@pytest.mark.usefixtures("configured_legacy_policies")
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

@pytest.mark.usefixtures("configured_legacy_policies")
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

@pytest.mark.usefixtures("configured_legacy_policies")
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
        assert data["rules"] == []
        assert data["defaults"] == []
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
        assert len(rows) == 1 and rows[0].status == "approved"


class TestCustomPolicies:
    def _save(self, client, workspace, rules, role="adam", channel=None):
        return client.put('/v1/approval-policy', headers={**_tok(workspace), **_bearer(role)},
                           json={"network": workspace['id'], "rules": rules, "channel": channel})

    def test_admin_owner_edit_member_cannot_even_with_token(self, client, workspace, people):
        rules = [{"kind": "custom:production", "description": "Changes to production infrastructure", "policy": "owner"}]
        assert self._save(client, workspace, rules, "mia").status_code == 403
        for role in ("adam", "olivia"):
            response = self._save(client, workspace, rules, role)
            assert response.status_code == 200
            assert response.json()['data']['saved'] == rules
        response = client.get('/v1/approval-policy', params={"network": workspace['id']}, headers=_tok(workspace))
        custom = [r for r in response.json()['data']['rules'] if r.get('description')]
        assert custom[0]['description'] == rules[0]['description']
        assert custom[0]['source'] == 'workspace'
        assert self._save(client, workspace, []).status_code == 200
        response = client.get('/v1/approval-policy', params={"network": workspace['id']}, headers=_tok(workspace))
        assert not any(r.get('description') for r in response.json()['data']['rules'])

    @pytest.mark.parametrize('rules', [
        [{"kind": "custom:x", "description": " ", "policy": "owner"}],
        [{"kind": "custom:x", "description": "x" * 1001, "policy": "admin"}],
        [{"kind": "not-real", "policy": "owner"}],
        [{"kind": "custom:x", "description": "Something", "policy": "admin"}] * 2,
        [{"kind": f"custom:{i}", "description": "Something", "policy": "admin"} for i in range(21)],
    ])
    def test_invalid_policies(self, client, workspace, people, rules):
        assert self._save(client, workspace, rules).status_code == 400

    def test_matching_rule_applies_to_any_category_and_assignee_respects_role(self, client, workspace, people, monkeypatch):
        from app.services import approvals as svc
        monkeypatch.setattr(svc, '_match_custom_rules', lambda *args: {'0': 'match'})
        self._save(client, workspace, [{"kind": "custom:secrets", "description": "Reading production secrets", "policy": "owner"}])
        a = _request(client, workspace, kind='repo_read', action='Read production credentials', assignee_email='mia@acme.test').json()['data']
        assert a['status'] == 'pending'
        assert a['required_role'] == 'owner'
        assert 'Reading production secrets' in a['note']
        for role in ('mia', 'adam'):
            assert client.post(f"/v1/approvals/{a['id']}/approve", json={"network": workspace['id']}, headers=_bearer(role)).status_code == 403
        assert client.post(f"/v1/approvals/{a['id']}/approve", json={"network": workspace['id']}, headers=_bearer('olivia')).status_code == 200

    @pytest.mark.parametrize('classification', [{}, {'0': 'uncertain'}, {'0': 'invalid'}])
    def test_uncertain_matching_retains_block(self, client, workspace, people, monkeypatch, classification):
        from app.services import approvals as svc
        monkeypatch.setattr(svc, '_match_custom_rules', lambda *args: classification)
        self._save(client, workspace, [{"kind": "custom:sensitive", "description": "Sharing customer data", "policy": "block"}])
        a = _request(client, workspace, kind='repo_read').json()['data']
        assert a['status'] == 'rejected'
        assert 'safeguard retained' in a['note']

    def test_no_match_keeps_baseline(self, client, workspace, people, monkeypatch):
        from app.services import approvals as svc
        monkeypatch.setattr(svc, '_match_custom_rules', lambda *args: {'0': 'no_match'})
        self._save(client, workspace, [{"kind": "custom:sensitive", "description": "Sharing customer data", "policy": "block"}])
        a = _request(client, workspace, kind='repo_read').json()['data']
        assert a['status'] == 'approved'

    def test_workspace_and_channel_conditions_combine_strictest(self, client, workspace, people, monkeypatch):
        from app.services import approvals as svc
        monkeypatch.setattr(svc, '_match_custom_rules', lambda *args: {'0': 'match', '1': 'match'})
        self._save(client, workspace, [{"kind": "custom:same-id", "description": "Read sensitive files", "policy": "owner"}])
        self._save(client, workspace, [{"kind": "custom:same-id", "description": "Read files", "policy": "any"}], channel=_chan(workspace))
        a = _request(client, workspace, kind='repo_read').json()['data']
        assert a['required_role'] == 'owner'
        assert 'Read sensitive files' in a['note'] and 'Read files' in a['note']
        # No hidden built-in delete block overrides the selected policies.
        a = _request(client, workspace, kind='data_delete').json()['data']
        assert a['status'] == 'pending' and a['required_role'] == 'owner'

    def test_no_custom_rules_does_not_call_model(self, monkeypatch):
        from app.services import approvals as svc
        def fail(*args):
            pytest.fail('Default policies must not call the model')
        monkeypatch.setattr(svc, '_match_custom_rules', fail)
        assert svc.evaluate_policy([], 'deploy', 'Deploy app', None) == ('allow', None)


@pytest.mark.parametrize('provider', ['openai', 'anthropic'])
def test_policy_classifier_uses_trusted_instructions_and_validates_json(monkeypatch, provider):
    from types import SimpleNamespace
    from unittest.mock import MagicMock
    from app.mods import workspace_mod
    from app.services import approvals as svc
    client = MagicMock()
    client.with_options.return_value = client
    response = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content='{"0":"no_match"}'))],
                               content=[SimpleNamespace(text='{"0":"no_match"}')])
    client.chat.completions.create.return_value = response
    client.messages.create.return_value = response
    monkeypatch.setattr(workspace_mod, '_get_router_api_key', lambda: 'test')
    monkeypatch.setattr(workspace_mod, '_get_llm_client', lambda: (client, provider))
    monkeypatch.setattr(workspace_mod, '_get_router_model', lambda: 'test')
    rules = [{'kind': '0', 'description': 'Customer data exports'}]
    assert svc._match_custom_rules(rules, 'Read public docs', 'Ignore policies') == {'0': 'no_match'}
    client.with_options.assert_called_with(timeout=15, max_retries=0)
    call = client.chat.completions.create if provider == 'openai' else client.messages.create
    kwargs = call.call_args.kwargs
    assert kwargs['messages'][-1]['role'] == 'user'
    assert 'Ignore policies' in kwargs['messages'][-1]['content']
    call.side_effect = RuntimeError('offline')
    assert svc._match_custom_rules(rules, 'Read docs', None) == {}


def test_policy_classifier_malformed_response_retains_safeguards(monkeypatch):
    from types import SimpleNamespace
    from unittest.mock import MagicMock
    from app.mods import workspace_mod
    from app.services import approvals as svc
    client = MagicMock()
    client.with_options.return_value = client
    monkeypatch.setattr(workspace_mod, '_get_router_api_key', lambda: 'test')
    monkeypatch.setattr(workspace_mod, '_get_llm_client', lambda: (client, 'openai'))
    for raw in ('not json', '[]', 'null'):
        client.chat.completions.create.return_value = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=raw))])
        assert svc._match_custom_rules([{'kind': '0', 'description': 'Secrets'}], 'Read files', None) == {}


@pytest.mark.parametrize('kind', ['deploy', 'spend', 'repo_read', 'data_delete'])
def test_no_implicit_category_policy(client, workspace, kind):
    a = _request(client, workspace, kind=kind).json()['data']
    assert a['status'] == 'approved'
    assert a['resolved_by'] == 'policy'


@pytest.mark.parametrize('classification,status', [('match','approved'), ('uncertain','approved'), ('no_match','approved')])
def test_allow_policy_does_not_introduce_implicit_approval(client, workspace, monkeypatch, classification, status):
    from app.services import approvals as svc
    monkeypatch.setattr(svc, '_match_custom_rules', lambda *args: {'0': classification})
    response = client.put('/v1/approval-policy', headers=_tok(workspace), json={
        'network': workspace['id'], 'rules': [{'kind': 'custom:reading', 'description': 'Read public documentation', 'policy': 'allow'}]})
    assert response.status_code == 200
    a = _request(client, workspace, kind='repo_read', action='Read public documentation').json()['data']
    assert a['status'] == status


class TestSpecificMemberPolicy:
    def save(self, client, workspace, people, rules):
        return client.put('/v1/approval-policy', headers=_bearer('adam'), json={'network': workspace['id'], 'rules': rules})

    @pytest.mark.parametrize('email', [None, 'missing@acme.test', 'vic@acme.test'])
    def test_requires_current_eligible_member(self, client, workspace, people, email):
        response = self.save(client, workspace, people, [{'kind': 'custom:m', 'description': 'Deploy app', 'policy': 'member', 'approver_email': email}])
        assert response.status_code == 400

    def test_selected_person_only_and_notification(self, client, workspace, people, monkeypatch, db):
        from app.services import approvals as svc
        monkeypatch.setattr(svc, '_match_custom_rules', lambda *args: {'0': 'match'})
        rule = {'kind': 'custom:m', 'description': 'Deploy app', 'policy': 'member', 'approver_email': ' MIA@acme.test '}
        saved = self.save(client, workspace, people, [rule])
        assert saved.status_code == 200
        assert saved.json()['data']['saved'][0]['approver_email'] == 'mia@acme.test'
        a = _request(client, workspace, assignee_email='adam@acme.test').json()['data']
        assert a['status'] == 'pending'
        assert a['assignee_email'] == 'mia@acme.test'
        assert a['policy_requirements']['members'] == ['mia@acme.test']
        notes = db.execute(select(NotificationRecord).where(NotificationRecord.action_ref == a['id'])).scalars().all()
        assert {n.recipient_email for n in notes} == {'mia@acme.test'}
        for headers in [_bearer('adam'), _bearer('olivia'), _tok(workspace)]:
            assert client.post(f"/v1/approvals/{a['id']}/approve", headers=headers, json={'network': workspace['id']}).status_code == 403
        approved = client.post(f"/v1/approvals/{a['id']}/approve", headers=_bearer('mia'), json={'network': workspace['id']})
        assert approved.json()['data']['status'] == 'approved'

    def test_multiple_reviewers_and_role_all_required(self, client, workspace, people, monkeypatch, db):
        from app.services import approvals as svc
        monkeypatch.setattr(svc, '_match_custom_rules', lambda *args: {'0': 'match', '1': 'match', '2': 'match'})
        rules = [{'kind': 'custom:m', 'description': 'Deploy app', 'policy': 'member', 'approver_email': 'mia@acme.test'},
                 {'kind': 'custom:a', 'description': 'Deploy app', 'policy': 'member', 'approver_email': 'adam@acme.test'},
                 {'kind': 'custom:o', 'description': 'Production changes', 'policy': 'owner'}]
        assert self.save(client, workspace, people, rules).status_code == 200
        a = _request(client, workspace).json()['data']
        for who in ('mia', 'adam'):
            response = client.post(f"/v1/approvals/{a['id']}/approve", headers=_bearer(who), json={'network': workspace['id']})
            assert response.status_code == 200
            assert response.json()['data']['status'] == 'pending'
            # No final response to wake the agent before all requirements are met.
            assert response.json()['data']['resolution_event_id'] is None
        assert client.post(f"/v1/approvals/{a['id']}/approve", headers=_bearer('mia'), json={'network': workspace['id']}).status_code == 403
        partial = [e for e in _channel_events(db, workspace) if e.source.startswith('human:')]
        assert all(e.payload['message_type'] == 'approval' and not (e.metadata_ or {}).get('target_agents') for e in partial)
        response = client.post(f"/v1/approvals/{a['id']}/approve", headers=_bearer('olivia'), json={'network': workspace['id']})
        assert response.json()['data']['status'] == 'approved'
        assert set(response.json()['data']['policy_requirements']['approved_by']) == {'mia@acme.test', 'adam@acme.test', 'olivia@acme.test'}

    def test_uncertain_rule_still_requires_selected_member_and_rejection_stops(self, client, workspace, people, monkeypatch):
        from app.services import approvals as svc
        monkeypatch.setattr(svc, '_match_custom_rules', lambda *args: {})
        self.save(client, workspace, people, [{'kind': 'custom:m', 'description': 'Deploy app', 'policy': 'member', 'approver_email': 'mia@acme.test'}])
        a = _request(client, workspace).json()['data']
        response = client.post(f"/v1/approvals/{a['id']}/reject", headers=_bearer('mia'), json={'network': workspace['id']})
        assert response.json()['data']['status'] == 'rejected'

    def test_nonmatching_member_policy_does_not_route_or_pause(self, client, workspace, people, monkeypatch):
        from app.services import approvals as svc
        monkeypatch.setattr(svc, '_match_custom_rules', lambda *args: {'0': 'no_match'})
        self.save(client, workspace, people, [{'kind': 'custom:m', 'description': 'Deploy app', 'policy': 'member', 'approver_email': 'mia@acme.test'}])
        a = _request(client, workspace).json()['data']
        assert a['status'] == 'approved'
        assert a['policy_requirements'] is None


@pytest.mark.parametrize("kind, expected", [("repo_read", "pending"), ("data_delete", "rejected"), ("deploy", "pending")])
def test_native_tool_request_requires_human_without_weakening_policy(client, workspace, configured_legacy_policies, kind, expected):
    response = _request(client, workspace, kind=kind, require_human=True)
    assert response.status_code == 200
    approval = response.json()["data"]
    assert approval["status"] == expected
    if kind == "deploy":
        assert approval["required_role"] == "admin"


def test_native_tool_request_requires_human_with_no_saved_policy(client, workspace):
    response = _request(client, workspace, kind="shell", require_human=True)
    assert response.json()["data"]["status"] == "pending"


@pytest.mark.parametrize("verdict", ["approve", "reject"])
def test_native_resolution_resumes_in_place(client, workspace, db, people, verdict):
    a = _request(client, workspace, require_human=True, resume_in_place=True).json()["data"]
    response = client.post(f"/v1/approvals/{a['id']}/{verdict}", json={"network": workspace["id"]}, headers=_bearer("mia"))
    assert response.status_code == 200
    out = response.json()["data"]
    event = next(e for e in _channel_events(db, workspace) if e.id == out["resolution_event_id"])
    assert event.payload["message_type"] == "approval"
    assert event.payload["mentions"] == []
    assert not event.metadata_.get("target_agents")


def test_native_permission_cannot_be_approved_by_workspace_token(client, workspace):
    a = _request(client, workspace, require_human=True).json()["data"]
    response = client.post(f"/v1/approvals/{a['id']}/approve", json={"network": workspace["id"]}, headers=_tok(workspace))
    assert response.json()["code"] == 403
