# -*- coding: utf-8 -*-
"""Approval routing, retired request kinds, assignees and expiry."""

from datetime import datetime, timedelta, timezone

import app.access as access
import pytest
from app.models import ApprovalRequest, EventRecord, NotificationRecord, User, WorkspaceMember, WorkspaceMembership
from app.services import approvals as svc
from sqlalchemy import select

AGENT = "agent-alpha"
OWNER = "mia@acme.test"


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def configured_review_policy(db, workspace):
    """Notification and assignee tests explicitly opt into human review."""
    svc.set_rules(db, workspace['id'], '*', [{'kind': 'external_send', 'policy': 'any'}], 'test-admin')
    db.commit()


@pytest.fixture(autouse=True)
def no_background(monkeypatch):
    import app.services.notify as notify_mod
    import app.services.push as push_mod
    monkeypatch.setattr(notify_mod, "_dispatch", lambda snapshot: None)
    monkeypatch.setattr(push_mod, "fanout_for_event", lambda *a, **k: None)
    import app.routers.events as events_mod
    import app.services.cloud_agent as cloud_mod
    import app.services.integrations as integ_mod
    import app.services.watches as watches_mod
    noop = lambda *a, **k: None  # noqa: E731
    for mod, name in ((events_mod, "invoke_cloud_agents"), (cloud_mod, "invoke_cloud_agents"),
                      (integ_mod, "relay_for_event"), (watches_mod, "notify_watchers")):
        if hasattr(mod, name):
            monkeypatch.setattr(mod, name, noop)


def _claims(email, name=None):
    return {"provider": "firebase", "email": email, "firebase_uid": email,
            "apple_sub": None, "display_name": name or email.split("@")[0]}


@pytest.fixture
def people(db, workspace, monkeypatch):
    """olivia=owner, adam=admin, mia=member (owns agent-alpha when `owned`),
    max=member (a teammate), vic=viewer. Addressable as `Bearer <name>`."""
    mapping = {}
    roles = {"olivia": "owner", "adam": "admin", "mia": "member", "max": "member", "vic": "viewer"}
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


def _member_row(db, workspace, agent=AGENT):
    return db.execute(select(WorkspaceMember).where(
        WorkspaceMember.workspace_id == workspace["id"], WorkspaceMember.agent_name == agent)).scalar_one()


@pytest.fixture
def owned(db, workspace, people):
    """agent-alpha is Mia's agent."""
    m = _member_row(db, workspace)
    m.owner_email = OWNER
    db.commit()
    return OWNER


def _tok(workspace):
    return {"X-Workspace-Token": workspace["token"]}


def _bearer(name):
    return {"Authorization": f"Bearer {name}"}


def _chan(workspace):
    ch = workspace["channel"]
    return ch["name"] if isinstance(ch, dict) else ch


def _create(client, workspace, **overrides):
    body = {
        "network": workspace["id"],
        "channel": _chan(workspace),
        "kind": "external_send",
        "action": "Send incident note to 38 customers",
        "source": f"openagents:{AGENT}",
    }
    body.update(overrides)
    return client.post("/v1/approvals", json=body, headers=_tok(workspace))


def _events(db, workspace):
    return db.execute(select(EventRecord).where(
        EventRecord.network_id == workspace["id"],
        EventRecord.target == f"channel/{_chan(workspace)}",
        EventRecord.type == "workspace.message.posted",
    ).order_by(EventRecord.timestamp.asc())).scalars().all()


def _event(db, workspace, event_id):
    return [e for e in _events(db, workspace) if e.id == event_id][0]


def _notes(db, workspace):
    return db.execute(select(NotificationRecord).where(
        NotificationRecord.workspace_id == workspace["id"]).order_by(NotificationRecord.created_at.asc())).scalars().all()


def _note_for(db, workspace, approval_id):
    return [n for n in _notes(db, workspace) if n.action_ref == approval_id][0]


# ---------------------------------------------------------------------------
# 1. Owner routing of the inbox row
# ---------------------------------------------------------------------------

class TestOwnerRouting:
    def test_unowned_agent_pages_the_workspace(self, client, workspace, db, people):
        a = _create(client, workspace).json()["data"]
        n = _note_for(db, workspace, a["id"])
        assert n.recipient_email is None
        assert n.kind == "approval"
        assert n.action_ref == a["id"]
        assert a["owner_email"] is None

    def test_owned_agent_pages_its_owner(self, client, workspace, db, owned):
        client.put('/v1/approval-policy', headers=_tok(workspace), json={
            'network': workspace['id'], 'rules': [{'kind': 'deploy', 'policy': 'admin'}]})
        a = _create(client, workspace, kind="deploy", action="Deploy 2.4").json()["data"]
        n = _note_for(db, workspace, a["id"])
        assert n.recipient_email == OWNER
        assert n.kind == "approval"
        assert n.action_ref == a["id"]
        # The role floor is unchanged — routing does not widen who may approve.
        assert a["required_role"] == "admin"
        assert a["owner_email"] == OWNER
        assert a["assignee_email"] is None

    def test_explicit_assignee_wins_over_owner(self, client, workspace, db, owned):
        a = _create(client, workspace, assignee_email="Adam@acme.test").json()["data"]
        assert a["assignee_email"] == "adam@acme.test"
        assert _note_for(db, workspace, a["id"]).recipient_email == "adam@acme.test"

    def test_auto_resolved_request_files_nothing(self, client, workspace, db, owned):
        client.put('/v1/approval-policy', headers=_tok(workspace), json={
            'network': workspace['id'], 'rules': [{'kind': 'repo_read', 'policy': 'allow'}]})
        a = _create(client, workspace, kind="repo_read", action="Clone").json()["data"]
        assert a["status"] == "approved"
        assert not [n for n in _notes(db, workspace) if n.action_ref == a["id"]]


# ---------------------------------------------------------------------------
# 2. Help requests
# ---------------------------------------------------------------------------

class TestRemovedEscalations:
    @pytest.mark.parametrize("kind", ["proposal", "help"])
    def test_creation_is_rejected_without_side_effects(self, client, workspace, db, owned, kind):
        before = len(_events(db, workspace))
        resp = _create(client, workspace, kind=kind)
        assert resp.json()["code"] != 0
        assert "Unsupported approval kind" in resp.json()["message"]
        assert len(_events(db, workspace)) == before
        assert _member_row(db, workspace).shared_instructions is None

# ---------------------------------------------------------------------------
# 4. Generic assignee + 5. requester_email
# ---------------------------------------------------------------------------

class TestAssigneeAndRequester:
    def test_permission_assignee_must_meet_role_floor(self, client, workspace, people):
        client.put('/v1/approval-policy', headers=_tok(workspace), json={
            'network': workspace['id'], 'rules': [{'kind': 'spend', 'policy': 'owner'}]})
        a = _create(client, workspace, kind="spend", action="Pay $120", assignee_email="vic@acme.test").json()["data"]
        assert a["required_role"] == "owner" and a["assignee_email"] == "vic@acme.test"
        # A member who is not the assignee: refused (floor is owner anyway).
        assert client.post(f"/v1/approvals/{a['id']}/approve", json={"network": workspace["id"]},
                           headers=_bearer("max")).json()["code"] != 0
        # An admin: still below the owner floor.
        assert client.post(f"/v1/approvals/{a['id']}/approve", json={"network": workspace["id"]},
                           headers=_bearer("adam")).json()["code"] != 0
        # Addressing the request to a viewer must not grant owner privileges.
        denied = client.post(f"/v1/approvals/{a['id']}/approve", json={"network": workspace["id"]}, headers=_bearer("vic"))
        assert denied.status_code == 403
        ok = client.post(f"/v1/approvals/{a['id']}/approve", json={"network": workspace["id"]}, headers=_bearer("olivia"))
        assert ok.status_code == 200, ok.text
        assert ok.json()["data"]["resolved_by"] == "olivia@acme.test"

    def test_assignee_narrows_any_to_assignee_or_admin(self, client, workspace, people):
        a = _create(client, workspace, assignee_email="mia@acme.test").json()["data"]
        assert a["required_role"] == "any"
        assert client.post(f"/v1/approvals/{a['id']}/approve", json={"network": workspace["id"]},
                           headers=_bearer("max")).json()["code"] != 0
        ok = client.post(f"/v1/approvals/{a['id']}/approve", json={"network": workspace["id"]}, headers=_bearer("olivia"))
        assert ok.json()["data"]["status"] == "approved"

    def test_token_still_resolves_on_legacy_open_workspace(self, client, workspace, db, owned):
        from app.models import Workspace
        ws = db.execute(select(Workspace).where(Workspace.id == workspace["id"])).scalar_one()
        ws.require_login = False
        db.commit()
        a = _create(client, workspace).json()["data"]
        ok = client.post(f"/v1/approvals/{a['id']}/approve",
                         json={"network": workspace["id"], "note": "Yes."}, headers=_tok(workspace))
        assert ok.status_code == 200, ok.text
        assert ok.json()["data"]["resolved_by"] == "token"

    def test_requester_email_travels_in_payload_and_inbox(self, client, workspace, db, owned):
        resp = _create(client, workspace, requester_email="Max@acme.test")
        a = resp.json()["data"]
        assert a["requester_email"] == "max@acme.test"
        evt = _event(db, workspace, a["request_event_id"])
        assert evt.payload["requester_email"] == "max@acme.test"
        assert evt.payload["approval"]["requester_email"] == "max@acme.test"
        assert "request from max@acme.test" in evt.payload["content"]
        n = _note_for(db, workspace, a["id"])
        assert n.recipient_email == OWNER
        assert "max@acme.test" in n.message
        # Not stored: a later read has no requester.
        again = client.get(f"/v1/approvals/{a['id']}?network={workspace['id']}", headers=_tok(workspace)).json()["data"]
        assert again["requester_email"] is None
        assert again["owner_email"] == OWNER


# ---------------------------------------------------------------------------
# Listing filters
# ---------------------------------------------------------------------------

class TestListFilters:
    def test_assignee_me_and_kind(self, client, workspace, owned):
        mine = _create(client, workspace, assignee_email=OWNER).json()["data"]
        _create(client, workspace, assignee_email="adam@acme.test")
        _create(client, workspace, source="openagents:agent-beta")  # unowned → no assignee

        me = client.get(f"/v1/approvals?network={workspace['id']}&assignee=me", headers=_bearer("mia")).json()["data"]
        assert {a["kind"] for a in me["approvals"]} == {"external_send"}
        assert all(a["assignee_email"] == OWNER for a in me["approvals"])

        adam = client.get(f"/v1/approvals?network={workspace['id']}&assignee=me", headers=_bearer("adam")).json()["data"]
        assert [a["kind"] for a in adam["approvals"]] == ["external_send"]

        filtered = client.get(f"/v1/approvals?network={workspace['id']}&kind=external_send", headers=_tok(workspace)).json()["data"]
        assert len(filtered["approvals"]) == 3

        by_email = client.get(f"/v1/approvals?network={workspace['id']}&assignee=ADAM@acme.test",
                              headers=_tok(workspace)).json()["data"]
        assert len(by_email["approvals"]) == 1

        everything = client.get(f"/v1/approvals?network={workspace['id']}", headers=_tok(workspace)).json()["data"]
        assert len(everything["approvals"]) == 3
        owners = {a["requested_by"]: a["owner_email"] for a in everything["approvals"]}
        assert owners == {AGENT: OWNER, "agent-beta": None}

    def test_assignee_me_needs_identity(self, client, workspace, owned):
        resp = client.get(f"/v1/approvals?network={workspace['id']}&assignee=me", headers=_tok(workspace))
        assert resp.json()["code"] != 0


# ---------------------------------------------------------------------------
# Expiry sweep
# ---------------------------------------------------------------------------

class TestExpireStale:
    def test_marks_only_past_due_pending_rows(self, client, workspace, db, owned):
        stale = _create(client, workspace, action="Old").json()["data"]
        fresh = _create(client, workspace, action="New").json()["data"]
        never = _create(client, workspace).json()["data"]
        done = _create(client, workspace, action="Done").json()["data"]
        client.post(f"/v1/approvals/{done['id']}/approve", json={"network": workspace["id"]}, headers=_bearer("adam"))

        now = datetime.now(timezone.utc)
        rows = {a.id: a for a in db.execute(select(ApprovalRequest)).scalars().all()}
        rows[stale["id"]].expires_at = now - timedelta(minutes=5)
        rows[fresh["id"]].expires_at = now + timedelta(hours=1)
        rows[done["id"]].expires_at = now - timedelta(hours=1)  # already decided; untouched
        db.commit()

        flipped = svc.expire_stale(db, now=now)
        db.commit()
        assert flipped == [stale["id"]]
        db.expire_all()
        assert rows[stale["id"]].status == "expired" and rows[stale["id"]].resolved_by == "system"
        assert rows[fresh["id"]].status == "pending"
        assert rows[never["id"]].status == "pending"
        assert rows[done["id"]].status == "approved"
        # Idempotent.
        assert svc.expire_stale(db, now=now) == []
        got = client.get(f"/v1/approvals/{stale['id']}?network={workspace['id']}", headers=_tok(workspace)).json()["data"]
        assert got["status"] == "expired" and got["expires_at"] is not None
