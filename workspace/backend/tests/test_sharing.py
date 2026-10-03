# -*- coding: utf-8 -*-
"""
Roadmap v1.1 M2 — sharing actions and invitations.

Thread participants (the ACL of a private thread), agent grants, the agent
directory, pins, "start another request with this specialist", and invites
that carry a target (thread / agent / task) and land the invitee there.
Machines (token-only callers) are trusted; the rules are between people.
"""

import app.access as access
import pytest
from app.models import (
    ResourceGrant,
    AgentPin,
    Channel,
    ChannelHumanMember,
    EventRecord,
    FileRecord,
    KanbanTask,
    User,
    WorkspaceInvite,
    WorkspaceMembership,
)
from sqlalchemy import select


@pytest.fixture(autouse=True)
def no_push(monkeypatch):
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
    """adam=admin, mia=member, vic=viewer are members. zoe has an account but
    no membership; nina has never signed in (claims only)."""
    mapping = {}
    for name, role in {"adam": "admin", "mia": "member", "vic": "viewer"}.items():
        email = f"{name}@acme.test"
        user = User(email=email, display_name=name.capitalize())
        db.add(user)
        db.flush()
        db.add(WorkspaceMembership(workspace_id=workspace["id"], user_id=user.id, role=role))
        mapping[name] = _claims(email, name.capitalize())
    db.add(User(email="zoe@acme.test", display_name="Zoe"))
    mapping["zoe"] = _claims("zoe@acme.test", "Zoe")
    mapping["nina"] = _claims("nina@acme.test", "Nina")
    db.commit()
    monkeypatch.setattr(access, "verify_identity_claims", lambda tok: mapping.get(tok))
    return mapping


def _tok(ws):
    return {"X-Workspace-Token": ws["token"]}


def _bearer(name, ws=None):
    h = {"Authorization": f"Bearer {name}"}
    if ws:
        h.update(_tok(ws))
    return h


def _email(name):
    return f"{name}@acme.test"


def _create_thread(client, ws, *, name, by, visibility="private", participants=("agent-alpha",)):
    r = client.post("/v1/events", json={
        "type": "network.channel.create",
        "source": f"human:{by}",
        "target": "core",
        "network": ws["id"],
        "payload": {"name": name, "title": f"Title of {name}", "visibility": visibility,
                    "sender_email": _email(by), "participants": list(participants)},
    }, headers=_tok(ws))
    assert r.status_code == 200, r.text
    return name


def _post(client, ws, *, channel, by, content, message_type="chat"):
    r = client.post("/v1/events", json={
        "type": "workspace.message.posted",
        "source": f"human:{by}",
        "target": f"channel/{channel}",
        "network": ws["id"],
        "payload": {"content": content, "sender_email": _email(by), "message_type": message_type},
    }, headers=_bearer(by, ws))
    assert r.status_code == 200, r.text
    return r.json()["data"]


def _discover(client, ws, headers):
    r = client.get(f"/v1/discover?network={ws['id']}", headers=headers)
    assert r.status_code == 200, r.text
    d = r.json()["data"]
    return {c["address"].split("/", 1)[1] for c in d["channels"]}, {a["address"].split(":", 1)[1] for a in d["agents"]}


def _join(client, ws, agent):
    r = client.post("/v1/join", json={"network": ws["id"], "agent_name": agent, "agent_type": "claude", "token": ws["token"]}, headers=_tok(ws))
    assert r.status_code == 200, r.text


def _make_personal(client, ws, agent, owner):
    """Permission model: an owned agent whose default `everyone` grant was revoked."""
    r = client.patch(f"/v1/workspaces/{ws['id']}/members/{agent}",
                     json={"owner_email": _email(owner)}, headers=_bearer(owner, ws))
    assert r.status_code == 200, r.text
    r = client.get(f"/v1/grants?network={ws['id']}&resource_kind=agent&resource_id={agent}", headers=_bearer(owner, ws))
    assert r.status_code == 200, r.text
    for g in r.json()["data"]["grants"]:
        if g["grantee_kind"] == "group":
            assert client.delete(f"/v1/grants/{g['id']}?network={ws['id']}", headers=_bearer(owner, ws)).status_code == 200


def _human_grants(db):
    return db.execute(select(ResourceGrant).where(ResourceGrant.grantee_kind == "human")).scalars().all()


def _participants(client, ws, channel, headers):
    return client.get(f"/v1/channels/{channel}/participants?network={ws['id']}", headers=headers)


def _add_participant(client, ws, channel, headers, email, note=None):
    body = {"network": ws["id"], "email": email}
    if note:
        body["note"] = note
    return client.post(f"/v1/channels/{channel}/participants", json=body, headers=headers)


def _remove_participant(client, ws, channel, headers, email):
    return client.delete(f"/v1/channels/{channel}/participants/{email}?network={ws['id']}", headers=headers)


def _notification_titles(client, ws, headers):
    r = client.get(f"/v1/notifications?network={ws['id']}", headers=headers)
    assert r.status_code == 200, r.text
    return {n["title"] for n in r.json()["data"]["notifications"]}


def _directory(client, ws, headers):
    r = client.get(f"/v1/agents/directory?network={ws['id']}", headers=headers)
    assert r.status_code == 200, r.text
    return {a["agent_name"]: a for a in r.json()["data"]["agents"]}


# ---------------------------------------------------------------------------
# Thread participants
# ---------------------------------------------------------------------------

class TestParticipants:
    def test_list_requires_view_access(self, client, workspace, people):
        _create_thread(client, workspace, name="p-1", by="mia")
        r = _participants(client, workspace, "p-1", _bearer("mia", workspace))
        assert r.status_code == 200, r.text
        d = r.json()["data"]
        assert d["channel"] == "p-1" and d["visibility"] == "private"
        assert d["director_email"] == "mia@acme.test"
        assert [h["email"] for h in d["humans"]] == ["mia@acme.test"]
        assert d["humans"][0]["display_name"] == "Mia"
        assert [a["agent_name"] for a in d["agents"]] == ["agent-alpha"]
        assert _participants(client, workspace, "p-1", _bearer("adam", workspace)).status_code == 403
        assert _participants(client, workspace, "p-1", _tok(workspace)).status_code == 200
        assert _participants(client, workspace, "nope", _tok(workspace)).status_code == 404

    def test_participant_adds_member_and_notifies(self, client, workspace, people):
        _create_thread(client, workspace, name="p-2", by="mia")
        r = _add_participant(client, workspace, "p-2", _bearer("mia", workspace), "Adam@Acme.test", note="need your eyes")
        assert r.status_code == 200, r.text
        assert r.json()["data"] == {"added": True, "email": "adam@acme.test", "already_participant": False}
        adam_ch, _ = _discover(client, workspace, _bearer("adam", workspace))
        assert "p-2" in adam_ch
        assert "Mia added you to Title of p-2" in _notification_titles(client, workspace, _bearer("adam", workspace))
        assert "Mia added you to Title of p-2" not in _notification_titles(client, workspace, _bearer("vic", workspace))
        # idempotent
        r = _add_participant(client, workspace, "p-2", _bearer("mia", workspace), "adam@acme.test")
        assert r.json()["data"]["already_participant"] is True

    def test_permissions(self, client, workspace, people):
        _create_thread(client, workspace, name="p-3", by="mia")
        # a non-participant member may not add anyone (not even themselves)
        assert _add_participant(client, workspace, "p-3", _bearer("vic", workspace), "vic@acme.test").status_code == 403
        # an admin who is not in the thread still may (admin+)
        assert _add_participant(client, workspace, "p-3", _bearer("adam", workspace), "vic@acme.test").status_code == 200
        # machines are trusted
        assert _add_participant(client, workspace, "p-3", _tok(workspace), "adam@acme.test").status_code == 200
        r = _participants(client, workspace, "p-3", _tok(workspace))
        assert {h["email"] for h in r.json()["data"]["humans"]} == {"mia@acme.test", "vic@acme.test", "adam@acme.test"}
        assert _add_participant(client, workspace, "p-3", _tok(workspace), "not-an-email").status_code == 400

    def test_non_member_gets_targeted_invite(self, client, workspace, people, db):
        _create_thread(client, workspace, name="p-4", by="mia")
        r = _add_participant(client, workspace, "p-4", _bearer("mia", workspace), "zoe@acme.test", note="join us")
        assert r.status_code == 200, r.text
        d = r.json()["data"]
        assert d["added"] is False and d["invited"] is True
        assert d["invite_token"] and d["invite_url"].endswith(f"/invite/{d['invite_token']}")
        inv = db.execute(select(WorkspaceInvite).where(WorkspaceInvite.token == d["invite_token"])).scalar_one()
        assert (inv.target_kind, inv.target_id, inv.note, inv.role, inv.email) == ("channel", "p-4", "join us", "member", "zoe@acme.test")
        assert inv.created_by == "mia@acme.test"
        # not added to the ACL
        ch = db.execute(select(Channel).where(Channel.name == "p-4")).scalar_one()
        emails = set(db.execute(select(ChannelHumanMember.user_email).where(ChannelHumanMember.channel_id == ch.id)).scalars().all())
        assert "zoe@acme.test" not in emails

    def test_remove_rules_and_last_participant_guard(self, client, workspace, people):
        _create_thread(client, workspace, name="p-5", by="mia")
        _add_participant(client, workspace, "p-5", _bearer("mia", workspace), "adam@acme.test")
        _add_participant(client, workspace, "p-5", _bearer("mia", workspace), "vic@acme.test")
        # an outsider may not remove others
        r = _remove_participant(client, workspace, "p-5", _bearer("zoe"), "vic@acme.test")
        assert r.status_code == 401
        # a participant may remove another participant
        r = _remove_participant(client, workspace, "p-5", _bearer("adam", workspace), "vic@acme.test")
        assert r.status_code == 200 and r.json()["data"]["removed"] is True
        # a person may always remove themselves
        r = _remove_participant(client, workspace, "p-5", _bearer("adam", workspace), "adam@acme.test")
        assert r.status_code == 200
        vic_ch, _ = _discover(client, workspace, _bearer("vic", workspace))
        adam_ch, _ = _discover(client, workspace, _bearer("adam", workspace))
        assert "p-5" not in vic_ch and "p-5" not in adam_ch
        # not a participant any more
        assert _remove_participant(client, workspace, "p-5", _tok(workspace), "adam@acme.test").status_code == 404
        # the last human of a private thread stays — even for machines
        assert _remove_participant(client, workspace, "p-5", _bearer("mia", workspace), "mia@acme.test").status_code == 400
        assert _remove_participant(client, workspace, "p-5", _tok(workspace), "mia@acme.test").status_code == 400

    def test_last_participant_may_leave_a_workspace_thread(self, client, workspace, people):
        _create_thread(client, workspace, name="p-6", by="mia", visibility="workspace")
        r = _remove_participant(client, workspace, "p-6", _bearer("mia", workspace), "mia@acme.test")
        assert r.status_code == 200, r.text


# ---------------------------------------------------------------------------
# Share preview
# ---------------------------------------------------------------------------

class TestSharePreview:
    def test_counts_and_refs(self, client, workspace, people, db):
        _create_thread(client, workspace, name="sp-1", by="mia")
        _post(client, workspace, channel="sp-1", by="mia", content="Deploy per @knowledge:deploy-runbook please")
        _post(client, workspace, channel="sp-1", by="mia", content="also see @knowledge:deploy-runbook and @knowledge:hyperpod-quotas")
        _post(client, workspace, channel="sp-1", by="mia", content="working...", message_type="status")
        db.add(FileRecord(workspace_id=workspace["id"], filename="plan.md", content_type="text/markdown", size=12,
                          storage_key="k1", uploaded_by="human:mia", channel_name="sp-1", status="active"))
        db.add(FileRecord(workspace_id=workspace["id"], filename="gone.md", content_type="text/markdown", size=12,
                          storage_key="k2", uploaded_by="human:mia", channel_name="sp-1", status="deleted"))
        db.add(FileRecord(workspace_id=workspace["id"], filename="other.md", content_type="text/markdown", size=12,
                          storage_key="k3", uploaded_by="human:mia", channel_name="elsewhere", status="active"))
        db.commit()
        r = client.get(f"/v1/channels/sp-1/share-preview?network={workspace['id']}", headers=_bearer("mia", workspace))
        assert r.status_code == 200, r.text
        d = r.json()["data"]
        assert d["channel"] == "sp-1" and d["title"] == "Title of sp-1" and d["visibility"] == "private"
        assert d["director_email"] == "mia@acme.test"
        assert d["humans"] == ["mia@acme.test"] and d["agents"] == ["agent-alpha"]
        assert d["message_count"] == 2
        assert [f["filename"] for f in d["files"]] == ["plan.md"]
        assert d["knowledge_refs"] == ["deploy-runbook", "hyperpod-quotas"]
        assert d["snapshot_available"] is True
        assert client.get(f"/v1/channels/sp-1/share-preview?network={workspace['id']}", headers=_bearer("adam", workspace)).status_code == 403


# ---------------------------------------------------------------------------
# Agent directory
# ---------------------------------------------------------------------------

class TestDirectory:
    def test_visibility_manage_pins_and_recent_requests(self, client, workspace, people):
        _join(client, workspace, "deploy-bot")
        _join(client, workspace, "helper-bot")
        _make_personal(client, workspace, "deploy-bot", "mia")
        client.patch(f"/v1/workspaces/{workspace['id']}/members/deploy-bot",
                     json={"purpose": "Launch endpoints", "example_requests": ["Deploy X"], "cost_owner": "owner"},
                     headers=_bearer("mia", workspace))
        assert client.post(f"/v1/agents/helper-bot/pin?network={workspace['id']}", headers=_bearer("vic", workspace)).status_code == 200
        _create_thread(client, workspace, name="req-1", by="mia", participants=("deploy-bot",))
        _create_thread(client, workspace, name="req-2", by="mia", participants=("deploy-bot", "helper-bot"))
        _create_thread(client, workspace, name="req-3", by="adam", participants=("deploy-bot",))

        mia = _directory(client, workspace, _bearer("mia", workspace))
        adam = _directory(client, workspace, _bearer("adam", workspace))
        vic = _directory(client, workspace, _bearer("vic", workspace))
        machine = _directory(client, workspace, _tok(workspace))

        # personal agent hidden from those without access
        assert "deploy-bot" in mia and "deploy-bot" in machine
        assert "deploy-bot" not in adam and "deploy-bot" not in vic
        assert {"helper-bot", "agent-alpha"} <= set(vic)

        bot = mia["deploy-bot"]
        assert bot["owner_email"] == "mia@acme.test" and bot["owner_display_name"] == "Mia"
        assert bot["visibility"] == "personal" and bot["purpose"] == "Launch endpoints"
        assert bot["example_requests"] == ["Deploy X"] and bot["cost_owner"] == "owner"
        assert bot["status"] == "online" and bot["runtime_status"] is None
        assert bot["can_manage"] is True and bot["grant_count"] == 0
        assert {r["channel"] for r in bot["my_recent_requests"]} == {"req-1", "req-2"}
        assert bot["my_recent_requests"][0]["title"].startswith("Title of")
        assert {r["channel"] for r in mia["helper-bot"]["my_recent_requests"]} == {"req-2"}

        # can_manage: admin yes, plain member/viewer no (grant_count hidden)
        assert adam["helper-bot"]["can_manage"] is True and adam["helper-bot"]["grant_count"] == 0
        assert vic["helper-bot"]["can_manage"] is False and vic["helper-bot"]["grant_count"] is None
        assert mia["helper-bot"]["can_manage"] is False

        # pins are per person
        assert vic["helper-bot"]["pinned"] is True
        assert mia["helper-bot"]["pinned"] is False and machine["helper-bot"]["pinned"] is False

        # machines: manage everything, no "my"
        assert machine["deploy-bot"]["can_manage"] is True
        assert machine["deploy-bot"]["my_recent_requests"] == []

    def test_recent_requests_capped_at_five_newest_first(self, client, workspace, people, db):
        for i in range(7):
            _create_thread(client, workspace, name=f"cap-{i}", by="mia")
        for i, ch in enumerate(db.execute(select(Channel).where(Channel.name.like("cap-%"))).scalars().all()):
            ch.last_event_at = 1000 + int(ch.name.split("-")[1])
        db.commit()
        mia = _directory(client, workspace, _bearer("mia", workspace))
        recent = mia["agent-alpha"]["my_recent_requests"]
        assert [r["channel"] for r in recent] == ["cap-6", "cap-5", "cap-4", "cap-3", "cap-2"]


# ---------------------------------------------------------------------------
# Agent grants
# ---------------------------------------------------------------------------

def _grants(client, ws, agent, headers):
    return client.get(f"/v1/agents/{agent}/grants?network={ws['id']}", headers=headers)


def _grant(client, ws, agent, headers, email, note=None):
    body = {"network": ws["id"], "email": email}
    if note:
        body["note"] = note
    return client.post(f"/v1/agents/{agent}/grants", json=body, headers=headers)


def _revoke(client, ws, agent, headers, email):
    return client.delete(f"/v1/agents/{agent}/grants/{email}?network={ws['id']}", headers=headers)


class TestGrants:
    def test_owner_grants_and_revokes(self, client, workspace, people, db):
        _join(client, workspace, "deploy-bot")
        _make_personal(client, workspace, "deploy-bot", "mia")
        _, vic_ag = _discover(client, workspace, _bearer("vic", workspace))
        assert "deploy-bot" not in vic_ag

        r = _grant(client, workspace, "deploy-bot", _bearer("mia", workspace), "VIC@acme.test", note="for HyperPod")
        assert r.status_code == 200, r.text
        assert r.json()["data"] == {"granted": True, "email": "vic@acme.test"}
        _, vic_ag = _discover(client, workspace, _bearer("vic", workspace))
        assert "deploy-bot" in vic_ag
        assert "Mia shared @deploy-bot with you" in _notification_titles(client, workspace, _bearer("vic", workspace))

        r = _grants(client, workspace, "deploy-bot", _bearer("mia", workspace))
        assert r.status_code == 200
        g = r.json()["data"]["grants"]
        assert len(g) == 1 and g[0]["email"] == "vic@acme.test" and g[0]["display_name"] == "Vic"
        assert g[0]["granted_by"] == "mia@acme.test" and g[0]["note"] == "for HyperPod" and g[0]["created_at"]

        # idempotent: no second active row
        r = _grant(client, workspace, "deploy-bot", _bearer("mia", workspace), "vic@acme.test")
        assert r.json()["data"]["granted"] is True and r.json()["data"].get("already_granted") is True
        assert len(_human_grants(db)) == 1

        # revoke sticks
        r = _revoke(client, workspace, "deploy-bot", _bearer("mia", workspace), "vic@acme.test")
        assert r.status_code == 200 and r.json()["data"]["revoked"] is True
        _, vic_ag = _discover(client, workspace, _bearer("vic", workspace))
        assert "deploy-bot" not in vic_ag
        row = _human_grants(db)[0]
        assert row.revoked_at is not None and row.revoked_by == "mia@acme.test"
        assert _grants(client, workspace, "deploy-bot", _bearer("mia", workspace)).json()["data"]["grants"] == []

        # re-grant inserts a fresh row (history stays)
        assert _grant(client, workspace, "deploy-bot", _bearer("mia", workspace), "vic@acme.test").status_code == 200
        db.expire_all()
        rows = _human_grants(db)
        assert len(rows) == 2 and sum(1 for g in rows if g.revoked_at is None) == 1

    def test_permissions(self, client, workspace, people):
        _join(client, workspace, "deploy-bot")
        _make_personal(client, workspace, "deploy-bot", "mia")
        # grantee / other members cannot manage
        assert _grants(client, workspace, "deploy-bot", _bearer("vic", workspace)).status_code == 403
        assert _grant(client, workspace, "deploy-bot", _bearer("vic", workspace), "vic@acme.test").status_code == 403
        assert _revoke(client, workspace, "deploy-bot", _bearer("vic", workspace), "mia@acme.test").status_code == 403
        # admins and machines can
        assert _grants(client, workspace, "deploy-bot", _bearer("adam", workspace)).status_code == 200
        assert _grant(client, workspace, "deploy-bot", _tok(workspace), "adam@acme.test").status_code == 200
        assert _grants(client, workspace, "deploy-bot", _tok(workspace)).status_code == 200
        assert _grants(client, workspace, "ghost", _tok(workspace)).status_code == 404

    def test_non_member_gets_targeted_invite(self, client, workspace, people, db):
        _join(client, workspace, "deploy-bot")
        _make_personal(client, workspace, "deploy-bot", "mia")
        r = _grant(client, workspace, "deploy-bot", _bearer("mia", workspace), "nina@acme.test", note="use it for deploys")
        assert r.status_code == 200, r.text
        d = r.json()["data"]
        assert d["granted"] is False and d["invited"] is True and "/invite/" in d["invite_url"]
        inv = db.execute(select(WorkspaceInvite).where(WorkspaceInvite.token == d["invite_token"])).scalar_one()
        assert (inv.target_kind, inv.target_id, inv.note, inv.email) == ("agent", "deploy-bot", "use it for deploys", "nina@acme.test")
        assert _human_grants(db) == []


# ---------------------------------------------------------------------------
# Pins
# ---------------------------------------------------------------------------

class TestPins:
    def test_pin_lifecycle(self, client, workspace, people, db):
        wid = workspace["id"]
        assert client.post(f"/v1/agents/agent-alpha/pin?network={wid}", headers=_tok(workspace)).status_code == 400
        assert client.get(f"/v1/agents/pins?network={wid}", headers=_tok(workspace)).status_code == 400
        r = client.post(f"/v1/agents/agent-alpha/pin?network={wid}", headers=_bearer("vic", workspace))
        assert r.status_code == 200 and r.json()["data"]["pinned"] is True
        # idempotent
        assert client.post(f"/v1/agents/agent-alpha/pin?network={wid}", headers=_bearer("vic", workspace)).status_code == 200
        assert len(db.execute(select(AgentPin)).scalars().all()) == 1
        assert client.get(f"/v1/agents/pins?network={wid}", headers=_bearer("vic", workspace)).json()["data"]["agents"] == ["agent-alpha"]
        assert client.get(f"/v1/agents/pins?network={wid}", headers=_bearer("mia", workspace)).json()["data"]["agents"] == []
        r = client.delete(f"/v1/agents/agent-alpha/pin?network={wid}", headers=_bearer("vic", workspace))
        assert r.status_code == 200 and r.json()["data"]["pinned"] is False
        assert client.get(f"/v1/agents/pins?network={wid}", headers=_bearer("vic", workspace)).json()["data"]["agents"] == []
        assert client.post(f"/v1/agents/ghost/pin?network={wid}", headers=_bearer("vic", workspace)).status_code == 404

    def test_pin_requires_access_to_the_agent(self, client, workspace, people):
        _join(client, workspace, "deploy-bot")
        _make_personal(client, workspace, "deploy-bot", "mia")
        wid = workspace["id"]
        assert client.post(f"/v1/agents/deploy-bot/pin?network={wid}", headers=_bearer("vic", workspace)).status_code == 403
        assert client.post(f"/v1/agents/deploy-bot/pin?network={wid}", headers=_bearer("mia", workspace)).status_code == 200
        _grant(client, workspace, "deploy-bot", _bearer("mia", workspace), "vic@acme.test")
        assert client.post(f"/v1/agents/deploy-bot/pin?network={wid}", headers=_bearer("vic", workspace)).status_code == 200


# ---------------------------------------------------------------------------
# Start another request with this specialist
# ---------------------------------------------------------------------------

def _request(client, ws, agent, headers, content, title=None):
    body = {"network": ws["id"], "content": content}
    if title:
        body["title"] = title
    return client.post(f"/v1/agents/{agent}/requests", json=body, headers=headers)


class TestRequests:
    def test_creates_private_thread_directed_by_caller(self, client, workspace, people, db):
        _join(client, workspace, "agent-alpha")
        r = _request(client, workspace, "agent-alpha", _bearer("vic", workspace), "Deploy the eval model to HyperPod, please, and report the endpoint URL once it is live")
        assert r.status_code == 200, r.text
        d = r.json()["data"]
        assert d["channel"].startswith("session-") and len(d["channel"]) == len("session-") + 8
        assert d["title"] == "Deploy the eval model to HyperPod, please, and report the en..."
        assert d["agent_name"] == "agent-alpha"

        ch = db.execute(select(Channel).where(Channel.name == d["channel"])).scalar_one()
        assert ch.visibility == "private"
        assert ch.director_email == "vic@acme.test"
        assert ch.created_by == "human:Vic"
        assert [p.agent_name for p in ch.participants] == ["agent-alpha"]
        emails = db.execute(select(ChannelHumanMember.user_email).where(ChannelHumanMember.channel_id == ch.id)).scalars().all()
        assert emails == ["vic@acme.test"]

        msgs = db.execute(select(EventRecord).where(
            EventRecord.type == "workspace.message.posted",
            EventRecord.target == f"channel/{d['channel']}",
            EventRecord.source.like("human:%"),
        )).scalars().all()
        assert len(msgs) == 1
        m = msgs[0]
        assert m.source == "human:Vic"
        assert m.payload["content"].startswith("@agent-alpha Deploy the eval model")
        assert m.payload["sender_email"] == "vic@acme.test" and m.payload["message_type"] == "chat"
        assert m.metadata_["sender_email"] == "vic@acme.test"
        assert m.metadata_["target_agents"] == ["agent-alpha"]

        vic_ch, _ = _discover(client, workspace, _bearer("vic", workspace))
        adam_ch, _ = _discover(client, workspace, _bearer("adam", workspace))
        assert d["channel"] in vic_ch and d["channel"] not in adam_ch

    def test_title_and_existing_mention_are_respected(self, client, workspace, people, db):
        r = _request(client, workspace, "agent-alpha", _bearer("mia", workspace), "@agent-alpha ship it", title="Ship it")
        assert r.status_code == 200, r.text
        d = r.json()["data"]
        assert d["title"] == "Ship it"
        ch = db.execute(select(Channel).where(Channel.name == d["channel"])).scalar_one()
        assert ch.title == "Ship it"
        m = db.execute(select(EventRecord).where(
            EventRecord.type == "workspace.message.posted",
            EventRecord.target == f"channel/{d['channel']}", EventRecord.source == "human:Mia",
        )).scalar_one()
        assert m.payload["content"] == "@agent-alpha ship it"

    def test_guards(self, client, workspace, people):
        _join(client, workspace, "deploy-bot")
        _make_personal(client, workspace, "deploy-bot", "mia")
        assert _request(client, workspace, "agent-alpha", _tok(workspace), "hi").status_code == 400
        assert _request(client, workspace, "agent-alpha", _bearer("mia", workspace), "   ").status_code == 400
        assert _request(client, workspace, "ghost", _bearer("mia", workspace), "hi").status_code == 404
        assert _request(client, workspace, "deploy-bot", _bearer("vic", workspace), "hi").status_code == 403
        assert _request(client, workspace, "deploy-bot", _bearer("mia", workspace), "hi").status_code == 200
        _grant(client, workspace, "deploy-bot", _bearer("mia", workspace), "vic@acme.test")
        assert _request(client, workspace, "deploy-bot", _bearer("vic", workspace), "hi").status_code == 200


# ---------------------------------------------------------------------------
# Invites with a target
# ---------------------------------------------------------------------------

def _create_invite(client, ws, headers, **body):
    return client.post(f"/v1/workspaces/{ws['id']}/invites", json=body, headers=headers)


class TestTargetedInvites:
    def test_channel_target_adds_acl_and_redirects(self, client, workspace, people, db):
        _create_thread(client, workspace, name="inv-1", by="mia")
        r = _create_invite(client, workspace, _bearer("adam", workspace), email="zoe@acme.test", role="member",
                           target_kind="channel", target_id="inv-1", note="please review")
        assert r.status_code == 200, r.text
        inv = r.json()["data"]
        assert inv["targetKind"] == "channel" and inv["targetId"] == "inv-1" and inv["note"] == "please review"
        token = inv["url"].rsplit("/", 1)[1]

        peek = client.get(f"/v1/invites/{token}").json()["data"]
        assert peek["target_kind"] == "channel" and peek["target_id"] == "inv-1"
        assert peek["target_title"] == "Title of inv-1" and peek["note"] == "please review"

        assert client.get(f"/v1/discover?network={workspace['id']}", headers=_bearer("zoe")).status_code == 401
        r = client.post(f"/v1/invites/{token}/accept", headers=_bearer("zoe"))
        assert r.status_code == 200, r.text
        d = r.json()["data"]
        assert d["role"] == "member" and d["target_kind"] == "channel" and d["target_id"] == "inv-1"
        assert d["redirect"] == "#?thread=inv-1"
        zoe_ch, _ = _discover(client, workspace, _bearer("zoe"))
        assert "inv-1" in zoe_ch
        ch = db.execute(select(Channel).where(Channel.name == "inv-1")).scalar_one()
        emails = set(db.execute(select(ChannelHumanMember.user_email).where(ChannelHumanMember.channel_id == ch.id)).scalars().all())
        assert emails == {"mia@acme.test", "zoe@acme.test"}

    def test_agent_target_creates_grant(self, client, workspace, people, db):
        _join(client, workspace, "deploy-bot")
        _make_personal(client, workspace, "deploy-bot", "mia")
        r = _create_invite(client, workspace, _bearer("adam", workspace), email="nina@acme.test",
                           target_kind="agent", target_id="deploy-bot")
        assert r.status_code == 200, r.text
        token = r.json()["data"]["url"].rsplit("/", 1)[1]
        assert client.get(f"/v1/invites/{token}").json()["data"]["target_title"] == "deploy-bot"
        r = client.post(f"/v1/invites/{token}/accept", headers=_bearer("nina"))
        assert r.status_code == 200, r.text
        assert r.json()["data"]["redirect"] == "#?agent=deploy-bot"
        g = db.execute(select(ResourceGrant).where(ResourceGrant.grantee_kind == "human")).scalar_one()
        assert (g.resource_id, g.grantee_id, g.granted_by, g.revoked_at) == ("deploy-bot", "nina@acme.test", "adam@acme.test", None)
        _, nina_ag = _discover(client, workspace, _bearer("nina"))
        assert "deploy-bot" in nina_ag

    def test_task_target_lands_on_its_thread(self, client, workspace, people, db):
        _create_thread(client, workspace, name="task:t1", by="mia")
        db.add(KanbanTask(id="t1", workspace_id=workspace["id"], title="Ship v1.1", created_by="human:mia", channel_name="task:t1"))
        db.commit()
        r = _create_invite(client, workspace, _tok(workspace), email="zoe@acme.test", target_kind="task", target_id="t1")
        assert r.status_code == 200, r.text
        token = r.json()["data"]["url"].rsplit("/", 1)[1]
        assert client.get(f"/v1/invites/{token}").json()["data"]["target_title"] == "Ship v1.1"
        r = client.post(f"/v1/invites/{token}/accept", headers=_bearer("zoe"))
        assert r.status_code == 200, r.text
        assert r.json()["data"]["redirect"] == "#?thread=task:t1"
        zoe_ch, _ = _discover(client, workspace, _bearer("zoe"))
        assert "task:t1" in zoe_ch

    def test_open_invite_without_target_is_unchanged(self, client, workspace, people):
        r = _create_invite(client, workspace, _bearer("adam", workspace), role="viewer")
        token = r.json()["data"]["url"].rsplit("/", 1)[1]
        peek = client.get(f"/v1/invites/{token}").json()["data"]
        assert peek["target_kind"] is None and peek["target_title"] is None
        d = client.post(f"/v1/invites/{token}/accept", headers=_bearer("zoe")).json()["data"]
        assert d["redirect"] is None and d["target_kind"] is None

    def test_target_validation(self, client, workspace, people):
        h = _bearer("adam", workspace)
        assert _create_invite(client, workspace, h, target_kind="channel", target_id="nope").status_code == 404
        assert _create_invite(client, workspace, h, target_kind="agent", target_id="nope").status_code == 404
        assert _create_invite(client, workspace, h, target_kind="task", target_id="nope").status_code == 404
        assert _create_invite(client, workspace, h, target_kind="channel").status_code == 400
        assert _create_invite(client, workspace, h, target_kind="bogus", target_id="x").status_code == 422
