# -*- coding: utf-8 -*-
"""
Roadmap v1.1 M3 — owner-centric escalation on the approvals table.

Covers: inbox routing to the agent's owner (recipient / kind / action_ref),
``kind=help`` questions (who may answer, the answer message that reaches the
agent), ``kind=proposal`` (approval appends to ``shared_instructions`` with an
audit comment; rejection does not), generic ``assignee_email``, the
``assignee=me`` / ``kind=`` list filters, ``requester_email`` pass-through,
and the ``expire_stale`` sweep.
"""

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


def _ask(client, workspace, question="Should EU customers get this note too?", **overrides):
    return _create(client, workspace, kind="help", action=None, question=question,
                   details="Max asked for all affected accounts; shared instructions only cover US.", **overrides)


def _propose(client, workspace, summary="Run the eval suite before every HyperPod deploy",
             text="Before deploying to HyperPod, run `make eval` and attach the summary.", **overrides):
    return _create(client, workspace, kind="proposal", action=summary, details=text, **overrides)


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
        a = _create(client, workspace, kind="deploy", action="Deploy 2.4").json()["data"]
        n = _note_for(db, workspace, a["id"])
        assert n.recipient_email == OWNER
        assert n.kind == "approval"
        assert n.action_ref == a["id"]
        # The role floor is unchanged — routing does not widen who may approve.
        assert a["required_role"] == "admin"
        assert a["owner_email"] == OWNER
        assert a["assignee_email"] is None

    def test_kind_class_on_notification(self, client, workspace, db, owned):
        h = _ask(client, workspace).json()["data"]
        p = _propose(client, workspace).json()["data"]
        assert _note_for(db, workspace, h["id"]).kind == "help"
        assert _note_for(db, workspace, p["id"]).kind == "proposal"
        assert _note_for(db, workspace, h["id"]).recipient_email == OWNER

    def test_explicit_assignee_wins_over_owner(self, client, workspace, db, owned):
        a = _create(client, workspace, assignee_email="Adam@acme.test").json()["data"]
        assert a["assignee_email"] == "adam@acme.test"
        assert _note_for(db, workspace, a["id"]).recipient_email == "adam@acme.test"

    def test_auto_resolved_request_files_nothing(self, client, workspace, db, owned):
        a = _create(client, workspace, kind="repo_read", action="Clone").json()["data"]
        assert a["status"] == "approved"
        assert not [n for n in _notes(db, workspace) if n.action_ref == a["id"]]


# ---------------------------------------------------------------------------
# 2. Help requests
# ---------------------------------------------------------------------------

class TestHelp:
    def test_create_posts_help_card_to_owner(self, client, workspace, db, owned):
        resp = _ask(client, workspace)
        assert resp.status_code == 200, resp.text
        a = resp.json()["data"]
        assert a["kind"] == "help"
        assert a["kind_class"] == "help"
        assert a["status"] == "pending"           # never auto-decided
        assert a["required_role"] == "any"
        assert a["assignee_email"] == OWNER
        assert a["action"] == "Should EU customers get this note too?"

        evt = _event(db, workspace, a["request_event_id"])
        assert evt.payload["message_type"] == "approval"
        assert evt.payload["approval"]["kind"] == "help"
        assert evt.payload["approval"]["assignee_email"] == OWNER
        assert evt.payload["approval"]["owner_email"] == OWNER
        assert "Question for mia@acme.test" in evt.payload["content"]
        assert not (evt.metadata_ or {}).get("target_agents")

    def test_assignee_member_answers_and_agent_is_told(self, client, workspace, db, owned):
        a = _ask(client, workspace).json()["data"]
        resp = client.post(f"/v1/approvals/{a['id']}/answer",
                           json={"network": workspace["id"], "answer": "Yes, include EU — same template."},
                           headers=_bearer("mia"))
        assert resp.status_code == 200, resp.text
        out = resp.json()["data"]
        assert out["status"] == "approved"
        assert out["resolved_by"] == OWNER and out["resolved_by_role"] == "member"
        assert out["note"] == "Yes, include EU — same template."

        evt = _event(db, workspace, out["resolution_event_id"])
        assert evt.payload["content"] == "@agent-alpha 💬 Answer from Mia: Yes, include EU — same template."
        assert evt.payload["message_type"] == "chat"
        assert evt.source == f"human:{OWNER}"
        assert "agent-alpha" in (evt.metadata_ or {}).get("target_agents", [])
        assert evt.payload["approval"]["kind"] == "help"

    def test_approve_with_note_is_the_same_as_answer(self, client, workspace, db, owned):
        a = _ask(client, workspace).json()["data"]
        resp = client.post(f"/v1/approvals/{a['id']}/approve",
                           json={"network": workspace["id"], "note": "US only for now."}, headers=_bearer("mia"))
        assert resp.status_code == 200, resp.text
        evt = _event(db, workspace, resp.json()["data"]["resolution_event_id"])
        assert evt.payload["content"] == "@agent-alpha 💬 Answer from Mia: US only for now."

    def test_approve_without_an_answer_is_refused(self, client, workspace, owned):
        a = _ask(client, workspace).json()["data"]
        resp = client.post(f"/v1/approvals/{a['id']}/approve", json={"network": workspace["id"]}, headers=_bearer("mia"))
        assert resp.json()["code"] != 0
        assert "answer" in resp.json()["message"]
        assert client.post(f"/v1/approvals/{a['id']}/answer", json={"network": workspace["id"], "answer": "  "},
                           headers=_bearer("mia")).json()["code"] != 0

    def test_teammate_cannot_answer_owner_question_admin_can(self, client, workspace, owned):
        a = _ask(client, workspace).json()["data"]
        denied = client.post(f"/v1/approvals/{a['id']}/answer",
                             json={"network": workspace["id"], "answer": "Sure."}, headers=_bearer("max"))
        assert denied.json()["code"] != 0
        assert "addressed to mia@acme.test" in denied.json()["message"]
        ok = client.post(f"/v1/approvals/{a['id']}/answer",
                         json={"network": workspace["id"], "answer": "Admin says: include EU."}, headers=_bearer("adam"))
        assert ok.status_code == 200, ok.text
        assert ok.json()["data"]["resolved_by_role"] == "admin"

    def test_viewer_cannot_answer(self, client, workspace, owned):
        a = _ask(client, workspace).json()["data"]
        resp = client.post(f"/v1/approvals/{a['id']}/answer",
                           json={"network": workspace["id"], "answer": "x"}, headers=_bearer("vic"))
        assert resp.json()["code"] != 0

    def test_unowned_agent_question_goes_to_any_member(self, client, workspace, db, people):
        a = _ask(client, workspace).json()["data"]
        assert a["assignee_email"] is None and a["required_role"] == "any"
        assert _note_for(db, workspace, a["id"]).recipient_email is None
        assert "Question for any member" in _event(db, workspace, a["request_event_id"]).payload["content"]
        ok = client.post(f"/v1/approvals/{a['id']}/answer",
                         json={"network": workspace["id"], "answer": "Go ahead."}, headers=_bearer("max"))
        assert ok.status_code == 200, ok.text
        assert ok.json()["data"]["status"] == "approved"

    def test_declined_question(self, client, workspace, db, owned):
        a = _ask(client, workspace).json()["data"]
        resp = client.post(f"/v1/approvals/{a['id']}/reject",
                           json={"network": workspace["id"], "note": "Ask Max to decide."}, headers=_bearer("mia"))
        evt = _event(db, workspace, resp.json()["data"]["resolution_event_id"])
        assert evt.payload["content"].startswith("@agent-alpha ❌ Declined by Mia")
        assert "Ask Max to decide." in evt.payload["content"]

    def test_answer_only_for_help(self, client, workspace, owned):
        a = _create(client, workspace).json()["data"]
        resp = client.post(f"/v1/approvals/{a['id']}/answer",
                           json={"network": workspace["id"], "answer": "ok"}, headers=_bearer("mia"))
        assert resp.json()["code"] != 0
        assert "help" in resp.json()["message"]

    def test_question_is_required(self, client, workspace, owned):
        resp = _create(client, workspace, kind="help", action=None)
        assert resp.json()["code"] != 0
        assert "question" in resp.json()["message"]

    def test_help_request_parks_and_answer_resumes_task(self, client, workspace, db, owned):
        from app.models import KanbanTask
        task = client.post("/v1/tasks", json={"network": workspace["id"], "title": "Email customers"},
                           headers=_tok(workspace)).json()["data"]
        client.post(f"/v1/tasks/{task['id']}/assign",
                    json={"network": workspace["id"], "agent": AGENT}, headers=_tok(workspace))
        a = _ask(client, workspace, channel=f"task:{task['id']}").json()["data"]
        row = db.execute(select(KanbanTask).where(KanbanTask.id == task["id"])).scalar_one()
        db.refresh(row)
        assert row.status == "need_input"
        client.post(f"/v1/approvals/{a['id']}/answer", json={"network": workspace["id"], "answer": "Yes."}, headers=_bearer("mia"))
        db.refresh(row)
        assert row.status == "in_progress"


# ---------------------------------------------------------------------------
# 3. Proposals
# ---------------------------------------------------------------------------

class TestProposal:
    def test_create_targets_owner(self, client, workspace, db, owned):
        resp = _propose(client, workspace)
        assert resp.status_code == 200, resp.text
        a = resp.json()["data"]
        assert a["kind"] == "proposal" and a["status"] == "pending"
        assert a["assignee_email"] == OWNER and a["required_role"] == "any"
        evt = _event(db, workspace, a["request_event_id"])
        assert evt.payload["message_type"] == "approval"
        assert evt.payload["approval"]["kind"] == "proposal"
        assert "Proposed instruction update" in evt.payload["content"]
        assert _member_row(db, workspace).shared_instructions is None

    def test_approve_appends_with_audit_comment(self, client, workspace, db, owned):
        a = _propose(client, workspace).json()["data"]
        resp = client.post(f"/v1/approvals/{a['id']}/approve",
                           json={"network": workspace["id"], "note": "Good catch."}, headers=_bearer("mia"))
        assert resp.status_code == 200, resp.text
        db.expire_all()
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        text = _member_row(db, workspace).shared_instructions
        assert text == (f"<!-- approved {today} by {OWNER} -->\n"
                        "Before deploying to HyperPod, run `make eval` and attach the summary.")
        evt = _event(db, workspace, resp.json()["data"]["resolution_event_id"])
        assert evt.payload["content"].startswith("@agent-alpha ✅ Adopted: Run the eval suite before every HyperPod deploy")
        assert "Good catch." in evt.payload["content"]
        assert "agent-alpha" in (evt.metadata_ or {}).get("target_agents", [])

    def test_second_approval_appends_a_block(self, client, workspace, db, owned):
        m = _member_row(db, workspace)
        m.shared_instructions = "Always deploy from main.\n"
        db.commit()
        a = _propose(client, workspace, summary="Notify #ops", text="Post a note in #ops after each deploy.").json()["data"]
        client.post(f"/v1/approvals/{a['id']}/approve", json={"network": workspace["id"]}, headers=_bearer("mia"))
        db.expire_all()
        text = _member_row(db, workspace).shared_instructions
        assert text.startswith("Always deploy from main.\n\n<!-- approved ")
        assert text.endswith("-->\nPost a note in #ops after each deploy.")

    def test_reject_does_not_append(self, client, workspace, db, owned):
        a = _propose(client, workspace).json()["data"]
        resp = client.post(f"/v1/approvals/{a['id']}/reject",
                           json={"network": workspace["id"], "note": "Evals are too slow for hotfixes."}, headers=_bearer("mia"))
        assert resp.json()["data"]["status"] == "rejected"
        db.expire_all()
        assert _member_row(db, workspace).shared_instructions is None
        evt = _event(db, workspace, resp.json()["data"]["resolution_event_id"])
        assert evt.payload["content"] == "@agent-alpha ❌ Not adopted: Evals are too slow for hotfixes."

    def test_teammate_cannot_adopt_admin_can(self, client, workspace, owned):
        a = _propose(client, workspace).json()["data"]
        assert client.post(f"/v1/approvals/{a['id']}/approve", json={"network": workspace["id"]},
                           headers=_bearer("max")).json()["code"] != 0
        ok = client.post(f"/v1/approvals/{a['id']}/approve", json={"network": workspace["id"]}, headers=_bearer("adam"))
        assert ok.json()["data"]["status"] == "approved"

    def test_unowned_agent_proposal_needs_admin(self, client, workspace, db, people):
        a = _propose(client, workspace).json()["data"]
        assert a["assignee_email"] is None and a["required_role"] == "admin"
        assert _note_for(db, workspace, a["id"]).recipient_email is None
        assert client.post(f"/v1/approvals/{a['id']}/approve", json={"network": workspace["id"]},
                           headers=_bearer("mia")).json()["code"] != 0
        ok = client.post(f"/v1/approvals/{a['id']}/approve", json={"network": workspace["id"]}, headers=_bearer("adam"))
        assert ok.json()["data"]["status"] == "approved"
        db.expire_all()
        assert "by adam@acme.test -->" in _member_row(db, workspace).shared_instructions

    def test_proposal_needs_text(self, client, workspace, owned):
        resp = _create(client, workspace, kind="proposal", action="Do better", details="")
        assert resp.json()["code"] != 0
        assert "details" in resp.json()["message"]


# ---------------------------------------------------------------------------
# 4. Generic assignee + 5. requester_email
# ---------------------------------------------------------------------------

class TestAssigneeAndRequester:
    def test_assignee_resolves_regardless_of_role_floor(self, client, workspace, people):
        a = _create(client, workspace, kind="spend", action="Pay $120", assignee_email="vic@acme.test").json()["data"]
        assert a["required_role"] == "owner" and a["assignee_email"] == "vic@acme.test"
        # A member who is not the assignee: refused (floor is owner anyway).
        assert client.post(f"/v1/approvals/{a['id']}/approve", json={"network": workspace["id"]},
                           headers=_bearer("max")).json()["code"] != 0
        # An admin: still below the owner floor.
        assert client.post(f"/v1/approvals/{a['id']}/approve", json={"network": workspace["id"]},
                           headers=_bearer("adam")).json()["code"] != 0
        # The assignee — a viewer — may decide.
        ok = client.post(f"/v1/approvals/{a['id']}/approve", json={"network": workspace["id"]}, headers=_bearer("vic"))
        assert ok.status_code == 200, ok.text
        assert ok.json()["data"]["resolved_by"] == "vic@acme.test"

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
        a = _ask(client, workspace).json()["data"]
        ok = client.post(f"/v1/approvals/{a['id']}/answer",
                         json={"network": workspace["id"], "answer": "Yes."}, headers=_tok(workspace))
        assert ok.status_code == 200, ok.text
        assert ok.json()["data"]["resolved_by"] == "token"

    def test_requester_email_travels_in_payload_and_inbox(self, client, workspace, db, owned):
        resp = _ask(client, workspace, requester_email="Max@acme.test")
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
        mine = _ask(client, workspace).json()["data"]
        _propose(client, workspace)
        _create(client, workspace, assignee_email="adam@acme.test")
        _create(client, workspace, source="openagents:agent-beta")  # unowned → no assignee

        me = client.get(f"/v1/approvals?network={workspace['id']}&assignee=me", headers=_bearer("mia")).json()["data"]
        assert {a["kind"] for a in me["approvals"]} == {"help", "proposal"}
        assert all(a["assignee_email"] == OWNER for a in me["approvals"])

        adam = client.get(f"/v1/approvals?network={workspace['id']}&assignee=me", headers=_bearer("adam")).json()["data"]
        assert [a["kind"] for a in adam["approvals"]] == ["external_send"]

        helps = client.get(f"/v1/approvals?network={workspace['id']}&kind=help", headers=_tok(workspace)).json()["data"]
        assert [a["id"] for a in helps["approvals"]] == [mine["id"]]

        by_email = client.get(f"/v1/approvals?network={workspace['id']}&assignee=ADAM@acme.test",
                              headers=_tok(workspace)).json()["data"]
        assert len(by_email["approvals"]) == 1

        everything = client.get(f"/v1/approvals?network={workspace['id']}", headers=_tok(workspace)).json()["data"]
        assert len(everything["approvals"]) == 4
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
        never = _ask(client, workspace).json()["data"]
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
